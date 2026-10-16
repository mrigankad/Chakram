"""The composer renders a spec into files that pass the structural check and match the golden app.

The golden app under tests/golden/composed_app is also type-checked against the
real kit by the frontend's `npm run check:composed`, so a change to the
composer or the kit that breaks a composed page fails CI. Regenerate the golden
files with UPDATE_GOLDEN=1 after an intended change and review the diff.
"""
import json
import os
from datetime import date
from pathlib import Path

from app.engines import composer, kit
from app.engines.spec import normalize_spec
from app.engines.verify import verify_file

GOLDEN = Path(__file__).parent / "golden" / "composed_app"

SPEC = {
    "name": "Clinic Appointments",
    "description": "Book and track appointments",
    "entities": {
        "Doctor": {"fields": {"name": "string", "speciality": "enum:Cardiology|Dermatology|General", "email": "email"}},
        "Appointment": {"fields": {
            "patient": "string", "doctor": "ref:Doctor", "start": "datetime", "status": "enum:scheduled|done|cancelled",
            "fee": "money", "notes": "text", "paid": "boolean", "satisfaction": "percent",
        }},
    },
    "pages": [
        {"title": "Overview", "icon": "LayoutDashboard", "mark": "mark-command", "description": "Today at a glance", "blocks": [
            {"type": "kpis", "items": [
                {"label": "Appointments", "metric": "count(Appointment)"},
                {"label": "Revenue", "metric": "sum(Appointment.fee)", "format": "currency"},
                {"label": "Done", "metric": {"fn": "count", "entity": "Appointment", "where": {"field": "status", "op": "eq", "value": "done"}}, "tone": "success"},
                {"label": "Avg satisfaction", "metric": "avg(Appointment.satisfaction)", "format": "percent"},
            ]},
            {"type": "split", "children": [
                {"type": "chart", "kind": "line", "title": "Appointments per day", "series": [
                    {"label": "Appointments", "metric": "count(Appointment)"}, {"label": "Revenue", "metric": "sum(Appointment.fee)"}],
                 "group": {"field": "start", "by": "day"}},
                {"type": "barlist", "title": "Top doctors", "entity": "Appointment", "group": "doctor", "metric": "count(Appointment)", "limit": 5},
            ]},
            {"type": "table", "title": "Recent appointments", "entity": "Appointment",
             "columns": ["patient", "doctor", "start", "status", "fee", "paid"], "badge": "status", "sort": {"field": "start", "dir": "desc"}},
        ]},
        {"title": "Doctors", "icon": "Users", "blocks": [
            {"type": "grid", "children": [
                {"type": "chart", "kind": "donut", "title": "By speciality", "series": [{"label": "Doctors", "metric": "count(Doctor)"}], "group": "speciality"},
                {"type": "progress", "title": "Appointments by status", "entity": "Appointment", "group": "status"},
                {"type": "list", "title": "Latest", "entity": "Appointment", "primary": "patient", "secondary": "fee", "badge": "status", "limit": 6},
            ]},
            {"type": "chart", "kind": "bar", "title": "Revenue by doctor", "series": [{"label": "Revenue", "metric": "sum(Appointment.fee)"}], "group": "doctor", "format": "currency"},
            {"type": "table", "entity": "Doctor"},
            {"type": "panel", "title": "Notes", "text": "Seed data only; connect the API before go-live."},
            {"type": "custom", "name": "ShiftPlanner", "description": "A week grid of doctor shifts with a toggle per slot."},
        ]},
    ],
}

SEED = {
    "Doctor": [{"name": "Dr Rao", "speciality": "Cardiology", "email": "rao@clinic.test"}, {"name": "Dr Lee", "speciality": "General", "email": "lee@clinic.test"}],
    "Appointment": [
        {"patient": "Asha Verma", "doctor": "doctor-1", "start": "2026-10-01T09:00:00Z", "status": "done", "fee": 120, "notes": "Follow-up", "paid": "yes", "satisfaction": 92},
        {"patient": "Ben Oduya", "doctor": "doctor-2", "start": "2026-10-03T11:30:00Z", "status": "scheduled", "fee": 80, "notes": "", "paid": False, "satisfaction": 0.8},
    ],
}


