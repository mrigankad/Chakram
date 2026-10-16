"""AI IDE generation socket: failed files are reported, not replaced by templates."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from bson import ObjectId

from app.auth.session import COOKIE_NAME, create_session_cookie
from app.engines import generator
from app.engines.verify import VerifyResult
from app.routes import ai_ide
from app.services import ai_ide_generation
from app.services import ai_service, organization_service
from app.services import connector_settings_service as connectors

APP_TSX = (
    "// AUTO_IMPORTS_START\n// AUTO_IMPORTS_END\n"
    "<Routes>\n          {/* AUTO_ROUTES_START */}\n          {/* AUTO_ROUTES_END */}\n</Routes>\n"
)

PLAN = {
    "files": [
        {"path": "src/components/Navbar.tsx", "component_name": "Navbar"},
        {"path": "src/pages/Home.tsx", "component_name": "Home"},
        {"path": "src/pages/Reports.tsx", "component_name": "Reports"},
    ],
    "routes": [
        {"path": "/", "component": "Home", "importPath": "./pages/Home"},
        {"path": "/reports", "component": "Reports", "importPath": "./pages/Reports"},
    ],
}


class FakeWebSocket:
    def __init__(self, cookie: str | None, idea: str = "a reporting app"):
        self.cookies = {COOKIE_NAME: cookie} if cookie else {}
        self.headers: dict[str, str] = {}  # no Origin header: a non-browser client
        self.idea = idea
        self.sent: list[dict] = []
        self.close_code: int | None = None

    async def accept(self) -> None:
        pass

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)

    async def receive_text(self) -> str:
        return self.idea

    async def close(self, code: int = 1000) -> None:
        self.close_code = code

    def of_type(self, event_type: str) -> list[dict]:
        return [m for m in self.sent if m["type"] == event_type]


class FakeWorkspace:
    """Stands in for ai_ide_service: records what the handler writes."""

    def __init__(self):
        self.files: dict[str, str] = {"src/App.tsx": APP_TSX}

    async def attach(self, db, org_id, workspace_id):
        pass

    def require_org_workspace(self, org_id, workspace_id):
        return {"org_id": org_id}

    def save_file(self, workspace_id, path, content):
        self.files[path] = content

    def read_file(self, workspace_id, path):
        return self.files[path]


async def _run(db, stream, plan=PLAN):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    ws = FakeWebSocket(create_session_cookie(user_id="user", org_id=org.id))
    workspace = FakeWorkspace()
    ai_ide_generation.reset_for_tests()
    with patch.object(ai_ide_generation, "ai_ide_service", new=workspace), \
         patch.object(ai_ide, "ai_ide_service", new=workspace), \
         patch.object(ai_ide_generation, "plan_files", new=AsyncMock(return_value=plan)), \
         patch.object(ai_ide_generation, "verify_file", new=_accept_all), patch.object(ai_ide_generation, "stream_file", new=stream), \
         patch.object(ai_ide_generation, "verify_file", new=_accept_all):
        await ai_ide.generate(ws, "ws-1")
    return ws, workspace, org


def _accept_all(path, content, **kwargs):
    """The orchestration tests stream stand-in text; the structural check has its own tests."""
    return VerifyResult(True)


def _stream(outcomes: dict):
    """stream_file stand-in. Per path: a string to emit, or an exception to raise after 'par'."""

    async def stream_file(file_spec, org_id=None):
        outcome = outcomes[file_spec["path"]]
        if isinstance(outcome, Exception):
            yield "par"
            raise outcome
        if outcome:
            yield outcome

    return stream_file


async def test_all_files_generated_reports_zero_failures(db):
    ws, workspace, _ = await _run(db, _stream({
        "src/components/Navbar.tsx": "nav code",
        "src/pages/Home.tsx": "home code",
        "src/pages/Reports.tsx": "reports code",
    }))

    assert ws.of_type("FILE_ERROR") == []
    assert [m["path"] for m in ws.of_type("FILE_DONE")] == [f["path"] for f in PLAN["files"]]
    done = ws.sent[-1]
    assert {k: done[k] for k in ("type", "files_total", "files_generated", "files_failed", "failed_files")} == {
        "type": "GENERATION_DONE", "files_total": 3, "files_generated": 3,
        "files_failed": 0, "failed_files": [],
    }
    assert done["usage"] == {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0}  # stand-in stream reports none
    assert done["run_id"]
    assert workspace.files["src/pages/Home.tsx"] == "home code"
    assert "import Reports from './pages/Reports';" in workspace.files["src/App.tsx"]


async def test_failed_file_gets_an_explicit_event_and_no_placeholder(db):
    ws, workspace, _ = await _run(db, _stream({
        "src/components/Navbar.tsx": "nav code",
        "src/pages/Home.tsx": RuntimeError("provider returned 500"),
        "src/pages/Reports.tsx": "reports code",
    }))

    errors = ws.of_type("FILE_ERROR")
    assert [e["path"] for e in errors] == ["src/pages/Home.tsx"]
    assert "provider returned 500" in errors[0]["message"]

    # Nothing was written for the failed file, and it was not announced as done or updated.
    assert "src/pages/Home.tsx" not in workspace.files
    assert "src/pages/Home.tsx" not in [m["path"] for m in ws.of_type("FILE_DONE")]
    assert "src/pages/Home.tsx" not in [m["path"] for m in ws.of_type("FILE_UPDATE")]
    assert not any("Generated by AI IDE" in content for content in workspace.files.values())

    # The remaining files were still generated.
    assert workspace.files["src/pages/Reports.tsx"] == "reports code"
    done = ws.sent[-1]
    assert done["type"] == "GENERATION_DONE"
    assert (done["files_total"], done["files_generated"], done["files_failed"]) == (3, 2, 1)
    assert done["failed_files"] == [{"path": "src/pages/Home.tsx", "message": errors[0]["message"]}]

    # No route is injected for a page that does not exist.
    app_tsx = workspace.files["src/App.tsx"]
    assert "./pages/Home" not in app_tsx
    assert "import Reports from './pages/Reports';" in app_tsx


async def test_empty_output_is_a_failure(db):
    ws, workspace, _ = await _run(db, _stream({
        "src/components/Navbar.tsx": "",
        "src/pages/Home.tsx": "home code",
        "src/pages/Reports.tsx": "   ",
    }))
    assert [e["path"] for e in ws.of_type("FILE_ERROR")] == ["src/components/Navbar.tsx", "src/pages/Reports.tsx"]
    assert "src/components/Navbar.tsx" not in workspace.files
    assert ws.sent[-1]["files_failed"] == 2


async def test_timeout_is_a_failure_and_generation_continues(db, monkeypatch):
    async def stream_file(file_spec, org_id=None):
        if file_spec["path"] == "src/pages/Home.tsx":
            await asyncio.sleep(30)
        yield "code"

    real_wait_for = asyncio.wait_for
    monkeypatch.setattr(ai_ide_generation.asyncio, "wait_for", lambda aw, timeout: real_wait_for(aw, timeout=0.05))
    plan = {"files": PLAN["files"][1:], "routes": []}
    ws, workspace, _ = await _run(db, stream_file, plan=plan)

    errors = ws.of_type("FILE_ERROR")
    assert [e["path"] for e in errors] == ["src/pages/Home.tsx"]
    assert "timed out" in errors[0]["message"]
    assert "src/pages/Home.tsx" not in workspace.files
    assert workspace.files["src/pages/Reports.tsx"] == "code"
    assert ws.sent[-1]["files_failed"] == 1


async def test_existing_file_is_left_untouched_when_its_regeneration_fails(db):
    stream = _stream({"src/pages/Home.tsx": RuntimeError("boom")})
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    ws = FakeWebSocket(create_session_cookie(user_id="user", org_id=org.id))
    workspace = FakeWorkspace()
    workspace.files["src/pages/Home.tsx"] = "previous content"
    plan = {"files": [PLAN["files"][1]], "routes": []}
    ai_ide_generation.reset_for_tests()
    with patch.object(ai_ide_generation, "ai_ide_service", new=workspace), \
         patch.object(ai_ide, "ai_ide_service", new=workspace), \
         patch.object(ai_ide_generation, "plan_files", new=AsyncMock(return_value=plan)), \
         patch.object(ai_ide_generation, "verify_file", new=_accept_all), patch.object(ai_ide_generation, "stream_file", new=stream):
        await ai_ide.generate(ws, "ws-1")
    assert workspace.files["src/pages/Home.tsx"] == "previous content"


async def test_socket_uses_the_orgs_connector_settings_and_resets_them(db):
    seen: dict = {}

    async def stream_file(file_spec, org_id=None):
        seen["model"] = ai_service._ollama_cfg()[2]
        seen["org_id"] = ai_service._current_org_id.get()
        yield "code"

    async def plan_files(idea, **kwargs):
        seen["planner_model"] = ai_service._ollama_cfg()[2]
        return {"files": [PLAN["files"][1]], "routes": []}

    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    await db.organizations.update_one(
        {"_id": ObjectId(org.id)},
        {"$set": {"connectors": {"ollama": {"model": "org-own-model", "api_key": "org-key"}}}},
    )
    ws = FakeWebSocket(create_session_cookie(user_id="user", org_id=org.id))
    ai_ide_generation.reset_for_tests()
    fake = FakeWorkspace()
    with patch.object(ai_ide_generation, "ai_ide_service", new=fake), \
         patch.object(ai_ide, "ai_ide_service", new=fake), \
         patch.object(ai_ide_generation, "plan_files", new=plan_files), \
         patch.object(ai_ide_generation, "verify_file", new=_accept_all), patch.object(ai_ide_generation, "stream_file", new=stream_file):
        await ai_ide.generate(ws, "ws-1")

    assert seen == {"model": "org-own-model", "org_id": org.id, "planner_model": "org-own-model"}
    # Reset when the socket handler returns.
    assert connectors._current_org_connectors.get() is None
    assert ai_service._current_org_id.get() is None


async def test_context_is_reset_when_generation_ends_with_an_error(db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    ws = FakeWebSocket(create_session_cookie(user_id="user", org_id=org.id))
    ai_ide_generation.reset_for_tests()
    fake = FakeWorkspace()
    with patch.object(ai_ide_generation, "ai_ide_service", new=fake), \
         patch.object(ai_ide, "ai_ide_service", new=fake), \
         patch.object(ai_ide_generation, "plan_files", new=AsyncMock(side_effect=RuntimeError("planner down"))):
        await ai_ide.generate(ws, "ws-1")
    assert "planner down" in ws.of_type("ERROR")[0]["message"]
    assert connectors._current_org_connectors.get() is None
    assert ai_service._current_org_id.get() is None


async def test_unauthenticated_and_unknown_org_are_rejected(db):
    ws = FakeWebSocket(None)
    await ai_ide.generate(ws, "ws-1")
    assert ws.sent == [{"type": "ERROR", "message": "Not authenticated"}]
    assert ws.close_code == 1008

    ws = FakeWebSocket(create_session_cookie(user_id="user", org_id=str(ObjectId())))
    await ai_ide.generate(ws, "ws-1")
    assert ws.of_type("ERROR") and ws.close_code == 1008


# ── generator.stream_file ─────────────────────────────────────────────────

def _chunk(content=None):
    choices = [SimpleNamespace(delta=SimpleNamespace(content=content))] if content is not None else []
    return SimpleNamespace(choices=choices, usage=None)


class _FailingClient:
    """Streams the given chunks, then raises."""

    def __init__(self, chunks, error):
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))
        self._chunks = chunks
        self._error = error

    def _create(self, **kwargs):
        def _iter():
            yield from self._chunks
            raise self._error
        return _iter()


async def test_stream_error_reaches_the_caller_after_partial_tokens_and_usage_is_logged():
    client = _FailingClient([_chunk("import "), _chunk("x")], RuntimeError("stream broke"))
    logged = AsyncMock()
    tokens: list[str] = []
    with patch.object(ai_service, "_get_client", return_value=client), \
         patch.object(ai_service, "_ollama_cfg", return_value=("http://x", "key", "m")), \
         patch.object(ai_service, "_log_cost", new=logged):
        with pytest.raises(RuntimeError, match="stream broke"):
            async for token in generator.stream_file({"path": "src/A.tsx"}, org_id="org-x"):
                tokens.append(token)
        await asyncio.sleep(0)

    assert tokens == ["import ", "x"]
    logged.assert_awaited_once()
    assert logged.await_args.args == (generator._TASK_NAME, 0, 0)
    assert logged.await_args.kwargs["extra"]["path"] == "src/A.tsx"


async def test_stream_error_before_any_token_reaches_the_caller():
    class _Client:
        chat = SimpleNamespace(completions=SimpleNamespace(
            create=lambda **kwargs: (_ for _ in ()).throw(RuntimeError("connect failed"))
        ))

    with patch.object(ai_service, "_get_client", return_value=_Client()), \
         patch.object(ai_service, "_ollama_cfg", return_value=("http://x", "key", "m")), \
         patch.object(ai_service, "_log_cost", new=AsyncMock()):
        with pytest.raises(RuntimeError, match="connect failed"):
            async for _ in generator.stream_file({"path": "src/A.tsx"}, org_id="org-x"):
                pass


async def test_file_generation_asks_for_low_reasoning_and_leaves_room_for_the_code():
    """A thinking model given a small budget and default effort streams reasoning only, and no code."""
    seen: dict = {}

    class _Client:
        def __init__(self):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

        def _create(self, **kwargs):
            seen.update(kwargs)
            return iter([_chunk("export default 1;")])

    tokens: list[str] = []
    with patch.object(ai_service, "_get_client", return_value=_Client()), \
         patch.object(ai_service, "_ollama_cfg", return_value=("http://x", "key", "m")), \
         patch.object(ai_service, "_log_cost", new=AsyncMock()):
        async for token in generator.stream_file({"path": "src/A.tsx"}, org_id="org-x"):
            tokens.append(token)
        await asyncio.sleep(0)

    assert tokens == ["export default 1;"]
    assert seen["extra_body"] == {"reasoning_effort": "low"}
    assert seen["max_tokens"] >= 6000


# ── Plan announcement, fence stripping, progressive routes ───────────────────

async def test_plan_is_announced_before_any_file_and_lists_every_path(db):
    ws, _, _ = await _run(db, _stream({
        "src/components/Navbar.tsx": "nav code",
        "src/pages/Home.tsx": "home code",
        "src/pages/Reports.tsx": "reports code",
    }))
    types = [m["type"] for m in ws.sent]
    assert types.index("PLAN") < types.index("FILE_CREATE")
    plan = ws.of_type("PLAN")[0]
    assert plan["files"] == [f["path"] for f in PLAN["files"]]
    assert [{k: r[k] for k in ("path", "component", "importPath")} for r in plan["routes"]] == PLAN["routes"]


async def test_markdown_fences_are_stripped_before_the_file_is_saved(db):
    ws, workspace, _ = await _run(db, _stream({
        "src/components/Navbar.tsx": "```tsx\nnav code\n```",
        "src/pages/Home.tsx": "Here you go:\n```typescript\nhome code\n```\nEnjoy!",
        "src/pages/Reports.tsx": "reports code",
    }))
    assert workspace.files["src/components/Navbar.tsx"] == "nav code"
    assert workspace.files["src/pages/Home.tsx"] == "home code"
    # The client showed the raw stream, so it is told the saved text.
    updates = {m["path"]: m["content"] for m in ws.of_type("FILE_UPDATE")}
    assert updates["src/components/Navbar.tsx"] == "nav code"
    assert updates["src/pages/Home.tsx"] == "home code"
    assert "src/pages/Reports.tsx" not in updates
    assert ws.sent[-1]["files_failed"] == 0


async def test_routes_are_wired_as_each_page_finishes(db):
    ws, workspace, _ = await _run(db, _stream({
        "src/components/Navbar.tsx": "nav code",
        "src/pages/Home.tsx": "home code",
        "src/pages/Reports.tsx": "reports code",
    }))
    events = [(m["type"], m.get("path")) for m in ws.sent]
    home_done = events.index(("FILE_DONE", "src/pages/Home.tsx"))
    reports_create = events.index(("FILE_CREATE", "src/pages/Reports.tsx"))
    app_updates = [i for i, e in enumerate(events) if e == ("FILE_UPDATE", "src/App.tsx")]
    # App.tsx already routes to Home before Reports starts streaming.
    first = next(i for i in app_updates if i > home_done)
    assert first < reports_create
    first_content = ws.sent[first]["content"]
    assert "./pages/Home" in first_content and "./pages/Reports" not in first_content
    assert "./pages/Reports" in workspace.files["src/App.tsx"]


async def test_plan_paths_are_normalised(db):
    plan = {
        "files": [{"path": "./src/pages/Home.tsx", "component_name": "Home"}],
        "routes": [{"path": "/", "component": "Home", "importPath": "./pages/Home"}],
    }
    ws, workspace, _ = await _run(db, _stream({"./src/pages/Home.tsx": "home code"}) if False else _stream({"src/pages/Home.tsx": "home code"}), plan=plan)
    assert ws.of_type("PLAN")[0]["files"] == ["src/pages/Home.tsx"]
    assert workspace.files["src/pages/Home.tsx"] == "home code"
    assert "import Home from './pages/Home';" in workspace.files["src/App.tsx"]


def test_legacy_placeholder_home_route_yields_to_the_generated_home_page():
    from app.engines.injector import inject_routes

    legacy = (
        "// AUTO_IMPORTS_START\n// AUTO_IMPORTS_END\n<Routes>\n"
        '  <Route\n    path="/"\n    element={<div>Your App</div>}\n  />\n'
        "  {/* AUTO_ROUTES_START */}\n  {/* AUTO_ROUTES_END */}\n</Routes>\n"
    )
    out = inject_routes(legacy, [{"path": "/", "component": "Home", "importPath": "./pages/Home"}])
    assert 'path="*"' in out
    assert out.count('path="/"') == 1 and '<Route path="/" element={<Home />} />' in out


def test_injector_drops_duplicate_paths_and_invalid_component_names():
    from app.engines.injector import inject_routes

    app = "// AUTO_IMPORTS_START\n// AUTO_IMPORTS_END\n{/* AUTO_ROUTES_START */}\n{/* AUTO_ROUTES_END */}\n"
    out = inject_routes(app, [
        {"path": "/a", "component": "A", "importPath": "./pages/A"},
        {"path": "/a", "component": "B", "importPath": "./pages/B"},
        {"path": "/c", "component": "Not Valid", "importPath": "./pages/C"},
    ])
    assert "import A from './pages/A';" in out
    assert "./pages/B" not in out and "./pages/C" not in out


async def test_default_template_is_a_complete_vite_project_and_db_template_fills_gaps(monkeypatch):
    from app.services import template_service as ts

    base = ts.get_default_template()
    for required in ("index.html", "vite.config.ts", "tsconfig.json", "tailwind.config.js",
                     "postcss.config.js", "src/lib/utils.ts", "src/main.tsx", "src/App.tsx", "package.json"):
        assert required in base
    import json
    deps = json.loads(base["package.json"])["dependencies"]
    for pkg in ("framer-motion", "tailwind-merge", "@tanstack/react-query", "date-fns", "@radix-ui/react-dialog"):
        assert pkg in deps
    # The catch-all page is declared after the markers, so a generated "/" wins.
    app = base["src/App.tsx"]
    assert app.index("AUTO_ROUTES_END") < app.index('path="*"')

    class _Coll:
        async def find_one(self, query):
            return {"files": [{"path": "src/App.tsx", "content": "custom app"}]}

    class _Db:
        def __getitem__(self, name):
            return _Coll()

    monkeypatch.setattr(ts, "_get_template_db", lambda: _Db())
    merged = await ts.get_template()
    assert merged["src/App.tsx"] == "custom app"
    assert merged["index.html"] == base["index.html"]


# ── Runs outlive the socket; a later socket attaches and catches up ──────────

async def _patched(workspace, plan, stream):
    ai_ide_generation.reset_for_tests()
    return (
        patch.object(ai_ide_generation, "ai_ide_service", new=workspace),
        patch.object(ai_ide, "ai_ide_service", new=workspace),
        patch.object(ai_ide_generation, "plan_files", new=AsyncMock(return_value=plan)),
        patch.object(ai_ide_generation, "verify_file", new=_accept_all), patch.object(ai_ide_generation, "stream_file", new=stream),
    )


async def test_run_continues_after_the_client_disconnects_and_attach_replays_it(db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    gate = asyncio.Event()

    async def stream_file(file_spec, org_id=None):
        yield "nav "
        if file_spec["path"] == "src/components/Navbar.tsx":
            await gate.wait()  # the first client is gone by the time this file finishes
        yield "code"

    class DroppingSocket(FakeWebSocket):
        async def send_json(self, message):
            self.sent.append(message)
            if message["type"] == "STREAM_TOKEN":
                from fastapi import WebSocketDisconnect
                raise WebSocketDisconnect()

    workspace = FakeWorkspace()
    patches = await _patched(workspace, PLAN, stream_file)
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        first = DroppingSocket(create_session_cookie(user_id="user", org_id=org.id))
        await ai_ide.generate(first, "ws-1")
        assert first.of_type("PLAN") and first.of_type("FILE_CREATE")

        run = ai_ide_generation.get("ws-1")
        assert run is not None and not run.finished

        # A new page attaches mid-run: it gets the plan and the partial file, then the rest.
        second = FakeWebSocket(create_session_cookie(user_id="user", org_id=org.id), idea='{"attach": true}')

        async def release():
            await asyncio.sleep(0.05)
            gate.set()

        asyncio.get_running_loop().create_task(release())
        await ai_ide.generate(second, "ws-1")

    types = [m["type"] for m in second.sent]
    assert types[0] == "PLAN"
    assert ("STREAM_TOKEN", "nav ") in [(m["type"], m.get("token")) for m in second.sent[:3]]
    assert second.sent[-1]["type"] == "GENERATION_DONE"
    assert second.sent[-1]["files_failed"] == 0
    assert workspace.files["src/components/Navbar.tsx"] == "nav code"
    assert workspace.files["src/pages/Reports.tsx"] == "nav code"


async def test_attach_after_completion_replays_the_finished_run(db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    workspace = FakeWorkspace()
    patches = await _patched(workspace, PLAN, _stream({
        "src/components/Navbar.tsx": "nav code",
        "src/pages/Home.tsx": "home code",
        "src/pages/Reports.tsx": "reports code",
    }))
    with patches[0], patches[1], patches[2], patches[3], patches[4]:
        first = FakeWebSocket(create_session_cookie(user_id="user", org_id=org.id))
        await ai_ide.generate(first, "ws-1")
        second = FakeWebSocket(create_session_cookie(user_id="user", org_id=org.id), idea='{"attach": true}')
        await ai_ide.generate(second, "ws-1")

    kinds = [m["type"] for m in second.sent]
    assert kinds[0] == "PLAN" and kinds[-1] == "GENERATION_DONE"
    updates = {m["path"]: m["content"] for m in second.sent if m["type"] == "FILE_UPDATE"}
    assert updates["src/pages/Home.tsx"] == "home code"
    assert "./pages/Reports" in updates["src/App.tsx"]
    assert "STREAM_TOKEN" not in kinds


async def test_attach_with_no_run_says_so(db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    ai_ide_generation.reset_for_tests()
    ws = FakeWebSocket(create_session_cookie(user_id="user", org_id=org.id), idea='{"attach": true}')
    with patch.object(ai_ide, "ai_ide_service", new=FakeWorkspace()):
        await ai_ide.generate(ws, "ws-1")
    assert ws.sent == [{"type": "NO_RUN"}]


async def test_a_second_idea_while_a_run_is_going_follows_that_run(db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    gate = asyncio.Event()
    calls: list[str] = []

    async def plan_files(idea, **kwargs):
        calls.append(idea)
        await gate.wait()
        return {"files": [PLAN["files"][1]], "routes": []}

    workspace = FakeWorkspace()
    ai_ide_generation.reset_for_tests()
    with patch.object(ai_ide_generation, "ai_ide_service", new=workspace), \
         patch.object(ai_ide, "ai_ide_service", new=workspace), \
         patch.object(ai_ide_generation, "plan_files", new=plan_files), \
         patch.object(ai_ide_generation, "verify_file", new=_accept_all), patch.object(ai_ide_generation, "stream_file", new=_stream({"src/pages/Home.tsx": "home"})):
        class DroppingSocket(FakeWebSocket):
            async def send_json(self, message):
                self.sent.append(message)
                from fastapi import WebSocketDisconnect
                raise WebSocketDisconnect()

        first = DroppingSocket(create_session_cookie(user_id="user", org_id=org.id), idea="first idea")
        await ai_ide.generate(first, "ws-1")
        second = FakeWebSocket(create_session_cookie(user_id="user", org_id=org.id), idea="second idea")

        async def release():
            await asyncio.sleep(0.05)
            gate.set()

        asyncio.get_running_loop().create_task(release())
        await ai_ide.generate(second, "ws-1")

    assert calls == ["first idea"]
    assert second.sent[0]["type"] == "STATUS" and "already running" in second.sent[0]["message"]
    assert second.sent[-1]["type"] == "GENERATION_DONE"


async def test_pages_are_prompted_with_the_shared_files_written_before_them(db):
    seen: dict[str, dict] = {}

    async def stream_file(file_spec, org_id=None):
        seen[file_spec["path"]] = dict(file_spec.get("context_files") or {})
        yield "code for " + file_spec["path"]

    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    ws = FakeWebSocket(create_session_cookie(user_id="user", org_id=org.id))
    workspace = FakeWorkspace()
    ai_ide_generation.reset_for_tests()
    with patch.object(ai_ide_generation, "ai_ide_service", new=workspace),          patch.object(ai_ide, "ai_ide_service", new=workspace),          patch.object(ai_ide_generation, "plan_files", new=AsyncMock(return_value=PLAN)),          patch.object(ai_ide_generation, "verify_file", new=_accept_all), patch.object(ai_ide_generation, "stream_file", new=stream_file):
        await ai_ide.generate(ws, "ws-1")

    assert seen["src/components/Navbar.tsx"] == {}
    assert seen["src/pages/Home.tsx"] == {"src/components/Navbar.tsx": "code for src/components/Navbar.tsx"}
    # Pages are not context for later pages; shared code is.
    assert seen["src/pages/Reports.tsx"] == {"src/components/Navbar.tsx": "code for src/components/Navbar.tsx"}


def test_context_block_lists_files_and_respects_the_budget():
    from app.engines.generator import _context_block, _CONTEXT_TOTAL_CHARS

    assert _context_block({}) == ""
    block = _context_block({"src/components/Navbar.tsx": "export default function Navbar() {}"})
    assert "--- src/components/Navbar.tsx ---" in block and "export default function Navbar" in block
    big = {f"src/components/C{i}.tsx": "x" * 4000 for i in range(10)}
    assert len(_context_block(big)) < _CONTEXT_TOTAL_CHARS + 2000


async def test_pages_stream_concurrently_after_shared_files(db):
    active = {"now": 0, "max": 0}
    order: list[str] = []

    async def stream_file(file_spec, org_id=None):
        order.append(file_spec["path"])
        active["now"] += 1
        active["max"] = max(active["max"], active["now"])
        await asyncio.sleep(0.02)
        active["now"] -= 1
        yield "code"

    ws, workspace, _ = await _run(db, stream_file)
    assert order[0] == "src/components/Navbar.tsx"  # shared first, alone
    assert active["max"] >= 2  # pages overlap
    assert ws.sent[-1]["files_failed"] == 0


def test_injector_writes_nav_and_app_name_for_the_kit_shell():
    from app.engines.injector import inject_routes, nav_items

    app = (
        "// AUTO_IMPORTS_START\n// AUTO_IMPORTS_END\n"
        "// AUTO_NAV_START\nconst NAV: NavItem[] = [];\n// AUTO_NAV_END\n"
        "const APP_NAME = 'Your App'; // AUTO_APP_NAME\n"
        "{/* AUTO_ROUTES_START */}\n{/* AUTO_ROUTES_END */}\n"
    )
    routes = [
        {"path": "/", "component": "Overview", "importPath": "./pages/Overview", "label": "Overview", "icon": "LayoutDashboard"},
        {"path": "/items/:id", "component": "ItemDetail", "importPath": "./pages/ItemDetail"},
        {"path": "/team", "component": "TeamMembers", "importPath": "./pages/TeamMembers", "icon": "bad icon!"},
    ]
    nav = nav_items(routes)
    assert nav == [
        {"to": "/", "label": "Overview", "icon": "LayoutDashboard"},
        {"to": "/team", "label": "Team Members"},
    ]
    out = inject_routes(app, routes, nav=nav, app_name="Ledger's Pro")
    assert '"to": "/team"' in out and "AUTO_NAV_END" in out
    assert 'const APP_NAME = "Ledger\'s Pro"; // AUTO_APP_NAME' in out
    assert "import ItemDetail from './pages/ItemDetail';" in out


def test_jsx_detection_ignores_typescript_generics():
    assert ai_ide_generation.has_jsx("export const x = () => <Panel title='a' />;")
    assert ai_ide_generation.has_jsx("return (<div>hi</div>);")
    assert not ai_ide_generation.has_jsx("export const rows: Array<Row> = []; const m = new Map<string, number>();")
    assert not ai_ide_generation.has_jsx("if (a < b && c > d) {}")


async def test_a_data_file_with_jsx_is_saved_as_tsx(db):
    plan = {
        "files": [{"path": "src/data/store.ts", "component_name": ""}, {"path": "src/pages/Home.tsx", "component_name": "Home"}],
        "routes": [{"path": "/", "component": "Home", "importPath": "./pages/Home"}],
    }
    ws, workspace, _ = await _run(db, _stream({
        "src/data/store.ts": "export const Card = () => <div>x</div>;",
        "src/pages/Home.tsx": "home",
    }), plan=plan)
    assert "src/data/store.tsx" in workspace.files and "src/data/store.ts" not in workspace.files
    renamed = ws.of_type("FILE_RENAMED")
    assert renamed and renamed[0]["from"] == "src/data/store.ts" and renamed[0]["to"] == "src/data/store.tsx"
    assert {"type": "FILE_DONE", "path": "src/data/store.tsx"} in ws.sent
    assert ws.sent[-1]["files_failed"] == 0
