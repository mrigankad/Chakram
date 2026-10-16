"""Builds survive the process: ordered events, a lease, cancel from anywhere, resume from the plan (HAR 05–07)."""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.auth.session import create_session_cookie
from app.routes import ai_ide
from app.services import ai_ide_generation, organization_service, run_store

from tests.test_ai_ide_generation import PLAN, FakeWebSocket, FakeWorkspace, _patched, _stream

FILES = {"src/components/Navbar.tsx": "nav code", "src/pages/Home.tsx": "home code", "src/pages/Reports.tsx": "reports code"}


async def _org_and_cookie(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    cookie = create_session_cookie(user_id="user", org_id=org.id)
    app_client.cookies.set("aidlc_session", cookie)
    return org, cookie


async def test_events_are_stored_in_order_without_tokens_and_the_run_closes(app_client, db):
    org, cookie = await _org_and_cookie(app_client, db)
    workspace = FakeWorkspace()
    patches = await _patched(workspace, PLAN, _stream(FILES))
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        ws = FakeWebSocket(cookie)
        await ai_ide.generate(ws, "ws-1")
        await ai_ide_generation.get("ws-1").task  # the store closes right after the final event
        run_id = ws.sent[-1]["run_id"]
        listed = (await app_client.get("/api/ai-ide/workspace/ws-1/runs")).json()["runs"]

    run = await run_store.get(db, org.id, run_id)
    assert run["status"] == "done" and run["worker"] == run_store.WORKER_ID and run["summary"]["files_total"] == 3
    assert [f["path"] for f in run["plan"]["model_files"]] == [f["path"] for f in PLAN["files"]] and run["plan"]["composed"] is False
    events = await run_store.events(db, run_id)
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))  # gap-free, ordered
    kinds = [e["type"] for e in events]
    assert kinds[0] == "STATUS" and "PLAN" in kinds and kinds[-1] == "GENERATION_DONE" and "STREAM_TOKEN" not in kinds
    assert all("content" not in e for e in events if e["type"] == "FILE_UPDATE")  # the workspace holds the file
    assert run_store.progress(events)["files_done"] == list(FILES)

    assert listed[0]["run_id"] == run_id and listed[0]["status"] == "done" and listed[0]["resumable"] is False
    one = (await app_client.get(f"/api/ai-ide/runs/{run_id}?after={len(events) - 1}")).json()
    assert [e["type"] for e in one["events"]] == ["GENERATION_DONE"] and one["files_done"] == list(FILES)
    assert (await app_client.get("/api/ai-ide/runs/nope")).status_code == 404


async def test_cancel_stops_the_build_and_writes_nothing_for_the_file_in_flight(app_client, db):
    org, cookie = await _org_and_cookie(app_client, db)
    gate = asyncio.Event()
    streamed = []

    async def stream_file(file_spec, org_id=None):
        streamed.append(file_spec["path"])
        if file_spec["path"] != "src/components/Navbar.tsx":
            yield "half"
            await gate.wait()
        yield "code"

    workspace = FakeWorkspace()
    patches = await _patched(workspace, PLAN, stream_file)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        run = ai_ide_generation.start("ws-1", org.id, "an app", db=db)
        for _ in range(200):
            await asyncio.sleep(0.01)
            if "src/pages/Reports.tsx" in streamed:
                break
        assert (await app_client.post("/api/ai-ide/workspace/ws-1/cancel")).json()["immediate"] is True
        try:
            await asyncio.wait_for(run.task, timeout=5)
        except asyncio.CancelledError:
            pass
        assert (await app_client.post("/api/ai-ide/workspace/ws-1/cancel")).status_code == 409  # nothing running now
    assert run.final_event["type"] == "ERROR" and run.final_event["cancelled"] is True
    assert workspace.files["src/components/Navbar.tsx"] == "code" and "src/pages/Home.tsx" not in workspace.files
    stored = await run_store.get(db, org.id, run.run_id)
    assert stored["status"] == "cancelled" and stored["finished_at"] is not None
    assert (await run_store.events(db, run.run_id))[-1]["type"] == "ERROR"
    gate.set()


async def test_a_cancel_asked_through_the_store_reaches_the_worker_by_heartbeat(app_client, db, monkeypatch):
    org, _ = await _org_and_cookie(app_client, db)
    monkeypatch.setattr(run_store, "HEARTBEAT_SECONDS", 0.02)
    gate = asyncio.Event()

    async def stream_file(file_spec, org_id=None):
        yield "x"
        await gate.wait()
        yield "y"

    workspace = FakeWorkspace()
    patches = await _patched(workspace, PLAN, stream_file)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        run = ai_ide_generation.start("ws-1", org.id, "an app", db=db)
        await asyncio.sleep(0.05)
        assert await run_store.request_cancel(db, org.id, run.run_id)  # e.g. another process's cancel route
        try:
            await asyncio.wait_for(run.task, timeout=5)
        except asyncio.CancelledError:
            pass
    assert run.cancel_requested and (await run_store.get(db, org.id, run.run_id))["status"] == "cancelled"
    assert workspace.files.keys() == {"src/App.tsx"}  # the half-streamed file was never written
    gate.set()


