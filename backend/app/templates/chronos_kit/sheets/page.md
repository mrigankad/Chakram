# Chronos kit: page cheat sheet

Import from '../chronos' (pages live in src/pages/). Every component accepts className. Enum props accept only the listed values and fall back to the default; array props that are not arrays act as []; formatters return "—" for null/NaN. Panel, KpiTile, Chart and DataTable each sit in an error boundary, so a bad section never blanks the page.

## Page skeleton
```tsx
import { PageHeader, PageBody, KpiGrid, KpiTile, Grid, SplitRow, Panel, DataTable, StatusBadge, usd, usdCompact, count, percent, shortDate, Mark } from '../chronos';
import type { Column } from '../chronos';
export default function Overview() {
  return (
    <PageBody>
      <PageHeader title="Overview" description="..." mark={<Mark id="mark-command" size={44} />} actions={<button className="rounded-full bg-action-primary px-3 py-1.5 text-label-sm text-on-color">New</button>} />
      <KpiGrid>…KpiTiles…</KpiGrid>
      <SplitRow ratio="1.4/1">…two panels…</SplitRow>
      <Panel title="Recent" padded={false} className="flex h-[420px] min-h-0 flex-col"><DataTable … /></Panel>
    </PageBody>
  );
}
```

## Layout
- `PageHeader({ title; description?; mark?; actions?; children? })`, `PageBody({ children })` (scrolls).
- `KpiGrid` for any row of KpiTiles. `Grid({ min? = "18rem"; gap? })` for card collections. `SplitRow({ ratio?: "1.4/1"|"1/1.4"|"1.6/1"|"1/2"; from?: "md"|"lg"|"xl" })` for two-up; stacks below `from`.
- Never a bare `grid-cols-N` without `sm:`/`lg:` prefixes; never fixed pixel widths on content. Long text gets `truncate` or `line-clamp-2`.

## Containers and figures
- `Panel({ title?; action?; padded? = true; children })` white bordered card, uppercase caption title.
- `KpiTile({ label; value: string|number; delta?; hint?; mark?; tone?: "neutral"|"success"|"info"|"warning"|"error" })`. Pass short pre-formatted values (`usdCompact(1284920)` → "$1.28M").
- `EmptyState({ title; detail?; mark? })`. `BarList({ rows: { id; label; value }[]; onSelect?; selectedId?; formatValue? })`.
- `Chart({ type: "line"|"area"|"bar"|"pie"|"donut"; data; x; series: { key; name? }[]; height? = 240; format?: "number"|"currency"|"percent" })` for a quick chart; `percent` takes fractions. Richer charts: see the charts sheet when one is listed for this page.
- `InfoPopover({ label; children })` for long how-to copy beside a title.

## Status
- `StatusBadge({ children; tone?: "success"|"info"|"neutral"|"warning"|"error" })` pill. `StatusDot({ tone? })` for dense rows. `PriorityBadge({ priority: "critical"|"high"|"medium"|"low" })`.
- Status colour always comes with a label or icon.

## Tables and filters
- `DataTable<T>({ rows; columns: Column<T>[]; rowKey(row): string; onRowClick?; searchable? = true; defaultSort?: { key; dir }; pageSize? = 40; selectable?; exportable? = true; toolbar?; loading?; emptyTitle?; emptyDetail? })` search, sort, paging, CSV export; becomes cards under 720px. Put it inside `<Panel padded={false} className="flex h-[420px] min-h-0 flex-col">` so it has a height.
- `Column<T> = { key; header; render(row): ReactNode; value?(row): string|number|boolean|null; width?; align?: "left"|"right"; hide?: "md"|"lg" }`. Give `value` to enable sort/search/export; add `tabular` to number columns.
- `FilterChips({ options: { id; label; count? }[]; value; onChange(id) })`.

## Controls and icons
- `Select({ value; onValueChange(v); options: { value; label }[]; placeholder?; size?: "md"|"sm"; "aria-label"? })` custom listbox.
- Buttons are plain `<button>`: primary `rounded-full bg-action-primary px-3 py-1.5 text-label-sm text-on-color hover:bg-action-primary-hover`, secondary `rounded-full border border-muted bg-action px-3 py-1.5 text-label-sm text-primary hover:bg-raised`. Inputs: `rounded-lg border border-muted bg-container px-3 py-2 text-body-md text-primary placeholder:text-quaternary focus-visible:ring-2 ring-active`.
- Icons: lucide-react, `size={14}` to `17`, `strokeWidth={1.75}`, colour from a `text-*` class. `Mark({ id; size? = 40 })` decorative 3D image; never a heading replacement.

## Formatting
`usd(n, { cents? })`, `usdCompact(n)`, `count(n)`, `percent(fraction, places = 1)`, `signedPercent(pct)`, `relativeTime(iso)`, `shortDate(iso)`.

## Classes (semantic only; never palette classes, hex, rgb(), gradients, shadows, opacity modifiers on token colours)
- Surfaces `bg-page` `bg-container` `bg-raised` `bg-raised-2` `bg-action` `bg-action-primary` (+ `text-on-color`).
- Text `text-primary` `text-secondary` `text-tertiary` `text-quaternary` `text-on-color`. Strokes `border-muted` (default) `border-default` (hover) `border-active`; focus `focus-visible:ring-2 ring-active`.
- Feedback `text-success|info|warning|error`, `bg-success-surface` `border-success-stroke` `bg-success-badge text-badge` (same for info, neutral, warning, error). Series `bg-series-1`…`bg-series-6`.
- Type: `text-display-page` (page title), `text-display-xl`/`text-display-2xl` (figures), `text-heading-lg|md|sm`, `text-body-lg|md|sm`, `text-label-md|sm`, `text-caption` (+ `uppercase tracking-[0.08em]` for captions). `font-display` only on page titles and metric figures. `tabular` on numbers.
- Shapes: cards `rounded-lg`, pills and buttons `rounded-full`, 1px `border-muted`.
