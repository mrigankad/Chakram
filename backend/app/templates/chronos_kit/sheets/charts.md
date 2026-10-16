# Charts (import from '../chronos')

Shared: `tone` is `series-1`…`series-6`, `positive`, `negative`, `warning`, `error`, `neutral` (unknown tones fall back by position). `format` is `"number"|"currency"|"percent"` (percent takes fractions). Every chart accepts `className`, never throws on bad input, and renders loading, error (with Retry) and empty states.

- `LineChart<T>({ data: T[]; x: keyof T & string; series: { key; name?; tone? }[]; height? = 240; format?; referenceLines?: { y?; x?; label?; tone? }[]; showLegend?; ariaLabel? })` trends over dates or sprints.
- `AreaChart<T>(same)` volume over time; `stacked` only when the total means something.
- `BarChart<T>(same + orientation?: "vertical"|"horizontal"; stacked?)` magnitude across categories; horizontal when labels are long.
- `ComboChart<T>(same; series may set mark: "line"|"area"|"bar")` count bars with a rate line.
- `DonutChart({ data: { id; label; value; tone? }[]; centerValue?; centerLabel?; height? = 240; legendPosition?: "bottom"|"right"; format? })` share of a total, 6 slices or fewer.
- `Sparkline({ data: (number|null)[]; tone?; height? = 32; showArea?; decorative? })` inside a KpiTile hint.
- `Gauge({ value; min? = 0; max? = 100; tone?; thresholds?: { value; tone }[]; size?: "sm"|"md"|"lg"; label?; format?; unit? })` one bounded value against thresholds.
- `ProgressRing({ value; max? = 100; tone?; size?; label? })`, `ProgressBars({ entries: { id; label; value; max?; tone?; valueLabel? }[] })`.
- `FunnelChart({ stages: { id; label; value }[]; format? })` stage conversion. `BulletChart({ value; target; ranges?: [n, n, n]; label?; format? })` KPI vs target.
- `ChartCard({ title; description?; action?; footer?; children })` the frame for a chart that needs a title.
