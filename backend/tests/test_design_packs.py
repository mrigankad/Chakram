"""Design packs: validated, installed into apps, stored per org, untouched by kit upgrades."""
import io
import json
import zipfile

import pytest

from app.auth.session import create_session_cookie
from app.engines import kit
from app.services import ai_ide_service, design_pack_service as packs, organization_service, template_service

ACME_META = {
    "id": "acme",
    "name": "Acme Industrial",
    "version": "1.2.0",
    "mode": "light",
    "fonts": {
        "sans": {"family": "Inter", "stack": ["Inter", "system-ui", "sans-serif"], "source": "google",
                 "url": "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"},
        "display": {"family": "Space Grotesk", "stack": ["Space Grotesk", "Inter", "sans-serif"], "source": "google",
                    "url": "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap"},
    },
    "radius": {"lg": "4px"},
    "brand": {"logo": "brand/logo.svg"},
}

# Every semantic token of the kit, re-pointed at a red/charcoal palette.
ACME_CSS = """\
:root {
  --surface-page-background: #f5f3f0;
  --surface-container: #ffffff;
  --surface-raised: #faf8f5;
  --surface-raised-x2: #f0ece6;
  --surface-action: #f0ece6;
  --surface-scroll-bar: #cfc8bf;
  --text-primary: #1b1b1b;
  --text-secondary: #3f3f3f;
  --text-tertiary: #6b6b6b;
  --text-quaternary: #8a8a8a;
  --text-on-color: #ffffff;
  --icon-primary: #1b1b1b; --icon-secondary: #3f3f3f; --icon-tertiary: #6b6b6b; --icon-quaternary: #8a8a8a; --icon-on-color: #ffffff;
  --stroke-default: rgba(0,0,0,0.16); --stroke-active: rgba(0,0,0,0.28); --stroke-muted: rgba(0,0,0,0.09); --stroke-disabled: rgba(0,0,0,0.04); --stroke-on-color: rgba(255,255,255,0.2);
  --action-primary-default: #c8102e; --action-primary-hover: #a80d26; --action-primary-focused: #a80d26; --action-primary-disabled: #e8a3ad; --action-primary-content: #ffffff;
  --action-secondary-default: #ffffff; --action-secondary-hover: #faf8f5; --action-secondary-focused: #faf8f5; --action-secondary-disabled: #f0ece6; --action-secondary-content: #1b1b1b;
  --action-tertiary-default: transparent; --action-tertiary-hover: #faf8f5; --action-tertiary-focused: #faf8f5; --action-tertiary-disabled: transparent; --action-tertiary-content: #1b1b1b;
  --feedback-success-content: #166534; --feedback-success-icon: #16a34a; --feedback-success-stroke: #86efac; --feedback-success-background: #f0fdf4; --feedback-success-badge: #16a34a;
  --feedback-info-content: #1e40af; --feedback-info-icon: #2563eb; --feedback-info-stroke: #93c5fd; --feedback-info-background: #eff6ff; --feedback-info-badge: #2563eb;
  --feedback-neutral-content: #3f3f3f; --feedback-neutral-icon: #6b6b6b; --feedback-neutral-stroke: #d4d4d4; --feedback-neutral-background: #f5f5f5; --feedback-neutral-badge: #6b6b6b;
  --feedback-warning-content: #92400e; --feedback-warning-icon: #d97706; --feedback-warning-stroke: #fcd34d; --feedback-warning-background: #fffbeb; --feedback-warning-badge: #d97706;
  --feedback-error-content: #991b1b; --feedback-error-icon: #dc2626; --feedback-error-stroke: #fca5a5; --feedback-error-background: #fef2f2; --feedback-error-badge: #dc2626;
  --feedback-badge-content: #ffffff;
  --analytics-series-1: #c8102e; --analytics-series-2: #1b1b1b; --analytics-series-3: #d97706; --analytics-series-4: #2563eb; --analytics-series-5: #6b6b6b; --analytics-series-6: #7c3aed;
}
[data-theme="dark"] {
  --surface-page-background: #121212; --surface-container: #1c1c1c; --text-primary: #f5f5f5; --text-secondary: #d4d4d4;
}
"""
LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#c8102e"/></svg>'


