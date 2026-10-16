"""Structural checks that catch broken generated files before they are saved."""
from app.engines import kit
from app.engines.verify import parse_imports, verify_file

KIT = set(kit.kit_exports())

GOOD_PAGE = """\
import { useState } from 'react';
import { PageHeader, PageBody, KpiGrid, KpiTile, DataTable, Mark } from '../chronos';
import type { Column } from '../chronos';
import { bookings, type Booking } from '../data/store';

export default function Overview() {
  const [q, setQ] = useState('');
  const columns: Column<Booking>[] = [{ key: 'guest', header: 'Guest', render: (r) => r.guest }];
  return (
    <PageBody>
      <PageHeader title="Overview" mark={<Mark id="mark-command" size={44} />} />
      <KpiGrid><KpiTile label="Bookings" value={bookings.length} /></KpiGrid>
      <DataTable rows={bookings.filter((b) => b.guest.includes(q))} columns={columns} rowKey={(r) => r.id} />
    </PageBody>
  );
}
"""

PLANNED = {"src/pages/Overview.tsx", "src/data/store.ts"}


def _verify(path, content, **kw):
    kw.setdefault("kit_exports", KIT)
    kw.setdefault("planned_files", PLANNED)
    kw.setdefault("workspace_files", set(kit.kit_files()))
    return verify_file(path, content, **kw)


def test_a_good_page_passes():
    result = _verify("src/pages/Overview.tsx", GOOD_PAGE, component_name="Overview")
    assert result.ok, result.problems


def test_truncated_file_is_rejected():
    result = _verify("src/pages/Overview.tsx", GOOD_PAGE[: GOOD_PAGE.index("<DataTable")])
    assert not result.ok
    assert any("truncated" in p for p in result.problems)


def test_unterminated_string_is_rejected():
    result = _verify("src/pages/A.tsx", "import x from 'react';\nexport default function A() { const s = \"oops; return null; }")
    assert any("unterminated string" in p for p in result.problems)


def test_markdown_fence_and_prose_are_rejected():
    assert any("fence" in p for p in _verify("src/pages/A.tsx", "```tsx\nexport default function A() {}\n```").problems)
    assert any("prose" in p for p in _verify("src/pages/A.tsx", "Here is the file:\nexport default function A() {}").problems)


def test_missing_or_wrong_default_export():
    assert any("export default" in p for p in _verify("src/pages/A.tsx", "import x from 'react';\nconst A = 1;").problems)
    result = _verify("src/pages/A.tsx", "import x from 'react';\nexport default function B() { return null; }", component_name="A")
    assert any("expected `A`" in p for p in result.problems)


def test_data_module_rules():
    assert _verify("src/data/store.ts", "export type R = { id: string };\nexport const rows: R[] = [{ id: '1' }];").ok
    assert any("default export" in p for p in _verify("src/data/store.ts", "export default [];").problems)
    assert any("JSX" in p for p in _verify("src/data/store.ts", "export const x = <Badge />;").problems)


def test_unknown_kit_export_and_forbidden_package_and_missing_local_file():
    text = (
        "import { motion } from 'framer-motion';\n"
        "import { PageBody, Carousel } from '../chronos';\n"
        "import { rows } from '../data/missing';\n"
        "export default function A() { return <PageBody /> }\n"
    )
    result = _verify("src/pages/A.tsx", text)
    joined = " ".join(result.problems)
    assert "framer-motion" in joined
    assert "Carousel" in joined
    assert "../data/missing" in joined


def test_page_importing_a_page_is_flagged():
    text = "import Other from './Other';\nimport { PageBody } from '../chronos';\nexport default function A() { return <PageBody><Other /></PageBody> }"
    result = _verify("src/pages/A.tsx", text, planned_files=PLANNED | {"src/pages/Other.tsx"})
    assert any("another page" in p for p in result.problems)


def test_brackets_inside_strings_templates_and_comments_do_not_count():
    text = (
        "import { PageBody } from '../chronos';\n"
        "// a comment with { and (\n"
        "/* block } */\n"
        "const s = '{[(';\n"
        "const t = `x ${1 + 1} ) ]`;\n"
        "const re = 'a}';\n"
        "export default function A() { return <PageBody>{'}'}</PageBody> }\n"
    )
    assert _verify("src/pages/A.tsx", text).ok


def test_parse_imports_shapes():
    text = "import React, { useState, type FC } from 'react';\nimport * as all from './x';\nimport './side';\nimport type { T } from '../t';"
    assert parse_imports(text) == [
        ("react", ["useState", "FC", "default"]),
        ("./x", ["*"]),
        ("./side", []),
        ("../t", ["T"]),
    ]
