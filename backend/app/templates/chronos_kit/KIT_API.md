# Chronos kit: API for page authors

Target: Vite + React 18 + TypeScript + Tailwind 3.4 + react-router-dom 6 + recharts 2.15 + lucide-react.
Kit version: `src/chronos/VERSION` (8).

Setup the host app must do once: `src/index.css` imports `./chronos/tokens.css` (then `./design.css`) and `src/main.tsx` wraps the app in `BrowserRouter`. `tailwind.config.js` needs `content: ["./src/**/*.{ts,tsx}"]` and `theme: { extend: <contents of src/chronos/theme.json> }`.

## Import

From a page in `src/pages/`: `import { Panel, KpiTile, PageHeader, PageBody, DataTable, Chart, usd } from '../chronos';`

Every component accepts className; your classes override the component's defaults.

## Robustness

- Every enum prop accepts ONLY the values listed below. Any other value falls back to the default shown; it never crashes.
- Array props that are not arrays are treated as `[]`. Rows that are null or not objects are skipped.
- Panel, KpiTile, Chart, DataTable and AppShell content sit in `SectionBoundary`. A render error shows an inline "This section could not be shown." box and logs to the console; the rest of the page keeps rendering.
- Formatters return "—" for null, undefined, NaN or an invalid date. They never print "NaN" or throw.

## Layout and shell

- `AppShell({ appName: string; logoMark?: string; nav: { to: string; label: string; icon?: string }[]; children })` - sidebar + top bar. `icon` is a lucide name (`"LayoutDashboard"`); unknown names show `Circle`. Items without a `to` are skipped. Wrap the routes in it, inside `BrowserRouter`.
- `PageHeader({ title; description?; info?; mark?; actions?; children? })` - title row, optional description, right-side actions, optional second row (chips).
- `PageBody({ children })` - scrolling body container under PageHeader.
- `KpiGrid({ children?; className? })` - row of KpiTiles; columns fit the width (min 13.5rem each). Use for any row of KpiTiles.
- `Grid({ children?; min? = "18rem"; gap? = "1rem"; className? })` - card/panel collection, `repeat(auto-fit, minmax(min(100%, min), 1fr))`. `min` and `gap` are CSS lengths (`"240px"`, `"20rem"`); invalid values fall back to the defaults.
- `InfoPopover({ label: string; children })` - "i" button beside a title; holds long how-to copy.
- `SplitRow({ children; from?: "md"|"lg"|"xl"|"2xl" = "lg"; ratio?: "1.4/1"|"1/1.4"|"1.6/1"|"1/2" = "1.4/1"; className? })` - two-up layout, stacks below `from`. Only these `from` and `ratio` values are valid; any other value uses the defaults.
- `SectionBoundary({ children; label?: string })` - error box for one section. Use it around any widget you build yourself that could fail on bad data.

## Containers and figures

- `Panel({ title?: string; action?; children; className?; padded? = true })` - white bordered card with an uppercase caption title.
- `KpiTile({ label: string; value: string | number; delta?: string | number; hint?: string; mark?; tone?: "neutral"|"success"|"info"|"warning"|"error" = "neutral" })` - metric card, Michroma figure. A number `value` is formatted with `count()`; a string is shown as given. The figure shrinks to the tile width (container query), so long values stay inside. Only these `tone` values are valid.
- `EmptyState({ title; detail?; mark? })` - centred empty message.
- `BarList({ rows: { id; label; value: number }[]; onSelect?(id); selectedId?; formatValue?(n) })` - monochrome horizontal breakdown. A non-numeric `value` counts as 0.
- `Chart({ type: "line"|"area"|"bar"|"pie"|"donut" = "bar"; data: Record<string, unknown>[]; x: string; series: { key: string; name? }[]; height? = 240; format?: "number"|"currency"|"percent" })` - recharts. Only these `type` values are valid; any other draws a bar chart. If `series` is empty, the numeric keys of the first row are used. `format` is only "number", "currency" or "percent" (other values mean "number"). `percent` expects fractions (0.42 = 42%).

## Layout & sizing rules

- Use `KpiGrid` for any row of KpiTiles, `Grid` for card or panel collections, `SplitRow` for two-up.
- Never write a fixed `grid-cols-N` without `sm:`/`lg:` prefixes. Never use fixed pixel widths on content.
- Pass KPI values pre-formatted and short (e.g. `usdCompact` for large money: "$1.28M", not "$1,284,920").
- Long text gets `truncate` (one line) or `line-clamp-2` (two lines). Do not let it set a width.

## Status

- `StatusBadge({ children; tone?: "success"|"info"|"neutral"|"warning"|"error" = "neutral" })` - solid pill. Only these tones are valid; others render neutral.
- `StatusDot({ tone?: "success"|"info"|"neutral"|"warning"|"error" })` - 6px dot for dense rows.
- `PriorityBadge({ priority: "critical"|"high"|"medium"|"low" })` - maps to error/warning/info/neutral. Other values render neutral.

