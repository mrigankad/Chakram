"""AI IDE workspace service: files on disk, registry in MongoDB, git utilities.

`ai_ide_workspaces` records who owns each workspace and where its files are, so
a workspace survives a restart and is found by any worker. The in-memory dicts
are the per-process cache. GitHub tokens are held in memory only.
"""
import asyncio
import base64
import json
import logging
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

import git
import httpx

from app.services import marks_service
from app.services.template_service import get_template
from app.services.workspace_service import WorkspaceExpiredError

logger = logging.getLogger(__name__)

REGISTRY = "ai_ide_workspaces"
# Every workspace text file, one document per file (`_id` = "<workspace_id>:<path>").
# The disk copy is a cache; this collection is what survives restarts and redeploys.
FILES = "ai_ide_files"

_workspaces: Dict[str, Dict[str, str]] = {}
_workspace_meta: Dict[str, Dict[str, Any]] = {}
_template_cache: Dict[str, str] | None = None
_ai_ide_root = Path(os.getenv("AI_IDE_WORKSPACE_DIR") or str(Path(tempfile.gettempdir()) / "ai-ide-workspaces"))
_SKIP_DISK_DIRS = {".git", "node_modules", "__pycache__", ".venv", "dist", "build"}
# Binary assets (marks, images, fonts) are not source; they are never loaded as text.
_BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".glb", ".woff", ".woff2"}


async def _get_template_cached() -> Dict[str, str]:
    global _template_cache
    if _template_cache is None:
        _template_cache = await get_template()
    return _template_cache


def _ensure_workspace_root() -> None:
    _ai_ide_root.mkdir(parents=True, exist_ok=True)


class WorkspacePathError(ValueError):
    """A path the user gave cannot be used in the workspace (mapped to HTTP 400)."""


class GitPushError(ValueError):
    """Pushing to GitHub failed; the message is safe to show (no credentials)."""


def _safe_abs_path(workspace_root: Path, rel_path: str) -> Path:
    normalized = rel_path.strip().lstrip("/")
    abs_path = (workspace_root / normalized).resolve()
    workspace_resolved = workspace_root.resolve()
    if abs_path != workspace_resolved and not abs_path.is_relative_to(workspace_resolved):
        raise WorkspacePathError("The path points outside the workspace")
    return abs_path


def _require_entry_path(workspace_root: Path, rel_path: str) -> Path:
    """A file or folder inside the workspace: never the workspace root itself."""
    abs_path = _safe_abs_path(workspace_root, rel_path)
    if abs_path == workspace_root.resolve():
        raise WorkspacePathError("A file or folder path is required")
    return abs_path


def _write_workspace_files_to_disk(workspace_id: str) -> None:
    meta = _workspace_meta[workspace_id]
    root = Path(meta["root_dir"])
    root.mkdir(parents=True, exist_ok=True)
    for rel_path, content in _workspaces[workspace_id].items():
        abs_path = _safe_abs_path(root, rel_path)
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_text(content, encoding="utf-8")


def _github_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _repo_name_valid(name: str) -> bool:
    return bool(re.match(r"^[A-Za-z0-9._-]{1,100}$", name))


def _update_package_json_generated_files(workspace_id: str, path: str) -> None:
    if path == "package.json":
        return
    if workspace_id not in _workspaces:
        return

    raw = _workspaces[workspace_id].get("package.json")
    if not raw:
        return

    try:
        package_obj = json.loads(raw)
    except Exception:
        return

    ai_meta = package_obj.get("aiIde")
    if not isinstance(ai_meta, dict):
        ai_meta = {}
        package_obj["aiIde"] = ai_meta

    generated = ai_meta.get("generatedFiles")
    if not isinstance(generated, list):
        generated = []

    if path not in generated:
        generated.append(path)
        ai_meta["generatedFiles"] = generated
        rendered = json.dumps(package_obj, indent=2, ensure_ascii=True) + "\n"
        _workspaces[workspace_id]["package.json"] = rendered

        meta = _workspace_meta.get(workspace_id)
        if meta:
            root = Path(meta["root_dir"])
            abs_path = _safe_abs_path(root, "package.json")
            abs_path.parent.mkdir(parents=True, exist_ok=True)
            abs_path.write_text(rendered, encoding="utf-8")
        _mirror(workspace_id, "package.json", rendered)


