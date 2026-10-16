"""The app spec: what the planner emits and what the composer renders.

A spec names the app, its entities (typed fields) and its pages as blocks
bound to those entities. Everything in it is checkable, so the composer can
write every page deterministically from the Chronos kit; the model only ever
writes seed rows for the entities and the body of `custom` blocks.

Deterministic repairs happen in `normalize_spec`: unknown fields and entities
are dropped from bindings, missing titles and routes are derived, page count
and route uniqueness are enforced. What cannot be repaired raises `SpecError`
with a message the planner gets for one repair turn.
"""
from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from app.engines.plan_schema import DEFAULT_ICON, DEFAULT_MARK, MAX_PAGES, PlanError

SPEC_VERSION = 1

FieldKind = Literal["id", "string", "text", "number", "money", "percent", "boolean", "date", "datetime", "email", "url", "enum", "ref"]
_SCALAR_KINDS = {"id", "string", "text", "number", "money", "percent", "boolean", "date", "datetime", "email", "url"}
_NUMERIC_KINDS = {"number", "money", "percent"}
_TIME_KINDS = {"date", "datetime"}
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_ENTITY = re.compile(r"^[A-Z][A-Za-z0-9]*$")
_ICON = re.compile(r"^[A-Z][A-Za-z0-9]{1,40}$")
_MARK = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
BLOCK_TYPES = ("kpis", "chart", "table", "barlist", "list", "progress", "panel", "split", "grid", "form", "custom")
METRIC_FNS = ("count", "sum", "avg", "min", "max")
CHART_KINDS = ("line", "area", "bar", "donut")
FORMATS = ("number", "currency", "percent")
OPS = ("eq", "neq", "gt", "gte", "lt", "lte", "in")
GROUP_BY = ("value", "day", "week", "month")


class SpecError(PlanError):
    """The spec cannot be used; the message says what the model must fix."""


class FieldSpec(BaseModel):
    kind: FieldKind
    label: str = ""
    values: list[str] = Field(default_factory=list)  # enum
    ref: str = ""  # entity name for refs


class EntitySpec(BaseModel):
    label: str
    fields: dict[str, FieldSpec]

    @property
    def label_field(self) -> str:
        """The field that names a row (first string field, else the id)."""
        for name, f in self.fields.items():
            if f.kind in ("string", "email") and name != "id":
                return name
        return "id"


class Where(BaseModel):
    field: str
    op: Literal["eq", "neq", "gt", "gte", "lt", "lte", "in"] = "eq"
    value: Any = None


class Metric(BaseModel):
    fn: Literal["count", "sum", "avg", "min", "max"] = "count"
    entity: str
    field: str = ""
    where: Where | None = None


class Group(BaseModel):
    field: str
    by: Literal["value", "day", "week", "month"] = "value"


class KpiItem(BaseModel):
    label: str
    metric: Metric
    format: Literal["number", "currency", "percent"] = "number"
    tone: Literal["neutral", "success", "info", "warning", "error"] = "neutral"


class Series(BaseModel):
    label: str
    metric: Metric


class Block(BaseModel):
    type: Literal["kpis", "chart", "table", "barlist", "list", "progress", "panel", "split", "grid", "form", "custom"]
    title: str = ""
    # kpis
    items: list[KpiItem] = Field(default_factory=list)
    # chart
    kind: Literal["line", "area", "bar", "donut"] = "bar"
    series: list[Series] = Field(default_factory=list)
    group: Group | None = None
    format: Literal["number", "currency", "percent"] = "number"
    # table / list / barlist / progress
    entity: str = ""
    columns: list[str] = Field(default_factory=list)
    search: bool = True
    badge: str = ""
    sort_field: str = ""
    sort_dir: Literal["asc", "desc"] = "desc"
    limit: int = 0
    primary: str = ""
    secondary: str = ""
    metric: Metric | None = None
    # panel
    text: str = ""
    # split / grid
    ratio: Literal["1.4/1", "1/1.4", "1.6/1", "1/2"] = "1.4/1"
    children: list["Block"] = Field(default_factory=list)
    # form
    fields: list[str] = Field(default_factory=list)
    submit_label: str = ""
    # custom
    name: str = ""
    description: str = ""


class PageSpec(BaseModel):
    path: str
    title: str
    component: str
    icon: str = DEFAULT_ICON
    mark: str = DEFAULT_MARK
    description: str = ""
    blocks: list[Block] = Field(default_factory=list)

    @property
    def module(self) -> str:
        return f"pages/{self.component}"


