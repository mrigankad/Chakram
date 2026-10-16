"""
Cross-tenant isolation tests for every remaining collection-owning route
(Task 10). Each test creates two organizations, seeds/creates a document
as org A, and asserts org B's read endpoint for that resource cannot see it.
"""
from datetime import datetime, timedelta, timezone

import pytest
from unittest.mock import patch

from app.auth.session import create_session_cookie
from app.services import organization_service


def _cookies(app_client, org_id: str, user_id: str = "user") -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    app_client.cookies.set("aidlc_session", token)


# ── test_cases ────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_org_a_cannot_see_org_b_test_cases(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    await db.test_cases.insert_one({
        "org_id": org_a.id, "tc_id": "TC-1", "name": "n", "description": "d",
        "severity": "High", "expected": "e", "category": "functional",
        "requirement_id": "r1", "created_at": datetime.utcnow(),
    })

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/test-cases")
    assert resp.status_code == 200
    assert resp.json() == []

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/test-cases")
    assert len(resp.json()) == 1


@pytest.mark.anyio
async def test_org_a_cannot_see_org_b_test_case_grouped(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    await db.test_cases.insert_one({
        "org_id": org_a.id, "tc_id": "TC-1", "name": "n", "description": "d",
        "severity": "High", "expected": "e", "category": "functional",
        "requirement_id": "r1", "created_at": datetime.utcnow(),
    })

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/test-cases/grouped")
    assert resp.status_code == 200
    assert all(len(v) == 0 for v in resp.json().values())

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/test-cases/grouped")
    assert sum(len(v) for v in resp.json().values()) == 1


@pytest.mark.anyio
async def test_org_a_cannot_get_or_update_org_b_test_case_by_id(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    inserted = await db.test_cases.insert_one({
        "org_id": org_a.id, "tc_id": "TC-1", "name": "n", "description": "d",
        "severity": "High", "expected": "e", "category": "functional",
        "requirement_id": "r1", "created_at": datetime.utcnow(),
    })
    case_id = str(inserted.inserted_id)

    _cookies(app_client, org_b.id)
    resp = await app_client.get(f"/api/test-cases/{case_id}")
    assert resp.status_code == 404

    resp = await app_client.put(f"/api/test-cases/{case_id}", json={"name": "hacked"})
    assert resp.status_code == 404

    doc = await db.test_cases.find_one({"tc_id": "TC-1"})
    assert doc["name"] == "n"  # unchanged

    _cookies(app_client, org_a.id)
    resp = await app_client.get(f"/api/test-cases/{case_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == case_id

    # tc_id is a display label, not an identifier; malformed ids are a 404, not a 500.
    resp = await app_client.get("/api/test-cases/TC-1")
    assert resp.status_code == 404
    resp = await app_client.put("/api/test-cases/TC-1", json={"name": "hacked"})
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_same_tc_id_in_two_requirements_is_edited_independently(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")

    ids = {}
    for requirement_id in ("r1", "r2"):
        inserted = await db.test_cases.insert_one({
            "org_id": org.id, "tc_id": "TC-001", "name": f"original {requirement_id}",
            "description": "d", "severity": "High", "expected": "e", "category": "functional",
            "requirement_id": requirement_id, "created_at": datetime.utcnow(),
        })
        ids[requirement_id] = str(inserted.inserted_id)

    _cookies(app_client, org.id)
    resp = await app_client.put(f"/api/test-cases/{ids['r2']}", json={"name": "edited r2"})
    assert resp.status_code == 200
    assert resp.json()["requirement_id"] == "r2"
    assert resp.json()["name"] == "edited r2"

    r1 = await db.test_cases.find_one({"requirement_id": "r1"})
    r2 = await db.test_cases.find_one({"requirement_id": "r2"})
    assert r1["name"] == "original r1"
    assert r2["name"] == "edited r2"

    resp = await app_client.get(f"/api/test-cases/{ids['r1']}")
    assert resp.json()["name"] == "original r1"


# ── test_results (test_execution) ──────────────────────────────────────────

@pytest.mark.anyio
async def test_org_a_cannot_see_org_b_test_results(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    await db.test_results.insert_one({
        "org_id": org_a.id, "tc_id": "TC-1", "name": "n", "status": "PASS",
        "duration": 1.0, "error_message": None, "run_id": "run-1",
        "timestamp": datetime.utcnow(),
    })

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/test-execution/results")
    assert resp.status_code == 200
    assert resp.json() == []

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/test-execution/results")
    assert len(resp.json()) == 1


# ── synthetic_datasets ───────────────────────────────────────────────────

@pytest.mark.anyio
async def test_org_a_cannot_see_org_b_synthetic_datasets(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    await db.synthetic_datasets.insert_one({
        "org_id": org_a.id, "requirement_id": "r1", "requirement_text": "t",
        "count": 1, "schema_fields": [], "rows": [{}],
        "generated_at": datetime.utcnow(),
    })

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/synthetic-data")
    assert resp.status_code == 200
    assert resp.json() == []

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/synthetic-data")
    assert len(resp.json()) == 1


# ── prioritized_tests ────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_org_a_cannot_see_org_b_prioritized_tests(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    await db.test_results.insert_one({
        "org_id": org_a.id, "test_case_id": "case-1", "tc_id": "TC-1", "name": "n",
        "severity": "High", "status": "FAIL", "duration": 1.0, "error_message": "boom",
        "run_id": "run-1", "timestamp": datetime.utcnow(),
    })

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/prioritization")
    assert resp.status_code == 200
    assert resp.json() == []

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/prioritization")
    assert len(resp.json()) == 1


# ── incidents ─────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_org_a_cannot_see_org_b_incidents(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    with patch("app.routes.incidents.investigate_incident", return_value={
        "root_cause": "x", "evidence": [], "immediate_action": "y",
        "prevention_action": "z", "confidence": 0.5,
    }):
        _cookies(app_client, org_a.id)
        resp = await app_client.post("/api/incidents", json={"anomaly": {"dimension": "d"}})
        assert resp.status_code == 201
        incident_id = resp.json()["id"]

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/incidents")
    assert resp.status_code == 200
    assert resp.json() == []

    resp = await app_client.get(f"/api/incidents/{incident_id}")
    assert resp.status_code == 404

    resp = await app_client.put(f"/api/incidents/{incident_id}/resolve", json={})
    assert resp.status_code == 404

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/incidents")
    assert len(resp.json()) == 1


# ── snippets (copilot) ───────────────────────────────────────────────────

@pytest.mark.anyio
async def test_org_a_cannot_see_org_b_snippets(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    _cookies(app_client, org_a.id)
    resp = await app_client.post("/api/copilot/snippets", json={
        "workspace_id": "w1", "name": "n", "code": "c", "language": "python", "tags": [],
    })
    assert resp.status_code == 200
    snippet_id = resp.json()["id"]

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/copilot/snippets")
    assert resp.status_code == 200
    assert resp.json() == []

    resp = await app_client.delete(f"/api/copilot/snippets/{snippet_id}")
    assert resp.status_code == 404

    doc = await db.snippets.find_one({"name": "n"})
    assert doc is not None  # not deleted by org B

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/copilot/snippets")
    assert len(resp.json()) == 1


# ── repo_baselines ────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_org_a_cannot_see_org_b_repo_baseline(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    await db.repo_baselines.insert_one({
        "org_id": org_a.id, "repo_id": "repo-1", "github_url": "https://github.com/x/y",
        "sessions": [], "tests": [], "last_commit_sha": "", "updated_at": datetime.now(timezone.utc).isoformat(),
    })

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/baseline/repo-1")
    assert resp.status_code == 404

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/baseline/repo-1")
    assert resp.status_code == 200
    assert resp.json()["repo_id"] == "repo-1"


# ── api_cost_logs ─────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_org_a_cannot_see_org_b_cost_logs(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    await db.api_cost_logs.insert_one({
        "org_id": org_a.id, "task_name": "t", "prompt_tokens": 1, "completion_tokens": 1,
        "total_cost_usd": 0.01, "created_at": datetime.utcnow(),
    })

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/cost-logs")
    assert resp.status_code == 200
    assert resp.json()["logs"] == []
    assert resp.json()["total"] == 0

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/cost-logs")
    assert resp.json()["total"] == 1


