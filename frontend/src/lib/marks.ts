/**
 * Chakram 3D marks: decorative product icons shown beside page titles, KPI
 * labels, connector tiles and empty states. Files live in
 * `public/images/marks/` as `<id>.png` (256px) and `<id>@96.png` (96px),
 * transparent, so one file works on light and dark surfaces.
 *
 * Ids follow `Chakram Assets/flow-prompts.md`. Only marks that have an image
 * are listed, so every lookup table below is partial: a missing key means the
 * mark has not been generated yet and the caller should render nothing.
 */

function mark<Id extends string, Label extends string>(id: Id, label: Label) {
  return {
    src: `/images/marks/${id}.png`,
    src96: `/images/marks/${id}@96.png`,
    label,
  } as const;
}

export const MARKS = {
  // Brand
  "mark-chakram-wheel": mark("mark-chakram-wheel", "Chakram wheel"),
  "mark-extra-chakram-wheel-angled": mark("mark-extra-chakram-wheel-angled", "Chakram wheel, angled view"),

  // Navigation sections
  "mark-section-build": mark("mark-section-build", "Construction bricks"),
  "mark-section-requirements": mark("mark-section-requirements", "Rolled plan sheet"),
  "mark-section-testing": mark("mark-section-testing", "Laboratory flask"),
  "mark-section-release": mark("mark-section-release", "Milestone flag"),

  // Pages and features
  "mark-dashboard": mark("mark-dashboard", "Control console"),
  "mark-pipeline": mark("mark-pipeline", "S-shaped pipe"),
  "mark-ai-app-builder": mark("mark-ai-app-builder", "Panel with a tile dropping in"),
  "mark-ai-workspace": mark("mark-ai-workspace", "Three keyboard keys"),
  "mark-code-review": mark("mark-code-review", "Code slab with a comment bubble"),
  "mark-code-impact": mark("mark-code-impact", "Node and rod structure"),
  "mark-prd-generator": mark("mark-prd-generator", "Bound document"),
  "mark-requirements": mark("mark-requirements", "Sticky-note pad"),
  "mark-requirements-intelligence": mark("mark-requirements-intelligence", "Jigsaw with one piece lifted"),
  "mark-sprint-intelligence": mark("mark-sprint-intelligence", "Flip desk calendar"),
  "mark-synthetic-data": mark("mark-synthetic-data", "Mould tray with cubes"),
  "mark-repo-baseline": mark("mark-repo-baseline", "Surveyor's level on a tripod"),
  "mark-doc-tests": mark("mark-doc-tests", "Open book with rising cards"),
  "mark-test-suite": mark("mark-test-suite", "Test tubes in a rack"),
  "mark-test-execution": mark("mark-test-execution", "Play wedge on a puck"),
  "mark-live-test-runner": mark("mark-live-test-runner", "Browser window and pointer"),
  "mark-risk-ranking": mark("mark-risk-ranking", "Podium with a sphere"),
  "mark-change-hotspots": mark("mark-change-hotspots", "Tile grid with one raised tile"),
  "mark-root-cause": mark("mark-root-cause", "Falling dominoes"),
  "mark-test-selection": mark("mark-test-selection", "Tongs lifting a cube"),
  "mark-self-healing": mark("mark-self-healing", "Wrench gripping a nut"),
  "mark-deployments": mark("mark-deployments", "Shipping container"),
  "mark-release-gate": mark("mark-release-gate", "Tripod turnstile"),
  "mark-ci-intelligence": mark("mark-ci-intelligence", "Robot arm holding a cube"),
  "mark-anomaly-sandbox": mark("mark-anomaly-sandbox", "Pegs with one outlier"),
  "mark-incidents": mark("mark-incidents", "Warning beacon"),
  "mark-connectors": mark("mark-connectors", "Keys on a ring"),
  "mark-profile": mark("mark-profile", "Identity badge"),
  "mark-ai-usage": mark("mark-ai-usage", "Utility meter"),

  // Pipeline stages
  "mark-stage-deploy": mark("mark-stage-deploy", "Push-button"),
  "mark-stage-report": mark("mark-stage-report", "Printer with a paper strip"),

  // KPI and status
  "mark-kpi-pass-rate": mark("mark-kpi-pass-rate", "Partly filled ring"),
  "mark-kpi-passed": mark("mark-kpi-passed", "Check mark on a disc"),
  "mark-kpi-failed": mark("mark-kpi-failed", "Cross on a disc"),
  "mark-kpi-skipped": mark("mark-kpi-skipped", "Empty square frame"),
  "mark-kpi-duration": mark("mark-kpi-duration", "Stopwatch"),
  "mark-kpi-known-failure": mark("mark-kpi-known-failure", "Cracked cube with a tag"),
  "mark-kpi-high-priority": mark("mark-kpi-high-priority", "Stacked chevrons"),
  "mark-kpi-ai-calls": mark("mark-kpi-ai-calls", "Arrow through a ring"),
  "mark-kpi-ci-failure-rate": mark("mark-kpi-ci-failure-rate", "Broken chain"),
  "mark-verdict-go": mark("mark-verdict-go", "Round plate with an up arrow"),
  "mark-verdict-no-go": mark("mark-verdict-no-go", "Octagonal plate with a bar"),
  "mark-verdict-not-evaluated": mark("mark-verdict-not-evaluated", "Empty bracket on a post"),

  // Integrations
  "mark-int-source-control": mark("mark-int-source-control", "Branching rail"),
  "mark-int-issue-tracker": mark("mark-int-issue-tracker", "Blank ticket"),
  "mark-int-hosting": mark("mark-int-hosting", "Cloud on a landing pad"),
  "mark-int-chat-alerts": mark("mark-int-chat-alerts", "Two-way radio"),
  "mark-int-observability": mark("mark-int-observability", "Dish antenna"),
  "mark-int-ai-model": mark("mark-int-ai-model", "Processor chip"),

  // Empty and error states
  "mark-empty-no-requirements": mark("mark-empty-no-requirements", "Blank notepad and pencil"),
  "mark-empty-no-runs": mark("mark-empty-no-runs", "Empty conveyor belt"),
  "mark-empty-no-results": mark("mark-empty-no-results", "Empty open drawer"),
  "mark-empty-nothing-to-review": mark("mark-empty-nothing-to-review", "Empty document stand"),
  "mark-empty-not-configured": mark("mark-empty-not-configured", "Unplugged plug and socket"),
  "mark-empty-error": mark("mark-empty-error", "Panel hanging by one corner"),
  "mark-empty-not-found": mark("mark-empty-not-found", "Two-way signpost"),
  "mark-kpi-cases-ranked": mark("mark-kpi-cases-ranked", "Three ranked bars"),
  "mark-kpi-tokens": mark("mark-kpi-tokens", "Heap of blank tiles"),
  "mark-kpi-successful-runs": mark("mark-kpi-successful-runs", "Tray with every slot filled"),
  "mark-kpi-commits-analysed": mark("mark-kpi-commits-analysed", "Magnifier over a commit line"),
  "mark-kpi-incidents-open": mark("mark-kpi-incidents-open", "Split pipe"),
  "mark-kpi-incidents-resolved": mark("mark-kpi-incidents-resolved", "Clamped pipe"),
  "mark-verdict-conditional": mark("mark-verdict-conditional", "Inverted triangle plate on a post"),
} as const;

