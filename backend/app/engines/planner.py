"""Planner engine asks the LLM to decide what files to generate.

The static part of the prompt (role, kit vocabulary, output contract, rules)
is the system message so it is identical across runs; the idea and the icon
catalogue are the user message. The reply is normalised into an `AppPlan`
(`plan_schema`). When it cannot be, the model gets one repair turn with the
exact reason; a second failure is an error the run reports.
"""
from __future__ import annotations

import logging
from typing import Any, Callable

from app.engines import kit
from app.engines.plan_schema import AppPlan, PlanError, normalize_plan
from app.services.ai_service import AIResponseError, _call_openai, _parse_json_object  # reuse existing sync wrapper

logger = logging.getLogger(__name__)

_TASK_NAME = "AI IDE – Plan Files"

_KIT_PLANNER_SYSTEM = """\
You are a senior React architect planning a web app. Reply with a JSON build plan only.

The project is React 18 + TypeScript + Vite + Tailwind v3 + react-router-dom v6, and it already contains
the Chronos UI kit in src/chronos: an AppShell (sidebar navigation + top bar, built automatically from
your routes), PageHeader, KpiGrid + KpiTile, Grid, SplitRow, Panel, ChartCard, DataTable, BarList,
StatusBadge, EmptyState, Select, InfoPopover, Mark (decorative 3D icons), number/date formatters, and
charts: LineChart, AreaChart, BarChart (stacked/horizontal), ComboChart, DonutChart (centre total),
Sparkline, Gauge, ProgressRing, ProgressBars, FunnelChart, BulletChart. Pick the chart that fits the
question (trend -> Line/Area, comparison -> Bar, share of total -> Donut, conversion -> Funnel, target ->
Bullet/Gauge, trend inside a KPI -> Sparkline). The visual style is fixed
(Chronos: light, clean, bordered panels), so do NOT plan layout, navigation, theme or generic UI files.

Return ONLY valid JSON, no markdown:
{
  "app_name": "Plain name of what it is, e.g. Clinic Appointments",
  "description": "One sentence describing the app",
  "files": [
    {"path": "src/data/store.ts", "component_name": "", "description": "Typed mock data shared by pages: ...", "priority": 0},
    {"path": "src/pages/Overview.tsx", "component_name": "Overview", "description": "What this page shows and which kit components it uses", "mark": "mark-command", "priority": 1}
  ],
  "routes": [
    {"path": "/", "component": "Overview", "importPath": "./pages/Overview", "label": "Overview", "icon": "LayoutDashboard"}
  ]
}

RULES:
- Naming: "app_name" is 1-3 plain words that say what the app is for, in the client's language
  ("Clinic Appointments", "Resort Operations", "Budget Tracker"). No invented brand names, no
  "AI"/"Smart"/"Pro"/"Hub"/"ly"/"ify" coinages, no slogans. Page labels are plain nouns
  ("Overview", "Bookings", "Guests"), never "Insights Hub" or "Command Center".
- 3-5 pages in src/pages/*.tsx, each a route. Exactly one route has path "/".
- Exactly ONE shared data file (src/data/store.ts, priority 0) that defines EVERY dataset the pages'
  blueprints mention (typed, realistic, internally consistent numbers). Pages only import and display it.
  Only add a custom component (src/components/*.tsx, priority 0) for something the kit truly lacks.
- Never plan a Navbar, Sidebar, Layout or App file.
- "icon" is a lucide-react icon name in PascalCase (e.g. LayoutDashboard, Users, Settings, BarChart3).
- "mark" is one id from the 3D icon list in the request that fits the page.
- Each page "description" is a BLUEPRINT, top to bottom, e.g. "KpiGrid: 4 KpiTiles (Revenue usdCompact,
  Occupancy %, ADR, Cancellations) | SplitRow: LineChart of daily revenue (30 days) + BarList top 5 room
  types | DataTable of recent bookings (guest, dates, status badge, total) with search". Name the kit
  component for every section and the exact data it shows. Vary the layout between pages.
"""

_KIT_PLANNER_USER = """\
User idea: {idea}
{design_notes}
3D icons:
{marks}
"""

