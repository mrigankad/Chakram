"""A generated file is checked before it is saved; a bad one is asked for again, once."""
import asyncio
from unittest.mock import AsyncMock, patch

from app.auth.session import create_session_cookie
from app.engines import generator, planner
from app.engines.plan_schema import PlanError
from app.routes import ai_ide
from app.services import ai_ide_generation, ai_service, organization_service

from tests.test_ai_ide_generation import APP_TSX, FakeWebSocket, FakeWorkspace

PLAN = {
    "app_name": "Clinic Appointments",
    "files": [
        {"path": "src/data/store.ts", "component_name": "", "priority": 0},
        {"path": "src/pages/Home.tsx", "component_name": "Home", "priority": 1},
    ],
    "routes": [{"path": "/", "component": "Home", "importPath": "./pages/Home"}],
}

STORE = "export type Row = { id: string; name: string };\nexport const rows: Row[] = [{ id: '1', name: 'a' }];\n"
GOOD_HOME = (
    "import { PageBody, PageHeader, Mark } from '../chronos';\n"
    "import { rows } from '../data/store';\n"
    "export default function Home() { return <PageBody><PageHeader title='Home' mark={<Mark id='mark-command' />} />{rows.length}</PageBody>; }\n"
)
TRUNCATED_HOME = GOOD_HOME[: GOOD_HOME.index("{rows.length}")]
SOFT_HOME = GOOD_HOME.replace("import { rows } from '../data/store';", "import { rows } from '../data/other';")


class _PackageWorkspace(FakeWorkspace):
    def __init__(self):
        super().__init__()
        self.files["package.json"] = '{\n  "name": "ai-generated-app",\n  "dependencies": {}\n}\n'
        self.files["index.html"] = "<html><head><title>AI Generated App</title></head></html>"


def _stream(attempts: dict[str, list[str]], seen: list[dict]):
    async def stream_file(file_spec, org_id=None):
        seen.append(dict(file_spec))
        outcomes = attempts[file_spec["path"]]
        yield outcomes.pop(0)

    return stream_file


async def _run(db, attempts, seen):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    ws = FakeWebSocket(create_session_cookie(user_id="user", org_id=org.id))
    workspace = _PackageWorkspace()
    ai_ide_generation.reset_for_tests()
    with patch.object(ai_ide_generation, "ai_ide_service", new=workspace), \
         patch.object(ai_ide, "ai_ide_service", new=workspace), \
         patch.object(ai_ide_generation, "plan_files", new=AsyncMock(return_value=PLAN)), \
         patch.object(ai_ide_generation, "stream_file", new=_stream(attempts, seen)):
        await ai_ide.generate(ws, "ws-1")
    return ws, workspace


async def test_a_truncated_file_is_regenerated_with_the_reasons_and_then_saved(db):
    seen: list[dict] = []
    ws, workspace = await _run(db, {"src/data/store.ts": [STORE], "src/pages/Home.tsx": [TRUNCATED_HOME, GOOD_HOME]}, seen)

    home_specs = [s for s in seen if s["path"] == "src/pages/Home.tsx"]
    assert len(home_specs) == 2
    assert home_specs[0].get("previous_problems") is None
    assert any("truncated" in p for p in home_specs[1]["previous_problems"])
    assert workspace.files["src/pages/Home.tsx"] == GOOD_HOME.strip()
    assert ws.of_type("FILE_ERROR") == []
    assert [m["path"] for m in ws.of_type("FILE_CREATE")] == ["src/data/store.ts", "src/pages/Home.tsx", "src/pages/Home.tsx"]
    assert any("Rewriting src/pages/Home.tsx" in m["message"] for m in ws.of_type("STATUS"))
    done = ws.sent[-1]
    assert done["type"] == "GENERATION_DONE" and done["files_failed"] == 0 and done["warnings"] == []


async def test_a_file_that_is_still_broken_after_the_retry_is_rejected(db):
    seen: list[dict] = []
    ws, workspace = await _run(db, {"src/data/store.ts": [STORE], "src/pages/Home.tsx": [TRUNCATED_HOME, "```tsx\n" + TRUNCATED_HOME]}, seen)

    errors = ws.of_type("FILE_ERROR")
    assert [e["path"] for e in errors] == ["src/pages/Home.tsx"]
    assert "not valid" in errors[0]["message"] and "truncated" in errors[0]["message"]
    assert "src/pages/Home.tsx" not in workspace.files
    assert ws.sent[-1]["files_failed"] == 1


async def test_a_soft_problem_keeps_the_file_and_reports_a_warning(db):
    seen: list[dict] = []
    ws, workspace = await _run(db, {"src/data/store.ts": [STORE], "src/pages/Home.tsx": [SOFT_HOME, SOFT_HOME]}, seen)

    assert ws.of_type("FILE_ERROR") == []
    assert workspace.files["src/pages/Home.tsx"] == SOFT_HOME.strip()
    done = ws.sent[-1]
    assert done["files_failed"] == 0
    assert done["warnings"] and done["warnings"][0]["path"] == "src/pages/Home.tsx"
    assert "../data/other" in done["warnings"][0]["problems"][0]


