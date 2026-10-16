import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-error";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { DataTable, type DataTableColumn } from "@/components/imcc/DataTable";
import { Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { cn } from "@/lib/utils";

// Takes a user story (from Jira or typed manually) and asks the model to:
//  • write BDD acceptance criteria (Given / When / Then scenarios)
//  • flag ambiguous terms that need clarification
//  • give the story a 0–100 risk score
//  • suggest test hints
// With Jira connected, the generated criteria can be posted back to the issue.

const PRIORITY_TONE: Record<string, StatusTone> = {
  Critical: "critical",
  Highest: "critical",
  High: "warning",
  Medium: "info",
  Low: "neutral",
  Lowest: "neutral",
};

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";
const pill = "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
const pillOn = "border-transparent bg-primary text-primary-foreground";
const pillOff = "border-border text-ink-secondary hover:bg-raised";

function riskTone(score: number): StatusTone {
  if (score >= 75) return "critical";
  if (score >= 50) return "warning";
  if (score >= 25) return "info";
  return "neutral";
}

const PRIORITY_RANK: Record<string, number> = { Critical: 6, Highest: 5, High: 4, Medium: 3, Low: 2, Lowest: 1 };

interface Story {
  key: string;
  summary: string;
  description?: string;
  status?: string;
  assignee?: string;
  priority?: string;
}

interface StoryAnalysis {
  risk_score?: number;
  risk_reasoning?: string;
  duplicate_of?: string;
  acceptance_criteria?: { scenario: string; given: string; when: string; then: string }[];
  ambiguity_flags?: { term: string; question: string }[];
  test_hints?: string[];
}

interface StoryItem {
  story: Story;
  ai_analysis?: StoryAnalysis | null;
}

/** The score the model returned, or null when it returned none. */
const riskOf = (item: StoryItem): number | null =>
  typeof item.ai_analysis?.risk_score === "number" ? item.ai_analysis.risk_score : null;

function PushToJiraButton({ item }: { item: StoryItem }) {
  const { story, ai_analysis } = item;

  const pushMutation = useMutation({
    mutationFn: () => {
      const acText = ai_analysis?.acceptance_criteria
        ?.map((ac, i) => `Scenario ${i + 1}: ${ac.scenario}\nGiven: ${ac.given}\nWhen: ${ac.when}\nThen: ${ac.then}`)
        .join("\n\n");
      return api.pushACToJira(story.key, acText || "");
    },
    onSuccess: () =>
      toast.success("Posted to Jira", { description: `Generated acceptance criteria added to ${story.key} as a comment.` }),
    onError: (err: unknown) =>
      toast.error("The comment was not added in Jira", {
        description: apiErrorMessage(err, "Check the Jira connection under Settings → Connectors."),
      }),
  });

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 text-xs"
      title="Adds the acceptance criteria as a comment on the Jira issue"
      onClick={() => pushMutation.mutate()}
      disabled={pushMutation.isPending}
    >
      {pushMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
      Push to Jira
    </Button>
  );
}

function StoryAnalysisDetail({ item }: { item: StoryItem }) {
  const { story, ai_analysis } = item;
  if (!ai_analysis) return <p className="text-xs text-ink-tertiary">AI analysis unavailable for this story.</p>;
  const criteria = ai_analysis.acceptance_criteria ?? [];
  const flags = ai_analysis.ambiguity_flags ?? [];
  const hints = ai_analysis.test_hints ?? [];

  return (
    <div className="space-y-4">
      {story.description && (
        <div>
          <p className={cn(eyebrow, "mb-1.5")}>Story description</p>
          <p className="text-sm text-ink-secondary">
            {story.description.slice(0, 300)}
            {story.description.length > 300 ? "…" : ""}
          </p>
        </div>
      )}

      {criteria.length > 0 && (
        <div>
          <p className={cn(eyebrow, "mb-1.5")}>Acceptance criteria ({criteria.length})</p>
          <div className="space-y-2">
            {criteria.map((ac, i) => (
              <div key={i} className="rounded-md bg-raised p-3 text-xs text-ink-secondary">
                <p className="mb-1 text-sm font-medium text-ink">{ac.scenario}</p>
                <p><span className="font-medium text-ink-tertiary">Given </span>{ac.given}</p>
                <p><span className="font-medium text-ink-tertiary">When </span>{ac.when}</p>
                <p><span className="font-medium text-ink-tertiary">Then </span>{ac.then}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {flags.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <p className={eyebrow}>Ambiguous terms</p>
            <StatusBadge tone="warning">{flags.length} to clarify</StatusBadge>
          </div>
          <ul className="space-y-1">
            {flags.map((f, i) => (
              <li key={i} className="text-xs">
                <span className="font-mono text-ink">"{f.term}"</span>
                <span className="text-ink-secondary"> {f.question}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ai_analysis.risk_reasoning && (
        <div>
          <p className={cn(eyebrow, "mb-1.5")}>Risk reasoning</p>
          <p className="text-xs text-ink-secondary">{ai_analysis.risk_reasoning}</p>
        </div>
      )}

      {hints.length > 0 && (
        <div>
          <p className={cn(eyebrow, "mb-1.5")}>Test hints</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink-secondary">
            {hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One analysed story on its own (the single-story tab). */
function StoryCard({ item }: { item: StoryItem }) {
  const [expanded, setExpanded] = useState(true);
  const { story, ai_analysis } = item;
  const risk = riskOf(item);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <Panel padded={false}>
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {story.key !== "MANUAL-1" && <span className="font-mono text-xs text-ink-tertiary">{story.key}</span>}
            {story.priority && <StatusBadge tone={PRIORITY_TONE[story.priority] ?? "neutral"}>{story.priority}</StatusBadge>}
            {risk !== null && <StatusBadge tone={riskTone(risk)}>Risk {risk}/100</StatusBadge>}
            {ai_analysis?.duplicate_of && <StatusBadge tone="neutral">Duplicate of {ai_analysis.duplicate_of}</StatusBadge>}
          </div>
          <p className="text-sm font-medium text-ink">{story.summary}</p>
          {story.key !== "MANUAL-1" && (
            <p className="mt-0.5 text-xs text-ink-tertiary">
              {story.status} · {story.assignee}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 shrink-0 p-0"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={() => setExpanded(!expanded)}
        >
          <Chevron className="h-4 w-4 text-ink-tertiary" />
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-border/60 px-4 py-4">
          <StoryAnalysisDetail item={item} />
        </div>
      )}
    </Panel>
  );
}

const STORY_COLUMNS: DataTableColumn<Story>[] = [
  { id: "key", header: "Key", mono: true, width: "w-28", cell: (st) => st.key, sortValue: (st) => st.key },
  { id: "story", header: "Story", grow: true, cell: (st) => <span className="font-medium text-ink">{st.summary}</span>, title: (st) => st.summary, sortValue: (st) => st.summary },
  { id: "status", header: "Status", hideBelow: "md", cell: (st) => st.status ?? "", sortValue: (st) => st.status },
  { id: "assignee", header: "Assignee", hideBelow: "lg", cell: (st) => st.assignee ?? "", sortValue: (st) => st.assignee },
  {
    id: "priority",
    header: "Priority",
    hideBelow: "sm",
    width: "w-28",
    cell: (st) => (st.priority ? <StatusBadge tone={PRIORITY_TONE[st.priority] ?? "neutral"}>{st.priority}</StatusBadge> : ""),
    sortValue: (st) => (st.priority ? (PRIORITY_RANK[st.priority] ?? 0) : null),
  },
];

type Tab = "jira" | "manual";

export default function RequirementsIntelligence() {
  const [tab, setTab] = useState<Tab>("manual");

  // Jira mode state: one story at a time (sprint-wide analysis was retired with Sprint Health).
  const [projectKey, setProjectKey] = useState("");
  const [loadedProject, setLoadedProject] = useState("");
  const [storyKey, setStoryKey] = useState<string | null>(null);

  // Manual mode state
  const [manualSummary, setManualSummary] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualPriority, setManualPriority] = useState("Medium");

  const storiesQuery = useQuery({
    queryKey: ["jira", "stories", loadedProject],
    queryFn: () => api.getJiraStories(loadedProject),
    enabled: !!loadedProject,
    retry: false,
  });
  const storyMutation = useMutation({
    mutationFn: (key: string) => api.generateStoryAC(key, loadedProject) as Promise<StoryItem>,
  });

  const manualMutation = useMutation({
    mutationFn: () => api.analyzeManualStory(manualSummary, manualDescription, manualPriority),
  });

  const stories: Story[] = storiesQuery.data ?? [];
  const storyResult = storyMutation.data;

  const manualResult = manualMutation.data as StoryItem | undefined;

  return (
    <PageShell>
      <PageHeader
        title="Requirement Insights"
        description="For a user story, the model writes Given/When/Then acceptance criteria, lists vague terms to clarify, and gives a 0–100 risk score. Paste a story, or pick one from the active Jira sprint and post the criteria back to it."
        actions={
          <>
            <button type="button" onClick={() => setTab("manual")} aria-pressed={tab === "manual"} className={cn(pill, tab === "manual" ? pillOn : pillOff)}>
              Single story
            </button>
            <button type="button" onClick={() => setTab("jira")} aria-pressed={tab === "jira"} className={cn(pill, tab === "jira" ? pillOn : pillOff)}>
              Jira story
            </button>
          </>
        }
      />

      {tab === "manual" && (
        <>
          <Panel>
            <div className="space-y-4">
              <div>
                <label htmlFor="ri-summary" className={fieldLabel}>
                  Story title
                </label>
                <Input
                  id="ri-summary"
                  value={manualSummary}
                  onChange={(e) => setManualSummary(e.target.value)}
                  placeholder="As a user I want to reset my password so I can regain account access"
                />
              </div>

              <div>
                <label htmlFor="ri-description" className={fieldLabel}>
                  Description <span className="font-normal text-ink-quaternary">(optional; more detail gives better scenarios)</span>
                </label>
                <Textarea
                  id="ri-description"
                  value={manualDescription}
                  onChange={(e) => setManualDescription(e.target.value)}
                  placeholder={"Acceptance conditions, constraints, or business rules.\n\n- User clicks 'Forgot Password' on login page\n- System sends reset email within 2 minutes\n- Link expires after 24 hours"}
                  rows={6}
                  className="resize-none font-mono text-xs"
                />
              </div>

              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="w-48">
                  <label htmlFor="ri-priority" className={fieldLabel}>
                    Priority
                  </label>
                  <select
                    id="ri-priority"
                    value={manualPriority}
                    onChange={(e) => setManualPriority(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-container px-3 text-sm text-ink"
                  >
                    {["Critical", "High", "Medium", "Low"].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <Button onClick={() => manualMutation.mutate()} disabled={!manualSummary.trim() || manualMutation.isPending} className="gap-2">
                  {manualMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {manualMutation.isPending ? "Generating" : "Generate acceptance criteria"}
                </Button>
              </div>
            </div>
            {manualMutation.isError && (
              <p className="mt-3 text-sm text-destructive">Generation failed. Check that the AI provider is configured and reachable.</p>
            )}
          </Panel>

          {manualResult && <StoryCard item={manualResult} />}
        </>
      )}

      {tab === "jira" && (
        <>
          <Panel>
            <label htmlFor="ri-project" className={fieldLabel}>
              Jira project key
            </label>
            <div className="flex flex-wrap gap-3">
              <Input
                id="ri-project"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
                placeholder="PROJ"
                className="min-w-0 flex-1 uppercase"
                onKeyDown={(e) => e.key === "Enter" && projectKey && setLoadedProject(projectKey)}
              />
              <Button onClick={() => setLoadedProject(projectKey)} disabled={!projectKey || storiesQuery.isFetching} className="gap-2">
                {storiesQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin" />}
                {storiesQuery.isFetching ? "Loading" : "Load stories"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-ink-tertiary">
              The key is the prefix on every ticket: for <span className="font-mono">PROJ-42</span> it is{" "}
              <span className="font-mono">PROJ</span>. Requires a Jira connection under{" "}
              <Link to="/settings/connectors" className="text-ink-secondary underline underline-offset-2">
                Settings → Connectors
              </Link>
              . To turn stories into requirements with test suites, use Import from Jira on the Requirements page.
            </p>
            {storiesQuery.isError && (
              <p className="mt-3 text-sm text-destructive">
                {apiErrorMessage(storiesQuery.error, "Could not read the sprint from Jira. Check the project key and the Jira connection.")}
              </p>
            )}
          </Panel>

          {loadedProject && !storiesQuery.isError && (
            <DataTable
              caption={`Sprint stories (${stories.length})`}
              columns={STORY_COLUMNS}
              rows={stories}
              rowKey={(st) => st.key}
              searchText={(st) => `${st.key} ${st.summary} ${st.status ?? ""} ${st.assignee ?? ""} ${st.priority ?? ""}`}
              searchPlaceholder="Filter stories"
              pageSize={25}
              empty={storiesQuery.isLoading ? "Loading stories…" : "No stories found in the active sprint for this project."}
              renderExpanded={(st) => (
                <div className="space-y-3">
                  {st.description ? <p className="whitespace-pre-wrap text-xs text-ink-secondary">{st.description}</p> : <p className="text-xs text-ink-quaternary">No description on the story.</p>}
                  <Button
                    size="sm"
                    onClick={() => {
                      setStoryKey(st.key);
                      storyMutation.mutate(st.key);
                    }}
                    disabled={storyMutation.isPending && storyKey === st.key}
                    className="gap-2"
                  >
                    {storyMutation.isPending && storyKey === st.key && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Generate acceptance criteria
                  </Button>
                </div>
              )}
            />
          )}

          {storyMutation.isError && (
            <p className="text-sm text-destructive">{apiErrorMessage(storyMutation.error, "Generation failed. Check that the AI provider is configured and reachable.")}</p>
          )}
          {storyResult && !storyMutation.isPending && <StoryCard item={storyResult} />}
        </>
      )}
    </PageShell>
  );
}
