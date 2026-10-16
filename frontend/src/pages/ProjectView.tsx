import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, ExternalLink, FolderKanban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Panel } from "@/components/imcc/Panel";
import { DataTable, type DataTableColumn } from "@/components/imcc/DataTable";
import { StatusBadge } from "@/components/imcc/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  PROJECTS_QUERY_KEY,
  api,
  type Project,
  type ProjectDeployment,
  type ProjectGate,
  type ProjectStage,
} from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";
import { displayUrl, formatPassRate, relativeTime, stageLabel, stageTone } from "@/lib/project-stages";

const CAPTION = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const SOURCE_LABEL: Record<Project["source"], string> = { app_studio: "App Studio", repo: "Repository" };

function InternalLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary hover:text-ink hover:underline">
      {children}
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

function ExternalUrl({ href, label }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-ink-secondary hover:text-ink hover:underline"
    >
      <span className="truncate">{label ?? displayUrl(href)}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </a>
  );
}

/** One of the five stage cards: caption, badge, a one-line detail and the stage's action. */
function StagePanel({
  label,
  stage,
  detail,
  children,
}: {
  label: string;
  stage: ProjectStage;
  /** Overrides the record's detail line. */
  detail?: ReactNode;
  children?: ReactNode;
}) {
  const line = detail ?? stage.detail;
  return (
    <Panel className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className={CAPTION}>{label}</p>
        <StatusBadge tone={stageTone(stage.status)}>{stageLabel(stage.status)}</StatusBadge>
      </div>
      {line ? (
        <p className="line-clamp-2 text-xs text-ink-tertiary" title={typeof line === "string" ? line : undefined}>
          {line}
        </p>
      ) : (
        <p className="text-xs text-ink-quaternary">Not evaluated yet</p>
      )}
      {children && <div className="mt-auto flex min-w-0 flex-col gap-1.5 pt-1">{children}</div>}
    </Panel>
  );
}

function BuildStage({ project }: { project: Project }) {
  const spec = project.spec ?? project.stages.build.spec ?? null;
  const summary = spec
    ? `${spec.entities.length} ${spec.entities.length === 1 ? "entity" : "entities"}, ${spec.pages.length} ${spec.pages.length === 1 ? "page" : "pages"}`
    : null;
  return (
    <StagePanel
      label="Build"
      stage={project.stages.build}
      detail={
        project.source === "repo"
          ? "Imported repository: nothing to build here"
          : summary
            ? `${summary}${project.build_status ? ` · ${stageLabel(project.build_status)}` : ""}`
            : project.stages.build.detail
      }
    >
      {spec && (spec.entities.length > 0 || spec.pages.length > 0) && (
        <p className="line-clamp-2 text-[11px] text-ink-quaternary" title={[...spec.entities, ...spec.pages].join(", ")}>
          {[...spec.entities, ...spec.pages].join(" · ")}
        </p>
      )}
      {project.workspace_id && <InternalLink to="/ai-ide">Open in App Studio</InternalLink>}
    </StagePanel>
  );
}

function VerifyStage({ project }: { project: Project }) {
  const run = project.latest_run ?? project.stages.verify.run ?? null;
  const deployUrl = project.last_deployment?.url ?? null;
  const openUrl =
    project.requirement_id && deployUrl
      ? `/test-execution?requirement=${encodeURIComponent(project.requirement_id)}&url=${encodeURIComponent(deployUrl)}`
      : project.requirement_id
        ? `/test-execution?requirement=${encodeURIComponent(project.requirement_id)}`
        : null;
  return (
    <StagePanel
      label="Verify"
      stage={project.stages.verify}
      detail={
        run
          ? `${run.passed} passed · ${run.failed} failed · ${run.skipped} skipped · ${formatPassRate(run.pass_rate)} pass rate`
          : project.stages.verify.detail
      }
    >
      {run && (
        <p className="text-[11px] text-ink-quaternary" title={run.target_url}>
          Last run {relativeTime(run.completed_at ?? run.created_at)} against {displayUrl(run.target_url) || "the target"}
        </p>
      )}
      {openUrl ? (
        <InternalLink to={openUrl}>Open Test Execution</InternalLink>
      ) : (
        <p className="text-xs text-ink-quaternary">Run Test this app from the Deployed view</p>
      )}
    </StagePanel>
  );
}

