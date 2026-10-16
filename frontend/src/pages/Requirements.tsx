import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAnalyzeRequirement } from "@/hooks/use-requirements";
import { useOrgConnectors } from "@/hooks/use-org-connectors";
import { configuredConnectors } from "@/lib/nav-config";
import { JiraImportDialog } from "@/components/requirements/JiraImportDialog";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Panel } from "@/components/imcc/Panel";

const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";

const Requirements = () => {
  const [requirement, setRequirement] = useState("");
  const [instructions, setInstructions] = useState("");
  const navigate = useNavigate();
  const analyzeMutation = useAnalyzeRequirement();
  const isAnalyzing = analyzeMutation.isPending;
  // Import from Jira shows only when the connector is configured (the same gate as the sidebar).
  const { data: connectors } = useOrgConnectors();
  const jiraConfigured = useMemo(() => configuredConnectors(connectors).has("jira"), [connectors]);
  const [importOpen, setImportOpen] = useState(false);

  const handleGenerate = async () => {
    if (!requirement.trim()) return;
    try {
      const result = await analyzeMutation.mutateAsync({ text: requirement, instructions });
      localStorage.setItem("lastRequirementId", result.id);
      navigate("/generated-tests");
    } catch {
      /* error shown via analyzeMutation.isError */
    }
  };

  const errorDetail = (analyzeMutation.error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data
    ?.detail;

  return (
    <PageShell size="lg">
      <PageHeader
        title="Requirements"
        description="Describe a requirement in plain language. The model returns a test suite grouped into functional, edge, API, failure and regression cases."
        actions={
          jiraConfigured ? (
            <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
              <Download className="h-4 w-4" />
              Import from Jira
            </Button>
          ) : undefined
        }
      />
      {jiraConfigured && <JiraImportDialog open={importOpen} onOpenChange={setImportOpen} />}

      <Panel>
        <div className="space-y-4">
          <div>
            <label htmlFor="req-text" className={fieldLabel}>
              Requirement
            </label>
            <Textarea
              id="req-text"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="Describe the feature, system behaviour or specification to test"
              className="min-h-[180px] resize-none text-sm"
              disabled={isAnalyzing}
            />
          </div>
          <div>
            <label htmlFor="req-guidance" className={fieldLabel}>
              Additional guidance <span className="font-normal text-ink-quaternary">(optional)</span>
            </label>
            <Textarea
              id="req-guidance"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Constraints or focus areas, e.g. API error handling and offline scenarios"
              className="min-h-[88px] resize-none text-sm"
              disabled={isAnalyzing}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <Button onClick={handleGenerate} disabled={!requirement.trim() || isAnalyzing} className="gap-2">
            {isAnalyzing && <Loader2 className="h-4 w-4 animate-spin" />}
            {isAnalyzing ? "Generating" : "Generate test suite"}
          </Button>
        </div>

        {isAnalyzing && (
          <p className="mt-3 text-sm text-ink-tertiary">
            Generating the test suite. The page opens the result when the model has answered.
          </p>
        )}
        {analyzeMutation.isError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {typeof errorDetail === "string" ? errorDetail : "Unable to reach the analysis service."}
          </p>
        )}
      </Panel>
    </PageShell>
  );
};

export default Requirements;
