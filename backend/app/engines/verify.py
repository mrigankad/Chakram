"""Structural checks on a generated file before it is accepted.

The API container has no Node toolchain, so this is not a type check. It is
the set of cheap, deterministic checks that catch what actually goes wrong in
practice: truncated output (unbalanced brackets, an unterminated string or
template), leftover markdown, a missing default export, imports of kit names
that do not exist, imports of local files that are not in the app, and the
packages the kit forbids. A file that fails is regenerated once with the
reasons attached; a file that passes may still fail `tsc`, and the preview
reports that as it does today.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

_LOCAL_EXTENSIONS = (".tsx", ".ts", ".jsx", ".js", ".json", ".css")
_FORBIDDEN_PACKAGES = {"framer-motion", "next", "next/link", "next/router", "next/navigation", "@/components/ui"}
_IMPORT_RE = re.compile(
    r"""^\s*import\s+(?:type\s+)?(?P<clause>[^'"]*?)\s*from\s*['"](?P<spec>[^'"]+)['"]"""
    r"""|^\s*import\s*['"](?P<bare>[^'"]+)['"]""",
    re.MULTILINE,
)
_DEFAULT_EXPORT_RE = re.compile(r"export\s+default\s+(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*;?\s*$)", re.MULTILINE)


@dataclass
class VerifyResult:
    ok: bool
    problems: list[str] = field(default_factory=list)

    @property
    def message(self) -> str:
        return "; ".join(self.problems)


def _strip_code(text: str) -> str:
    """Remove comments, strings and template literals so bracket counting sees only code.

    JSX text between tags is left in place; it never contains unbalanced
    brackets in valid output because `{`/`}` there are expressions.
    """
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            j = text.find("\n", i)
            i = n if j == -1 else j
            continue
        if ch == "/" and nxt == "*":
            j = text.find("*/", i + 2)
            if j == -1:
                out.append("\x00UNTERMINATED_COMMENT")
                return "".join(out)
            i = j + 2
            continue
        if ch in ("'", '"'):
            j = i + 1
            while j < n and text[j] != ch:
                if text[j] == "\\":
                    j += 1
                elif text[j] == "\n":
                    out.append("\x00UNTERMINATED_STRING")
                    return "".join(out)
                j += 1
            if j >= n:
                out.append("\x00UNTERMINATED_STRING")
                return "".join(out)
            out.append('""')
            i = j + 1
            continue
        if ch == "`":
            j = i + 1
            depth = 0
            while j < n:
                c = text[j]
                if c == "\\":
                    j += 2
                    continue
                if depth == 0 and c == "`":
                    break
                if c == "$" and j + 1 < n and text[j + 1] == "{":
                    depth += 1
                    j += 2
                    continue
                if depth and c == "}":
                    depth -= 1
                j += 1
            if j >= n:
                out.append("\x00UNTERMINATED_TEMPLATE")
                return "".join(out)
            out.append('""')
            i = j + 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _bracket_problem(code: str) -> str | None:
    pairs = {")": "(", "]": "[", "}": "{"}
    stack: list[str] = []
    for ch in code:
        if ch in "([{":
            stack.append(ch)
        elif ch in ")]}":
            if not stack or stack[-1] != pairs[ch]:
                return f"unexpected '{ch}'"
            stack.pop()
    if stack:
        return f"unclosed '{stack[-1]}' (the file looks truncated)"
    return None


def parse_imports(text: str) -> list[tuple[str, list[str]]]:
    """(module specifier, imported names) for every import; default imports are 'default'."""
    found: list[tuple[str, list[str]]] = []
    for m in _IMPORT_RE.finditer(text):
        spec = m.group("spec") or m.group("bare")
        clause = (m.group("clause") or "").strip()
        names: list[str] = []
        if clause:
            braces = re.search(r"\{([^}]*)\}", clause)
            if braces:
                for part in braces.group(1).split(","):
                    part = part.strip()
                    if not part:
                        continue
                    part = re.sub(r"^type\s+", "", part)
                    names.append(part.split(" as ")[0].strip())
            rest = re.sub(r"\{[^}]*\}", "", clause).strip(" ,")
            for part in rest.split(","):
                part = part.strip()
                if not part:
                    continue
                if part.startswith("*"):
                    names.append("*")
                else:
                    names.append("default")
        found.append((spec, names))
    return found


