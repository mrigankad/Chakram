"""Test cases derived from an app spec, with no model call.

A composed page's blocks say what the page must show: a KPI block shows its
labels and a count the seed makes exact, a table lists seeded rows and its
search narrows them, a chart or list shows its title, a custom block renders
its section. Those are the acceptance cases for a built app, written in the
shape the Test Suite / Test Execution pages already use (`test_cases`), so a
deployed app can be verified by the existing browser engine right after it
is built.
"""
from __future__ import annotations

from typing import Any

from app.engines.naming import collection_name
from app.engines.spec import AppSpec, Block, Metric, PageSpec


def _matches(row: dict[str, Any], metric: Metric) -> bool:
    w = metric.where
    if w is None:
        return True
    v = row.get(w.field)
    if w.op == "eq":
        return v == w.value or str(v) == str(w.value)
    if w.op == "neq":
        return not (v == w.value or str(v) == str(w.value))
    try:
        a, b = float(v), float(w.value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    return {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}.get(w.op, False)


def _count(rows: dict[str, list[dict[str, Any]]], metric: Metric) -> int:
    return sum(1 for r in rows.get(metric.entity, []) if _matches(r, metric))


def _label_value(spec: AppSpec, rows: dict[str, list[dict[str, Any]]], entity: str, field: str) -> str | None:
    """A value from the first seeded row that the UI shows as text (refs resolved to their label)."""
    first = (rows.get(entity) or [None])[0]
    if not first:
        return None
    f = spec.entities[entity].fields.get(field)
    value = first.get(field)
    if f is None or value in (None, ""):
        return None
    if f.kind == "ref" and f.ref in spec.entities:
        target = spec.entities[f.ref]
        for r in rows.get(f.ref, []):
            if r.get("id") == value:
                value = r.get(target.label_field)
                break
    if f.kind in ("string", "text", "email", "enum", "ref"):
        return str(value)
    return None


def _case(tc: int, name: str, description: str, expected: str, severity: str, category: str) -> dict[str, str]:
    return {
        "tc_id": f"TC-{tc:03d}",
        "name": name,
        "description": description,
        "expected": expected,
        "severity": severity,
        "category": category,
    }


def _walk(blocks: list[Block]):
    for b in blocks:
        yield b
        yield from _walk(b.children)


def test_cases_from_spec(spec: AppSpec, rows: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, str]]]:
    """Cases grouped by category, the shape `test_case_service.create_test_cases_from_ai` stores."""
    cases: dict[str, list[dict[str, str]]] = {"functional": [], "edge": [], "regression": []}
    n = 0

    def add(category: str, name: str, description: str, expected: str, severity: str) -> None:
        nonlocal n
        n += 1
        cases[category].append(_case(n, name, description, expected, severity, category))

    home = next((p for p in spec.pages if p.path == "/"), spec.pages[0])
    add(
        "functional",
        f"Open {spec.name}",
        f"Open the app's root URL. The {home.title} page is the home page.",
        f"The page shows the title \"{home.title}\" and a sidebar listing: {', '.join(p.title for p in spec.pages)}.",
        "Critical",
    )

    for page in spec.pages:
        if page.path != "/":
            add(
                "functional",
                f"Navigate to {page.title}",
                f"From the sidebar, open \"{page.title}\" (route {page.path}).",
                f"The page title \"{page.title}\" is shown and the sidebar marks {page.title} as active.",
                "High",
            )
        for block in _walk(page.blocks):
            _block_cases(spec, rows, page, block, add)

    add(
        "edge",
        "Unknown route shows the app's own not-found state",
        "Open a route that no page owns, such as /this-page-does-not-exist.",
        "The app shell stays visible and shows a placeholder message instead of a blank page or a server error.",
        "Low",
    )
    return {k: v for k, v in cases.items() if v}


