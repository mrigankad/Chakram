import { useNavigate } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { TestSuiteTabs } from "@/components/TestSuiteTabs";
import { PageCard } from "@/components/PageCard";
import { DataTable } from "@/components/imcc/DataTable";
import { KpiStat, Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { useRootCauseList, useUnanalyzedFailures, useAnalyzeFailure } from "@/hooks/use-root-cause";

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

const firstLine = (text: string) => text.split(/\r?\n/, 1)[0].trim();

const SEVERITY_TONE: Record<string, StatusTone> = {
  critical: "critical",
  high: "warning",
  medium: "info",
  low: "neutral",
};

export default function RootCauseAnalysis() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useRootCauseList();
  const { data: failuresData, isLoading: failuresLoading } = useUnanalyzedFailures();
  const analyzeMutation = useAnalyzeFailure();

  const summary = data?.summary;

  return (
    <PageShell>
      <PageHeader
        title="Root Cause Analysis"
        description="For each failed test, the model reads the failure evidence and recent Git history and proposes what broke and which change likely caused it."
      />
      <TestSuiteTabs />

      {isLoading && (
        <Panel>
          <EmptyState kind="loading">Loading analyses…</EmptyState>
        </Panel>
      )}
      {isError && (
        <Panel>
          <EmptyState kind="error" compact>Could not load root cause analyses. Try again shortly.</EmptyState>
        </Panel>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KpiStat mark="mark-kpi-failed" label="Failures analysed" value={summary.total_failures} />
          <KpiStat mark="mark-root-cause" label="Root causes identified" value={summary.root_causes_identified} />
          <KpiStat mark="mark-kpi-passed" label="High confidence" value={summary.high_confidence} />
          <KpiStat mark="mark-empty-nothing-to-review" label="Needs human review" value={summary.requires_human_review} />
          <KpiStat mark="mark-incidents" label="Unresolved" value={summary.unresolved_failures} />
        </div>
      )}

      {/* Unanalyzed failures: pulled live from playwright_runs */}
      <PageCard
        title="Failures awaiting analysis"
        description="Failed results from recent Live Test Run executions that have not been analysed yet."
        padding={false}
      >
        <DataTable
          bare
          loading={failuresLoading}
          rows={failuresData?.failures ?? []}
          rowKey={(f) => `${f.run_id}-${f.test_id}`}
          empty="No unanalysed failures."
          searchText={(f) => `${f.test_name} ${f.error ?? ""}`}
          searchPlaceholder="Filter failures"
          pageSize={20}
          canExpand={(f) => !!f.error}
          renderExpanded={(f) => <pre className="whitespace-pre-wrap break-words font-mono text-xs text-ink-secondary">{f.error}</pre>}
          columns={[
            {
              id: "test",
              header: "Test",
              grow: true,
              cell: (f) => <span className="text-ink">{f.test_name}</span>,
              title: (f) => f.test_name,
              sortValue: (f) => f.test_name,
            },
            {
              id: "error",
              header: "Error",
              grow: true,
              mono: true,
              cell: (f) => <span className="text-ink-tertiary">{f.error ? firstLine(f.error) : "No error message captured"}</span>,
              title: (f) => (f.error ? firstLine(f.error) : undefined),
            },
            {
              id: "action",
              header: "",
              label: "Action",
              align: "right",
              width: "w-32",
              cell: (f) => (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={analyzeMutation.isPending}
                  onClick={() => analyzeMutation.mutate({ runId: f.run_id, testId: f.test_id })}
                >
                  {analyzeMutation.isPending ? "Analysing…" : "Analyse"}
                </Button>
              ),
            },
          ]}
        />
        {analyzeMutation.isError && (
          <p className="border-t border-border/60 px-4 py-2.5 text-xs text-destructive">Could not analyse this failure. Try again.</p>
        )}
      </PageCard>

      <PageCard title="Investigations" padding={false}>
        <DataTable
          bare
          loading={isLoading}
          rows={data?.items ?? []}
          rowKey={(item) => item.id}
          onRowClick={(item) => navigate(`/root-cause/${item.id}`)}
          empty="No investigations yet. Analyse a failure above to start one."
          searchText={(item) => `${item.test_name} ${item.repository ?? ""} ${item.failure_type} ${item.severity}`}
          searchPlaceholder="Filter investigations"
          pageSize={25}
          columns={[
            {
              id: "test",
              header: "Test",
              grow: true,
              cell: (item) => <span className="text-ink">{item.test_name}</span>,
              title: (item) => item.test_name,
              sortValue: (item) => item.test_name,
            },
            {
              id: "repository",
              header: "Repository",
              hideBelow: "md",
              cell: (item) => item.repository ?? "No repository",
              sortValue: (item) => item.repository,
            },
            {
              id: "type",
              header: "Failure type",
              hideBelow: "sm",
              cell: (item) => item.failure_type.replace(/_/g, " "),
              sortValue: (item) => item.failure_type,
            },
            {
              id: "confidence",
              header: "Confidence",
              align: "right",
              cell: (item) =>
                item.status === "completed" ? (
                  `${item.confidence}% (${item.confidence_label})`
                ) : item.status === "analyzing" ? (
                  <StatusBadge tone="pending">Analysing</StatusBadge>
                ) : (
                  <StatusBadge tone="critical">AI analysis failed</StatusBadge>
                ),
              sortValue: (item) => (item.status === "completed" ? item.confidence : null),
            },
            {
              id: "severity",
              header: "Severity",
              width: "w-28",
              cell: (item) => (
                <StatusBadge tone={SEVERITY_TONE[item.severity] ?? "neutral"} className="capitalize">
                  {item.severity}
                </StatusBadge>
              ),
              sortValue: (item) => SEVERITY_RANK[item.severity] ?? 0,
            },
          ]}
        />
      </PageCard>
    </PageShell>
  );
}
