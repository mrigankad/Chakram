import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { TestSuiteTabs } from "@/components/TestSuiteTabs";
import { PageCard } from "@/components/PageCard";
import { DataTable } from "@/components/imcc/DataTable";
import { KpiStat, Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { cn } from "@/lib/utils";
import {
  useTestSelectionHistory, useAnalyzeTestSelection,
  useExecuteTestSelection, useTestOptimizationReport,
} from "@/hooks/use-test-selection";
import { api, baselineApi } from "@/lib/api";

const PRIORITY_TONE: Record<string, StatusTone> = {
  critical: "critical",
  high: "warning",
  medium: "info",
  low: "neutral",
};

const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";
const optional = "font-normal text-ink-quaternary";

const GITHUB_REPO_URL = /^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+/i;

type BaselineCheck =
  | { status: "idle" | "checking" | "invalid" | "missing" | "error" }
  | { status: "found"; url: string; repoId: string };

export default function TestSelection() {
  const [githubUrl, setGithubUrl] = useState("");
  const [baseline, setBaseline] = useState<BaselineCheck>({ status: "idle" });
  const latestUrl = useRef("");
  const inFlight = useRef<{ url: string; promise: Promise<string | null> } | null>(null);
  const [oldSha, setOldSha] = useState("");
  const [newSha, setNewSha] = useState("");
  const [targetUrl, setTargetUrl] = useState("");

  const { data: history } = useTestSelectionHistory();
  const analyzeMutation = useAnalyzeTestSelection();
  const latestRun = analyzeMutation.data ?? history?.runs?.[0];
  const executeMutation = useExecuteTestSelection(latestRun?.id ?? "");
  const { data: optimization } = useTestOptimizationReport(
    baseline.status === "found" ? baseline.repoId : latestRun?.repo_id,
  );

  // Derives the baseline repo id from the URL and confirms a baseline exists for it.
  const resolveRepo = async (): Promise<string | null> => {
    const url = githubUrl.trim();
    if (!url) return null;
    if (baseline.status === "found" && baseline.url === url) return baseline.repoId;
    if (!GITHUB_REPO_URL.test(url)) {
      setBaseline({ status: "invalid" });
      return null;
    }
    // Blur and the Analyze click can both land here for the same URL; share one lookup.
    if (inFlight.current?.url === url) return inFlight.current.promise;
    latestUrl.current = url;
    setBaseline({ status: "checking" });
    const promise = (async () => {
      try {
        const repoId = await api.getRepoId(url);
        await baselineApi.getRepoTests(repoId);
        if (latestUrl.current === url) setBaseline({ status: "found", url, repoId });
        return repoId;
      } catch (err: any) {
        if (latestUrl.current === url) {
          setBaseline({ status: err?.response?.status === 404 ? "missing" : "error" });
        }
        return null;
      } finally {
        if (inFlight.current?.url === url) inFlight.current = null;
      }
    })();
    inFlight.current = { url, promise };
    return promise;
  };

  const handleAnalyze = async () => {
    const url = githubUrl.trim();
    const repoId = await resolveRepo();
    if (!repoId) return;
    analyzeMutation.mutate({ repoId, githubUrl: url, oldSha: oldSha || undefined, newSha: newSha || undefined });
  };

  return (
    <PageShell>
      <PageHeader
        title="Test Selection"
        description="Changed files are matched to baseline tests that reference the same file or the same directory. Each match is explained, and only the selected tests run."
      />
      <TestSuiteTabs />

      <Panel>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <label htmlFor="selection-repo" className={fieldLabel}>
              GitHub repository URL
            </label>
            <Input
              id="selection-repo"
              placeholder="https://github.com/owner/repo"
              value={githubUrl}
              onChange={(e) => {
                setGithubUrl(e.target.value);
                latestUrl.current = "";
                setBaseline({ status: "idle" });
              }}
              onBlur={() => void resolveRepo()}
            />
          </div>
          <div>
            <label htmlFor="selection-old-sha" className={fieldLabel}>
              Old commit SHA <span className={optional}>(optional)</span>
            </label>
            <Input id="selection-old-sha" className="font-mono text-xs" value={oldSha} onChange={(e) => setOldSha(e.target.value)} />
          </div>
          <div>
            <label htmlFor="selection-new-sha" className={fieldLabel}>
              New commit SHA <span className={optional}>(optional)</span>
            </label>
            <Input id="selection-new-sha" className="font-mono text-xs" value={newSha} onChange={(e) => setNewSha(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            {baseline.status === "found" && <p className="text-xs text-ink-tertiary">A test baseline exists for this repository.</p>}
            {baseline.status === "invalid" && (
              <p className="text-destructive">Enter a GitHub repository URL like https://github.com/owner/repo.</p>
            )}
            {baseline.status === "missing" && (
              <p className="text-destructive">
                No test baseline exists for this repository yet. Scan it on the{" "}
                <Link to="/repo-baseline" className="underline underline-offset-2">Test Baseline</Link> page, then analyse again.
              </p>
            )}
            {baseline.status === "error" && (
              <p className="text-destructive">Could not check the baseline for this repository. Try again.</p>
            )}
            {analyzeMutation.isError && (
              <p className="text-destructive">Could not analyse this repo/commit range. Check the repository URL and commit SHAs.</p>
            )}
          </div>
          <Button disabled={!githubUrl.trim() || analyzeMutation.isPending} onClick={() => void handleAnalyze()}>
            {analyzeMutation.isPending ? "Analysing…" : baseline.status === "checking" ? "Checking baseline…" : "Analyse"}
          </Button>
        </div>
      </Panel>

      {latestRun && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiStat mark="mark-test-suite" label="Total tests" value={latestRun.summary.total_tests} />
            <KpiStat mark="mark-test-selection" label="Selected" value={latestRun.summary.selected_tests} />
            <KpiStat mark="mark-kpi-skipped" label="Skipped" value={latestRun.summary.skipped_tests} />
            <KpiStat mark="mark-kpi-duration"
              label="Estimated savings"
              value={latestRun.summary.estimated_savings_pct != null ? `${latestRun.summary.estimated_savings_pct}%` : "–"}
              hint={latestRun.summary.estimated_savings_pct != null ? undefined : "not available"}
            />
          </div>

          {!latestRun.diff_available && (
            <Panel>
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge tone="warning">Full suite selected</StatusBadge>
                <p className="min-w-0 flex-1 text-sm text-ink-secondary">
                  No commit diff was available (missing SHAs, or this is the first scan), so every test was selected as a safe fallback.
                </p>
              </div>
            </Panel>
          )}

          <PageCard
            title="Selected tests"
            actions={
              <>
                <Input
                  placeholder="Target app URL to run against"
                  aria-label="Target app URL"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  className="h-8 w-64 text-xs"
                />
                <Button size="sm" disabled={!targetUrl || executeMutation.isPending} onClick={() => executeMutation.mutate(targetUrl)}>
                  {executeMutation.isPending ? "Starting…" : "Execute selected"}
                </Button>
              </>
            }
            padding={false}
          >
            {executeMutation.isSuccess && (
              <p className="border-b border-border/60 px-4 py-2.5 text-xs text-ink-secondary">
                Execution started ({executeMutation.data.test_count} tests, run{" "}
                <span className="font-mono">{executeMutation.data.run_id.slice(0, 8)}</span>). Check Live Test Run for progress.
              </p>
            )}
            {executeMutation.isError && (
              <p className="border-b border-border/60 px-4 py-2.5 text-xs text-destructive">Could not start execution.</p>
            )}
            <DataTable
              bare
              rows={latestRun.tests}
              rowKey={(t) => t.test_id}
              empty="No tests in this run."
              searchText={(t) => `${t.name} ${t.priority} ${t.reasons.map((r) => r.label).join(" ")}`}
              searchPlaceholder="Filter tests"
              pageSize={50}
              columns={[
                {
                  id: "test",
                  header: "Test and why it was matched",
                  wrap: true,
                  cell: (t) => (
                    <div className={cn(!t.selected && "opacity-60")}>
                      <p className="text-ink">{t.name}</p>
                      {t.reasons.length > 0 && (
                        <ul className="mt-1.5 space-y-1">
                          {t.reasons.map((r, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs">
                              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", r.matched ? "bg-status-success" : "bg-status-neutral")} />
                              <span className={r.matched ? "text-ink-secondary" : "text-ink-quaternary"}>{r.label}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ),
                  sortValue: (t) => t.name,
                },
                {
                  id: "selected",
                  header: "Selection",
                  width: "w-28",
                  className: "align-top text-xs",
                  cell: (t) => (t.selected ? "Selected" : <span className="text-ink-tertiary">Skipped</span>),
                  sortValue: (t) => t.selected,
                },
                {
                  id: "score",
                  header: "Score",
                  align: "right",
                  width: "w-24",
                  className: "align-top",
                  cell: (t) => (t.score == null ? "–" : t.score),
                  title: (t) => (t.score == null ? "Not scored: no diff was available" : undefined),
                  sortValue: (t) => t.score,
                },
                {
                  id: "priority",
                  header: "Priority",
                  width: "w-28",
                  className: "align-top",
                  cell: (t) =>
                    t.priority ? (
                      <StatusBadge tone={PRIORITY_TONE[t.priority] ?? "neutral"} className="capitalize">
                        {t.priority}
                      </StatusBadge>
                    ) : (
                      <span className="text-ink-tertiary">–</span>
                    ),
                  sortValue: (t) => (t.priority ? PRIORITY_RANK[t.priority] ?? 0 : null),
                },
              ]}
            />
          </PageCard>
        </>
      )}

      {optimization && (
        <PageCard
          title="Test suite optimization"
          actions={
            <span className="text-xs text-ink-secondary">
              Opportunity: <span className="font-medium capitalize text-ink">{optimization.optimization_opportunity}</span>
            </span>
          }
          padding={false}
        >
          <dl className="grid grid-cols-2 divide-x divide-border/60 border-b border-border/60 sm:grid-cols-4">
            {[
              { label: "Potential duplicates", value: optimization.potential_duplicates },
              { label: "Coverage gaps", value: optimization.coverage_gaps },
              { label: "Flaky tests", value: optimization.flaky_tests ?? "Not available" },
              { label: "Long-running tests", value: optimization.long_running_tests ?? "Not available" },
            ].map((item) => (
              <div key={item.label} className="px-4 py-3">
                <dt className={eyebrow}>{item.label}</dt>
                <dd className="mt-1.5 text-sm tabular-nums text-ink">{item.value}</dd>
              </div>
            ))}
          </dl>
          <ul>
            {optimization.findings.filter(f => f.available).map((f, i) => (
              <li key={i} className="border-b border-border/60 px-4 py-2.5 text-xs text-ink-secondary last:border-b-0">
                {f.description}
              </li>
            ))}
          </ul>
        </PageCard>
      )}
    </PageShell>
  );
}