def acme_files(**overrides) -> dict[str, str]:
    meta = json.loads(json.dumps(ACME_META))
    meta.update(overrides.pop("meta", {}))
    files = {"pack.json": json.dumps(meta), "pack.css": ACME_CSS, "README.md": "Acme: red accent, plain nouns, no slogans.", "brand/logo.svg": LOGO}
    files.update(overrides)
    return files


def _zip(files: dict[str, str], folder: str = "") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for path, content in files.items():
            z.writestr(folder + path, content)
    return buf.getvalue()


# ── validation ────────────────────────────────────────────────────────────

def test_the_builtin_chronos_pack_is_valid():
    builtin = packs.builtin_packs()
    assert "chronos" in builtin
    meta, warnings = packs.validate(builtin["chronos"])
    assert meta["id"] == "chronos" and warnings == []


def test_a_complete_client_pack_validates_with_swatches():
    meta, warnings = packs.validate(acme_files())
    assert meta["id"] == "acme"
    assert meta["swatches"]["accent"] == "#c8102e" and meta["swatches"]["page"] == "#f5f3f0"
    assert warnings == []


def test_missing_metadata_is_listed_in_one_error():
    with pytest.raises(packs.PackError) as exc:
        packs.validate(acme_files(meta={"id": "Bad Id!", "name": "", "version": ""}))
    message = str(exc.value)
    assert "'id'" in message and "'name'" in message and "'version'" in message


def test_a_missing_or_scripted_logo_is_rejected():
    files = acme_files()
    del files["brand/logo.svg"]
    with pytest.raises(packs.PackError, match="brand.logo"):
        packs.validate(files)
    with pytest.raises(packs.PackError, match="scripts"):
        packs.validate(acme_files(**{"brand/logo.svg": '<svg onload="alert(1)"></svg>'}))


def test_unreadable_contrast_is_rejected_and_weak_contrast_is_a_warning():
    bad = ACME_CSS.replace("--text-primary: #1b1b1b;", "--text-primary: #e0e0e0;")
    with pytest.raises(packs.PackError, match="contrast"):
        packs.validate(acme_files(**{"pack.css": bad}))
    weak = ACME_CSS.replace("--text-secondary: #3f3f3f;", "--text-secondary: #8a8a8a;")  # ~3.5:1 on white
    _meta, warnings = packs.validate(acme_files(**{"pack.css": weak}))
    assert any("text-secondary" in w and "below" in w for w in warnings)


def test_partial_packs_warn_about_tokens_left_at_defaults():
    _meta, warnings = packs.validate(acme_files(**{"pack.css": ":root { --action-primary-default: #c8102e; --action-primary-content: #ffffff; }"}))
    assert any("Chronos defaults" in w for w in warnings)
    assert any("dark" in w for w in warnings)


def test_a_zip_with_a_top_level_folder_and_binaries_is_read():
    files = acme_files()
    files["brand/logo.png"] = "\x89PNG"  # ignored (binary)
    data = _zip(files, folder="acme-pack/")
    read = packs.files_from_zip(data)
    assert set(read) == {"pack.json", "pack.css", "README.md", "brand/logo.svg"}
    with pytest.raises(packs.PackError, match="not a zip"):
        packs.files_from_zip(b"not a zip")
    with pytest.raises(packs.PackError, match="Unsafe"):
        packs.files_from_zip(_zip({"../pack.json": "{}"}))


# ── installing into an app ─────────────────────────────────────────────────

def test_install_adds_design_files_fonts_logo_and_css_order():
    meta, _ = packs.validate(acme_files())
    files = packs.install(template_service.get_default_template(), acme_files(), meta)
    assert set(p for p in files if p.startswith("src/design/")) == {"src/design/pack.json", "src/design/pack.css", "src/design/README.md", "src/design/brand/logo.svg"}
    css = files["src/index.css"]
    assert css.index("tokens.css") < css.index("design/pack.css") < css.index("'./design.css'")
    pack_css = files["src/design/pack.css"]
    assert "--font-sans: 'Inter', system-ui, sans-serif;" in pack_css
    assert "--radius-lg: 4px;" in pack_css
    assert "--action-primary-default: #c8102e" in pack_css
    assert "family=Inter" in files["index.html"] and "family=Space+Grotesk" in files["index.html"]
    assert "import logoUrl from './design/brand/logo.svg'; // AUTO_LOGO" in files["src/App.tsx"]
    assert "logoSrc={logoUrl}" in files["src/App.tsx"]