# ── repo_analyses / playwright_tests / playwright_runs ───────────────────

@pytest.mark.anyio
async def test_org_a_cannot_see_org_b_repo_analysis(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    await db.repo_analyses.insert_one({
        "_id": "analysis-1", "org_id": org_a.id, "github_url": "https://github.com/x/y",
        "target_url": "http://localhost:3000", "created_at": datetime.now(timezone.utc),
    })
    await db.playwright_tests.insert_one({
        "_id": "test-1", "org_id": org_a.id, "analysis_id": "analysis-1", "name": "n",
    })
    await db.playwright_runs.insert_one({
        "_id": "run-1", "org_id": org_a.id, "run_id": "run-1", "analysis_id": "analysis-1",
        "status": "completed", "total": 1, "passed": 1, "failed": 0,
        "started_at": "now", "completed_at": "now", "results": [],
    })

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/repo/analyses/analysis-1")
    assert resp.status_code == 404

    resp = await app_client.get("/api/repo/analyses/analysis-1/tests")
    assert resp.status_code == 200
    assert resp.json() == []

    resp = await app_client.get("/api/repo/runs")
    assert resp.status_code == 200
    assert resp.json()["runs"] == []

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/repo/analyses/analysis-1")
    assert resp.status_code == 200

    resp = await app_client.get("/api/repo/runs")
    assert len(resp.json()["runs"]) == 1


# ── workspace test suites (test_gen) ───────────────────────────────────────

@pytest.mark.anyio
async def test_org_a_cannot_see_or_delete_org_b_test_suite(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    _cookies(app_client, org_a.id)
    resp = await app_client.post("/api/tests/workspace-suites", json={
        "workspace_id": "w1", "name": "n", "scope": "single_file",
        "tests": [{"name": "t1"}],
    })
    assert resp.status_code == 200
    suite_id = resp.json()["suite_id"]

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/tests/workspace-suites", params={"workspace_id": "w1"})
    assert resp.status_code == 200
    assert resp.json() == []

    resp = await app_client.get(f"/api/tests/workspace-suites/{suite_id}")
    assert resp.status_code == 404

    resp = await app_client.delete(f"/api/tests/workspace-suites/{suite_id}")
    assert resp.status_code == 404

    _cookies(app_client, org_a.id)
    resp = await app_client.get(f"/api/tests/workspace-suites/{suite_id}")
    assert resp.status_code == 200
    assert resp.json()["suite_id"] == suite_id

    resp = await app_client.get("/api/tests/workspace-suites", params={"workspace_id": "w1"})
    assert len(resp.json()) == 1


@pytest.mark.anyio
async def test_generate_tests_requires_auth(app_client, db):
    resp = await app_client.post("/api/tests/generate", json={
        "workspace_id": "w1", "file_path": "f.py", "content": "x",
        "gaps": [], "framework": "pytest", "existing_tests": "",
    })
    assert resp.status_code == 401


# ── baseline sync (org B cannot append tests to org A's baseline) ─────────

@pytest.mark.anyio
async def test_org_b_sync_does_not_touch_org_a_baseline(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    await db.repo_baselines.insert_one({
        "org_id": org_a.id, "repo_id": "repo-sync", "github_url": "https://github.com/x/y",
        "sessions": [], "tests": [], "last_commit_sha": "", "updated_at": datetime.now(timezone.utc).isoformat(),
    })

    _cookies(app_client, org_b.id)
    resp = await app_client.post("/api/baseline/sync", json={
        "repo_id": "repo-sync",
        "tests": [{
            "name": "t", "description": "d", "category": "ui_component",
        }],
        "source": "workspace",
    })
    assert resp.status_code == 200
    assert resp.json()["added_count"] == 0  # org B has no such baseline; nothing appended

    doc = await db.repo_baselines.find_one({"repo_id": "repo-sync", "org_id": org_a.id})
    assert doc["tests"] == []  # org A's baseline untouched


# ── repo test update, live execution polling, job polling ─────────────────

@pytest.mark.anyio
async def test_org_a_cannot_update_org_b_playwright_test(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    await db.playwright_tests.insert_one({
        "_id": "test-1", "org_id": org_a.id, "analysis_id": "analysis-1", "name": "n",
    })

    _cookies(app_client, org_b.id)
    resp = await app_client.put("/api/repo/tests/test-1", json={"name": "hacked"})
    assert resp.status_code == 404

    doc = await db.playwright_tests.find_one({"_id": "test-1"})
    assert doc["name"] == "n"

    _cookies(app_client, org_a.id)
    resp = await app_client.put("/api/repo/tests/test-1", json={"name": "renamed"})
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_playwright_test_update_cannot_overwrite_org_id(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    await db.playwright_tests.insert_one({
        "_id": "test-allowlist-1",
        "org_id": org_a.id,
        "analysis_id": "analysis-1",
        "name": "n",
        "description": "d",
    })

    _cookies(app_client, org_a.id)
    resp = await app_client.put(
        "/api/repo/tests/test-allowlist-1",
        json={"name": "renamed", "org_id": "hacked", "analysis_id": "stolen"},
    )
    assert resp.status_code == 200
    doc = await db.playwright_tests.find_one({"_id": "test-allowlist-1"})
    assert doc["org_id"] == org_a.id
    assert doc["analysis_id"] == "analysis-1"
    assert doc["name"] == "renamed"

    resp = await app_client.put(
        "/api/repo/tests/test-allowlist-1",
        json={"org_id": "hacked"},
    )
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_org_a_cannot_poll_org_b_execution_run(app_client, db):
    from app.services import playwright_service

    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    playwright_service._runs["run-poll-1"] = {
        "run_id": "run-poll-1", "org_id": org_a.id, "analysis_id": "a1",
        "status": "running", "results": [], "total": 1, "passed": 0, "failed": 0,
        "started_at": "now", "completed_at": None, "error": None,
    }

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/repo/execution/run-poll-1")
    assert resp.status_code == 404

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/repo/execution/run-poll-1")
    assert resp.status_code == 200
    assert resp.json()["run_id"] == "run-poll-1"


@pytest.mark.anyio
async def test_org_a_cannot_poll_org_b_analysis_job(app_client, db):
    from app.services import analysis_runner

    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    analysis_runner._jobs["job-poll-1"] = {
        "job_id": "job-poll-1", "org_id": org_a.id, "status": "running", "step": "cloning",
        "logs": [], "github_url": "https://github.com/x/y", "target_url": "http://localhost:3000",
        "result": None, "error": None, "started_at": "now", "completed_at": None,
    }

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/repo/jobs/job-poll-1")
    assert resp.status_code == 404

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/repo/jobs/job-poll-1")
    assert resp.status_code == 200
    assert resp.json()["job_id"] == "job-poll-1"


# ── dashboard (aggregation across collections) ────────────────────────────

@pytest.mark.anyio
async def test_dashboard_stats_are_org_scoped(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    await db.test_cases.insert_one({
        "org_id": org_a.id, "tc_id": "TC-1", "name": "n", "description": "d",
        "severity": "High", "expected": "e", "category": "functional",
        "requirement_id": "r1", "created_at": datetime.utcnow(),
    })
    # Two consecutive real failures of a High case: high priority and a known failure.
    for minutes_ago, run in ((2, "run-1"), (1, "run-2")):
        await db.test_results.insert_one({
            "org_id": org_a.id, "test_case_id": "case-1", "tc_id": "TC-1", "name": "login flow",
            "severity": "High", "status": "FAIL", "duration": 0.4, "run_id": run,
            "timestamp": datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        })
    # A row from the retired simulator (no test_case_id) must not reach the dashboard.
    await db.test_results.insert_one({
        "org_id": org_a.id, "tc_id": "TC-9", "name": "simulated", "status": "PASS",
        "duration": 0.1, "run_id": "old", "timestamp": datetime.now(timezone.utc),
    })

    _cookies(app_client, org_b.id)
    resp = await app_client.get("/api/dashboard/stats")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_tests"] == 0
    assert body["high_priority"] == 0
    assert body["known_failures"] == 0
    assert body["recent_activity"] == []
    assert all(item["count"] == 0 for item in body["severity_breakdown"])

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/dashboard/stats")
    body = resp.json()
    assert body["total_tests"] == 1
    assert body["high_priority"] == 1
    assert body["known_failures"] == 1
    sev = {item["severity"]: item["count"] for item in body["severity_breakdown"]}
    assert sev["High"] == 1
    assert [a["name"] for a in body["recent_activity"]] == ["login flow", "login flow"]
    assert body["recent_activity"][0]["status"] == "FAIL"


# ── auth required ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("method,path", [
    ("GET", "/api/test-cases"),
    ("GET", "/api/test-execution/results"),
    ("GET", "/api/synthetic-data"),
    ("GET", "/api/prioritization"),
    ("GET", "/api/incidents"),
    ("GET", "/api/copilot/snippets"),
    ("GET", "/api/baseline/repo-1"),
    ("GET", "/api/cost-logs"),
    ("GET", "/api/repo/analyses/analysis-1"),
    ("GET", "/api/dashboard/stats"),
    ("PATCH", "/api/auth/me"),
    ("GET", "/api/tests/workspace-suites/suite-1"),
    ("DELETE", "/api/tests/workspace-suites/suite-1"),
    ("GET", "/api/repo/execution/run-1"),
    ("GET", "/api/repo/jobs/job-1"),
])
@pytest.mark.anyio
async def test_endpoints_require_auth(app_client, db, method, path):
    resp = await app_client.request(method, path)
    assert resp.status_code == 401
