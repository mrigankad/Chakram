"""The kit reference given to the model must describe the kit that ships.

Drift here is silent: the model is told about a component or a value that does
not exist, the generated page fails to compile, and nobody sees why.
"""
import json
import re

from app.engines import kit
from app.services import template_service

KIT_EXPORTS = set(kit.kit_exports())

# `Name(` in a backticked signature, e.g. `KpiTile({ label; ... })`.
_SIGNATURE = re.compile(r"`([A-Z][A-Za-z0-9]+)(?:<T[^>]*>)?\(")
# Camel-case helpers such as `usdCompact(n)` and `markUrl(id)`.
_HELPER = re.compile(r"`([a-z][A-Za-z0-9]+)\(")


# CSS functions mentioned in prose, not kit helpers.
_CSS_WORDS = {"rgb", "repeat", "minmax", "min", "max", "var", "url", "calc"}


def _documented_names(text: str) -> set[str]:
    return set(_SIGNATURE.findall(text)) | (set(_HELPER.findall(text)) - _CSS_WORDS)


def test_kit_exports_are_discovered():
    for name in ("AppShell", "PageHeader", "PageBody", "KpiTile", "DataTable", "Select", "LineChart", "DonutChart", "usd", "cx"):
        assert name in KIT_EXPORTS, name


def test_every_name_in_the_full_reference_exists_in_the_kit():
    text = kit.kit_api()
    assert text, "KIT_API.md is missing"
    missing = sorted(n for n in _documented_names(text) if n not in KIT_EXPORTS)
    assert not missing, f"KIT_API.md documents names the kit does not export: {missing}"


def test_every_name_in_each_sheet_exists_in_the_kit():
    for role in kit.SHEET_ROLES:
        text = kit.kit_sheet(role)
        assert text, f"sheet {role} is missing"
        missing = sorted(n for n in _documented_names(text) if n not in KIT_EXPORTS)
        assert not missing, f"sheet {role} documents names the kit does not export: {missing}"


def test_reference_version_matches_the_kit_version():
    version = kit.kit_version(kit.kit_files())
    match = re.search(r"Kit version: `src/chronos/VERSION` \((\d+)\)", kit.kit_api())
    assert match and int(match.group(1)) == version, "KIT_API.md states a different kit version than src/chronos/VERSION"


def test_series_tokens_documented_match_tokens_css():
    tokens = kit.kit_files()["src/chronos/tokens.css"]
    series = {int(n) for n in re.findall(r"--analytics-series-(\d+)", tokens)}
    text = kit.kit_api() + kit.kit_sheet("charts")
    documented = {int(n) for n in re.findall(r"series-(\d+)", text)}
    assert documented <= series, f"documented chart series {sorted(documented - series)} are not defined in tokens.css"


def test_sheets_are_much_smaller_than_the_full_reference():
    full = len(kit.kit_api())
    assert len(kit.kit_sheet("page")) < full * 0.5
    assert len(kit.kit_sheet("data")) < 1200
    assert len(kit.kit_sheet("component")) < 1200


def test_template_package_json_is_rendered_from_the_single_dependency_list():
    package = json.loads(template_service.get_default_template()["package.json"])
    assert package["dependencies"] == template_service.TEMPLATE_DEPENDENCIES


def test_preview_runtime_pins_the_same_versions_as_the_template():
    runtime = (kit.KIT_ROOT.parent.parent.parent.parent / "frontend" / "src" / "components" / "ai-ide" / "preview-runtime.js")
    text = runtime.read_text(encoding="utf-8")
    block = re.search(r"var PINNED = \{(.*?)\};", text, re.DOTALL)
    assert block, "PINNED map not found in preview-runtime.js"
    pinned = dict(re.findall(r'"([^"]+)":\s*"([^"]+)"', block.group(1)))
    expected = {name: spec.lstrip("^~") for name, spec in template_service.TEMPLATE_DEPENDENCIES.items() if name not in ("react", "react-dom")}
    react = re.search(r'var REACT_VERSION = "([^"]+)"', text)
    assert react and react.group(1) == template_service.TEMPLATE_DEPENDENCIES["react"].lstrip("^~")
    assert pinned == expected, "preview-runtime.js PINNED drifted from TEMPLATE_DEPENDENCIES"
