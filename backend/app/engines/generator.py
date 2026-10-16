"""Generator engine streams LLM output token-by-token for a single file."""
import asyncio
import logging
import re
import threading
from typing import AsyncGenerator

from app.engines import kit
from app.services import ai_service

logger = logging.getLogger(__name__)

_TASK_NAME = "AI App Builder: Generate File"

_FILE_PROMPT = """\
You are an expert React 18 + TypeScript engineer generating a single production-quality file.

Project stack (ALL packages installed use freely):
- React 18 + TypeScript
- Tailwind CSS (all utilities available, including arbitrary values like bg-[#0f172a])
- react-router-dom v6 (link with <Link to="...">)
- framer-motion (motion.div, AnimatePresence, etc.)
- recharts (AreaChart, BarChart, PieChart, LineChart, etc.)
- lucide-react (any icon by name)
- clsx + tailwind-merge  (import {{ cn }} from '../lib/utils' OR import clsx from 'clsx')
- @radix-ui/react-dialog, @radix-ui/react-dropdown-menu, @radix-ui/react-tabs, @radix-ui/react-tooltip
- @tanstack/react-query
- date-fns (format, formatDistanceToNow, etc.)

File to generate: {path}
Component name: {component_name}
Description: {description}
App name: {app_name}
Color theme / aesthetic: {color_theme}
Preferred imports: {imports}
App routes (path -> page): {routes}
Shared components in this app: {components}
{context_block}

STRICT OUTPUT RULES:
- Output ONLY the raw TypeScript/TSX file content. Absolutely NO markdown, NO backticks, NO explanations.
- First line must be an import statement.
- The default export must be: export default function {component_name}()
- Use Tailwind exclusively for all styling NO inline styles, NO CSS modules.
- Use Tailwind's named palette colours (e.g. bg-emerald-500, text-slate-300) rather than arbitrary hex values, and the `font-display` class on headings, so the app's design editor can restyle them.
- Create a STUNNING, production-grade UI. Think: dark glassmorphism, gradient accents, animated entries, clean typography.
- Include 20-50+ lines of realistic mock data (arrays/objects) defined inside the component or at module scope.
- Every interaction element (buttons, cards, tabs) must have hover/focus styles.
- Use framer-motion for smooth entrance animations (opacity 0→1, translateY).
- If using recharts: use real-looking data with 8-12 data points, styled with custom colors.
- Keep under 250 lines. No TODO comments. Fully functional, zero placeholder text.
- If this is a page, import the shared Navbar (import Navbar from '../components/Navbar') and render <Navbar /> as the first element. Do NOT use <Outlet>.
- If this is the Navbar, link to every app route above with <Link>/<NavLink> from react-router-dom, use sticky positioning and backdrop-blur, and accept no required props.
- Only import local files that exist: the shared components listed above (from '../components/<Name>') and '../lib/utils'. Never import a page from another page.
- Every default export is a component that takes no required props.
"""


def _role_rules(path: str, component_name: str, mark: str) -> str:
    """What this kind of file must contain: a page, a data module or a small component."""
    if path.startswith("src/pages/"):
        return (
            f"- This is a PAGE: `export default function {component_name}()` taking no props. Return\n"
            f"  <PageBody> starting with <PageHeader title=... description=... "
            f'mark={{<Mark id="{mark}" size={{44}} />}} />, then the content.'
        )
    if path.endswith(".ts"):
        return (
            "- This is a DATA module (.ts): export TypeScript types and typed constant arrays/objects of mock data,\n"
            "  plus small pure helper functions if useful. NO JSX, NO React imports, NO components, no default export."
        )
    return (
        f"- This is a shared COMPONENT: `export default function {component_name}(props)` with a typed props\n"
        "  interface; small and reusable. Do not render PageHeader/PageBody or any layout."
    )


