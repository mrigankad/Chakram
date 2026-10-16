import { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  Github,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Shield,
  Globe,
  Layout,
  Navigation,
  MousePointer,
  Database,
  Layers,
  AlertTriangle,
  Gauge,
  Accessibility,
  Search,
  Copy,
  Check,
  ArrowRight,
  Plus,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  baselineApi,
  BaselineTest,
  BaselineTestStep,
  BaselineScanSession,
  BaselineRepoData,
} from "@/lib/api";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { TestSuiteTabs } from "@/components/TestSuiteTabs";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const pill = "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
const pillOn = "border-transparent bg-primary text-primary-foreground";
const pillOff = "border-border text-ink-secondary hover:bg-raised";

// ── Category Display Config ───────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; colour: string; bg: string; border: string }
> = {
  auth: {
    label: "Auth",
    icon: Shield,
    colour: "text-ink-secondary",
    bg: "bg-raised",
    border: "border-stroke-muted",
  },
  api: {
    label: "API",
    icon: Globe,
    colour: "text-ink-secondary",
    bg: "bg-raised",
    border: "border-stroke-muted",
  },
  ui_form: {
    label: "UI Form",
    icon: MousePointer,
    colour: "text-ink-secondary",
    bg: "bg-raised",
    border: "border-stroke-muted",
  },
  ui_navigation: {
    label: "Navigation",
    icon: Navigation,
    colour: "text-ink-secondary",
    bg: "bg-raised",
    border: "border-stroke-muted",
  },
  ui_component: {
    label: "UI Component",
    icon: Layout,
    colour: "text-ink-secondary",
    bg: "bg-raised",
    border: "border-stroke-muted",
  },
  crud: {
    label: "CRUD",
    icon: Database,
    colour: "text-ink-secondary",
    bg: "bg-raised",
    border: "border-stroke-muted",
  },
  integration: {
    label: "Integration",
    icon: Layers,
    colour: "text-ink-secondary",
    bg: "bg-raised",
    border: "border-stroke-muted",
  },
  edge_case: {
    label: "Edge Case",
    icon: AlertTriangle,
    colour: "text-ink-secondary",
    bg: "bg-raised",
    border: "border-stroke-muted",
  },
  performance: {
    label: "Performance",
    icon: Gauge,
    colour: "text-ink-secondary",
    bg: "bg-raised",
    border: "border-stroke-muted",
  },
  accessibility: {
    label: "Accessibility",
    icon: Accessibility,
    colour: "text-ink-secondary",
    bg: "bg-raised",
    border: "border-stroke-muted",
  },
};

const SEVERITY_TONE: Record<string, StatusTone> = {
  critical: "critical",
  high: "warning",
  medium: "pending",
  low: "neutral",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function getCategoryBreakdown(
  tests: BaselineTest[],
  ids?: Set<string>
): { category: string; count: number }[] {
  const filtered = ids ? tests.filter((t) => ids.has(t.test_id)) : tests;
  const map: Record<string, number> = {};
  for (const t of filtered) {
    map[t.category] = (map[t.category] || 0) + 1;
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));
}

// ── Export Helpers ────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "repo";
}

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

function stepToString(s: BaselineTestStep): string {
  let str = `${s.action} ${s.target}`.trim();
  if (s.value) str += ` → "${s.value}"`;
  if (s.assertion) str += ` [assert: ${s.assertion}]`;
  return str;
}

function escapeCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportJson(repo: BaselineRepoData, tests: BaselineTest[]): string {
  return JSON.stringify(
    {
      github_url: repo.github_url,
      repo_id: repo.repo_id,
      exported_at: new Date().toISOString(),
      total_tests: tests.length,
      tests,
    },
    null,
    2
  );
}

function exportCsv(tests: BaselineTest[]): string {
  const headers = [
    "test_id",
    "name",
    "description",
    "category",
    "severity",
    "page_path",
    "component_name",
    "endpoint",
    "source_file",
    "steps",
  ];
  const rows = tests.map((t) =>
    [
      t.test_id,
      t.name,
      t.description,
      t.category,
      t.severity,
      t.page_path ?? "",
      t.component_name ?? "",
      t.endpoint ?? "",
      t.source_file ?? "",
      t.steps.map((s, i) => `${i + 1}. ${stepToString(s)}`).join(" | "),
    ]
      .map(escapeCsv)
      .join(",")
  );
  return [headers.join(","), ...rows].join("\r\n");
}

