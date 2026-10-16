import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/EmptyState";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { TestSuiteTabs } from "@/components/TestSuiteTabs";
import { PageCard } from "@/components/PageCard";
import { DataTable } from "@/components/imcc/DataTable";
import { KpiStat, Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { api, apiClient } from "@/lib/api";
import { toast } from "sonner";

type HealingSummary = {
  broken_tests: number;
  healed_successfully: number;
  pending_review: number;
  failed_healing: number;
  healing_success_rate: number | null;
};

type HealingListItem = {
  id: string;
  test_name: string;
  failure_type: string;
  original_selector: string | null;
  candidate_selector: string | null;
  confidence: number;
  confidence_label: string;
  status: string;
  created_at: string | null;
};

const STATUS_TONE: Record<string, StatusTone> = {
  pending: "pending",
  approved: "success",
  healed: "success",
  rejected: "neutral",
  failed: "critical",
};

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";

export default function SelfHealingTests() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["healing", "list"],
    queryFn: async () => {
      const { data: body } = await apiClient.get<{
        summary: HealingSummary;
        items: HealingListItem[];
      }>("/testing/healing");
      return body;
    },
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      action === "approve" ? api.approveHealing(id) : api.rejectHealing(id),
    onSuccess: (body) => {
      void queryClient.invalidateQueries({ queryKey: ["healing"] });
      toast.success(body.status === "approved" ? "Selector applied." : "Healing rejected.");
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not update healing attempt");
    },
  });

  return (
    <PageShell>
      <PageHeader
        title="Test Repair"
        description="When a selector breaks, Chakram scans the live page, proposes a replacement, and waits for your approval before writing anything back to the stored test."
      />
      <TestSuiteTabs />

      {isLoading && (
        <Panel>
          <EmptyState kind="loading">Loading healing attempts…</EmptyState>
        </Panel>
      )}
      {isError && (
        <Panel>
          <EmptyState kind="error" compact>
            Could not load healing attempts. Confirm the API is running and you are signed in.
          </EmptyState>
        </Panel>
      )}

      {data?.summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KpiStat mark="mark-kpi-known-failure" label="Broken" value={data.summary.broken_tests} />
          <KpiStat mark="mark-self-healing" label="Healed" value={data.summary.healed_successfully} />
          <KpiStat mark="mark-kpi-duration" label="Pending" value={data.summary.pending_review} />
          <KpiStat mark="mark-kpi-failed" label="Failed" value={data.summary.failed_healing} />
          <KpiStat mark="mark-kpi-pass-rate"
            label="Success rate"
            value={data.summary.healing_success_rate != null ? `${data.summary.healing_success_rate}%` : "–"}
          />
        </div>
      )}

      <PageCard title="Recent healing events" padding={false}>
        <DataTable<HealingListItem>
          bare
          loading={isLoading}
          rows={data?.items ?? []}
          rowKey={(item) => item.id}
          empty="No healing attempts yet. On a failed Live Test, open the result and click Heal selector."
          searchText={(item) => `${item.test_name} ${item.original_selector ?? ""} ${item.candidate_selector ?? ""} ${item.status}`}
          searchPlaceholder="Filter attempts"
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
              id: "original",
              header: "Original selector",
              mono: true,
              hideBelow: "md",
              cell: (item) => item.original_selector ?? "–",
            },
            {
              id: "candidate",
              header: "Candidate selector",
              mono: true,
              hideBelow: "sm",
              cell: (item) => item.candidate_selector ?? "–",
            },
            {
              id: "confidence",
              header: "Confidence",
              align: "right",
              width: "w-28",
              cell: (item) => `${item.confidence}%`,
              sortValue: (item) => item.confidence,
            },
            {
              id: "created",
              header: "Created",
              hideBelow: "lg",
              width: "w-44",
              cell: (item) => (item.created_at ? new Date(item.created_at).toLocaleString() : "–"),
              sortValue: (item) => (item.created_at ? new Date(item.created_at) : null),
            },
            {
              id: "status",
              header: "Status",
              width: "w-28",
              cell: (item) => (
                <StatusBadge tone={STATUS_TONE[item.status] ?? "neutral"} className="capitalize">
                  {item.status}
                </StatusBadge>
              ),
              sortValue: (item) => item.status,
            },
          ]}
          renderExpanded={(item) => (
            <div className="space-y-3">
              <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                {[
                  { label: "Failure", value: item.failure_type, mono: false },
                  { label: "Confidence", value: `${item.confidence}% (${item.confidence_label})`, mono: false },
                  { label: "Original selector", value: item.original_selector || "–", mono: true },
                  { label: "Candidate selector", value: item.candidate_selector || "–", mono: true },
                  ...(item.created_at ? [{ label: "Created", value: item.created_at, mono: false }] : []),
                ].map((row) => (
                  <div key={row.label} className="min-w-0">
                    <dt className={eyebrow}>{row.label}</dt>
                    <dd className={cn("mt-1 break-all text-ink-secondary", row.mono && "font-mono")}>{row.value}</dd>
                  </div>
                ))}
              </dl>
              {item.status === "pending" && item.candidate_selector && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: item.id, action: "approve" })}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: item.id, action: "reject" })}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          )}
        />
      </PageCard>
    </PageShell>
  );
}