class AppSpec(BaseModel):
    spec_version: int = SPEC_VERSION
    name: str
    description: str = ""
    entities: dict[str, EntitySpec]
    pages: list[PageSpec]

    def custom_blocks(self) -> list[tuple[PageSpec, Block]]:
        out: list[tuple[PageSpec, Block]] = []

        def walk(page: PageSpec, blocks: list[Block]) -> None:
            for b in blocks:
                if b.type == "custom":
                    out.append((page, b))
                walk(page, b.children)

        for page in self.pages:
            walk(page, page.blocks)
        return out

    def to_plan_dict(self) -> dict[str, Any]:
        """The PLAN event / run shape the client already understands."""
        files: list[dict[str, Any]] = []
        for page, block in self.custom_blocks():
            files.append({"path": f"src/components/{block.name}.tsx", "component_name": block.name})
        for page in self.pages:
            files.append({"path": f"src/pages/{page.component}.tsx", "component_name": page.component, "mark": page.mark})
        return {
            "app_name": self.name,
            "description": self.description,
            "files": files,
            "routes": [
                {"path": p.path, "component": p.component, "importPath": f"./{p.module}", "label": p.title, "icon": p.icon}
                for p in self.pages
            ],
        }


# ── Normalisation ───────────────────────────────────────────────────────────

def _component_name(title: str, taken: set[str]) -> str:
    words = re.split(r"[^A-Za-z0-9]+", title)
    name = "".join(w[:1].upper() + w[1:] for w in words if w) or "Page"
    if name[0].isdigit():
        name = "Page" + name
    base, n = name, 2
    while name in taken:
        name = f"{base}{n}"
        n += 1
    return name


def _route_path(title: str, taken: set[str]) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "page"
    path, n = f"/{slug}", 2
    while path in taken:
        path = f"/{slug}-{n}"
        n += 1
    return path


def _parse_field(name: str, raw: Any, entity_names: set[str]) -> FieldSpec | None:
    """'money', 'enum:a|b', 'ref:Doctor', or {kind, values, ref, label}."""
    kind, values, ref, label = "", [], "", ""
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith("enum:"):
            kind, values = "enum", [v.strip() for v in text[5:].split("|") if v.strip()]
        elif text.startswith("ref:"):
            kind, ref = "ref", text[4:].strip()
        else:
            kind = text.lower()
    elif isinstance(raw, dict):
        kind = str(raw.get("kind") or raw.get("type") or "").strip().lower()
        values = [str(v).strip() for v in (raw.get("values") or []) if str(v).strip()]
        ref = str(raw.get("ref") or "").strip()
        label = str(raw.get("label") or "").strip()
    aliases = {"int": "number", "integer": "number", "float": "number", "decimal": "number", "currency": "money",
               "price": "money", "amount": "money", "bool": "boolean", "str": "string", "timestamp": "datetime",
               "longtext": "text", "textarea": "text", "uuid": "id", "ratio": "percent", "rate": "percent"}
    kind = aliases.get(kind, kind)
    if name == "id":
        kind = "id"
    if kind == "enum" and not values:
        return None
    if kind == "ref" and ref not in entity_names:
        return None
    if kind not in _SCALAR_KINDS and kind not in ("enum", "ref"):
        return None
    return FieldSpec(kind=kind, values=values, ref=ref, label=label or re.sub(r"[_-]+", " ", name).strip().capitalize())


def _parse_entities(raw: Any) -> dict[str, EntitySpec]:
    if not isinstance(raw, dict) or not raw:
        raise SpecError("The spec needs 'entities': an object of {EntityName: {fields: {...}}} with at least one entity.")
    names = {str(k).strip() for k in raw if _ENTITY.match(str(k).strip())}
    out: dict[str, EntitySpec] = {}
    for key, value in raw.items():
        name = str(key).strip()
        if not _ENTITY.match(name):
            continue
        fields_raw = value.get("fields") if isinstance(value, dict) else value
        if not isinstance(fields_raw, dict):
            continue
        fields: dict[str, FieldSpec] = {"id": FieldSpec(kind="id", label="ID")}
        for fname, fraw in fields_raw.items():
            fname = str(fname).strip()
            if not _IDENT.match(fname) or fname in fields:
                continue
            spec = _parse_field(fname, fraw, names)
            if spec is not None:
                fields[fname] = spec
        if len(fields) < 2:
            continue
        label = str(value.get("label") or "").strip() if isinstance(value, dict) else ""
        out[name] = EntitySpec(label=label or re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name), fields=fields)
    if not out:
        raise SpecError("No entity has usable fields. Fields are 'string', 'text', 'number', 'money', 'percent', 'boolean', 'date', 'datetime', 'email', 'url', 'enum:a|b|c' or 'ref:OtherEntity'.")
    return out