async def test_the_package_and_document_are_named_after_the_app(db):
    seen: list[dict] = []
    _ws, workspace = await _run(db, {"src/data/store.ts": [STORE], "src/pages/Home.tsx": [GOOD_HOME]}, seen)
    assert '"name": "clinic-appointments"' in workspace.files["package.json"]
    assert "<title>Clinic Appointments</title>" in workspace.files["index.html"]


async def test_usage_is_totalled_per_run_and_attributed_on_the_log_row(db):
    seen: list[dict] = []
    _ws, _workspace = await _run(db, {"src/data/store.ts": [STORE], "src/pages/Home.tsx": [GOOD_HOME]}, seen)
    run = ai_ide_generation.get("ws-1")
    assert run is not None
    for spec in seen:
        spec["usage_sink"](100, 20)
    assert run.usage == {"calls": 2, "prompt_tokens": 200, "completion_tokens": 40}
    assert seen[0]["log_extra"] == {"workspace_id": "ws-1", "run_id": run.run_id}


# ── prompts ───────────────────────────────────────────────────────────────

def test_page_prompts_share_one_system_message_and_the_data_file_gets_no_kit_reference():
    page_a = {"path": "src/pages/A.tsx", "component_name": "A", "description": "KpiGrid and a DataTable", "routes": []}
    page_b = {"path": "src/pages/B.tsx", "component_name": "B", "description": "Grid of Panels", "routes": []}
    sys_a, user_a = generator.kit_messages(page_a)
    sys_b, user_b = generator.kit_messages(page_b)
    assert sys_a == sys_b  # identical prefix across the pages of a build
    assert "KpiTile" in sys_a and "LineChart" not in sys_a  # charts sheet only when the blueprint names a chart
    assert "A.tsx" in user_a and "B.tsx" in user_b
    sys_chart, _ = generator.kit_messages({**page_a, "description": "SplitRow: LineChart of revenue"})
    assert "LineChart" in sys_chart
    sys_data, user_data = generator.kit_messages({"path": "src/data/store.ts", "description": "data", "routes": []})
    assert "KpiTile({" not in sys_data and "3D icons" not in user_data  # no page sheet, no icon catalogue
    assert "owns ALL" in user_data


def test_retry_block_lists_the_previous_problems():
    _sys, user = generator.kit_messages({
        "path": "src/pages/A.tsx", "component_name": "A", "description": "x", "routes": [],
        "previous_problems": ["unclosed '{' (the file looks truncated)"],
    })
    assert "previous attempt" in user and "unclosed '{'" in user


# ── planner repair ────────────────────────────────────────────────────────

async def test_planner_gets_one_repair_turn_then_gives_up(monkeypatch):
    replies = ['{"files": [], "routes": []}', '{"files": [], "routes": []}']
    prompts: list[tuple[str | None, str]] = []

    async def fake_call(prompt, json_mode=True, task_name=None, timeout=None, system=None, log_extra=None, usage_sink=None):
        prompts.append((system, prompt))
        return replies.pop(0)

    monkeypatch.setattr(planner, "_call_openai", fake_call)
    try:
        await planner.plan_files("a clinic app")
    except PlanError as exc:
        assert "no page" in str(exc)
    else:
        raise AssertionError("a plan with no pages must be rejected")
    assert len(prompts) == 2
    assert prompts[0][0] == prompts[1][0]  # same system message
    assert "rejected" in prompts[1][1] and "no page" in prompts[1][1]


async def test_planner_repair_succeeds_on_the_second_reply(monkeypatch):
    replies = [
        "not json at all",
        '{"app_name": "Clinic", "files": [{"path": "src/pages/Home.tsx", "component_name": "Home", "mark": "mark-command"}],'
        ' "routes": [{"path": "/", "component": "Home", "importPath": "./pages/Home"}]}',
    ]

    async def fake_call(prompt, **kwargs):
        return replies.pop(0)

    monkeypatch.setattr(planner, "_call_openai", fake_call)
    plan = await planner.plan_files("a clinic app")
    assert plan["app_name"] == "Clinic"
    assert plan["routes"][0]["path"] == "/"
    assert plan["files"][0]["path"] == "src/pages/Home.tsx"


async def test_planner_truncates_a_huge_idea(monkeypatch):
    seen = {}

    async def fake_call(prompt, **kwargs):
        seen["prompt"] = prompt
        return ('{"files": [{"path": "src/pages/Home.tsx", "component_name": "Home"}],'
                ' "routes": [{"path": "/", "component": "Home", "importPath": "./pages/Home"}]}')

    monkeypatch.setattr(planner, "_call_openai", fake_call)
    await planner.plan_files("x" * (planner.MAX_IDEA_CHARS + 5000))
    assert "[truncated]" in seen["prompt"]
    assert len(seen["prompt"]) < planner.MAX_IDEA_CHARS + 6000
