"""A composed run: one spec call, one seed call, custom blocks through the model, pages written by the composer."""
from unittest.mock import AsyncMock, patch

from app.auth.session import create_session_cookie
from app.config import settings
from app.engines.spec import SpecError, normalize_spec
from app.routes import ai_ide
from app.services import ai_ide_generation, organization_service

from tests.test_composer import SEED, SPEC
from tests.test_generation_verify_and_retry import _PackageWorkspace

PLANNER_COMPONENT = (
    "import { Panel } from '../chronos';\n"
    "import { doctors } from '../data/seed';\n"
    "export default function ShiftPlanner() { return <Panel title=\"Shifts\">{doctors.length} doctors</Panel>; }\n"
)


async def _run(db, *, spec_result, seed_result=SEED, stream=None, composer=True):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    from tests.test_ai_ide_generation import FakeWebSocket

    sock = FakeWebSocket(create_session_cookie(user_id="user", org_id=org.id), idea="a clinic app")
    workspace = _PackageWorkspace()
    ai_ide_generation.reset_for_tests()
    seen: list[dict] = []

    async def stream_file(file_spec, org_id=None):
        seen.append(dict(file_spec))
        yield (stream or {}).get(file_spec["path"], PLANNER_COMPONENT)

    plan_spec = AsyncMock(side_effect=spec_result) if isinstance(spec_result, Exception) else AsyncMock(return_value=spec_result)
    with patch.object(settings, "AI_IDE_COMPOSER", composer), \
         patch.object(ai_ide_generation, "ai_ide_service", new=workspace), \
         patch.object(ai_ide, "ai_ide_service", new=workspace), \
         patch.object(ai_ide_generation, "plan_spec", new=plan_spec), \
         patch.object(ai_ide_generation, "seed_rows", new=AsyncMock(return_value=seed_result)), \
         patch.object(ai_ide_generation, "plan_files", new=AsyncMock(return_value={
             "app_name": "Fallback", "files": [{"path": "src/pages/Home.tsx", "component_name": "Home"}],
             "routes": [{"path": "/", "component": "Home", "importPath": "./pages/Home"}]})), \
         patch.object(ai_ide_generation, "stream_file", new=stream_file):
        await ai_ide.generate(sock, "ws-1")
    return sock, workspace, seen


async def test_a_composed_run_writes_pages_without_the_model(db):
    sock, workspace, seen = await _run(db, spec_result=normalize_spec(SPEC))

    plan = sock.of_type("PLAN")[0]
    assert plan["app_name"] == "Clinic Appointments"
    assert plan["files"][:5] == ["app.spec.json", "src/data/types.ts", "src/data/queries.ts", "src/data/seed.ts", "src/data/store.ts"]
    assert "api/src/routes.ts" in plan["files"] and plan["files"][-2:] == ["src/pages/Overview.tsx", "src/pages/Doctors.tsx"]
    assert [r["path"] for r in plan["routes"]] == ["/", "/doctors"]

    # Only the custom block went to the model, with the data files as context.
    assert [s["path"] for s in seen] == ["src/components/ShiftPlanner.tsx"]
    assert {"src/data/types.ts", "src/data/queries.ts", "src/data/seed.ts", "src/data/store.ts"} <= set(seen[0]["context_files"])
    assert not any(p.startswith("api/") for p in seen[0]["context_files"])  # the API kit is not page context

    files = workspace.files
    assert "export default function Overview()" in files["src/pages/Overview.tsx"]
    assert "<ShiftPlanner />" in files["src/pages/Doctors.tsx"] and "<AppointmentForm />" in files["src/pages/Doctors.tsx"]
    assert "await api.appointments.create(data);" in files["src/components/AppointmentForm.tsx"]
    assert files["src/components/ShiftPlanner.tsx"] == PLANNER_COMPONENT.strip()
    assert '"name": "Clinic Appointments"' in files["app.spec.json"]
    assert "Dr Rao" in files["src/data/seed.ts"]
    assert "./pages/Overview" in files["src/App.tsx"] and "./pages/Doctors" in files["src/App.tsx"]
    assert '"name": "clinic-appointments"' in files["package.json"]

    done = sock.sent[-1]
    assert done["type"] == "GENERATION_DONE" and done["composed"] is True
    assert done["files_failed"] == 0 and done["files_total"] == 21  # 18 fixed (data layer, the form, API kit) + 1 custom + 2 pages
    assert "api/migrations/0001_init.sql" in workspace.files
    assert [m["path"] for m in sock.of_type("FILE_DONE")][-2:] == ["src/pages/Overview.tsx", "src/pages/Doctors.tsx"]
    assert sock.of_type("STREAM_TOKEN") and all(m["path"] == "src/components/ShiftPlanner.tsx" for m in sock.of_type("STREAM_TOKEN"))


async def test_seed_failure_keeps_the_build_going_with_plain_rows(db):
    sock, workspace, _seen = await _run(db, spec_result=normalize_spec(SPEC), seed_result=RuntimeError("provider down"))
    assert sock.sent[-1]["files_failed"] == 0
    assert "Appointment 1" not in workspace.files["src/data/seed.ts"] or "patient" in workspace.files["src/data/seed.ts"]
    assert any("placeholder rows" in w["problems"][0] for w in sock.sent[-1]["warnings"])


async def test_an_unusable_spec_falls_back_to_file_by_file_generation(db):
    sock, workspace, seen = await _run(
        db, spec_result=SpecError("no page has usable blocks"),
        stream={"src/pages/Home.tsx": "import { PageBody } from '../chronos';\nexport default function Home() { return <PageBody>hi</PageBody>; }"},
    )
    assert any("file by file" in m["message"] for m in sock.of_type("STATUS"))
    assert sock.of_type("PLAN")[0]["app_name"] == "Fallback"
    assert [s["path"] for s in seen] == ["src/pages/Home.tsx"]
    assert sock.sent[-1]["composed"] is False and sock.sent[-1]["files_failed"] == 0


async def test_the_flag_turns_the_composer_off(db):
    sock, _workspace, seen = await _run(
        db, spec_result=normalize_spec(SPEC), composer=False,
        stream={"src/pages/Home.tsx": "import { PageBody } from '../chronos';\nexport default function Home() { return <PageBody>hi</PageBody>; }"},
    )
    assert sock.of_type("PLAN")[0]["app_name"] == "Fallback"
    assert [s["path"] for s in seen] == ["src/pages/Home.tsx"]