export type MarkId = keyof typeof MARKS;

export function isMarkId(id: string): id is MarkId {
  return Object.prototype.hasOwnProperty.call(MARKS, id);
}

/** Route path (see `nav-config.ts` and `App.tsx`) to the page-title mark. */
export const PAGE_MARKS: Partial<Record<string, MarkId>> = {
  "/dashboard": "mark-dashboard",
  "/projects": "mark-pipeline",
  "/ai-ide": "mark-ai-app-builder",
  "/workspace": "mark-ai-workspace",
  "/code-review": "mark-code-review",
  "/code-impact": "mark-code-impact",
  "/prd": "mark-prd-generator",
  "/requirements": "mark-requirements",
  "/requirements-intelligence": "mark-requirements-intelligence",
  "/synthetic-data": "mark-synthetic-data",
  "/repo-baseline": "mark-repo-baseline",
  "/doc-tests": "mark-doc-tests",
  "/generated-tests": "mark-test-suite",
  "/test-execution": "mark-test-execution",
  "/live-testing": "mark-live-test-runner",
  "/live-test-runner": "mark-live-test-runner",
  "/prioritization": "mark-risk-ranking",
  "/defect-prediction": "mark-change-hotspots",
  "/root-cause": "mark-root-cause",
  "/test-selection": "mark-test-selection",
  "/self-healing": "mark-self-healing",
  "/deployments": "mark-deployments",
  "/release-gate": "mark-release-gate",
  "/ci-intelligence": "mark-ci-intelligence",
  "/monitoring": "mark-anomaly-sandbox",
  "/incidents": "mark-incidents",
  "/settings/connectors": "mark-connectors",
  "/profile": "mark-profile",
  "/cost-tracker": "mark-ai-usage",
};

