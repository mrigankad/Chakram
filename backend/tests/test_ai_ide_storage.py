"""App Builder apps are stored in MongoDB, survive a lost disk, and are listable per org."""
import shutil

import pytest

from app.services import ai_ide_service as svc
from app.services.workspace_service import WorkspaceExpiredError


@pytest.fixture
def isolated(tmp_path, monkeypatch, db):
    monkeypatch.setattr(svc, "_ai_ide_root", tmp_path)
    monkeypatch.setattr(svc, "_template_cache", {"src/App.tsx": "app v1", "package.json": "{}"})
    monkeypatch.setattr(svc, "_db", None)
    svc._pending.clear()
    yield
    svc._pending.clear()


async def _create(db, org="org-a"):
    await svc.ensure_indexes(db)
    ws = await svc.create_workspace(org, db=db)
    await svc.flush_pending()
    return ws


async def test_files_are_mirrored_and_restored_when_the_disk_copy_is_gone(isolated, db, tmp_path):
    ws = await _create(db)
    svc.save_file(ws, "src/pages/Home.tsx", "home v1")
    svc.save_file(ws, "src/pages/Home.tsx", "home v2")  # newest content wins
    svc.create_file(ws, "notes.md", "hello")
    svc.rename_or_move_path(ws, "notes.md", "docs/notes.md")
    svc.delete_path(ws, "src/App.tsx")
    await svc.flush_pending()

    stored = {d["path"]: d["content"] async for d in db[svc.FILES].find({"workspace_id": ws})}
    assert stored["src/pages/Home.tsx"] == "home v2"
    assert stored["docs/notes.md"] == "hello"
    assert "notes.md" not in stored and "src/App.tsx" not in stored

    # A redeploy wipes the container disk and the process memory.
    shutil.rmtree(tmp_path / ws)
    svc._workspaces.pop(ws, None)
    svc._workspace_meta.pop(ws, None)

    await svc.attach(db, "org-a", ws)
    assert svc.read_file(ws, "src/pages/Home.tsx") == "home v2"
    assert (tmp_path / ws / "docs" / "notes.md").read_text(encoding="utf-8") == "hello"


async def test_lost_app_with_no_stored_files_is_reported_expired(isolated, db, tmp_path):
    ws = await _create(db)
    await db[svc.FILES].delete_many({"workspace_id": ws})
    shutil.rmtree(tmp_path / ws)
    svc._workspaces.pop(ws, None)
    svc._workspace_meta.pop(ws, None)
    with pytest.raises(WorkspaceExpiredError):
        await svc.attach(db, "org-a", ws)


async def test_apps_are_listed_per_org_with_info_and_can_be_deleted(isolated, db, tmp_path):
    mine = await _create(db, "org-a")
    other = await _create(db, "org-b")
    await svc.update_app_info(mine, name="Ledgerly", idea="a budget tracker", status="done")

    apps = await svc.list_apps(db, "org-a")
    assert [a["workspace_id"] for a in apps] == [mine]
    assert apps[0]["name"] == "Ledgerly" and apps[0]["status"] == "done"
    # the template's files plus the default design pack (src/design/*)
    assert apps[0]["file_count"] == len(svc.get_workspace_files(mine)) and apps[0]["updated_at"]

    assert await svc.delete_app(db, "org-a", other) is False  # not this org's app
    assert await svc.delete_app(db, "org-a", mine) is True
    assert await db[svc.FILES].count_documents({"workspace_id": mine}) == 0
    assert not (tmp_path / mine).exists()
    assert await svc.list_apps(db, "org-a") == []


def test_outdated_kit_files_are_replaced_only_for_older_kit_apps(monkeypatch):
    from app.engines import kit

    current = {"src/chronos/index.ts": "export * from './a';", "src/chronos/a.tsx": "new", "src/chronos/VERSION": "3\n"}
    monkeypatch.setattr(kit, "kit_files", lambda: current)
    old_app = {"src/chronos/index.ts": "export * from './a';", "src/chronos/a.tsx": "old", "src/chronos/VERSION": "2\n"}
    assert kit.outdated_kit_files(old_app) == {"src/chronos/a.tsx": "new", "src/chronos/VERSION": "3\n"}
    assert kit.outdated_kit_files({**old_app, "src/chronos/VERSION": "3"}) == {}
    assert kit.outdated_kit_files({"src/App.tsx": "no kit"}) == {}
    unversioned = {k: v for k, v in old_app.items() if k != "src/chronos/VERSION"}
    assert "src/chronos/a.tsx" in kit.outdated_kit_files(unversioned)


async def test_an_app_from_before_storage_is_backfilled_on_open(isolated, db, tmp_path):
    ws = await _create(db)
    await db[svc.FILES].delete_many({"workspace_id": ws})  # as if built before files were stored
    assert await svc.ensure_stored(db, ws) == len(svc.get_workspace_files(ws))
    await svc.flush_pending()
    assert await db[svc.FILES].count_documents({"workspace_id": ws}) == len(svc.get_workspace_files(ws))
    assert await svc.ensure_stored(db, ws) == 0
