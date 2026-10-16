import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Pencil, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useGroupedTestCases, useUpdateTestCase } from "@/hooks/use-test-cases";
import { useRequirements } from "@/hooks/use-requirements";
import { apiErrorMessage } from "@/lib/api-error";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { TestSuiteTabs } from "@/components/TestSuiteTabs";
import { DataTable } from "@/components/imcc/DataTable";
import { Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";

const SECTION_META = [
  { key: "functional", label: "Functional tests" },
  { key: "edge", label: "Edge cases" },
  { key: "api", label: "API validation" },
  { key: "failure", label: "Failure scenarios" },
  { key: "regression", label: "Regression tests" },
] as const;

const SEVERITY_TONE: Record<string, StatusTone> = {
  Critical: "critical",
  High: "warning",
  Medium: "info",
  Low: "neutral",
};

const SEVERITY_RANK: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const fieldLabel = "text-xs font-medium text-ink-secondary";

const GeneratedTests = () => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ functional: true });
  const [editingTest, setEditingTest] = useState<any | null>(null);
  const [requirementId, setRequirementId] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem("lastRequirementId") ?? undefined;
    } catch {
      return undefined;
    }
  });

  // The suite belongs to one requirement. The remembered one is used when it still
  // exists; otherwise the newest, so a new browser does not open on an empty page.
  const requirementsQuery = useRequirements();
  const requirements = useMemo(
    () => (requirementsQuery.data ?? []).filter((r) => r.status === "processed"),
    [requirementsQuery.data],
  );
  useEffect(() => {
    if (requirements.length && !requirements.some((r) => r.id === requirementId)) {
      setRequirementId(requirements[0].id);
    }
  }, [requirements, requirementId]);

  const selectRequirement = (id: string) => {
    setRequirementId(id);
    try {
      localStorage.setItem("lastRequirementId", id);
    } catch {
      /* remembering the choice is a convenience only */
    }
  };

  const { data, isLoading, isError, error } = useGroupedTestCases(requirementId);
  const updateMutation = useUpdateTestCase();

  const handleSaveEdit = async () => {
    if (!editingTest) return;
    try {
      await updateMutation.mutateAsync({
        // The hook's `tc_id` field is the path id; the API keys on the document id.
        tc_id: editingTest.id,
        payload: {
          name: editingTest.name,
          description: editingTest.description,
          expected: editingTest.expected,
          severity: editingTest.severity,
        },
      });
      toast.success(`${editingTest.tc_id} saved`);
      setEditingTest(null);
    } catch (e) {
      // The dialog stays open with the edits so they can be retried.
      toast.error(apiErrorMessage(e, "The test case could not be saved."));
    }
  };

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const grouped = data ?? null;
  const total = grouped ? Object.values(grouped).flat().length : 0;

  return (
    <PageShell>
      <PageHeader
        title="Test Suite"
        description={
          total > 0
            ? `${total} test ${total === 1 ? "case" : "cases"} generated from the selected requirement, grouped by category. Edit a case before running the suite.`
            : "Test cases generated from a requirement, grouped by category."
        }
        actions={
          <Button className="gap-2" onClick={() => navigate("/test-execution")} disabled={total === 0}>
            <Play className="h-4 w-4" />
            Run tests
          </Button>
        }
      />
      <TestSuiteTabs />

      {requirements.length > 1 && (
        <Panel>
          <label htmlFor="suite-requirement" className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Requirement
          </label>
          <select
            id="suite-requirement"
            value={requirementId ?? ""}
            onChange={(e) => selectRequirement(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-container px-3 text-sm text-ink"
          >
            {requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.text.length > 140 ? `${r.text.slice(0, 140)}…` : r.text}
              </option>
            ))}
          </select>
        </Panel>
      )}

      {isLoading && (
        <Panel>
          <EmptyState kind="loading">Loading test suite…</EmptyState>
        </Panel>
      )}

      {isError && (
        <Panel>
          <EmptyState kind="error">
            {apiErrorMessage(error, "Could not load the test suite.")}
          </EmptyState>
        </Panel>
      )}

      {!isLoading && !isError && total === 0 && (
        <Panel>
          <EmptyState kind="noRequirements">
            No generated tests for this workspace yet.{" "}
            <button
              type="button"
              className="text-ink underline underline-offset-2"
              onClick={() => navigate("/requirements")}
            >
              Submit a requirement
            </button>{" "}
            to create a suite.
          </EmptyState>
        </Panel>
      )}

      {!isLoading &&
        !isError &&
        total > 0 &&
        SECTION_META.map((section) => {
          const items = grouped?.[section.key] ?? [];
          const open = !!expanded[section.key];
          const Chevron = open ? ChevronDown : ChevronRight;
          return (
            <Panel key={section.key} padded={false} className="overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(section.key)}
                aria-expanded={open}
                className={`flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-raised ${
                  open ? "border-b border-stroke-muted" : ""
                }`}
              >
                <Chevron className="h-3.5 w-3.5 shrink-0 text-ink-quaternary" />
                <h2 className={eyebrow}>{section.label}</h2>
                <span className="text-xs tabular-nums text-ink-tertiary">{items.length}</span>
              </button>

              {open && (
                <DataTable
                  bare
                  rows={items}
                  rowKey={(tc) => tc.id}
                  empty="No cases in this category."
                  searchText={items.length > 20 ? (tc) => `${tc.tc_id} ${tc.name} ${tc.description} ${tc.expected} ${tc.severity}` : undefined}
                  searchPlaceholder="Filter cases"
                  pageSize={50}
                  columns={[
                    { id: "id", header: "Id", mono: true, width: "w-24", className: "align-top", cell: (tc) => tc.tc_id, sortValue: (tc) => tc.tc_id },
                    {
                      id: "case",
                      header: "Test case",
                      wrap: true,
                      cell: (tc) => (
                        <>
                          <p className="font-medium text-ink">{tc.name}</p>
                          <p className="mt-1">{tc.description}</p>
                          <p className="mt-1.5">
                            <span className={`${eyebrow} mr-2`}>Expected</span>
                            {tc.expected}
                          </p>
                        </>
                      ),
                      sortValue: (tc) => tc.name,
                    },
                    {
                      id: "severity",
                      header: "Severity",
                      width: "w-28",
                      className: "align-top",
                      cell: (tc) => <StatusBadge tone={SEVERITY_TONE[tc.severity] ?? "neutral"}>{tc.severity}</StatusBadge>,
                      sortValue: (tc) => SEVERITY_RANK[tc.severity] ?? 0,
                    },
                    {
                      id: "edit",
                      header: "",
                      label: "Edit",
                      align: "right",
                      width: "w-14",
                      className: "align-top",
                      cell: (tc) => (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="-my-1 h-8 w-8"
                          aria-label={`Edit ${tc.name}`}
                          onClick={() => setEditingTest(tc)}
                        >
                          <Pencil className="h-3.5 w-3.5 text-ink-tertiary" />
                        </Button>
                      ),
                    },
                  ]}
                />
              )}
            </Panel>
          );
        })}

      {/* Edit Dialog */}
      <Dialog open={!!editingTest} onOpenChange={(open) => !open && setEditingTest(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit test case</DialogTitle>
            <DialogDescription>Update the test case details and expected outcome below.</DialogDescription>
          </DialogHeader>
          {editingTest && (
            <div className="grid gap-4 py-4">
              <div className="grid gap-1.5">
                <label htmlFor="edit-tc-name" className={fieldLabel}>Name</label>
                <Input
                  id="edit-tc-name"
                  value={editingTest.name}
                  onChange={(e) => setEditingTest({ ...editingTest, name: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="edit-tc-severity" className={fieldLabel}>Severity</label>
                <select
                  id="edit-tc-severity"
                  className="h-10 w-full rounded-md border border-input bg-container px-3 text-sm text-ink"
                  value={editingTest.severity}
                  onChange={(e) => setEditingTest({ ...editingTest, severity: e.target.value })}
                >
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="edit-tc-description" className={fieldLabel}>Description</label>
                <Textarea
                  id="edit-tc-description"
                  value={editingTest.description}
                  onChange={(e) => setEditingTest({ ...editingTest, description: e.target.value })}
                  className="min-h-[100px]"
                />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="edit-tc-expected" className={fieldLabel}>Expected result</label>
                <Input
                  id="edit-tc-expected"
                  value={editingTest.expected}
                  onChange={(e) => setEditingTest({ ...editingTest, expected: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTest(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={updateMutation.isPending || !editingTest?.name?.trim()}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default GeneratedTests;