function ReviewStage({ project }: { project: Project }) {
  const repo = project.repo ?? project.stages.review.repo ?? null;
  return (
    <StagePanel
      label="Review"
      stage={project.stages.review}
      detail={repo ? `${repo.owner}/${repo.name} · ${repo.default_branch}` : project.stages.review.detail}
    >
      {repo ? (
        <>
          <InternalLink to="/code-review">Open Code Review</InternalLink>
          <ExternalUrl href={repo.url} label={`${repo.owner}/${repo.name} on GitHub`} />
        </>
      ) : (
        <p className="text-xs text-ink-quaternary">Push the app to GitHub first</p>
      )}
    </StagePanel>
  );
}

function ReleaseStage({ project }: { project: Project }) {
  const deployment = project.last_deployment ?? project.stages.release.deployment ?? null;
  return (
    <StagePanel
      label="Release"
      stage={project.stages.release}
      detail={
        deployment
          ? `${stageLabel(deployment.state)}${deployment.target ? ` · ${deployment.target}` : ""} · ${relativeTime(deployment.created_at)}`
          : project.stages.release.detail
      }
    >
      {deployment?.url ? (
        <ExternalUrl href={deployment.url} />
      ) : (
        <p className="text-xs text-ink-quaternary">Not deployed yet</p>
      )}
    </StagePanel>
  );
}