def _meta_path(root_dir: str) -> Path:
    return Path(root_dir) / "_meta.json"


def _write_meta(workspace_id: str) -> None:
    meta = _workspace_meta.get(workspace_id)
    if not meta:
        return
    root = Path(meta["root_dir"])
    root.mkdir(parents=True, exist_ok=True)
    safe = {k: v for k, v in meta.items() if k != "github_token"}
    _meta_path(str(root)).write_text(json.dumps(safe, indent=2), encoding="utf-8")


def _load_workspace_from_disk(workspace_id: str) -> Dict[str, str] | None:
    root = _ai_ide_root / workspace_id
    if not root.is_dir():
        return None
    files: Dict[str, str] = {}
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in _SKIP_DISK_DIRS for part in rel.parts[:-1]):
            continue
        if path.name in {"_meta.json"}:
            continue
        if path.suffix.lower() in _BINARY_SUFFIXES:
            continue
        try:
            files[str(rel).replace("\\", "/")] = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
    return files or None


# ── Durable copy in MongoDB ────────────────────────────────────────────────
# Writes are queued and applied in order by one background task per process, so the
# synchronous file API stays synchronous and the newest content of a path always wins.
_db = None
_pending: Dict[tuple[str, str], str | None] = {}
_flusher: asyncio.Task | None = None


def bind_db(db) -> None:
    global _db
    _db = db


def _file_doc_id(workspace_id: str, path: str) -> str:
    return f"{workspace_id}:{path}"


def _mirror(workspace_id: str, path: str, content: str | None) -> None:
    """Queue a file write (content) or delete (None) to MongoDB."""
    global _flusher
    if _db is None:
        return
    _pending[(workspace_id, path)] = content
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # no loop (sync caller outside the app): the next async write flushes it
    if _flusher is None or _flusher.done():
        _flusher = loop.create_task(_flush())


async def _flush() -> None:
    db = _db
    touched: set[str] = set()
    while _pending and db is not None:
        (workspace_id, path), content = next(iter(_pending.items()))
        del _pending[(workspace_id, path)]
        try:
            if content is None:
                await db[FILES].delete_one({"_id": _file_doc_id(workspace_id, path)})
            else:
                await db[FILES].update_one(
                    {"_id": _file_doc_id(workspace_id, path)},
                    {"$set": {
                        "workspace_id": workspace_id,
                        "path": path,
                        "content": content,
                        "updated_at": datetime.now(timezone.utc),
                    }},
                    upsert=True,
                )
            touched.add(workspace_id)
        except Exception:  # noqa: BLE001 - keep draining; the next write of this path retries
            logger.exception("[AI IDE] could not persist %s in workspace %s", path, workspace_id)
    now = datetime.now(timezone.utc)
    for workspace_id in touched:
        try:
            await db[REGISTRY].update_one({"_id": workspace_id}, {"$set": {"updated_at": now}})
        except Exception:  # noqa: BLE001
            logger.exception("[AI IDE] could not touch registry for %s", workspace_id)


async def flush_pending() -> None:
    """Wait until every queued write is in MongoDB (used by tests and shutdown)."""
    while _pending or (_flusher is not None and not _flusher.done()):
        if _flusher is not None and not _flusher.done():
            await _flusher
        elif _pending:
            await _flush()


async def _load_workspace_from_db(db, workspace_id: str) -> Dict[str, str]:
    files: Dict[str, str] = {}
    async for doc in db[FILES].find({"workspace_id": workspace_id}, {"path": 1, "content": 1}):
        if isinstance(doc.get("path"), str) and isinstance(doc.get("content"), str):
            files[doc["path"]] = doc["content"]
    return files


def _restore_to_disk(workspace_id: str, files: Dict[str, str]) -> None:
    root = _ai_ide_root / workspace_id
    root.mkdir(parents=True, exist_ok=True)
    for rel_path, content in files.items():
        try:
            abs_path = _safe_abs_path(root, rel_path)
        except ValueError:
            continue
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_text(content, encoding="utf-8")