async def test_a_lost_worker_is_reaped_and_the_build_resumes_from_its_plan(app_client, db):
    org, cookie = await _org_and_cookie(app_client, db)
    # A run another worker owned, whose lease ran out after Navbar was written.
    prior = await run_store.create(db, run_id="run-old", org_id=org.id, kind="generation", workspace_id="ws-1", idea="a reporting app")
    await run_store.set_plan(db, "run-old", ai_ide_generation._plan_record("Reports", "d", PLAN["routes"], PLAN["files"], False, [f["path"] for f in PLAN["files"]]))
    for event in ({"type": "PLAN"}, {"type": "FILE_CREATE", "path": "src/components/Navbar.tsx"}, {"type": "FILE_DONE", "path": "src/components/Navbar.tsx"}):
        await run_store.append(db, "run-old", event)
    await db[run_store.RUNS].update_one({"run_id": "run-old"}, {"$set": {"worker": "other:1", "lease_until": datetime.now(timezone.utc) - timedelta(seconds=1)}})

    assert await run_store.reap_stale(db) == 1
    reaped = await run_store.get(db, org.id, "run-old")
    assert reaped["status"] == "interrupted" and "lease expired" in reaped["error"]
    assert await run_store.reap_stale(db) == 0

    workspace = FakeWorkspace()
    workspace.files["src/components/Navbar.tsx"] = "nav code"
    streamed = []

    async def stream_file(file_spec, org_id=None):
        streamed.append(file_spec["path"])
        yield FILES[file_spec["path"]]

    patches = await _patched(workspace, PLAN, stream_file)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        # Attaching after the restart says what happened instead of pretending the app is at rest.
        ws = FakeWebSocket(cookie, idea='{"attach": true}')
        await ai_ide.generate(ws, "ws-1")
        assert [m["type"] for m in ws.sent] == ["RUN_INTERRUPTED", "NO_RUN"]
        assert ws.sent[0]["resumable"] is True and ws.sent[0]["files_done"] == ["src/components/Navbar.tsx"]

        resp = await app_client.post("/api/ai-ide/runs/run-old/resume")
        assert resp.status_code == 200, resp.text
        new_id = resp.json()["run_id"]
        run = ai_ide_generation.get("ws-1")
        assert run is not None and run.run_id == new_id
        await run.task
        assert sorted(streamed) == ["src/pages/Home.tsx", "src/pages/Reports.tsx"]  # Navbar was kept, not regenerated
        done = run.final_event
        assert done["type"] == "GENERATION_DONE" and done["files_total"] == 3 and done["files_skipped"] == 1 and done["files_failed"] == 0
        assert workspace.files["src/pages/Home.tsx"] == "home code" and "./pages/Reports" in workspace.files["src/App.tsx"]

        # Resuming once everything is written regenerates nothing and keeps the routes wired.
        assert (await app_client.post("/api/ai-ide/runs/run-old/resume")).status_code == 200
        again = ai_ide_generation.get("ws-1")
        await again.task
        assert again.final_event["files_skipped"] == 3 and len(streamed) == 2
        assert "./pages/Reports" in workspace.files["src/App.tsx"] and "./pages/Home" in workspace.files["src/App.tsx"]
        runs = (await app_client.get("/api/ai-ide/workspace/ws-1/runs")).json()["runs"]

    stored = await run_store.get(db, org.id, new_id)
    assert stored["status"] == "done" and stored["resume_of"] == "run-old" and stored["plan"]["app_name"] == "Reports"
    assert [r["status"] for r in runs] == ["done", "done", "interrupted"] and runs[1]["resume_of"] == "run-old"


async def test_resume_refuses_what_cannot_be_continued(app_client, db):
    org, _ = await _org_and_cookie(app_client, db)
    assert (await app_client.post("/api/ai-ide/runs/nope/resume")).status_code == 404
    await run_store.create(db, run_id="run-noplan", org_id=org.id, kind="generation", workspace_id="ws-1")
    await run_store.finish(db, "run-noplan", "failed", error="planner down")
    resp = await app_client.post("/api/ai-ide/runs/run-noplan/resume")
    assert resp.status_code == 409 and "before a plan" in resp.json()["detail"]
    await run_store.create(db, run_id="run-going", org_id=org.id, kind="generation", workspace_id="ws-2")
    assert (await app_client.post("/api/ai-ide/runs/run-going/resume")).status_code == 409
    # Another org's run is not visible.
    other = await organization_service.create_organization(db, workos_org_id="org_b", name="B")
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u2", org_id=other.id))
    assert (await app_client.post("/api/ai-ide/runs/run-noplan/resume")).status_code == 404
    assert (await app_client.get("/api/ai-ide/runs/run-noplan")).status_code == 404
