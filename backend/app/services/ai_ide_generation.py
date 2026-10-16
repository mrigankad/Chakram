"""App Builder generation runs.

A run plans an app and writes its files to the workspace in a background task.
It does not depend on the WebSocket that started it: when the page reloads or
the connection drops, the run keeps going and the client re-attaches to it.
A subscriber gets a snapshot of everything so far (plan, finished files, the
file streaming now, failures) and then the live events.

Runs live in this process, which is fine for the single-instance deployment;
`get()` on another worker simply finds no run.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.engines import kit
from app.engines.generator import stream_file, strip_code_fences
from app.engines.injector import inject_routes, nav_items
from app.engines.plan_schema import PlanError, normalize_plan
from app.engines.planner import plan_files
from app.engines.verify import verify_file
from app.services import ai_ide_service

logger = logging.getLogger(__name__)

PLANNER_TIMEOUT = 90.0
FILE_TIMEOUT = 90.0
_FINISHED_RUN_TTL = 30 * 60
# Pages only depend on the shared files written before them, so several stream at once.
PAGE_CONCURRENCY = 3
# A file that fails the structural check is asked for once more, with the reasons.
FILE_ATTEMPTS = 2
# Problems that make a file unusable (it would not even parse) reject it; the
# rest are reported as warnings and the file is kept, since the preview and the
# client's repair step can still deal with them.
_HARD_PROBLEMS = (
    "empty", "truncated", "unexpected '", "unterminated", "markdown fence", "prose instead of code",
    "no `export default function`", "JSX in a .ts", "forbidden package", "'use client'",
)
# Files every kit app has besides the plan (so imports of them are not flagged).
_TEMPLATE_FILES = {"src/App.tsx", "src/main.tsx", "src/index.css", "src/design.css", "src/lib/utils.ts", "design.json"}

_runs: dict[str, "GenerationRun"] = {}

# A closing tag or a self-closing component tag: JSX, which a .ts file cannot contain.
# (TypeScript generics like Array<string> never close with "</" or "/>".)
_JSX_MARKERS = re.compile(r"</[A-Za-z][\w.]*\s*>|<[A-Z][\w.]*(?:\s[^<>]*)?/>")


def has_jsx(code: str) -> bool:
    return bool(_JSX_MARKERS.search(code))


def route_module(path: str) -> str:
    """'src/pages/Home.tsx' and './pages/Home' both become 'pages/Home'."""
    module = path.replace("\\", "/").strip()
    for prefix in ("./", "src/"):
        if module.startswith(prefix):
            module = module[len(prefix):]
    for suffix in (".tsx", ".ts", ".jsx", ".js"):
        if module.endswith(suffix):
            module = module[: -len(suffix)]
    return module


def normalize_plan_path(path: str) -> str:
    """'./src/pages/Home.tsx' and a backslash path both become 'src/pages/Home.tsx'."""
    path = path.strip().replace("\\", "/")
    while path.startswith("./"):
        path = path[2:]
    return path.lstrip("/")


@dataclass
class _FileState:
    status: str  # "streaming" | "done" | "error"
    content: str = ""
    message: str = ""


@dataclass
class GenerationRun:
    workspace_id: str
    org_id: str
    idea: str
    started_at: float = field(default_factory=time.monotonic)
    finished_at: float | None = None
    plan_event: dict | None = None
    files: dict[str, _FileState] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)
    app_tsx: str | None = None
    last_status: str | None = None
    final_event: dict | None = None
    subscribers: list[asyncio.Queue] = field(default_factory=list)
    task: asyncio.Task | None = None
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    usage: dict[str, int] = field(default_factory=lambda: {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0})
    warnings: list[dict] = field(default_factory=list)

    @property
    def finished(self) -> bool:
        return self.final_event is not None

    def add_usage(self, prompt_tokens: int, completion_tokens: int) -> None:
        self.usage["calls"] += 1
        self.usage["prompt_tokens"] += int(prompt_tokens or 0)
        self.usage["completion_tokens"] += int(completion_tokens or 0)

    @property
    def log_extra(self) -> dict:
        return {"workspace_id": self.workspace_id, "run_id": self.run_id}

    # ── Events ────────────────────────────────────────────────────────────
    def emit(self, event: dict) -> None:
        self._record(event)
        for queue in list(self.subscribers):
            queue.put_nowait(event)

    def _record(self, event: dict) -> None:
        kind = event.get("type")
        path = event.get("path")
        if kind == "PLAN":
            self.plan_event = event
        elif kind == "STATUS":
            self.last_status = event.get("message")
        elif kind == "FILE_CREATE":
            self.files[path] = _FileState(status="streaming")
            if path not in self.order:
                self.order.append(path)
        elif kind == "STREAM_TOKEN":
            state = self.files.get(path)
            if state is not None:
                state.content += event.get("token", "")
        elif kind == "FILE_UPDATE":
            if path == "src/App.tsx":
                self.app_tsx = event.get("content", "")
            elif path in self.files:
                self.files[path].content = event.get("content", "")
        elif kind == "FILE_RENAMED":
            old, new = event.get("from"), event.get("to")
            state = self.files.pop(old, None) or _FileState(status="streaming")
            state.content = event.get("content", state.content)
            self.files[new] = state
            self.order = [new if p == old else p for p in self.order]
            if new not in self.order:
                self.order.append(new)
        elif kind == "FILE_DONE":
            state = self.files.setdefault(path, _FileState(status="done"))
            state.status = "done"
        elif kind == "FILE_ERROR":
            state = self.files.setdefault(path, _FileState(status="error"))
            state.status = "error"
            state.message = event.get("message", "")
        elif kind in ("GENERATION_DONE", "ERROR"):
            self.final_event = event
            self.finished_at = time.monotonic()

    def snapshot(self) -> list[dict]:
        """Events that bring a new subscriber up to date with the run so far."""
        events: list[dict] = []
        if self.plan_event is not None:
            events.append(self.plan_event)
        for path in self.order:
            state = self.files[path]
            events.append({"type": "FILE_CREATE", "path": path})
            if state.status == "done":
                events.append({"type": "FILE_UPDATE", "path": path, "content": state.content})
                events.append({"type": "FILE_DONE", "path": path})
            elif state.status == "error":
                events.append({"type": "FILE_ERROR", "path": path, "message": state.message})
            elif state.content:
                events.append({"type": "STREAM_TOKEN", "path": path, "token": state.content})
        if self.app_tsx is not None:
            events.append({"type": "FILE_UPDATE", "path": "src/App.tsx", "content": self.app_tsx})
        if self.last_status and self.final_event is None:
            events.append({"type": "STATUS", "message": self.last_status})
        if self.final_event is not None:
            events.append(self.final_event)
        return events

    def subscribe(self) -> asyncio.Queue:
        """A queue holding the snapshot, then every later event. Atomic: nothing is missed."""
        queue: asyncio.Queue = asyncio.Queue()
        for event in self.snapshot():
            queue.put_nowait(event)
        if not self.finished:
            self.subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        if queue in self.subscribers:
            self.subscribers.remove(queue)


def get(workspace_id: str) -> GenerationRun | None:
    return _runs.get(workspace_id)


def start(workspace_id: str, org_id: str, idea: str) -> GenerationRun:
    """Start a run for the workspace. An unfinished run is returned instead of started twice."""
    _evict_old()
    existing = _runs.get(workspace_id)
    if existing is not None and not existing.finished:
        return existing
    run = GenerationRun(workspace_id=workspace_id, org_id=org_id, idea=idea)
    _runs[workspace_id] = run
    # The task inherits the caller's context (the org's model and connectors).
    run.task = asyncio.get_running_loop().create_task(_execute(run))
    return run


def _evict_old() -> None:
    now = time.monotonic()
    for workspace_id, run in list(_runs.items()):
        if run.finished and run.finished_at is not None and now - run.finished_at > _FINISHED_RUN_TTL:
            del _runs[workspace_id]


async def _note(workspace_id: str, **fields: Any) -> None:
    """Record app info for the apps list; never allowed to break a build."""
    update = getattr(ai_ide_service, "update_app_info", None)
    if update is None:
        return
    try:
        await update(workspace_id, **fields)
    except Exception:  # noqa: BLE001
        logger.exception("[AI IDE] could not record app info for %s", workspace_id)


async def _execute(run: GenerationRun) -> None:
    try:
        await _note(run.workspace_id, idea=run.idea[:2000], status="generating")
        await _generate(run)
    except asyncio.CancelledError:
        run.emit({"type": "ERROR", "message": "Generation was cancelled"})
        raise
    except Exception as exc:  # noqa: BLE001 - the client gets the reason, whatever it is
        logger.exception("[AI IDE] generation failed for workspace %s", run.workspace_id)
        run.emit({"type": "ERROR", "message": str(exc)})
    finally:
        final = run.final_event or {}
        ok = final.get("type") == "GENERATION_DONE" and not final.get("files_failed")
        await _note(run.workspace_id, status="done" if ok else "error")


def _is_hard(problem: str) -> bool:
    return any(marker in problem for marker in _HARD_PROBLEMS)


def _personalize(workspace_id: str, app_name: str) -> list[tuple[str, str]]:
    """Name the package and the document after the app; returns the (path, content) written."""
    written: list[tuple[str, str]] = []
    slug = re.sub(r"[^a-z0-9]+", "-", app_name.lower()).strip("-")[:60]
    if not slug:
        return written
    try:
        package = json.loads(ai_ide_service.read_file(workspace_id, "package.json"))
        if isinstance(package, dict) and package.get("name") != slug:
            package["name"] = slug
            text = json.dumps(package, indent=2) + "\n"
            ai_ide_service.save_file(workspace_id, "package.json", text)
            written.append(("package.json", text))
    except Exception:  # noqa: BLE001 - naming is cosmetic; the build goes on
        logger.debug("[AI IDE] could not rename package.json for %s", workspace_id, exc_info=True)
    try:
        html = ai_ide_service.read_file(workspace_id, "index.html")
        updated = re.sub(r"<title>.*?</title>", f"<title>{_escape_html(app_name)}</title>", html, count=1, flags=re.DOTALL)
        if updated != html:
            ai_ide_service.save_file(workspace_id, "index.html", updated)
            written.append(("index.html", updated))
    except Exception:  # noqa: BLE001
        logger.debug("[AI IDE] could not retitle index.html for %s", workspace_id, exc_info=True)
    return written


def _escape_html(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


async def _generate(run: GenerationRun) -> None:
    workspace_id = run.workspace_id
    emit = run.emit

    emit({"type": "STATUS", "message": "Planning your app…"})
    design_notes = None
    try:
        design_notes = ai_ide_service.read_file(workspace_id, "src/design/README.md")
    except Exception:  # noqa: BLE001 - an app without a pack has no notes
        design_notes = None
    try:
        raw_plan = await asyncio.wait_for(
            plan_files(run.idea, design_notes=design_notes, log_extra=run.log_extra, usage_sink=run.add_usage),
            timeout=PLANNER_TIMEOUT,
        )
    except asyncio.TimeoutError:
        emit({"type": "ERROR", "message": f"Planner timed out after {int(PLANNER_TIMEOUT)}s. Try a shorter idea."})
        return
    except Exception as exc:
        emit({"type": "ERROR", "message": f"Planner error: {exc}"})
        return

    # The planner already validated its own reply; a plan from anywhere else
    # (an older planner, a test) goes through the same normalisation here.
    try:
        plan = normalize_plan(raw_plan)
    except PlanError as exc:
        emit({"type": "ERROR", "message": f"Planner returned an unusable plan: {exc}"})
        return

    files_list: list[dict] = [f.model_dump() for f in plan.files]
    routes_list: list[dict] = [r.model_dump() for r in plan.routes]

    # Every file knows the app it belongs to, so each prompt carries the same name and look.
    app_name = plan.app_name
    color_theme = plan.color_theme
    component_names = [
        f["component_name"] for f in files_list
        if f["path"].startswith("src/components/") and f.get("component_name")
    ]
    for file_spec in files_list:
        if app_name:
            file_spec["app_name"] = app_name
        if color_theme:
            file_spec["color_theme"] = color_theme
        # So the Navbar links to real routes and pages import components that exist.
        file_spec["routes"] = routes_list
        file_spec["components"] = component_names
        file_spec["usage_sink"] = run.add_usage
        file_spec["log_extra"] = run.log_extra

    if app_name:
        await _note(workspace_id, name=app_name)
    emit({
        "type": "PLAN",
        "app_name": app_name,
        "description": plan.description,
        "files": [f["path"] for f in files_list],
        "routes": routes_list,
    })
    emit({"type": "STATUS", "message": f"Plan ready: generating {len(files_list)} file(s)…"})

    if app_name:
        for path, content in _personalize(workspace_id, app_name):
            emit({"type": "FILE_UPDATE", "path": path, "content": content})

    def _wire_routes(done_modules: set[str], final: bool = False) -> None:
        """Point App.tsx at the pages generated so far; a failure here is reported, not fatal.

        The sidebar lists every planned page while the run is going (unbuilt ones show the
        shell's placeholder); the final pass keeps only pages that were generated.
        """
        wired = [r for r in routes_list if route_module(r["importPath"]) in done_modules]
        nav = nav_items(wired if final else routes_list)
        try:
            app_tsx = ai_ide_service.read_file(workspace_id, "src/App.tsx")
            updated_app = inject_routes(app_tsx, wired, nav=nav, app_name=app_name or None)
            if updated_app == app_tsx:
                return
            ai_ide_service.save_file(workspace_id, "src/App.tsx", updated_app)
            emit({"type": "FILE_UPDATE", "path": "src/App.tsx", "content": updated_app})
        except Exception as exc:
            emit({"type": "STATUS", "message": f"Warning: route injection failed {exc}"})

    failed_files: list[dict] = []
    generated_modules: set[str] = set()
    routed_modules = {route_module(r["importPath"]) for r in routes_list}
    planned_paths = {f["path"] for f in files_list}
    known_files: set[str] = set(kit.kit_files()) | set(_TEMPLATE_FILES)
    kit_exports = set(kit.kit_exports()) if kit.has_kit() else None

    # The app's name and full navigation are known from the plan: show them right away.
    _wire_routes(generated_modules)

    # Shared code written so far, shown to later prompts so pages match it.
    written_context: dict[str, str] = {}

    async def _attempt(file_spec: dict, path: str) -> tuple[str, str, str | None]:
        """One model call: (cleaned content, raw streamed text, error)."""
        emit({"type": "FILE_CREATE", "path": path})

        async def _collect_file() -> str:
            parts: list[str] = []
            async for token in stream_file(file_spec, org_id=run.org_id):
                parts.append(token)
                emit({"type": "STREAM_TOKEN", "path": path, "token": token})
            return "".join(parts)

        try:
            content = await asyncio.wait_for(_collect_file(), timeout=FILE_TIMEOUT)
        except asyncio.TimeoutError:
            return "", "", f"Generation timed out after {int(FILE_TIMEOUT)}s"
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            return "", "", f"Generation failed: {exc}"
        # Models sometimes wrap the file in a markdown fence despite the prompt;
        # the file on disk is the code, so the client gets the cleaned text.
        cleaned = strip_code_fences(content)
        if not cleaned.strip():
            return "", content, "The model returned no code"
        return cleaned, content, None

    async def _generate_one(file_spec: dict) -> None:
        path = file_spec["path"]
        file_spec["context_files"] = dict(written_context)
        error: str | None = None
        cleaned = ""
        streamed = ""
        soft_problems: list[str] = []
        for attempt in range(1, FILE_ATTEMPTS + 1):
            cleaned, streamed, error = await _attempt(file_spec, path)
            if error is not None:
                break  # provider errors and timeouts used their budget; not retried here
            result = verify_file(
                path,
                cleaned,
                kit_exports=kit_exports,
                workspace_files=known_files | set(written_context),
                planned_files=planned_paths,
                component_name=file_spec.get("component_name") or None,
            )
            if result.ok:
                soft_problems = []
                break
            hard = [p for p in result.problems if _is_hard(p)]
            soft_problems = [p for p in result.problems if not _is_hard(p)]
            if attempt < FILE_ATTEMPTS:
                file_spec["previous_problems"] = result.problems
                emit({"type": "STATUS", "message": f"Rewriting {path}: {result.message}"})
                continue
            if hard:
                error = f"The generated file is not valid: {'; '.join(hard)}"
        file_spec.pop("previous_problems", None)

        if error is not None:
            # Nothing is written for a failed file: no placeholder is saved as generated code.
            failed_files.append({"path": path, "message": error})
            emit({"type": "FILE_ERROR", "path": path, "message": error})
            emit({"type": "STATUS", "message": f"Failed to generate {path}: {error}"})
            return
        if soft_problems:
            run.warnings.append({"path": path, "problems": soft_problems})
            emit({"type": "STATUS", "message": f"Warning for {path}: {'; '.join(soft_problems)}"})

        if path.endswith(".ts") and has_jsx(cleaned):
            # The model put JSX in a .ts file. As .tsx it compiles, and imports written
            # without an extension ('../data/store') still resolve.
            new_path = path[:-3] + ".tsx"
            ai_ide_service.save_file(workspace_id, new_path, cleaned)
            emit({"type": "FILE_RENAMED", "from": path, "to": new_path, "content": cleaned})
            path = new_path
        else:
            ai_ide_service.save_file(workspace_id, path, cleaned)
            if cleaned != streamed:
                emit({"type": "FILE_UPDATE", "path": path, "content": cleaned})
        emit({"type": "FILE_DONE", "path": path})
        known_files.add(path)
        if not path.startswith("src/pages/"):
            written_context[path] = cleaned

        # A finished page is routable right away, so the preview shows it as it lands.
        module = route_module(path)
        generated_modules.add(module)
        if module in routed_modules:
            _wire_routes(generated_modules)

    # Shared files first, one at a time (later ones may import earlier ones) ...
    shared = [f for f in files_list if not f["path"].startswith("src/pages/")]
    pages = [f for f in files_list if f["path"].startswith("src/pages/")]
    for file_spec in shared:
        await _generate_one(file_spec)

    # ... then pages in parallel: each sees all shared files and none depends on another page.
    gate = asyncio.Semaphore(max(1, PAGE_CONCURRENCY))

    async def _page(file_spec: dict) -> None:
        async with gate:
            await _generate_one(file_spec)

    await asyncio.gather(*(_page(f) for f in pages))

    # Final pass leaves out routes (and menu entries) for files that were not generated.
    _wire_routes(generated_modules, final=True)

    emit({
        "type": "GENERATION_DONE",
        "files_total": len(files_list),
        "files_generated": len(files_list) - len(failed_files),
        "files_failed": len(failed_files),
        "failed_files": failed_files,
        "warnings": list(run.warnings),
        "usage": dict(run.usage),
        "run_id": run.run_id,
    })


def reset_for_tests() -> None:
    _runs.clear()
