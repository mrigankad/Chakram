"""The app spec is normalised deterministically; what cannot be repaired is a SpecError."""
import pytest

from app.engines.spec import SpecError, normalize_spec

ENTITIES = {
    "Doctor": {"fields": {"name": "string", "speciality": "enum:Cardiology|General", "email": "email"}},
    "Appointment": {"fields": {"patient": "string", "doctor": "ref:Doctor", "start": "datetime", "status": "enum:scheduled|done|cancelled", "fee": "money", "paid": "boolean"}},
}


def _spec(**overrides):
    base = {
        "name": "Clinic Appointments",
        "entities": ENTITIES,
        "pages": [
            {"title": "Overview", "blocks": [
                {"type": "kpis", "items": [{"label": "Appointments", "metric": "count(Appointment)"}, {"label": "Revenue", "metric": "sum(Appointment.fee)"}]},
                {"type": "table", "entity": "Appointment", "columns": ["patient", "doctor", "fee"], "badge": "status"},
            ]},
            {"title": "Doctors", "blocks": [{"type": "table", "entity": "Doctor"}]},
        ],
    }
    base.update(overrides)
    return base


def test_a_good_spec_round_trips_with_derived_names_and_routes():
    spec = normalize_spec(_spec())
    assert list(spec.entities) == ["Doctor", "Appointment"]
    assert spec.entities["Appointment"].fields["id"].kind == "id"
    assert spec.entities["Appointment"].fields["doctor"].ref == "Doctor"
    assert spec.entities["Doctor"].label_field == "name"
    assert [p.path for p in spec.pages] == ["/", "/doctors"]
    assert [p.component for p in spec.pages] == ["Overview", "Doctors"]
    kpis = spec.pages[0].blocks[0]
    assert kpis.items[1].metric.fn == "sum" and kpis.items[1].metric.field == "fee" and kpis.items[1].format == "currency"
    table = spec.pages[0].blocks[1]
    assert table.badge == "status" and table.sort_field == "start"


def test_field_aliases_and_unknown_kinds():
    spec = normalize_spec(_spec(entities={"Order": {"fields": {"total": "price", "qty": "int", "done": "bool", "weird": "blob", "when": "timestamp"}}},
                                pages=[{"title": "Orders", "blocks": [{"type": "table", "entity": "Order"}]}]))
    fields = spec.entities["Order"].fields
    assert fields["total"].kind == "money" and fields["qty"].kind == "number" and fields["done"].kind == "boolean"
    assert fields["when"].kind == "datetime" and "weird" not in fields


def test_bindings_to_unknown_fields_and_entities_are_repaired_or_dropped():
    raw = _spec(pages=[{"title": "Overview", "blocks": [
        {"type": "kpis", "items": [{"label": "Ghost", "metric": "count(Ghost)"}, {"label": "Ok", "metric": "sum(Appointment.nope)"}]},
        {"type": "table", "entity": "Appointment", "columns": ["patient", "ghost"], "badge": "patient"},
        {"type": "chart", "kind": "line", "series": [{"label": "A", "metric": "count(Appointment)"}]},
        {"type": "bogus"},
    ]}])
    spec = normalize_spec(raw)
    blocks = spec.pages[0].blocks
    assert len(blocks) == 3
    assert [i.label for i in blocks[0].items] == ["Ok"]
    assert blocks[0].items[0].metric.field == "fee"  # a numeric field was substituted
    assert blocks[1].columns == ["patient"] and blocks[1].badge == ""
    assert blocks[2].group is not None and blocks[2].group.field == "start" and blocks[2].group.by == "day"


def test_split_needs_two_children_and_nesting_is_one_level():
    raw = _spec(pages=[{"title": "Overview", "blocks": [
        {"type": "split", "children": [{"type": "table", "entity": "Doctor"}]},
        {"type": "grid", "children": [{"type": "grid", "children": [{"type": "table", "entity": "Doctor"}]}, {"type": "panel", "title": "N", "text": "note"}]},
    ]}])
    spec = normalize_spec(raw)
    blocks = spec.pages[0].blocks
    assert blocks[0].type == "table"  # a split with one child collapses to that child
    assert blocks[1].type == "grid"  # the nested grid collapsed to its table, so the outer grid keeps two children
    assert [c.type for c in blocks[1].children] == ["table", "panel"]


def test_custom_blocks_get_unique_component_names():
    raw = _spec(pages=[
        {"title": "A", "blocks": [{"type": "custom", "name": "Planner", "description": "x"}]},
        {"title": "B", "blocks": [{"type": "custom", "name": "Planner", "description": "y"}, {"type": "custom", "description": "no name"}]},
    ])
    spec = normalize_spec(raw)
    names = [b.name for _p, b in spec.custom_blocks()]
    assert names == ["Planner", "Planner2", "Custom"]
    files = [f["path"] for f in spec.to_plan_dict()["files"]]
    assert files[:3] == ["src/components/Planner.tsx", "src/components/Planner2.tsx", "src/components/Custom.tsx"]


def test_errors_name_what_to_fix():
    with pytest.raises(SpecError, match="'name'"):
        normalize_spec(_spec(name=""))
    with pytest.raises(SpecError, match="entities"):
        normalize_spec(_spec(entities={}))
    with pytest.raises(SpecError, match="usable fields"):
        normalize_spec(_spec(entities={"X": {"fields": {"a": "blob"}}}))
    with pytest.raises(SpecError, match="pages"):
        normalize_spec(_spec(pages=[]))
    with pytest.raises(SpecError, match="usable blocks"):
        normalize_spec(_spec(pages=[{"title": "Empty", "blocks": [{"type": "kpis", "items": []}]}]))


def test_marks_icons_and_paths_are_validated():
    raw = _spec()
    raw["pages"][0].update({"mark": "mark-nope", "icon": "not an icon", "path": "no slash"})
    raw["pages"][1].update({"path": "/"})
    spec = normalize_spec(raw, known_marks={"mark-command"})
    assert spec.pages[0].mark == "mark-command" and spec.pages[0].icon == "LayoutDashboard"
    assert [p.path for p in spec.pages] == ["/overview", "/"]
