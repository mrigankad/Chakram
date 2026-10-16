# Shared component rules

- A `.tsx` file under src/components/: `export default function Name(props: Props)` with a typed `Props` interface; small, reusable, no page chrome (no PageHeader/PageBody/AppShell).
- Build from the kit: import `Panel`, `StatusBadge`, `KpiTile`, `DataTable`, `Select`, `EmptyState`, formatters and `cx` from '../chronos'. Style with the semantic classes only (`bg-container`, `text-primary`, `border-muted`, `text-label-sm`, `rounded-lg`, `rounded-full`); never palette classes, hex, gradients, shadows or framer-motion.
- Accept `className` and merge it with `cx(...)`. Handle empty/undefined inputs (render `EmptyState` or nothing), never throw.
- Icons: lucide-react, `size={14}`-`17`, `strokeWidth={1.75}`.
