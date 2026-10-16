"""Projects: the one record both halves of Chakram read and write (ADR-6).

A project is an app. App Studio creates it with the workspace; Push & Deploy
add the repository and deployments; "Test this app" attaches the requirement
whose cases verify it. Test runs are not copied here: they are read from
`test_runs` by requirement id when a project is shown, so the numbers are
always what actually happened.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId

logger = logging.getLogger(__name__)

COLLECTION = "projects"
MAX_DEPLOYMENTS = 20


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _public(doc: dict[str, Any]) -> dict[str, Any]:
    out = dict(doc)
    out["id"] = str(out.pop("_id"))
    return out


async def ensure_indexes(db) -> None:
    await db[COLLECTION].create_index([("org_id", 1), ("updated_at", -1)])
    await db[COLLECTION].create_index([("org_id", 1), ("workspace_id", 1)], unique=True, sparse=True)
    await db[COLLECTION].create_index([("org_id", 1), ("repo.url", 1)], sparse=True)


async def ensure_for_workspace(db, org_id: str, workspace_id: str, *, name: str = "", pack_id: str | None = None) -> dict[str, Any]:
    """The project for an App Studio workspace, created on first call."""
    existing = await db[COLLECTION].find_one({"org_id": org_id, "workspace_id": workspace_id})
    if existing is not None:
        return _public(existing)
    doc = {
        "org_id": org_id,
        "name": name or "New app",
        "source": "app_studio",
        "workspace_id": workspace_id,
        "pack_id": pack_id,
        "spec": None,
        "repo": None,
        "deployments": [],
        "requirement_id": None,
        "build_status": "created",
        "created_at": _now(),
        "updated_at": _now(),
    }
    result = await db[COLLECTION].insert_one(doc)
    doc["_id"] = result.inserted_id
    return _public(doc)


async def ensure_for_repo(db, org_id: str, repo_url: str, *, name: str = "", default_branch: str = "main") -> dict[str, Any]:
    """The project for an imported repository (no Build stage), created on first call."""
    existing = await db[COLLECTION].find_one({"org_id": org_id, "repo.url": repo_url})
    if existing is not None:
        return _public(existing)
    owner, repo_name = _split_repo(repo_url)
    doc = {
        "org_id": org_id,
        "name": name or repo_name or repo_url,
        "source": "repo",
        "workspace_id": None,
        "pack_id": None,
        "spec": None,
        "repo": {"url": repo_url, "owner": owner, "name": repo_name, "default_branch": default_branch},
        "deployments": [],
        "requirement_id": None,
        "build_status": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    result = await db[COLLECTION].insert_one(doc)
    doc["_id"] = result.inserted_id
    return _public(doc)


def _split_repo(url: str) -> tuple[str, str]:
    parts = url.rstrip("/").removesuffix(".git").split("/")
    return (parts[-2], parts[-1]) if len(parts) >= 2 else ("", parts[-1] if parts else "")


async def _update_by_workspace(db, org_id: str, workspace_id: str, fields: dict[str, Any], push: dict[str, Any] | None = None) -> bool:
    update: dict[str, Any] = {"$set": {**fields, "updated_at": _now()}}
    if push:
        update["$push"] = push
    result = await db[COLLECTION].update_one({"org_id": org_id, "workspace_id": workspace_id}, update)
    return result.matched_count > 0


async def note_build(db, org_id: str, workspace_id: str, *, name: str | None = None, status: str | None = None, spec: dict[str, Any] | None = None) -> None:
    """Name, build status and a spec summary from App Studio; never raises."""
    fields: dict[str, Any] = {}
    if name:
        fields["name"] = name
    if status:
        fields["build_status"] = status
    if spec is not None:
        fields["spec"] = {
            "entities": list(spec.get("entities") or {}),
            "pages": [p.get("title") for p in spec.get("pages") or [] if isinstance(p, dict)],
        }
    if not fields:
        return
    try:
        await _update_by_workspace(db, org_id, workspace_id, fields)
    except Exception:  # noqa: BLE001 - the build must not depend on the project record
        logger.exception("[projects] could not note build for %s", workspace_id)


async def set_repo(db, org_id: str, workspace_id: str, repo_url: str, default_branch: str = "main") -> None:
    owner, name = _split_repo(repo_url)
    await _update_by_workspace(db, org_id, workspace_id, {"repo": {"url": repo_url, "owner": owner, "name": name, "default_branch": default_branch}})


async def add_deployment(db, org_id: str, workspace_id: str, deployment: dict[str, Any]) -> None:
    entry = {
        "id": str(deployment.get("id") or deployment.get("deployment_id") or ""),
        "url": deployment.get("url") or deployment.get("deployment_url"),
        "state": deployment.get("status") or deployment.get("state") or "QUEUED",
        "target": deployment.get("target"),
        "branch": deployment.get("branch"),
        "created_at": _now(),
    }
    await _update_by_workspace(
        db, org_id, workspace_id, {"last_deployment": entry},
        push={"deployments": {"$each": [entry], "$slice": -MAX_DEPLOYMENTS}},
    )


async def set_requirement(db, org_id: str, workspace_id: str, requirement_id: str) -> None:
    await _update_by_workspace(db, org_id, workspace_id, {"requirement_id": requirement_id})


async def _latest_run(db, org_id: str, requirement_id: str | None) -> dict[str, Any] | None:
    if not requirement_id:
        return None
    run = await db["test_runs"].find_one({"org_id": org_id, "requirement_id": requirement_id}, sort=[("created_at", -1)])
    if run is None:
        return None
    counts = {"PASS": 0, "FAIL": 0, "SKIP": 0}
    async for d in db["test_results"].find({"run_id": run["run_id"], "org_id": org_id}, {"status": 1}):
        counts[d.get("status", "FAIL")] = counts.get(d.get("status", "FAIL"), 0) + 1
    executed = counts["PASS"] + counts["FAIL"]
    return {
        "run_id": run["run_id"],
        "status": run.get("status"),
        "target_url": run.get("target_url"),
        "passed": counts["PASS"],
        "failed": counts["FAIL"],
        "skipped": counts["SKIP"],
        "pass_rate": round(counts["PASS"] / executed, 3) if executed else None,
        "created_at": run.get("created_at"),
        "completed_at": run.get("completed_at"),
    }


def _stages(project: dict[str, Any], latest_run: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """The five stages with a status each; 'not evaluated' until the input exists."""
    build = {"status": project.get("build_status") or ("n/a" if project.get("source") == "repo" else "not evaluated"), "spec": project.get("spec")}
    if latest_run is None:
        verify = {"status": "not evaluated", "detail": "No test run yet" if project.get("requirement_id") else "No test cases yet"}
    elif latest_run["status"] == "running":
        verify = {"status": "running", "run": latest_run}
    elif latest_run["pass_rate"] is None:
        verify = {"status": "not evaluated", "detail": "Nothing executed in the last run", "run": latest_run}
    else:
        verify = {"status": "passed" if latest_run["failed"] == 0 else "failed", "run": latest_run}
    review = {"status": "ready" if project.get("repo") else "not evaluated", "repo": project.get("repo")}
    deployment = project.get("last_deployment")
    release = {"status": (deployment or {}).get("state", "not evaluated").lower() if deployment else "not evaluated", "deployment": deployment}
    operate = {"status": "not evaluated", "detail": "Health is read from the deployed app on request", "url": (deployment or {}).get("url")}
    return {"build": build, "verify": verify, "review": review, "release": release, "operate": operate}


async def get(db, org_id: str, project_id: str) -> dict[str, Any] | None:
    if not ObjectId.is_valid(project_id):
        return None
    doc = await db[COLLECTION].find_one({"_id": ObjectId(project_id), "org_id": org_id})
    if doc is None:
        return None
    project = _public(doc)
    latest = await _latest_run(db, org_id, project.get("requirement_id"))
    project["latest_run"] = latest
    project["stages"] = _stages(project, latest)
    return project


async def list_projects(db, org_id: str) -> list[dict[str, Any]]:
    out = []
    async for doc in db[COLLECTION].find({"org_id": org_id}).sort("updated_at", -1).limit(200):
        project = _public(doc)
        latest = await _latest_run(db, org_id, project.get("requirement_id"))
        project["latest_run"] = latest
        project["stages"] = _stages(project, latest)
        out.append(project)
    return out


async def get_by_workspace(db, org_id: str, workspace_id: str) -> dict[str, Any] | None:
    doc = await db[COLLECTION].find_one({"org_id": org_id, "workspace_id": workspace_id})
    return _public(doc) if doc else None
