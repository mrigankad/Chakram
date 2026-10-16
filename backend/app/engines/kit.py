"""The Chronos UI kit shipped inside every generated app, and its reference for the LLM.

Generated pages compose these ready-made components instead of hand-writing
cards, tables, charts and navigation, so each file the model writes is short
and every app has the same client-facing look.

Kit sources live in app/templates/chronos_kit/src/** (copied into each new
workspace); KIT_API.md is the compact reference given to the model.
"""
from __future__ import annotations

import logging
import re
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

KIT_ROOT = Path(__file__).resolve().parent.parent / "templates" / "chronos_kit"


@lru_cache(maxsize=1)
def kit_files() -> dict[str, str]:
    """Workspace path -> text for every kit source file (empty when the kit is missing)."""
    src = KIT_ROOT / "src"
    if not src.is_dir():
        logger.warning("[Kit] %s not found; generated apps will not include the Chronos kit", src)
        return {}
    files: dict[str, str] = {}
    for path in sorted(src.rglob("*")):
        if path.is_file() and (path.suffix in {".ts", ".tsx", ".css", ".json"} or path.name == "VERSION"):
            files[path.relative_to(KIT_ROOT).as_posix()] = path.read_text(encoding="utf-8")
    return files


def has_kit() -> bool:
    return bool(kit_files())


def kit_version(files: dict[str, str]) -> int:
    """The kit version recorded in a file set (0 when unknown)."""
    try:
        return int((files.get("src/chronos/VERSION") or "0").strip() or 0)
    except ValueError:
        return 0


def outdated_kit_files(workspace_files: dict[str, str]) -> dict[str, str]:
    """Kit files to write into an app built with an older kit ({} when current or not a kit app).

    Only apps that already contain the kit are updated; the kit's own files are replaced
    wholesale, so edits made directly inside src/chronos are lost on a kit upgrade.
    """
    current = kit_files()
    if not current or "src/chronos/index.ts" not in workspace_files:
        return {}
    if kit_version(workspace_files) >= kit_version(current):
        return {}
    return {path: text for path, text in current.items() if workspace_files.get(path) != text}


@lru_cache(maxsize=1)
def kit_api() -> str:
    """The full kit reference (for people and for the drift test); prompts use the sheets."""
    path = KIT_ROOT / "KIT_API.md"
    return path.read_text(encoding="utf-8").strip() if path.is_file() else ""


SHEET_ROLES = ("page", "data", "component", "charts")


@lru_cache(maxsize=8)
def kit_sheet(role: str) -> str:
    """The compact reference for one kind of file ("" when the kit or sheet is missing).

    A page prompt gets `page` (+ `charts` when its blueprint names a chart), a
    data module gets `data` and a shared component gets `component`. Sending the
    full KIT_API.md to every file was ~60% of a build's prompt tokens.
    """
    if role not in SHEET_ROLES:
        return ""
    path = KIT_ROOT / "sheets" / f"{role}.md"
    return path.read_text(encoding="utf-8").strip() if path.is_file() else ""


def role_for(path: str) -> str:
    if path.startswith("src/pages/"):
        return "page"
    if path.endswith(".ts"):
        return "data"
    return "component"


_CHART_WORDS = re.compile(
    r"(?:line|area|bar|combo|donut|pie|funnel|bullet) ?chart|sparkline|gauge|progress ?(?:ring|bars?)|\bcharts?\b|\btrend\b",
    re.IGNORECASE,
)


def wants_charts(text: str) -> bool:
    return bool(_CHART_WORDS.search(text or ""))


_EXPORT_DECL = re.compile(
    r"^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)
_EXPORT_LIST = re.compile(r"^export\s*(?:type\s*)?\{([^}]*)\}\s*(?:from\s*['\"]([^'\"]+)['\"])?", re.MULTILINE | re.DOTALL)
_EXPORT_STAR = re.compile(r"^export\s*\*\s*from\s*['\"]([^'\"]+)['\"]", re.MULTILINE)


def _module_exports(files: dict[str, str], module: str, seen: set[str]) -> set[str]:
    """Names exported by `module` ('src/chronos/index'), following re-exports."""
    if module in seen:
        return set()
    seen.add(module)
    text = None
    for candidate in (module + ".ts", module + ".tsx", module + "/index.ts", module + "/index.tsx"):
        if candidate in files:
            text = files[candidate]
            module_dir = candidate.rsplit("/", 1)[0]
            break
    if text is None:
        return set()
    names: set[str] = set(_EXPORT_DECL.findall(text))
    for body, source in _EXPORT_LIST.findall(text):
        for part in body.split(","):
            part = re.sub(r"^\s*type\s+", "", part.strip())
            if not part:
                continue
            exported = part.split(" as ")[-1].strip()
            if exported:
                names.add(exported)
    for source in _EXPORT_STAR.findall(text):
        target = _resolve(module_dir, source)
        names |= _module_exports(files, target, seen)
    return names


def _resolve(base_dir: str, spec: str) -> str:
    parts = base_dir.split("/") if base_dir else []
    for part in spec.split("/"):
        if part == ".":
            continue
        if part == "..":
            if parts:
                parts.pop()
        else:
            parts.append(part)
    return "/".join(parts)


@lru_cache(maxsize=1)
def kit_exports() -> frozenset[str]:
    """Every name `import { … } from '../chronos'` can resolve (empty when the kit is missing)."""
    files = kit_files()
    if not files:
        return frozenset()
    return frozenset(_module_exports(files, "src/chronos/index", set()))


def marks_catalog(context: str | None = None, limit: int = 40) -> str:
    """`id: hint` lines for the 3D icons most relevant to `context` ('' when unavailable).

    The library holds ~900 icons; listing all of them would cost far more prompt tokens
    than the page itself, so each prompt gets the best matches only.
    """
    try:
        from app.services import marks_service

        return marks_service.prompt_catalog(context, limit)
    except Exception:  # noqa: BLE001 - the catalogue is optional prompt context
        return ""
