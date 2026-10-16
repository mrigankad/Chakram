"""Workspace registries live in MongoDB: a restart re-attaches to files still on disk, or answers 410."""
from pathlib import Path

import pytest

from app.auth.session import create_session_cookie
from app.services import ai_ide_service, organization_service, workspace_service


@pytest.fixture(autouse=True)
def _clean_memory():
    workspace_service._WORKSPACES.clear()
    ai_ide_service._workspaces.clear()
    ai_ide_service._workspace_meta.clear()
    yield
    workspace_service._WORKSPACES.clear()
    ai_ide_service._workspaces.clear()
    ai_ide_service._workspace_meta.clear()


async def _login(app_client, db, name="org_w"):
    org = await organization_service.create_organization(db, workos_org_id=name, name=name)
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    return org


async def _connect(app_client, monkeypatch, tmp_path: Path, pat: str | None = None) -> str:
    """POST /workspace/connect with the clone replaced by writing one file."""
    monkeypatch.setattr(workspace_service, "WORKSPACE_TEMP_DIR", str(tmp_path))

    def fake_clone(repo_url, clone_dir, branch, pat):
        Path(clone_dir).mkdir(parents=True)
        (Path(clone_dir) / "app.py").write_text("print('hi')\n", encoding="utf-8")

    monkeypatch.setattr(workspace_service, "_clone_with_pat", fake_clone)
    resp = await app_client.post(
        "/api/workspace/connect", json={"github_url": "https://github.com/o/r", "branch": "main", "pat": pat}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["workspace_id"]


# ── cloned-repo workspaces ────────────────────────────────────────────────

async def test_connect_registers_the_workspace_without_the_pat(app_client, db, monkeypatch, tmp_path):
    org = await _login(app_client, db)
    ws_id = await _connect(app_client, monkeypatch, tmp_path, pat="ghp_SECRETTOKEN")

    doc = await db.workspaces.find_one({"_id": ws_id})
    assert doc["org_id"] == org.id and doc["repo_url"] == "https://github.com/o/r" and doc["branch"] == "main"
    assert Path(doc["clone_dir"]).is_dir()
    assert doc["created_at"] and doc["last_used_at"]
    assert "ghp_SECRETTOKEN" not in str(doc) and "pat" not in doc


async def test_workspace_is_reattached_after_a_restart(app_client, db, monkeypatch, tmp_path):
    await _login(app_client, db)
    ws_id = await _connect(app_client, monkeypatch, tmp_path, pat="ghp_SECRETTOKEN")

    workspace_service._WORKSPACES.clear()  # the process restarted

    resp = await app_client.get(f"/api/workspace/{ws_id}/file", params={"path": "app.py"})
    assert resp.status_code == 200
    assert resp.json()["content"] == "print('hi')\n"
    assert workspace_service._WORKSPACES[ws_id]["pat"] is None  # the token did not come back

    # a body-addressed route re-attaches too
    workspace_service._WORKSPACES.clear()
    resp = await app_client.post("/api/impact/workspace-graph", json={"workspace_id": ws_id})
    assert resp.status_code == 200


async def test_workspace_whose_files_are_gone_is_410_expired(app_client, db, monkeypatch, tmp_path):
    import shutil

    await _login(app_client, db)
    ws_id = await _connect(app_client, monkeypatch, tmp_path)
    shutil.rmtree(tmp_path / ws_id)

    for clear_memory in (False, True):  # same process, then after a restart
        if clear_memory:
            workspace_service._WORKSPACES.clear()
        resp = await app_client.get(f"/api/workspace/{ws_id}/tree")
        assert resp.status_code == 410
        assert "open the repository again" in resp.json()["detail"].lower()

    assert (await app_client.get("/api/git/status", params={"workspace_id": ws_id})).status_code == 410


async def test_other_org_and_unknown_ids_stay_404(app_client, db, monkeypatch, tmp_path):
    await _login(app_client, db, "org_owner")
    ws_id = await _connect(app_client, monkeypatch, tmp_path)
    workspace_service._WORKSPACES.clear()

    await _login(app_client, db, "org_other")
    assert (await app_client.get(f"/api/workspace/{ws_id}/tree")).status_code == 404
    assert ws_id not in workspace_service._WORKSPACES
    assert (await app_client.get("/api/workspace/nope/tree")).status_code == 404


async def test_saved_suites_stay_readable_after_the_workspace_expires(app_client, db, monkeypatch, tmp_path):
    import shutil

    await _login(app_client, db)
    ws_id = await _connect(app_client, monkeypatch, tmp_path)
    saved = await app_client.post("/api/tests/workspace-suites", json={
        "workspace_id": ws_id, "name": "s", "scope": "app", "tests": [{"name": "t1"}],
    })
    assert saved.status_code == 200
    shutil.rmtree(tmp_path / ws_id)
    workspace_service._WORKSPACES.clear()

    listed = await app_client.get("/api/tests/workspace-suites", params={"workspace_id": ws_id})
    assert listed.status_code == 200 and len(listed.json()) == 1


async def test_delete_removes_the_registry_entry(app_client, db, monkeypatch, tmp_path):
    await _login(app_client, db)
    ws_id = await _connect(app_client, monkeypatch, tmp_path)
    assert (await app_client.delete(f"/api/workspace/{ws_id}")).status_code == 200
    assert await db.workspaces.find_one({"_id": ws_id}) is None
    assert not (tmp_path / ws_id).exists()
    assert (await app_client.get(f"/api/workspace/{ws_id}/tree")).status_code == 404


# ── AI IDE workspaces ─────────────────────────────────────────────────────

@pytest.fixture
def ide_root(tmp_path, monkeypatch):
    async def template():
        return {"package.json": "{}\n", "src/App.tsx": "export default function App() { return null; }\n"}

    monkeypatch.setattr(ai_ide_service, "_ai_ide_root", tmp_path)
    monkeypatch.setattr(ai_ide_service, "_get_template_cached", template)
    return tmp_path


async def test_ai_ide_workspace_is_registered_and_reattached(app_client, db, ide_root):
    org = await _login(app_client, db)
    ws_id = (await app_client.post("/api/ai-ide/workspace/create")).json()["workspace_id"]

    doc = await db.ai_ide_workspaces.find_one({"_id": ws_id})
    assert doc["org_id"] == org.id and doc["root_dir"] and doc["created_at"]
    assert "github_token" not in doc

    # A token set later is never written to the registry.
    ai_ide_service._workspace_meta[ws_id].update(github_token="ghp_SECRET", repo_url="https://github.com/o/app.git")
    await ai_ide_service.register(db, ws_id)
    doc = await db.ai_ide_workspaces.find_one({"_id": ws_id})
    assert doc["repo_url"] == "https://github.com/o/app.git" and "ghp_SECRET" not in str(doc)

    ai_ide_service._workspaces.clear()
    ai_ide_service._workspace_meta.clear()
    (ide_root / ws_id / "_meta.json").unlink()  # the registry, not the sidecar file, is what re-attaches

    files = await app_client.get(f"/api/ai-ide/workspace/{ws_id}/files")
    assert files.status_code == 200 and "src/App.tsx" in files.json()
    meta = ai_ide_service._workspace_meta[ws_id]
    assert meta["org_id"] == org.id and meta["repo_url"] == "https://github.com/o/app.git"
    assert meta["github_token"] is None


async def test_ai_ide_workspace_without_files_is_410(app_client, db, ide_root):
    import shutil

    await _login(app_client, db)
    ws_id = (await app_client.post("/api/ai-ide/workspace/create")).json()["workspace_id"]
    # An app whose disk copy is gone is restored from MongoDB; only one with no stored files is lost.
    await ai_ide_service.flush_pending()
    await db[ai_ide_service.FILES].delete_many({"workspace_id": ws_id})
    ai_ide_service._workspaces.clear()
    ai_ide_service._workspace_meta.clear()
    shutil.rmtree(ide_root / ws_id)

    assert (await app_client.get(f"/api/ai-ide/workspace/{ws_id}/files")).status_code == 410
    resp = await app_client.post("/api/ai-ide/file/update", json={"workspace_id": ws_id, "path": "a.ts", "content": "x"})
    assert resp.status_code == 410

    await _login(app_client, db, "org_other")
    assert (await app_client.get(f"/api/ai-ide/workspace/{ws_id}/files")).status_code == 404


async def test_new_empty_file_is_created_empty_not_with_placeholder_code(app_client, db, ide_root):
    await _login(app_client, db)
    ws_id = (await app_client.post("/api/ai-ide/workspace/create")).json()["workspace_id"]

    resp = await app_client.post("/api/ai-ide/file/create", json={"workspace_id": ws_id, "path": "src/pages/New.tsx"})
    assert resp.status_code == 200
    assert resp.json()["content"] == ""
    assert (ide_root / ws_id / "src" / "pages" / "New.tsx").read_text(encoding="utf-8") == ""
    assert "Generated by AI IDE" not in str(ai_ide_service.get_workspace_files(ws_id))
    assert "New.tsx" not in ai_ide_service.read_file(ws_id, "package.json")  # not recorded as generated
