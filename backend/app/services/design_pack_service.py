"""Design packs: a client's visual system, installed into generated apps.

A pack is a folder of text files:

    pack.json         id, name, version, mode, fonts, radius, brand, swatches
    pack.css          custom-property overrides for :root and [data-theme="dark"]
    README.md         optional notes the planner reads (voice, what to call things)
    brand/logo.svg    optional logo (SVG only: app files are stored as text)

Inside an app the files live under src/design/, which the kit upgrade never
touches (it replaces src/chronos/* only). index.css loads
src/chronos/tokens.css, then src/design/pack.css, then src/design.css (the
Design tab's delta), so a pack overrides the kit and the editor overrides the
pack. The builtin `chronos` pack is what ships today, extracted.
"""
from __future__ import annotations

import io
import json
import logging
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.engines import kit

logger = logging.getLogger(__name__)

PACKS_ROOT = Path(__file__).resolve().parent.parent / "templates" / "design_packs"
COLLECTION = "design_packs"
ORG_DEFAULT_FIELD = "design_pack_default"
DEFAULT_PACK_ID = "chronos"
APP_DIR = "src/design"
MAX_ZIP_BYTES = 1_000_000
MAX_FILE_BYTES = 400_000
_ALLOWED_SUFFIXES = {".json", ".css", ".md", ".svg", ".txt"}
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
_VAR_DECL = re.compile(r"--([a-zA-Z0-9-]+)\s*:\s*([^;]+);")
_SCRIPT_RE = re.compile(r"<script|javascript:|on[a-z]+\s*=", re.IGNORECASE)

# Light-mode pairs that must stay readable (foreground, background, minimum ratio).
_CONTRAST_PAIRS = (
    ("text-primary", "surface-page-background", 4.5),
    ("text-primary", "surface-container", 4.5),
    ("text-secondary", "surface-container", 4.5),
    ("action-primary-content", "action-primary-default", 4.5),
    ("text-on-color", "action-primary-default", 3.0),
)


class PackError(ValueError):
    """The pack cannot be used; the message lists every problem found."""


# ── Reading packs ───────────────────────────────────────────────────────────

def _read_folder(folder: Path) -> dict[str, str]:
    files: dict[str, str] = {}
    for path in sorted(folder.rglob("*")):
        if path.is_file() and path.suffix in _ALLOWED_SUFFIXES:
            files[path.relative_to(folder).as_posix()] = path.read_text(encoding="utf-8")
    return files


def builtin_packs() -> dict[str, dict[str, str]]:
    """pack id -> files for every pack shipped with Chakram."""
    packs: dict[str, dict[str, str]] = {}
    if not PACKS_ROOT.is_dir():
        return packs
    for folder in sorted(PACKS_ROOT.iterdir()):
        if folder.is_dir() and (folder / "pack.json").is_file():
            packs[folder.name] = _read_folder(folder)
    return packs