## Tables and filters

- `DataTable<T>({ rows: T[]; columns: Column<T>[]; rowKey(row): string; onRowClick?(row); isRowSelected?(row); emptyTitle?; emptyDetail?; searchable? = true; searchPlaceholder?; getSearchText?(row); defaultSort?: { key: string; dir: "asc"|"desc" }; pageSize? = 40 (0 = no paging); selectable?; selectedKeys?; onSelectedKeysChange?(Set<string>); exportable? = true; exportName? = "queue"; toolbar?; loading?; serial? = true; reorderable? = true })` - search, sort, paging, CSV export, column drag. Becomes stacked cards when its own box is narrower than 720px. Give it a container with a defined height (e.g. inside `Panel` with `padded={false}`). A missing or duplicate `rowKey` falls back to the row index.
- `Column<T> = { key: string; header: string; render(row): ReactNode; value?(row): string | number | boolean | null; width?: string; align?: "left"|"right" = "left"; hide?: "md"|"lg"; card?: boolean | "title" | "metric" }` - `value` enables sort, search and CSV export. A missing `render` shows the row's `key` value as text. `hide` only accepts "md" or "lg".
- `FilterChips({ options: { id: string; label: string; count?: number }[]; value: string; onChange(id) })` - pill filter row.

## Controls and icons

- `Select({ value?; defaultValue?; onChange?(e); onValueChange?(value); options?: { value; label; disabled? }[]; placeholder?; disabled?; name? (hidden input); id?; "aria-label"?; size? = "md" | "sm"; className? (applies to the trigger, `w-*` also sizes the wrapper); children? <option>/<optgroup> })` - custom dropdown (listbox, keyboard, typeahead, flips above when no room); `onChange` gets `e.target.value`.
- `InlineArrow({ className? })` - small chevron for flows.
- `Mark({ id: string; size? = 40; className? })` - decorative 3D image from `/marks/<id>.png`. Alt is empty; never replace a heading with it. An empty or invalid id (letters, digits, `_`, `-`, `.` only) renders nothing.
- `markUrl(id)` - the image URL (override base with `VITE_MARKS_BASE`).

## Formatting (`format.ts`)

`usd(n, { cents? })` ($1,204), `usdCompact(n)` ($1.84M), `count(n)` (1,204), `percent(fraction, places = 1)` (42.0%), `signedPercent(pct, places = 1)` (+4.2%), `relativeTime(iso, now?)` (3h ago), `shortDate(iso)` (YYYY-MM-DD, UTC).

Every formatter returns "—" for null, undefined, NaN or an invalid date. Numeric strings such as "42" are accepted. `places` must be an integer 0-10.

## Tailwind classes

Surfaces: `bg-page` (grey canvas), `bg-container` (white cards, menus), `bg-raised` (hover, selected row), `bg-raised-2` (pressed/hover chip), `bg-action` (controls at rest), `bg-action-primary` (primary/active fill, pair with `text-on-color`).

Text: `text-primary` (titles, values), `text-secondary` (body), `text-tertiary` (descriptions, inactive nav), `text-quaternary` (captions, column labels), `text-on-color` (on solid fills).

Strokes: `border-muted` (default 1px divider/card edge), `border-default` (hover), `border-active` (strong), `ring-active` (focus ring with `focus-visible:ring-2`).

Feedback: `text-success|info|warning|error` (tinted text), `bg-success-badge` + `text-badge` (solid pill), `bg-success-surface` (tinted background), `border-success-stroke`, `text-success-icon`. Same pattern for info, neutral, warning, error.

Series (charts): `bg-series-1` ... `bg-series-6`, `text-series-1`.

Type: `font-display` (Michroma: page titles and metric figures only), `font-sans` (Geist, default). Scale: `text-display-page` (34px page title), `text-display-xl` / `text-display-2xl` (panel titles, KPI figures), `text-display-metric` (40px) and `text-display-metric-xl` (56px) for hero figures, `text-heading-lg|md|sm`, `text-body-lg|md|sm` (sm is 12px), `text-label-md|sm` (controls, weight 500), `text-caption` (12px, use with `uppercase tracking-[0.08em]` for panel labels). Add `tabular` to any number column. Plain-CSS utilities: `tabular`, `icon-primary|secondary|tertiary|quaternary|on-color`.

## Style rules

