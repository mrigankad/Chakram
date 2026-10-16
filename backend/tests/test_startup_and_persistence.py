"""Startup with MongoDB down, the 503 handler, core indexes, and persisted test suites."""
from unittest.mock import AsyncMock, patch

from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError

import main
from app import database
from app.auth.session import create_session_cookie
from app.services import organization_service, test_gen_service


def _index_keys(info: dict) -> list[list[tuple]]:
    return [list(spec["key"]) for spec in info.values()]


# ── lifespan ──────────────────────────────────────────────────────────────

async def test_startup_skips_index_and_seed_steps_when_mongo_is_unreachable(caplog):
    steps = AsyncMock()
    with patch.object(main, "connect_db", new=AsyncMock(return_value=False)), \
         patch.object(main, "close_db", new=AsyncMock()), \
         patch.object(main, "_ensure_indexes_and_seed", new=steps), \
         caplog.at_level("ERROR", logger="aidlc"):
        async with main.lifespan(main.app):
            pass
    steps.assert_not_awaited()
    errors = [r for r in caplog.records if r.levelname == "ERROR"]
    assert len(errors) == 1
    assert "MongoDB is unreachable" in errors[0].getMessage()


async def test_startup_runs_index_and_seed_steps_when_mongo_answers():
    steps = AsyncMock()
    with patch.object(main, "connect_db", new=AsyncMock(return_value=True)), \
         patch.object(main, "close_db", new=AsyncMock()), \
         patch.object(main, "_ensure_indexes_and_seed", new=steps):
        async with main.lifespan(main.app):
            pass
    steps.assert_awaited_once()


async def test_connect_db_reports_whether_the_ping_succeeded(monkeypatch):
    class _Client:
        def __init__(self, ok):
            self.admin = self
            self._ok = ok

        async def command(self, name):
            if not self._ok:
                raise ServerSelectionTimeoutError("no servers")
            return {"ok": 1}

    monkeypatch.setattr(database, "_client", None)
    monkeypatch.setattr(database, "_make_client", lambda: _Client(True))
    assert await database.connect_db() is True

    monkeypatch.setattr(database, "_make_client", lambda: _Client(False))
    assert await database.connect_db() is False
    assert database._client is None


async def test_index_and_seed_steps_create_the_new_indexes(db):
    await main._ensure_indexes_and_seed()

    assert [("org_id", 1), ("status", 1), ("created_at", -1)] in _index_keys(await db.requirements.index_information())
    assert [("org_id", 1), ("requirement_id", 1), ("tc_id", 1)] in _index_keys(await db.test_cases.index_information())
    assert [("org_id", 1), ("created_at", -1)] in _index_keys(await db.api_cost_logs.index_information())
    assert [("org_id", 1), ("triggered_at", -1)] in _index_keys(await db.incidents.index_information())
    assert [("org_id", 1), ("workspace_id", 1), ("created_at", 1)] in _index_keys(
        await db[test_gen_service.SUITES_COLLECTION].index_information()
    )


# ── 503 on database connection errors ─────────────────────────────────────

async def test_server_selection_timeout_during_a_request_is_503(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="user", org_id=org.id))

    error = ServerSelectionTimeoutError("localhost:27017: connection refused, Timeout: 10.0s")
    with patch.object(organization_service, "get_by_id", new=AsyncMock(side_effect=error)):
        resp = await app_client.get("/api/requirements")
    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert "database" in detail.lower()
    assert "localhost:27017" not in detail


async def test_connection_failure_inside_a_route_is_503(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="user", org_id=org.id))

    with patch("app.routes.requirements.requirement_service.list_requirements",
               new=AsyncMock(side_effect=ConnectionFailure("connection closed"))):
        resp = await app_client.get("/api/requirements")
    assert resp.status_code == 503

    with patch("app.routes.requirements.requirement_service.create_requirement",
               new=AsyncMock(side_effect=ServerSelectionTimeoutError("no servers"))):
        resp = await app_client.post("/api/requirements", json={"text": "A requirement long enough"})
    assert resp.status_code == 503


async def test_health_still_answers(app_client):
    assert (await app_client.get("/health")).status_code == 200


# ── saved test suites live in MongoDB ─────────────────────────────────────

async def test_suites_are_stored_in_mongo_not_in_process_memory(db):
    assert not hasattr(test_gen_service, "_TEST_SUITES")

    info = await test_gen_service.save_test_suite(
        db, "org-1", workspace_id="w1", name="Smoke", scope="single_file",
        tests=[{"name": "t1"}, {"name": "t2"}], target_url="http://app", commit_sha="abc",
    )
    assert info["test_count"] == 2
    assert "tests" not in info and "_id" not in info

    stored = await db[test_gen_service.SUITES_COLLECTION].find_one({"_id": info["suite_id"]})
    assert stored["org_id"] == "org-1"
    assert stored["tests"] == [{"name": "t1"}, {"name": "t2"}]

    full = await test_gen_service.get_test_suite(db, "org-1", info["suite_id"])
    assert full["tests"] == [{"name": "t1"}, {"name": "t2"}]
    assert full["suite_id"] == info["suite_id"]
    assert "_id" not in full


async def test_suite_functions_are_scoped_by_org_and_workspace(db):
    a = await test_gen_service.save_test_suite(db, "org-1", "w1", "First", "single_file", [{"name": "t"}])
    b = await test_gen_service.save_test_suite(db, "org-1", "w1", "Second", "commits", [])
    await test_gen_service.save_test_suite(db, "org-1", "w2", "Other workspace", "commits", [])
    await test_gen_service.save_test_suite(db, "org-2", "w1", "Other org", "commits", [])

    listed = await test_gen_service.list_test_suites(db, "org-1", "w1")
    assert [s["suite_id"] for s in listed] == [a["suite_id"], b["suite_id"]]
    assert all("tests" not in s and "_id" not in s for s in listed)

    assert await test_gen_service.get_test_suite(db, "org-2", a["suite_id"]) is None
    assert await test_gen_service.delete_test_suite(db, "org-2", a["suite_id"]) is False
    assert await test_gen_service.delete_test_suite(db, "org-1", a["suite_id"]) is True
    assert await test_gen_service.delete_test_suite(db, "org-1", a["suite_id"]) is False
    assert [s["name"] for s in await test_gen_service.list_test_suites(db, "org-1", "w1")] == ["Second"]


async def test_suite_routes_round_trip(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="user", org_id=org.id))

    resp = await app_client.post("/api/tests/workspace-suites", json={
        "workspace_id": "w1", "name": "Smoke", "scope": "single_file", "tests": [{"name": "t1"}],
    })
    assert resp.status_code == 200
    suite_id = resp.json()["suite_id"]
    assert await db[test_gen_service.SUITES_COLLECTION].count_documents({"org_id": org.id}) == 1

    listed = (await app_client.get("/api/tests/workspace-suites", params={"workspace_id": "w1"})).json()
    assert [s["suite_id"] for s in listed] == [suite_id]
    assert (await app_client.get(f"/api/tests/workspace-suites/{suite_id}")).json()["tests"] == [{"name": "t1"}]
    assert (await app_client.delete(f"/api/tests/workspace-suites/{suite_id}")).json() == {"deleted": True}
    assert (await app_client.get(f"/api/tests/workspace-suites/{suite_id}")).status_code == 404