def test_dark_mode_pack_sets_the_document_theme():
    meta, _ = packs.validate(acme_files(meta={"mode": "dark"}))
    files = packs.install(template_service.get_default_template(), acme_files(meta={"mode": "dark"}), meta)
    assert 'data-theme="dark"' in files["index.html"]


def test_kit_upgrade_never_touches_the_design_folder():
    meta, _ = packs.validate(acme_files())
    files = packs.install(template_service.get_default_template(), acme_files(), meta)
    files["src/chronos/VERSION"] = "1"
    files["src/design/pack.css"] = "/* client edited */"
    changes = kit.outdated_kit_files(files)
    assert changes and all(p.startswith("src/chronos/") for p in changes)
    assert "src/design/pack.css" not in changes


def test_the_kit_reads_fonts_radius_and_logo_from_tokens_and_props():
    kit_files = kit.kit_files()
    tokens = kit_files["src/chronos/tokens.css"]
    assert "--font-sans:" in tokens and "--font-display:" in tokens and "--radius-lg:" in tokens
    assert "font-family: var(--font-sans" in tokens
    theme = json.loads(kit_files["src/chronos/theme.json"])
    assert theme["fontFamily"] == {"sans": "var(--font-sans)", "display": "var(--font-display)"}
    assert theme["borderRadius"]["lg"] == "var(--radius-lg)"
    assert "logoSrc" in kit_files["src/chronos/app-shell.tsx"]
    assert "font-family: 'Geist'" not in tokens.split("BASE (plain CSS")[1]


# ── storage and routes ─────────────────────────────────────────────────────

async def _login(app_client, db, name="org_a"):
    org = await organization_service.create_organization(db, workos_org_id=name, name=name)
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    return org.id


async def test_packs_are_listed_uploaded_defaulted_and_deleted_per_org(app_client, db):
    org_id = await _login(app_client, db)

    listed = (await app_client.get("/api/ai-ide/design-packs")).json()
    assert [p["id"] for p in listed["packs"]] == ["chronos"] and listed["default_id"] == "chronos"
    assert listed["packs"][0]["is_default"] and listed["packs"][0]["source"] == "builtin"

    resp = await app_client.post("/api/ai-ide/design-packs", files={"file": ("acme.zip", _zip(acme_files()), "application/zip")})
    assert resp.status_code == 200, resp.text
    assert resp.json()["pack"]["id"] == "acme" and resp.json()["pack"]["source"] == "org"

    bad = await app_client.post("/api/ai-ide/design-packs", files={"file": ("bad.zip", _zip({"pack.json": "{}"}), "application/zip")})
    assert bad.status_code == 422 and bad.json()["detail"].startswith("Design pack rejected:")

    resp = await app_client.post("/api/ai-ide/design-packs/acme/default")
    assert resp.json() == {"ok": True, "default_id": "acme"}
    listed = (await app_client.get("/api/ai-ide/design-packs")).json()
    assert listed["default_id"] == "acme" and {p["id"]: p["is_default"] for p in listed["packs"]} == {"chronos": False, "acme": True}

    # Another org sees neither the pack nor the default.
    other = await _login(app_client, db, name="org_b")
    listed = (await app_client.get("/api/ai-ide/design-packs")).json()
    assert [p["id"] for p in listed["packs"]] == ["chronos"] and listed["default_id"] == "chronos"
    assert (await app_client.delete("/api/ai-ide/design-packs/acme")).status_code == 404
    assert other != org_id

    # Back to the first org: delete clears the default.
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org_id))
    assert (await app_client.delete("/api/ai-ide/design-packs/chronos")).status_code == 404
    assert (await app_client.delete("/api/ai-ide/design-packs/acme")).json() == {"ok": True}
    listed = (await app_client.get("/api/ai-ide/design-packs")).json()
    assert listed["default_id"] == "chronos"


