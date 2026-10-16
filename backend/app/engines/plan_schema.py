"""The build plan contract between the planner model and the generation run.

The planner replies with free JSON. Before anything is generated the reply is
normalised into an `AppPlan`: paths are cleaned, routes are matched to page
files, missing pieces are derived deterministically, and anything that cannot
be repaired is a `PlanError` with a message the caller can hand back to the
model for one repair attempt. Nothing downstream has to guess again.
"""
from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator

MAX_PAGES = 8
MIN_PAGES = 1
DEFAULT_MARK = "mark-command"
DEFAULT_ICON = "LayoutDashboard"
_IDENT = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")
_ICON = re.compile(r"^[A-Z][A-Za-z0-9]{1,40}$")
_MARK = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
_ALLOWED_DIRS = ("src/pages/", "src/components/", "src/data/", "src/lib/", "src/hooks/")
_ALLOWED_SUFFIXES = (".tsx", ".ts")


class PlanError(ValueError):
    """The plan cannot be used; the message says what the model must fix."""


class PlanFile(BaseModel):
    path: str
    component_name: str = ""
    description: str = ""
    mark: str = DEFAULT_MARK
    priority: int = 1

    @field_validator("path")
    @classmethod
    def _path(cls, value: str) -> str:
        return normalize_path(value)

    @property
    def is_page(self) -> bool:
        return self.path.startswith("src/pages/")

    @property
    def module(self) -> str:
        """'src/pages/Home.tsx' -> 'pages/Home' (the importPath form without './')."""
        stem = self.path[len("src/"):]
        return stem.rsplit(".", 1)[0]


class PlanRoute(BaseModel):
    path: str
    component: str
    importPath: str
    label: str = ""
    icon: str = DEFAULT_ICON


class AppPlan(BaseModel):
    app_name: str = ""
    description: str = ""
    color_theme: str = ""
    files: list[PlanFile] = Field(default_factory=list)
    routes: list[PlanRoute] = Field(default_factory=list)

    @property
    def pages(self) -> list[PlanFile]:
        return [f for f in self.files if f.is_page]

    def to_run_dict(self) -> dict[str, Any]:
        """The shape the generation run and the client already consume."""
        return {
            "app_name": self.app_name,
            "description": self.description,
            "color_theme": self.color_theme,
            "files": [f.model_dump() for f in self.files],
            "routes": [r.model_dump() for r in self.routes],
        }


def normalize_path(path: Any) -> str:
    text = str(path or "").strip().replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    text = text.lstrip("/")
    text = re.sub(r"/{2,}", "/", text)
    return text


def _safe_path(path: str) -> bool:
    if not path or ".." in path.split("/") or path != path.strip():
        return False
    if not path.startswith(_ALLOWED_DIRS) or not path.endswith(_ALLOWED_SUFFIXES):
        return False
    name = path.rsplit("/", 1)[-1]
    return bool(re.fullmatch(r"[A-Za-z0-9_.-]+", name))


def _component_from_path(path: str) -> str:
    stem = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    words = re.split(r"[^A-Za-z0-9]+", stem)
    name = "".join(w[:1].upper() + w[1:] for w in words if w)
    if not name or not _IDENT.match(name) or name[0].isdigit():
        name = "Page" + re.sub(r"[^A-Za-z0-9]", "", name)
    return name


def _label_from_component(component: str) -> str:
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", component)


def _route_path_from_component(component: str, taken: set[str]) -> str:
    slug = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "-", component).lower()
    slug = re.sub(r"[^a-z0-9-]", "", slug) or "page"
    path = f"/{slug}"
    n = 2
    while path in taken:
        path = f"/{slug}-{n}"
        n += 1
    return path


