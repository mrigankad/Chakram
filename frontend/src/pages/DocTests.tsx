import { apiErrorMessage } from "@/lib/api-error";
import React, { useState, useRef, useCallback } from "react";
import { FileIcon } from "@/components/FileIcon";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Loader2,
  X,
  Download,
  Pencil,
  Play,
  Save,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  useUploadDoc,
  useGenerateFromDocs,
} from "@/hooks/use-impact";
import type {
  DocScenario,
  ImpactPlaywrightTest,
  ImpactPlaywrightStep,
} from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { TestSuiteTabs } from "@/components/TestSuiteTabs";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";

// ── Drag-and-Drop Upload Zone ─────────────────────────────────────────────────

interface UploadZoneProps {
  onFile: (file: File) => void;
  isLoading: boolean;
  acceptedFile: File | null;
  onClear: () => void;
}

function UploadZone({ onFile, isLoading, acceptedFile, onClear }: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (acceptedFile) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-stroke-muted bg-raised px-4 py-3">
        <FileText className="h-4 w-4 shrink-0 text-ink-tertiary" />
        <div className="flex-1 min-w-0">
          <p className="truncate font-medium text-sm text-ink">{acceptedFile.name}</p>
          <p className="text-xs tabular-nums text-ink-tertiary">{formatSize(acceptedFile.size)}</p>
        </div>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            onClick={onClear}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 transition-colors cursor-pointer ${
        dragOver
          ? "border-stroke bg-raised"
          : "border-border hover:border-stroke hover:bg-raised"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <Upload className="mb-3 h-4 w-4 text-ink-quaternary" />
      <p className="font-medium text-sm text-ink">Drop a document here, or click to choose one</p>
      <p className="mt-1 text-xs text-ink-tertiary">
        PDF, DOCX, TXT, Markdown, OpenAPI/JSON up to 10 MB
      </p>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".txt,.md,.markdown,.json,.yaml,.yml,.pdf,.docx,.csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

// ── Scenario Card ─────────────────────────────────────────────────────────────

function ScenarioCard({
  scenario,
  index,
}: {
  scenario: DocScenario;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const priorityTone: Record<string, StatusTone> = {
    high: "critical",
    medium: "warning",
    low: "neutral",
  };

  return (
    <div className="overflow-hidden rounded-lg border border-stroke-muted bg-container">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-ink-tertiary">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-ink">{scenario.title}</p>
          <p className="mt-0.5 truncate text-xs text-ink-tertiary">{scenario.description}</p>
        </div>
        <StatusBadge tone={priorityTone[scenario.priority] ?? "neutral"} className="capitalize">
          {scenario.priority}
        </StatusBadge>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-ink-quaternary" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-quaternary" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-stroke-muted px-4 pb-4 pt-3">
          <p className={`mb-2 ${eyebrow}`}>Acceptance criteria</p>
          <ul className="space-y-1">
            {scenario.acceptance_criteria.map((criterion, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-ink-secondary">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-status-neutral" />
                {criterion}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Live Runner-style test card ──────────────────────────────────────────────

const severityTone: Record<string, StatusTone> = {
  Critical: "critical",
  High: "warning",
  Medium: "pending",
  Low: "neutral",
};

function stepActionLabel(action: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    navigate: { label: "Navigate", color: "text-ink-tertiary" },
    click: { label: "Click", color: "text-ink-tertiary" },
    fill: { label: "Fill", color: "text-ink-tertiary" },
    assert_text: { label: "Assert", color: "text-ink-tertiary" },
    screenshot: { label: "Screenshot", color: "text-ink-tertiary" },
    wait: { label: "Wait", color: "text-ink-tertiary" },
    hover: { label: "Hover", color: "text-ink-tertiary" },
    hover_and_click: { label: "Hover+Click", color: "text-ink-tertiary" },
    press: { label: "Press", color: "text-ink-tertiary" },
    check: { label: "Check", color: "text-ink-tertiary" },
    uncheck: { label: "Uncheck", color: "text-ink-tertiary" },
    select_option: { label: "Select", color: "text-ink-tertiary" },
    drag_and_drop: { label: "Drag", color: "text-ink-tertiary" },
    dblclick: { label: "DblClick", color: "text-ink-tertiary" },
    type_into: { label: "Type", color: "text-ink-tertiary" },
    scroll: { label: "Scroll", color: "text-ink-tertiary" },
    clear: { label: "Clear", color: "text-ink-tertiary" },
  };
  return map[action] ?? { label: action, color: "text-muted-foreground" };
}

function DocPlaywrightTestCard({
  test,
  onSave,
}: {
  test: ImpactPlaywrightTest;
  onSave: (updated: ImpactPlaywrightTest) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ImpactPlaywrightTest>(test);
  const sev = test.severity || "Medium";

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft({ ...test, steps: test.steps.map((s) => ({ ...s })) });
    setEditing(true);
    setOpen(true);
  };

  const cancelEdit = () => {
    setDraft({ ...test, steps: test.steps.map((s) => ({ ...s })) });
    setEditing(false);
  };

  const saveEdit = () => {
    onSave(draft);
    setEditing(false);
  };

  const updateStep = (idx: number, field: keyof ImpactPlaywrightStep, value: string) => {
    setDraft((prev) => {
      const steps = [...prev.steps];
      steps[idx] = { ...steps[idx], [field]: value || null } as ImpactPlaywrightStep;
      return { ...prev, steps };
    });
  };

  const removeStep = (idx: number) => {
    setDraft((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }));
  };

  const addStep = () => {
    setDraft((prev) => ({
      ...prev,
      steps: [
        ...prev.steps,
        { action: "screenshot", selector: null, value: null, description: "New step" },
      ],
    }));
  };

  return (
    <div className="rounded-lg border border-stroke-muted bg-container overflow-hidden">
      <button
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-raised transition-colors"
        onClick={() => !editing && setOpen((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          {editing ? (
            <Input
              value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              className="h-7 text-sm font-medium"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <p className="text-sm font-medium text-ink truncate">{test.name}</p>
          )}
          <p className="text-[11px] text-muted-foreground truncate">{editing ? draft.page_name : test.page_name}</p>
        </div>
        {editing ? (
          <select
            value={draft.severity}
            onChange={(e) => setDraft((p) => ({ ...p, severity: e.target.value }))}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] rounded border border-stroke-muted bg-container px-1.5 py-0.5 flex-shrink-0"
          >
            {["Critical", "High", "Medium", "Low"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <StatusBadge tone={severityTone[sev] ?? "neutral"}>{sev}</StatusBadge>
        )}
        <span className="text-[11px] text-muted-foreground ml-1">{editing ? draft.steps.length : test.steps.length} steps</span>
        {!editing && (
          <button
            onClick={startEdit}
            className="p-1 rounded hover:bg-raised text-muted-foreground hover:text-ink transition-colors flex-shrink-0"
            title="Edit test case"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {(open || editing) && (
        <div className="px-3 pb-3 space-y-1 border-t border-stroke-muted pt-2">
          {editing ? (
            <Textarea
              value={draft.description}
              onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
              className="text-xs min-h-[60px]"
              placeholder="Test description..."
            />
          ) : (
            <p className="text-xs text-muted-foreground mb-2">{test.description}</p>
          )}

          {(editing ? draft.steps : test.steps).map((step: ImpactPlaywrightStep, i: number) => {
            const { label, color } = stepActionLabel(step.action);
            return editing ? (
              <div key={i} className="rounded bg-raised border border-stroke-muted p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground font-mono w-5">{i + 1}.</span>
                  <Input
                    value={step.action}
                    onChange={(e) => updateStep(i, "action", e.target.value)}
                    className="h-6 text-[11px] flex-1"
                  />
                  <button
                    onClick={() => removeStep(i)}
                    className="p-1 rounded hover:bg-raised text-muted-foreground hover:text-destructive flex-shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Input
                  value={step.description}
                  onChange={(e) => updateStep(i, "description", e.target.value)}
                  placeholder="Step description"
                  className="h-6 text-[11px]"
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <Input
                    value={step.selector ?? ""}
                    onChange={(e) => updateStep(i, "selector", e.target.value)}
                    placeholder="selector"
                    className="h-6 text-[10px] font-mono"
                  />
                  <Input
                    value={step.value ?? ""}
                    onChange={(e) => updateStep(i, "value", e.target.value)}
                    placeholder="value"
                    className="h-6 text-[10px] font-mono"
                  />
                </div>
              </div>
            ) : (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`w-16 text-right font-mono text-[10px] ${color}`}>{label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-border flex-shrink-0" />
                <span className="text-muted-foreground truncate">{step.description}</span>
              </div>
            );
          })}

          {editing && (
            <>
              <button
                onClick={addStep}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-dashed border-stroke-muted text-[11px] text-muted-foreground hover:border-stroke hover:text-primary transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Add Step
              </button>
              <div className="flex gap-1.5 mt-2">
                <Button size="sm" className="h-7 text-[11px] px-2" onClick={saveEdit}>
                  <Save className="h-3.5 w-3.5 mr-1" /> Save
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-[11px] px-2" onClick={cancelEdit}>
                  <X className="h-3.5 w-3.5 mr-1" /> Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DocTests() {
  // State
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [scenarios, setScenarios] = useState<DocScenario[]>([]);
  const [generatedTests, setGeneratedTests] = useState<ImpactPlaywrightTest[]>([]);
  const [framework] = useState("playwright");
  const [activeTab, setActiveTab] = useState<"upload" | "scenarios" | "tests">("upload");
  const [targetUrl, setTargetUrl] = useState("");
  const canRunLive = /^https?:\/\/\S+$/i.test(targetUrl.trim());

  // Mutations
  const uploadDoc = useUploadDoc();
  const generateFromDocs = useGenerateFromDocs();
  const navigate = useNavigate();

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleFileAccepted = async (file: File) => {
    setUploadedFile(file);
    setScenarios([]);
    setGeneratedTests([]);

    try {
      const result = await uploadDoc.mutateAsync(file);
      setScenarios(result.scenarios);
      setActiveTab("scenarios");
      toast.success(`Extracted ${result.scenarios.length} test scenarios`);
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "The document could not be read."));
    }
  };

  const handleGenerateTests = async () => {
    if (!scenarios.length) return;
    try {
      const result = await generateFromDocs.mutateAsync({ scenarios, framework });
      setGeneratedTests(result.tests);
      setActiveTab("tests");
      toast.success(`Generated ${result.tests.length} test cases`);
    } catch (err) {
      toast.error(apiErrorMessage(err, "The tests could not be generated. Try again."));
    }
  };

  const handleUpdateTest = (updated: ImpactPlaywrightTest) => {
    setGeneratedTests((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleDownloadTests = () => {
    if (!generatedTests.length) return;
    const base = "/";
    const lines: string[] = [
      "import { test, expect } from '@playwright/test';",
      "",
      "// Generated by Document-Driven Tests",
      "",
    ];

    for (const tc of generatedTests) {
      lines.push(`test('${tc.name.replace(/'/g, "\\'")}', async ({ page }) => {`);
      if (tc.description) lines.push(`  // ${tc.description}`);
      for (const step of tc.steps) {
        const sel = (step.selector || "").replace(/'/g, "\\'");
        const val = step.value || "";
        const description = step.description || step.action;
        if (step.action === "navigate") lines.push(`  await page.goto('${val.startsWith("http") ? val : base + val}'); // ${description}`);
        else if (step.action === "click") lines.push(`  await page.click('${sel}'); // ${description}`);
        else if (step.action === "fill") lines.push(`  await page.fill('${sel}', '${val.replace(/'/g, "\\'")}'); // ${description}`);
        else if (step.action === "assert_text") lines.push(`  await expect(page.locator('body')).toContainText('${val.replace(/'/g, "\\'")}'); // ${description}`);
        else if (step.action === "screenshot") lines.push(`  await page.screenshot(); // ${description}`);
        else if (step.action === "wait") lines.push(`  await page.waitForTimeout(${(parseFloat(val) || 2) * 1000}); // ${description}`);
        else if (step.action === "hover") lines.push(`  await page.hover('${sel}'); // ${description}`);
        else if (step.action === "hover_and_click") {
          const clickSel = val.replace(/'/g, "\\'");
          lines.push(`  await page.hover('${sel}'); // ${description}`);
          lines.push(`  await page.click('${clickSel}');`);
        }
        else if (step.action === "press") lines.push(`  await page.keyboard.press('${val.replace(/'/g, "\\'")}'); // ${description}`);
        else if (step.action === "check") lines.push(`  await page.check('${sel}'); // ${description}`);
        else if (step.action === "uncheck") lines.push(`  await page.uncheck('${sel}'); // ${description}`);
        else if (step.action === "select_option") lines.push(`  await page.selectOption('${sel}', '${val.replace(/'/g, "\\'")}'); // ${description}`);
        else if (step.action === "dblclick") lines.push(`  await page.dblclick('${sel}'); // ${description}`);
        else if (step.action === "type_into") lines.push(`  await page.type('${sel}', '${val.replace(/'/g, "\\'")}'); // ${description}`);
        else if (step.action === "scroll") lines.push(`  await page.evaluate(() => window.scrollBy(0, 500)); // ${description}`);
        else if (step.action === "clear") lines.push(`  await page.fill('${sel}', ''); // ${description}`);
        else lines.push(`  // TODO: ${step.action} - ${description}`);
      }
      lines.push("});");
      lines.push("");
    }

    const content = lines.join("\n");
    const filename = "generated.spec.ts";
    const blob = new Blob([content + "\n"], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Downloaded ${filename}`);
  };

  // Hand the generated tests to the Live Test Runner through the same
  // sessionStorage key the Workspace wizard uses (shape: LtrPrefill there).
  const handleRunInLiveRunner = () => {
    if (!generatedTests.length || !canRunLive) return;
    sessionStorage.setItem(
      "ltr_prefill",
      JSON.stringify({
        appUrl: targetUrl.trim(),
        generatedTests: generatedTests.map((t) => ({
          id: t.id,
          analysis_id: t.analysis_id,
          name: t.name,
          description: t.description,
          page_name: t.page_name,
          severity: t.severity,
          steps: t.steps,
        })),
      }),
    );
    navigate("/live-testing");
  };

  const steps = [
    { id: "upload", label: "Upload", done: !!uploadedFile, count: 0 },
    { id: "scenarios", label: "Scenarios", done: scenarios.length > 0, count: scenarios.length },
    { id: "tests", label: "Tests", done: generatedTests.length > 0, count: generatedTests.length },
  ] as const;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-stroke-muted bg-container">
      <div className="px-4 pt-4">
        <PageHeader
          title="Tests from Docs"
          description="Upload a spec or requirements document, review the test scenarios extracted from it, then generate Playwright test cases in the Live Test Run format."
          className="border-b-0 pb-3"
        />
        <TestSuiteTabs className="pb-3" />
      </div>

      {/* ── Step toolbar ── */}
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-y border-stroke-muted px-4 py-1.5">
        {steps.map((step) => {
          const reachable = step.done || step.id === "upload";
          return (
            <button
              key={step.id}
              type="button"
              aria-pressed={activeTab === step.id}
              disabled={!reachable}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                activeTab === step.id
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border text-ink-secondary hover:bg-raised"
              }`}
              onClick={() => {
                if (reachable) {
                  setActiveTab(step.id as typeof activeTab);
                }
              }}
            >
              {step.label}
              {step.count > 0 && <span className="ml-1 tabular-nums opacity-70">{step.count}</span>}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          {scenarios.length > 0 && generatedTests.length === 0 && (
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={handleGenerateTests}
              disabled={generateFromDocs.isPending}
            >
              {generateFromDocs.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {generateFromDocs.isPending ? "Generating tests…" : "Generate tests"}
            </Button>
          )}

          {generatedTests.length > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={handleDownloadTests}
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
              <Input
                type="url"
                aria-label="Target app URL"
                placeholder="Target app URL, e.g. https://staging.example.com"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                className="h-8 w-72 text-xs"
              />
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleRunInLiveRunner}
                disabled={!canRunLive}
                title={canRunLive ? undefined : "Enter the URL of the running app the tests should run against"}
              >
                <Play className="h-4 w-4" />
                Run in Live Test Run
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Upload */}
        {activeTab === "upload" && (
          <div className="flex flex-1 flex-col items-center justify-center p-8">
            <div className="w-full max-w-xl">
              <UploadZone
                onFile={handleFileAccepted}
                isLoading={uploadDoc.isPending}
                acceptedFile={uploadedFile}
                onClear={() => {
                  setUploadedFile(null);
                  setScenarios([]);
                  setGeneratedTests([]);
                }}
              />
              {uploadDoc.isPending && (
                <p className="mt-4 flex items-center justify-center gap-2 text-sm text-ink-tertiary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Extracting scenarios from the document…
                </p>
              )}
              {/* Supported formats */}
              <div className="mt-6 grid grid-cols-3 gap-3 text-xs text-ink-tertiary">
                {[
                  { ext: "PDF", desc: "Product specs, PRDs" },
                  { ext: "DOCX", desc: "Requirements docs" },
                  { ext: "JSON/YAML", desc: "OpenAPI / AsyncAPI" },
                  { ext: "MD", desc: "Markdown specs" },
                  { ext: "TXT", desc: "Plain-text requirements" },
                  { ext: "CSV", desc: "Test data tables" },
                ].map(({ ext, desc }) => (
                  <div
                    key={ext}
                    className="rounded-lg border border-stroke-muted bg-raised px-3 py-2 text-center"
                  >
                    <p className="font-mono text-xs text-ink">.{ext.toLowerCase()}</p>
                    <p className="mt-0.5 text-[11px]">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Scenarios */}
        {activeTab === "scenarios" && (
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <div className="flex h-11 items-center gap-2 border-b border-stroke-muted px-4">
                <h2 className={eyebrow}>Extracted scenarios</h2>
                <span className="text-xs tabular-nums text-ink-tertiary">{scenarios.length}</span>
                {uploadedFile && (
                  <span className="min-w-0 truncate text-xs text-ink-tertiary">
                    from <FileIcon name={uploadedFile.name} size={14} className="mx-1 inline-block align-[-2px]" />
                    {uploadedFile.name}
                  </span>
                )}
              </div>
              <ScrollArea className="h-[calc(100%-45px)]">
                <div className="flex flex-col gap-3 p-4">
                  {scenarios.map((scenario, i) => (
                    <ScenarioCard key={scenario.id} scenario={scenario} index={i} />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        {/* Tests */}
        {activeTab === "tests" && (
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <div className="flex h-11 items-center gap-2 border-b border-stroke-muted px-4">
                <h2 className={eyebrow}>Generated tests</h2>
                <span className="text-xs tabular-nums text-ink-tertiary">{generatedTests.length}</span>
                <span className="font-mono text-xs text-ink-tertiary">{framework}</span>
              </div>
              <ScrollArea className="h-[calc(100%-45px)]">
                <div className="flex flex-col gap-3 p-4">
                  {generatedTests.map((test) => (
                    <DocPlaywrightTestCard
                      key={test.id}
                      test={test}
                      onSave={handleUpdateTest}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
