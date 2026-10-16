import type { TooltipProps } from "recharts";
import { Mark } from "@/components/Mark";
import { EmptyState } from "@/components/EmptyState";
import { TestTubes, XCircle, TrendingUp, AlertTriangle, Clock, Target, ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useDashboardStats } from "@/hooks/use-dashboard";
import { PROJECTS_QUERY_KEY, api, type DashboardActivityItem, type Project } from "@/lib/api";
import { stageLabel, stageTone } from "@/lib/project-stages";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { ChartTooltipBox, DashboardKpi, DashboardPanel } from "@/components/dashboard/DashboardUi";
import { DataTable, type DataTableColumn } from "@/components/imcc/DataTable";
import { KpiStat } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";

/* Chart colours are CSS variables so they follow the theme. Colour is used only
   for pass / fail; everything else is an ink ramp. */
const PASS = "var(--color-status-success)";
const FAIL = "var(--color-status-critical)";
const AXIS = "hsl(var(--ink-tertiary))";
const GRID = "var(--color-stroke-muted)";
const SURFACE = "var(--color-container)";
const INK_RAMP = [
  "hsl(var(--ink) / 0.9)",
  "hsl(var(--ink) / 0.68)",
  "hsl(var(--ink) / 0.5)",
  "hsl(var(--ink) / 0.34)",
  "hsl(var(--ink) / 0.2)",
];

const SEVERITY_TONE: Record<string, StatusTone> = {
  Critical: "critical",
  High: "warning",
  Medium: "info",
  Low: "neutral",
};

const WORKFLOW = [
  { step: 1, mark: "mark-requirements" as const, title: "Submit requirement", desc: "Describe a feature in plain language.", url: "/requirements" },
  { step: 2, mark: "mark-test-suite" as const, title: "Review test suite", desc: "Check and edit the generated cases by category.", url: "/generated-tests" },
  { step: 3, mark: "mark-test-execution" as const, title: "Execute tests", desc: "Run the suite in a browser against your app.", url: "/test-execution" },
  { step: 4, mark: "mark-risk-ranking" as const, title: "Risk ranking", desc: "See cases ranked by failure history and severity.", url: "/prioritization" },
];

/** The five most recently updated projects with their Verify and Release stages; one line to App Studio when there are none. */
function ProjectsPanel({ projects, isError }: { projects: Project[] | undefined; isError: boolean }) {
  const recent = [...(projects ?? [])]
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, 5);
  return (
    <DashboardPanel
      title="Projects"
      noPadding
      badge={
        <Link to="/projects" className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary hover:text-ink">
          View all <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {recent.length === 0 ? (
        <p className="px-4 py-3 text-xs text-ink-tertiary">
          {isError ? "Projects could not be loaded." : "No projects yet."}{" "}
          <Link to="/ai-ide" className="font-medium text-ink-secondary hover:text-ink hover:underline">
            Build one in App Studio
          </Link>{" "}
          or import a repository from <Link to="/projects" className="font-medium text-ink-secondary hover:text-ink hover:underline">Projects</Link>.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {recent.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2">
              <Link to={`/projects/${encodeURIComponent(p.id)}`} className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:underline" title={p.name}>
                {p.name}
              </Link>
              <StatusBadge tone={stageTone(p.stages?.verify?.status)} title={`Verify: ${p.stages?.verify?.detail ?? ""}`}>
                {stageLabel(p.stages?.verify?.status)}
              </StatusBadge>
              <StatusBadge tone={stageTone(p.stages?.release?.status)} title={`Release: ${p.stages?.release?.detail ?? ""}`}>
                {stageLabel(p.stages?.release?.status)}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}

/** "Tue 13 Oct" from the ISO date the API sends; the bare weekday if the date is missing. */
function formatTrendDay(iso: unknown, fallback: unknown): string {
  if (typeof iso === "string") {
    const d = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    }
  }
  return typeof fallback === "string" ? fallback : "";
}

function WeeklyTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <ChartTooltipBox
      label={formatTrendDay(payload[0]?.payload?.date, label)}
      rows={payload.map((p) => ({
        name: p.name === "passed" ? "Passed" : "Failed",
        value: p.value ?? 0,
        color: p.name === "passed" ? PASS : FAIL,
      }))}
    />
  );
}

function CategoryTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <ChartTooltipBox rows={[{ name: String(p.name), value: p.value ?? 0, color: String(p.payload?.fill ?? INK_RAMP[2]) }]} />
  );
}

const ACTIVITY_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  PASS: { label: "Passed", tone: "success" },
  SKIP: { label: "Skipped", tone: "neutral" },
};
const activityStatus = (t: DashboardActivityItem) => ACTIVITY_STATUS[t.status] ?? { label: "Failed", tone: "critical" as StatusTone };

