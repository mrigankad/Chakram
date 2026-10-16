import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { DataTable, FilterPills, type DataTableColumn } from "@/components/imcc/DataTable";
import { KpiStat, Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { useRunHistory, useRunSummary, useRunTests, useTestResults } from "@/hooks/use-test-execution";
import { api, type RunSummary, type TestResult } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";

const TARGET_KEY = "aidlc.execution.targetUrl";

type Filter = "all" | "FAIL" | "PASS" | "SKIP";

const STATUS: Record<TestResult["status"], { label: string; tone: StatusTone }> = {
  PASS: { label: "Passed", tone: "success" },
  FAIL: { label: "Failed", tone: "critical" },
  SKIP: { label: "Skipped", tone: "neutral" },
};

const RUN_STATUS: Record<RunSummary["status"], { label: string; tone: StatusTone }> = {
  running: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Did not finish", tone: "critical" },
};

const STEP_DOT: Record<string, string> = {
  pass: "bg-status-success",
  fail: "bg-status-critical",
  not_run: "bg-status-neutral",
};

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";

function readQuery(key: string): string {
  try {
    return new URLSearchParams(window.location.search).get(key) ?? "";
  } catch {
    return "";
  }
}

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function errorDetail(err: unknown): string {
  return apiErrorMessage(err, "The run could not be started.");
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0].trim();
}

