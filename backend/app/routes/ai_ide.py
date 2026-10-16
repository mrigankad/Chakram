"""AI IDE routes workspace creation (REST) + streaming generation (WebSocket)."""
import asyncio
from datetime import datetime
import io
import json
import re
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel

from app.config import settings
from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import ai_ide_generation
from app.services import ai_ide_service
from app.services import ai_service
from app.services import connector_settings_service as connectors
from app.services import design_pack_service
from app.services import marks_service
from app.services import organization_service
from app.services import vercel_service
from app.services.workspace_service import WorkspaceExpiredError

router = APIRouter(prefix="/ai-ide", tags=["AI IDE"])


async def _attach_workspace(
    request: Request,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
) -> None:
    """Load the request's workspace from the registry; 410 when its files are gone."""
    workspace_id = request.path_params.get("workspace_id")
    if not workspace_id:
        try:
            body = await request.json()
        except ValueError:
            body = None
        workspace_id = body.get("workspace_id") if isinstance(body, dict) else None
    if isinstance(workspace_id, str) and workspace_id:
        await ai_ide_service.attach(db, org.id, workspace_id)


def _require_org_workspace(org: OrganizationOut, workspace_id: str) -> None:
    try:
        ai_ide_service.require_org_workspace(org.id, workspace_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")


class CreateFileRequest(BaseModel):
    workspace_id: str
    path: str
    content: str = ""


class UpdateFileRequest(BaseModel):
    workspace_id: str
    path: str
    content: str


class DeletePathRequest(BaseModel):
    workspace_id: str
    path: str


class RenamePathRequest(BaseModel):
    workspace_id: str
    from_path: str
    to_path: str


class MovePathRequest(BaseModel):
    workspace_id: str
    from_path: str
    to_path: str


class GitInitPushRequest(BaseModel):
    workspace_id: str
    github_token: str
    repo_name: str
    private: bool = True
    description: str = ""
    branch: str = "main"


class GitCommitPushRequest(BaseModel):
    workspace_id: str
    message: str = "chore: update AI IDE workspace"
    branch: str | None = None
    # The server keeps tokens in memory only; the client sends it again after a restart.
    github_token: str | None = None


class DeployWorkspaceRequest(BaseModel):
    workspace_id: str
    branch: str | None = None
    target: str = "production"


# ── REST ─────────────────────────────────────────────────────────────────────

@router.get("/marks")
async def list_marks(q: str = "", limit: int = 60, org: OrganizationOut = Depends(get_current_org)):
    """3D icons for the icon picker: the best matches for `q`, or a general selection."""
    limit = max(1, min(limit, 200))
    rows = marks_service.relevant_marks(q, limit) if q.strip() else marks_service.manifest()[:limit]
    return {
        "marks": [
            {"id": r.get("id"), "hint": r.get("hint", ""), "category": r.get("category", "")}
            for r in rows
            if isinstance(r, dict) and r.get("id")
        ],
        "total": len(marks_service.manifest()),
    }


@router.get("/workspaces")
async def list_workspaces(org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    """Every app this organisation has built, newest first."""
    return {"apps": await ai_ide_service.list_apps(db, org.id)}


@router.delete("/workspace/{workspace_id}")
async def delete_workspace(workspace_id: str, org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    """Delete an app: its stored files, disk copy and registry entry. Its GitHub repository is kept."""
    run = ai_ide_generation.get(workspace_id)
    if run is not None and not run.finished:
        raise HTTPException(status_code=409, detail="This app is still being generated. Delete it once the build ends.")
    if not await ai_ide_service.delete_app(db, org.id, workspace_id):
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {"ok": True}


class CreateWorkspaceRequest(BaseModel):
    pack_id: str | None = None


@router.post("/workspace/create")
async def create_workspace(
    payload: CreateWorkspaceRequest | None = None,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    pack_id = payload.pack_id if payload else None
    try:
        workspace_id = await ai_ide_service.create_workspace(org.id, db=db, pack_id=pack_id)
    except design_pack_service.PackError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    files = ai_ide_service.list_file_paths(workspace_id)
    meta = ai_ide_service.require_org_workspace(org.id, workspace_id)
    return {"workspace_id": workspace_id, "file_paths": files, "pack_id": meta.get("pack_id")}


# ── Verify a built app ───────────────────────────────────────────────────────

@router.post("/workspace/{workspace_id}/test-cases", dependencies=[Depends(_attach_workspace)])
async def create_test_cases_for_app(
    workspace_id: str,
    refresh: bool = False,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Acceptance cases for a composed app, derived from its spec (no model call).

    Creates one requirement per app (reused on later calls unless `refresh`) with
    the cases the Test Suite and Test Execution pages already understand.
    """
    import json as _json

    from app.engines import spec_tests
    from app.engines.spec import SpecError, normalize_spec
    from app.services import test_case_service

    _require_org_workspace(org, workspace_id)
    files = ai_ide_service.get_workspace_files(workspace_id)
    raw = files.get("app.spec.json")
    if not raw:
        raise HTTPException(status_code=409, detail="This app was not built from a spec, so test cases cannot be derived; use Requirements instead.")
    try:
        spec = normalize_spec(_json.loads(raw))
    except (ValueError, SpecError) as exc:
        raise HTTPException(status_code=409, detail=f"app.spec.json is not usable: {exc}") from exc
    rows: dict = {}
    try:
        rows = _json.loads(files.get("api/src/seed.json") or "{}")
    except ValueError:
        rows = {}

    existing = await db.requirements.find_one({"org_id": org.id, "workspace_id": workspace_id})
    if existing is not None and not refresh:
        count = await db.test_cases.count_documents({"org_id": org.id, "requirement_id": str(existing["_id"])})
        return {"requirement_id": str(existing["_id"]), "test_cases": count, "created": False}

    cases = spec_tests.test_cases_from_spec(spec, rows if isinstance(rows, dict) else {})
    if existing is not None:
        requirement_id = str(existing["_id"])
        await db.test_cases.delete_many({"org_id": org.id, "requirement_id": requirement_id})
        await db.requirements.update_one({"_id": existing["_id"]}, {"$set": {"text": spec_tests.requirement_text(spec), "status": "processed"}})
    else:
        result = await db.requirements.insert_one({
            "org_id": org.id,
            "text": spec_tests.requirement_text(spec),
            "created_at": datetime.utcnow(),
            "status": "processed",
            "source": "app_studio",
            "workspace_id": workspace_id,
        })
        requirement_id = str(result.inserted_id)
    stored = await test_case_service.create_test_cases_from_ai(db, org.id, requirement_id, cases)
    return {"requirement_id": requirement_id, "test_cases": stored, "created": existing is None}


# ── Design packs ─────────────────────────────────────────────────────────────

@router.get("/design-packs")
async def list_design_packs(org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    return await design_pack_service.list_packs(db, org.id)


@router.post("/design-packs")
async def upload_design_pack(
    file: UploadFile = File(...),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    data = await file.read(design_pack_service.MAX_ZIP_BYTES + 1)
    if len(data) > design_pack_service.MAX_ZIP_BYTES:
        raise HTTPException(status_code=413, detail=f"The zip is larger than {design_pack_service.MAX_ZIP_BYTES // 1000} KB.")
    try:
        files = design_pack_service.files_from_zip(data)
        pack, warnings = await design_pack_service.save_org_pack(db, org.id, files)
    except design_pack_service.PackError as exc:
        raise HTTPException(status_code=422, detail=f"Design pack rejected: {exc}") from exc
    return {"pack": pack, "warnings": warnings}


@router.post("/design-packs/{pack_id}/default")
async def set_default_design_pack(pack_id: str, org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    try:
        default_id = await design_pack_service.set_org_default(db, org.id, pack_id)
    except design_pack_service.PackError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "default_id": default_id}


@router.delete("/design-packs/{pack_id}")
async def delete_design_pack(pack_id: str, org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    if pack_id in design_pack_service.builtin_packs():
        raise HTTPException(status_code=404, detail="Builtin design packs cannot be deleted.")
    if not await design_pack_service.delete_org_pack(db, org.id, pack_id):
        raise HTTPException(status_code=404, detail=f"No design pack '{pack_id}' for this organization.")
    return {"ok": True}


@router.get("/workspace/{workspace_id}/files", dependencies=[Depends(_attach_workspace)])
async def get_files(workspace_id: str, org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    _require_org_workspace(org, workspace_id)
    # Apps from before files were stored in the database are saved on first open.
    await ai_ide_service.ensure_stored(db, workspace_id)
    # Opening an app built with an older kit picks up the kit's fixes.
    ai_ide_service.upgrade_kit(workspace_id)
    return ai_ide_service.get_workspace_files(workspace_id)


@router.post("/file/create", dependencies=[Depends(_attach_workspace)])
async def create_file(payload: CreateFileRequest, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, payload.workspace_id)
    # An empty new file stays empty: nothing is written that the user did not provide.
    ai_ide_service.create_file(payload.workspace_id, payload.path, payload.content)
    return {"ok": True, "path": payload.path, "content": payload.content}


@router.post("/file/update", dependencies=[Depends(_attach_workspace)])
async def update_file(payload: UpdateFileRequest, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, payload.workspace_id)
    ai_ide_service.save_file(payload.workspace_id, payload.path, payload.content)
    return {"ok": True, "path": payload.path}


@router.post("/file/delete", dependencies=[Depends(_attach_workspace)])
async def delete_file(payload: DeletePathRequest, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, payload.workspace_id)
    deleted = ai_ide_service.delete_path(payload.workspace_id, payload.path)
    return {"ok": True, "deleted": deleted}


@router.post("/file/rename", dependencies=[Depends(_attach_workspace)])
async def rename_path(payload: RenamePathRequest, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, payload.workspace_id)
    updated = ai_ide_service.rename_or_move_path(
        payload.workspace_id,
        payload.from_path,
        payload.to_path,
    )
    return {"ok": True, "updated": updated}


@router.post("/file/move", dependencies=[Depends(_attach_workspace)])
async def move_path(payload: MovePathRequest, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, payload.workspace_id)
    updated = ai_ide_service.rename_or_move_path(
        payload.workspace_id,
        payload.from_path,
        payload.to_path,
    )
    return {"ok": True, "updated": updated}


@router.post("/git/init-and-push", dependencies=[Depends(_attach_workspace)])
async def ai_ide_git_init_and_push(
    payload: GitInitPushRequest,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    _require_org_workspace(org, payload.workspace_id)
    try:
        result = await ai_ide_service.init_git_and_create_repo(
            workspace_id=payload.workspace_id,
            github_token=payload.github_token,
            repo_name=payload.repo_name,
            private=payload.private,
            description=payload.description,
            branch=payload.branch,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await ai_ide_service.register(db, payload.workspace_id)
    return result


@router.post("/git/commit-and-push", dependencies=[Depends(_attach_workspace)])
async def ai_ide_git_commit_and_push(
    payload: GitCommitPushRequest,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    _require_org_workspace(org, payload.workspace_id)
    try:
        result = await ai_ide_service.commit_and_push_workspace(
            workspace_id=payload.workspace_id,
            message=payload.message,
            branch=payload.branch,
            github_token=payload.github_token,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await ai_ide_service.register(db, payload.workspace_id)
    return result


@router.post("/deploy", dependencies=[Depends(_attach_workspace)])
async def ai_ide_deploy(payload: DeployWorkspaceRequest, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, payload.workspace_id)
    meta = ai_ide_service.get_workspace_meta(payload.workspace_id)
    repo_url = meta.get("repo_url")
    if not repo_url:
        raise HTTPException(status_code=400, detail="Initialize and push repository before deploying")

    branch = (payload.branch or meta.get("default_branch") or "main").strip() or "main"
    return await vercel_service.trigger_deployment(
        branch=branch,
        repo_url=repo_url,
        commit_sha=None,
        target=payload.target,
        # Known from repository creation, so a private repo needs no second GitHub lookup.
        repo_id=meta.get("repo_id"),
    )


@router.get("/workspace/{workspace_id}/repo", dependencies=[Depends(_attach_workspace)])
async def get_workspace_repo(workspace_id: str, org: OrganizationOut = Depends(get_current_org)):
    """The GitHub repository this workspace pushes to, if any (never the token)."""
    _require_org_workspace(org, workspace_id)
    meta = ai_ide_service.get_workspace_meta(workspace_id)
    return {
        "repo_url": meta.get("repo_url"),
        "html_url": meta.get("repo_html_url"),
        "repo_name": meta.get("repo_name"),
        "branch": meta.get("default_branch") or "main",
        "can_push": bool(meta.get("github_token")),
    }


_ZIP_SKIP_FILES = {"_meta.json"}
_ZIP_SKIP_DIRS = {".git", "node_modules", "dist"}


def _app_slug(files: dict[str, str]) -> str:
    """Slug of package.json's name, or 'chakram-app' when there is none."""
    try:
        name = json.loads(files.get("package.json", "")).get("name")
    except (ValueError, AttributeError):
        name = None
    if isinstance(name, str):
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        if slug:
            return slug
    return "chakram-app"


def _build_workspace_zip(files: dict[str, str]) -> tuple[str, bytes]:
    slug = _app_slug(files)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel, content in files.items():
            rel = rel.replace("\\", "/").lstrip("/")
            parts = rel.split("/")
            if not rel or rel in _ZIP_SKIP_FILES or ".." in parts or _ZIP_SKIP_DIRS.intersection(parts):
                continue
            zf.writestr(f"{slug}/{rel}", content)
        for mark_id in marks_service.used_marks(files):
            data = marks_service.mark_bytes(mark_id)
            if data is not None:
                zf.writestr(f"{slug}/public/marks/{mark_id}.png", data)
        if not any(k.lower() == "readme.md" for k in files):
            zf.writestr(
                f"{slug}/README.md",
                f"# {slug}\n"
                "Install dependencies: npm install\n"
                "Start the dev server: npm run dev\n"
                "Build for production: npm run build\n",
            )
    return slug, buf.getvalue()


@router.get("/workspace/{workspace_id}/download", dependencies=[Depends(_attach_workspace)])
async def download_workspace(workspace_id: str, org: OrganizationOut = Depends(get_current_org)):
    """The workspace's generated project as a zip, under a folder named after the app."""
    _require_org_workspace(org, workspace_id)
    files = ai_ide_service.get_workspace_files(workspace_id)
    slug, data = await asyncio.to_thread(_build_workspace_zip, files)
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{slug}.zip"'},
    )


# ── WebSocket ─────────────────────────────────────────────────────────────────

def _ws_session_payload(ws: WebSocket) -> dict | None:
    """Read and verify the session cookie. Does not touch the socket state."""
    import jwt
    from app.auth.session import COOKIE_NAME, decode_session_cookie

    token = ws.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        return decode_session_cookie(token)
    except jwt.InvalidTokenError:
        return None


def _ws_origin_allowed(ws: WebSocket) -> bool:
    """Browsers send the session cookie on cross-site WebSocket handshakes, so check who is asking.

    Allowed: the app's own origin (same host as the request), FRONTEND_URL and CORS_ORIGINS.
    A client that sends no Origin header (not a browser) still needs a valid session cookie.
    """
    origin = (ws.headers.get("origin") or "").rstrip("/").lower()
    if not origin:
        return True
    host = (ws.headers.get("host") or "").lower()
    if host and origin.split("://", 1)[-1] == host:
        return True
    allowed = {o.rstrip("/").lower() for o in settings.CORS_ORIGINS}
    if settings.FRONTEND_URL:
        allowed.add(settings.FRONTEND_URL.rstrip("/").lower())
    return origin in allowed


@router.websocket("/ws/generate/{workspace_id}")
async def generate(ws: WebSocket, workspace_id: str):
    """
    Protocol:
      client → server : first message is either
                        - the plain text idea: starts a generation run, or
                        - {"attach": true}: re-attaches to the workspace's run
      server → client : typed JSON events (see WSEvent schema below)

    Events:
      {"type": "STATUS",         "message": str}
      {"type": "PLAN",           "app_name": str, "description": str,
                                  "files": [str], "routes": [{"path", "component", "importPath"}]}
      {"type": "FILE_CREATE",    "path": str}
      {"type": "STREAM_TOKEN",   "path": str, "token": str}
      {"type": "FILE_DONE",      "path": str}
      {"type": "FILE_ERROR",     "path": str, "message": str}
      {"type": "FILE_UPDATE",    "path": str, "content": str}
      {"type": "GENERATION_DONE", "files_total": int, "files_generated": int,
                                  "files_failed": int, "failed_files": [{"path", "message"}]}
      {"type": "NO_RUN"}         (attach only: there is nothing to attach to)
      {"type": "ERROR",          "message": str}

    FILE_ERROR means that file was not generated and nothing was written for
    it; generation continues with the next file. ERROR ends the generation.

    The run itself is a server-side task (ai_ide_generation): closing this
    socket does not stop it, and a client that attaches later first receives
    the plan, the files written so far and the file streaming now. PLAN lists
    every file that will be written, so the client can show them as pending.
    App.tsx is re-wired (FILE_UPDATE) each time a routed page finishes.
    """
    # Accept first (ASGI-safe), then enforce session via cookie.
    await ws.accept()
    if not _ws_origin_allowed(ws):
        await ws.send_json({"type": "ERROR", "message": "This page is not allowed to open the generation channel"})
        await ws.close(code=1008)
        return
    payload = _ws_session_payload(ws)
    org_id = payload.get("org_id") if payload else None
    if not org_id:
        await ws.send_json({"type": "ERROR", "message": "Not authenticated"})
        await ws.close(code=1008)
        return

    # Same per-org context get_current_org sets for HTTP requests, so the org's
    # own model/key is used and usage is attributed to it. The run task inherits it.
    org_token = None
    conn_token = None
    queue = None
    run = None
    try:
        db = get_db()
        org = await organization_service.get_by_id(db, org_id)
        if org is None:
            await ws.send_json({"type": "ERROR", "message": "Organization not yet provisioned"})
            await ws.close(code=1008)
            return
        org_token = ai_service.set_current_org_id(org.id)
        raw_connectors = await connectors.get_raw(db, org.id)
        conn_token = connectors.set_current_org_connectors(
            raw_connectors, platform=connectors.is_platform_org(org)
        )

        try:
            await ai_ide_service.attach(db, org_id, workspace_id)
            ai_ide_service.require_org_workspace(org_id, workspace_id)
        except WorkspaceExpiredError as exc:
            await ws.send_json({"type": "ERROR", "message": str(exc)})
            await ws.close(code=4010)
            return
        except KeyError:
            await ws.send_json({"type": "ERROR", "message": "Workspace not found"})
            await ws.close(code=4004)
            return

        first = await ws.receive_text()
        attach_request = False
        try:
            parsed = json.loads(first)
            attach_request = isinstance(parsed, dict) and bool(parsed.get("attach"))
        except ValueError:
            parsed = None

        run = ai_ide_generation.get(workspace_id)
        if attach_request:
            if run is None:
                await ws.send_json({"type": "NO_RUN"})
                return
        else:
            idea = first.strip()
            if not idea:
                await ws.send_json({"type": "ERROR", "message": "Empty idea"})
                return
            if run is not None and not run.finished:
                # A reload while the app was being built: follow the run already going.
                await ws.send_json({"type": "STATUS", "message": "Reconnected to the generation already running"})
            else:
                run = ai_ide_generation.start(workspace_id, org_id, idea)

        queue = run.subscribe()
        while True:
            event = await queue.get()
            await ws.send_json(event)
            if event.get("type") in ("GENERATION_DONE", "ERROR"):
                break

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await ws.send_json({"type": "ERROR", "message": str(exc)})
        except Exception:
            pass
    finally:
        if run is not None and queue is not None:
            run.unsubscribe(queue)
        if conn_token is not None:
            connectors.reset_current_org_connectors(conn_token)
        if org_token is not None:
            ai_service.reset_current_org_id(org_token)