def _parse_metric(raw: Any, entities: dict[str, EntitySpec], problems: list[str]) -> Metric | None:
    if isinstance(raw, str):
        # "count(Appointment)" / "sum(Appointment.fee)"
        m = re.fullmatch(r"\s*(count|sum|avg|min|max)\s*\(\s*([A-Za-z0-9_]+)(?:\.([A-Za-z0-9_]+))?\s*\)\s*", raw)
        if not m:
            problems.append(f"metric '{raw}' is not fn(Entity.field)")
            return None
        raw = {"fn": m.group(1), "entity": m.group(2), "field": m.group(3) or ""}
    if not isinstance(raw, dict):
        return None
    fn = str(raw.get("fn") or "count").lower()
    entity = str(raw.get("entity") or "").strip()
    field = str(raw.get("field") or "").strip()
    if fn not in METRIC_FNS or entity not in entities:
        problems.append(f"metric on unknown entity '{entity}'")
        return None
    ent = entities[entity]
    if fn != "count":
        if field not in ent.fields or ent.fields[field].kind not in _NUMERIC_KINDS:
            numeric = [n for n, f in ent.fields.items() if f.kind in _NUMERIC_KINDS]
            if not numeric:
                fn, field = "count", ""
            else:
                field = numeric[0]
    else:
        field = ""
    where = None
    w = raw.get("where")
    if isinstance(w, dict) and str(w.get("field") or "") in ent.fields:
        op = str(w.get("op") or "eq")
        where = Where(field=str(w["field"]), op=op if op in OPS else "eq", value=w.get("value"))
    return Metric(fn=fn, entity=entity, field=field, where=where)


