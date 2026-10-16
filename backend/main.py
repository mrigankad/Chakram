import asyncio
import sys
from pathlib import Path

from contextlib import asynccontextmanager


def _make_console_unicode_safe() -> None:
    """Never let a log line crash a request.

    Progress lines contain characters such as "✓" and "→". On Windows, stdout
    and stderr default to a legacy code page (cp1252) whenever they are a file or
    a pipe, and writing those characters raises UnicodeEncodeError inside the job
    that printed them: a repository analysis failed with "'charmap' codec can't
    encode character". Encode as UTF-8 and replace anything that still cannot be
    written.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass


_make_console_unicode_safe()

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import connect_db, close_db, ensure_connected, ensure_core_indexes, get_db
from app.errors import register_exception_handlers
from app.routes import (
    requirements, test_cases, test_execution, synthetic_data,
    prioritization, dashboard, repo_analysis,
    github, jira, ci_intelligence, defect_prediction, release_gate,
    monitoring, incidents, sprint,
    workspace, copilot, git_ops, coverage, test_gen,
    pipeline, impact, commit, deployments, prd, cost_logs,
    root_cause, test_selection, healing,
)
from app.routes import ai_ide
from app.routes import baseline as baseline_router
from app.routes import auth as auth_router
from app.routes import webhooks as webhooks_router
from app.routes import organizations as organizations_router
from app.routes import activity as activity_router
from app.services import organization_service
from app.services import activity_history_service
import httpx
from fastapi import status
import logging
from pymongo.errors import ConnectionFailure

logger = logging.getLogger("aidlc")

STATIC_DIR = Path(__file__).resolve().parent / "static"


async def _ensure_indexes_and_seed() -> None:
    """Startup index creation and seeding. Each step is independent and non-fatal."""
    # Ensure repo_baselines collection indexes exist
    try:
        from app.services.baseline_store import ensure_indexes
        await ensure_indexes(get_db())
    except Exception as exc:
        print(f"[DB] baseline index creation failed (non-fatal): {exc}")
    try:
        from app.services import design_pack_service
        await design_pack_service.ensure_indexes(get_db())
    except Exception as exc:
        print(f"[DB] design pack index creation failed (non-fatal): {exc}")
    try:
        await organization_service.ensure_indexes(get_db())
    except Exception as exc:
        print(f"[DB] organization index creation failed (non-fatal): {exc}")
    try:
        from app.services.root_cause_service import ensure_indexes as ensure_rc_indexes
        await ensure_rc_indexes(get_db())
    except Exception as exc:
        print(f"[DB] root_cause index creation failed (non-fatal): {exc}")
    try:
        from app.services.test_selection_service import ensure_indexes as ensure_ts_indexes
        await ensure_ts_indexes(get_db())
    except Exception as exc:
        print(f"[DB] test_selection index creation failed (non-fatal): {exc}")
    try:
        from app.services import user_service
        await user_service.ensure_indexes(get_db())
        await user_service.seed_configured_account(get_db())
    except Exception as exc:
        print(f"[DB] user seed/index failed (non-fatal): {exc}")
    try:
        from app.services.healing_service import ensure_indexes as ensure_healing_indexes
        await ensure_healing_indexes(get_db())
    except Exception as exc:
        print(f"[DB] healing index creation failed (non-fatal): {exc}")
    try:
        from app.services.execution_service import ensure_indexes as ensure_execution_indexes
        await ensure_execution_indexes(get_db())
    except Exception as exc:
        print(f"[DB] test execution index creation failed (non-fatal): {exc}")
    try:
        await activity_history_service.ensure_indexes(get_db())
    except Exception as exc:
        print(f"[DB] activity_history index creation failed (non-fatal): {exc}")
    try:
        await ensure_core_indexes(get_db())
    except Exception as exc:
        print(f"[DB] core index creation failed (non-fatal): {exc}")
    try:
        from app.services.test_gen_service import ensure_indexes as ensure_test_suite_indexes
        await ensure_test_suite_indexes(get_db())
    except Exception as exc:
        print(f"[DB] test suite index creation failed (non-fatal): {exc}")
    try:
        from app.services import (
            ai_ide_service, analysis_runner, ci_metrics_service, playwright_service, workspace_service,
        )
        for service in (analysis_runner, playwright_service, workspace_service, ai_ide_service, ci_metrics_service):
            await service.ensure_indexes(get_db())
    except Exception as exc:
        print(f"[DB] job/workspace/cache index creation failed (non-fatal): {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # connect_db pings once. With MongoDB unreachable every index/seed step would
    # wait out the full server-selection timeout, so they are skipped together.
    if await connect_db():
        await _ensure_indexes_and_seed()
    else:
        logger.error(
            "MongoDB is unreachable at startup: skipping index creation and seeding. "
            "Requests that need the database will return 503 until it is available."
        )
    yield
    await close_db()


app = FastAPI(
    title="Chakram API",
    description="AI-powered SDLC & Data Quality platform backend.",
    version="2.0.0",
    lifespan=lifespan,
    # The interactive API reference is a development aid; it is not published in production.
    docs_url=None if settings.APP_ENV == "production" else "/docs",
    redoc_url=None if settings.APP_ENV == "production" else "/redoc",
    openapi_url=None if settings.APP_ENV == "production" else "/openapi.json",
)

# CORS – explicit origins only in production (credentialed wildcard regex is unsafe).
# Dev still allows preview hosts so local + preview deploys work without extra env.
_cors_kwargs: dict = {
    "allow_origins": list(settings.CORS_ORIGINS),
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
_frontend_url = (settings.FRONTEND_URL or "").rstrip("/")
if _frontend_url and _frontend_url not in _cors_kwargs["allow_origins"]:
    _cors_kwargs["allow_origins"].append(_frontend_url)
if settings.APP_ENV != "production":
    _cors_kwargs["allow_origin_regex"] = (
        r"https://.*\.(vercel\.app|azurecontainerapps\.io|azurestaticapps\.net)"
    )
app.add_middleware(CORSMiddleware, **_cors_kwargs)


register_exception_handlers(app)


@app.exception_handler(ConnectionFailure)
async def database_unavailable(request: Request, exc: ConnectionFailure):
    """MongoDB unreachable (includes ServerSelectionTimeoutError): 503, not a generic 500."""
    logger.error("database unavailable on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "The database is temporarily unavailable. Please try again shortly."},
    )


@app.middleware("http")
async def request_time_limit(request: Request, call_next):
    """Answer 504 with a plain message when a request outlives the ingress limit.

    Long work (test runs, scans, analyses) runs as background jobs and is polled, so it
    is not affected; this bounds single requests that chain several AI calls.
    """
    if not request.url.path.startswith("/api"):
        return await call_next(request)
    try:
        return await asyncio.wait_for(call_next(request), timeout=settings.REQUEST_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.warning("request timed out: %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            content={"detail": "This request took too long and was stopped. Try a smaller input, or run it again shortly."},
        )


@app.middleware("http")
async def serverless_db_warmup(request: Request, call_next):
    """Ensure MongoDB is reachable on cold starts (Vercel serverless)."""
    # /health is the liveness probe and must answer even when Mongo is down.
    if request.url.path.startswith("/api"):
        await ensure_connected()
    return await call_next(request)


# Register all routers under /api prefix
API_PREFIX = "/api"

# Existing routes
app.include_router(requirements.router, prefix=API_PREFIX)
app.include_router(test_cases.router, prefix=API_PREFIX)
app.include_router(test_execution.router, prefix=API_PREFIX)
app.include_router(synthetic_data.router, prefix=API_PREFIX)
app.include_router(prioritization.router, prefix=API_PREFIX)
app.include_router(dashboard.router, prefix=API_PREFIX)
app.include_router(repo_analysis.router, prefix=API_PREFIX)

# New SDLC Intelligence routes
app.include_router(github.router, prefix=API_PREFIX)
app.include_router(jira.router, prefix=API_PREFIX)
app.include_router(ci_intelligence.router, prefix=API_PREFIX)
app.include_router(defect_prediction.router, prefix=API_PREFIX)
app.include_router(release_gate.router, prefix=API_PREFIX)
app.include_router(monitoring.router, prefix=API_PREFIX)
app.include_router(incidents.router, prefix=API_PREFIX)
app.include_router(sprint.router, prefix=API_PREFIX)

# AI Workspace routes
app.include_router(workspace.router, prefix=API_PREFIX)
app.include_router(copilot.router, prefix=API_PREFIX)
app.include_router(git_ops.router, prefix=API_PREFIX)
app.include_router(commit.router, prefix=API_PREFIX)
app.include_router(coverage.router, prefix=API_PREFIX)
app.include_router(test_gen.router, prefix=API_PREFIX)
app.include_router(pipeline.router, prefix=API_PREFIX)
app.include_router(deployments.router, prefix=API_PREFIX)

# Code Impact + Test Intelligence routes (Flow 1 & 2)
app.include_router(impact.router, prefix=API_PREFIX)

# AI Root Cause Analysis
app.include_router(root_cause.router, prefix=API_PREFIX)
# Intelligent Test Selection & Optimization
app.include_router(test_selection.router, prefix=API_PREFIX)
# Self-Healing Tests
app.include_router(healing.router, prefix=API_PREFIX)

# PRD Generator
app.include_router(prd.router, prefix=API_PREFIX)

# API Cost Logs (hidden admin route)
app.include_router(cost_logs.router, prefix=API_PREFIX)

# AI IDE streaming code generation workspace
app.include_router(ai_ide.router, prefix=API_PREFIX)

# Repo Baseline smart categorised test generation with incremental diff
app.include_router(baseline_router.router, prefix=API_PREFIX)

# Auth routes
app.include_router(auth_router.router, prefix=API_PREFIX)

# Webhook routes
app.include_router(webhooks_router.router, prefix=API_PREFIX)

# Organizations routes
app.include_router(organizations_router.router, prefix=API_PREFIX)

# Activity / search / repo-probe history (server-side, org-scoped)
app.include_router(activity_router.router, prefix=API_PREFIX)


@app.get("/api", tags=["Health"])
async def api_root():
    return {"status": "ok", "service": "Chakram API", "version": "2.0.0"}


@app.get("/health", tags=["Health"])
async def health():
    """Liveness process is up (Azure probe). Touches no dependency."""
    return {"status": "healthy"}


async def _ready_context(request: Request) -> tuple[str, dict | None]:
    """("org" | "server", org connectors) for the caller, from its session cookie if it has one."""
    from app.auth.session import COOKIE_NAME, decode_session_cookie
    from app.services import connector_settings_service as connectors

    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return "server", None
    try:
        org = await organization_service.get_by_id(get_db(), decode_session_cookie(token)["org_id"])
        if org is None:
            return "server", None
        raw = await connectors.get_raw(get_db(), org.id)
        return "org", {**raw, connectors._PLATFORM_KEY: connectors.is_platform_org(org)}
    except Exception:
        return "server", None


@app.get("/readyz", include_in_schema=False)
async def readyz():
    """Readiness for the platform probe: the database answers. No outbound calls."""
    try:
        await get_db().command("ping")
    except Exception as exc:
        logger.warning("readyz mongo ping failed: %s", exc)
        return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content={"status": "not_ready"})
    return {"status": "ready"}


@app.get("/ready", tags=["Health"])
@app.get("/api/ready", tags=["Health"])  # same answer where only /api is proxied to the backend
async def ready(request: Request):
    """Readiness for clients.

    `checks.mongo` must be true for 200; otherwise 503 `not_ready`. `checks.llm`
    reports whether the LLM provider answered (true/false); the app is degraded,
    not down, without it, so it does not change the status code. `integrations`
    says which optional integrations are configured for the caller: the signed-in
    organisation when the request carries a session, else the server defaults.
    Booleans only, never a secret. No browser is launched here.
    """
    from app.services import connector_settings_service as connectors

    checks: dict = {"mongo": False, "llm": None, "ollama": None}
    try:
        await get_db().command("ping")
        checks["mongo"] = True
    except Exception as exc:
        logger.warning("ready mongo ping failed: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "not_ready", "checks": checks, "detail": "MongoDB did not answer."},
        )

    context, org_connectors = await _ready_context(request)

    def resolved(name: str) -> dict[str, str]:
        return connectors.resolve(org_connectors, name)

    llm = resolved("ollama")
    llm_error = None
    try:
        base = (llm.get("base_url") or "").rstrip("/")
        headers = {"Authorization": f"Bearer {llm['api_key']}"} if llm.get("api_key") else {}
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{base}/api/tags", headers=headers)
        checks["llm"] = r.status_code < 400
        if not checks["llm"]:
            llm_error = f"LLM provider returned HTTP {r.status_code}"
    except Exception as exc:
        checks["llm"] = False
        llm_error = f"LLM provider could not be reached: {type(exc).__name__}"
    checks["ollama"] = checks["llm"]  # earlier name of the same check

    jira = resolved("jira")
    vercel = resolved("vercel")
    datadog = resolved("datadog")
    integrations = {
        "github": bool(resolved("github").get("token")),
        "jira": all((jira.get(k) or "").strip() for k in ("domain", "email", "token")),
        "vercel": bool(vercel.get("token")),
        "slack": bool(resolved("slack").get("webhook_url")),
        "datadog": bool(datadog.get("api_key")),
    }

    return {
        "status": "ready",
        "checks": checks,
        "llm": {"reachable": checks["llm"], "model": llm.get("model") or None, "error": llm_error},
        "integrations": integrations,
        "integrations_context": context,
    }


# Serve built SPA (Azure unified container). API routes take precedence above.
if STATIC_DIR.is_dir():
    assets = STATIC_DIR / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/", include_in_schema=False)
    async def spa_index():
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        if full_path.startswith("api/") or full_path in {"health", "ready", "docs", "openapi.json", "redoc"}:
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        # Resolve before serving so "../" segments cannot reach files outside static/.
        candidate = (STATIC_DIR / full_path).resolve()
        if candidate.is_relative_to(STATIC_DIR) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
else:

    @app.get("/", tags=["Health"])
    async def root_no_spa():
        return {"status": "ok", "service": "Chakram API", "version": "2.0.0", "spa": False}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
