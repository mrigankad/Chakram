"""The connector registry: what each integration is for, what it feeds, and how to check it.

One place answers "which connectors exist, which features need them, which
API version we talk to, and is the saved credential actually working". The
Settings page, the sidebar gating and the readiness endpoint read from here
instead of each keeping its own list.

A connector's `check` is a harmless read against the service with the
resolved credentials. It never writes, and the result (ok, message, time) is
stored on the organization so the UI can show it without probing on every
page load.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

import httpx
from bson import ObjectId

from app.services import connector_settings_service as connectors

logger = logging.getLogger(__name__)

CHECK_TIMEOUT = 8.0
CHECKS_FIELD = "connector_checks"


@dataclass(frozen=True)
class Feed:
    id: str
    label: str


@dataclass(frozen=True)
class Connector:
    id: str
    name: str
    kind: str  # model | source | deploy | tracker | notify
    secret_fields: tuple[str, ...]
    required: tuple[str, ...]  # fields that must be set for "configured"
    feeds: tuple[Feed, ...]
    api_version: str
    check: Callable[[dict[str, str]], Awaitable[tuple[bool, str]]]
    notes: str = ""


class CheckResult(dict):
    """{ok, message, checked_at}"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── probes (read-only) ──────────────────────────────────────────────────────

async def _check_github(cfg: dict[str, str]) -> tuple[bool, str]:
    token = cfg.get("token", "")
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=CHECK_TIMEOUT) as client:
        resp = await client.get("https://api.github.com/rate_limit", headers=headers)
    if resp.status_code == 401:
        return False, "GitHub rejected the token (401)."
    if resp.status_code >= 400:
        return False, f"GitHub answered {resp.status_code}."
    core = (resp.json().get("resources") or {}).get("core") or {}
    limit = core.get("limit")
    if not token:
        return True, f"No token: public repositories only, {limit or 60} requests/hour shared."
    return True, f"Token accepted; {core.get('remaining', '?')} of {limit} requests left this hour."


async def _check_jira(cfg: dict[str, str]) -> tuple[bool, str]:
    domain, email, token = cfg.get("domain", ""), cfg.get("email", ""), cfg.get("token", "")
    if not (domain and email and token):
        return False, "Domain, email and API token are all required."
    base = domain if domain.startswith("http") else f"https://{domain}"
    async with httpx.AsyncClient(timeout=CHECK_TIMEOUT, auth=(email, token)) as client:
        resp = await client.get(f"{base.rstrip('/')}/rest/api/3/myself", headers={"Accept": "application/json"})
    if resp.status_code in (401, 403):
        return False, f"Jira rejected the credentials ({resp.status_code})."
    if resp.status_code >= 400:
        return False, f"Jira answered {resp.status_code}."
    name = (resp.json() or {}).get("displayName") or email
    return True, f"Signed in to Jira as {name}."


async def _check_vercel(cfg: dict[str, str]) -> tuple[bool, str]:
    token = cfg.get("token", "")
    if not token:
        return False, "A Vercel token is required."
    params = {"teamId": cfg["team_id"]} if cfg.get("team_id") else {}
    async with httpx.AsyncClient(timeout=CHECK_TIMEOUT) as client:
        resp = await client.get("https://api.vercel.com/v2/user", headers={"Authorization": f"Bearer {token}"}, params=params)
    if resp.status_code in (401, 403):
        return False, f"Vercel rejected the token ({resp.status_code})."
    if resp.status_code >= 400:
        return False, f"Vercel answered {resp.status_code}."
    user = (resp.json() or {}).get("user") or {}
    return True, f"Token accepted for {user.get('username') or user.get('email') or 'the account'}."


async def _check_ollama(cfg: dict[str, str]) -> tuple[bool, str]:
    base = (cfg.get("base_url") or "").rstrip("/")
    if not base:
        return False, "A base URL is required."
    headers = {"Authorization": f"Bearer {cfg['api_key']}"} if cfg.get("api_key") else {}
    async with httpx.AsyncClient(timeout=CHECK_TIMEOUT) as client:
        resp = await client.get(f"{base}/api/tags", headers=headers)
    if resp.status_code in (401, 403):
        return False, f"The model endpoint rejected the key ({resp.status_code})."
    if resp.status_code >= 400:
        return False, f"The model endpoint answered {resp.status_code}."
    models = [m.get("name") for m in (resp.json() or {}).get("models") or [] if isinstance(m, dict)]
    wanted = cfg.get("model") or ""
    if wanted and models and not any(str(m).startswith(wanted.split(":")[0]) for m in models):
        return True, f"Reachable, but '{wanted}' is not in the endpoint's model list ({len(models)} models)."
    return True, f"Reachable; {len(models)} model(s) listed." if models else "Reachable."


async def _check_slack(cfg: dict[str, str]) -> tuple[bool, str]:
    url = cfg.get("webhook_url", "")
    if not url:
        return False, "A webhook URL is required."
    if not re.match(r"^https://hooks\.slack\.com/services/[A-Za-z0-9/]+$", url):
        return False, "That does not look like a Slack incoming-webhook URL (https://hooks.slack.com/services/…)."
    # An incoming webhook has no read endpoint; posting would notify the channel, so only the shape is checked.
    return True, "Webhook URL has the expected shape (a real post happens on the first notification)."


# ── registry ────────────────────────────────────────────────────────────────

