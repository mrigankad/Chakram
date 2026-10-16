"""The project record follows an app from creation through push, deploy and verification."""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from app.auth.session import create_session_cookie
from app.engines import composer
from app.engines.spec import normalize_spec
from app.routes import ai_ide
from app.services import ai_ide_service, organization_service, project_service

from tests.test_composer import SEED, SPEC


async def _login(app_client, db, name="org_a"):
    org = await organization_service.create_organization(db, workos_org_id=name, name=name)
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    return org.id


async def test_an_app_becomes_a_project_and_the_stages_fill_in(app_client, db, tmp_path, monkeypatch):
    monkeypatch.setattr(ai_ide_service, "_ai_ide_root", tmp_path / "apps")
    org_id = await _login(app_client, db)

    created = (await app_client.post("/api/ai-ide/workspace/create")).json()
    ws, project_id = created["workspace_id"], created["project_id"]
    listed = (await app_client.get("/api/projects")).json()["projects"]
    assert [p["id"] for p in listed] == [project_id]
    project = (await app_client.get(f"/api/projects/{project_id}")).json()
    assert project["source"] == "app_studio" and project["workspace_id"] == ws and project["pack_id"] == "chronos"
    assert project["stages"]["verify"]["status"] == "not evaluated"
    assert project["stages"]["review"]["status"] == "not evaluated"

    # The build names it and records the spec summary.
    await ai_ide_service.update_app_info(ws, name="Clinic Appointments", status="done", spec={"entities": {"Doctor": {}, "Appointment": {}}, "pages": [{"title": "Overview"}, {"title": "Doctors"}]})
    project = (await app_client.get(f"/api/projects/{project_id}")).json()
    assert project["name"] == "Clinic Appointments" and project["build_status"] == "done"
    assert project["spec"] == {"entities": ["Doctor", "Appointment"], "pages": ["Overview", "Doctors"]}

    # Push & deploy.
    with patch.object(ai_ide_service, "init_git_and_create_repo", new=AsyncMock(return_value={"repo_url": "https://github.com/acme/clinic", "branch": "main"})):
        resp = await app_client.post("/api/ai-ide/git/init-and-push", json={"workspace_id": ws, "github_token": "ghp_x", "repo_name": "clinic", "branch": "main"})
    assert resp.status_code == 200, resp.text
    ai_ide_service._workspace_meta[ws]["repo_url"] = "https://github.com/acme/clinic"
    with patch.object(ai_ide, "_trigger_deploy", new=AsyncMock(return_value={"deploymentId": "dpl_1", "url": "clinic.vercel.app", "status": "QUEUED", "target": "production"})):
        resp = await app_client.post("/api/ai-ide/deploy", json={"workspace_id": ws, "target": "production"})
    assert resp.status_code == 200, resp.text
    project = (await app_client.get(f"/api/projects/{project_id}")).json()
    assert project["repo"]["owner"] == "acme" and project["repo"]["name"] == "clinic"
    assert project["last_deployment"]["id"] == "dpl_1" and project["stages"]["release"]["status"] == "queued"
    assert project["stages"]["review"]["status"] == "ready"

    # Test this app attaches the requirement; a finished run shows in Verify.
    spec = normalize_spec(SPEC)
    rows, _ = composer.coerce_seed(spec, SEED)
    for path, content in composer.compose(spec, rows).items():
        ai_ide_service.save_file(ws, path, content)
    requirement_id = (await app_client.post(f"/api/ai-ide/workspace/{ws}/test-cases")).json()["requirement_id"]
    project = (await app_client.get(f"/api/projects/{project_id}")).json()
    assert project["requirement_id"] == requirement_id
    assert project["stages"]["verify"]["detail"] == "No test run yet"

    now = datetime.now(timezone.utc)
    await db.test_runs.insert_one({"run_id": "run-1", "org_id": org_id, "requirement_id": requirement_id, "status": "completed", "target_url": "https://clinic.vercel.app", "created_at": now, "completed_at": now})
    await db.test_results.insert_many([
        {"run_id": "run-1", "org_id": org_id, "status": "PASS"}, {"run_id": "run-1", "org_id": org_id, "status": "PASS"},
        {"run_id": "run-1", "org_id": org_id, "status": "FAIL"}, {"run_id": "run-1", "org_id": org_id, "status": "SKIP"},
    ])
    project = (await app_client.get(f"/api/projects/{project_id}")).json()
    verify = project["stages"]["verify"]
    assert verify["status"] == "failed" and verify["run"]["pass_rate"] == 0.667 and verify["run"]["skipped"] == 1

    # Another org sees nothing.
    await _login(app_client, db, name="org_b")
    assert (await app_client.get("/api/projects")).json()["projects"] == []
    assert (await app_client.get(f"/api/projects/{project_id}")).status_code == 404