def _block_cases(spec: AppSpec, rows: dict[str, list[dict[str, Any]]], page: PageSpec, block: Block, add) -> None:
    if block.type == "kpis":
        labels = [i.label for i in block.items]
        exact = next((i for i in block.items if i.metric.fn == "count"), None)
        value = f" The \"{exact.label}\" tile shows {_count(rows, exact.metric):,}." if exact else ""
        add(
            "functional",
            f"{page.title}: KPI tiles show the seeded figures",
            f"On {page.title}, read the KPI row: {', '.join(labels)}.",
            f"Every tile has its label and a non-empty figure (never \"NaN\" or \"—\").{value}",
            "High",
        )
    elif block.type == "table":
        entity = spec.entities[block.entity]
        sample = _label_value(spec, rows, block.entity, block.columns[0]) if block.columns else None
        seen = f" The row \"{sample}\" is listed." if sample else ""
        add(
            "functional",
            f"{page.title}: {block.title} lists the seeded {entity.label.lower()} rows",
            f"On {page.title}, find the \"{block.title}\" table.",
            f"The table has the columns {', '.join(entity.fields[c].label for c in block.columns)} and at least one row.{seen}",
            "High",
        )
        if block.search and sample:
            add(
                "functional",
                f"{page.title}: searching {block.title} narrows the rows",
                f"In the \"{block.title}\" table's search box type \"{sample}\".",
                f"Only rows matching \"{sample}\" remain, and \"{sample}\" is still visible.",
                "Medium",
            )
            add(
                "edge",
                f"{page.title}: searching {block.title} for nonsense shows the empty state",
                f"In the \"{block.title}\" table's search box type \"zzqxv-no-such-row\".",
                "The table shows its empty message instead of rows, and clearing the search brings the rows back.",
                "Low",
            )
    elif block.type == "chart":
        add(
            "functional",
            f"{page.title}: {block.title} chart renders",
            f"On {page.title}, look at the \"{block.title}\" panel.",
            f"The panel titled \"{block.title}\" shows a {block.kind} chart, not an empty or error state.",
            "Medium",
        )
    elif block.type in ("barlist", "progress", "list"):
        add(
            "functional",
            f"{page.title}: {block.title} shows seeded entries",
            f"On {page.title}, find the \"{block.title}\" panel.",
            f"The panel lists at least one entry with a label and a value.",
            "Medium",
        )
    elif block.type == "panel":
        add(
            "regression",
            f"{page.title}: {block.title} note is shown",
            f"On {page.title}, find the \"{block.title}\" panel.",
            f"It shows the text: {block.text[:120]}",
            "Low",
        )
    elif block.type == "form":
        entity = spec.entities[block.entity]
        _an = lambda w: f"an {w}" if w[:1] in "aeiou" else f"a {w}"  # noqa: E731
        required = [entity.fields[f].label for f in block.fields if entity.fields[f].kind in ("string", "email", "url", "ref", "date", "datetime")]
        add(
            "functional",
            f"{page.title}: create {_an(entity.label.lower())} with the {block.title} form",
            f"On {page.title}, fill every field of the \"{block.title}\" form with valid values and press \"{block.submit_label}\".",
            f"A \"{entity.label} saved\" badge appears and the new {entity.label.lower()} is listed on the page (or in the {entity.label.lower()} table).",
            "High",
        )
        if required:
            add(
                "edge",
                f"{page.title}: the {block.title} form rejects an empty submission",
                f"On {page.title}, press \"{block.submit_label}\" without filling the form.",
                f"An error badge names the required fields ({', '.join(required[:4])}) and nothing is saved.",
                "Medium",
            )
    elif block.type == "custom":
        add(
            "functional",
            f"{page.title}: {block.name} section renders",
            f"On {page.title}, find the custom section \"{block.name}\" ({block.description[:100]}).",
            "The section is visible and shows no error box (\"This section could not be shown\").",
            "Medium",
        )


def requirement_text(spec: AppSpec) -> str:
    entities = ", ".join(f"{name} ({', '.join(f for f in e.fields if f != 'id')})" for name, e in spec.entities.items())
    pages = "; ".join(f"{p.title} [{', '.join(b.type for b in p.blocks)}]" for p in spec.pages)
    return (
        f"{spec.name}. {spec.description}\n"
        f"Built in App Studio from app.spec.json. Entities: {entities}. Pages: {pages}."
    )