def _parse_block(raw: Any, entities: dict[str, EntitySpec], problems: list[str], depth: int = 0) -> Block | None:
    if not isinstance(raw, dict) or depth > 2:
        return None
    btype = str(raw.get("type") or "").lower()
    if btype not in BLOCK_TYPES:
        problems.append(f"unknown block type '{btype}'")
        return None
    title = str(raw.get("title") or "").strip()[:80]
    fmt = str(raw.get("format") or "number")
    fmt = fmt if fmt in FORMATS else "number"

    if btype == "kpis":
        items: list[KpiItem] = []
        for item in raw.get("items") or []:
            if not isinstance(item, dict):
                continue
            metric = _parse_metric(item.get("metric"), entities, problems)
            if metric is None:
                continue
            f = str(item.get("format") or ("currency" if metric.field and entities[metric.entity].fields[metric.field].kind == "money" else "number"))
            tone = str(item.get("tone") or "neutral")
            items.append(KpiItem(label=str(item.get("label") or metric.fn.title())[:40], metric=metric,
                                 format=f if f in FORMATS else "number",
                                 tone=tone if tone in ("neutral", "success", "info", "warning", "error") else "neutral"))
        if not items:
            return None
        return Block(type="kpis", title=title, items=items[:6])

    if btype == "chart":
        kind = str(raw.get("kind") or "bar").lower()
        kind = kind if kind in CHART_KINDS else "bar"
        series: list[Series] = []
        for s in raw.get("series") or []:
            if not isinstance(s, dict):
                continue
            metric = _parse_metric(s.get("metric"), entities, problems)
            if metric:
                series.append(Series(label=str(s.get("label") or metric.fn.title())[:40], metric=metric))
        if not series:
            metric = _parse_metric(raw.get("metric"), entities, problems) if raw.get("metric") else None
            if metric:
                series.append(Series(label=title or "Value", metric=metric))
        if not series:
            return None
        entity = entities[series[0].metric.entity]
        group_raw = raw.get("group")
        group: Group | None = None
        if isinstance(group_raw, dict) and str(group_raw.get("field") or "") in entity.fields:
            by = str(group_raw.get("by") or "value")
            by = by if by in GROUP_BY else "value"
            field = str(group_raw["field"])
            if entity.fields[field].kind not in _TIME_KINDS and by != "value":
                by = "value"
            group = Group(field=field, by=by)
        elif isinstance(group_raw, str) and group_raw in entity.fields:
            group = Group(field=group_raw, by="day" if entity.fields[group_raw].kind in _TIME_KINDS else "value")
        if group is None:
            # A time field for line/area, else the first enum/ref/string field.
            for name, f in entity.fields.items():
                if f.kind in _TIME_KINDS and kind in ("line", "area"):
                    group = Group(field=name, by="day")
                    break
            if group is None:
                for name, f in entity.fields.items():
                    if f.kind in ("enum", "ref", "string") and name != entity.label_field or (f.kind == "enum"):
                        group = Group(field=name, by="value")
                        break
            if group is None:
                for name, f in entity.fields.items():
                    if f.kind in _TIME_KINDS:
                        group = Group(field=name, by="day")
                        break
            if group is None:
                return None
        return Block(type="chart", title=title or series[0].label, kind=kind, series=series[:4], group=group, format=fmt)

    if btype in ("table", "list", "barlist", "progress"):
        entity_name = str(raw.get("entity") or "").strip()
        if entity_name not in entities:
            problems.append(f"{btype} block on unknown entity '{entity_name}'")
            return None
        entity = entities[entity_name]
        limit = raw.get("limit")
        limit = int(limit) if isinstance(limit, (int, float)) and limit > 0 else 0
        if btype == "table":
            columns = [c for c in (raw.get("columns") or []) if isinstance(c, str) and c in entity.fields and c != "id"]
            if not columns:
                columns = [n for n in entity.fields if n != "id"][:6]
            badge = str(raw.get("badge") or "")
            if badge not in entity.fields or entity.fields[badge].kind != "enum":
                badge = next((n for n in columns if entity.fields[n].kind == "enum"), "")
            sort = raw.get("sort") if isinstance(raw.get("sort"), dict) else {}
            sort_field = str(sort.get("field") or "") if sort else ""
            if sort_field not in entity.fields:
                sort_field = next((n for n in entity.fields if entity.fields[n].kind in _TIME_KINDS), "")
            sort_dir = str(sort.get("dir") or "desc") if sort else "desc"
            return Block(type="table", title=title or entity.label, entity=entity_name, columns=columns[:8],
                         search=bool(raw.get("search", True)), badge=badge, sort_field=sort_field,
                         sort_dir=sort_dir if sort_dir in ("asc", "desc") else "desc", limit=limit)
        if btype == "list":
            primary = str(raw.get("primary") or entity.label_field)
            if primary not in entity.fields:
                primary = entity.label_field
            secondary = str(raw.get("secondary") or "")
            if secondary not in entity.fields or secondary == primary:
                secondary = next((n for n in entity.fields if n not in ("id", primary) and entity.fields[n].kind in ("string", "date", "datetime", "money", "number")), "")
            badge = str(raw.get("badge") or "")
            if badge not in entity.fields or entity.fields[badge].kind != "enum":
                badge = next((n for n, f in entity.fields.items() if f.kind == "enum"), "")
            return Block(type="list", title=title or entity.label, entity=entity_name, primary=primary, secondary=secondary, badge=badge, limit=limit or 8)
        # barlist / progress: group + metric
        group_raw = raw.get("group")
        gfield = group_raw.get("field") if isinstance(group_raw, dict) else group_raw
        gfield = str(gfield or "")
        if gfield not in entity.fields or entity.fields[gfield].kind not in ("enum", "ref", "string", "boolean"):
            gfield = next((n for n, f in entity.fields.items() if f.kind in ("enum", "ref")), "")
            if not gfield:
                gfield = next((n for n, f in entity.fields.items() if f.kind == "string" and n != entity.label_field), entity.label_field)
        metric = _parse_metric(raw.get("metric"), entities, problems) if raw.get("metric") else None
        if metric is None or metric.entity != entity_name:
            metric = Metric(fn="count", entity=entity_name)
        return Block(type=btype, title=title or f"{entity.label} by {entity.fields[gfield].label.lower()}", entity=entity_name,
                     group=Group(field=gfield, by="value"), metric=metric, limit=limit or (5 if btype == "barlist" else 6), format=fmt)

    if btype == "panel":
        text = str(raw.get("text") or "").strip()[:600]
        if not text:
            return None
        return Block(type="panel", title=title or "Notes", text=text)

    if btype in ("split", "grid"):
        children = [b for b in (_parse_block(c, entities, problems, depth + 1) for c in (raw.get("children") or [])) if b is not None]
        children = [c for c in children if c.type not in ("split", "grid")]  # one level of nesting
        if len(children) < 2:  # a split or grid with one child is just that child
            return children[0] if children else None
        ratio = str(raw.get("ratio") or "1.4/1")
        return Block(type=btype, title=title, ratio=ratio if ratio in ("1.4/1", "1/1.4", "1.6/1", "1/2") else "1.4/1",
                     children=children[:2] if btype == "split" else children[:6])

    if btype == "form":
        entity_name = str(raw.get("entity") or "").strip()
        if entity_name not in entities:
            problems.append(f"form block on unknown entity '{entity_name}'")
            return None
        entity = entities[entity_name]
        wanted = [f for f in (raw.get("fields") or []) if isinstance(f, str) and f in entity.fields and f != "id"]
        if not wanted:
            wanted = [n for n in entity.fields if n != "id"]
        return Block(type="form", title=title or f"New {entity.label.lower()}", entity=entity_name, fields=wanted[:12],
                     submit_label=str(raw.get("submit_label") or "").strip()[:30] or f"Add {entity.label.lower()}")

    if btype == "custom":
        name = str(raw.get("name") or "").strip()
        if not _ENTITY.match(name):
            name = _component_name(title or "Custom", set())
        desc = str(raw.get("description") or "").strip()[:600]
        if not desc:
            problems.append(f"custom block '{name}' has no description")
            return None
        return Block(type="custom", title=title, name=name, description=desc)
    return None