/** Mark for a pathname, also matching detail routes such as `/root-cause/<id>`. */
export function markForPath(pathname: string): MarkId | undefined {
  const exact = PAGE_MARKS[pathname];
  if (exact) return exact;
  const base = Object.keys(PAGE_MARKS).find((route) => pathname.startsWith(`${route}/`));
  return base ? PAGE_MARKS[base] : undefined;
}

export type NavSectionId = "build" | "requirements" | "testing" | "release";

/** Sidebar section id (`platformSections[].id`) to mark. */
export const SECTION_MARKS: Partial<Record<NavSectionId, MarkId>> = {
  build: "mark-section-build",
  requirements: "mark-section-requirements",
  testing: "mark-section-testing",
  release: "mark-section-release",
};

export type PipelineStageKey = "workspace" | "codeReview" | "testRun" | "deploy" | "report";

/** SDLC pipeline stage to mark. */
export const STAGE_MARKS: Partial<Record<PipelineStageKey, MarkId>> = {
  workspace: "mark-ai-workspace",
  codeReview: "mark-code-review",
  testRun: "mark-test-execution",
  deploy: "mark-stage-deploy",
  report: "mark-stage-report",
};

export type KpiKey =
  | "passRate"
  | "passed"
  | "failed"
  | "skipped"
  | "duration"
  | "knownFailure"
  | "highPriority"
  | "casesRanked"
  | "aiCalls"
  | "tokens"
  | "runFailureRate"
  | "successfulRuns"
  | "commitsAnalysed"
  | "incidentsOpen"
  | "incidentsResolved"
  | "verdictGo"
  | "verdictConditional"
  | "verdictNoGo"
  | "verdictInsufficient"
  | "notEvaluated";

/**
 * KPI and status concept to mark. Not generated yet, so absent here:
 * verdictInsufficient.
 */
export const KPI_MARKS: Partial<Record<KpiKey, MarkId>> = {
  passRate: "mark-kpi-pass-rate",
  passed: "mark-kpi-passed",
  failed: "mark-kpi-failed",
  skipped: "mark-kpi-skipped",
  duration: "mark-kpi-duration",
  knownFailure: "mark-kpi-known-failure",
  highPriority: "mark-kpi-high-priority",
  aiCalls: "mark-kpi-ai-calls",
  runFailureRate: "mark-kpi-ci-failure-rate",
  verdictGo: "mark-verdict-go",
  verdictNoGo: "mark-verdict-no-go",
  notEvaluated: "mark-verdict-not-evaluated",
  casesRanked: "mark-kpi-cases-ranked",
  tokens: "mark-kpi-tokens",
  successfulRuns: "mark-kpi-successful-runs",
  commitsAnalysed: "mark-kpi-commits-analysed",
  incidentsOpen: "mark-kpi-incidents-open",
  incidentsResolved: "mark-kpi-incidents-resolved",
  verdictConditional: "mark-verdict-conditional",
};

export type IntegrationKey = "github" | "jira" | "vercel" | "slack" | "ollama";

/** Connector to mark. These suggest what the integration does; none is a vendor logo. */
export const INTEGRATION_MARKS: Partial<Record<IntegrationKey, MarkId>> = {
  github: "mark-int-source-control",
  jira: "mark-int-issue-tracker",
  vercel: "mark-int-hosting",
  slack: "mark-int-chat-alerts",
  ollama: "mark-int-ai-model",
};

export type EmptyStateKey =
  | "noRequirements"
  | "noRuns"
  | "noResults"
  | "nothingToReview"
  | "notConfigured"
  | "error"
  | "notFound";

/** Empty and error state to mark. */
export const EMPTY_MARKS: Partial<Record<EmptyStateKey, MarkId>> = {
  noRequirements: "mark-empty-no-requirements",
  noRuns: "mark-empty-no-runs",
  noResults: "mark-empty-no-results",
  nothingToReview: "mark-empty-nothing-to-review",
  notConfigured: "mark-empty-not-configured",
  error: "mark-empty-error",
  notFound: "mark-empty-not-found",
};