REGISTRY: dict[str, Connector] = {
    "ollama": Connector(
        id="ollama", name="Model (Ollama)", kind="model",
        secret_fields=("api_key",), required=("base_url",),
        feeds=(Feed("app-studio", "App Studio"), Feed("test-generation", "Test generation"), Feed("code-review", "Code review"), Feed("narratives", "AI summaries")),
        api_version="Ollama OpenAI-compatible /v1",
        check=_check_ollama,
        notes="Shared with every organization; the product's own model.",
    ),
    "github": Connector(
        id="github", name="GitHub", kind="source",
        secret_fields=("token",), required=(),
        feeds=(Feed("code-review", "Code review"), Feed("workspace", "Code workspace"), Feed("app-studio-push", "App Studio push"), Feed("ci-health", "CI health"), Feed("hotspots", "Change hotspots")),
        api_version="REST 2022-11-28",
        check=_check_github,
        notes="Without a token: public repositories only, 60 requests/hour shared.",
    ),
    "vercel": Connector(
        id="vercel", name="Vercel", kind="deploy",
        secret_fields=("token",), required=("token",),
        feeds=(Feed("deploy", "Deployments"), Feed("app-studio-deploy", "App Studio deploy")),
        api_version="v13 deployments",
        check=_check_vercel,
    ),
    "jira": Connector(
        id="jira", name="Jira", kind="tracker",
        secret_fields=("token",), required=("domain", "email", "token"),
        feeds=(Feed("requirements-import", "Import stories as requirements"), Feed("jira-writeback", "Acceptance criteria and test results written back"), Feed("release-gate", "Release gate: open bugs (optional)")),
        api_version="REST v3",
        check=_check_jira,
        notes="Reads stories and bugs, writes acceptance criteria as comments. Sprint analytics were retired.",
    ),
    "slack": Connector(
        id="slack", name="Slack", kind="notify",
        secret_fields=("webhook_url",), required=("webhook_url",),
        feeds=(Feed("notifications", "Notifications: release blocked, incidents"),),
        api_version="Incoming webhooks",
        check=_check_slack,
    ),
}

ORDER = ("ollama", "github", "vercel", "jira", "slack")


def is_configured(connector: Connector, cfg: dict[str, str]) -> bool:
    required = connector.required or connector.secret_fields
    return all(bool(cfg.get(f)) for f in required)


def feeds_for(connector_id: str) -> list[dict[str, str]]:
    c = REGISTRY.get(connector_id)
    return [{"id": f.id, "label": f.label} for f in c.feeds] if c else []


def _source(raw: dict[str, Any], connector: Connector, cfg: dict[str, str]) -> str | None:
    org = raw.get(connector.id) or {}
    fields = connector.required or connector.secret_fields
    if any(isinstance(org.get(f), str) and org.get(f, "").strip() for f in fields):
        return "org"
    return "env" if is_configured(connector, cfg) else None


async def status(db, org, raw: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """One row per connector for the organization: configured, source, feeds, last check."""
    raw = raw if raw is not None else await connectors.get_raw(db, org.id)
    platform = connectors.is_platform_org(org)
    checks = await _stored_checks(db, org.id)
    rows = []
    for cid in ORDER:
        c = REGISTRY[cid]
        cfg = connectors.resolve({**raw, connectors._PLATFORM_KEY: platform}, cid)
        rows.append({
            "id": cid,
            "name": c.name,
            "kind": c.kind,
            "configured": is_configured(c, cfg),
            "source": _source(raw, c, cfg),
            "feeds": feeds_for(cid),
            "api_version": c.api_version,
            "notes": c.notes,
            "last_check": checks.get(cid),
        })
    return rows


async def _stored_checks(db, org_id: str) -> dict[str, Any]:
    if not ObjectId.is_valid(org_id):
        return {}
    doc = await db.organizations.find_one({"_id": ObjectId(org_id)}, {CHECKS_FIELD: 1})
    return (doc or {}).get(CHECKS_FIELD) or {}


async def run_check(db, org, connector_id: str) -> dict[str, Any]:
    """Probe the service with the resolved credentials and store the result on the org."""
    c = REGISTRY.get(connector_id)
    if c is None:
        raise KeyError(connector_id)
    raw = await connectors.get_raw(db, org.id)
    cfg = connectors.resolve({**raw, connectors._PLATFORM_KEY: connectors.is_platform_org(org)}, connector_id)
    if not is_configured(c, cfg):
        result = {"ok": False, "message": "Not configured.", "checked_at": _now()}
    else:
        try:
            ok, message = await c.check(cfg)
        except httpx.TimeoutException:
            ok, message = False, f"{c.name} did not answer within {int(CHECK_TIMEOUT)}s."
        except httpx.HTTPError as exc:
            ok, message = False, f"Could not reach {c.name}: {exc.__class__.__name__}."
        except Exception as exc:  # noqa: BLE001 - a probe must never 500
            logger.exception("connector check failed for %s", connector_id)
            ok, message = False, f"Check failed: {exc.__class__.__name__}."
        result = {"ok": ok, "message": message, "checked_at": _now()}
    if ObjectId.is_valid(org.id):
        await db.organizations.update_one({"_id": ObjectId(org.id)}, {"$set": {f"{CHECKS_FIELD}.{connector_id}": result}})
    return result
