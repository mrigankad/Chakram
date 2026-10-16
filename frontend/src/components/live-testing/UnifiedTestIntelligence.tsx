import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ChevronDown, ChevronRight, ChevronUp, Download } from "lucide-react";
import { KpiStat } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { type WorkspacePlaywrightTest, type WorkspaceTestStep } from "@/lib/api";

// ── Export Helpers ────────────────────────────────────────────────────────────

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function stepToString(s: WorkspaceTestStep): string {
  let str = s.action;
  if (s.selector) str += ` ${s.selector}`;
  if (s.value) str += ` → "${s.value}"`;
  if (s.description) str += ` (${s.description})`;
  return str.trim();
}

function testSource(t: WorkspacePlaywrightTest): string {
  return (t as any).source === "baseline" ? "baseline" : "session";
}

function escapeCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportJson(tests: WorkspacePlaywrightTest[]): string {
  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      total_tests: tests.length,
      tests: tests.map((t) => ({ ...t, source: testSource(t) })),
    },
    null,
    2
  );
}

function exportCsv(tests: WorkspacePlaywrightTest[]): string {
  const headers = ["id", "name", "description", "page_name", "severity", "source", "steps"];
  const rows = tests.map((t) =>
    [
      t.id,
      t.name,
      t.description,
      t.page_name,
      t.severity,
      testSource(t),
      t.steps.map((s, i) => `${i + 1}. ${stepToString(s)}`).join(" | "),
    ]
      .map(escapeCsv)
      .join(",")
  );
  return [headers.join(","), ...rows].join("\r\n");
}

function exportMarkdown(tests: WorkspacePlaywrightTest[]): string {
  const lines: string[] = [];
  lines.push("# Execution Plan Test Cases");
  lines.push("");
  lines.push(`- Total tests: ${tests.length}`);
  lines.push(`- Exported: ${new Date().toISOString()}`);
  lines.push("");

  tests.forEach((t, idx) => {
    lines.push(`## ${idx + 1}. ${t.name}`);
    lines.push("");
    lines.push(`- **Page:** \`${t.page_name || "—"}\``);
    lines.push(`- **Severity:** ${t.severity}`);
    lines.push(`- **Source:** ${testSource(t)}`);
    lines.push("");
    if (t.description) {
      lines.push(t.description);
      lines.push("");
    }
    if (t.steps.length) {
      lines.push("**Steps:**");
      lines.push("");
      t.steps.forEach((s, i) => lines.push(`${i + 1}. ${stepToString(s)}`));
      lines.push("");
    }
  });

  return lines.join("\n");
}

const severityTone: Record<string, StatusTone> = {
  Critical: "critical",
  High: "warning",
  Medium: "pending",
  Low: "neutral",
};

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";

interface FileGroup {
  filePath: string;
  tests: WorkspacePlaywrightTest[];
}