def normalize_plan(raw: Any, known_marks: set[str] | None = None, mark_default: str = DEFAULT_MARK) -> AppPlan:
    """Turn the model's JSON into an `AppPlan`, deriving what is derivable.

    Deterministic repairs (no model call): path cleanup, dropping unsafe or
    duplicate paths, component names from file names, routes without a page
    file dropped, pages without a route given one, exactly one "/" route,
    unknown marks and icons replaced. Raises `PlanError` when the plan has no
    usable page or more than `MAX_PAGES` pages.
    """
    if not isinstance(raw, dict):
        raise PlanError("The plan must be a JSON object with 'files' and 'routes'.")

    files: list[PlanFile] = []
    seen_paths: set[str] = set()
    seen_components: set[str] = set()
    for item in raw.get("files") or []:
        if not isinstance(item, dict):
            continue
        path = normalize_path(item.get("path"))
        if not _safe_path(path) or path in seen_paths:
            continue
        component = str(item.get("component_name") or "").strip()
        if path.endswith(".ts"):
            component = ""  # data modules have no component
        elif not _IDENT.match(component):
            component = _component_from_path(path)
        if component:
            if component in seen_components:
                continue
            seen_components.add(component)
        mark = str(item.get("mark") or "").strip()
        if not _MARK.match(mark) or (known_marks is not None and mark not in known_marks):
            mark = mark_default
        try:
            priority = int(item.get("priority", 1))
        except (TypeError, ValueError):
            priority = 1
        if not path.startswith("src/pages/"):
            priority = min(priority, 0)  # shared code is written before pages
        files.append(
            PlanFile(
                path=path,
                component_name=component,
                description=str(item.get("description") or "").strip(),
                mark=mark,
                priority=priority,
            )
        )
        seen_paths.add(path)

    pages = [f for f in files if f.is_page]
    if len(pages) < MIN_PAGES:
        raise PlanError(
            "The plan has no page file. Plan 3-5 pages under src/pages/<Name>.tsx with a route each."
        )
    if len(pages) > MAX_PAGES:
        raise PlanError(f"The plan has {len(pages)} pages; plan at most {MAX_PAGES}.")

    by_module = {f.module: f for f in pages}
    by_component = {f.component_name: f for f in pages}

    routes: list[PlanRoute] = []
    taken_paths: set[str] = set()
    routed_modules: set[str] = set()
    for item in raw.get("routes") or []:
        if not isinstance(item, dict):
            continue
        import_path = normalize_path(item.get("importPath"))
        module = import_path[len("src/"):] if import_path.startswith("src/") else import_path
        module = re.sub(r"\.(tsx|ts|jsx|js)$", "", module)
        page = by_module.get(module)
        component = str(item.get("component") or "").strip()
        if page is None and component:
            page = by_component.get(component)
        if page is None:
            continue  # a route to a page that is not planned
        if page.module in routed_modules:
            continue
        route_path = str(item.get("path") or "").strip()
        if not route_path.startswith("/") or route_path in taken_paths or any(c.isspace() for c in route_path):
            route_path = _route_path_from_component(page.component_name, taken_paths)
        icon = str(item.get("icon") or "").strip()
        if not _ICON.match(icon):
            icon = DEFAULT_ICON
        label = str(item.get("label") or "").strip()[:40] or _label_from_component(page.component_name)
        routes.append(
            PlanRoute(path=route_path, component=page.component_name, importPath=f"./{page.module}", label=label, icon=icon)
        )
        taken_paths.add(route_path)
        routed_modules.add(page.module)

    for page in pages:
        if page.module in routed_modules:
            continue
        route_path = _route_path_from_component(page.component_name, taken_paths)
        routes.append(
            PlanRoute(
                path=route_path,
                component=page.component_name,
                importPath=f"./{page.module}",
                label=_label_from_component(page.component_name),
                icon=DEFAULT_ICON,
            )
        )
        taken_paths.add(route_path)
        routed_modules.add(page.module)

    if "/" not in taken_paths and routes:
        # The first planned page is the home page; the planner lists pages top to bottom.
        order = {f.module: i for i, f in enumerate(pages)}
        routes.sort(key=lambda r: order.get(r.importPath[2:], 10**6))
        routes[0] = routes[0].model_copy(update={"path": "/"})

    files.sort(key=lambda f: f.priority)
    try:
        return AppPlan(
            app_name=str(raw.get("app_name") or "").strip()[:80],
            description=str(raw.get("description") or "").strip()[:400],
            color_theme=str(raw.get("color_theme") or "").strip()[:120],
            files=files,
            routes=routes,
        )
    except ValidationError as exc:  # pragma: no cover - the fields above are already strings
        raise PlanError(str(exc)) from exc