_REPAIR_USER = """\
Your previous plan was rejected: {reason}

Return the corrected plan as JSON only, following every rule.

User idea: {idea}
{design_notes}
3D icons:
{marks}
"""

_LEGACY_PLANNER_PROMPT = """\
You are a senior React architect. Given a user idea, produce a JSON build plan for a web application
built with React 18 + TypeScript + Vite + Tailwind CSS + react-router-dom v6 + recharts + lucide-react.

User idea: {idea}

Return ONLY valid JSON, no markdown:
{{
  "app_name": "Human readable title",
  "description": "One sentence",
  "color_theme": "the visual direction",
  "files": [
    {{"path": "src/components/Navbar.tsx", "component_name": "Navbar", "description": "...", "imports": ["lucide-react"], "priority": 0}},
    {{"path": "src/pages/Dashboard.tsx", "component_name": "Dashboard", "description": "...", "imports": ["recharts"], "priority": 1}}
  ],
  "routes": [{{"path": "/", "component": "Dashboard", "importPath": "./pages/Dashboard", "label": "Dashboard", "icon": "LayoutDashboard"}}]
}}

RULES:
- 3-5 page files (src/pages/*.tsx) and src/components/Navbar.tsx (priority 0) linking every route; pages render <Navbar /> first.
- Exactly one route has path "/". component_name equals the default export name.
"""

# The idea is the user's text (or a whole PRD file); this keeps one upload from
# turning into a prompt the model cannot finish within the planner timeout.
MAX_IDEA_CHARS = 12000

_NAV_FILES = {"navbar", "sidebar", "layout", "app", "header", "nav"}


def _known_marks() -> set[str] | None:
    try:
        from app.services import marks_service

        ids = marks_service.known_ids()
        return set(ids) if ids else None
    except Exception:  # noqa: BLE001 - validation without the catalogue is still validation
        return None


def _strip_nav_files(plan: dict) -> dict:
    files = plan.get("files")
    if isinstance(files, list):
        plan["files"] = [
            f for f in files
            if not (
                isinstance(f, dict)
                and str(f.get("path", "")).rsplit("/", 1)[-1].split(".")[0].lower() in _NAV_FILES
            )
        ]
    return plan


async def plan_files(
    idea: str,
    *,
    design_notes: str | None = None,
    log_extra: dict | None = None,
    usage_sink: Callable[[int, int], None] | None = None,
) -> dict:
    """The validated plan as a plain dict (`AppPlan.to_run_dict()`); raises PlanError or AIResponseError."""
    idea = (idea or "").strip()
    if len(idea) > MAX_IDEA_CHARS:
        idea = idea[:MAX_IDEA_CHARS] + "\n[truncated]"

    if not kit.has_kit():
        raw = await _call_openai(
            _LEGACY_PLANNER_PROMPT.format(idea=idea), json_mode=True, task_name=_TASK_NAME,
            log_extra=log_extra, usage_sink=usage_sink,
        )
        plan = _parse_json_object(raw)
        files = plan.get("files")
        if isinstance(files, list):
            files.sort(key=lambda f: f.get("priority", 1) if isinstance(f, dict) else 1)
        return plan

    marks = kit.marks_catalog(idea, 60) or "(none available)"
    known = _known_marks()
    notes = (design_notes or "").strip()[:1500]
    notes_block = f"\nDesign system notes (the client's look and vocabulary; follow them in names and labels):\n{notes}\n" if notes else ""
    user = _KIT_PLANNER_USER.format(idea=idea, marks=marks, design_notes=notes_block)
    last_error: str | None = None
    for attempt in range(2):
        if attempt:
            user = _REPAIR_USER.format(reason=last_error, idea=idea, marks=marks, design_notes=notes_block)
        raw = await _call_openai(
            user, json_mode=True, task_name=_TASK_NAME, system=_KIT_PLANNER_SYSTEM,
            log_extra=log_extra, usage_sink=usage_sink,
        )
        try:
            plan = normalize_plan(_strip_nav_files(_parse_json_object(raw)), known_marks=known)
        except (PlanError, AIResponseError) as exc:
            last_error = str(exc)
            logger.warning("[Planner] attempt %d rejected: %s", attempt + 1, last_error)
            continue
        return plan.to_run_dict()
    raise PlanError(f"The planner could not produce a usable plan: {last_error}")


