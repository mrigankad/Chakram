import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { api, type JiraStory } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";

const PRIORITY_TONE: Record<string, StatusTone> = {
  Critical: "critical",
  Highest: "critical",
  High: "warning",
  Medium: "info",
  Low: "neutral",
  Lowest: "neutral",
};

/**
 * Import stories from the active sprint of a Jira project as requirements. Each story
 * becomes one requirement with a generated test suite (`POST /jira/stories/import`);
 * the result names what was created, what already existed and what failed.
 */
export function JiraImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [project, setProject] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const projects = useQuery({ queryKey: ["jira", "projects"], queryFn: api.getJiraProjects, enabled: open, retry: false });
  const projectKeys = useMemo(
    () =>
      (projects.data ?? [])
        .map((p: { key?: string; name?: string }) => ({ key: String(p.key ?? ""), name: String(p.name ?? p.key ?? "") }))
        .filter((p) => p.key),
    [projects.data],
  );
  useEffect(() => {
    if (!project && projectKeys.length) setProject(projectKeys[0].key);
  }, [project, projectKeys]);

  const stories = useQuery({
    queryKey: ["jira", "stories", project],
    queryFn: () => api.getJiraStories(project),
    enabled: open && !!project,
    retry: false,
  });
  useEffect(() => setSelected(new Set()), [project]);

  const importMutation = useMutation({
    mutationFn: () => api.importJiraStories(project, Array.from(selected)),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["requirements"] });
      void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      const exists = res.results.filter((r) => r.status === "exists").length;
      const failed = res.results.filter((r) => r.status === "failed" || r.status === "not_found");
      if (res.created) {
        toast.success(`${res.created} ${res.created === 1 ? "story" : "stories"} imported`, {
          description:
            [exists ? `${exists} already imported.` : "", failed.length ? `${failed.length} failed.` : ""].filter(Boolean).join(" ") ||
            "Each one has a generated test suite.",
        });
      } else if (exists && !failed.length) {
        toast.info("Already imported", { description: "Those stories are requirements already." });
      }
      for (const f of failed) toast.error(`${f.key} was not imported`, { description: f.error });
      if (!failed.length) onOpenChange(false);
    },
    onError: (err: unknown) =>
      toast.error("Import failed", { description: apiErrorMessage(err, "Check the Jira connection under Settings → Connectors.") }),
  });

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const rows: JiraStory[] = stories.data ?? [];
  const allSelected = rows.length > 0 && rows.every((s) => selected.has(s.key));

  return (
    <Dialog open={open} onOpenChange={(o) => !importMutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import stories from Jira</DialogTitle>
          <DialogDescription>
            Each selected story becomes a requirement with a generated test suite. Stories of the active sprint are listed; the key
            and summary stay on the requirement, and results can be posted back to the story after a run.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-xs font-medium text-ink-secondary" htmlFor="jira-import-project">
            Project
          </label>
          {projects.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {apiErrorMessage(projects.error, "Jira could not be read.")}{" "}
              <Link to="/settings/connectors" className="underline underline-offset-2">
                Settings → Connectors
              </Link>
            </p>
          ) : (
            <select
              id="jira-import-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              disabled={projects.isLoading || importMutation.isPending}
              className="h-9 w-full rounded-md border border-input bg-container px-3 text-sm text-ink"
            >
              {projects.isLoading && <option value="">Loading projects…</option>}
              {projectKeys.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} · {p.name}
                </option>
              ))}
            </select>
          )}

          <div className="max-h-80 overflow-y-auto rounded-md border border-stroke-muted">
            {stories.isLoading ? (
              <p className="p-3 text-sm text-ink-tertiary">Loading stories…</p>
            ) : stories.isError ? (
              <p role="alert" className="p-3 text-sm text-destructive">
                {apiErrorMessage(stories.error, "Stories could not be read.")}
              </p>
            ) : rows.length === 0 ? (
              <p className="p-3 text-sm text-ink-tertiary">{project ? "No stories in the active sprint of this project." : "Pick a project."}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-raised text-[11px] uppercase tracking-[0.08em] text-ink-quaternary">
                  <tr>
                    <th className="w-10 p-2">
                      <Checkbox
                        aria-label="Select all stories"
                        checked={allSelected}
                        onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((s) => s.key)))}
                      />
                    </th>
                    <th className="p-2 text-left font-medium">Key</th>
                    <th className="p-2 text-left font-medium">Story</th>
                    <th className="p-2 text-left font-medium">Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rows.map((s) => (
                    <tr key={s.key} className="hover:bg-raised">
                      <td className="p-2 text-center">
                        <Checkbox aria-label={`Select ${s.key}`} checked={selected.has(s.key)} onCheckedChange={() => toggle(s.key)} />
                      </td>
                      <td className="p-2 font-mono text-xs text-ink-secondary">{s.key}</td>
                      <td className="p-2 text-ink" title={s.description || undefined}>
                        {s.summary}
                        {!s.description && <span className="ml-2 text-xs text-ink-quaternary">no description</span>}
                      </td>
                      <td className="p-2">
                        <StatusBadge tone={PRIORITY_TONE[s.priority] ?? "neutral"}>{s.priority}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => importMutation.mutate()} disabled={selected.size === 0 || importMutation.isPending} className="gap-2">
            {importMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {importMutation.isPending ? "Generating suites" : selected.size ? `Import ${selected.size}` : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
