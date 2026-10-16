"""Live Test Runner run state is in MongoDB while the run is in progress, with its screenshots."""
from datetime import timedelta

import pytest

from app.auth.session import create_session_cookie
from app.services import durable_state, organization_service, playwright_service


@pytest.fixture(autouse=True)
def _fast_flush(monkeypatch):
    monkeypatch.setattr(durable_state, "FLUSH_SECONDS", 0.01)
    yield
    playwright_service._runs.clear()


def _step(status="pass", screenshot="c2hvdA==", error=None):
    return {"step_description": "open", "screenshot": screenshot, "status": status, "error": error}


def _result(status, steps, test_id="t1"):
    return {
        "test_id": test_id, "test_name": "Login", "status": status, "steps_completed": len(steps),
        "total_steps": 2, "step_results": steps, "error": None, "duration_ms": None,
    }


async def test_run_is_persisted_while_running_and_readable_after_a_restart(db, monkeypatch):
    seen_mid_run: dict = {}

    async def fake_execute(run, tests, target_url, credentials=None):
        run["results"].append(_result("running", [_step()]))
        # Give the write-through loop a tick, then look at what MongoDB holds mid-run.
        for _ in range(200):
            doc = await db.playwright_runs.find_one({"_id": run["run_id"]})
            if doc and doc["results"]:
                break
            await durable_state.asyncio.sleep(0.01)
        seen_mid_run.update(doc or {})
        run["results"][0]["step_results"].append(_step("fail", screenshot="ZmFpbA==", error="boom"))
        run["results"][0].update(status="failed", steps_completed=2)
        run["failed"] = 1
        run["status"] = "completed"
        run["completed_at"] = "2026-01-01T00:00:05+00:00"

    monkeypatch.setattr(playwright_service, "_execute", fake_execute)
    await playwright_service.execute_playwright_tests(db, "org-1", [{"name": "Login"}], "http://t", "run-1", "a1")

    assert seen_mid_run["status"] == "running"
    assert seen_mid_run["results"][0]["status"] == "running"
    assert "screenshot" not in seen_mid_run["results"][0]["step_results"][0]  # kept out of the run document

    # "Restart": nothing in memory. The poll endpoint's read still returns the full run.
    assert "run-1" not in playwright_service._runs
    run = await playwright_service.load_run(db, "org-1", "run-1", with_screenshots=True)
    assert run["status"] == "completed"
    assert [s["screenshot"] for s in run["results"][0]["step_results"]] == ["c2hvdA==", "ZmFpbA=="]
    assert "heartbeat_at" not in run and "_id" not in run

    assert await playwright_service.load_run(db, "other-org", "run-1") is None
    slim = await playwright_service.load_run(db, "org-1", "run-1", with_screenshots=False)
    assert "screenshot" not in slim["results"][0]["step_results"][0]


async def test_run_cut_off_by_a_restart_is_reported_failed_not_running(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_r", name="R")
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    stale = durable_state.now() - timedelta(seconds=durable_state.STALE_AFTER_SECONDS + 5)
    await db.playwright_runs.insert_one({
        "_id": "run-dead", "run_id": "run-dead", "org_id": org.id, "analysis_id": "a1", "status": "running",
        "results": [_result("passed", [], "t1"), _result("running", [], "t2")],
        "total": 3, "passed": 1, "failed": 0, "started_at": "2026-01-01T00:00:00+00:00",
        "completed_at": None, "error": None, "heartbeat_at": stale,
    })

    body = (await app_client.get("/api/repo/execution/run-dead")).json()

    assert body["status"] == "failed"
    assert "restart" in body["error"]
    assert [r["status"] for r in body["results"]] == ["passed", "failed"]
    assert (body["passed"], body["failed"]) == (1, 1)

    listed = (await app_client.get("/api/repo/runs")).json()["runs"]
    assert [(r["run_id"], r["status"]) for r in listed] == [("run-dead", "failed")]


async def test_running_run_with_a_live_owner_is_left_alone(db):
    await db.playwright_runs.insert_one({
        "_id": "run-live", "run_id": "run-live", "org_id": "org-1", "status": "running", "results": [],
        "started_at": "2026-01-01T00:00:00+00:00", "heartbeat_at": durable_state.now(),
    })
    assert (await playwright_service.load_run(db, "org-1", "run-live"))["status"] == "running"
    assert (await playwright_service.list_runs_from_db(db, "org-1"))[0]["status"] == "running"


async def test_run_stays_in_memory_when_mongo_rejects_the_final_write(db, monkeypatch):
    async def fake_execute(run, tests, target_url, credentials=None):
        run["status"] = "completed"

    async def broken_persist(*_a, **_k):
        raise RuntimeError("mongo down")

    monkeypatch.setattr(playwright_service, "_execute", fake_execute)
    monkeypatch.setattr(playwright_service, "_persist_run", broken_persist)
    await playwright_service.execute_playwright_tests(db, "org-1", [], "http://t", "run-2", "a1")

    assert (await playwright_service.load_run(db, "org-1", "run-2"))["status"] == "completed"