async def test_a_repository_can_be_imported_as_a_project(app_client, db):
    await _login(app_client, db)
    resp = await app_client.post("/api/projects/import", json={"repo_url": "https://github.com/acme/billing"})
    assert resp.status_code == 201
    project = resp.json()
    assert project["source"] == "repo" and project["name"] == "billing" and project["stages"]["build"]["status"] == "n/a"
    again = (await app_client.post("/api/projects/import", json={"repo_url": "https://github.com/acme/billing"})).json()
    assert again["id"] == project["id"]
    assert (await app_client.post("/api/projects/import", json={"repo_url": "https://gitlab.com/x/y"})).status_code == 400


async def test_project_updates_never_break_the_build(db):
    # note_build on an unknown workspace is a no-op, not an error.
    await project_service.note_build(db, "org", "nope", name="x")
    assert await project_service.get_by_workspace(db, "org", "nope") is None


# ── Operate and Release ───────────────────────────────────────────────────

class _Resp:
    def __init__(self, status):
        self.status_code = status


class _Client:
    statuses = {"/api/health": 200, "/api/ready": 200}

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, **kwargs):
        for path, status in self.statuses.items():
            if url.endswith(path):
                return _Resp(status)
        return _Resp(404)


async def test_health_probe_and_gate_follow_the_projects_own_evidence(app_client, db, tmp_path, monkeypatch):
    monkeypatch.setattr(ai_ide_service, "_ai_ide_root", tmp_path / "apps")
    org_id = await _login(app_client, db)
    created = (await app_client.post("/api/ai-ide/workspace/create")).json()
    ws, project_id = created["workspace_id"], created["project_id"]

    # No deployment: health says so, the gate has no data.
    health = (await app_client.post(f"/api/projects/{project_id}/health")).json()
    assert health["ok"] is False and health["url"] is None
    gate = (await app_client.get(f"/api/projects/{project_id}/gate")).json()
    assert gate["verdict"] == "INSUFFICIENT_DATA" and "test_pass_rate" in gate["not_evaluated"]

    await project_service.add_deployment(db, org_id, ws, {"id": "dpl_2", "url": "clinic.vercel.app", "status": "READY"})
    with patch.object(project_service.httpx, "AsyncClient", _Client):
        health = (await app_client.post(f"/api/projects/{project_id}/health")).json()
    assert health["ok"] is True and health["url"] == "https://clinic.vercel.app" and health["ready"] == 200

    class _FrontendOnly(_Client):
        statuses = {"/api/health": 404}

    with patch.object(project_service.httpx, "AsyncClient", _FrontendOnly):
        health = (await app_client.post(f"/api/projects/{project_id}/health")).json()
    assert health["ok"] is True and "frontend-only" in health["message"]

    class _Down(_Client):
        async def get(self, url, **kwargs):
            raise project_service.httpx.ConnectError("boom")

    with patch.object(project_service.httpx, "AsyncClient", _Down):
        health = (await app_client.post(f"/api/projects/{project_id}/health")).json()
    assert health["ok"] is False and "Could not reach" in health["message"]
    project = (await app_client.get(f"/api/projects/{project_id}")).json()
    assert project["last_health"]["ok"] is False

    # A passing run makes the gate GO; a failing deployment health makes it CAUTION.
    requirement_id = "req-1"
    await project_service.set_requirement(db, org_id, ws, requirement_id)
    now = datetime.now(timezone.utc)
    await db.test_runs.insert_one({"run_id": "run-2", "org_id": org_id, "requirement_id": requirement_id, "status": "completed", "created_at": now, "completed_at": now})
    await db.test_results.insert_many([{"run_id": "run-2", "org_id": org_id, "status": "PASS"} for _ in range(5)])
    gate = (await app_client.get(f"/api/projects/{project_id}/gate")).json()
    assert gate["verdict"] == "CAUTION" and gate["score"] == 100 and "health check" in gate["reason"]

    with patch.object(project_service.httpx, "AsyncClient", _Client):
        await app_client.post(f"/api/projects/{project_id}/health")
    gate = (await app_client.get(f"/api/projects/{project_id}/gate")).json()
    assert gate["verdict"] == "GO" and gate["signals"]["deployment_health"] is True

    await db.test_results.insert_many([{"run_id": "run-2", "org_id": org_id, "status": "FAIL"} for _ in range(3)])
    gate = (await app_client.get(f"/api/projects/{project_id}/gate")).json()
    assert gate["verdict"] == "NO_GO" and gate["score"] == 62

    assert (await app_client.get("/api/projects/000000000000000000000000/gate")).status_code == 404
