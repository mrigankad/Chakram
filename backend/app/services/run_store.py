"""Durable runs: a record per build with ordered events, a lease and a cancel flag.

A generation run is still an in-process task (`ai_ide_generation`); this store is
what survives the process. Every run has a document in `runs` (status, lease,
cancel flag, the plan once known, a summary at the end) and ordered events in
`run_events` with a gap-free `seq` per run, so a client can resume from the last
sequence it saw (HAR 05) and a replacement process can see what was done (HAR 07).

Leases: the worker that owns a run renews `lease_until` on a heartbeat. At
startup `reap_stale` marks runs whose lease expired as `interrupted`; nothing is
replayed automatically, the user resumes from the project (HAR 07). A heartbeat
also reads `cancel_requested`, so a cancel asked through any process reaches the
worker running the build (HAR 06).

Streamed tokens are not persisted (the finished file is in the workspace); every
other event is.
"""
from __future__ import annotations

import os
import socket
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo import ReturnDocument

RUNS = "runs"
EVENTS = "run_events"
LEASE_SECONDS = 30
HEARTBEAT_SECONDS = 10
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"

#: event types kept in the store (tokens are not: the workspace holds the finished file)
PERSISTED = {"STATUS", "PLAN", "FILE_CREATE", "FILE_UPDATE", "FILE_RENAMED", "FILE_DONE", "FILE_ERROR", "GENERATION_DONE", "ERROR"}
FINAL = ("done", "failed", "cancelled", "interrupted")


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes(db) -> None:
    await db[RUNS].create_index("run_id", unique=True)
    await db[RUNS].create_index([("org_id", 1), ("workspace_id", 1), ("created_at", -1)])
    await db[RUNS].create_index([("status", 1), ("lease_until", 1)])
    await db[EVENTS].create_index([("run_id", 1), ("seq", 1)], unique=True)


async def create(db, *, run_id: str, org_id: str, kind: str, workspace_id: str, idea: str = "", resume_of: str | None = None) -> dict[str, Any]:
    now = _now()
    doc = {
        "run_id": run_id, "org_id": org_id, "kind": kind, "workspace_id": workspace_id, "idea": idea[:2000],
        "status": "running", "seq": 0, "worker": WORKER_ID, "lease_until": now + timedelta(seconds=LEASE_SECONDS),
        "cancel_requested": False, "resume_of": resume_of, "plan": None, "summary": None, "error": None,
        "created_at": now, "updated_at": now, "finished_at": None,
    }
    await db[RUNS].insert_one(dict(doc))
    return doc


def _stored(event: dict) -> dict:
    """The event without payload that lives elsewhere (file contents are in the workspace)."""
    if event.get("type") in ("FILE_UPDATE", "FILE_RENAMED"):
        return {k: v for k, v in event.items() if k != "content"}
    return dict(event)


