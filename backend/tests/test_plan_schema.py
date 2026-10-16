"""The planner's reply is normalised into a plan the run can trust."""
import pytest

from app.engines.plan_schema import MAX_PAGES, PlanError, normalize_plan


def _plan(**overrides):
    base = {
        "app_name": "Clinic Appointments",
        "description": "Book and track appointments",
        "files": [
            {"path": "src/data/store.ts", "component_name": "", "description": "data", "priority": 0},
            {"path": "src/pages/Overview.tsx", "component_name": "Overview", "description": "KpiGrid", "mark": "mark-command", "priority": 1},
            {"path": "src/pages/Bookings.tsx", "component_name": "Bookings", "description": "DataTable", "mark": "mark-command", "priority": 1},
        ],
        "routes": [
            {"path": "/", "component": "Overview", "importPath": "./pages/Overview", "label": "Overview", "icon": "LayoutDashboard"},
            {"path": "/bookings", "component": "Bookings", "importPath": "./pages/Bookings", "label": "Bookings", "icon": "Calendar"},
        ],
    }
    base.update(overrides)
    return base


def test_a_good_plan_round_trips():
    plan = normalize_plan(_plan())
    assert [f.path for f in plan.files] == ["src/data/store.ts", "src/pages/Overview.tsx", "src/pages/Bookings.tsx"]
    assert [r.path for r in plan.routes] == ["/", "/bookings"]
    assert plan.to_run_dict()["routes"][0]["importPath"] == "./pages/Overview"


def test_paths_are_cleaned_and_unsafe_or_duplicate_paths_dropped():
    raw = _plan(files=[
        {"path": "./src/pages/Home.tsx", "component_name": "Home"},
        {"path": "src\\pages\\Home.tsx", "component_name": "Home"},        # duplicate after cleanup
        {"path": "../etc/passwd.tsx", "component_name": "Evil"},            # traversal
        {"path": "src/pages/Notes.md", "component_name": "Notes"},          # wrong extension
        {"path": "public/x.tsx", "component_name": "X"},                   # outside src/
    ])
    plan = normalize_plan(raw)
    assert [f.path for f in plan.files] == ["src/pages/Home.tsx"]


def test_component_name_is_derived_from_the_file_name_when_missing_or_invalid():
    raw = _plan(files=[{"path": "src/pages/sales-report.tsx", "component_name": "sales report!"}], routes=[])
    plan = normalize_plan(raw)
    assert plan.files[0].component_name == "SalesReport"
    assert plan.routes[0].component == "SalesReport"
    assert plan.routes[0].importPath == "./pages/sales-report"


def test_routes_without_a_planned_page_are_dropped_and_pages_without_a_route_get_one():
    raw = _plan(routes=[
        {"path": "/", "component": "Overview", "importPath": "./pages/Overview"},
        {"path": "/ghost", "component": "Ghost", "importPath": "./pages/Ghost"},
    ])
    plan = normalize_plan(raw)
    assert [r.path for r in plan.routes] == ["/", "/bookings"]
    assert plan.routes[1].label == "Bookings"
    assert plan.routes[1].icon == "LayoutDashboard"


def test_exactly_one_home_route():
    raw = _plan(routes=[
        {"path": "/a", "component": "Overview", "importPath": "./pages/Overview"},
        {"path": "/b", "component": "Bookings", "importPath": "./pages/Bookings"},
    ])
    plan = normalize_plan(raw)
    assert plan.routes[0].path == "/"  # first planned page becomes home
    raw = _plan(routes=[
        {"path": "/", "component": "Overview", "importPath": "./pages/Overview"},
        {"path": "/", "component": "Bookings", "importPath": "./pages/Bookings"},
    ])
    plan = normalize_plan(raw)
    assert [r.path for r in plan.routes] == ["/", "/bookings"]


def test_unknown_marks_and_icons_fall_back():
    raw = _plan()
    raw["files"][1]["mark"] = "mark-does-not-exist"
    raw["routes"][0]["icon"] = "not an icon"
    plan = normalize_plan(raw, known_marks={"mark-command"})
    assert plan.files[1].mark == "mark-command"
    assert plan.routes[0].icon == "LayoutDashboard"


def test_shared_files_are_ordered_before_pages():
    raw = _plan()
    raw["files"][0]["priority"] = 5  # the model got it wrong
    plan = normalize_plan(raw)
    assert plan.files[0].path == "src/data/store.ts"


def test_no_page_is_an_error_and_too_many_pages_is_an_error():
    with pytest.raises(PlanError, match="no page"):
        normalize_plan(_plan(files=[{"path": "src/data/store.ts"}]))
    files = [{"path": f"src/pages/P{i}.tsx", "component_name": f"P{i}"} for i in range(MAX_PAGES + 1)]
    with pytest.raises(PlanError, match="at most"):
        normalize_plan(_plan(files=files, routes=[]))


def test_non_object_plan_is_an_error():
    with pytest.raises(PlanError):
        normalize_plan(["not", "a", "plan"])


def test_route_to_a_page_by_component_name_when_import_path_is_odd():
    raw = _plan(routes=[{"path": "/", "component": "Bookings", "importPath": "pages/Bookings.tsx"}])
    plan = normalize_plan(raw)
    assert plan.routes[0].importPath == "./pages/Bookings"
    assert plan.routes[0].path == "/"