def files_from_zip(data: bytes) -> dict[str, str]:
    """The text files of an uploaded zip, with a single top-level folder stripped."""
    if len(data) > MAX_ZIP_BYTES:
        raise PackError(f"The zip is larger than {MAX_ZIP_BYTES // 1000} KB.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise PackError("The upload is not a zip file.") from exc
    entries = [i for i in archive.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX/")]
    if not entries:
        raise PackError("The zip is empty.")
    names = [i.filename.replace("\\", "/").lstrip("/") for i in entries]
    # One top-level folder (how a folder zips on most systems) is stripped.
    first_parts = {n.split("/", 1)[0] for n in names}
    prefix = ""
    if len(first_parts) == 1 and all("/" in n for n in names):
        prefix = next(iter(first_parts)) + "/"
    files: dict[str, str] = {}
    for info, name in zip(entries, names):
        if ".." in name.split("/") or name.startswith("/"):
            raise PackError(f"Unsafe path in zip: {name}")
        rel = name[len(prefix):] if prefix and name.startswith(prefix) else name
        if Path(rel).suffix not in _ALLOWED_SUFFIXES:
            continue  # binaries and unknown files are ignored, reported by validate()
        if info.file_size > MAX_FILE_BYTES:
            raise PackError(f"{rel} is larger than {MAX_FILE_BYTES // 1000} KB.")
        files[rel] = archive.read(info).decode("utf-8", errors="replace")
    return files


# ── Validation ──────────────────────────────────────────────────────────────

def _kit_defaults() -> dict[str, str]:
    """Light-mode custom properties of the kit's tokens.css (reference + semantic)."""
    text = kit.kit_files().get("src/chronos/tokens.css", "")
    root = text.split("[data-theme=\"dark\"]", 1)[0]
    return {name: value.strip() for name, value in _VAR_DECL.findall(root)}


def _semantic_names(defaults: dict[str, str]) -> list[str]:
    return [n for n in defaults if not n.startswith(("ref-", "font-", "radius-", "shell-"))]


def _split_css(css: str) -> tuple[dict[str, str], dict[str, str]]:
    """(light declarations, dark declarations) from pack.css."""
    light: dict[str, str] = {}
    dark: dict[str, str] = {}
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        selector = m.group(1).strip()
        body = m.group(2)
        target = dark if "data-theme" in selector and "dark" in selector else light if ":root" in selector or selector == "html" else None
        if target is None:
            continue
        for name, value in _VAR_DECL.findall(body):
            target[name] = value.strip()
    return light, dark


def _resolve(value: str, table: dict[str, str], depth: int = 0) -> str | None:
    """A hex colour for `value`, following var(--x) references through `table`."""
    if depth > 12 or not value:
        return None
    value = value.strip()
    m = re.fullmatch(r"var\(\s*--([a-zA-Z0-9-]+)\s*(?:,\s*([^)]*))?\)", value)
    if m:
        inner = table.get(m.group(1))
        if inner is None:
            return _resolve(m.group(2) or "", table, depth + 1) if m.group(2) else None
        return _resolve(inner, table, depth + 1)
    if _HEX_RE.match(value):
        return value
    rgb = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)", value)
    if rgb:
        r, g, b = (min(255, int(rgb.group(i))) for i in (1, 2, 3))
        return f"#{r:02x}{g:02x}{b:02x}"
    return None


def _luminance(hex_colour: str) -> float:
    h = hex_colour.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast_ratio(a: str, b: str) -> float:
    la, lb = _luminance(a), _luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return round((hi + 0.05) / (lo + 0.05), 2)


def validate(files: dict[str, str]) -> tuple[dict[str, Any], list[str]]:
    """(metadata, warnings) for a pack's files; raises PackError listing every problem."""
    problems: list[str] = []
    warnings: list[str] = []

    raw = files.get("pack.json")
    if raw is None:
        raise PackError("pack.json is missing.")
    try:
        meta = json.loads(raw)
    except ValueError as exc:
        raise PackError(f"pack.json is not valid JSON: {exc}") from exc
    if not isinstance(meta, dict):
        raise PackError("pack.json must be a JSON object.")

    pack_id = str(meta.get("id") or "").strip().lower()
    if not _ID_RE.match(pack_id):
        problems.append("pack.json 'id' must be 2-40 characters of a-z, 0-9 and '-'.")
    if not str(meta.get("name") or "").strip():
        problems.append("pack.json 'name' is required.")
    if not str(meta.get("version") or "").strip():
        problems.append("pack.json 'version' is required (e.g. \"1.0.0\").")
    mode = meta.get("mode", "light")
    if mode not in ("light", "dark"):
        problems.append("pack.json 'mode' must be \"light\" or \"dark\".")
    fonts = meta.get("fonts") or {}
    if not isinstance(fonts, dict) or not isinstance(fonts.get("sans"), dict) or not fonts["sans"].get("family"):
        problems.append("pack.json 'fonts.sans.family' is required.")
    for role in ("sans", "display"):
        font = fonts.get(role) if isinstance(fonts, dict) else None
        if isinstance(font, dict) and font.get("source") == "google" and not str(font.get("url") or "").startswith("https://fonts.googleapis.com/"):
            problems.append(f"pack.json 'fonts.{role}.url' must be a fonts.googleapis.com URL when source is \"google\".")
    brand = meta.get("brand") or {}
    logo = brand.get("logo") if isinstance(brand, dict) else None
    if logo:
        if logo not in files:
            problems.append(f"pack.json 'brand.logo' points at {logo}, which is not in the pack (SVG only).")
        elif not logo.endswith(".svg"):
            problems.append("brand.logo must be an .svg file (app files are stored as text).")
        elif _SCRIPT_RE.search(files[logo]):
            problems.append("brand/logo.svg must not contain scripts or event handlers.")
    kit_compat = meta.get("kit_compat")
    current = kit.kit_version(kit.kit_files())
    if isinstance(kit_compat, int) and kit_compat > current:
        problems.append(f"pack.json 'kit_compat' {kit_compat} is newer than the installed kit ({current}).")

    css = files.get("pack.css")
    if css is None:
        problems.append("pack.css is missing (it may be empty for a pack that changes nothing).")
        css = ""
    if "</style" in css.lower() or "javascript:" in css.lower():
        problems.append("pack.css contains markup or script.")
    light, dark = _split_css(css)
    defaults = _kit_defaults()
    if pack_id != DEFAULT_PACK_ID:
        semantic = _semantic_names(defaults)
        missing = [n for n in semantic if n not in light]
        if missing:
            if len(missing) == len(semantic):
                warnings.append("pack.css overrides no semantic tokens; the app will look like Chronos with the pack's fonts.")
            elif len(missing) > 8:
                warnings.append(f"pack.css leaves {len(missing)} semantic tokens at Chronos defaults (first: {', '.join(missing[:5])}).")
            else:
                warnings.append(f"pack.css leaves these tokens at Chronos defaults: {', '.join(missing)}.")
        if light and not dark:
            warnings.append("pack.css has no [data-theme=\"dark\"] block; dark mode will use Chronos dark values.")
    table = {**defaults, **light}
    for fg, bg, minimum in _CONTRAST_PAIRS:
        a, b = _resolve(table.get(fg, ""), table), _resolve(table.get(bg, ""), table)
        if a is None or b is None:
            continue
        ratio = contrast_ratio(a, b)
        if ratio < 3.0:
            problems.append(f"--{fg} on --{bg} has contrast {ratio}:1 (minimum 3:1).")
        elif ratio < minimum:
            warnings.append(f"--{fg} on --{bg} has contrast {ratio}:1, below the {minimum}:1 target.")

    for path in files:
        if path not in ("pack.json", "pack.css", "README.md") and not path.startswith("brand/"):
            warnings.append(f"{path} is not part of the pack format and is ignored.")

    if problems:
        raise PackError(" ".join(problems))

    meta["id"] = pack_id
    meta["mode"] = mode
    meta.setdefault("swatches", _swatches(table))
    return meta, warnings


def _swatches(table: dict[str, str]) -> dict[str, str]:
    return {
        "page": _resolve(table.get("surface-page-background", ""), table) or "#f3f4f6",
        "container": _resolve(table.get("surface-container", ""), table) or "#ffffff",
        "text": _resolve(table.get("text-primary", ""), table) or "#0b0b0c",
        "accent": _resolve(table.get("action-primary-default", ""), table) or "#0b0b0c",
    }


# ── Applying a pack to an app ───────────────────────────────────────────────

def font_links(meta: dict[str, Any]) -> list[str]:
    links: list[str] = []
    fonts = meta.get("fonts") or {}
    for role in ("sans", "display", "mono"):
        font = fonts.get(role) if isinstance(fonts, dict) else None
        url = font.get("url") if isinstance(font, dict) else None
        if isinstance(url, str) and url.startswith("https://fonts.googleapis.com/") and url not in links:
            links.append(url)
    return links


def _font_css(meta: dict[str, Any]) -> str:
    """`--font-*` and `--radius-lg` declarations derived from pack.json."""
    lines: list[str] = []
    fonts = meta.get("fonts") or {}
    for role, var in (("sans", "--font-sans"), ("display", "--font-display")):
        font = fonts.get(role) if isinstance(fonts, dict) else None
        if not isinstance(font, dict):
            continue
        stack = font.get("stack") if isinstance(font.get("stack"), list) else [font.get("family")]
        parts = []
        for name in stack:
            if not isinstance(name, str) or not name.strip():
                continue
            name = name.strip().replace("'", "")
            parts.append(name if name in ("ui-sans-serif", "system-ui", "sans-serif", "serif", "monospace", "ui-monospace") else f"'{name}'")
        if parts:
            lines.append(f"  {var}: {', '.join(parts)};")
    radius = (meta.get("radius") or {}).get("lg") if isinstance(meta.get("radius"), dict) else None
    if isinstance(radius, str) and re.fullmatch(r"\d+(\.\d+)?(px|rem)", radius.strip()):
        lines.append(f"  --radius-lg: {radius.strip()};")
    return ":root {\n" + "\n".join(lines) + "\n}\n" if lines else ""


def app_files(pack_files: dict[str, str], meta: dict[str, Any]) -> dict[str, str]:
    """The files a pack contributes to an app, keyed by workspace path."""
    out: dict[str, str] = {}
    for path, content in pack_files.items():
        if path in ("pack.json", "pack.css", "README.md") or path.startswith("brand/"):
            out[f"{APP_DIR}/{path}"] = content
    out[f"{APP_DIR}/pack.json"] = json.dumps(meta, indent=2) + "\n"
    generated = _font_css(meta)
    css = pack_files.get("pack.css", "")
    header = f"/* Design pack: {meta.get('name')} ({meta.get('id')}@{meta.get('version')}). Loaded after the kit's tokens; the Design tab's design.css loads after this. */\n"
    out[f"{APP_DIR}/pack.css"] = header + (generated + "\n" if generated else "") + css.strip() + "\n"
    return out


def install(template: dict[str, str], pack_files: dict[str, str], meta: dict[str, Any]) -> dict[str, str]:
    """A template with the pack installed: src/design/*, index.css order, fonts, logo, mode."""
    files = dict(template)
    files.update(app_files(pack_files, meta))

    css = files.get("src/index.css")
    if css is not None and "@import './design/pack.css';" not in css:
        anchor = "@import './chronos/tokens.css';\n"
        if anchor in css:
            css = css.replace(anchor, anchor + "@import './design/pack.css';\n", 1)
        else:
            css = "@import './design/pack.css';\n" + css
        files["src/index.css"] = css

    html = files.get("index.html")
    if html is not None:
        links = "".join(f'    <link rel="stylesheet" href="{u}" />\n' for u in font_links(meta))
        html = re.sub(
            r"(<!-- DESIGN_FONTS_START -->)(.*?)(<!-- DESIGN_FONTS_END -->)",
            lambda m: f"{m.group(1)}\n{links}    {m.group(3)}" if links else f"{m.group(1)}\n    {m.group(3)}",
            html,
            count=1,
            flags=re.DOTALL,
        )
        if meta.get("mode") == "dark":
            html = re.sub(r'<html(?![^>]*data-theme)([^>]*)>', r'<html\1 data-theme="dark">', html, count=1)
        files["index.html"] = html

    logo = (meta.get("brand") or {}).get("logo") if isinstance(meta.get("brand"), dict) else None
    app_tsx = files.get("src/App.tsx", "")
    if logo and f"{APP_DIR}/{logo}" in files and "AUTO_LOGO" not in app_tsx:
        app_tsx = app_tsx.replace(
            "// AUTO_IMPORTS_START",
            f"import logoUrl from './design/{logo}'; // AUTO_LOGO\n// AUTO_IMPORTS_START",
            1,
        ).replace("<AppShell appName={APP_NAME} nav={NAV}>", "<AppShell appName={APP_NAME} nav={NAV} logoSrc={logoUrl}>", 1)
        files["src/App.tsx"] = app_tsx
    return files


# ── Storage (org packs) ─────────────────────────────────────────────────────

def _public(meta: dict[str, Any], source: str, default_id: str) -> dict[str, Any]:
    fonts = meta.get("fonts") or {}
    return {
        "id": meta["id"],
        "name": meta.get("name", meta["id"]),
        "version": str(meta.get("version", "")),
        "source": source,
        "is_default": meta["id"] == default_id,
        "mode": meta.get("mode", "light"),
        "fonts": {
            "sans": (fonts.get("sans") or {}).get("family", "") if isinstance(fonts, dict) else "",
            "display": (fonts.get("display") or {}).get("family", "") if isinstance(fonts, dict) else "",
        },
        "swatches": meta.get("swatches") or _swatches(_kit_defaults()),
    }


async def org_default_id(db, org_id: str) -> str:
    try:
        doc = await db["organizations"].find_one({"_id": _oid(org_id)}, {ORG_DEFAULT_FIELD: 1})
    except Exception:  # noqa: BLE001 - a bad id means no custom default
        doc = None
    value = (doc or {}).get(ORG_DEFAULT_FIELD)
    return value if isinstance(value, str) and value else DEFAULT_PACK_ID


def _oid(org_id: str):
    from bson import ObjectId

    try:
        return ObjectId(org_id)
    except Exception:  # noqa: BLE001
        return org_id


async def set_org_default(db, org_id: str, pack_id: str) -> str:
    if pack_id not in builtin_packs():
        if await db[COLLECTION].find_one({"org_id": org_id, "id": pack_id}, {"_id": 1}) is None:
            raise PackError(f"No design pack '{pack_id}' for this organization.")
    await db["organizations"].update_one({"_id": _oid(org_id)}, {"$set": {ORG_DEFAULT_FIELD: pack_id}})
    return pack_id


async def list_packs(db, org_id: str) -> dict[str, Any]:
    default_id = await org_default_id(db, org_id)
    packs: list[dict[str, Any]] = []
    for pack_id, files in builtin_packs().items():
        try:
            meta, _ = validate(files)
        except PackError:
            logger.exception("builtin design pack %s is invalid", pack_id)
            continue
        packs.append(_public(meta, "builtin", default_id))
    cursor = db[COLLECTION].find({"org_id": org_id}, {"files": 0}).sort("created_at", 1)
    async for doc in cursor:
        packs.append(_public(doc["meta"], "org", default_id))
    if default_id not in {p["id"] for p in packs}:
        default_id = DEFAULT_PACK_ID
        for p in packs:
            p["is_default"] = p["id"] == default_id
    return {"packs": packs, "default_id": default_id}


async def save_org_pack(db, org_id: str, files: dict[str, str]) -> tuple[dict[str, Any], list[str]]:
    meta, warnings = validate(files)
    if meta["id"] in builtin_packs():
        raise PackError(f"'{meta['id']}' is a builtin pack id; choose another id.")
    await db[COLLECTION].update_one(
        {"org_id": org_id, "id": meta["id"]},
        {
            "$set": {"meta": meta, "files": files, "updated_at": datetime.now(timezone.utc)},
            "$setOnInsert": {"org_id": org_id, "id": meta["id"], "created_at": datetime.now(timezone.utc)},
        },
        upsert=True,
    )
    default_id = await org_default_id(db, org_id)
    return _public(meta, "org", default_id), warnings


async def delete_org_pack(db, org_id: str, pack_id: str) -> bool:
    result = await db[COLLECTION].delete_one({"org_id": org_id, "id": pack_id})
    if result.deleted_count:
        if await org_default_id(db, org_id) == pack_id:
            await db["organizations"].update_one({"_id": _oid(org_id)}, {"$unset": {ORG_DEFAULT_FIELD: ""}})
        return True
    return False


async def load_pack(db, org_id: str, pack_id: str | None) -> tuple[str, dict[str, str], dict[str, Any]]:
    """(pack id, files, meta) for `pack_id`, the org default when None; chronos when unknown."""
    wanted = pack_id or await org_default_id(db, org_id)
    builtin = builtin_packs()
    if wanted in builtin:
        meta, _ = validate(builtin[wanted])
        return wanted, builtin[wanted], meta
    doc = await db[COLLECTION].find_one({"org_id": org_id, "id": wanted})
    if doc is not None:
        return wanted, dict(doc["files"]), dict(doc["meta"])
    if pack_id:
        raise PackError(f"No design pack '{pack_id}' for this organization.")
    meta, _ = validate(builtin[DEFAULT_PACK_ID])
    return DEFAULT_PACK_ID, builtin[DEFAULT_PACK_ID], meta


async def ensure_indexes(db) -> None:
    await db[COLLECTION].create_index([("org_id", 1), ("id", 1)], unique=True)