def normalize_spec(raw: Any, known_marks: set[str] | None = None) -> AppSpec:
    if not isinstance(raw, dict):
        raise SpecError("The spec must be a JSON object with 'name', 'entities' and 'pages'.")
    problems: list[str] = []
    name = str(raw.get("name") or raw.get("app_name") or "").strip()[:80]
    if not name:
        raise SpecError("The spec needs 'name': what the app is for, in 1-3 plain words.")
    entities = _parse_entities(raw.get("entities"))

    pages_raw = raw.get("pages")
    if not isinstance(pages_raw, list) or not pages_raw:
        raise SpecError("The spec needs 'pages': a list of 3-5 pages, each with 'title' and 'blocks'.")
    pages: list[PageSpec] = []
    taken_paths: set[str] = set()
    taken_components: set[str] = set()
    custom_names: set[str] = set()
    for item in pages_raw:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("label") or "").strip()[:40]
        if not title:
            continue
        blocks = [b for b in (_parse_block(b, entities, problems) for b in (item.get("blocks") or [])) if b is not None]
        for b in blocks:
            for c in ([b] + b.children):
                if c.type == "custom":
                    base, n = c.name, 2
                    while c.name in custom_names:
                        c.name = f"{base}{n}"
                        n += 1
                    custom_names.add(c.name)
        if not blocks:
            problems.append(f"page '{title}' has no usable blocks")
            continue
        component = str(item.get("component") or "").strip()
        if not _ENTITY.match(component) or component in taken_components:
            component = _component_name(title, taken_components)
        taken_components.add(component)
        path = str(item.get("path") or "").strip()
        if not path.startswith("/") or path in taken_paths or any(ch.isspace() for ch in path):
            path = _route_path(title, taken_paths)
        taken_paths.add(path)
        icon = str(item.get("icon") or "").strip()
        mark = str(item.get("mark") or "").strip()
        if not _MARK.match(mark) or (known_marks is not None and mark not in known_marks):
            mark = DEFAULT_MARK
        pages.append(PageSpec(path=path, title=title, component=component, icon=icon if _ICON.match(icon) else DEFAULT_ICON,
                              mark=mark, description=str(item.get("description") or "").strip()[:400], blocks=blocks[:8]))
    if not pages:
        raise SpecError("No page has usable blocks. " + "; ".join(problems[:4]))
    if len(pages) > MAX_PAGES:
        raise SpecError(f"The spec has {len(pages)} pages; plan at most {MAX_PAGES}.")
    if "/" not in taken_paths:
        pages[0] = pages[0].model_copy(update={"path": "/"})
    try:
        return AppSpec(name=name, description=str(raw.get("description") or "").strip()[:400], entities=entities, pages=pages)
    except ValidationError as exc:  # pragma: no cover
        raise SpecError(str(exc)) from exc