export function UnifiedTestIntelligence({ tests }: { tests: WorkspacePlaywrightTest[] }) {
  const [expanded, setExpanded] = useState(true);
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const sessionTests = tests.filter(t => (t as any).source === "session");
  const baselineTests = tests.filter(t => (t as any).source === "baseline");

  const buildGroups = (testList: WorkspacePlaywrightTest[]) => {
    return testList.reduce<FileGroup[]>((acc, t) => {
      const key = t.page_name || "Unknown";
      const existing = acc.find((g) => g.filePath === key);
      if (existing) {
        existing.tests.push(t);
      } else {
        acc.push({ filePath: key, tests: [t] });
      }
      return acc;
    }, []);
  };

  const sessionGroups = buildGroups(sessionTests);
  const baselineGroups = buildGroups(baselineTests);

  const allFilePaths = Array.from(new Set([...sessionGroups.map(g => g.filePath), ...baselineGroups.map(g => g.filePath)]));
  const allGroups = allFilePaths.map(fp => ({
    filePath: fp,
    sessionTests: sessionGroups.find(g => g.filePath === fp)?.tests || [],
    baselineTests: baselineGroups.find(g => g.filePath === fp)?.tests || []
  }));

  const toggleFile = (fp: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  };

  const handleDownload = (format: "json" | "csv" | "md") => {
    if (tests.length === 0) return;
    const base = "execution-plan-tests";
    if (format === "json") {
      triggerDownload(`${base}.json`, exportJson(tests), "application/json");
    } else if (format === "csv") {
      triggerDownload(`${base}.csv`, exportCsv(tests), "text/csv");
    } else {
      triggerDownload(`${base}.md`, exportMarkdown(tests), "text/markdown");
    }
  };

  const toggleTest = (id: string) => {
    setExpandedTests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  function renderTestItem(test: WorkspacePlaywrightTest) {
    const isExpanded = expandedTests.has(test.id);
    const severity = test.severity.charAt(0).toUpperCase() + test.severity.slice(1).toLowerCase();
    return (
      <div key={test.id} className="overflow-hidden rounded-lg border border-stroke-muted bg-container">
        <button
          onClick={() => toggleTest(test.id)}
          aria-expanded={isExpanded}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink">{test.name}</p>
            {test.description && (
              <p className="truncate text-xs text-ink-tertiary">{test.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge tone={severityTone[severity] ?? "neutral"}>{severity}</StatusBadge>
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-ink-quaternary" /> : <ChevronDown className="h-3.5 w-3.5 text-ink-quaternary" />}
          </div>
        </button>

        {isExpanded && (
          <ol className="space-y-1.5 border-t border-stroke-muted px-4 py-3">
            {test.steps.map((step, idx) => (
              <li key={idx} className="flex items-start gap-2.5 text-xs">
                <span className="mt-0.5 w-4 text-right font-mono tabular-nums text-ink-quaternary">{idx + 1}</span>
                <span className="w-24 shrink-0 font-mono text-ink-tertiary">{step.action}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-ink-secondary">{step.selector || step.value || "—"}</p>
                  {step.description && <p className="text-ink-tertiary">{step.description}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Summary ─────────────────────────────────────────────────────────── */}
      <div className={cn("grid grid-cols-1 gap-3", baselineTests.length > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <KpiStat mark="mark-test-suite" label="This session" value={sessionTests.length} hint="tests" />
        {baselineTests.length > 0 && <KpiStat mark="mark-repo-baseline" label="From baseline" value={baselineTests.length} hint="tests" />}
        <KpiStat mark="mark-test-execution" label="Total in this run" value={tests.length} hint="tests" />
      </div>

      <div className="overflow-hidden rounded-lg border border-stroke-muted bg-container">
        <div className="flex min-h-11 items-center justify-between gap-3 border-b border-stroke-muted px-4 py-1.5">
          <div className="flex min-w-0 items-center gap-3">
            <h3 className={eyebrow}>Test plan</h3>
            <span className="text-xs tabular-nums text-ink-tertiary">{tests.length} tests, grouped by page</span>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={tests.length === 0} className="h-8 gap-1.5 text-xs">
                  <Download className="h-4 w-4" />
                  Download
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-xs">Export {tests.length} tests</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleDownload("json")} className="text-xs">
                  JSON (.json)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload("csv")} className="text-xs">
                  CSV (.csv)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload("md")} className="text-xs">
                  Markdown (.md)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              aria-label={expanded ? "Collapse test plan" : "Expand test plan"}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="max-h-[600px] overflow-y-auto scrollbar-thin">
            {allGroups.length === 0 ? (
              <EmptyState kind="noRuns">
                No tests yet. Generate tests or include baseline tests to build a run.
              </EmptyState>
            ) : (
              allGroups.map((group) => {
                const isOpen = expandedFiles.has(group.filePath);
                return (
                  <div key={group.filePath} className="border-b border-border/60 last:border-b-0">
                    <button
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
                      aria-expanded={isOpen}
                      onClick={() => toggleFile(group.filePath)}
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-quaternary" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-quaternary" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{group.filePath}</span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-tertiary">
                        {group.sessionTests.length > 0 && `${group.sessionTests.length} session`}
                        {group.sessionTests.length > 0 && group.baselineTests.length > 0 && " · "}
                        {group.baselineTests.length > 0 && `${group.baselineTests.length} baseline`}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="space-y-4 px-4 pb-4 pl-11">
                        {group.sessionTests.length > 0 && (
                          <div className="space-y-2">
                            <p className={eyebrow}>From this session</p>
                            <div className="grid grid-cols-1 gap-2">
                              {group.sessionTests.map((t) => renderTestItem(t))}
                            </div>
                          </div>
                        )}
                        {group.baselineTests.length > 0 && (
                          <div className="space-y-2">
                            <p className={eyebrow}>From the baseline</p>
                            <div className="grid grid-cols-1 gap-2">
                              {group.baselineTests.map((t) => renderTestItem(t))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