def validate_plan(raw: Any) -> AppPlan:
    """Validate a plan that did not come from `plan_files` (tests, imports)."""
    return normalize_plan(_strip_nav_files(dict(raw)) if isinstance(raw, dict) else raw, known_marks=_known_marks())


# ── Spec planning (composer path) ────────────────────────────────────────────
#
# The spec is a checkable description of the app: entities with typed fields
# and pages made of kit blocks bound to those entities. The composer renders
# every page from it without a model call, so this one call replaces the
# per-file prompts. The vocabulary below is the whole contract.

_SPEC_SYSTEM = """\
You are a senior product architect. Describe a web app as a JSON spec only. Pages are composed from a fixed UI kit
(Chronos: sidebar app shell, KPI tiles, panels, charts, tables, lists) by a program; you decide the data model and
what each page shows, not the code.

Return ONLY valid JSON:
{
  "name": "Plain name of what it is (1-3 words, the client's language, no brand coinages)",
  "description": "One sentence",
  "entities": {
    "Appointment": { "label": "Appointment", "fields": {
      "patient": "string", "doctor": "ref:Doctor", "start": "datetime", "status": "enum:scheduled|done|cancelled",
      "fee": "money", "notes": "text", "paid": "boolean", "satisfaction": "percent" } },
    "Doctor": { "fields": { "name": "string", "speciality": "enum:Cardiology|General", "email": "email" } }
  },
  "pages": [
    { "title": "Overview", "icon": "LayoutDashboard", "mark": "mark-command", "description": "One line", "blocks": [
      { "type": "kpis", "items": [
        { "label": "Appointments", "metric": "count(Appointment)" },
        { "label": "Revenue", "metric": "sum(Appointment.fee)", "format": "currency" },
        { "label": "Done", "metric": { "fn": "count", "entity": "Appointment", "where": { "field": "status", "op": "eq", "value": "done" } }, "tone": "success" } ] },
      { "type": "split", "ratio": "1.4/1", "children": [
        { "type": "chart", "kind": "line", "title": "Appointments per day", "series": [ { "label": "Appointments", "metric": "count(Appointment)" } ], "group": { "field": "start", "by": "day" } },
        { "type": "barlist", "title": "Top doctors", "entity": "Appointment", "group": "doctor", "metric": "count(Appointment)", "limit": 5 } ] },
      { "type": "table", "title": "Recent appointments", "entity": "Appointment", "columns": ["patient", "doctor", "start", "status", "fee"], "badge": "status", "sort": { "field": "start", "dir": "desc" } }
    ] }
  ]
}

Field kinds: id (added automatically), string, text, number, money, percent (fraction), boolean, date, datetime, email, url,
"enum:a|b|c", "ref:EntityName" (holds the other entity's id).
Metric: "fn(Entity)" or "fn(Entity.field)" with fn in count|sum|avg|min|max; the object form adds "where" {field, op in
eq|neq|gt|gte|lt|lte|in, value}.
Block types:
- kpis: 2-5 items {label, metric, format: number|currency|percent, tone?: success|info|warning|error}.
- chart: kind line|area (needs a date/datetime group with by day|week|month) or bar|donut (group by an enum/ref/string
  field); 1-3 series {label, metric}; format.
- table: entity, columns (field names), badge (an enum column), sort {field, dir}, search (default true), limit.
- list: entity, primary (field), secondary (field), badge (enum field), limit — a compact recent-items list.
- barlist / progress: entity, group (enum/ref/string field), metric, limit — ranked breakdown / completion bars.
- panel: title, text — a short static note.
- split (exactly 2 children, ratio 1.4/1|1/1.4|1.6/1|1/2) and grid (2-6 children) lay out the blocks above; no nesting beyond one level.
- custom: name (PascalCase), description — ONLY for something the kit cannot express (a calendar grid, a map, a wizard).
  Use it rarely: every custom block costs a model call and is less consistent.
Rules: 2-5 entities with 4-9 fields each, realistic names in the client's language; 3-5 pages, the first is the overview;
each page 2-5 blocks with varied layout (not the same shape every page); every page shows real metrics of the entities;
"icon" is a lucide-react icon name; "mark" is one id from the 3D icon list.
"""