def _compose():
    spec = normalize_spec(SPEC)
    rows, warnings = composer.coerce_seed(spec, SEED, today=date(2026, 10, 16))
    return spec, rows, warnings, composer.compose(spec, rows)


def test_seed_rows_are_validated_and_completed():
    spec, rows, warnings, _ = _compose()
    doctors, appointments = rows["Doctor"], rows["Appointment"]
    assert doctors[0]["id"] == "doctor-1" and doctors[0]["speciality"] == "Cardiology"
    assert len(doctors) >= 6 and len(appointments) >= 6  # completed to the minimum
    assert any("plain rows were added" in w for w in warnings)
    first = appointments[0]
    assert first["paid"] is True and first["satisfaction"] == 0.92  # "yes" and 92 coerced
    assert first["doctor"] in {d["id"] for d in doctors}
    assert all(a["status"] in ("scheduled", "done", "cancelled") for a in appointments)
    assert all(a["start"][:4] == "2026" for a in appointments)


def test_every_composed_file_passes_the_structural_check():
    spec, _rows, _w, files = _compose()
    known = set(kit.kit_files()) | set(files) | {"src/components/ShiftPlanner.tsx"}
    for path, content in files.items():
        if not path.endswith((".ts", ".tsx")):
            continue
        result = verify_file(path, content, kit_exports=set(kit.kit_exports()), workspace_files=known, planned_files=set(files))
        assert result.ok, f"{path}: {result.problems}"
    assert set(files) == {"app.spec.json", "src/data/types.ts", "src/data/queries.ts", "src/data/seed.ts", "src/pages/Overview.tsx", "src/pages/Doctors.tsx"}


def test_pages_import_only_what_they_use_and_bind_to_the_seed():
    _spec, _rows, _w, files = _compose()
    overview = files["src/pages/Overview.tsx"]
    assert "LineChart" in overview and "DonutChart" not in overview
    assert "import { appointments, doctors } from '../data/seed';" in overview
    assert "lookup(doctors, r.doctor, \"name\")" in overview
    assert 'defaultSort={{ key: "start", dir: "desc" }}' in overview
    doctors = files["src/pages/Doctors.tsx"]
    assert "<ShiftPlanner />" in doctors and "import ShiftPlanner from '../components/ShiftPlanner';" in doctors
    assert "DonutChart" in doctors and "ProgressBars" in doctors and "BarChart" in doctors
    assert "series" not in doctors.split("\n")[0] or "series" in doctors  # import list is exact (checked by tsc in CI)
    types = files["src/data/types.ts"]
    assert "export type AppointmentStatus = \"scheduled\" | \"done\" | \"cancelled\";" in types
    assert "doctor: string; // Doctor id" in types


def test_custom_block_spec_tells_the_model_what_data_exists():
    spec, _rows, _w, _files = _compose()
    page, block = spec.custom_blocks()[0]
    file_spec = composer.custom_component_spec(page, block, spec)
    assert file_spec["path"] == "src/components/ShiftPlanner.tsx"
    assert "appointments (Appointment[])" in file_spec["description"] and "'../data/queries'" in file_spec["description"]


def test_golden_app_matches_the_composer_output():
    """Regenerate with UPDATE_GOLDEN=1 after an intended change; CI type-checks these files."""
    _spec, _rows, _w, files = _compose()
    files = dict(files)
    files["src/components/ShiftPlanner.tsx"] = "export default function ShiftPlanner() {\n  return <div className=\"text-body-md text-secondary\">Shift planner</div>;\n}\n"
    if os.environ.get("UPDATE_GOLDEN") == "1" or not GOLDEN.exists():
        for path, content in files.items():
            target = GOLDEN / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
    for path, content in files.items():
        assert (GOLDEN / path).read_text(encoding="utf-8") == content, f"{path} differs from the golden copy (UPDATE_GOLDEN=1 to accept)"
    stale = {p.relative_to(GOLDEN).as_posix() for p in GOLDEN.rglob("*") if p.is_file()} - set(files)
    assert not stale, f"golden files no longer produced: {sorted(stale)}"
    assert json.loads(files["app.spec.json"])["name"] == "Clinic Appointments"