async def update_app_info(workspace_id: str, **fields: Any) -> None:
    """Record the app's name, idea or build status in the registry (listing and reopening)."""
    if _db is None:
        return
    clean = {k: v for k, v in fields.items() if k in {"name", "idea", "status"}}
    if clean:
        try:
            await _db[REGISTRY].update_one(
                {"_id": workspace_id}, {"$set": {**clean, "updated_at": datetime.now(timezone.utc)}}
            )
        except Exception:  # noqa: BLE001 - the app still works; only its listing lags
            logger.exception("[AI IDE] could not update app info for %s", workspace_id)
    # The project record (ADR-6) follows the build: name, status and the spec summary.
    org_id = (_workspace_meta.get(workspace_id) or {}).get("org_id")
    if org_id and any(k in fields for k in ("name", "status", "spec")):
        from app.services import project_service

        await project_service.note_build(
            _db, org_id, workspace_id, name=fields.get("name"), status=fields.get("status"), spec=fields.get("spec")
        )


async def list_apps(db, org_id: str) -> list[dict[str, Any]]:
    """The org's apps, newest first, with how many files each has stored."""
    docs = [d async for d in db[REGISTRY].find({"org_id": org_id}).sort("updated_at", -1).limit(200)]
    ids = [d["_id"] for d in docs]
    counts: Dict[str, int] = {}
    if ids:
        async for row in db[FILES].aggregate([
            {"$match": {"workspace_id": {"$in": ids}}},
            {"$group": {"_id": "$workspace_id", "n": {"$sum": 1}}},
        ]):
            counts[row["_id"]] = row["n"]

    def iso(value: Any) -> str | None:
        return value.isoformat() if isinstance(value, datetime) else None

    return [
        {
            "workspace_id": d["_id"],
            "name": d.get("name"),
            "idea": d.get("idea"),
            "status": d.get("status"),
            "file_count": counts.get(d["_id"], 0),
            "repo_url": d.get("repo_html_url") or d.get("repo_url"),
            "created_at": iso(d.get("created_at")),
            "updated_at": iso(d.get("updated_at")),
        }
        for d in docs
    ]


async def delete_app(db, org_id: str, workspace_id: str) -> bool:
    """Remove an org's app: registry entry, stored files, disk copy and in-memory state."""
    result = await db[REGISTRY].delete_one({"_id": workspace_id, "org_id": org_id})
    if result.deleted_count == 0:
        return False
    for key in [k for k in _pending if k[0] == workspace_id]:
        _pending.pop(key, None)
    await db[FILES].delete_many({"workspace_id": workspace_id})
    _workspaces.pop(workspace_id, None)
    _workspace_meta.pop(workspace_id, None)
    root = _ai_ide_root / workspace_id
    if root.is_dir():
        await asyncio.to_thread(shutil.rmtree, root, True)
    return True