_SPEC_USER = """\
User idea: {idea}
{design_notes}
3D icons:
{marks}
"""

_SPEC_REPAIR_USER = """\
Your previous spec was rejected: {reason}

Return the corrected spec as JSON only, following every rule.

User idea: {idea}
{design_notes}
3D icons:
{marks}
"""

_SEED_SYSTEM = """\
You write realistic seed data for a demo app. Reply with JSON only: an object with one key per entity holding an
array of row objects. Use the exact field names given. Rows must be internally consistent: refs hold ids of rows you
wrote for the referenced entity (ids are strings like "doctor-1"); dates are ISO strings spread over the last 45
days; money is a number in whole currency units; percent is a fraction (0.42); enums use the listed values; names,
titles and notes read like real records in the client's domain, never "Item 1" or lorem ipsum. No markdown.
"""

_SEED_USER = """\
App: {name}. {description}

Entities and fields:
{entities}

Write {per_entity} rows per entity (referenced entities first). Today is {today}.
"""


async def plan_spec(
    idea: str,
    *,
    design_notes: str | None = None,
    log_extra: dict | None = None,
    usage_sink: Callable[[int, int], None] | None = None,
) -> "AppSpec":
    """A validated `AppSpec` for the idea; one repair turn, then `SpecError`."""
    from app.engines.spec import SpecError, normalize_spec

    idea = (idea or "").strip()
    if len(idea) > MAX_IDEA_CHARS:
        idea = idea[:MAX_IDEA_CHARS] + "\n[truncated]"
    marks = kit.marks_catalog(idea, 60) or "(none available)"
    known = _known_marks()
    notes = (design_notes or "").strip()[:1500]
    notes_block = f"\nDesign system notes (the client's look and vocabulary; follow them in names and labels):\n{notes}\n" if notes else ""
    user = _SPEC_USER.format(idea=idea, marks=marks, design_notes=notes_block)
    last_error: str | None = None
    for attempt in range(2):
        if attempt:
            user = _SPEC_REPAIR_USER.format(reason=last_error, idea=idea, marks=marks, design_notes=notes_block)
        raw = await _call_openai(
            user, json_mode=True, task_name="AI IDE – Plan Spec", system=_SPEC_SYSTEM,
            log_extra=log_extra, usage_sink=usage_sink,
        )
        try:
            return normalize_spec(_parse_json_object(raw), known_marks=known)
        except (SpecError, AIResponseError) as exc:
            last_error = str(exc)
            logger.warning("[Planner] spec attempt %d rejected: %s", attempt + 1, last_error)
    raise SpecError(f"The planner could not produce a usable spec: {last_error}")


def _entity_sheet(spec: "AppSpec") -> str:
    lines = []
    for name, ent in spec.entities.items():
        parts = []
        for fname, f in ent.fields.items():
            if f.kind == "enum":
                parts.append(f"{fname}: enum {'|'.join(f.values)}")
            elif f.kind == "ref":
                parts.append(f"{fname}: id of {f.ref}")
            else:
                parts.append(f"{fname}: {f.kind}")
        lines.append(f"- {name}: " + ", ".join(parts))
    return "\n".join(lines)


async def seed_rows(
    spec: "AppSpec",
    *,
    per_entity: int = 12,
    today: str | None = None,
    log_extra: dict | None = None,
    usage_sink: Callable[[int, int], None] | None = None,
) -> dict:
    """The model's seed rows per entity (raw; the composer validates and completes them)."""
    from datetime import date

    user = _SEED_USER.format(
        name=spec.name, description=spec.description, entities=_entity_sheet(spec),
        per_entity=per_entity, today=today or date.today().isoformat(),
    )
    raw = await _call_openai(
        user, json_mode=True, task_name="AI IDE – Seed Data", system=_SEED_SYSTEM,
        log_extra=log_extra, usage_sink=usage_sink,
    )
    return _parse_json_object(raw)