async def test_a_new_app_gets_the_org_default_pack_or_the_requested_one(app_client, db, tmp_path, monkeypatch):
    monkeypatch.setattr(ai_ide_service, "_ai_ide_root", tmp_path / "apps")
    org_id = await _login(app_client, db)
    await packs.save_org_pack(db, org_id, acme_files())
    await packs.set_org_default(db, org_id, "acme")

    created = (await app_client.post("/api/ai-ide/workspace/create")).json()
    assert created["pack_id"] == "acme"
    files = ai_ide_service.get_workspace_files(created["workspace_id"])
    assert "--action-primary-default: #c8102e" in files["src/design/pack.css"]
    assert files["src/design/brand/logo.svg"] == LOGO

    created = (await app_client.post("/api/ai-ide/workspace/create", json={"pack_id": "chronos"})).json()
    assert created["pack_id"] == "chronos"
    files = ai_ide_service.get_workspace_files(created["workspace_id"])
    assert "Chronos design pack" in files["src/design/pack.css"]

    missing = await app_client.post("/api/ai-ide/workspace/create", json={"pack_id": "nope"})
    assert missing.status_code == 404


# ── Chakram wears the pack ────────────────────────────────────────────────

def test_theme_variables_carry_only_what_the_pack_sets():
    meta, _ = packs.validate(acme_files())
    theme = packs.theme_variables(acme_files(), meta)
    assert theme["id"] == "acme" and theme["mode"] == "light"
    assert theme["fonts"] == [ACME_META["fonts"]["sans"]["url"], ACME_META["fonts"]["display"]["url"]]
    assert theme["light"]["font-sans"] == "'Inter', system-ui, sans-serif" and theme["light"]["radius-lg"] == "4px"
    assert theme["light"]["action-primary-default"] == "#c8102e" and theme["dark"]["surface-page-background"] == "#121212"
    assert "surface-raised" not in theme["dark"]  # the pack's dark block left it alone
    # The builtin pack overrides nothing beyond its fonts and radius.
    chronos_meta, _ = packs.validate(packs.builtin_packs()["chronos"])
    chronos = packs.theme_variables(packs.builtin_packs()["chronos"], chronos_meta)
    assert set(chronos["light"]) == {"font-sans", "font-display", "radius-lg"} and chronos["dark"] == {}


def test_chakrams_own_tokens_consume_every_name_a_pack_can_set():
    """A pack overrides the kit's semantic names; Chakram's stylesheets must read those same names
    (directly or through its bridge aliases) or the pack would restyle apps but not Chakram."""
    import re
    from pathlib import Path

    styles = Path(__file__).resolve().parents[2] / "frontend" / "src" / "styles"
    chakram_css = "\n".join(p.read_text(encoding="utf-8") for p in sorted(styles.glob("*.css")))
    chakram_css += (styles.parent / "index.css").read_text(encoding="utf-8")
    defined = set(re.findall(r"--([a-zA-Z0-9-]+)\s*:", chakram_css))
    consumed = set(re.findall(r"var\(--([a-zA-Z0-9-]+)", chakram_css))
    settable = set(packs._semantic_names(packs._kit_defaults())) | {"font-sans", "font-display", "radius-lg"}
    missing = sorted(n for n in settable if n not in defined and n not in consumed)
    assert not missing, f"pack tokens Chakram neither defines nor reads: {missing}"
    # Light is the default document (a pack's :root block is light), dark is the .dark class.
    tokens = (styles / "imcc-tokens.css").read_text(encoding="utf-8")
    assert tokens.index(":root {") < tokens.index(".dark {")
    assert ":root.light" not in tokens


async def test_the_org_theme_follows_the_default_pack(app_client, db):
    org_id = await _login(app_client, db)
    theme = (await app_client.get("/api/orgs/current/design-pack")).json()
    assert theme["id"] == "chronos" and theme["dark"] == {} and "action-primary-default" not in theme["light"]
    await packs.save_org_pack(db, org_id, acme_files())
    await packs.set_org_default(db, org_id, "acme")
    theme = (await app_client.get("/api/orgs/current/design-pack")).json()
    assert theme["id"] == "acme" and theme["light"]["action-primary-default"] == "#c8102e"
    assert theme["fonts"][0].startswith("https://fonts.googleapis.com/")
    await _login(app_client, db, name="org_b")
    assert (await app_client.get("/api/orgs/current/design-pack")).json()["id"] == "chronos"
