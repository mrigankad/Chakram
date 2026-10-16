"""Jira does two jobs: import stories as requirements, write results back. Nothing else."""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from bson import ObjectId

from app.auth.session import create_session_cookie
from app.routes import jira as jira_routes
from app.services import ai_service, organization_service

STORIES = [
    {"key": "P-1", "summary": "Reset password", "description": "User clicks Forgot password and gets an email.", "status": "To Do", "priority": "High", "assignee": "A", "issue_type": "Story", "labels": []},
    {"key": "P-2", "summary": "Export report", "description": "", "status": "To Do", "priority": "Low", "assignee": "B", "issue_type": "Story", "labels": []},
]
AI_CASES = {"functional": [{"tc_id": "TC-001", "name": "Reset works", "description": "d", "expected": "e", "severity": "High"}], "edge": []}


async def _login(app_client, db, name="org_a"):
    org = await organization_service.create_organization(db, workos_org_id=name, name=name)
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    return org.id


def test_requirement_text_keeps_the_key_and_description():
    assert jira_routes.requirement_text(STORIES[0]) == "P-1: Reset password\n\nUser clicks Forgot password and gets an email."
    assert jira_routes.requirement_text(STORIES[1]) == "P-2: Export report"


async def test_import_creates_one_requirement_per_story_and_reports_each(app_client, db):
    org_id = await _login(app_client, db)
    calls = []

    async def fake_generate(text, instructions=None):
        calls.append(text)
        if text.startswith("P-2"):
            raise RuntimeError("provider down")
        return AI_CASES

    with patch("app.routes.jira.jira_service.get_sprint_stories", new=AsyncMock(return_value=STORIES)), \
         patch.object(ai_service, "generate_test_cases", new=fake_generate):
        resp = await app_client.post("/api/jira/stories/import", json={"project": "P", "keys": ["p-1", "P-2", "P-9", "P-1"]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    by_key = {r["key"]: r for r in body["results"]}
    assert body["created"] == 1 and body["failed"] == 2
    assert by_key["P-1"]["status"] == "created" and by_key["P-1"]["total_tests"] == 1
    assert by_key["P-2"]["status"] == "failed" and "provider down" in by_key["P-2"]["error"]
    assert by_key["P-9"]["status"] == "not_found"
    assert len(calls) == 2  # the duplicate key was imported once

    listed = (await app_client.get("/api/requirements")).json()
    assert len(listed) == 1 and listed[0]["source"] == "jira" and listed[0]["jira_key"] == "P-1"
    assert listed[0]["text"].startswith("P-1: Reset password")
    assert await db.test_cases.count_documents({"org_id": org_id, "requirement_id": listed[0]["id"]}) == 1
    # The failed one is recorded as failed, not hidden.
    failed = (await app_client.get("/api/requirements?status=failed")).json()
    assert len(failed) == 1 and failed[0]["text"].startswith("P-2")

    # Importing again returns the existing requirement instead of a second copy.
    with patch("app.routes.jira.jira_service.get_sprint_stories", new=AsyncMock(return_value=STORIES)), \
         patch.object(ai_service, "generate_test_cases", new=fake_generate):
        again = (await app_client.post("/api/jira/stories/import", json={"project": "P", "keys": ["P-1"]})).json()
    assert again["results"] == [{"key": "P-1", "status": "exists", "requirement_id": listed[0]["id"]}]


async def test_results_are_written_back_as_one_comment_from_the_latest_run(app_client, db):
    org_id = await _login(app_client, db)
    req = await db.requirements.insert_one({"org_id": org_id, "text": "P-1: Reset password", "status": "processed", "created_at": datetime.now(timezone.utc), "source": "jira", "jira_key": "P-1"})
    req_id = str(req.inserted_id)

    # Nothing has run: 409 with what to do.
    resp = await app_client.post("/api/jira/stories/P-1/post-results", json={"requirement_id": req_id})
    assert resp.status_code == 409 and "Test Execution" in resp.json()["detail"]
    assert (await app_client.post("/api/jira/stories/P-1/post-results", json={"requirement_id": str(ObjectId())})).status_code == 404

    done = datetime(2026, 10, 16, 9, 30, tzinfo=timezone.utc)
    await db.test_runs.insert_one({"run_id": "run-old", "org_id": org_id, "requirement_id": req_id, "status": "completed", "created_at": datetime(2026, 10, 1, tzinfo=timezone.utc)})
    await db.test_results.insert_many([{"run_id": "run-old", "org_id": org_id, "status": "FAIL"}])
    await db.test_runs.insert_one({"run_id": "run-new", "org_id": org_id, "requirement_id": req_id, "status": "completed", "target_url": "https://app.test", "created_at": done, "completed_at": done})
    await db.test_results.insert_many([{"run_id": "run-new", "org_id": org_id, "status": s} for s in ("PASS", "PASS", "FAIL", "SKIP")])

    add_comment = AsyncMock(return_value={"id": "c-77", "self": "x"})
    with patch("app.routes.jira.jira_service.add_issue_comment", new=add_comment):
        resp = await app_client.post("/api/jira/stories/P-1/post-results", json={"requirement_id": req_id})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["comment_id"] == "c-77" and body["run"]["run_id"] == "run-new"
    issue_key, text = add_comment.await_args.args
    assert issue_key == "P-1"
    assert "2 passed, 1 failed, 1 skipped. Pass rate 67% of 3 executed." in text
    assert "Chakram test results (2026-10-16 09:30 UTC)" in text and "Target: https://app.test" in text
    assert "Run run-new for requirement P-1." in text

    listed = (await app_client.get("/api/requirements")).json()
    assert listed[0]["jira_results_posted_at"] is not None

    # Another org cannot post against this requirement.
    await _login(app_client, db, name="org_b")
    assert (await app_client.post("/api/jira/stories/P-1/post-results", json={"requirement_id": req_id})).status_code == 404


def test_sprint_analytics_are_gone():
    import importlib

    assert not hasattr(ai_service, "generate_sprint_summary") and not hasattr(ai_service, "sprint_summary_facts")
    assert importlib.util.find_spec("app.routes.sprint") is None
    assert not any(r.path.startswith("/jira/analyze-sprint") for r in jira_routes.router.routes)