function ResultDetail({ result }: { result: TestResult }) {
  return (
    <div className="space-y-3">
      {result.status === "SKIP" && (
        <p className="text-sm text-ink-secondary">
          <span className={cn(eyebrow, "mr-2")}>Not checked</span>
          {result.skip_reason}
        </p>
      )}

      {result.steps.length > 0 && (
        <ol className="space-y-1.5">
          {result.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", STEP_DOT[step.status] ?? STEP_DOT.not_run)} />
              <span className="w-20 shrink-0 font-mono text-xs leading-5 text-ink-quaternary">{step.action}</span>
              <span className="min-w-0">
                <span className={step.status === "not_run" ? "text-ink-quaternary" : "text-ink-secondary"}>
                  {step.description}
                </span>
                {step.error && (
                  <span className="mt-0.5 block whitespace-pre-wrap break-words font-mono text-xs text-destructive">{step.error}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}

      {result.status === "FAIL" && result.steps.length === 0 && result.error_message && (
        <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">{result.error_message}</p>
      )}

      {result.screenshot && (
        <figure>
          <figcaption className={cn(eyebrow, "mb-1.5")}>
            {result.status === "FAIL" ? "Browser at the failing step" : "Browser at the final step"}
          </figcaption>
          <img
            src={result.screenshot.startsWith("data:") ? result.screenshot : `data:image/jpeg;base64,${result.screenshot}`}
            alt={`Browser screenshot for ${result.tc_id}`}
            className="max-h-80 rounded-lg border border-border"
          />
        </figure>
      )}
    </div>
  );
}

/** What went wrong (or why it was skipped), cut to one line for the row. The full text is in the expanded detail. */
function resultNote(result: TestResult): string {
  if (result.status === "SKIP") return firstLine(result.skip_reason ?? "");
  if (result.status !== "FAIL") return "";
  const stepError = result.steps.find((step) => step.error)?.error;
  return firstLine(stepError ?? result.error_message ?? "");
}

const RESULT_COLUMNS: DataTableColumn<TestResult>[] = [
  { id: "id", header: "ID", mono: true, width: "w-24", cell: (r) => r.tc_id, sortValue: (r) => r.tc_id },
  { id: "name", header: "Test", grow: true, cell: (r) => <span className="text-ink">{r.name}</span>, title: (r) => r.name, sortValue: (r) => r.name },
  {
    id: "note",
    header: "Detail",
    hideBelow: "lg",
    cell: (r) => <span className="text-xs text-ink-tertiary">{resultNote(r)}</span>,
    title: (r) => resultNote(r) || undefined,
  },
  {
    id: "severity",
    header: "Severity",
    hideBelow: "sm",
    width: "w-28",
    cell: (r) => <span className="text-xs text-ink-tertiary">{r.severity ?? ""}</span>,
    sortValue: (r) => (r.severity ? (SEVERITY_RANK[r.severity.toLowerCase()] ?? 0) : null),
  },
  {
    id: "duration",
    header: "Duration",
    align: "right",
    mono: true,
    width: "w-24",
    cell: (r) => (r.status === "SKIP" ? "" : `${r.duration.toFixed(1)}s`),
    sortValue: (r) => (r.status === "SKIP" ? null : r.duration),
  },
  {
    id: "status",
    header: "Status",
    width: "w-28",
    cell: (r) => (
      <StatusBadge tone={STATUS[r.status].tone} className="w-[68px] justify-center">
        {STATUS[r.status].label}
      </StatusBadge>
    ),
    sortValue: (r) => STATUS[r.status].label,
  },
];

const RUN_COLUMNS: DataTableColumn<RunSummary>[] = [
  { id: "started", header: "Started", width: "w-40", cell: (r) => formatWhen(r.started_at), sortValue: (r) => new Date(r.started_at) },
  { id: "target", header: "Target URL", grow: true, mono: true, cell: (r) => r.target_url },
  { id: "passed", header: "Passed", align: "right", width: "w-24", cell: (r) => r.passed, sortValue: (r) => r.passed },
  { id: "failed", header: "Failed", align: "right", width: "w-24", cell: (r) => r.failed, sortValue: (r) => r.failed },
  { id: "skipped", header: "Skipped", align: "right", width: "w-24", cell: (r) => r.skipped, sortValue: (r) => r.skipped },
  {
    id: "status",
    header: "Status",
    width: "w-36",
    cell: (r) => <StatusBadge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</StatusBadge>,
    sortValue: (r) => RUN_STATUS[r.status].label,
  },
];

const TestExecution = () => {
  const requirementsQuery = useQuery({ queryKey: ["requirements"], queryFn: api.listRequirements });
  const requirements = useMemo(
    () => (requirementsQuery.data ?? []).filter((r) => r.status === "processed"),
    [requirementsQuery.data],
  );

  // App Studio's "Test this app" opens this page with the requirement and the deployed URL.
  const [requirementId, setRequirementId] = useState(() => readQuery("requirement") || readStored("lastRequirementId"));
  const [targetUrl, setTargetUrl] = useState(() => readQuery("url") || readStored(TARGET_KEY));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [replan, setReplan] = useState(false);
  const [runId, setRunId] = useState<string>();
  const [filter, setFilter] = useState<Filter>("all");

  // Fall back to the newest requirement when the remembered one is gone.
  useEffect(() => {
    if (requirements.length && !requirements.some((r) => r.id === requirementId)) {
      setRequirementId(requirements[0].id);
    }
  }, [requirements, requirementId]);

  const runMutation = useRunTests();
  const historyQuery = useRunHistory(requirementId || undefined);
  const summaryQuery = useRunSummary(runId);
  const summary = summaryQuery.data;
  const running = summary?.status === "running";
  const resultsQuery = useTestResults(runId, running || !summary);
  const results = useMemo(() => resultsQuery.data ?? [], [resultsQuery.data]);

  // Open the latest run once per requirement; after that the user's choice stands.
  const autoSelectedFor = useRef<string>();
  useEffect(() => {
    if (!historyQuery.data || autoSelectedFor.current === requirementId) return;
    autoSelectedFor.current = requirementId;
    setRunId(historyQuery.data[0]?.run_id);
  }, [requirementId, historyQuery.data]);

  // A finished run changes the history counts and needs one last results fetch.
  // Risk Ranking and the Dashboard are computed from these results, so they are
  // marked stale too: the next visit shows this run without a manual refresh.
  const queryClient = useQueryClient();
  const refetchHistory = historyQuery.refetch;
  const refetchResults = resultsQuery.refetch;
  const runStatus = summary?.status;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (runStatus === "running") {
      wasRunning.current = true;
      return;
    }
    if (runStatus) {
      void refetchHistory();
      void refetchResults();
      if (wasRunning.current) {
        wasRunning.current = false;
        void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
        void queryClient.invalidateQueries({ queryKey: ["prioritized-tests"] });
      }
    }
  }, [runStatus, runId, refetchHistory, refetchResults, queryClient]);

  const canRun = !!requirementId && /^https?:\/\/\S+$/i.test(targetUrl.trim()) && !running && !runMutation.isPending;

  const handleRun = async (replanSkipped = false) => {
    try {
      localStorage.setItem(TARGET_KEY, targetUrl.trim());
    } catch {
      /* remembering the URL is a convenience only */
    }
    try {
      const started = await runMutation.mutateAsync({
        requirementId,
        targetUrl: targetUrl.trim(),
        username,
        password,
        replan: replanSkipped ? false : replan,
        replanSkipped,
      });
      setReplan(false);
      setFilter("all");
      setRunId(started.run_id);
    } catch {
      /* the message is rendered from runMutation.error below */
    }
  };

  const counts = { all: results.length, FAIL: 0, PASS: 0, SKIP: 0 };
  for (const r of results) counts[r.status] += 1;
  const visible = filter === "all" ? results : results.filter((r) => r.status === filter);
  const executed = (summary?.passed ?? 0) + (summary?.failed ?? 0);

  return (
    <PageShell>
      <PageHeader
        title="Test Execution"
        description="Runs each test case in a real browser against your app. A case that cannot be checked through the UI is skipped and says why; it is never counted as a pass."
      />

      <Panel className="bg-container">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="exec-requirement" className={fieldLabel}>
              Requirement
            </label>
            <select
              id="exec-requirement"
              value={requirementId}
              onChange={(e) => setRequirementId(e.target.value)}
              disabled={running || !requirements.length}
              className="h-10 w-full rounded-md border border-input bg-container px-3 text-sm text-ink disabled:opacity-60"
            >
              {!requirements.length && <option value="">No requirements yet</option>}
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.text.length > 90 ? `${r.text.slice(0, 90)}…` : r.text}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="exec-target" className={fieldLabel}>
              Target URL
            </label>
            <Input
              id="exec-target"
              type="url"
              placeholder="https://staging.example.com"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              disabled={running}
            />
          </div>
          <div>
            <label htmlFor="exec-user" className={fieldLabel}>
              Test account email <span className="font-normal text-ink-quaternary">(optional)</span>
            </label>
            <Input id="exec-user" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} disabled={running} />
          </div>
          <div>
            <label htmlFor="exec-pass" className={fieldLabel}>
              Test account password <span className="font-normal text-ink-quaternary">(optional)</span>
            </label>
            <Input
              id="exec-pass"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={running}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-xl space-y-2">
            <p className="text-xs text-ink-tertiary">
              Credentials are typed into the browser during the run. They are not stored and are not sent to the AI model.
            </p>
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={replan}
                onChange={(e) => setReplan(e.target.checked)}
                disabled={running}
                className="h-3.5 w-3.5 accent-current"
              />
              Plan the steps again instead of reusing the saved ones (use after the app's UI changes)
            </label>
          </div>
          <Button onClick={() => void handleRun()} disabled={!canRun} className="gap-2">
            {running || runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Running" : "Run tests"}
          </Button>
        </div>
        {runMutation.isError && <p className="mt-3 text-sm text-destructive">{errorDetail(runMutation.error)}</p>}
      </Panel>

      {summary && (
        <>
          <Panel className="bg-container" padded={false}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <StatusBadge tone={RUN_STATUS[summary.status].tone}>{RUN_STATUS[summary.status].label}</StatusBadge>
              <span className="min-w-0 truncate font-mono text-xs text-ink-secondary">{summary.target_url}</span>
              <span className="text-xs text-ink-tertiary">{formatWhen(summary.started_at)}</span>
              {summary.plans_reused + summary.plans_created > 0 && (
                <span className="text-xs text-ink-tertiary">
                  {summary.plans_reused} saved plans reused · {summary.plans_created} planned new
                </span>
              )}
              <span className="ml-auto text-xs tabular-nums text-ink-tertiary">
                {running ? `${summary.phase ?? "Working"} · ` : ""}
                {summary.completed} of {summary.total}
              </span>
            </div>
            {running && (
              <div className="h-0.5 bg-raised-2">
                <div
                  className="h-full bg-primary transition-[width] duration-500"
                  style={{ width: `${summary.total ? (summary.completed / summary.total) * 100 : 0}%` }}
                />
              </div>
            )}
            {summary.status === "failed" && summary.error && (
              <p className="border-t border-border/60 px-4 py-3 font-mono text-xs text-destructive">{summary.error}</p>
            )}
            {!running && summary.skipped > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
                <p className="max-w-2xl text-xs text-ink-tertiary">
                  {summary.skipped} {summary.skipped === 1 ? "case was" : "cases were"} skipped. A skip verdict is saved with
                  the plan and reused on later runs. If the app or the test account has changed since, plan those cases
                  again; cases that already run keep their saved steps.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => void handleRun(true)}
                  disabled={!canRun}
                  title={canRun ? undefined : "Select a requirement and enter the target URL first"}
                >
                  {runMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  Re-plan skipped cases
                </Button>
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiStat
              className="bg-container"
              mark="mark-kpi-pass-rate"
              label="Pass rate"
              value={executed && summary.success_rate != null ? `${summary.success_rate}%` : "–"}
              hint={`of ${executed} executed`}
            />
            <KpiStat className="bg-container" mark="mark-kpi-passed" label="Passed" value={summary.passed} />
            <KpiStat className="bg-container" mark="mark-kpi-failed" label="Failed" value={summary.failed} />
            <KpiStat className="bg-container" mark="mark-kpi-skipped" label="Skipped" value={summary.skipped} hint="not checkable in the UI" />
            <KpiStat className="bg-container" mark="mark-kpi-duration" label="Browser time" value={`${Math.round(summary.total_duration)}s`} />
          </div>

          <DataTable
            caption="Results"
            columns={RESULT_COLUMNS}
            rows={visible}
            rowKey={(r) => r.id}
            renderExpanded={(r) => <ResultDetail result={r} />}
            defaultExpanded={(r) => r.status === "FAIL"}
            searchText={(r) => `${r.tc_id} ${r.name} ${r.severity ?? ""}`}
            searchPlaceholder="Filter results"
            pageSize={50}
            empty={running ? "Results appear here as each test finishes." : "No results in this view."}
            toolbar={
              <FilterPills<Filter>
                label="Result status"
                value={filter}
                onChange={setFilter}
                options={(["all", "FAIL", "PASS", "SKIP"] as const).map((key) => ({
                  value: key,
                  label: key === "all" ? "All" : STATUS[key].label,
                  count: counts[key],
                }))}
              />
            }
          />
        </>
      )}

      {!summary && !summaryQuery.isLoading && (
        <Panel className="bg-container">
          <EmptyState kind="noRuns">
            {requirements.length ? (
              "Enter the URL of a running build and start a run. Nothing has been executed for this requirement yet."
            ) : requirementsQuery.isError ? (
              <span className="text-destructive">{apiErrorMessage(requirementsQuery.error, "Could not load requirements.")}</span>
            ) : requirementsQuery.isLoading ? (
              "Loading requirements…"
            ) : (
              <>
                Its generated test cases are what gets executed here.{" "}
                <Link to="/requirements" className="font-medium text-ink underline underline-offset-2 hover:no-underline">
                  Add a requirement
                </Link>{" "}
                first.
              </>
            )}
          </EmptyState>
        </Panel>
      )}

      {(historyQuery.data?.length ?? 0) > 1 && (
        <DataTable
          caption="Earlier runs"
          columns={RUN_COLUMNS}
          rows={historyQuery.data!}
          rowKey={(run) => run.run_id}
          onRowClick={(run) => setRunId(run.run_id)}
          isRowSelected={(run) => run.run_id === runId}
          pageSize={10}
        />
      )}
    </PageShell>
  );
};

export default TestExecution;