def _resolve_local(spec: str, from_path: str) -> str:
    """'../chronos' from 'src/pages/Home.tsx' -> 'src/chronos'."""
    base = from_path.rsplit("/", 1)[0].split("/") if "/" in from_path else []
    parts = spec.split("/")
    for part in parts:
        if part == ".":
            continue
        if part == "..":
            if base:
                base.pop()
        else:
            base.append(part)
    return "/".join(base)


def verify_file(
    path: str,
    content: str,
    *,
    kit_exports: set[str] | None = None,
    workspace_files: set[str] | None = None,
    planned_files: set[str] | None = None,
    component_name: str | None = None,
) -> VerifyResult:
    problems: list[str] = []
    text = content.strip()
    if not text:
        return VerifyResult(False, ["the file is empty"])
    if "```" in text:
        problems.append("markdown fence left in the file")
    if text.startswith(("Here", "Sure", "Below", "This file", "Certainly")):
        problems.append("the file starts with prose instead of code")
    if re.search(r"^\s*['\"]use client['\"]", text, re.MULTILINE):
        problems.append("'use client' directive is not allowed (Vite app)")

    stripped = _strip_code(text)
    if "\x00UNTERMINATED_STRING" in stripped:
        problems.append("unterminated string literal (the file looks truncated)")
    elif "\x00UNTERMINATED_TEMPLATE" in stripped:
        problems.append("unterminated template literal (the file looks truncated)")
    elif "\x00UNTERMINATED_COMMENT" in stripped:
        problems.append("unterminated block comment")
    else:
        bracket = _bracket_problem(stripped)
        if bracket:
            problems.append(bracket)

    is_page = path.startswith("src/pages/")
    is_component = path.startswith("src/components/") and path.endswith(".tsx")
    is_data = path.endswith(".ts")
    exported = _DEFAULT_EXPORT_RE.search(text)
    if (is_page or is_component) and not exported:
        problems.append("no `export default function` found")
    elif exported and component_name:
        name = exported.group(1) or exported.group(2)
        if name and name != component_name:
            problems.append(f"default export is `{name}`, expected `{component_name}`")
    if is_data and re.search(r"^\s*export\s+default\b", text, re.MULTILINE):
        problems.append("a data module (.ts) must not have a default export")
    if is_data and re.search(r"</[A-Za-z][\w.]*\s*>|<[A-Z][\w.]*(?:\s[^<>]*)?/>", text):
        problems.append("JSX in a .ts data module")

    known = workspace_files or set()
    planned = planned_files or set()
    for spec, names in parse_imports(text):
        base = spec.split("/")[0] if not spec.startswith("@") else "/".join(spec.split("/")[:2])
        if spec in _FORBIDDEN_PACKAGES or base in _FORBIDDEN_PACKAGES:
            problems.append(f"import of forbidden package '{spec}'")
            continue
        if not spec.startswith("."):
            continue
        target = _resolve_local(spec, path)
        if target.endswith("/chronos") or target.endswith("/chronos/charts") or target == "src/chronos":
            if kit_exports and names:
                missing = [n for n in names if n not in ("default", "*") and n not in kit_exports]
                if missing:
                    problems.append(f"'{spec}' does not export {', '.join(sorted(missing))}")
            continue
        candidates = [target] + [target + ext for ext in _LOCAL_EXTENSIONS] + [f"{target}/index{ext}" for ext in _LOCAL_EXTENSIONS[:4]]
        if known or planned:
            if not any(c in known or c in planned for c in candidates):
                problems.append(f"import of '{spec}' which is not a file in this app")
        if target.startswith("src/pages/") and is_page and target != path.rsplit(".", 1)[0]:
            problems.append(f"a page must not import another page ('{spec}')")
    return VerifyResult(not problems, problems)