function exportMarkdown(repo: BaselineRepoData, tests: BaselineTest[]): string {
  const lines: string[] = [];
  lines.push(`# Test Baseline ${repo.github_url.replace("https://github.com/", "")}`);
  lines.push("");
  lines.push(`- Repository: ${repo.github_url}`);
  lines.push(`- Total tests: ${tests.length}`);
  lines.push(`- Exported: ${new Date().toISOString()}`);
  lines.push("");

  tests.forEach((t, idx) => {
    const target = t.page_path || t.component_name || t.endpoint || "—";
    lines.push(`## ${idx + 1}. ${t.name}`);
    lines.push("");
    lines.push(`- **Category:** ${t.category}`);
    lines.push(`- **Severity:** ${t.severity}`);
    lines.push(`- **Target:** \`${target}\``);
    if (t.source_file) lines.push(`- **Source file:** \`${t.source_file}\``);
    lines.push("");
    lines.push(t.description);
    lines.push("");
    if (t.steps.length) {
      lines.push("**Steps:**");
      lines.push("");
      t.steps.forEach((s, i) => lines.push(`${i + 1}. ${stepToString(s)}`));
      lines.push("");
    }
    if (t.playwright_code) {
      lines.push("**Playwright code:**");
      lines.push("");
      lines.push("```ts");
      lines.push(t.playwright_code);
      lines.push("```");
      lines.push("");
    }
  });

  return lines.join("\n");
}

// ── CodeViewer ────────────────────────────────────────────────────────────────

function CodeViewer({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  };

  return (
    <div className="relative mt-3 rounded-lg border border-stroke-muted bg-raised overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-stroke-muted bg-raised">
        <span className="font-mono text-xs text-ink-tertiary">playwright.ts</span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-ink transition-colors px-2 py-1 rounded-md hover:bg-raised"
        >
          {copied ? (
            <><Check className="h-3.5 w-3.5 text-positive" /> Copied</>
          ) : (
            <><Copy className="h-3.5 w-3.5" /> Copy</>
          )}
        </button>
      </div>
      <pre className="text-[11px] font-mono text-ink p-5 overflow-x-auto leading-relaxed max-h-80 overflow-y-auto whitespace-pre-wrap selection:bg-raised">
        {code || "// No Playwright code generated"}
      </pre>
    </div>
  );
}

// ── TestCard ──────────────────────────────────────────────────────────────────

