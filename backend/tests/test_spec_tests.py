"""Acceptance cases are derived from the spec and stored in the Test Suite's shape."""
import json
from datetime import date

from app.auth.session import create_session_cookie
from app.engines import composer, spec_tests
from app.engines.spec import normalize_spec
from app.services import ai_ide_service, organization_service

from tests.test_composer import SEED, SPEC


def _spec_and_rows():
    spec = normalize_spec(SPEC)
    rows, _ = composer.coerce_seed(spec, SEED, today=date(2026, 10, 16))
    return spec, rows


def test_cases_cover_every_page_and_block_with_seeded_values():
    spec, rows = _spec_and_rows()
    cases = spec_tests.test_cases_from_spec(spec, rows)
    flat = [c for group in cases.values() for c in group]
    names = [c["name"] for c in flat]
    assert names[0] == "Open Clinic Appointments"
    assert "Navigate to Doctors" in names
    kpi = next(c for c in flat if "KPI tiles" in c["name"])
    assert "\"Appointments\" tile shows" in kpi["expected"]  # the count comes from the seed
    table = next(c for c in flat if "lists the seeded appointment rows" in c["name"])
    assert "Asha Verma" in table["expected"] and "Patient, Doctor, Start, Status, Fee, Paid" in table["expected"]
    assert any("searching Recent appointments narrows" in c["name"] for c in flat)
    assert any(c["name"].endswith("ShiftPlanner section renders") for c in flat)
    create = next(c for c in flat if c["name"] == "Doctors: create an appointment with the Book appointment form")
    assert 'press "Book"' in create["description"] and "saved" in create["expected"].lower()
    reject = next(c for c in flat if "Book appointment form rejects an empty submission" in c["name"])
    assert reject["category"] == "edge"
    assert cases["edge"] and all(c["severity"] in ("Critical", "High", "Medium", "Low") for c in flat)
    assert sorted(c["tc_id"] for c in flat) == [f"TC-{i:03d}" for i in range(1, len(flat) + 1)]  # unique, gap-free ids
    assert all(c["expected"].strip() and c["name"].strip() for c in flat)


async def _login(app_client, db, name="org_a"):
    org = await organization_service.create_organization(db, workos_org_id=name, name=name)
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    return org.id


async def test_route_creates_one_requirement_per_app_and_refreshes_on_demand(app_client, db, tmp_path, monkeypatch):
    monkeypatch.setattr(ai_ide_service, "_ai_ide_root", tmp_path / "apps")
    org_id = await _login(app_client, db)
    created = (await app_client.post("/api/ai-ide/workspace/create")).json()
    ws = created["workspace_id"]

    # An app that was not composed has no spec.
    resp = await app_client.post(f"/api/ai-ide/workspace/{ws}/test-cases")
    assert resp.status_code == 409

    spec, rows = _spec_and_rows()
    for path, content in composer.compose(spec, rows).items():
        ai_ide_service.save_file(ws, path, content)

    resp = await app_client.post(f"/api/ai-ide/workspace/{ws}/test-cases")
    assert resp.status_code == 200, resp.text
    first = resp.json()
    assert first["created"] is True and first["test_cases"] > 8
    requirement = await db.requirements.find_one({"workspace_id": ws})
    assert requirement["org_id"] == org_id and requirement["status"] == "processed" and requirement["source"] == "app_studio"
    assert await db.test_cases.count_documents({"requirement_id": first["requirement_id"]}) == first["test_cases"]

    again = (await app_client.post(f"/api/ai-ide/workspace/{ws}/test-cases")).json()
    assert again["created"] is False and again["requirement_id"] == first["requirement_id"]

    refreshed = (await app_client.post(f"/api/ai-ide/workspace/{ws}/test-cases?refresh=true")).json()
    assert refreshed["requirement_id"] == first["requirement_id"] and refreshed["test_cases"] == first["test_cases"]
    assert await db.test_cases.count_documents({"requirement_id": first["requirement_id"]}) == first["test_cases"]

    # The cases show up where Test Execution reads them.
    listed = (await app_client.get(f"/api/test-cases?requirement_id={first['requirement_id']}")).json()
    assert len(listed) == first["test_cases"]
    assert any("Asha Verma" in c["expected"] for c in listed)

    # Another org cannot reach the app.
    await _login(app_client, db, name="org_b")
    assert (await app_client.post(f"/api/ai-ide/workspace/{ws}/test-cases")).status_code == 404
    assert json.loads(ai_ide_service.get_workspace_files(ws)["app.spec.json"])["name"] == "Clinic Appointments"