async def append(db, run_id: str, event: dict) -> int | None:
    """Store one event with the next sequence number; None for event types that are not kept."""
    if event.get("type") not in PERSISTED:
        return None
    doc = await db[RUNS].find_one_and_update(
        {"run_id": run_id}, {"$inc": {"seq": 1}, "$set": {"updated_at": _now()}}, return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        return None
    seq = int(doc["seq"])
    await db[EVENTS].insert_one({"run_id": run_id, "seq": seq, "event": _stored(event), "at": _now()})
    return seq


async def set_plan(db, run_id: str, plan: dict[str, Any]) -> None:
    await db[RUNS].update_one({"run_id": run_id}, {"$set": {"plan": plan, "updated_at": _now()}})


async def heartbeat(db, run_id: str) -> dict[str, Any] | None:
    """Renew the lease if this worker still owns a running run; returns the run (with `cancel_requested`)."""
    return await db[RUNS].find_one_and_update(
        {"run_id": run_id, "worker": WORKER_ID, "status": "running"},
        {"$set": {"lease_until": _now() + timedelta(seconds=LEASE_SECONDS), "updated_at": _now()}},
        return_document=ReturnDocument.AFTER,
    )


async def request_cancel(db, org_id: str, run_id: str) -> dict[str, Any] | None:
    """Flag a running run; the owning worker stops at its next step. None when there is no such running run."""
    return await db[RUNS].find_one_and_update(
        {"run_id": run_id, "org_id": org_id, "status": "running"},
        {"$set": {"cancel_requested": True, "updated_at": _now()}},
        return_document=ReturnDocument.AFTER,
    )


async def finish(db, run_id: str, status: str, summary: dict[str, Any] | None = None, error: str | None = None) -> None:
    assert status in FINAL, status
    await db[RUNS].update_one(
        {"run_id": run_id},
        {"$set": {"status": status, "summary": summary, "error": error, "finished_at": _now(), "updated_at": _now()}},
    )


async def get(db, org_id: str, run_id: str) -> dict[str, Any] | None:
    return await db[RUNS].find_one({"run_id": run_id, "org_id": org_id})


async def events(db, run_id: str, after_seq: int = 0, limit: int = 2000) -> list[dict[str, Any]]:
    cursor = db[EVENTS].find({"run_id": run_id, "seq": {"$gt": after_seq}}).sort("seq", 1).limit(limit)
    return [{"seq": d["seq"], **d["event"]} async for d in cursor]


async def list_for_workspace(db, org_id: str, workspace_id: str, limit: int = 10) -> list[dict[str, Any]]:
    cursor = db[RUNS].find({"org_id": org_id, "workspace_id": workspace_id}).sort("created_at", -1).limit(limit)
    return [d async for d in cursor]


async def latest_for_workspace(db, org_id: str, workspace_id: str) -> dict[str, Any] | None:
    rows = await list_for_workspace(db, org_id, workspace_id, limit=1)
    return rows[0] if rows else None


async def reap_stale(db) -> int:
    """Mark running runs whose lease expired as interrupted (their worker is gone). Returns how many."""
    now = _now()
    count = 0
    async for run in db[RUNS].find({"status": "running", "lease_until": {"$lt": now}}):
        await db[RUNS].update_one(
            {"run_id": run["run_id"], "status": "running"},
            {"$set": {"status": "interrupted", "error": "The server running this build stopped (its lease expired).",
                      "finished_at": now, "updated_at": now}},
        )
        count += 1
    return count


def progress(events_list: list[dict[str, Any]]) -> dict[str, Any]:
    """What a run's events say was finished: done paths, failed paths, the last status line."""
    done: list[str] = []
    failed: list[str] = []
    last_status = None
    for e in events_list:
        t = e.get("type")
        if t == "FILE_DONE" and e.get("path"):
            if e["path"] not in done:
                done.append(e["path"])
        elif t == "FILE_RENAMED" and e.get("to"):
            done.append(e["to"])
        elif t == "FILE_ERROR" and e.get("path"):
            failed.append(e["path"])
        elif t == "STATUS":
            last_status = e.get("message")
    return {"files_done": done, "files_failed": failed, "last_status": last_status}


def public(run: dict[str, Any], prog: dict[str, Any] | None = None) -> dict[str, Any]:
    """The run as the API returns it."""
    plan = run.get("plan") or {}
    out = {
        "run_id": run["run_id"], "kind": run.get("kind"), "workspace_id": run.get("workspace_id"), "status": run["status"],
        "resumable": run["status"] in ("interrupted", "cancelled", "failed") and bool(plan),
        "cancel_requested": bool(run.get("cancel_requested")), "resume_of": run.get("resume_of"),
        "app_name": plan.get("app_name"), "files_planned": len(plan.get("files") or []),
        "error": run.get("error"), "summary": run.get("summary"), "seq": run.get("seq", 0),
        "created_at": run.get("created_at"), "finished_at": run.get("finished_at"),
    }
    if prog:
        out.update(prog)
    return out
