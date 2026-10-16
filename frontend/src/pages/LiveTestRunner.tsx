import { Link } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { useState, useMemo, useRef, useEffect } from "react";
import {
  Github,
  Globe,
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Camera,
  RotateCcw,
  Layers,
  Workflow,
  AlertTriangle,
  Clock,
  ListChecks,
  Shield,
  Navigation,
  MousePointer,
  Zap,
  Bug,
  GitCommit,
  Eye,
  Download,
  Upload,
  FileCode,
  FlaskConical,
  Search,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { UnifiedTestIntelligence } from "@/components/live-testing/UnifiedTestIntelligence";
import { HealFailedTest } from "@/components/live-testing/HealFailedTest";
import { useLiveTesting, useFetchCommits, useRunHistory, LiveTestingPhase, isLocalAnalysis } from "../hooks/use-live-testing";
import { useActiveRepo } from "@/context/RepoContext";
import { api, baselineApi, PlaywrightTestCase, LiveTestResult, StepResult, CommitInfo, RunSummaryItem, RepoAnalysisResult, BaselineTest, WorkspacePlaywrightTest } from "../lib/api";
import { downloadLiveTestReport, downloadRunSummaryReport } from "../lib/pdf-report";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { KpiStat } from "@/components/imcc/Panel";
import { StatusBadge } from "@/components/imcc/StatusBadge";

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const pill = "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
const pillOn = "border-transparent bg-primary text-primary-foreground";
const pillOff = "border-border text-ink-secondary hover:bg-raised";

// ── Screenshot Viewer ─────────────────────────────────────────────────────────

function ScreenshotViewer({
  steps,
}: {
  steps: StepResult[];
}) {
  const withShots = steps.filter((s) => s.screenshot);
  const [idx, setIdx] = useState(0);

  if (withShots.length === 0) return null;

  const current = withShots[Math.min(idx, withShots.length - 1)];

  return (
    <div className="mt-3 rounded-lg border border-stroke-muted bg-raised overflow-hidden">
      {/* Screenshot */}
      <div className="relative bg-raised">
        <img
          src={`data:image/png;base64,${current.screenshot}`}
          alt={current.step_description}
          className="w-full object-contain max-h-64"
        />
        {current.status === "fail" && (
          <StatusBadge tone="critical" className="absolute right-2 top-2">Failed step</StatusBadge>
        )}
      </div>

      {/* Step nav */}
      <div className="flex items-center gap-1.5 p-2 overflow-x-auto">
        {withShots.map((s, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${i === idx
                ? "border-transparent bg-primary text-primary-foreground"
                : s.status === "fail"
                  ? "border-border text-destructive hover:bg-raised-2"
                  : "border-border text-ink-secondary hover:bg-raised-2"
              }`}
          >
            Step {i + 1}
          </button>
        ))}
      </div>
      <p className="px-3 pb-2 text-[11px] text-muted-foreground">{current.step_description}</p>
    </div>
  );
}

// ── Live test result card ─────────────────────────────────────────────────────

function LiveTestCard({
  result,
  runId,
  targetUrl,
}: {
  result: LiveTestResult;
  runId?: string;
  targetUrl?: string;
}) {
  const [open, setOpen] = useState(false);

  const statusIcon = {
    running: <Loader2 className="h-4 w-4 animate-spin text-warning" />,
    passed: <CheckCircle2 className="h-4 w-4 text-positive" />,
    failed: <XCircle className="h-4 w-4 text-destructive" />,
    pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  }[result.status];

  const progress =
    result.total_steps > 0
      ? Math.round((result.steps_completed / result.total_steps) * 100)
      : 0;

  return (
    <div
      className="floating-card overflow-hidden rounded-lg"
    >
      {/* Header row */}
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex-shrink-0">{statusIcon}</span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium text-ink">{result.test_name}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums text-ink-tertiary">
            {result.duration_ms && <span>{(result.duration_ms / 1000).toFixed(1)}s</span>}
            <span>
              {result.steps_completed}/{result.total_steps} steps
            </span>
          </div>
        </div>
        {result.status === "running" && <StatusBadge tone="info">Running</StatusBadge>}
        {result.status === "passed" && <StatusBadge tone="success">Passed</StatusBadge>}
        {result.status === "failed" && <StatusBadge tone="critical">Failed</StatusBadge>}
        {open ? (
          <ChevronDown className="ml-1 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="ml-1 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Progress bar (while running) */}
      {result.status === "running" && (
        <Progress value={progress} className="h-1 rounded-none bg-raised" />
      )}

      {/* Expanded content */}
      <>
        {open && (
          <div
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-stroke-muted px-4 pb-4 pt-3">
              {/* Error banner */}
              {result.error && (
                <div className="flex items-start gap-2 rounded-lg border border-stroke-muted bg-raised p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                  <p className="text-xs leading-relaxed text-destructive">{result.error}</p>
                </div>
              )}
              {result.status === "failed" && runId && targetUrl && (
                <HealFailedTest runId={runId} testId={result.test_id} targetUrl={targetUrl} />
              )}
              {result.status === "failed" && (
                <p className="text-xs text-ink-tertiary">
                  Not a selector problem?{" "}
                  <Link to="/root-cause" className="font-medium text-ink underline underline-offset-2 hover:no-underline">
                    Analyse this failure in Root Cause Analysis
                  </Link>
                  , where it is listed under failures awaiting analysis.
                </p>
              )}

              {/* Step list */}
              {result.step_results.map((sr, i) => {
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg bg-raised px-3 py-2 text-xs"
                  >
                    {sr.status === "pass" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-positive mt-0.5 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 flex-shrink-0" />
                    )}
                    <span className={`min-w-0 flex-1 ${sr.status === "fail" ? "text-destructive" : "text-ink-secondary"}`}>
                      {sr.step_description}
                      {sr.status === "fail" && sr.error && (
                        <span className="mt-1 block whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                          {sr.error}
                        </span>
                      )}
                    </span>
                    {sr.screenshot && (
                      <Camera className="h-3.5 w-3.5 text-ink-quaternary flex-shrink-0" />
                    )}
                  </div>
                );
              })}

              {/* Screenshot gallery */}
              <ScreenshotViewer steps={result.step_results} />
            </div>
          </div>
        )}
      </>
    </div>
  );
}

// ── Test Case Type options ────────────────────────────────────────────────────

const TEST_CASE_TYPES = [
  {
    value: "e2e",
    label: "E2E / Functional",
    desc: "Full user journey tests, happy paths, complete workflows",
    prompt: "Generate comprehensive end-to-end functional tests covering complete user workflows from start to finish. Include happy paths and critical user flows.",
  },
  {
    value: "smoke",
    label: "Smoke / Sanity",
    desc: "Quick checks on the most critical app paths",
    prompt: "Generate smoke tests that verify the most critical functionality works. Focus on core features that must work for the app to be usable.",
  },
  {
    value: "regression",
    label: "Regression",
    desc: "Comprehensive suite covering all features and edge cases",
    prompt: "Generate a comprehensive regression test suite covering all major features, user flows, edge cases, and boundary conditions.",
  },
  {
    value: "security",
    label: "Security",
    desc: "Auth flows, input validation, access control tests",
    prompt: "Generate security-focused tests covering authentication, authorization, input validation, and access control. Test for common security vulnerabilities.",
  },
  {
    value: "accessibility",
    label: "Accessibility",
    desc: "WCAG compliance, keyboard nav, ARIA attributes",
    prompt: "Generate accessibility tests that verify WCAG compliance, keyboard navigation, focus management, and proper ARIA attributes.",
  },
  {
    value: "api",
    label: "API / Integration",
    desc: "API calls, data flows, error handling",
    prompt: "Generate integration tests verifying correct API interactions, data flow between components, and proper handling of API responses and errors.",
  },
];

// ── Quick test type chips ─────────────────────────────────────────────────────

const TEST_TYPE_CHIPS = [
  { label: "Auth Flows", icon: Shield, desc: "Login, logout, session, protected routes" },
  { label: "CRUD", icon: ListChecks, desc: "Create, read, update, delete operations" },
  { label: "Navigation", icon: Navigation, desc: "Page routing, links, redirects" },
  { label: "Form Validation", icon: MousePointer, desc: "Input validation, error messages" },
  { label: "Edge Cases", icon: Zap, desc: "Boundary values, empty states, limits" },
  { label: "Error Handling", icon: Bug, desc: "Error pages, failure states, 404s" },
];

function requestErrorDetail(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { detail?: unknown } }; message?: string } | null;
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  return e?.message || fallback;
}

// ── Upload Spec Panel ─────────────────────────────────────────────────────────

function UploadSpecPanel({
  onUpload,
  isParsing,
  errorMsg,
  initialAppUrl,
}: {
  onUpload: (file: File, targetUrl: string, email?: string, password?: string) => void;
  isParsing: boolean;
  errorMsg: string | null;
  initialAppUrl?: string;
}) {
  const [targetUrl, setTargetUrl] = useState(initialAppUrl ?? "");
  const [testEmail, setTestEmail] = useState("");
  const [testPassword, setTestPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isLocalhost = targetUrl.includes("localhost") || targetUrl.includes("127.0.0.1");
  const canRun = selectedFile && targetUrl.trim().startsWith("http") && !isParsing;

  const handleFile = (f: File) => {
    if (f.name.endsWith(".ts") || f.name.endsWith(".js")) {
      setSelectedFile(f);
    } else {
      toast.error(`${f.name} is not a .ts or .js spec file.`);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <Card className="floating-card overflow-hidden rounded-lg border-stroke-muted">
        <CardHeader className="border-b border-stroke-muted bg-container px-4 py-3">
          <CardTitle className={eyebrow}>Upload spec file</CardTitle>
          <p className="text-sm text-ink-tertiary">
            Upload an existing <code className="font-mono text-xs bg-raised px-1 py-0.5 rounded">.spec.ts</code> file. Its tests are parsed and run as written; nothing is generated.
          </p>
        </CardHeader>

        <CardContent className="bg-container p-4 space-y-5">
          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-stroke-muted bg-raised p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <p className="text-xs text-destructive">{errorMsg}</p>
            </div>
          )}

          {/* Drop zone */}
          <div
            className={`relative cursor-pointer rounded-lg border border-dashed transition-colors ${dragOver
                ? "border-stroke bg-raised"
                : selectedFile
                  ? "border-stroke-muted bg-raised"
                  : "border-stroke-muted hover:border-stroke hover:bg-raised"
              }`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".ts,.js,.spec.ts,.spec.js"
              className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
              {selectedFile ? (
                <>
                  <FileCode className="h-5 w-5 text-ink-quaternary" />
                  <div>
                    <p className="font-mono text-sm text-ink">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{(selectedFile.size / 1024).toFixed(1)} KB click to change</p>
                  </div>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5 text-ink-quaternary" />
                  <div>
                    <p className="text-sm font-medium text-ink">Drop your spec file here</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      or click to browse <code className="font-mono">.spec.ts</code> / <code className="font-mono">.spec.js</code>
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Target URL */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
              <Globe className="h-3.5 w-3.5" /> Target App URL
            </label>
            <Input
              placeholder="URL of the running app"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              disabled={isParsing}
              className="h-11 rounded-lg border-stroke-muted bg-container"
            />
            {isLocalhost && targetUrl.trim().length > 10 ? (
              <div className="flex items-start gap-1.5 rounded-lg border border-stroke-muted bg-raised px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" />
                <p className="text-[11px] leading-snug text-warning">
                  Playwright runs <strong>inside the backend</strong>. Your app must be accessible from this machine.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">The app must be running and accessible from this server.</p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-stroke-muted bg-container p-4">
            <p className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Test Credentials (if login is required)</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Input
                type="email"
                placeholder="Test account email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                disabled={isParsing}
                className="h-11 rounded-lg border-stroke-muted bg-container"
              />
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={testPassword}
                  onChange={(e) => setTestPassword(e.target.value)}
                  disabled={isParsing}
                  className="h-11 rounded-lg border-stroke-muted bg-container pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground transition-colors hover:text-ink"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <Eye className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Credentials are inserted into matching username/email/password fill steps before execution.
            </p>
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={!canRun}
            onClick={() => selectedFile && onUpload(selectedFile, targetUrl.trim(), testEmail || undefined, testPassword || undefined)}
          >
            {isParsing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Parsing spec file…</>
            ) : (
              <><FlaskConical className="h-4 w-4 mr-2" />Parse &amp; Preview Tests</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Phase: Input form ─────────────────────────────────────────────────────────

function InputPhase({
  onAnalyze,
  onUploadSpec,
  isAnalyzing,
  isParsing,
  errorMsg,
  initialGithubUrl,
  initialAppUrl,
}: {
  onAnalyze: (
    github: string, target: string, email?: string, password?: string, preferences?: string,
    numTests?: number, mode?: "full" | "commit", commitSha?: string, commitMessage?: string,
    pat?: string,
  ) => void;
  onUploadSpec: (file: File, targetUrl: string, email?: string, password?: string) => void;
  isAnalyzing: boolean;
  isParsing: boolean;
  errorMsg: string | null;
  initialGithubUrl?: string;
  initialAppUrl?: string;
}) {
  // The SDLC Pipeline stage that once supplied a GitHub PAT here was retired; the field is typed in.
  const pipelinePat: string | undefined = undefined;

  const [inputMode, setInputMode] = useState<"ai" | "upload">("ai");
  const { activeRepo, setActiveRepo } = useActiveRepo();
  const [githubUrl, setGithubUrl] = useState(initialGithubUrl || activeRepo?.repoUrl || "");
  const [targetUrl, setTargetUrl] = useState(initialAppUrl ?? "");
  const [testEmail, setTestEmail] = useState("");
  const [testPassword, setTestPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [testPreferences, setTestPreferences] = useState("");
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set());
  const [testCaseType, setTestCaseType] = useState("e2e");
  const [numTests, setNumTests] = useState(1);

  // ── Commit-mode state ────────────────────────────────────────────────────
  const [testingScope, setTestingScope] = useState<"full" | "commit">("full");
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
  const fetchCommits = useFetchCommits();
  const commits: CommitInfo[] = (fetchCommits.data?.commits ?? []) as CommitInfo[];
  const isFetchingCommits = fetchCommits.isPending;

  const handleFetchCommits = () => {
    if (githubUrl.trim().startsWith("https://")) {
      setSelectedCommit(null);
      fetchCommits.mutate({ githubUrl: githubUrl.trim(), pat: pipelinePat });
    }
  };

  const toggleChip = (label: string) => {
    setSelectedChips((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      // Build preferences from chips
      const chipTexts = Array.from(next).map((l) => {
        const chip = TEST_TYPE_CHIPS.find((c) => c.label === l);
        return chip ? `${l}: ${chip.desc}` : l;
      });
      // Merge with any freetext
      const freeText = testPreferences.replace(/^(Auth Flows|CRUD|Navigation|Form Validation|Edge Cases|Error Handling).*\n?/gm, "").trim();
      setTestPreferences([...chipTexts, ...(freeText ? [freeText] : [])].join("\n"));
      return next;
    });
  };

  const isLocalhost = targetUrl.includes("localhost") || targetUrl.includes("127.0.0.1");
  const canSubmit =
    githubUrl.trim().startsWith("https://") &&
    targetUrl.trim().startsWith("http") &&
    (testingScope === "full" || selectedCommit !== null);

  // Upload mode render separate panel
  if (inputMode === "upload") {
    return (
      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <button type="button" aria-pressed={false} onClick={() => setInputMode("ai")} className={cn(pill, pillOff)}>
            Generate from repository
          </button>
          <button type="button" aria-pressed onClick={() => setInputMode("upload")} className={cn(pill, pillOn)}>
            Upload spec file
          </button>
        </div>
        <UploadSpecPanel
          onUpload={onUploadSpec}
          isParsing={isParsing}
          errorMsg={errorMsg}
          initialAppUrl={initialAppUrl}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Mode toggle */}
      <div className="mb-4 flex items-center gap-2">
        <button type="button" aria-pressed onClick={() => setInputMode("ai")} className={cn(pill, pillOn)}>
          Generate from repository
        </button>
        <button type="button" aria-pressed={false} onClick={() => setInputMode("upload")} className={cn(pill, pillOff)}>
          Upload spec file
        </button>
      </div>

      <Card className="rounded-lg border-stroke-muted bg-container">
        <CardHeader className="border-b border-stroke-muted px-4 py-3">
          <CardTitle className={eyebrow}>Run setup</CardTitle>
          <p className="max-w-[80ch] text-sm text-ink-tertiary">
            Provide a GitHub repository and the URL of a running build. The repository is analysed, Playwright
            test cases are generated from it, and they are executed in a browser with screenshots of each step.
          </p>
        </CardHeader>

        <CardContent className="bg-container p-4">
          {errorMsg && (
            <div className="mb-5 flex items-start gap-2 rounded-lg border border-stroke-muted bg-raised p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <p className="text-xs text-destructive">{errorMsg}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
            {/* Left: Configuration */}
            <div className="w-full min-w-0 space-y-5 lg:pr-6 lg:border-r border-stroke-muted">
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
                    <Github className="h-3.5 w-3.5" /> GitHub repository URL
                  </label>
                  <Input
                    placeholder="https://github.com/owner/repo"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    disabled={isAnalyzing}
                    className="h-11 rounded-lg border-stroke-muted bg-container"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    This repository is cloned (shallow) and analysed to generate the tests.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
                    <Globe className="h-3.5 w-3.5" /> Target App URL (running server)
                  </label>
                  <Input
                    placeholder="URL of the running app"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    disabled={isAnalyzing}
                    className="h-11 rounded-lg border-stroke-muted bg-container"
                  />
                  {isLocalhost && targetUrl.trim().length > 10 ? (
                    <div className="mt-1 flex items-start gap-1.5 rounded-lg border border-stroke-muted bg-raised px-3 py-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" />
                      <p className="text-[11px] leading-snug text-warning">
                        Playwright runs <strong>inside the backend</strong>. A local address only works if the
                        app is running on the backend machine at that port.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      The app must be running and accessible from this server.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
                    <Layers className="h-3.5 w-3.5" /> Test Case Type
                  </label>
                  <Select value={testCaseType} onValueChange={setTestCaseType} disabled={isAnalyzing}>
                    <SelectTrigger className="h-11 w-full rounded-lg border-border/60 bg-container hover:border-border focus:ring-primary/20">
                      <SelectValue>
                        {TEST_CASE_TYPES.find((t) => t.value === testCaseType)?.label ?? "Select test type…"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-lg border-border/60 bg-container">
                      {TEST_CASE_TYPES.map((type) => (
                        <SelectItem
                          key={type.value}
                          value={type.value}
                          className="cursor-pointer py-2.5 focus:bg-raised data-[state=checked]:bg-raised"
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-[13px] text-ink">{type.label}</span>
                            <span className="text-[11px] text-muted-foreground leading-snug">{type.desc}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(() => {
                    const sel = TEST_CASE_TYPES.find((t) => t.value === testCaseType);
                    return sel ? (
                      <p className="text-[11px] text-muted-foreground">{sel.desc}</p>
                    ) : null;
                  })()}
                </div>
              </div>

              <div className="space-y-4 border-t border-stroke-muted pt-5">
                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
                    <ListChecks className="h-3.5 w-3.5" /> What to Test
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Optional. Narrows what the generated tests cover.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {TEST_TYPE_CHIPS.map(({ label, icon: Icon }) => (
                      <button
                        key={label}
                        type="button"
                        disabled={isAnalyzing}
                        onClick={() => toggleChip(label)}
                        aria-pressed={selectedChips.has(label)}
                        className={cn("flex items-center gap-1.5", pill, selectedChips.has(label) ? pillOn : pillOff)}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Description</label>
                  <p className="text-[11px] text-muted-foreground">
                    Provide extra context, edge cases, and expected behaviors.
                  </p>
                  <Textarea
                    placeholder="e.g. Focus on authentication flows and form validation. Test happy paths and error cases for task creation."
                    value={testPreferences}
                    onChange={(e) => setTestPreferences(e.target.value)}
                    disabled={isAnalyzing}
                    className="min-h-[110px] resize-none rounded-lg border-stroke-muted bg-container text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Right: Control panel */}
            <div className="flex w-full min-w-0 flex-col gap-4 self-start">
              <div className="rounded-lg border border-stroke-muted bg-container p-4 space-y-3">
                <div className="space-y-1">
                  <p className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Login Credentials</p>
                  <p className="text-[11px] text-muted-foreground">
                    Optional. Used for apps that require sign-in.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-muted-foreground">Email / Username</label>
                    <Input
                      type="email"
                      placeholder="Test account email"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      disabled={isAnalyzing}
                      className="h-11 rounded-lg border-stroke-muted bg-container"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-muted-foreground">Password</label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="Password"
                        value={testPassword}
                        onChange={(e) => setTestPassword(e.target.value)}
                        disabled={isAnalyzing}
                        className="h-11 rounded-lg border-stroke-muted bg-container pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-ink"
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? "hide" : "show"}
                      </button>
                    </div>
                  </div>
                </div>

                {testEmail && (
                  <p className="text-xs text-ink-tertiary">Credentials will be filled into login test steps.</p>
                )}
              </div>

              <div className="rounded-lg border border-stroke-muted bg-container p-4 space-y-3">
                <div className="space-y-1">
                  <p className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Testing Scope</p>
                  <p className="text-[11px] text-muted-foreground">
                    Choose whether to test the entire app or target a commit.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {(["full", "commit"] as const).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => {
                        setTestingScope(scope);
                        setSelectedCommit(null);
                      }}
                        aria-pressed={testingScope === scope}
                        className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${testingScope === scope
                          ? "border-stroke bg-raised-2"
                          : "border-stroke-muted bg-container hover:bg-raised"
                        }`}
                    >
                      {scope === "full" ? (
                        <Workflow className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-tertiary" />
                      ) : (
                        <GitCommit className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-tertiary" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">
                          {scope === "full" ? "Entire app" : "Specific commit"}
                        </p>
                        <p className="text-xs text-ink-tertiary leading-snug mt-0.5">
                          {scope === "full"
                            ? "Analyse the full codebase and generate broad coverage"
                            : "Generate tests based on one commit's changes"}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>

                {testingScope === "commit" && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!githubUrl.trim().startsWith("https://") || isFetchingCommits || isAnalyzing}
                        onClick={handleFetchCommits}
                        className="text-xs h-8"
                      >
                        {isFetchingCommits ? (
                          <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Fetching…</>
                        ) : (
                          <><Clock className="h-3.5 w-3.5 mr-1.5" />Load Recent Commits</>
                        )}
                      </Button>
                      {commits.length > 0 && (
                        <span className="text-[11px] text-muted-foreground">{commits.length}</span>
                      )}
                    </div>

                    {commits.length > 0 && (
                      <div className="rounded-lg border border-stroke-muted bg-container overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-stroke-muted px-3 py-2">
                          <span className={eyebrow}>Recent commits</span>
                          <span className="ml-auto text-xs tabular-nums text-ink-tertiary">{commits.length}</span>
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          {commits.map((c) => (
                            <button
                              key={c.sha}
                              type="button"
                              disabled={isAnalyzing}
                              onClick={() => setSelectedCommit(c)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-stroke-muted last:border-b-0 ${selectedCommit?.sha === c.sha
                                  ? "bg-raised"
                                  : "hover:bg-raised"
                                }`}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate leading-snug text-ink">
                                  {c.message}
                                </p>
                                <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                                  <span className="font-medium text-ink-tertiary">{c.author}</span>
                                  <span>·</span>
                                  <span>{c.relative_date}</span>
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <code className="font-mono text-xs text-ink-tertiary">{c.short_sha}</code>
                                {selectedCommit?.sha === c.sha && (
                                  <Check className="h-3.5 w-3.5 text-ink" />
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedCommit && (
                      <div className="flex items-center gap-2 rounded-lg bg-raised px-3 py-2">
                        <p className="text-xs text-ink-secondary flex-1 min-w-0 truncate">
                          Testing commit <code className="font-mono">{selectedCommit.short_sha}</code>: {selectedCommit.message}
                        </p>
                      </div>
                    )}

                    {fetchCommits.isError && (
                      <p className="text-[11px] text-destructive">
                        Could not load commits: {requestErrorDetail(fetchCommits.error, "check the repository URL and access token.")}
                      </p>
                    )}
                    {fetchCommits.isSuccess && commits.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">No commits were returned for this repository.</p>
                    )}
                    {!fetchCommits.isError && !fetchCommits.isSuccess && !selectedCommit && commits.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Enter a GitHub URL, then load and select a commit.
                      </p>
                    )}
                    {!selectedCommit && commits.length > 0 && (
                      <p className="text-[11px] text-warning flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" /> Select a commit to continue.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-stroke-muted bg-container p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Number of Tests</p>
                    <p className="text-[11px] text-muted-foreground">How many test cases to generate (1–10)</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isAnalyzing || numTests <= 1}
                      onClick={() => setNumTests((v) => Math.max(1, v - 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-sm text-ink hover:bg-raised disabled:opacity-40"
                    >−</button>
                    <span className="w-6 text-center text-sm font-semibold tabular-nums">{numTests}</span>
                    <button
                      type="button"
                      disabled={isAnalyzing || numTests >= 10}
                      onClick={() => setNumTests((v) => Math.min(10, v + 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-sm text-ink hover:bg-raised disabled:opacity-40"
                    >+</button>
                  </div>
                </div>
              </div>

              <div className="mt-auto pt-1">
                <Button
                  className="w-full"
                  size="lg"
                  disabled={!canSubmit || isAnalyzing}
                  onClick={() => {
                    const typeObj = TEST_CASE_TYPES.find((t) => t.value === testCaseType);
                    const typePrefix = typeObj ? `TEST CASE TYPE: ${typeObj.label} ${typeObj.prompt}` : "";
                    const combinedPrefs = [typePrefix, testPreferences.trim()].filter(Boolean).join("\n\n");
                    setActiveRepo(githubUrl.trim());
                    onAnalyze(
                      githubUrl.trim(),
                      targetUrl.trim(),
                      testEmail || undefined,
                      testPassword || undefined,
                      combinedPrefs || undefined,
                      numTests,
                      testingScope,
                      selectedCommit?.sha,
                      selectedCommit?.message,
                      undefined, // Explicitly pass undefined for PAT if not in pipeline context, or we'll get it from context in LiveTestRunner
                    );
                  }}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {testingScope === "commit" ? "Running on commit…" : "Running…"}
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Generate and run tests
                    </>
                  )}
                </Button>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Disabled until repo + target URL are provided{testingScope === "commit" ? " and a commit is selected" : ""}.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Step progress indicator ───────────────────────────────────────────────────

const STEPS = [
  { key: "cloning", label: "Cloning repository" },
  { key: "extracting", label: "Extracting source files" },
  { key: "analyzing", label: "AI analysing codebase" },
  { key: "generating", label: "Generating Playwright tests" },
];

function stepIndex(step: string): number {
  return STEPS.findIndex((s) => s.key === step);
}

// ── Phase: Analysing live log viewer ───────────────────────────────────────

function AnalyzingPhase({
  jobData,
  slow,
}: {
  jobData: ReturnType<typeof useLiveTesting>["jobData"];
  slow?: boolean;
}) {
  const logs: string[] = jobData?.logs ?? [];
  const currentStep = jobData?.step ?? "pending";
  const currentIdx = stepIndex(currentStep);

  const getLogLineClassName = (line: string) => {
    const trimmed = line.trimStart();

    if (trimmed.startsWith("✓")) return "text-positive";
    if (trimmed.startsWith("Step")) return "text-ink font-medium";

    if (trimmed.startsWith("✗")) {
      const rest = trimmed.slice(1).trimStart();
      const hasErrorKeywords = /\b(error|failed|failure|exception|traceback|fatal)\b/i.test(rest);
      const looksLikePath = /^(~?\/|[A-Za-z]:\\)/.test(rest);

      return !hasErrorKeywords && looksLikePath ? "text-ink-secondary" : "text-destructive";
    }

    return "text-ink-secondary";
  };

  return (
    <div
      className="max-w-xl mx-auto space-y-5"
    >
      <div className="text-center space-y-1">
        <h2 className="flex items-center justify-center gap-2 text-sm font-medium text-ink">
          <Loader2 className="h-4 w-4 animate-spin text-ink-tertiary" />
          Analysing codebase…
        </h2>
        <p className="text-xs text-ink-tertiary">
          {slow
            ? "Still generating. This usually finishes within 2 minutes. You can wait, or cancel and retry with 1 test."
            : "This takes 30–90 seconds. Do not close the page."}
        </p>
      </div>

      {/* Step progress */}
      <div className="space-y-2">
        {STEPS.map((s, i) => {
          const done = i < currentIdx || currentStep === "completed";
          const active = i === currentIdx;
          return (
            <div key={s.key} className={`flex items-center gap-3 text-sm rounded-lg px-3 py-2.5 border transition-colors ${done ? "border-stroke-muted bg-container" :
                active ? "border-stroke bg-raised" :
                  "border-stroke-muted bg-transparent text-ink-quaternary"
              }`}>
              {done ? (
                <CheckCircle2 className="h-4 w-4 text-positive flex-shrink-0" />
              ) : active ? (
                <Loader2 className="h-4 w-4 text-ink-tertiary animate-spin flex-shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-stroke-muted flex-shrink-0" />
              )}
              <span className={active ? "text-ink font-medium" : done ? "text-ink-secondary" : ""}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Live log terminal */}
      {logs.length > 0 && (
        <div className="rounded-lg border border-stroke-muted bg-raised overflow-hidden">
          <div className="border-b border-stroke-muted px-3 py-2">
            <span className={eyebrow}>Analysis log</span>
          </div>
          <div className="p-3 space-y-0.5 max-h-52 overflow-y-auto font-mono text-ink">
            {logs.map((line, i) => (
              <p
                key={i}
                className={`text-[11px] leading-relaxed ${getLogLineClassName(line)}`}
              >
                {line}
              </p>
            ))}
            {/* Blinking cursor */}
            <span className="inline-block h-3 w-1.5 bg-status-neutral animate-pulse" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Phase: Ready (show analysis + tests, allow run) ───────────────────────────

function ReadyPhase({
  analysis,
  editedTests,
  onExecute,
  onReset,
  isExecuting,
  errorMsg,
  specTargetUrl,
  onSpecTargetUrlChange,
  runAuth,
  onRunAuthChange,
  baselineTests = [],
  selectedBaselineIds = new Set(),
  onBaselineToggle,
}: {
  analysis: NonNullable<ReturnType<typeof useLiveTesting>["analysis"]>;
  editedTests: PlaywrightTestCase[] | null;
  onExecute: (combinedTests?: PlaywrightTestCase[]) => void;
  onReset: () => void;
  isExecuting: boolean;
  errorMsg: string | null;
  specTargetUrl?: string | null;
  onSpecTargetUrlChange?: (url: string) => void;
  runAuth?: { email?: string; password?: string } | null;
  onRunAuthChange?: (auth: { email?: string; password?: string } | null) => void;
  baselineTests?: BaselineTest[];
  selectedBaselineIds?: Set<string>;
  onBaselineToggle?: (checked: boolean) => void;
}) {
  const tests = editedTests ?? analysis.tests;
  const isSpecUpload = analysis.analysis_id.startsWith("spec-");
  // Tests that came from an upload or another page carry no target or account of
  // their own, so both are asked for here before the run.
  const needsRunSetup = isLocalAnalysis(analysis.analysis_id);
  const targetMissing = needsRunSetup && !/^https?:\/\/\S+$/i.test((specTargetUrl ?? "").trim());

  // Map PlaywrightTestCase to WorkspacePlaywrightTest for UnifiedTestIntelligence
  const sessionMapped: WorkspacePlaywrightTest[] = tests.map(t => ({
    id: t.id,
    analysis_id: analysis.analysis_id,
    name: t.name,
    description: t.description,
    page_name: t.page_name,
    severity: t.severity,
    steps: t.steps,
    source: isSpecUpload ? "baseline" : "session"
  } as any));

  const baselineMapped: WorkspacePlaywrightTest[] = baselineTests
    .filter(bt => selectedBaselineIds.has(bt.test_id))
    .map(bt => ({
      id: bt.test_id,
      analysis_id: "baseline",
      name: bt.name,
      description: bt.description,
      page_name: bt.page_path || "/",
      severity: bt.severity,
      steps: bt.steps.map(s => ({
        action: s.action,
        selector: s.target,
        value: s.value,
        description: s.assertion || ""
      })),
      source: "baseline"
    } as any));

  const mappedTests = [...sessionMapped, ...baselineMapped];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-stroke-muted bg-container px-4 py-3">
        <div className="min-w-0">
          <p className={eyebrow}>Tech stack</p>
          <p className="mt-1 truncate font-mono text-xs text-ink-secondary">{analysis.tech_stack}</p>
        </div>
        <div>
          <p className={eyebrow}>Tests ready</p>
          <p className="mt-1 text-sm tabular-nums text-ink">{mappedTests.length}</p>
        </div>
        {analysis.tests_source === "fallback" && (
          <StatusBadge tone="warning" title="Generation timed out or returned no tests, so template tests are shown instead.">
            Template tests
          </StatusBadge>
        )}

        {baselineTests.length > 0 && (
          <div>
            <Label htmlFor="baseline-toggle-ltr" className={cn(eyebrow, "cursor-pointer")}>
              Include baseline tests
            </Label>
            <div className="mt-1 flex items-center gap-2">
              <Switch
                id="baseline-toggle-ltr"
                checked={selectedBaselineIds.size > 0}
                onCheckedChange={onBaselineToggle}
              />
              <span className="text-xs tabular-nums text-ink-tertiary">{selectedBaselineIds.size} selected</span>
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={onReset} disabled={isExecuting}>
            New session
          </Button>
          <Button className="gap-2" onClick={() => onExecute(mappedTests as any)} disabled={isExecuting || targetMissing} title={targetMissing ? "Enter the URL of the running app first" : undefined}>
            {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run tests
          </Button>
        </div>
      </div>

      {analysis.summary && (
        <div className="rounded-lg border border-stroke-muted bg-container px-4 py-3">
          <p className={eyebrow}>Summary</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{analysis.summary}</p>
        </div>
      )}

      {needsRunSetup && (
        <div className="grid gap-4 rounded-lg border border-stroke-muted bg-container p-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="ltr-run-target" className={cn(eyebrow, "block")}>Target app URL</label>
            <Input
              id="ltr-run-target"
              type="url"
              placeholder="URL of the running app"
              value={specTargetUrl ?? ""}
              onChange={(e) => onSpecTargetUrlChange?.(e.target.value)}
              disabled={isExecuting}
            />
            <p className="text-xs text-ink-tertiary">Required before these tests can run.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ltr-run-email" className={cn(eyebrow, "block")}>Test account email (optional)</label>
            <Input
              id="ltr-run-email"
              autoComplete="off"
              value={runAuth?.email ?? ""}
              onChange={(e) => onRunAuthChange?.({ ...runAuth, email: e.target.value || undefined })}
              disabled={isExecuting}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ltr-run-password" className={cn(eyebrow, "block")}>Test account password (optional)</label>
            <Input
              id="ltr-run-password"
              type="password"
              autoComplete="new-password"
              value={runAuth?.password ?? ""}
              onChange={(e) => onRunAuthChange?.({ ...runAuth, password: e.target.value || undefined })}
              disabled={isExecuting}
            />
            <p className="text-xs text-ink-tertiary">
              Typed into the login fields of these tests during the run. Not stored and not sent to the AI model.
            </p>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg border border-stroke-muted bg-container px-4 py-3">
          <p className="text-sm text-destructive">{errorMsg}</p>
        </div>
      )}

      <div className="space-y-3">
        <h2 className={eyebrow}>Tests to run</h2>
        <UnifiedTestIntelligence tests={mappedTests} />
      </div>
    </div>
  );
}

// ── Phase: Executing + Done ───────────────────────────────────────────────────

function ExecutionPhase({
  runStatus,
  onReset,
  phase,
  analysis,
  targetUrl,
}: {
  runStatus: ReturnType<typeof useLiveTesting>["runStatus"];
  onReset: () => void;
  phase: LiveTestingPhase;
  analysis?: RepoAnalysisResult | null;
  targetUrl?: string;
}) {
  if (!runStatus) {
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-sm text-ink-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Starting the run…
      </p>
    );
  }

  const { results, total, passed, failed, status } = runStatus;
  const completedCount = results.filter((r) => r.status === "passed" || r.status === "failed").length;
  const progressPercent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const successRatePercent = total > 0 ? Math.round((passed / total) * 100) : 0;

  const runningTest = results.find((r) => r.status === "running");
  const latestFrame = runningTest?.step_results.slice().reverse().find((s) => s.screenshot)?.screenshot ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stroke-muted bg-container">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <StatusBadge tone={status === "running" ? "info" : failed > 0 ? "critical" : "success"}>
            {status === "running" ? "Running" : "Finished"}
          </StatusBadge>
          <span className="min-w-0 truncate text-sm text-ink-secondary">
            {status === "running"
              ? runningTest
                ? runningTest.test_name
                : "Preparing the browser"
              : "All tests have finished"}
          </span>
          <span className="ml-auto text-xs tabular-nums text-ink-tertiary">
            {completedCount} of {total}
          </span>
          {phase === "done" && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  try {
                    downloadLiveTestReport(runStatus!, analysis);
                  } catch {
                    toast.error("Could not generate the report PDF.");
                  }
                }}
              >
                <Download className="h-4 w-4" /> Download report
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={onReset}>
                <RotateCcw className="h-4 w-4" /> New session
              </Button>
            </div>
          )}
        </div>
        {status === "running" && <Progress value={progressPercent} className="h-0.5 rounded-none bg-raised-2" />}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiStat mark="mark-kpi-pass-rate"
          label={status === "running" ? "Progress" : "Pass rate"}
          value={`${status === "running" ? progressPercent : successRatePercent}%`}
          hint={status === "running" ? `${completedCount} of ${total} finished` : `of ${total} tests`}
        />
        <KpiStat mark="mark-kpi-passed" label="Passed" value={passed} />
        <KpiStat mark="mark-kpi-failed" label="Failed" value={failed} />
        <KpiStat mark="mark-test-suite" label="Total" value={total} />
      </div>

      {/* Live browser view */}
      <div className="overflow-hidden rounded-lg border border-stroke-muted bg-container">
        <div className="flex h-11 items-center gap-3 border-b border-stroke-muted px-4">
          <h2 className={eyebrow}>Browser</h2>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-tertiary">
            {runningTest ? runningTest.test_name : ""}
          </span>
        </div>
        <div className="relative flex aspect-video min-h-[400px] items-center justify-center bg-raised">
          {latestFrame ? (
            <img
              key={latestFrame.slice(-20)}
              src={`data:image/png;base64,${latestFrame}`}
              alt="Live browser feed"
              className="h-full w-full object-contain"
            />
          ) : (
            <p className="flex items-center gap-2 text-sm text-ink-tertiary">
              {status === "running" && <Loader2 className="h-4 w-4 animate-spin" />}
              {status === "running" ? "Waiting for the first screenshot…" : "No screenshot to show."}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className={eyebrow}>Results</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {results.map((r) => (
            <LiveTestCard
              key={r.test_id}
              result={r}
              runId={runStatus.run_id}
              targetUrl={targetUrl || analysis?.target_url || undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

// ── Run Detail Sheet ──────────────────────────────────────────────────────────

function RunDetailSheet({ run, open, onClose }: { run: RunSummaryItem | null; open: boolean; onClose: () => void }) {
  if (!run) return null;
  const rate = run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;
  const durationSec = run.started_at && run.completed_at
    ? ((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)
    : null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col border-l border-stroke-muted bg-container p-0 sm:max-w-2xl">
        {/* Header */}
        <SheetHeader className="border-b border-stroke-muted bg-container px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <SheetTitle className="text-base font-semibold text-ink">Test run details</SheetTitle>
              <StatusBadge tone={run.status === "completed" ? "success" : run.status === "failed" ? "critical" : "info"} className="capitalize">
                {run.status}
              </StatusBadge>
            </div>
            {run.status !== "running" && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs flex-shrink-0"
                onClick={() => {
                  try {
                    downloadRunSummaryReport(run);
                  } catch {
                    toast.error("Could not generate the report PDF.");
                  }
                }}
              >
                <Download className="h-4 w-4 mr-1.5" /> Download PDF
              </Button>
            )}
          </div>
          <SheetDescription asChild>
            <div className="mt-1">
              <code className="text-xs font-mono text-ink-tertiary">{run.run_id}</code>
            </div>
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-5 space-y-6">
            {/* Stats cards */}
            <div className="grid grid-cols-4 gap-3">
              <KpiStat mark="mark-test-suite" label="Total" value={run.total} />
              <KpiStat mark="mark-kpi-passed" label="Passed" value={run.passed} />
              <KpiStat mark="mark-kpi-failed" label="Failed" value={run.failed} />
              <KpiStat mark="mark-kpi-pass-rate" label="Pass rate" value={`${rate}%`} />
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="h-1.5 rounded-full bg-raised-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${rate >= 80 ? "bg-status-success" : rate >= 50 ? "bg-status-warning" : "bg-status-critical"}`}
                  style={{ width: `${rate}%` }}
                />
              </div>
            </div>

            {/* Meta info */}
            <div className="rounded-lg border border-stroke-muted bg-container divide-y divide-border/60">
              {[
                { label: "Status", value: run.status },
                run.started_at ? { label: "Started", value: new Date(run.started_at).toLocaleString() } : null,
                run.completed_at ? { label: "Completed", value: new Date(run.completed_at).toLocaleString() } : null,
                durationSec ? { label: "Duration", value: `${durationSec}s` } : null,
              ].filter(Boolean).map((item) => (
                <div key={item!.label} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-xs text-ink-tertiary">{item!.label}</span>
                  <span className="text-xs tabular-nums text-ink capitalize">{item!.value}</span>
                </div>
              ))}
            </div>

            <Separator />

            {/* Test results */}
            <div className="space-y-3">
              <h3 className={eyebrow}>
                Test results <span className="tabular-nums">({run.results?.length ?? 0})</span>
              </h3>
              {run.results && run.results.length > 0 ? (
                <div className="space-y-2">
                  {run.results.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-lg border border-stroke-muted bg-container px-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.test_name}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {r.duration_ms && (
                          <span className="font-mono text-xs tabular-nums text-ink-tertiary">
                            {(r.duration_ms / 1000).toFixed(1)}s
                          </span>
                        )}
                        <StatusBadge
                          tone={r.status === "passed" ? "success" : r.status === "failed" ? "critical" : "neutral"}
                          className="capitalize"
                        >
                          {r.status}
                        </StatusBadge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-stroke-muted bg-container p-6 text-center text-sm text-ink-tertiary">
                  No detailed results available for this run.
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ── Run history panel (shown on idle screen) ─────────────────────────────────

function RunHistoryPanel() {
  const { data, isLoading, isError, refetch } = useRunHistory();
  const runs: RunSummaryItem[] = data?.runs ?? [];
  const [selectedRun, setSelectedRun] = useState<RunSummaryItem | null>(null);

  if (isLoading) {
    return <EmptyState kind="loading" className="mt-6">Loading recent test runs…</EmptyState>;
  }
  if (isError) {
    return (
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3 rounded-lg border border-stroke-muted bg-container px-4 py-3">
        <p className="text-sm text-destructive">Could not load recent test runs.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }
  if (runs.length === 0) return null;

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-stroke-muted bg-container">
      <div className="flex h-11 items-center justify-between border-b border-stroke-muted px-4">
        <h2 className={eyebrow}>Recent test runs</h2>
        <span className="text-xs tabular-nums text-ink-tertiary">{runs.length} runs</span>
      </div>

      <div className="divide-y divide-border/60">
        {runs.slice(0, 10).map((run) => {
          const rate = run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;
          return (
            <div key={run.run_id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-raised">
              {/* Status dot */}
              <span className={`h-2 w-2 rounded-full flex-shrink-0 ${run.status === "completed" ? "bg-status-success" :
                  run.status === "failed" ? "bg-status-critical" :
                    "bg-status-info animate-pulse"
                }`} />

              {/* Commit-hash style run ID */}
              <code className="font-mono text-xs text-ink-tertiary flex-shrink-0">
                {run.run_id.slice(0, 7)}
              </code>

              {/* Pass rate bar */}
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-raised-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${rate >= 80 ? "bg-status-success" : rate >= 50 ? "bg-status-warning" : "bg-status-critical"}`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-ink-tertiary flex-shrink-0">
                    {run.passed}/{run.total} passed
                  </span>
                </div>
              </div>

              {/* Date */}
              {run.started_at && (
                <span className="text-xs text-ink-tertiary flex-shrink-0 hidden sm:block">
                  {new Date(run.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}

              {/* View details button */}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs flex-shrink-0"
                onClick={() => setSelectedRun(run)}
              >
                View
              </Button>
            </div>
          );
        })}
      </div>

      {/* Detail sheet */}
      <RunDetailSheet
        run={selectedRun}
        open={selectedRun !== null}
        onClose={() => setSelectedRun(null)}
      />
    </div>
  );
}

// ── sessionStorage prefill (from ViewEntryTree "Run Test Cases" wizard) ────────

interface LtrPrefill {
  appUrl?: string;
  githubUrl?: string;
  generatedTests?: WorkspacePlaywrightTest[];
}

function readAndClearPrefill(): LtrPrefill | null {
  try {
    const raw = sessionStorage.getItem("ltr_prefill");
    if (!raw) return null;
    sessionStorage.removeItem("ltr_prefill");
    return JSON.parse(raw) as LtrPrefill;
  } catch {
    return null;
  }
}

export default function LiveTestRunner({
  onRunComplete,
  initialGithubUrl,
  initialAppUrl,
  embedded = false,
}: {
  onRunComplete?: (summary: { passed: number; failed: number; total: number; pass_rate: number }) => void;
  initialGithubUrl?: string;
  initialAppUrl?: string;
  /** Rendered inside another screen (the pipeline's Live Tests stage) that already has a title. */
  embedded?: boolean;
} = {}) {
  const pipelinePat: string | undefined = undefined;

  // Read sessionStorage prefill once on mount (from ViewEntryTree wizard)
  const prefill = useMemo(() => readAndClearPrefill(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveGithubUrl = initialGithubUrl ?? prefill?.githubUrl;
  const effectiveAppUrl = initialAppUrl ?? prefill?.appUrl;

  const {
    phase,
    jobData,
    analysis,
    editedTests,
    runStatus,
    errorMsg,
    handleAnalyze,
    handleExecute,
    handleExecuteDirect,
    handleUploadSpec,
    reset,
    specTargetUrl,
    setSpecTargetUrl,
    runAuth,
    setRunAuth,
    isStarting,
    isExecuting,
    isParsingSpec,
    setPhase,
    setAnalysis,
    setEditedTests,
    analyzingSlow,
  } = useLiveTesting();

  const activeTargetUrlRef = useRef<string>(effectiveAppUrl || "");

  useEffect(() => {
    const tests = prefill?.generatedTests;
    if (!tests?.length) return;
    const mapped: PlaywrightTestCase[] = tests.map((t) => ({
      id: t.id,
      analysis_id: t.analysis_id || "workspace-handoff",
      name: t.name,
      description: t.description,
      page_name: t.page_name,
      severity: t.severity,
      steps: t.steps.map((s) => ({
        action: (s.action as PlaywrightTestCase["steps"][number]["action"]) || "click",
        selector: s.selector,
        value: s.value,
        description: s.description,
      })),
    }));
    const target = effectiveAppUrl || "";
    setAnalysis({
      analysis_id: "workspace-handoff",
      target_url: target,
      summary: `${mapped.length} test${mapped.length === 1 ? "" : "s"} handed off to run`,
      tech_stack: "Playwright (handed off)",
      pages: [],
      user_flows: [],
      tests: mapped,
    });
    setEditedTests(mapped);
    if (target) setSpecTargetUrl(target);
    setPhase("ready");
  }, [prefill, effectiveAppUrl, setAnalysis, setEditedTests, setSpecTargetUrl, setPhase]);

  const [showSuiteSelector, setShowSuiteSelector] = useState(false);
  const [baselineTests, setBaselineTests] = useState<BaselineTest[]>([]);
  const [selectedBaselineIds, setSelectedBaselineIds] = useState<Set<string>>(new Set());
  const [baselineSearch, setBaselineSearch] = useState("");
  const [activePageFilter, setActivePageFilter] = useState<string>("All");

  // Fire onRunComplete once when run transitions to done
  const filteredBaselines = baselineTests.filter(bt => {
    const matchSearch = bt.name.toLowerCase().includes(baselineSearch.toLowerCase()) ||
      bt.description?.toLowerCase().includes(baselineSearch.toLowerCase());
    const matchPage = activePageFilter === "All" || bt.page_path === activePageFilter;
    return matchSearch && matchPage;
  });

  const uniquePages = Array.from(new Set(baselineTests.map(t => t.page_path || "/"))).sort();

  useEffect(() => {
    if (phase !== "done" || !runStatus || !onRunComplete) return;
    const t = runStatus.total ?? 0;
    const p = runStatus.passed ?? 0;
    const f = runStatus.failed ?? 0;
    const key = `${runStatus.run_id}-reported`;
    if (t > 0 && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      onRunComplete({ passed: p, failed: f, total: t, pass_rate: Math.round((p / t) * 100) });
    }
  }, [phase, runStatus, onRunComplete]);

  const Shell = embedded ? EmbeddedShell : PageShell;

  return (
    <Shell>
      {!embedded && (
        <PageHeader
          title="Live Test Run"
          description="Generate Playwright tests from a repository, or upload a spec file, and run them in a real browser against a running build."
        />
      )}

      <div className="relative">
          <>
            {phase === "idle" && (
              <InputPhase
                key="input"
                onAnalyze={async (g, t, e, p, prefs, numTests, mode, sha, msg, pat) => {
                  activeTargetUrlRef.current = t;
                  handleAnalyze(g, t, e, p, prefs, numTests, mode, sha, msg, pat || pipelinePat);
                  
                  // Look up saved baseline tests so they can be added to the run later.
                  // A repository that was never scanned answers 404: no baseline, not a failure.
                  try {
                    const repoId = await api.getRepoId(g);
                    const repoData = await baselineApi.getRepoTests(repoId);
                    setBaselineTests(repoData?.tests ?? []);
                    setSelectedBaselineIds(new Set());
                  } catch (err) {
                    setBaselineTests([]);
                    setSelectedBaselineIds(new Set());
                    if ((err as { response?: { status?: number } })?.response?.status !== 404) {
                      toast.error("Could not load this repository's saved baseline tests, so they cannot be added to this run.");
                    }
                  }
                }}
                onUploadSpec={(file, targetUrl, email, password) => handleUploadSpec(file, targetUrl, email, password)}
                isAnalyzing={isStarting}
                isParsing={isParsingSpec}
                errorMsg={errorMsg}
                initialGithubUrl={effectiveGithubUrl}
                initialAppUrl={effectiveAppUrl}
              />
            )}

            {phase === "analyzing" && (
              <AnalyzingPhase key="analyzing" jobData={jobData} slow={analyzingSlow} />
            )}

            {phase === "ready" && analysis && (
              <ReadyPhase
                key="ready"
                analysis={analysis}
                editedTests={editedTests}
                onExecute={(combined) => {
                  if (combined && selectedBaselineIds.size > 0) {
                    const target = analysis.tech_stack.includes("Spec") 
                      ? (specTargetUrl || "") 
                      : (analysis.target_url || activeTargetUrlRef.current);
                    // No credentials passed here: the hook applies the test account entered
                    // on the form to the baseline tests in this combined run.
                    handleExecuteDirect(combined as any, target);
                  } else {
                    handleExecute();
                  }
                }}
                onReset={reset}
                isExecuting={isExecuting}
                errorMsg={errorMsg}
                specTargetUrl={specTargetUrl}
                onSpecTargetUrlChange={setSpecTargetUrl}
                runAuth={runAuth}
                onRunAuthChange={setRunAuth}
                baselineTests={baselineTests}
                selectedBaselineIds={selectedBaselineIds}
                onBaselineToggle={(checked) => {
                  if (checked) setShowSuiteSelector(true);
                  else setSelectedBaselineIds(new Set());
                }}
              />
            )}

            {(phase === "executing" || phase === "done") && (
              <ExecutionPhase
                key="execution"
                runStatus={runStatus}
                onReset={reset}
                phase={phase}
                analysis={analysis}
                targetUrl={analysis?.target_url || specTargetUrl || activeTargetUrlRef.current}
              />
            )}
          </>

          {phase === "idle" && <RunHistoryPanel />}

          {/* ── Baseline Suite Selection Modal ────────────────────────────────────── */}
          <Dialog open={showSuiteSelector} onOpenChange={setShowSuiteSelector}>
            <DialogContent className="max-w-5xl p-0 overflow-hidden border-stroke-muted rounded-lg">
              <div className="p-4 border-b border-stroke-muted">
                <DialogHeader>
                  <DialogTitle className="text-base font-semibold text-ink">Baseline tests for this repository</DialogTitle>
                  <DialogDescription className="text-sm text-ink-tertiary">
                    <span className="tabular-nums text-ink">{baselineTests.length}</span> saved baseline tests were found for this repository. Select the ones to run together with the tests already listed.
                  </DialogDescription>
                </DialogHeader>

                <div className="mt-4">

                  <div className="flex items-center gap-3">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-quaternary" />
                      <Input
                        placeholder="Filter by name or description"
                        className="pl-9"
                        value={baselineSearch}
                        onChange={(e) => setBaselineSearch(e.target.value)}
                      />
                    </div>

                    <Select value={activePageFilter} onValueChange={setActivePageFilter}>
                      <SelectTrigger className="w-[240px]">
                        <SelectValue placeholder="Filter by page" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="All">All pages</SelectItem>
                        {uniquePages.map(page => (
                          <SelectItem key={page} value={page}>
                            {page === "/" ? "App root" : page.replace(/^\//, "")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="px-4 py-4">
                <ScrollArea className="h-[450px] pr-4">
                  <div className="space-y-3">
                    {filteredBaselines.length === 0 ? (
                      <EmptyState kind="noResults">
                        No baseline tests match this filter.
                      </EmptyState>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {filteredBaselines.map(bt => {
                          const isSelected = selectedBaselineIds.has(bt.test_id);
                          return (
                            <div
                              key={bt.test_id}
                              className={cn(
                                "flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors cursor-pointer",
                                isSelected
                                  ? "bg-raised-2 border-stroke"
                                  : "bg-container border-stroke-muted hover:bg-raised"
                              )}
                              onClick={() => {
                                setSelectedBaselineIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(bt.test_id)) next.delete(bt.test_id);
                                  else next.add(bt.test_id);
                                  return next;
                                });
                              }}
                            >
                              <Checkbox
                                id={bt.test_id}
                                checked={isSelected}
                                className="mt-0.5"
                              />
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="min-w-0 truncate text-sm font-medium text-ink">
                                    {bt.name}
                                  </span>
                                  <StatusBadge
                                    tone={bt.severity.toLowerCase() === "critical" ? "critical" : bt.severity.toLowerCase() === "high" ? "warning" : "neutral"}
                                    className="capitalize"
                                  >
                                    {bt.severity}
                                  </StatusBadge>
                                </div>
                                <p className="font-mono text-xs text-ink-tertiary">{bt.page_path || "/"}</p>
                                {bt.description && (
                                  <p className="text-xs text-ink-tertiary line-clamp-1">{bt.description}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-stroke-muted px-4 py-3">
                <span className="text-sm text-ink-secondary">
                  <span className="tabular-nums text-ink">{selectedBaselineIds.size}</span> selected
                </span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedBaselineIds(new Set())}>
                  Clear selection
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedBaselineIds(new Set(baselineTests.map(t => t.test_id)))}>
                  Select all
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedBaselineIds(new Set());
                      setShowSuiteSelector(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={() => setShowSuiteSelector(false)}>
                    {selectedBaselineIds.size > 0
                      ? `Add ${selectedBaselineIds.size} test${selectedBaselineIds.size === 1 ? "" : "s"} to this run`
                      : "Done"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
    </Shell>
  );
}

/** Used in place of PageShell when another screen already supplies the page frame. */
function EmbeddedShell({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}
