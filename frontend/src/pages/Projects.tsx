import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Panel } from "@/components/imcc/Panel";
import { DataTable, type DataTableColumn } from "@/components/imcc/DataTable";
import { StatusBadge } from "@/components/imcc/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROJECTS_QUERY_KEY, api, type Project, type ProjectStage } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";
import { parseGithubRepo } from "@/lib/github-repo";
import { displayUrl, relativeTime, stageLabel, stageTone } from "@/lib/project-stages";

const STAGES: { id: keyof Project["stages"]; header: string }[] = [
  { id: "build", header: "Build" },
  { id: "verify", header: "Verify" },
  { id: "review", header: "Review" },
  { id: "release", header: "Release" },
  { id: "operate", header: "Operate" },
];

function StageCell({ stage }: { stage: ProjectStage | undefined }) {
  const status = stage?.status ?? "not evaluated";
  return (
    <StatusBadge tone={stageTone(status)} title={stage?.detail}>
      {stageLabel(status)}
    </StatusBadge>
  );
}

const SOURCE_LABEL: Record<Project["source"], string> = { app_studio: "App Studio", repo: "Repository" };

function ImportRepositoryRow() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const parsed = parseGithubRepo(url.trim());
  const importProject = useMutation({
    mutationFn: () => api.importProject({ repo_url: url.trim() }),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
      toast.success(`${project.name} imported`);
      navigate(`/projects/${encodeURIComponent(project.id)}`);
    },
    onError: (e) => toast.error("The repository could not be imported", { description: apiErrorMessage(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || importProject.isPending) return;
    importProject.mutate();
  };
  return (
    <Panel>
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <label htmlFor="project-import-url" className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
            Import repository
          </label>
          <Input
            id="project-import-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            autoComplete="off"
            spellCheck={false}
            disabled={importProject.isPending}
          />
          <p className="text-xs text-ink-quaternary">
            {parsed
              ? `${parsed.owner}/${parsed.repo}: the delivery stages work on it without a Build stage.`
              : "A GitHub repository URL becomes a project with Verify, Review, Release and Operate stages."}
          </p>
        </div>
        <Button type="submit" size="sm" className="h-9 shrink-0 gap-1.5" disabled={!url.trim() || importProject.isPending}>
          {importProject.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {importProject.isPending ? "Importing…" : "Import"}
        </Button>
      </form>
    </Panel>
  );
}

export default function Projects() {
  const projects = useQuery({ queryKey: PROJECTS_QUERY_KEY, queryFn: api.listProjects });
  const rows = projects.data ?? [];

  const columns: DataTableColumn<Project>[] = [
    {
      id: "name",
      header: "Project",
      grow: true,
      sortValue: (p) => p.name,
      title: (p) => p.name,
      cell: (p) => (
        <Link to={`/projects/${encodeURIComponent(p.id)}`} className="font-medium text-ink hover:underline">
          {p.name}
        </Link>
      ),
    },
    {
      id: "source",
      header: "Source",
      width: "w-28",
      sortValue: (p) => p.source,
      cell: (p) => <StatusBadge tone="neutral">{SOURCE_LABEL[p.source] ?? p.source}</StatusBadge>,
    },
    ...STAGES.map<DataTableColumn<Project>>((s) => ({
      id: s.id,
      header: s.header,
      width: "w-28",
      hideBelow: s.id === "build" || s.id === "operate" ? "lg" : "md",
      sortValue: (p) => p.stages?.[s.id]?.status ?? "",
      title: (p) => p.stages?.[s.id]?.detail,
      cell: (p) => <StageCell stage={p.stages?.[s.id]} />,
    })),
    {
      id: "deployment",
      header: "Last deployment",
      hideBelow: "xl",
      sortValue: (p) => p.last_deployment?.url ?? "",
      title: (p) => p.last_deployment?.url ?? undefined,
      cell: (p) =>
        p.last_deployment?.url ? (
          <a
            href={p.last_deployment.url}
            target="_blank"
            rel="noreferrer"
            className="text-ink-secondary hover:text-ink hover:underline"
          >
            {displayUrl(p.last_deployment.url)}
          </a>
        ) : (
          <span className="text-ink-quaternary">Not deployed</span>
        ),
    },
    {
      id: "updated",
      header: "Updated",
      width: "w-24",
      align: "right",
      sortValue: (p) => p.updated_at,
      title: (p) => (p.updated_at ? new Date(p.updated_at).toLocaleString() : undefined),
      cell: (p) => <span className="text-ink-tertiary">{relativeTime(p.updated_at)}</span>,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        description="Every app Chakram builds or imports, with its stage status"
      />
      <ImportRepositoryRow />
      <DataTable
        caption="Projects"
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        loading={projects.isLoading}
        defaultSort={{ id: "updated", direction: "desc" }}
        searchText={(p) => `${p.name} ${p.repo?.owner ?? ""} ${p.repo?.name ?? ""}`}
        searchPlaceholder="Filter projects"
        empty={
          projects.isError ? (
            <EmptyState kind="error" compact>
              Projects could not be loaded: {apiErrorMessage(projects.error)}
            </EmptyState>
          ) : (
            <EmptyState
              kind="noResults"
              compact
              title="No projects yet"
              action={
                <Button asChild size="sm" variant="outline">
                  <Link to="/ai-ide">Open App Studio</Link>
                </Button>
              }
            >
              Build an app in App Studio or import a GitHub repository above.
            </EmptyState>
          )
        }
      />
    </PageShell>
  );
}
