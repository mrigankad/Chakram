# Data module rules

- A `.ts` module under src/data/: `export type`/`export interface` for every entity and `export const` arrays/objects of realistic, internally consistent mock rows. Small pure helpers (`export function totalRevenue(rows)`) are welcome.
- No JSX, no React import, no default export, no side effects, no network calls.
- Dates are ISO strings ("2026-03-14" or "2026-03-14T09:30:00Z"), money is a number in whole currency units, percentages are fractions (0.42 = 42%), statuses are string unions.
- Define every dataset the page blueprints mention, with the exact names pages will import. 8-30 rows per list, enough to make tables, charts and KPIs look real.