function TestCard({
  test,
  isNew,
}: {
  test: BaselineTest;
  isNew: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const catCfg = CATEGORY_CONFIG[test.category] || CATEGORY_CONFIG.ui_component;
  const sevTone = SEVERITY_TONE[test.severity] ?? "pending";
  // A bare "/" (the site root) says nothing about where the test applies; omit it.
  const rawGroup = test.page_path || test.component_name || test.endpoint || "";
  const groupLabel = rawGroup && rawGroup !== "/" ? rawGroup : "";

  return (
    <div className="rounded-lg border border-stroke-muted bg-container overflow-hidden">
      {/* Header row */}
      <button
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-raised transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {isNew && <StatusBadge tone="info">New</StatusBadge>}
            <StatusBadge tone={sevTone} className="capitalize">{test.severity}</StatusBadge>
            <span className="text-xs text-ink-tertiary">{catCfg.label}</span>
            {groupLabel && <code className="font-mono text-xs text-ink-tertiary">{groupLabel}</code>}
          </div>
          <p className="text-sm font-medium text-ink leading-snug">{test.name}</p>
          <p className="text-xs text-ink-tertiary mt-0.5 line-clamp-1">{test.description}</p>
        </div>
        <div className="flex items-center gap-1.5 text-ink-tertiary flex-shrink-0 mt-0.5">
          <span className="text-xs tabular-nums">{test.steps.length} {test.steps.length === 1 ? "step" : "steps"}</span>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      <>
        {expanded && (
          <div
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {/* Steps */}
              <div className="space-y-1">
                {test.steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-6 text-center font-mono text-[10px] text-ink-quaternary">
                      {i + 1}
                    </span>
                    <span className="font-mono text-[11px] text-ink-secondary w-16 flex-shrink-0">
                      {step.action}
                    </span>
                    <ArrowRight className="h-2.5 w-2.5 text-border flex-shrink-0" />
                    <span className="text-muted-foreground truncate">
                      {step.target}
                      {step.value ? ` → "${step.value}"` : ""}
                    </span>
                    {step.assertion && (
                      <span className="text-ink-tertiary text-[11px] ml-auto flex-shrink-0">
                        expects: {step.assertion}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Playwright code toggle */}
              {test.playwright_code && (
                <div>
                  <button
                    onClick={() => setShowCode((v) => !v)}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-ink transition-colors"
                  >
                    <Code2 className="h-3.5 w-3.5" />
                    {showCode ? "Hide" : "Show"} Playwright code
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${showCode ? "rotate-180" : ""}`}
                    />
                  </button>
                  <>
                    {showCode && (
                      <div
                        className="overflow-hidden"
                      >
                        <CodeViewer code={test.playwright_code} />
                      </div>
                    )}
                  </>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    </div>
  );
}

// ── NewTestsBanner ────────────────────────────────────────────────────────────

function NewTestsBanner({
  session,
  tests,
  newTestIds,
}: {
  session: BaselineScanSession;
  tests: BaselineTest[];
  newTestIds: Set<string>;
}) {
  if (!session || session.tests_added === 0) return null;

  const breakdown = getCategoryBreakdown(tests, newTestIds);

  return (
    <div className="rounded-lg border border-stroke-muted bg-container px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone="success">+{session.tests_added}</StatusBadge>
        <div>
          <p className="text-sm font-medium text-ink">
            {session.tests_added} new test{session.tests_added !== 1 ? "s" : ""} added
          </p>
          <p className="text-xs text-ink-tertiary">
            {session.scan_type === "full"
              ? "Full baseline scan"
              : `Changes in ${session.changed_files.length} file(s)`}
            {" · "}
            {formatRelative(session.triggered_at)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {breakdown.map(({ category, count }) => {
          const cfg = CATEGORY_CONFIG[category];
          return (
            <span
              key={category}
              className="rounded-full bg-raised px-2 py-0.5 text-[11px] tabular-nums text-ink-secondary"
            >
              {cfg?.label || category}: +{count}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── ScanProgressView ──────────────────────────────────────────────────────────

function ScanProgressView({
  sessionId,
  repoId,
  scanType,
  onDone,
  onBack,
}: {
  sessionId: string;
  repoId: string;
  scanType: "full" | "incremental";
  onDone: (repoId: string, sessionId: string) => void;
  onBack: () => void;
}) {
  const [status, setStatus] = useState("queued");
  const [message, setMessage] = useState(
    scanType === "full" ? "Initialising full scan…" : "Initialising incremental scan…"
  );
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let failures = 0;
    timerRef.current = setInterval(async () => {
      try {
        const st = await baselineApi.getStatus(sessionId);
        failures = 0;
        setStatus(st.status);
        setMessage((prev) => st.progress_message || prev);
        setError(st.error || null);
        if (st.status === "done" || st.status === "failed") {
          if (timerRef.current) clearInterval(timerRef.current);
          if (st.status === "done") onDone(repoId, sessionId);
        }
      } catch (err) {
        // A 404 means the server no longer knows this scan session (usually a restart): stop polling.
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          if (timerRef.current) clearInterval(timerRef.current);
          setError("The scan session expired (the server may have restarted). Start a new scan.");
          return;
        }
        // One failed poll is a network hiccup; say so once it keeps failing.
        failures += 1;
        if (failures >= 4) {
          setError(
            axios.isAxiosError(err) && !err.response
              ? "Cannot reach the server to read the scan status. Still retrying; the scan itself may be running."
              : "Could not read the scan status. Still retrying; the scan itself may be running."
          );
        }
      }
    }, 3000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const STEPS = [
    "Cloning repository…",
    "Extracting source files…",
    "Generating baseline tests…",
    "Persisting tests…",
  ];

  const currentStep = STEPS.findIndex((s) => message.toLowerCase().includes(s.split("…")[0].toLowerCase()));

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-lg border border-stroke-muted bg-container p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
          {status === "failed" ? (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          ) : status === "done" ? (
            <CheckCircle2 className="h-4 w-4 text-positive" />
          ) : (
            <Loader2 className="h-4 w-4 text-ink-tertiary animate-spin" />
          )}
          {scanType === "full" ? "Full baseline scan" : "Incremental scan"}
        </h2>
        <p className="text-sm text-ink-tertiary mt-1">{message}</p>
      </div>

      {/* Step indicators */}
      <div className="space-y-2">
        {STEPS.map((step, i) => {
          const done = currentStep > i || status === "done";
          const active = currentStep === i && status === "running";
          return (
            <div
              key={i}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                active ? "border-stroke bg-raised" : "border-stroke-muted bg-container"
              }`}
            >
              <div className="h-4 w-4 flex items-center justify-center flex-shrink-0">
                {done ? (
                  <Check className="h-3.5 w-3.5 text-positive" />
                ) : active ? (
                  <Loader2 className="h-3.5 w-3.5 text-ink-tertiary animate-spin" />
                ) : (
                  <span className="text-[11px] tabular-nums text-ink-quaternary">{i + 1}</span>
                )}
              </div>
              <span className={`text-sm ${done ? "text-ink-secondary" : active ? "text-ink font-medium" : "text-ink-quaternary"}`}>
                {step}
              </span>
            </div>
          );
        })}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      {status === "failed" && (
        <div className="space-y-3">
          {!error && <p className="text-sm text-destructive">The scan failed. No reason was reported.</p>}
          <Button variant="outline" size="sm" onClick={onBack}>Back to the form</Button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RepoBaseline() {
  const [githubUrl, setGithubUrl] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Active scan tracking
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    repoId: string;
    scanType: "full" | "incremental";
  } | null>(null);

  // Loaded repo data
  const [repoData, setRepoData] = useState<BaselineRepoData | null>(null);
  const [viewSessionId, setViewSessionId] = useState<string | null>(null);

  // UI state
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  // ── derived data ───────────────────────────────────────────────────────────

  const newTestIds = useMemo(
    () => new Set(repoData?.new_test_ids ?? []),
    [repoData]
  );

  const viewSession = useMemo(
    () => repoData?.sessions.find((s) => s.session_id === viewSessionId),
    [repoData, viewSessionId]
  );

  // All unique categories present in the data
  const categories = useMemo(() => {
    if (!repoData) return [];
    const seen = new Set<string>();
    for (const t of repoData.tests) seen.add(t.category);
    return Array.from(seen).sort();
  }, [repoData]);

  // Filtered + searched tests for the active tab
  const displayedTests = useMemo(() => {
    if (!repoData) return [];
    let tests = repoData.tests.filter((t) => t.is_active);

    if (activeCategory !== "all") {
      tests = tests.filter((t) => t.category === activeCategory);
    }
    if (severityFilter !== "all") {
      tests = tests.filter((t) => t.severity === severityFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      tests = tests.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          (t.page_path?.toLowerCase() || "").includes(q)
      );
    }

    // NEW tests first
    tests.sort((a, b) => {
      const aNew = newTestIds.has(a.test_id) ? 0 : 1;
      const bNew = newTestIds.has(b.test_id) ? 0 : 1;
      return aNew - bNew;
    });

    return tests;
  }, [repoData, activeCategory, severityFilter, searchQuery, newTestIds]);

  // ── handlers ───────────────────────────────────────────────────────────────

  const handleScan = async () => {
    if (!githubUrl.trim()) return;
    setScanError(null);
    setScanning(true);
    try {
      const resp = await baselineApi.scan(
        githubUrl.trim(),
        githubToken.trim() || undefined
      );
      setActiveSession({
        sessionId: resp.session_id,
        repoId: resp.repo_id,
        scanType: resp.scan_type,
      });
      setRepoData(null);
    } catch (err: any) {
      setScanError(err?.response?.data?.detail || "Scan failed. Check the GitHub URL.");
    } finally {
      setScanning(false);
    }
  };

  const handleScanDone = async (repoId: string, sessionId: string) => {
    setActiveSession(null);
    try {
      const data = await baselineApi.getRepoTests(repoId, sessionId);
      setRepoData(data);
      setViewSessionId(sessionId);
      setActiveCategory("all");
    } catch (err: any) {
      setScanError(err?.response?.data?.detail || "Failed to load results.");
    }
  };

  const handleDownload = (format: "json" | "csv" | "md") => {
    if (!repoData) return;
    const tests = repoData.tests.filter((t) => t.is_active);
    const base = `test-baseline-${slugify(repoData.github_url)}`;
    if (format === "json") {
      triggerDownload(`${base}.json`, exportJson(repoData, tests), "application/json");
    } else if (format === "csv") {
      triggerDownload(`${base}.csv`, exportCsv(tests), "text/csv");
    } else {
      triggerDownload(`${base}.md`, exportMarkdown(repoData, tests), "text/markdown");
    }
  };

  const handleRescan = () => {
    setRepoData(null);
    setActiveSession(null);
    setScanError(null);
    setSearchQuery("");
    setActiveCategory("all");
    setSeverityFilter("all");
  };

  // ── Active scan view ───────────────────────────────────────────────────────

  if (activeSession) {
    return (
      <PageShell>
        <PageHeader
          title="Test Baseline"
          description="The repository is being analysed. Tests appear here when the scan finishes."
        />
        <TestSuiteTabs />
        <ScanProgressView
          sessionId={activeSession.sessionId}
          repoId={activeSession.repoId}
          scanType={activeSession.scanType}
          onDone={handleScanDone}
          onBack={handleRescan}
        />
      </PageShell>
    );
  }

  // ── Results view ───────────────────────────────────────────────────────────

  if (repoData) {
    return (
      <PageShell>
          <PageHeader
            title="Test Baseline"
            description={`${repoData.github_url.replace("https://github.com/", "")} · ${repoData.total_tests} tests`}
            actions={
              <>
              {/* Session selector */}
              {repoData.sessions.length > 1 && (
                <select
                  value={viewSessionId || ""}
                  onChange={async (e) => {
                    const sid = e.target.value;
                    setViewSessionId(sid);
                    if (sid) {
                      const data = await baselineApi.getRepoTests(repoData.repo_id, sid);
                      setRepoData(data);
                    }
                  }}
                  className="h-9 max-w-[220px] cursor-pointer rounded-md border border-input bg-container px-3 text-xs text-ink"
                >
                  {repoData.sessions.map((s, i) => (
                    <option key={s.session_id} value={s.session_id}>
                      Run #{repoData.sessions.length - i} {s.scan_type} · +{s.tests_added} tests
                    </option>
                  ))}
                </select>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={repoData.tests.filter((t) => t.is_active).length === 0}
                  >
                    <Download className="h-4 w-4" />
                    Download
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs">
                    Export {repoData.tests.filter((t) => t.is_active).length} tests
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleDownload("json")} className="text-xs gap-2">
                    <Code2 className="h-3.5 w-3.5" /> JSON (.json)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownload("csv")} className="text-xs gap-2">
                    <Database className="h-3.5 w-3.5" /> CSV (.csv)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownload("md")} className="text-xs gap-2">
                    <Layout className="h-3.5 w-3.5" /> Markdown (.md)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRescan}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" />
                New scan
              </Button>
              </>
            }
          />
          <TestSuiteTabs />
          <a
            href={repoData.github_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-tertiary transition-colors hover:text-ink"
          >
            <Github className="h-3.5 w-3.5" />
            {repoData.github_url}
          </a>

          {/* New tests banner */}
          {viewSession && viewSession.tests_added > 0 && (
            <NewTestsBanner
              session={viewSession}
              tests={repoData.tests}
              newTestIds={newTestIds}
            />
          )}

          {/* Session history strip */}
          <div className="flex gap-2 flex-wrap">
            {repoData.sessions.map((s, i) => (
              <button
                key={s.session_id}
                onClick={async () => {
                  setViewSessionId(s.session_id);
                  const data = await baselineApi.getRepoTests(repoData.repo_id, s.session_id);
                  setRepoData(data);
                }}
                aria-pressed={viewSessionId === s.session_id}
                className={`flex items-center gap-1.5 ${pill} ${viewSessionId === s.session_id ? pillOn : pillOff}`}
              >
                Run #{repoData.sessions.length - i}
                {s.tests_added > 0 && <span className="tabular-nums opacity-70">+{s.tests_added}</span>}
                <span className="opacity-70">{formatRelative(s.triggered_at)}</span>
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-48 max-w-72">
              <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-quaternary" />
              <Input
                placeholder="Search tests…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>

            {/* Severity filter */}
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-container px-2.5 text-xs text-ink-secondary"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {/* NEW only toggle */}
            {newTestIds.size > 0 && (
              <button
                onClick={() =>
                  setSearchQuery((q) =>
                    q === "__new__" ? "" : "__new__"
                  )
                }
                aria-pressed={searchQuery === "__new__"}
                className={`${pill} ${searchQuery === "__new__" ? pillOn : pillOff}`}
              >
                New only <span className="ml-1 tabular-nums opacity-70">{newTestIds.size}</span>
              </button>
            )}
          </div>

          {/* Category tabs */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveCategory("all")}
              aria-pressed={activeCategory === "all"}
              className={`${pill} ${activeCategory === "all" ? pillOn : pillOff}`}
            >
              All <span className="ml-1 tabular-nums opacity-70">{repoData.tests.filter((t) => t.is_active).length}</span>
            </button>
            {categories.map((cat) => {
              const cfg = CATEGORY_CONFIG[cat];
              const count = repoData.tests.filter(
                (t) => t.is_active && t.category === cat
              ).length;
              const newCount = repoData.tests.filter(
                (t) => t.is_active && t.category === cat && newTestIds.has(t.test_id)
              ).length;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  aria-pressed={activeCategory === cat}
                  className={`${pill} ${activeCategory === cat ? pillOn : pillOff}`}
                >
                  {cfg?.label || cat} <span className="ml-1 tabular-nums opacity-70">{count}</span>
                  {newCount > 0 && <span className="ml-1 tabular-nums opacity-70">+{newCount} new</span>}
                </button>
              );
            })}
          </div>

          {/* Test grid */}
          <div className="space-y-2 pb-8">
            {displayedTests.length === 0 ? (
              <div className="rounded-lg border border-stroke-muted bg-container py-12 text-center text-sm text-ink-tertiary">
                No tests match your filters.
              </div>
            ) : (
              <>
                <p className={eyebrow}>
                  {displayedTests.length} test{displayedTests.length !== 1 ? "s" : ""}
                  {newTestIds.size > 0 && activeCategory === "all" && (
                    <span className="ml-2">
                      · {newTestIds.size} new in this session
                    </span>
                  )}
                </p>
                {displayedTests
                  .filter((t) =>
                    searchQuery === "__new__" ? newTestIds.has(t.test_id) : true
                  )
                  .map((test) => (
                    <TestCard
                      key={test.test_id}
                      test={test}
                      isNew={newTestIds.has(test.test_id)}
                    />
                  ))}
              </>
            )}
          </div>
      </PageShell>
    );
  }

  // ── Input form ─────────────────────────────────────────────────────────────

  return (
    <PageShell size="lg">
      <PageHeader
        title="Test Baseline"
        description="Submit a GitHub repository URL. The codebase is analysed and categorised Playwright tests are generated from it. Submitting the same repository again detects what changed and appends only the new tests."
      />
      <TestSuiteTabs />
      <div className="space-y-4">
        {/* Form card */}
        <div className="rounded-lg border border-stroke-muted bg-container p-4 space-y-4">
          {scanError && <p className="text-sm text-destructive">{scanError}</p>}

          {/* GitHub URL */}
          <div className="space-y-1.5">
            <label htmlFor="baseline-github-url" className="block text-xs font-medium text-ink-secondary">
              GitHub repository URL
            </label>
            <Input
              id="baseline-github-url"
              placeholder="https://github.com/owner/repo"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
              disabled={scanning}
            />
          </div>

          {/* GitHub Token (optional) */}
          <div className="space-y-1.5">
            <label htmlFor="baseline-github-token" className="block text-xs font-medium text-ink-secondary">
              GitHub token{" "}
              <span className="font-normal text-ink-quaternary">(optional, for private repositories)</span>
            </label>
            <Input
              id="baseline-github-token"
              type="password"
              placeholder="ghp_…"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              disabled={scanning}
            />
          </div>

          <Button
            id="baseline-scan-btn"
            className="gap-2"
            onClick={handleScan}
            disabled={scanning || !githubUrl.trim()}
          >
            {scanning ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Starting scan…</>
            ) : (
              "Generate test baseline"
            )}
          </Button>
        </div>

        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-ink-tertiary sm:grid-cols-2">
          <li>Tests are grouped by category: auth, API, UI, CRUD and others.</li>
          <li>A re-scan only appends tests for what changed.</li>
          <li>Every scan is kept as a session you can switch between.</li>
          <li>Each test includes runnable Playwright TypeScript.</li>
        </ul>
      </div>
    </PageShell>
  );
}