def _hydrate_workspace(workspace_id: str) -> None:
    if workspace_id in _workspaces and workspace_id in _workspace_meta:
        return
    files = _load_workspace_from_disk(workspace_id)
    if not files:
        raise KeyError(f"Workspace {workspace_id} not found")
    root_dir = str(_ai_ide_root / workspace_id)
    meta: Dict[str, Any] = {
        "workspace_id": workspace_id,
        "org_id": None,
        "root_dir": root_dir,
        "repo_url": None,
        "repo_owner": None,
        "repo_name": None,
        "default_branch": "main",
        "github_token": None,
    }
    meta_file = _meta_path(root_dir)
    if meta_file.is_file():
        try:
            loaded = json.loads(meta_file.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                meta.update({k: v for k, v in loaded.items() if k != "github_token"})
                meta["root_dir"] = root_dir
        except Exception:
            pass
    _workspaces[workspace_id] = files
    _workspace_meta[workspace_id] = meta


async def register(db, workspace_id: str) -> None:
    """Record the workspace's owner, location and repository in MongoDB (never the GitHub token)."""
    meta = _workspace_meta[workspace_id]
    now = datetime.now(timezone.utc)
    fields = {k: v for k, v in meta.items() if k not in ("github_token", "workspace_id")}
    await db[REGISTRY].update_one(
        {"_id": workspace_id},
        {"$set": {**fields, "updated_at": now}, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )


async def attach(db, org_id: str, workspace_id: str) -> None:
    """Make an org's registered workspace usable in this process.

    Loads its files from disk after a restart or on another worker. Raises
    WorkspaceExpiredError when the registry knows the workspace but its files
    are gone. An id the registry does not hold for this org is left to
    require_org_workspace, which still finds workspaces created before the registry.
    """
    if workspace_id in _workspaces and workspace_id in _workspace_meta:
        return
    doc = await db[REGISTRY].find_one({"_id": workspace_id, "org_id": org_id})
    if doc is None:
        return
    files = _load_workspace_from_disk(workspace_id)
    if not files:
        # A restart or redeploy cleared the disk cache: the stored copy is the app.
        files = await _load_workspace_from_db(db, workspace_id)
        if not files:
            raise WorkspaceExpiredError(workspace_id)
        await asyncio.to_thread(_restore_to_disk, workspace_id, files)
    _workspaces[workspace_id] = files
    _workspace_meta[workspace_id] = {
        "workspace_id": workspace_id,
        "org_id": org_id,
        "root_dir": str(_ai_ide_root / workspace_id),
        "repo_url": doc.get("repo_url"),
        "repo_owner": doc.get("repo_owner"),
        "repo_name": doc.get("repo_name"),
        "repo_id": doc.get("repo_id"),
        "repo_html_url": doc.get("repo_html_url"),
        "default_branch": doc.get("default_branch") or "main",
        "github_token": None,  # never stored; the client sends it again to push
    }


async def ensure_indexes(db) -> None:
    bind_db(db)
    await db[REGISTRY].create_index([("org_id", 1), ("updated_at", -1)])
    await db[FILES].create_index([("workspace_id", 1)])


async def create_workspace(org_id: str, db=None, pack_id: str | None = None) -> str:
    """A new app from the template with a design pack installed (the org's default when None)."""
    from app.services import design_pack_service

    _ensure_workspace_root()
    workspace_id = str(uuid.uuid4())
    template = await _get_template_cached()
    if db is not None:
        pack_id, pack_files, pack_meta = await design_pack_service.load_pack(db, org_id, pack_id)
    else:
        builtin = design_pack_service.builtin_packs()
        pack_id = pack_id if pack_id in builtin else design_pack_service.DEFAULT_PACK_ID
        pack_files = builtin.get(pack_id, {})
        pack_meta, _ = design_pack_service.validate(pack_files) if pack_files else ({"id": pack_id}, [])
    files = design_pack_service.install(template, pack_files, pack_meta) if pack_files else dict(template)
    _workspaces[workspace_id] = files
    root_dir = str(_ai_ide_root / workspace_id)
    _workspace_meta[workspace_id] = {
        "workspace_id": workspace_id,
        "org_id": org_id,
        "root_dir": root_dir,
        "repo_url": None,
        "repo_owner": None,
        "repo_name": None,
        "default_branch": "main",
        "github_token": None,
        "pack_id": pack_id,
    }
    await asyncio.to_thread(_write_workspace_files_to_disk, workspace_id)
    _write_meta(workspace_id)
    if db is not None:
        # Always the caller's database: a stale binding (tests, reconnects) must not win.
        bind_db(db)
        await register(db, workspace_id)
    for path, content in _workspaces[workspace_id].items():
        _mirror(workspace_id, path, content)
    return workspace_id


async def ensure_stored(db, workspace_id: str) -> int:
    """Store every file of an app built before files were kept in MongoDB; returns files queued."""
    if await db[FILES].count_documents({"workspace_id": workspace_id}, limit=1):
        return 0
    if _db is None:
        bind_db(db)
    files = get_workspace_files(workspace_id)
    for path, content in files.items():
        _mirror(workspace_id, path, content)
    return len(files)


def upgrade_kit(workspace_id: str) -> list[str]:
    """Bring an app's copy of the Chronos kit up to the current version (fixes ship to old apps)."""
    from app.engines import kit

    _hydrate_workspace(workspace_id)
    changes = kit.outdated_kit_files(_workspaces[workspace_id])
    for path, content in changes.items():
        save_file(workspace_id, path, content)
    if changes:
        logger.info("[AI IDE] upgraded the kit in %s (%d files)", workspace_id, len(changes))
    return sorted(changes)


def require_org_workspace(org_id: str, workspace_id: str) -> Dict[str, Any]:
    """Hydrate and return workspace meta if it belongs to org_id, else KeyError."""
    _hydrate_workspace(workspace_id)
    meta = _workspace_meta.get(workspace_id)
    if not meta or meta.get("org_id") != org_id:
        raise KeyError(f"Workspace {workspace_id} not found")
    return meta


def get_workspace_files(workspace_id: str) -> Dict[str, str]:
    _hydrate_workspace(workspace_id)
    return dict(_workspaces[workspace_id])


def get_workspace_meta(workspace_id: str) -> Dict[str, Any]:
    _hydrate_workspace(workspace_id)
    return dict(_workspace_meta[workspace_id])


def save_file(workspace_id: str, path: str, content: str) -> None:
    _hydrate_workspace(workspace_id)
    _require_entry_path(Path(_workspace_meta[workspace_id]["root_dir"]), path)
    is_new_path = path not in _workspaces[workspace_id]
    _workspaces[workspace_id][path] = content
    meta = _workspace_meta[workspace_id]
    root = Path(meta["root_dir"])
    abs_path = _safe_abs_path(root, path)
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text(content, encoding="utf-8")
    _mirror(workspace_id, path, content)
    if is_new_path:
        _update_package_json_generated_files(workspace_id, path)


def create_file(workspace_id: str, path: str, content: str = "") -> None:
    """Create a file the user asked for, with exactly the content given (empty if none)."""
    _hydrate_workspace(workspace_id)
    _require_entry_path(Path(_workspace_meta[workspace_id]["root_dir"]), path)
    _workspaces[workspace_id][path] = content
    meta = _workspace_meta[workspace_id]
    root = Path(meta["root_dir"])
    abs_path = _safe_abs_path(root, path)
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text(content, encoding="utf-8")
    _mirror(workspace_id, path, content)


def read_file(workspace_id: str, path: str) -> str:
    _hydrate_workspace(workspace_id)
    files = _workspaces[workspace_id]
    if path not in files:
        raise FileNotFoundError(f"{path} not found in workspace")
    return files[path]


def list_file_paths(workspace_id: str) -> list[str]:
    _hydrate_workspace(workspace_id)
    return list(_workspaces[workspace_id].keys())


def delete_path(workspace_id: str, path: str) -> list[str]:
    _hydrate_workspace(workspace_id)

    files = _workspaces[workspace_id]
    meta = _workspace_meta[workspace_id]
    root = Path(meta["root_dir"])
    _require_entry_path(root, path)
    deleted: list[str] = []
    for key in list(files.keys()):
        if key == path or key.startswith(f"{path}/"):
            deleted.append(key)
            del files[key]
            _mirror(workspace_id, key, None)

            abs_path = _safe_abs_path(root, key)
            if abs_path.exists() and abs_path.is_file():
                abs_path.unlink()

    target_dir = _safe_abs_path(root, path)
    if target_dir.exists() and target_dir.is_dir():
        for child in sorted(target_dir.rglob("*"), reverse=True):
            if child.is_file():
                child.unlink()
            elif child.is_dir():
                child.rmdir()
        target_dir.rmdir()
    return deleted


def rename_or_move_path(workspace_id: str, from_path: str, to_path: str) -> list[str]:
    _hydrate_workspace(workspace_id)

    files = _workspaces[workspace_id]
    meta = _workspace_meta[workspace_id]
    root = Path(meta["root_dir"])
    _require_entry_path(root, from_path)
    _require_entry_path(root, to_path)
    touched: list[tuple[str, str]] = []
    for key in list(files.keys()):
        if key == from_path or key.startswith(f"{from_path}/"):
            new_key = f"{to_path}{key[len(from_path):]}"
            touched.append((key, new_key))

    for old_key, new_key in touched:
        files[new_key] = files[old_key]
        del files[old_key]
        _mirror(workspace_id, old_key, None)
        _mirror(workspace_id, new_key, files[new_key])

        old_abs = _safe_abs_path(root, old_key)
        new_abs = _safe_abs_path(root, new_key)
        new_abs.parent.mkdir(parents=True, exist_ok=True)
        if old_abs.exists() and old_abs.is_file():
            old_abs.rename(new_abs)

    old_dir = _safe_abs_path(root, from_path)
    new_dir = _safe_abs_path(root, to_path)
    if old_dir.exists() and old_dir.is_dir() and not new_dir.exists():
        new_dir.parent.mkdir(parents=True, exist_ok=True)
        old_dir.rename(new_dir)

    return [new_key for _, new_key in touched]


def _auth_header(token: str) -> str:
    basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    return f"AUTHORIZATION: basic {basic}"


def _scrub(text: str, token: str | None) -> str:
    """Remove the token (raw, base64-wrapped, or embedded in a URL) from git output."""
    out = str(text or "")
    if token:
        out = out.replace(token, "***")
        out = out.replace(base64.b64encode(f"x-access-token:{token}".encode()).decode(), "***")
    out = re.sub(r"https://[^@\s/]+@", "https://", out)
    return out


def _clean_remote(repo: "git.Repo", url: str) -> None:
    """origin points at the credential-free URL (rewrites an older tokenized one)."""
    if "origin" in [remote.name for remote in repo.remotes]:
        repo.git.remote("set-url", "origin", url)
    else:
        repo.git.remote("add", "origin", url)


def _push(repo: "git.Repo", token: str, branch: str) -> None:
    """Push `branch` to origin with the token as a per-command header. Raises GitPushError."""
    env = {"GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}
    try:
        repo.git.execute(
            ["git", "-c", f"http.extraHeader={_auth_header(token)}", "-c", "credential.helper=",
             "push", "--porcelain", "-u", "origin", f"{branch}:{branch}"],
            env=env,
        )
    except git.GitCommandError as exc:
        detail = _scrub(f"{exc.stderr or ''} {exc.stdout or ''}".strip(), token)
        if "rejected" in detail or "non-fast-forward" in detail or "fetch first" in detail:
            raise GitPushError(
                "GitHub rejected the push: the repository has commits this workspace does not. "
                f"Nothing was deployed. ({detail[:300]})"
            ) from None
        if "Authentication failed" in detail or "could not read Username" in detail or "403" in detail:
            raise GitPushError("GitHub refused the token. Set a valid token with repo access and try again.") from None
        raise GitPushError(f"Push to GitHub failed: {detail[:400] or 'unknown error'}") from None


def _ensure_gitignore(workspace_root: Path) -> None:
    """Workspace bookkeeping (_meta.json) and installs are never committed."""
    path = workspace_root / ".gitignore"
    existing = path.read_text(encoding="utf-8") if path.is_file() else ""
    lines = existing.splitlines()
    missing = [entry for entry in ("_meta.json", "node_modules", "dist") if entry not in lines]
    if missing:
        path.write_text((existing.rstrip("\n") + "\n" if existing.strip() else "") + "\n".join(missing) + "\n", encoding="utf-8")


def _reset_git_dir(workspace_root: Path) -> None:
    git_dir = workspace_root / ".git"
    if git_dir.exists():
        shutil.rmtree(git_dir, ignore_errors=True)


def materialize_marks(workspace_id: str) -> list[str]:
    """Write the PNG of each mark the workspace's source uses to public/marks/ (identical files are skipped)."""
    root = Path(_workspace_meta[workspace_id]["root_dir"])
    written: list[str] = []
    for mark_id in marks_service.used_marks(_workspaces.get(workspace_id, {})):
        data = marks_service.mark_bytes(mark_id)
        if data is None:
            continue
        target = root / "public" / "marks" / f"{mark_id}.png"
        if target.is_file() and target.read_bytes() == data:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        written.append(mark_id)
    return written


async def init_git_and_create_repo(
    workspace_id: str,
    github_token: str,
    repo_name: str,
    private: bool = True,
    description: str = "",
    branch: str = "main",
) -> dict[str, Any]:
    _hydrate_workspace(workspace_id)
    if not _repo_name_valid(repo_name):
        raise ValueError("Invalid repository name")

    meta = _workspace_meta[workspace_id]
    workspace_root = Path(meta["root_dir"])

    async with httpx.AsyncClient(timeout=30) as client:
        user_resp = await client.get("https://api.github.com/user", headers=_github_headers(github_token))
        if user_resp.status_code >= 400:
            raise ValueError("Invalid GitHub token")
        owner = user_resp.json().get("login")
        if not owner:
            raise ValueError("Unable to resolve GitHub owner from token")

        create_resp = await client.post(
            "https://api.github.com/user/repos",
            headers=_github_headers(github_token),
            json={
                "name": repo_name,
                "private": private,
                "description": description,
                "auto_init": False,
            },
        )

        if create_resp.status_code == 422:
            repo_resp = await client.get(
                f"https://api.github.com/repos/{owner}/{repo_name}",
                headers=_github_headers(github_token),
            )
            if repo_resp.status_code >= 400:
                raise ValueError("Repository already exists and cannot be accessed with this token")
            repo_data = repo_resp.json()
        elif create_resp.status_code >= 400:
            raise ValueError(create_resp.text or "Failed to create repository")
        else:
            repo_data = create_resp.json()

    clone_url = repo_data.get("clone_url")
    html_url = repo_data.get("html_url")
    repo_id = repo_data.get("id")
    if not clone_url:
        raise ValueError("GitHub did not return repository clone URL")

    same_repo = meta.get("repo_url") == clone_url and (workspace_root / ".git").is_dir()

    def _git_init_push() -> str:
        materialize_marks(workspace_id)
        if same_repo:
            # This workspace already pushed here: keep its history so the push fast-forwards.
            repo = git.Repo(workspace_root)
        else:
            _reset_git_dir(workspace_root)
            repo = git.Repo.init(workspace_root)
            repo.git.symbolic_ref("HEAD", f"refs/heads/{branch}")
        _ensure_gitignore(workspace_root)
        repo.git.add(A=True)
        if repo.is_dirty(untracked_files=True) or not repo.head.is_valid():
            commit = repo.index.commit("chore: initialize AI IDE workspace")
        else:
            commit = repo.head.commit
        _clean_remote(repo, clone_url)
        _push(repo, github_token, branch)
        return commit.hexsha

    commit_sha = await asyncio.to_thread(_git_init_push)

    meta.update(
        {
            "repo_url": clone_url,
            "repo_html_url": html_url,
            "repo_id": str(repo_id) if repo_id else None,
            "repo_owner": owner,
            "repo_name": repo_name,
            "default_branch": branch,
            "github_token": github_token,
        }
    )
    _write_meta(workspace_id)

    return {
        "workspace_id": workspace_id,
        "repo_url": clone_url,
        "repo_owner": owner,
        "repo_name": repo_name,
        "branch": branch,
        "commit_sha": commit_sha,
        "html_url": html_url,
    }


async def commit_and_push_workspace(
    workspace_id: str,
    message: str,
    branch: str | None = None,
    github_token: str | None = None,
) -> dict[str, Any]:
    _hydrate_workspace(workspace_id)

    meta = _workspace_meta[workspace_id]
    if not meta.get("repo_url"):
        raise ValueError("Repository not initialized for this AI IDE workspace")

    workspace_root = Path(meta["root_dir"])
    if github_token and github_token.strip():
        meta["github_token"] = github_token.strip()
    token = meta.get("github_token")
    if not token:
        # Tokens are held in memory only, so a restart forgets them.
        raise ValueError("Set your GitHub token again to push: the server does not keep it after a restart.")
    repo_url = meta.get("repo_url")
    target_branch = (branch or meta.get("default_branch") or "main").strip() or "main"

    def _git_commit_push() -> dict[str, Any]:
        materialize_marks(workspace_id)
        repo = git.Repo(workspace_root)
        try:
            repo.git.checkout(target_branch)
        except Exception:
            repo.git.checkout("-b", target_branch)

        _ensure_gitignore(workspace_root)
        repo.git.add(A=True)
        committed = False
        if repo.is_dirty(untracked_files=True):
            repo.index.commit(message or "chore: update AI IDE workspace")
            committed = True

        _clean_remote(repo, repo_url)
        # Always push: a clean tree may still hold commits an earlier failed push left behind.
        _push(repo, token, target_branch)
        head = repo.head.commit
        return {
            "sha": head.hexsha,
            "branch": target_branch,
            "message": head.message.strip() if committed else "No changes to commit; the branch is up to date on GitHub",
            "committed": committed,
            "push_ok": True,
        }

    result = await asyncio.to_thread(_git_commit_push)
    meta["default_branch"] = target_branch
    return {
        "workspace_id": workspace_id,
        "repo_url": repo_url,
        **result,
    }