# With the Chronos kit, a page composes ready-made components, so the model writes far
# less code per file (fewer output tokens, faster builds) and every app has the same look.
#
# The prompt is split in two. The SYSTEM message is the same for every file of a
# given role (role line, kit sheet, style rules), so a provider that caches prompt
# prefixes reuses it across the files of a build. The USER message carries only
# what differs per file: path, purpose, routes, shared code, icons, and the
# problems of a previous attempt when this is a retry.
_KIT_SYSTEM = """\
You are an elite React 18 + TypeScript engineer writing ONE file of a Vite app (Tailwind v3,
react-router-dom v6, recharts, lucide-react). The app is wrapped in the Chronos kit's AppShell
(sidebar + top bar), so a page renders only its content. Build the UI from the kit; never re-create
what it provides.

Output rules:
- Output only the file's code: no markdown fences, no explanations, no commentary. Start with an import.
- Import kit pieces from '../chronos' (or '../../chronos' from deeper folders). Import shared data only
  from the files listed in the request, with their exact exported names. Never import a page from a page.
- Style with the kit's semantic classes only (bg-container, text-primary, border-muted, ...). No gradients,
  glassmorphism, drop shadows, framer-motion, palette classes (bg-blue-500), hex or rgb() colours.
- Responsive by construction: KpiTiles in <KpiGrid>, cards in <Grid>, two-up in <SplitRow>. Never a bare
  `grid-cols-N` without `sm:`/`lg:` prefixes, never fixed pixel widths on content. Keep KPI values short and
  pre-formatted; long text gets `truncate` or `line-clamp-2`.
- Interactions must work (search, filters, tabs with useState). No TODOs, no placeholder text, no "use client".
- Keep it compact: at most ~140 lines.

{sheets}
"""

_KIT_USER = """\
File: {path}
Purpose: {description}
App: {app_name}
Page icon (3D mark id): {mark}
Routes: {routes}
{context_block}
{role_rules}
{data_rule}
{marks_block}
{retry_block}"""

_DATA_RULE_PAGE = (
    "- Data: import it from the shared data module(s) above and only display it. If a value the page needs "
    "is missing there, derive it in the page with a small pure helper; do not define new datasets."
)
_DATA_RULE_DATA = "- This module owns ALL the app's mock data: every page will import from it."
_DATA_RULE_COMPONENT = "- Data arrives through props; define no datasets here."


def _role_rules(path: str, component_name: str, mark: str) -> str:
    """What this kind of file must contain: a page, a data module or a small component."""
    if path.startswith("src/pages/"):
        return (
            f"- This is a PAGE: `export default function {component_name}()` taking no props. Return\n"
            f"  <PageBody> starting with <PageHeader title=... description=... "
            f'mark={{<Mark id="{mark}" size={{44}} />}} />, then the content.'
        )
    if path.endswith(".ts"):
        return (
            "- This is a DATA module (.ts): export TypeScript types and typed constant arrays/objects of mock data,\n"
            "  plus small pure helper functions if useful. NO JSX, NO React imports, NO components, no default export."
        )
    return (
        f"- This is a shared COMPONENT: `export default function {component_name}(props)` with a typed props\n"
        "  interface; small and reusable. Do not render PageHeader/PageBody or any layout."
    )


def _data_rule(role: str) -> str:
    return {"page": _DATA_RULE_PAGE, "data": _DATA_RULE_DATA}.get(role, _DATA_RULE_COMPONENT)


def _retry_block(file_spec: dict) -> str:
    problems = file_spec.get("previous_problems")
    if not problems:
        return ""
    if isinstance(problems, str):
        problems = [problems]
    lines = "\n".join(f"  - {p}" for p in problems)
    return (
        "\nThe previous attempt at this file was rejected for these reasons; write the whole file again "
        f"and avoid them:\n{lines}\n"
    )


def kit_messages(file_spec: dict) -> tuple[str, str]:
    """(system, user) messages for a kit app file."""
    path = file_spec["path"]
    role = kit.role_for(path)
    component_name = file_spec.get("component_name") or "Page"
    mark = file_spec.get("mark") or "mark-command"
    description = file_spec.get("description", "")
    sheets = [kit.kit_sheet(role)]
    if role == "page" and kit.wants_charts(description):
        sheets.append(kit.kit_sheet("charts"))
    system = _KIT_SYSTEM.format(sheets="\n\n".join(s for s in sheets if s) or "(kit reference unavailable)")

    routes_text = ", ".join(
        f"{r.get('path')} -> {r.get('component')}" for r in file_spec.get("routes", []) if isinstance(r, dict)
    ) or "none planned"
    if role == "page":
        # The planned icon plus the icons closest to this page's purpose.
        catalog = kit.marks_catalog(
            " ".join(str(file_spec.get(k) or "") for k in ("mark", "description", "component_name", "app_name")), 20
        )
        marks_block = f"3D icons available to <Mark id=\"...\" />:\n{catalog or '(none)'}\n"
    else:
        marks_block = ""
    user = _KIT_USER.format(
        path=path,
        description=description,
        app_name=file_spec.get("app_name", "App"),
        mark=mark if role == "page" else "n/a",
        routes=routes_text,
        context_block=_context_block(file_spec.get("context_files") or {}),
        role_rules=_role_rules(path, component_name, mark),
        data_rule=_data_rule(role),
        marks_block=marks_block,
        retry_block=_retry_block(file_spec),
    )
    return system, user