function OperateStage({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const hasDeployment = !!project.last_deployment?.url;
  const check = useMutation({
    mutationFn: () => api.checkProjectHealth(project.id),
    onError: (e) => toast.error("Health could not be checked", { description: apiErrorMessage(e) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [...PROJECTS_QUERY_KEY, project.id] });
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY, exact: true });
    },
  });
  const health = check.data ?? project.last_health ?? null;
  return (
    <StagePanel
      label="Operate"
      stage={project.stages.operate}
      detail={
        health ? (
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <StatusBadge tone={health.ok ? "success" : "critical"}>{health.ok ? "Healthy" : "Unhealthy"}</StatusBadge>
            <span className="min-w-0 truncate" title={health.message}>{health.message}</span>
          </span>
        ) : (
          project.stages.operate.detail
        )
      }
    >
      {health && (
        <p className="text-[11px] text-ink-quaternary" title={new Date(health.checked_at).toLocaleString()}>
          Checked {relativeTime(health.checked_at)}
          {health.health != null && ` · health ${health.health}`}
          {health.ready != null && ` · ready ${health.ready}`}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-fit gap-1.5 text-xs"
        disabled={!hasDeployment || check.isPending}
        title={hasDeployment ? "Request the deployed app's health and ready endpoints" : "Deploy the app first"}
        onClick={() => check.mutate()}
      >
        {check.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {check.isPending ? "Checking…" : "Check health"}
      </Button>
      {!hasDeployment && <p className="text-[11px] text-ink-quaternary">Needs a deployment to check</p>}
    </StagePanel>
  );
}

function GateCard({ projectId }: { projectId: string }) {
  const gate = useQuery({ queryKey: [...PROJECTS_QUERY_KEY, projectId, "gate"], queryFn: () => api.getProjectGate(projectId) });
  const data: ProjectGate | undefined = gate.data;
  const notEvaluated = Object.entries(data?.not_evaluated ?? {});
  return (
    <Panel className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className={CAPTION}>Release gate</p>
        {data ? (
          <StatusBadge tone={stageTone(data.verdict)}>{stageLabel(data.verdict)}</StatusBadge>
        ) : gate.isLoading ? (
          <StatusBadge tone="pending">Evaluating</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Not evaluated</StatusBadge>
        )}
      </div>
      {gate.isError ? (
        <p className="text-xs text-destructive" role="alert">{apiErrorMessage(gate.error)}</p>
      ) : data ? (
        <>
          <p className="text-xs text-ink-tertiary">{data.reason}</p>
          <p className="font-display text-[22px] leading-tight tabular-nums text-ink">
            {data.score == null ? "—" : Math.round(data.score)}
            {data.score != null && <span className="ml-1 text-xs text-ink-quaternary">/ 100</span>}
          </p>
          {notEvaluated.length > 0 && (
            <ul className="space-y-0.5">
              {notEvaluated.map(([signal, why]) => (
                <li key={signal} className="truncate text-[11px] text-ink-quaternary" title={`${signal}: ${why}`}>
                  <span className="font-medium">{signal.replace(/_/g, " ")}</span>: {why}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-ink-quaternary">Scored from this project's own test results · {relativeTime(data.evaluated_at)}</p>
        </>
      ) : (
        <p className="text-xs text-ink-quaternary">{gate.isLoading ? "Scoring the latest run…" : "No verdict yet"}</p>
      )}
    </Panel>
  );
}

function DeploymentsTable({ deployments }: { deployments: ProjectDeployment[] }) {
  const columns: DataTableColumn<ProjectDeployment>[] = [
    { id: "id", header: "Deployment", mono: true, grow: true, cell: (d) => d.id, sortValue: (d) => d.id },
    {
      id: "state",
      header: "State",
      width: "w-28",
      sortValue: (d) => d.state,
      cell: (d) => <StatusBadge tone={stageTone(d.state)}>{stageLabel(d.state)}</StatusBadge>,
    },
    { id: "target", header: "Target", width: "w-28", hideBelow: "sm", cell: (d) => d.target ?? "—", sortValue: (d) => d.target },
    { id: "branch", header: "Branch", width: "w-32", hideBelow: "md", mono: true, cell: (d) => d.branch ?? "—", sortValue: (d) => d.branch },
    {
      id: "url",
      header: "URL",
      hideBelow: "lg",
      title: (d) => d.url ?? undefined,
      cell: (d) => (d.url ? <ExternalUrl href={d.url} /> : <span className="text-ink-quaternary">—</span>),
    },
    {
      id: "created",
      header: "Created",
      width: "w-28",
      align: "right",
      sortValue: (d) => d.created_at,
      title: (d) => new Date(d.created_at).toLocaleString(),
      cell: (d) => <span className="text-ink-tertiary">{relativeTime(d.created_at)}</span>,
    },
  ];
  return (
    <DataTable
      caption="Deployments"
      columns={columns}
      rows={deployments}
      rowKey={(d) => d.id}
      defaultSort={{ id: "created", direction: "desc" }}
      pageSize={10}
      empty={
        <EmptyState kind="noRuns" compact>
          No deployments recorded. Push & Deploy from App Studio or deploy the repository from Deployments.
        </EmptyState>
      }
    />
  );
}

export default function ProjectView() {
  const { id = "" } = useParams<{ id: string }>();
  const project = useQuery({
    queryKey: [...PROJECTS_QUERY_KEY, id],
    queryFn: () => api.getProject(id),
    enabled: !!id,
  });

  if (project.isLoading) {
    return (
      <PageShell>
        <EmptyState kind="loading">Loading project…</EmptyState>
      </PageShell>
    );
  }
  if (project.isError || !project.data) {
    return (
      <PageShell>
        <PageHeader icon={FolderKanban} title="Project" />
        <EmptyState
          kind="error"
          title="This project could not be loaded"
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/projects">All projects</Link>
            </Button>
          }
        >
          {project.error ? apiErrorMessage(project.error) : "No project with this id."}
        </EmptyState>
      </PageShell>
    );
  }

  const p = project.data;
  return (
    <PageShell>
      <PageHeader
        icon={FolderKanban}
        title={p.name}
        description={`${SOURCE_LABEL[p.source] ?? p.source}${p.pack_id ? ` · design pack ${p.pack_id}` : ""} · updated ${relativeTime(p.updated_at)}`}
        badge={<StatusBadge tone="neutral">{SOURCE_LABEL[p.source] ?? p.source}</StatusBadge>}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/projects">All projects</Link>
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <BuildStage project={p} />
        <VerifyStage project={p} />
        <ReviewStage project={p} />
        <ReleaseStage project={p} />
        <OperateStage project={p} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <GateCard projectId={p.id} />
        <div className="lg:col-span-2">
          <DeploymentsTable deployments={p.deployments ?? []} />
        </div>
      </div>
    </PageShell>
  );
}