const ACTIVITY_COLUMNS: DataTableColumn<DashboardActivityItem>[] = [
  {
    id: "test",
    header: "Test",
    grow: true,
    cell: (t) => (
      <>
        <span className="block truncate text-ink">{t.name}</span>
        <span className="block truncate font-mono text-xs text-ink-tertiary">{t.id}</span>
      </>
    ),
    title: (t) => t.name,
    sortValue: (t) => t.name,
  },
  {
    id: "when",
    header: "When",
    align: "right",
    className: "text-xs text-ink-tertiary",
    cell: (t) => t.time_ago,
    sortValue: (t) => (t.timestamp ? new Date(t.timestamp) : null),
  },
  {
    id: "status",
    header: "Status",
    width: "w-24",
    cell: (t) => (
      <StatusBadge tone={activityStatus(t).tone} className="w-[64px] justify-center">
        {activityStatus(t).label}
      </StatusBadge>
    ),
    sortValue: (t) => activityStatus(t).label,
  },
];

const NONE = "–";

const Dashboard = () => {
  const navigate = useNavigate();
  const { data: stats, isError, isLoading } = useDashboardStats();

  // A figure the API did not return is shown as a dash, never as a zero.
  const hasRun = !!stats?.latest_run?.run_id;
  const totalTests = stats?.total_tests ?? 0;
  const count = (value: number | undefined) => (stats && value != null ? value : NONE);
  const fromRun = (value: string | number) => (hasRun ? value : NONE);
  // The latest run has no rate or average when every case in it was skipped.
  const latestRate = stats?.latest_run?.success_rate;
  const latestAvg = stats?.latest_run?.avg_duration;

  const kpis = [
    { mark: "mark-test-suite" as const, label: "Total test cases", value: count(stats?.total_tests), icon: TestTubes, accent: "primary" as const },
    { mark: "mark-kpi-pass-rate" as const, label: "Pass rate (latest run)", value: latestRate != null ? fromRun(`${latestRate}%`) : NONE, icon: TrendingUp, accent: "success" as const },
    { mark: "mark-kpi-failed" as const, label: "Failed (latest run)", value: fromRun(stats?.latest_run?.failed ?? NONE), icon: XCircle, accent: "destructive" as const },
    { mark: "mark-kpi-duration" as const, label: "Avg. execution time", value: latestAvg != null ? fromRun(`${latestAvg.toFixed(1)}s`) : NONE, icon: Clock, accent: "warning" as const },
    { mark: "mark-kpi-known-failure" as const, label: "Known failures", value: count(stats?.known_failures), icon: AlertTriangle, accent: "destructive" as const },
    { mark: "mark-kpi-high-priority" as const, label: "High priority items", value: count(stats?.high_priority), icon: Target, accent: "warning" as const },
  ];

  const weeklyTrend = stats?.weekly_trend ?? [];
  const hasWeeklyResults = weeklyTrend.some((d) => d.passed > 0 || d.failed > 0);

  const counts = stats?.test_case_counts ?? {};
  const categoryData = Object.entries(counts).map(([name, value], i) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value,
    fill: INK_RAMP[i % INK_RAMP.length],
  }));
  const categoryTotal = categoryData.reduce((s, c) => s + c.value, 0);

  const coverageData = categoryData.map((c) => ({
    name: c.name,
    value: categoryTotal ? Math.round((c.value / categoryTotal) * 100) : 0,
  }));

  const severityBreakdown = stats?.severity_breakdown ?? [];
  const totalSeverity = severityBreakdown.reduce((s, b) => s + b.count, 0);

  const recentActivity = stats?.recent_activity ?? [];

  const platformMetrics = [
    { mark: "mark-requirements" as const, label: "Test cases generated", value: count(stats?.total_tests) },
    { mark: "mark-synthetic-data" as const, label: "Synthetic datasets", value: count(stats?.synthetic_datasets) },
    { mark: "mark-risk-ranking" as const, label: "High-priority cases", value: count(stats?.high_priority) },
  ];

  const projects = useQuery({ queryKey: PROJECTS_QUERY_KEY, queryFn: api.listProjects });

  if (isLoading) {
    return (
      <PageShell className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-ink-tertiary">Loading dashboard…</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Dashboard"
        description={
          totalTests === 0 && !isError
            ? "No test data yet. Start with a requirement to generate a suite."
            : "Generated test cases, the latest run and ranking signals for this workspace."
        }
      />

      {isError && <p className="text-sm text-destructive">Could not load dashboard stats. Start the backend and refresh.</p>}

      <ProjectsPanel projects={projects.data} isError={projects.isError} />

      <DashboardPanel title="Guided workflow" subtitle="Four steps from requirement to ranked results" noPadding>
        <ol className="grid sm:grid-cols-2 xl:grid-cols-4">
          {WORKFLOW.map((s) => (
            <li key={s.step} className="border-b border-border/60 last:border-b-0 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-r xl:last:border-r-0">
              <Link to={s.url} className="group flex h-full flex-col gap-1 px-4 py-3 transition-colors hover:bg-raised">
                <Mark id={s.mark} size={40} className="mb-1" />
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-xs tabular-nums text-ink-quaternary">{s.step}</span>
                  <span className="text-sm font-medium text-ink">{s.title}</span>
                </span>
                <span className="text-xs text-ink-tertiary">{s.desc}</span>
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-ink-secondary group-hover:text-ink">
                  Open <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </DashboardPanel>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <DashboardKpi key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <DashboardPanel
          className="lg:col-span-3"
          title="Weekly execution trend"
          subtitle="Passed and failed results, last 7 days"
        >
          {!hasWeeklyResults ? (
            <p className="flex h-[280px] items-center justify-center text-center text-sm text-ink-tertiary">
              No test results in the last 7 days.
            </p>
          ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              {/* Stacked daily bars: one active day is as readable as seven. */}
              <BarChart data={weeklyTrend} margin={{ top: 12, right: 12, left: -8, bottom: 4 }} barCategoryGap="28%">
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: AXIS, fontSize: 11 }} width={36} allowDecimals={false} />
                <Tooltip content={<WeeklyTooltip />} cursor={{ fill: "hsl(var(--ink) / 0.05)" }} />
                <Bar dataKey="passed" name="passed" stackId="results" fill={PASS} maxBarSize={44} isAnimationActive={false} />
                <Bar dataKey="failed" name="failed" stackId="results" fill={FAIL} maxBarSize={44} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          )}
          <div className="mt-4 flex gap-6 border-t border-border/60 pt-3 text-xs text-ink-secondary">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PASS }} /> Passed
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: FAIL }} /> Failed
            </span>
          </div>
        </DashboardPanel>

        <DashboardPanel className="lg:col-span-2" title="Category mix" subtitle="Test cases by category" noPadding>
          <div className="relative h-[200px] px-4 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={82}
                  paddingAngle={2}
                  dataKey="value"
                  stroke={SURFACE}
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {categoryData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={<CategoryTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-4">
              <span className="font-display text-[22px] leading-tight tabular-nums text-ink">{categoryTotal}</span>
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Total</span>
            </div>
          </div>
          <ul className="mt-3 border-t border-border/60">
            {categoryData.map((c) => (
              <li key={c.name} className="flex items-center gap-2.5 border-b border-border/60 px-4 py-2.5 text-sm last:border-b-0">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.fill }} />
                <span className="min-w-0 flex-1 truncate text-ink-secondary">{c.name}</span>
                <span className="tabular-nums text-ink">{c.value}</span>
                <span className="w-10 text-right text-xs tabular-nums text-ink-tertiary">
                  {categoryTotal ? Math.round((c.value / categoryTotal) * 100) : 0}%
                </span>
              </li>
            ))}
            {categoryData.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-tertiary">No test cases yet.</li>}
          </ul>
        </DashboardPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardPanel title="Severity distribution" subtitle={`${totalSeverity} test cases`} noPadding>
          {severityBreakdown.length === 0 && (
            <EmptyState kind="noRequirements" compact>No test cases yet.</EmptyState>
          )}
          <ul>
            {severityBreakdown.map((s) => (
              <li key={s.severity} className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0">
                <StatusBadge tone={SEVERITY_TONE[s.severity] ?? "neutral"} className="w-[68px] justify-center">
                  {s.severity}
                </StatusBadge>
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-raised-2">
                  <span
                    className="block h-full rounded-full bg-ink-tertiary"
                    style={{ width: `${totalSeverity ? (s.count / totalSeverity) * 100 : 0}%` }}
                  />
                </span>
                <span className="w-10 text-right text-sm tabular-nums text-ink">{s.count}</span>
              </li>
            ))}
          </ul>
        </DashboardPanel>

        <DashboardPanel title="Suite mix" subtitle="Share of test cases by category" noPadding>
          {coverageData.length === 0 ? (
            <EmptyState kind="noRequirements" compact>No test cases yet.</EmptyState>
          ) : (
            <ul>
              {coverageData.map((c) => (
                <li key={c.name} className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0">
                  <span className="w-24 shrink-0 truncate text-sm text-ink-secondary">{c.name}</span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-raised-2">
                    <span className="block h-full rounded-full bg-ink-tertiary" style={{ width: `${c.value}%` }} />
                  </span>
                  <span className="w-10 text-right text-sm tabular-nums text-ink">{c.value}%</span>
                </li>
              ))}
            </ul>
          )}
        </DashboardPanel>

        <DashboardPanel title="Recent activity" subtitle="Latest test results" noPadding>
          <DataTable
            bare
            columns={ACTIVITY_COLUMNS}
            rows={recentActivity}
            rowKey={(t) => `${t.id}:${t.timestamp}`}
            onRowClick={() => navigate("/test-execution")}
            empty="No executions yet. Run a suite from Test Execution to see results here."
            pageSize={10}
          />
        </DashboardPanel>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {platformMetrics.map((m) => (
          <KpiStat key={m.label} mark={m.mark} label={m.label} value={m.value} />
        ))}
      </div>
    </PageShell>
  );
};

export default Dashboard;