- Light is the default. Dark is `data-theme="dark"` on `<html>`, toggled by AppShell. Never hard-code a theme.
- Structure: grey page, white bordered containers, 1px `border-muted`, `rounded-lg` (8px) cards, `rounded-full` pills and buttons.
- No gradients, glassmorphism, or decorative shadows. `shadow-lg` only on floating menus and popovers.
- Michroma is only for page titles and metric figures. All other text is Geist.
- Use semantic classes only. Never palette classes (`bg-blue-500`, `text-gray-700`), hex, or `rgb()` in components.
- No opacity modifiers on semantic colours (`bg-container/50`): they do not apply to token colours.
- Status colour must come with a label or icon, never colour alone.
- Categories with no status meaning use one colour (BarList, `bg-quaternary` fills).
- Panels and tables fill their parent: give the parent a height (`flex h-full min-h-0`), and let `PageBody` scroll.
- Icons are lucide-react, `size` 12-17, `strokeWidth={1.75}`, inheriting `currentColor` from a `text-*` class.
- No `"use client"`, no `next/*`. Use `Link` and `NavLink` from react-router-dom. No `cn` helper: build class strings with template literals or arrays.

## Charts (import from the same '../chronos')

Charts are re-exported from `'../chronos'`; `'../chronos/charts'` also works.
Shared: `tone` is `series-1`..`series-6`, `positive`, `negative`, `warning`, `error`, `neutral`; unknown tones fall back to a series colour by position. `format` is `"number" | "currency" | "percent"` (percent takes fractions: 0.42 = 42%). Helpers: `toneColor`, `formatChartValue(value, format?, mode?)`; types `ChartTone`, `ChartValueFormat`. Every component accepts `className`, never throws on bad input (non-array data is empty, NaN is a gap or 0), and renders loading, error (with Retry) and empty states.

## Signatures

- `ChartFrame({ ariaLabel; height?; loading?; error?; onRetry?; empty?; emptyMessage?; responsive?; overlay?; table?; children?; className? })`
- `Legend({ items: { key; label; color }[]; className? })`
- `TooltipContent({ title?; entries: { key; label; color; value }[]; className? })`
- `HiddenDataTable({ caption; headers: string[]; rows: unknown[][] })`
- `CartesianChart<T>({ data: T[]; x: keyof T & string; series: { key; name?; tone?; mark?: "line"|"area"|"bar" }[]; height? = 240; format?; referenceLines?: { y?; x?; label?; tone? }[]; showLegend?; loading?; error?; onRetry?; emptyMessage?; ariaLabel?; defaultMark?; orientation?: "vertical"|"horizontal"; stacked?; className? })`
- `LineChart<T>(props)`: same props as CartesianChart, without `defaultMark`.
- `AreaChart<T>(props)`: same props, gradient-filled areas.
- `BarChart<T>(props)`: same props; `orientation="horizontal"` and `stacked` are the useful ones.
- `ComboChart<T>(props)`: first series is a bar, the rest lines, unless a series sets `mark`.
- `DonutChart({ data: { id; label; value; tone? }[]; centerValue?; centerLabel?; height? = 240; showLegend? = true; legendPosition?: "bottom"|"right"; format?; loading?; error?; onRetry?; emptyMessage?; ariaLabel?; className? })`
- `Sparkline({ data: (number | null)[]; tone?; height? = 32; showArea?; showLastPoint? = true; ariaLabel?; decorative?; className? })`
- `Gauge({ value; min? = 0; max? = 100; tone?; thresholds?: { value; tone }[]; size?: "sm"|"md"|"lg"; label?; format?; unit?; ariaLabel?; className? })`
- `ProgressRing({ value; max? = 100; tone?; size?: "sm"|"md"|"lg"; label?; className? })`
- `ProgressBars({ entries: { id; label; value; max?; tone?; valueLabel? }[]; className? })`
- `FunnelChart({ stages: { id; label; value }[]; format?; ariaLabel?; className? })`
- `BulletChart({ value; target; ranges?: [number, number, number]; label?; format?; ariaLabel?; className? })`
- `ChartCard({ title; description?; action?; footer?; children?; className? })`

## When to use

- `LineChart`: trends over an ordered axis such as dates or sprints.
- `AreaChart`: volume over time; stack only when the total means something.
- `BarChart`: magnitude across categories; horizontal when labels are long.
- `ComboChart`: two measures on shared axes, such as count bars with a rate line.
- `DonutChart`: share of a total with 6 or fewer slices; use bars beyond that.
- `Sparkline`: inside a KpiTile hint for a trend; `decorative` when the value is already labelled.
- `Gauge`: one bounded value against thresholds, such as utilisation; not for unbounded counts.
- `ProgressRing`: one checklist or completion percentage in a small grid.
- `ProgressBars`: several named progress values, such as sprint or quota completion.
- `FunnelChart`: stage conversion through an ordered process, such as a sign-up flow.
- `BulletChart`: one KPI against a target and qualitative bands; compact alternative to a gauge.
- `ChartCard`: the frame around any chart that needs a title, description or footer.
- `ChartFrame`: a custom visual that still needs the shared loading, error, empty and figure behaviour.