_FENCED_BLOCK = re.compile(r"```[a-zA-Z0-9_-]*[ \t]*\r?\n(.*?)\r?\n?```", re.DOTALL)


def strip_code_fences(text: str) -> str:
    """Return the code from model output that may be wrapped in a markdown fence.

    Handles a fence around the whole output, a fence preceded by a sentence
    ("Here is the file:"), and an unterminated opening fence. Output without a
    fence is returned unchanged apart from surrounding whitespace.
    """
    text = text.strip()
    if "```" not in text:
        return text
    match = _FENCED_BLOCK.search(text)
    if match:
        return match.group(1).strip()
    # Opening fence only: the model ran out of budget before closing it.
    text = re.sub(r"^.*?```[a-zA-Z0-9_-]*[ \t]*\r?\n", "", text, count=1, flags=re.DOTALL)
    return text.strip()


_strip_code_fences = strip_code_fences


def _schedule_usage_log(
    org_id: str | None, prompt_tokens: int, completion_tokens: int, extra: dict | None = None
) -> None:
    """Fire-and-forget usage log through ai_service's cost logger.

    The task runs in its own copy of the context, so the org is set there and
    never reset: resetting a ContextVar token from a different context raised
    ValueError when the loop shut down with the task still pending.
    """

    async def _log() -> None:
        if org_id:
            ai_service.set_current_org_id(org_id)
        await ai_service._log_cost(_TASK_NAME, prompt_tokens, completion_tokens, extra=extra)

    try:
        asyncio.get_running_loop().create_task(_log())
    except RuntimeError:
        logger.warning("[Generator] No running loop; usage for a generation was not logged")


# Output budget for one generated file, including any reasoning the model does first.
_FILE_MAX_TOKENS = 8000

# Files already written for the same app are shown to later prompts so pages use
# shared components and data with the props and shapes they actually export.
_CONTEXT_FILE_CHARS = 5000
_CONTEXT_TOTAL_CHARS = 14000


def _export_summary(content: str, limit: int) -> str:
    """The exported names and shapes of a file that is too long to inline whole.

    Each `export` line is kept with the first lines of its body, so a page sees
    every type and dataset it can import (a hard cut would hide the later ones).
    """
    lines = content.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines) and sum(len(l) + 1 for l in out) < limit:
        line = lines[i]
        if re.match(r"\s*export\s", line):
            out.append(line)
            opened = line.count("{") + line.count("[") - line.count("}") - line.count("]")
            j = i + 1
            kept = 0
            while j < len(lines) and opened > 0 and kept < 8:
                out.append(lines[j])
                opened += lines[j].count("{") + lines[j].count("[") - lines[j].count("}") - lines[j].count("]")
                kept += 1
                j += 1
            if opened > 0:
                out.append("  // … more rows of the same shape")
                while j < len(lines) and opened > 0:
                    opened += lines[j].count("{") + lines[j].count("[") - lines[j].count("}") - lines[j].count("]")
                    j += 1
                out.append(lines[j - 1] if j - 1 < len(lines) else "")
            i = j
            continue
        i += 1
    return "\n".join(out)


def _context_block(context_files: dict) -> str:
    if not isinstance(context_files, dict) or not context_files:
        return ""
    parts: list[str] = []
    used = 0
    for path, content in context_files.items():
        if not isinstance(content, str) or not content.strip():
            continue
        if len(content) <= _CONTEXT_FILE_CHARS:
            body = content
        else:
            body = "// exports only (file shortened):\n" + _export_summary(content, _CONTEXT_FILE_CHARS)
        if used + len(body) > _CONTEXT_TOTAL_CHARS:
            break
        used += len(body)
        parts.append(f"--- {path} ---\n{body}")
    if not parts:
        return ""
    return (
        "\nFiles already written for this app. Import them with the exact names, props and data shapes "
        "they export; do not redefine them:\n" + "\n\n".join(parts) + "\n"
    )


async def stream_file(file_spec: dict, org_id: str | None = None) -> AsyncGenerator[str, None]:
    """Yields tokens from Ollama for a single file spec.

    The model, key and base URL come from the same per-org connector config
    ai_service uses, and every call is written to api_cost_logs. `org_id`
    attributes the log entry when the caller runs outside request scope (the
    websocket handler); without it the request-scoped org is used.

    `file_spec` may carry `usage_sink`, a callable `(prompt_tokens,
    completion_tokens)` the run uses to total a build, and `log_extra`, a dict
    merged into the usage log row (workspace id, run id, path).

    A provider error is raised to the caller once the tokens received before
    it have been yielded.
    """
    if kit.has_kit():
        system, user = kit_messages(file_spec)
    else:
        routes_text = ", ".join(
            f"{r.get('path')} -> {r.get('component')}" for r in file_spec.get("routes", []) if isinstance(r, dict)
        ) or "none planned"
        system, user = _LEGACY_SYSTEM, _legacy_prompt(file_spec, routes_text)
    async for token in _stream_messages(system, user, file_spec, org_id):
        yield token


_LEGACY_SYSTEM = (
    "You are an elite React/TypeScript UI engineer. "
    "Output raw TypeScript/TSX code ONLY. "
    "Absolutely no markdown fences, no backticks, no explanations, no comments about what you are doing. "
    "Start directly with the import statement."
)


def _legacy_prompt(file_spec: dict, routes_text: str) -> str:
    return _FILE_PROMPT.format(
        path=file_spec["path"],
        component_name=file_spec.get("component_name", "Component"),
        description=file_spec.get("description", ""),
        app_name=file_spec.get("app_name", "AI App"),
        color_theme=file_spec.get("color_theme", "dark luxury with gradient accents"),
        imports=", ".join(file_spec.get("imports", [])),
        routes=routes_text,
        components=", ".join(file_spec.get("components", [])) or "none",
        context_block=_context_block(file_spec.get("context_files") or {}),
    )


async def _stream_messages(system: str, user: str, file_spec: dict, org_id: str | None) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue[str | None] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    error_holder: list[Exception] = []
    # [prompt_tokens, completion_tokens]; stays zero if the provider reports no usage.
    usage_holder: list[int] = [0, 0]

    # Resolved here, not in the worker thread: connector config is context-local.
    client = ai_service._get_client()
    _, _, model = ai_service._ollama_cfg()

    def _sync_stream() -> None:
        try:
            stream = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                stream=True,
                stream_options={"include_usage": True},
                # Thinking models (kimi-k3, gpt-oss) count their reasoning against
                # max_tokens. Without a low reasoning effort and enough room they
                # spend the whole budget thinking and stream no code at all.
                max_tokens=_FILE_MAX_TOKENS,
                temperature=0.3,
                extra_body={"reasoning_effort": "low"},
            )
            for chunk in stream:
                usage = getattr(chunk, "usage", None)
                if usage:
                    usage_holder[0] = usage.prompt_tokens or 0
                    usage_holder[1] = usage.completion_tokens or 0
                if chunk.choices and chunk.choices[0].delta.content:
                    loop.call_soon_threadsafe(
                        queue.put_nowait, chunk.choices[0].delta.content
                    )
        except Exception as exc:
            logger.error(f"[Generator] Stream error for {file_spec.get('path')}: {exc}")
            error_holder.append(exc)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    t = threading.Thread(target=_sync_stream, daemon=True)
    t.start()

    try:
        while True:
            token = await queue.get()
            if token is None:
                break
            yield token
        if error_holder:
            raise error_holder[0]
    finally:
        # Runs on completion, error and cancellation (caller timeout), so every
        # call is logged; tokens are zero when usage never arrived.
        sink = file_spec.get("usage_sink")
        if callable(sink):
            try:
                sink(usage_holder[0], usage_holder[1])
            except Exception:  # noqa: BLE001 - totals must never break a stream
                logger.exception("[Generator] usage sink failed")
        extra = dict(file_spec.get("log_extra") or {})
        extra.setdefault("path", file_spec.get("path"))
        _schedule_usage_log(org_id, usage_holder[0], usage_holder[1], extra)
