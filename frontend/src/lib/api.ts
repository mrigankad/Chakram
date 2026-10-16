import axios from "axios";
import { apiErrorMessage } from "./api-error";
import { markServerDatesUtc } from "./server-dates";
import { repoIdFromUrl } from "./sha256";

// In production, VITE_API_URL points to the deployed backend (e.g. https://your-backend.vercel.app/api)
// In development, requests go to /api which Vite proxies to localhost:8000
const BASE_URL = import.meta.env.VITE_API_URL || "/api";

export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

/** Fired when a signed-in request comes back 401, so the app can return to the sign-in page. */
export const SESSION_EXPIRED_EVENT = "aidlc:session-expired";

// Every failed call leaves here with `response.data.detail` and `message` as a
// readable sentence, whatever shape the server (or a proxy) sent. Pages read
// either one; neither can be an object, a JSON dump or axios's "status code 500".
apiClient.interceptors.response.use(
  (response) => {
    // Stored timestamps arrive without an offset; mark them as the UTC they are.
    response.data = markServerDatesUtc(response.data);
    return response;
  },
  (error) => {
    if (error && typeof error === "object" && !axios.isCancel(error)) {
      const message = apiErrorMessage(error);
      const response = error.response;
      if (response) {
        const data = response.data;
        if (data && typeof data === "object" && !Array.isArray(data) && !(data instanceof Blob)) {
          (data as Record<string, unknown>).detail = message;
        } else if (!(data instanceof Blob)) {
          response.data = { detail: message };
        }
        const url = String(error.config?.url ?? "");
        if (response.status === 401 && !url.startsWith("/auth/") && typeof window !== "undefined") {
          window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
        }
      }
      try {
        error.message = message;
      } catch {
        /* message is read-only on some error objects */
      }
    }
    return Promise.reject(error);
  },
);

// ─── Types ────────────────────────────────────────────────────────────────

export type ActivityKind = "search" | "nav" | "repo_probe";

export interface ActivityHistoryItem {
  id: string;
  kind: ActivityKind;
  title: string;
  url: string;
  section?: string | null;
  payload?: Record<string, unknown>;
  visited_at?: string | null;
  user_id?: string | null;
}

export type ConnectorsPublic = {
  github?: Record<string, unknown>;
  jira?: Record<string, unknown>;
  vercel?: Record<string, unknown>;
  ollama?: Record<string, unknown>;
  slack?: Record<string, unknown>;
  datadog?: Record<string, unknown>;
  updated_at?: string;
};

export interface Requirement {
  id: string;
  text: string;
  created_at: string;
  status: string;
}

export interface AnalyzeRequirementResult {
  id: string;
  text: string;
  status: string;
  test_case_categories: Record<string, number>;
  total_tests: number;
}

export interface TestCase {
  id: string;
  requirement_id: string;
  tc_id: string;
  name: string;
  description: string;
  severity: string;
  expected: string;
  category: string;
  created_at: string;
}

export interface GroupedTestCases {
  functional: TestCase[];
  edge: TestCase[];
  api: TestCase[];
  failure: TestCase[];
  regression: TestCase[];
}

export interface TestStepResult {
  action: string | null;
  description: string | null;
  status: "pass" | "fail" | "not_run";
  error: string | null;
}

export interface TestResult {
  id: string;
  tc_id: string;
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  duration: number;
  error_message: string | null;
  run_id: string;
  timestamp: string;
  category?: string | null;
  severity?: string | null;
  /** Why the case could not be checked through the UI (SKIP only). */
  skip_reason?: string | null;
  steps: TestStepResult[];
  /** Base64 JPEG of the failing (or final) step; only sent when one run is requested. */
  screenshot?: string | null;
}

export interface RunStarted {
  run_id: string;
  total: number;
}

export interface RunSummary {
  run_id: string;
  status: "running" | "completed" | "failed";
  phase: string | null;
  error: string | null;
  target_url: string;
  requirement_id: string | null;
  /** Cases that ran their saved plan vs. cases planned fresh in this run. */
  plans_reused: number;
  plans_created: number;
  total: number;
  completed: number;
  passed: number;
  failed: number;
  skipped: number;
  /** passed / (passed + failed); skipped cases were never checked. Null when nothing was executed. */
  success_rate: number | null;
  total_duration: number;
  started_at: string;
  completed_at: string | null;
}

export interface SchemaField {
  name: string;
  type: "string" | "integer" | "float" | "boolean" | "datetime";
  description: string;
}

export interface PreviewDataset {
  schema_fields: SchemaField[];
  rows: Record<string, unknown>[];
}

export interface SyntheticDataset {
  id: string;
  requirement_id: string;
  requirement_text: string;
  count: number;
  schema_fields: SchemaField[];
  rows: Record<string, unknown>[];
  generated_at: string;
}

export interface PrioritizedTest {
  id: string;
  tc_id: string;
  name: string;
  failure_count: number;
  severity: string;
  priority: number;
  status: "failed" | "warning" | "stable";
  known_failure: boolean;
  /** Executed (pass or fail) runs the score is based on. */
  total_runs: number;
  /** How the score was reached. */
  reason: string;
  last_error: string | null;
}

export interface DashboardActivityItem {
  id: string;
  name: string;
  status: string;
  timestamp: string;
  time_ago: string;
}

export interface DashboardStats {
  total_tests: number;
  test_case_counts: Record<string, number>;
  latest_run: {
    run_id: string | null;
    passed: number;
    failed: number;
    total: number;
    /** Null when the latest run executed nothing (no run, or every case skipped). */
    success_rate: number | null;
    avg_duration: number | null;
    total_duration: number;
  };
  high_priority: number;
  known_failures: number;
  synthetic_datasets: number;
  /** The seven calendar days ending today, oldest first; days without results are zero. */
  weekly_trend: { day: string; date?: string; passed: number; failed: number; total: number }[];
  severity_breakdown?: { severity: string; count: number }[];
  recent_activity?: DashboardActivityItem[];
}

// ── Repo Analysis & Live Testing Types ────────────────────────────────────────

export interface PageInfo {
  name: string;
  path: string;
  description: string;
  key_elements: string[];
}

export interface UserFlow {
  name: string;
  steps: string[];
}

export interface TestStep {
  action: "navigate" | "click" | "fill" | "assert_text" | "screenshot" | "wait" | "hover" | "hover_and_click" | "press" | "check" | "uncheck" | "select_option" | "drag_and_drop" | "dblclick" | "type_into" | "scroll" | "clear";
  selector: string | null;
  value: string | null;
  description: string;
}

export interface PlaywrightTestCase {
  id: string;
  analysis_id: string;
  name: string;
  description: string;
  page_name: string;
  severity: string;
  steps: TestStep[];
}

export interface CommitInfo {
  sha: string;
  short_sha: string;
  message: string;
  author: string;
  relative_date: string;
  date: string;
}

export interface RepoAnalysisResult {
  analysis_id: string;
  target_url: string;
  summary: string;
  tech_stack: string;
  pages: PageInfo[];
  user_flows: UserFlow[];
  tests: PlaywrightTestCase[];
  tests_source?: "ai" | "fallback";
  // commit mode extras
  mode?: "full" | "commit";
  commit_sha?: string;
  commit_message?: string;
  changed_files?: string[];
}

export interface RunSummaryItem {
  run_id: string;
  analysis_id: string;
  status: "running" | "completed" | "failed";
  total: number;
  passed: number;
  failed: number;
  started_at: string | null;
  completed_at: string | null;
  results?: { test_name: string; status: string; duration_ms: number | null }[];
}

export interface StepResult {
  step_description: string;
  screenshot: string | null; // base64 PNG
  status: "pass" | "fail";
  error: string | null;
}

export interface LiveTestResult {
  test_id: string;
  test_name: string;
  status: "pending" | "running" | "passed" | "failed";
  steps_completed: number;
  total_steps: number;
  step_results: StepResult[];
  error: string | null;
  duration_ms: number | null;
}

export interface AnalysisJob {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  step: "pending" | "cloning" | "extracting" | "analyzing" | "generating" | "completed" | "failed";
  logs: string[];
  github_url: string;
  target_url: string;
  mode?: "full" | "commit";
  result: RepoAnalysisResult | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface LiveRunStatus {
  run_id: string;
  analysis_id: string;
  status: "running" | "completed" | "failed";
  results: LiveTestResult[];
  total: number;
  passed: number;
  failed: number;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

// ── AI Workspace Types ─────────────────────────────────────────────────────

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  language?: string;
  children?: FileNode[];
}

// ── Pipeline types ────────────────────────────────────────────────────────────

export interface PipelineReview {
  summary: string;
  findings: { file: string; line: number | null; category: string; severity: string; message: string; suggestion: string }[];
  security_flags: string[];
  positives: string[];
  recommendation: string;
  coverage_estimate: number;
}

export interface PipelineReportRequest {
  owner: string;
  repo: string;
  version?: string;
  commit_sha?: string;
  jira_project?: string;
  live_test_passed?: number;
  live_test_failed?: number;
  live_test_total?: number;
  review_recommendation?: string;
  review_critical_count?: number;
}

export type PipelineVerdict = "GO" | "NO-GO" | "CONDITIONAL" | "INSUFFICIENT_DATA";

export interface PipelineOpenBug {
  key?: string;
  summary?: string;
  priority?: string;
  [extra: string]: unknown;
}

/** Shape returned by POST /api/pipeline/report. A null signal was not evaluated. */
export interface PipelineReport {
  pipeline_run_id: string;
  version: string;
  commit_sha?: string | null;
  /** null when the verdict is INSUFFICIENT_DATA. */
  score: number | null;
  verdict: {
    verdict: PipelineVerdict;
    reason?: string;
    primary_blocker: string | null;
    blockers?: string[];
    recommendation: string;
    conditions: string[];
  };
  signals: {
    ci_pass_rate: number | null;
    live_test_pass_rate: number | null;
    live_test_passed: number;
    live_test_failed: number;
    live_test_total: number;
    review_recommendation: string | null;
    review_critical_findings: number | null;
    open_critical_bugs: PipelineOpenBug[] | null;
    open_critical_bug_count?: number | null;
    unresolved_security_findings?: number | null;
    workflow_summary: Record<string, number>;
  };
  /** Signal names the score was computed from. */
  scored_signals?: string[];
  /** Signal name -> why it was not evaluated. */
  not_evaluated?: Record<string, string>;
  errors: string[];
}

export interface PipelineRunSummary {
  id: string;
  owner: string;
  repo: string;
  version: string;
  score: number | null;
  verdict: string;
  commit_sha?: string | null;
  created_at?: string | null;
}

export interface DeploymentTriggerRequest {
  repo_url?: string;
  branch?: string;
  commit_sha?: string;
  target?: "production" | "preview";
}

export interface DeploymentTriggerResponse {
  deploymentId: string;
  url: string;
  status: string;
  createdAt?: number;
  inspectorUrl?: string;
  triggeredBy?: DeploymentActor | null;
  projectName?: string;
  domains?: string[];
  target?: string;
  sourceBranch?: string;
  sourceCommitSha?: string;
  repoUrl?: string;
  branch?: string;
  commitSha?: string;
  ref?: string;
}

export interface DeploymentActor {
  id?: string | null;
  username?: string | null;
  email?: string | null;
}

export interface DeploymentStatusResponse {
  deploymentId: string;
  status: "QUEUED" | "BUILDING" | "INITIALIZING" | "READY" | "ERROR" | "CANCELED" | "UNKNOWN" | string;
  url?: string;
  createdAt?: number;
  inspectorUrl?: string;
  triggeredBy?: DeploymentActor | null;
  projectName?: string;
  domains?: string[];
  target?: string;
  sourceBranch?: string;
  sourceCommitSha?: string;
  sourceCommitMessage?: string;
  sourceRepo?: string;
  ready: boolean;
}

export interface DeploymentLogEvent {
  id: string;
  level: string;
  message: string;
  timestamp?: string | number;
}

export interface DeploymentEventsResponse {
  deploymentId: string;
  events: DeploymentLogEvent[];
}

export interface DeploymentConfigHealth {
  configured: boolean;
  project_name: string;
  has_project_id: boolean;
  has_team_id: boolean;
  has_repo_id: boolean;
  dynamic_repo_supported?: boolean;
}

export interface DeploymentRepoOption {
  name: string;
  sha?: string;
  protected?: boolean;
}

export interface DeploymentCommitOption {
  sha: string;
  short_sha: string;
  message: string;
  author: string;
  date?: string;
}

export interface DeploymentRepoOptionsResponse {
  repo: {
    owner: string;
    name: string;
    id: string;
    default_branch: string;
    url: string;
  };
  branches: DeploymentRepoOption[];
  selected_branch: string;
  commits: DeploymentCommitOption[];
}

export interface WorkspaceInfo {
  workspace_id: string;
  repo_url: string;
  branch: string;
  tree: FileNode[];
}

export interface WorkspaceFile {
  path: string;
  content: string;
  language: string;
  size_bytes: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SnippetInfo {
  name: string;
  code: string;
  language: string;
  tags: string[];
}

export interface CopilotSuggestion {
  original: string;
  modified: string;
  diff_summary: string;
  explanation: string;
  commit_message: string;
  snippets: SnippetInfo[];
  /** 0–1 as reported by the model; null when it did not report one. */
  confidence: number | null;
}

export interface SuggestCodeRequest {
  workspace_id: string;
  file_path: string;
  content: string;
  instruction: string;
  history: ChatMessage[];
  language?: string;
}

export interface FileSuggestion {
  file_path: string;
  original: string;
  modified: string;
  summary: string;
  is_new: boolean;
}

export interface WorkspaceSuggestRequest {
  workspace_id: string;
  instruction: string;
  history: ChatMessage[];
  context_files?: string[];
}

export interface WorkspaceSuggestResponse {
  files: FileSuggestion[];
  overall_summary: string;
  commit_message: string;
  explanation: string;
}

export interface AddCommentsRequest {
  workspace_id: string;
  file_path: string;
  content: string;
  language?: string;
  style?: string;
}

export interface ExplainCodeRequest {
  workspace_id: string;
  file_path: string;
  content: string;
  selection?: string;
  question?: string;
}

export interface ExplainCodeResponse {
  explanation: string;
  key_points: string[];
}

export interface SnippetItem {
  id: string;
  workspace_id: string;
  name: string;
  code: string;
  language: string;
  tags: string[];
  usage_count: number;
  created_at: string;
}

export interface CreateSnippetRequest {
  workspace_id: string;
  name: string;
  code: string;
  language: string;
  tags: string[];
}

export interface GitStatus {
  workspace_id: string;
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface CommitImpactTreeNode {
  id: string;
  path: string;
  name: string;
  status: "M" | "U" | "A" | "D" | " ";
  depth: number;
  is_entry: boolean;
  imports_count: number;
  impacted_by_count: number;
  children: CommitImpactTreeNode[];
}

export interface CommitImpactTreeResponse {
  workspace_id: string;
  roots: CommitImpactTreeNode[];
  summary: {
    root_count: number;
    node_count: number;
    max_depth: number;
    status_counts: {
      M: number;
      U: number;
      A: number;
      D: number;
    };
  };
}

export interface GitLogEntry {
  sha: string;
  short_sha: string;
  message: string;
  author: string;
  date: string;
}

export interface CommitRequest {
  workspace_id: string;
  branch: string;
  files: string[];
  message: string;
  author_name?: string;
  author_email?: string;
  new_file_contents: Record<string, string>;
  github_pat?: string;
}

export interface CommitResult {
  sha: string;
  message: string;
  branch: string;
  github_url: string;
  timestamp: string;
  /** False when the commit exists only in the server-side clone. */
  push_ok: boolean;
  push_error: string | null;
}

export interface PushRequest {
  workspace_id: string;
  /** Defaults to the workspace's checked-out branch. */
  branch?: string;
}

export interface PushResult {
  workspace_id: string;
  branch: string;
  /** Tip of the branch, now on the remote. */
  sha: string;
  github_url: string;
  /** True when this call sent commits. */
  pushed: boolean;
  /** True when the remote already had them. */
  up_to_date: boolean;
  message: string;
}

export interface CoverageGap {
  name: string;
  type: string;
  line_start: number;
  line_end: number;
  covered: boolean;
}

export interface CoverageAnalysis {
  file_path: string;
  total_functions: number;
  covered_functions: number;
  /** Null when the file has no functions to measure. */
  coverage_pct: number | null;
  gaps: CoverageGap[];
}

export interface CoverageAnalyzeRequest {
  workspace_id: string;
  file_path: string;
  content: string;
}

export interface TestGenerateRequest {
  workspace_id: string;
  file_path: string;
  content: string;
  gaps: string[];
  framework?: string;
  existing_tests?: string;
}

export interface GeneratedTest {
  function_name: string;
  code: string;
  description: string;
  gap_covered: string;
}

export interface TestGenerateResult {
  test_file_path: string;
  test_file_content: string;
  tests: GeneratedTest[];
}

export interface RunTestsRequest {
  workspace_id: string;
  test_file_path: string;
  test_content: string;
}

// ── Playwright Test Generation from Workspace Source ──────────────────────

export interface WorkspaceTestStep {
  action: string;
  selector: string | null;
  value: string | null;
  description: string;
}

export interface WorkspacePlaywrightTest {
  id: string;
  analysis_id: string;
  name: string;
  description: string;
  page_name: string;
  severity: string;
  steps: WorkspaceTestStep[];
}

export interface FileTestGroup {
  filePath: string;
  tests: WorkspacePlaywrightTest[];
}

export interface PlaywrightGenerateRequest {
  workspace_id: string;
  file_path: string;
  content: string;
  target_url?: string;
  num_tests?: number;
}

export interface PlaywrightGenerateResponse {
  tests: WorkspacePlaywrightTest[];
}

export interface PlaywrightExportRequest {
  workspace_id: string;
  tests: WorkspacePlaywrightTest[];
  target_url?: string;
}

export interface ChainAnalyzeRequest {
  workspace_id: string;
  chain: string[];
  changed_files: string[];
}

export interface FileChainAnalysis {
  file_path: string;
  summary: string;
  changes_description: string;
  suggested_count: number;
  reason: string;
}

export interface ChainAnalyzeResponse {
  analyses: FileChainAnalysis[];
}

export interface PlaywrightExportResponse {
  file_path: string;
  content: string;
}

export interface TestRunResult {
  passed: number;
  failed: number;
  errors: number;
  results: { name: string; status: string; duration_ms: number | null; message: string | null }[];
  output: string;
}

// ── Batch / App / Commit Playwright Generation ─────────────────────────────

export interface FilePayload {
  file_path: string;
  content: string;
}

export interface PlaywrightBatchGenerateRequest {
  files: FilePayload[];
  target_url?: string;
}

export interface PlaywrightAppGenerateRequest {
  workspace_id: string;
  target_url?: string;
}

export interface PlaywrightCommitGenerateRequest {
  workspace_id: string;
  commit_sha: string;
  target_url?: string;
}

// ── Saved Test Suites ──────────────────────────────────────────────────────

export interface SaveTestSuiteRequest {
  workspace_id: string;
  name: string;
  scope: "entire_app" | "commits" | "virtual_files" | "single_file";
  tests: WorkspacePlaywrightTest[];
  target_url?: string;
  commit_sha?: string;
}

export interface TestSuiteInfo {
  suite_id: string;
  workspace_id: string;
  name: string;
  scope: string;
  test_count: number;
  target_url?: string;
  commit_sha?: string;
  created_at: string;
}

export interface TestSuiteFull extends TestSuiteInfo {
  tests: WorkspacePlaywrightTest[];
}

// ─── Repo Baseline Types ───────────────────────────────────────────────────

export type BaselineTestCategory =
  | "auth"
  | "api"
  | "ui_form"
  | "ui_navigation"
  | "ui_component"
  | "crud"
  | "integration"
  | "edge_case"
  | "performance"
  | "accessibility";

export interface BaselineTestStep {
  action: string;
  target: string;
  value: string | null;
  assertion: string | null;
}

export interface BaselineTest {
  test_id: string;
  name: string;
  description: string;
  category: BaselineTestCategory;
  page_path: string | null;
  component_name: string | null;
  endpoint: string | null;
  severity: "critical" | "high" | "medium" | "low";
  source_file: string | null;
  steps: BaselineTestStep[];
  playwright_code: string;
  added_in_session: string;
  created_at: string;
  is_active: boolean;
}

export interface BaselineScanSession {
  session_id: string;
  scan_type: "full" | "incremental";
  changed_files: string[];
  tests_added: number;
  tests_total_after: number;
  commit_sha: string;
  triggered_at: string;
  status: "pending" | "running" | "done" | "failed";
  error: string | null;
  progress_message: string;
}

export interface BaselineScanResponse {
  session_id: string;
  repo_id: string;
  scan_type: "full" | "incremental";
  status: string;
}

export interface BaselineSessionStatus {
  session_id: string;
  scan_type: "full" | "incremental";
  status: "pending" | "running" | "done" | "failed";
  progress_message: string;
  tests_added: number;
  tests_total_after: number;
  error: string | null;
}

export interface BaselineRepoData {
  repo_id: string;
  github_url: string;
  total_tests: number;
  sessions: BaselineScanSession[];
  tests: BaselineTest[];
  new_test_ids: string[];
}

// ── AI Root Cause Analysis types ──
export interface RootCauseSummary {
  total_failures: number;
  root_causes_identified: number;
  high_confidence: number;
  requires_human_review: number;
  unresolved_failures: number;
}

export interface RootCauseListItem {
  id: string;
  test_name: string;
  repository: string | null;
  failure_type: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "analyzing" | "completed" | "failed";
  confidence: number;
  confidence_label: "high" | "medium" | "low";
  created_at: string;
}

export interface StepEvidence {
  step_number: number;
  step_description: string;
  status: "pass" | "fail";
  error: string | null;
}

export interface RootCauseEvidence {
  error_message: string | null;
  failed_step: StepEvidence | null;
  step_trace: StepEvidence[];
  expected: string | null;
  actual: string | null;
  console_logs: string[];
  recent_commits: CommitInfo[];
  git_diff: string | null;
  has_git_data: boolean;
  has_stack_trace: boolean;
  test_type: string | null;
}

export interface RootCauseDetail extends RootCauseListItem {
  run_id: string;
  test_id: string;
  commit_sha: string | null;
  evidence: RootCauseEvidence;
  root_cause_summary: string | null;
  root_cause_explanation: string | null;
  likely_commit: CommitInfo | null;
  affected_files: string[];
  affected_tests: string[];
  affected_services: string[];
  recommendation: string | null;
  ai_error: string | null;
  updated_at: string;
}

export interface UnanalyzedFailure {
  run_id: string;
  test_id: string;
  test_name: string;
  analysis_id: string;
  error: string | null;
  completed_at: string | null;
}

export interface HealingAttemptDetail {
  id: string;
  run_id: string;
  test_id: string;
  step_number: number;
  test_name: string;
  failure_type: string;
  original_selector: string | null;
  step_description: string | null;
  target_url: string;
  candidate: {
    selector: string | null;
    source: string;
    reasoning: string | null;
    considered: Array<{ selector: string; tag: string; text?: string | null }>;
  };
  validation: {
    attempted: boolean;
    selector_found_on_page: boolean | null;
    error: string | null;
  };
  confidence: number;
  confidence_label: string;
  status: "pending" | "approved" | "rejected" | "failed";
  error: string | null;
  created_at: string | null;
  decided_at: string | null;
}

// ── Intelligent Test Selection types ──
export interface SelectionReason {
  label: string;
  matched: boolean;
}

export interface SelectedTestOut {
  test_id: string;
  name: string;
  source_file: string | null;
  category: string;
  severity: string;
  /** null when no diff was available: the test runs as a fallback and was not scored. */
  score: number | null;
  priority: "critical" | "high" | "medium" | "low" | null;
  reasons: SelectionReason[];
  selected: boolean;
}

export interface TestSelectionSummary {
  total_tests: number;
  relevant_tests: number;
  selected_tests: number;
  skipped_tests: number;
  estimated_savings_pct: number | null;
}

export interface TestSelectionRun {
  id: string;
  repo_id: string;
  github_url: string;
  old_sha: string | null;
  new_sha: string | null;
  changed_files: string[];
  diff_available: boolean;
  summary: TestSelectionSummary;
  tests: SelectedTestOut[];
  status: "completed" | "failed";
  error: string | null;
  created_at: string;
}

export interface OptimizationFinding {
  kind: "duplicate" | "coverage_gap" | "flaky" | "long_running";
  description: string;
  test_ids: string[];
  available: boolean;
}

export interface TestOptimizationReport {
  repo_id: string;
  total_tests: number;
  potential_duplicates: number;
  coverage_gaps: number;
  flaky_tests: number | null;
  long_running_tests: number | null;
  findings: OptimizationFinding[];
  optimization_opportunity: "high" | "medium" | "low";
}

// ─── API Functions ─────────────────────────────────────────────────────────

export const api = {

  // Requirements
  analyzeRequirement: (text: string, instructions?: string) =>
    apiClient.post<AnalyzeRequirementResult>("/requirements", { text, instructions }).then((r) => r.data),

  listRequirements: () =>
    apiClient.get<Requirement[]>("/requirements").then((r) => r.data),

  // Test Cases
  getGroupedTestCases: (requirementId?: string) =>
    apiClient
      .get<GroupedTestCases>("/test-cases/grouped", {
        params: requirementId ? { requirement_id: requirementId } : {},
      })
      .then((r) => r.data),

  getTestCases: (requirementId?: string, category?: string) =>
    apiClient
      .get<TestCase[]>("/test-cases", {
        params: { ...(requirementId && { requirement_id: requirementId }), ...(category && { category }) },
      })
      .then((r) => r.data),

  // `id` is the case's document id; tc_id repeats across requirements.
  updateTestCase: (id: string, payload: Partial<TestCase>) =>
    apiClient.put<TestCase>(`/test-cases/${id}`, payload).then((r) => r.data),

  // Test Execution
  runTests: (payload: {
    requirementId: string;
    targetUrl: string;
    username?: string;
    password?: string;
    replan?: boolean;
    /** Plan again only the cases whose saved plan says "not automatable". */
    replanSkipped?: boolean;
  }) =>
    apiClient
      .post<RunStarted>("/test-execution/run", {
        requirement_id: payload.requirementId,
        target_url: payload.targetUrl,
        username: payload.username || undefined,
        password: payload.password || undefined,
        replan: payload.replan ?? false,
        replan_skipped: payload.replanSkipped ?? false,
      })
      .then((r) => r.data),

  listRuns: (requirementId?: string, limit = 20) =>
    apiClient
      .get<RunSummary[]>("/test-execution/runs", {
        params: { ...(requirementId && { requirement_id: requirementId }), limit },
      })
      .then((r) => r.data),

  getResults: (runId?: string, limit = 100) =>
    apiClient
      .get<TestResult[]>("/test-execution/results", {
        params: { ...(runId && { run_id: runId }), limit },
      })
      .then((r) => r.data),

  getRunSummary: (runId: string) =>
    apiClient.get<RunSummary>(`/test-execution/runs/${runId}`).then((r) => r.data),

  // Synthetic Data
  previewSyntheticData: (requirement_id: string, count = 20) =>
    apiClient
      .post<PreviewDataset>("/synthetic-data/preview", { requirement_id, count })
      .then((r) => r.data),

  generateSyntheticData: (requirement_id: string, count = 20) =>
    apiClient
      .post<SyntheticDataset>("/synthetic-data/generate", { requirement_id, count })
      .then((r) => r.data),

  getSyntheticDatasets: (limit = 10) =>
    apiClient.get<SyntheticDataset[]>("/synthetic-data", { params: { limit } }).then((r) => r.data),

  // Prioritization
  getPrioritizedTests: (refresh = false) =>
    apiClient
      .get<PrioritizedTest[]>("/prioritization", { params: { refresh } })
      .then((r) => r.data),

  // Dashboard
  getDashboardStats: () =>
    apiClient.get<DashboardStats>("/dashboard/stats").then((r) => r.data),

  updateMe: (data: { name?: string; notifications?: boolean; newsletter?: boolean }) =>
    apiClient
      .patch<{
        user_id: string;
        org_id: string;
        org_name: string;
        email?: string | null;
        name?: string | null;
        notifications?: boolean;
        newsletter?: boolean;
      }>("/auth/me", data)
      .then((r) => r.data),

  // ── Repo Analysis & Live Testing ──────────────────────────────────────────
  startAnalyzeRepo: (
    github_url: string,
    target_url: string,
    test_email?: string,
    test_password?: string,
    test_preferences?: string,
    num_tests?: number,
    mode?: "full" | "commit",
    commit_sha?: string,
    commit_message?: string,
    pat?: string,
  ) =>
    apiClient
      .post<{ job_id: string; status: string; mode: string }>("/repo/analyze", {
        github_url,
        target_url,
        ...(test_email && { test_email }),
        ...(test_password && { test_password }),
        ...(test_preferences && { test_preferences }),
        num_tests: num_tests ?? 1,
        mode: mode ?? "full",
        ...(commit_sha && { commit_sha }),
        ...(commit_message && { commit_message }),
        ...(pat && { pat }),
      })
      .then((r) => r.data),

  getRepoCommits: (github_url: string, pat?: string) =>
    apiClient
      .post<{ commits: CommitInfo[] }>("/repo/commits", { github_url, ...(pat ? { pat } : {}) })
      .then((r) => r.data),

  getDefaultBranch: (github_url: string) =>
    apiClient.post<{ branch: string }>("/repo/default-branch", { github_url }).then((r) => r.data),

  getAnalysisJob: (jobId: string) =>
    apiClient.get<AnalysisJob>(`/repo/jobs/${jobId}`).then((r) => r.data),

  getRepoTests: (analysisId: string) =>
    apiClient.get<PlaywrightTestCase[]>(`/repo/analyses/${analysisId}/tests`).then((r) => r.data),

  // The test account fills the {{TEST_EMAIL}} / {{TEST_PASSWORD}} placeholders in the
  // stored steps on the server at run time; it is sent in the body and never stored.
  executeRepoTests: (analysisId: string, test_email?: string, test_password?: string) =>
    apiClient
      .post<{ run_id: string; total: number; status: string }>(`/repo/analyses/${analysisId}/execute`, {
        ...(test_email && { test_email }),
        ...(test_password && { test_password }),
      })
      .then((r) => r.data),

  getLiveRunStatus: (runId: string) =>
    apiClient.get<LiveRunStatus>(`/repo/execution/${runId}`).then((r) => r.data),

  listRunHistory: () =>
    apiClient.get<{ runs: RunSummaryItem[] }>("/repo/runs").then((r) => r.data),

  getRunDetail: (runId: string) =>
    apiClient.get<LiveRunStatus>(`/repo/runs/${runId}`).then((r) => r.data),

  updatePlaywrightTest: (test_id: string, data: Partial<PlaywrightTestCase>) =>
    apiClient.put<PlaywrightTestCase>(`/repo/tests/${test_id}`, data).then((r) => r.data),

  // Run tests directly without going through the analysis pipeline
  executeTestsDirect: (tests: PlaywrightTestCase[], targetUrl: string, test_email?: string, test_password?: string) =>
    apiClient
      .post<{ run_id: string; total: number; status: string }>("/repo/execute-direct", {
        tests,
        target_url: targetUrl,
        ...(test_email && { test_email }),
        ...(test_password && { test_password }),
      })
      .then((r) => r.data),

  // Parse a .spec.ts file into structured test cases
  uploadAndParseSpec: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient
      .post<{ filename: string; test_count: number; tests: PlaywrightTestCase[] }>(
        "/repo/upload-spec",
        form,
        { headers: { "Content-Type": "multipart/form-data" } },
      )
      .then((r) => r.data);
  },

  // ── GitHub ────────────────────────────────────────────────────────────────
  getRepoPRs: (owner: string, repo: string) =>
    apiClient.get("/github/prs", { params: { owner, repo } }).then((r) => r.data as any[]),

  getPRFiles: (owner: string, repo: string, prNumber: number) =>
    apiClient.get(`/github/pr/${prNumber}/files`, { params: { owner, repo } }).then((r) => r.data as any[]),

  reviewPR: (owner: string, repo: string, prNumber: number, customRules?: string) =>
    apiClient.post(`/github/pr/${prNumber}/review`, { custom_rules: customRules || undefined }, { params: { owner, repo } }).then((r) => r.data),

  getWorkflowRuns: (owner: string, repo: string) =>
    apiClient.get("/github/workflow-runs", { params: { owner, repo } }).then((r) => r.data as any[]),

  explainRunFailure: (owner: string, repo: string, runId: number) =>
    apiClient.post(`/github/workflow-runs/${runId}/explain`, null, { params: { owner, repo } }).then((r) => r.data),

  // ── Jira ──────────────────────────────────────────────────────────────────
  getJiraProjects: () =>
    apiClient.get("/jira/projects").then((r) => r.data as any[]),

  getJiraStories: (project: string) =>
    apiClient.get("/jira/stories", { params: { project } }).then((r) => r.data as any[]),

  analyzeSprintAC: (project: string) =>
    apiClient.post("/jira/analyze-sprint", { project }).then((r) => r.data),

  analyzeManualStory: (summary: string, description: string, priority: string) =>
    apiClient.post("/jira/analyze-manual", { summary, description, priority }).then((r) => r.data),

  generateStoryAC: (issueKey: string, project: string) =>
    apiClient.post(`/jira/stories/${issueKey}/generate-ac`, { project }).then((r) => r.data),

  pushACToJira: (issueKey: string, text: string) =>
    apiClient.post(`/jira/stories/${issueKey}/update-ac`, { acceptance_criteria_text: text }).then((r) => r.data),

  getJiraBugs: (project: string, version?: string) =>
    apiClient.get("/jira/bugs", { params: { project, ...(version && { version }) } }).then((r) => r.data as any[]),

  // ── CI Intelligence ───────────────────────────────────────────────────────
  getCIHealth: (owner: string, repo: string) =>
    apiClient.get("/ci/health", { params: { owner, repo } }).then((r) => r.data),

  getFlakyTests: (owner: string, repo: string) =>
    apiClient.get("/ci/flaky-tests", { params: { owner, repo } }).then((r) => r.data),

  explainCIFailure: (owner: string, repo: string, runId: number) =>
    apiClient.post(`/ci/runs/${runId}/explain`, null, { params: { owner, repo } }).then((r) => r.data),

  // ── Defect Prediction ─────────────────────────────────────────────────────
  getDefectRiskScores: (owner: string, repo: string, sinceDays: number = 90) =>
    apiClient.get("/defect-prediction/risk-scores", { params: { owner, repo, since_days: sinceDays } }).then((r) => r.data),

  // ── AI Root Cause Analysis ──
  listRootCauses: () =>
    apiClient.get<{ summary: RootCauseSummary; items: RootCauseListItem[] }>("/testing/root-cause").then(r => r.data),
  getRootCause: (id: string) =>
    apiClient.get<RootCauseDetail>(`/testing/root-cause/${id}`).then(r => r.data),
  analyzeFailure: (runId: string, testId: string) =>
    apiClient.post<RootCauseDetail>("/testing/root-cause/analyze", { run_id: runId, test_id: testId }).then(r => r.data),
  rerunRootCauseTest: (id: string) =>
    apiClient.post<{ run_id: string; status: string }>(`/testing/root-cause/${id}/rerun`).then(r => r.data),
  listUnanalyzedFailures: () =>
    apiClient.get<{ failures: UnanalyzedFailure[] }>("/testing/root-cause/failures").then(r => r.data),

  analyzeHealing: (payload: { run_id: string; test_id: string; target_url: string }) =>
    apiClient.post<HealingAttemptDetail>("/testing/healing/analyze", payload).then((r) => r.data),
  getHealingAttempt: (id: string) =>
    apiClient.get<HealingAttemptDetail>(`/testing/healing/${id}`).then((r) => r.data),
  approveHealing: (id: string) =>
    apiClient.post<HealingAttemptDetail>(`/testing/healing/${id}/approve`).then((r) => r.data),
  rejectHealing: (id: string) =>
    apiClient.post<HealingAttemptDetail>(`/testing/healing/${id}/reject`).then((r) => r.data),

  // ── Intelligent Test Selection ──
  analyzeTestSelection: (repoId: string, githubUrl: string, oldSha?: string, newSha?: string) =>
    apiClient.post<TestSelectionRun>("/testing/test-selection/analyze", {
      repo_id: repoId, github_url: githubUrl, old_sha: oldSha, new_sha: newSha,
    }).then(r => r.data),
  getTestSelectionRun: (id: string) =>
    apiClient.get<TestSelectionRun>(`/testing/test-selection/${id}`).then(r => r.data),
  listTestSelectionHistory: () =>
    apiClient.get<{ runs: TestSelectionRun[] }>("/testing/test-selection/history").then(r => r.data),

  // ── Activity / search / repo-probe history (server-side) ──
  listActivityHistory: (params?: { kind?: ActivityKind; limit?: number }) =>
    apiClient
      .get<{ items: ActivityHistoryItem[] }>("/activity/history", { params })
      .then((r) => r.data),
  pushActivityHistory: (body: {
    kind?: ActivityKind;
    title: string;
    url: string;
    section?: string;
    payload?: Record<string, unknown>;
  }) => apiClient.post<ActivityHistoryItem>("/activity/history", body).then((r) => r.data),
  clearActivityHistory: (kind?: ActivityKind) =>
    apiClient.delete<{ deleted: number }>("/activity/history", { params: kind ? { kind } : {} }).then((r) => r.data),

  // ── Org connectors (reconfigurable secrets) ──
  getConnectors: () =>
    apiClient.get<ConnectorsPublic>("/orgs/current/connectors").then((r) => r.data),
  /** Connector name → fields to save; `clear` lists saved values to remove, e.g. {github: ["token"]}. */
  putConnectors: (body: Record<string, Record<string, string | string[]>>) =>
    apiClient.put<ConnectorsPublic>("/orgs/current/connectors", body).then((r) => r.data),

  executeTestSelection: (id: string, targetUrl: string) =>
    apiClient.post<{ run_id: string; status: string; test_count: number }>(
      `/testing/test-selection/${id}/execute`, { target_url: targetUrl }
    ).then(r => r.data),
  getTestOptimizationReport: (repoId: string) =>
    apiClient.get<TestOptimizationReport>("/testing/test-selection/optimization", { params: { repo_id: repoId } }).then(r => r.data),

  // ── Release Gate ──────────────────────────────────────────────────────────
  evaluateRelease: (params: { version: string; owner: string; repo: string; jira_project?: string }) =>
    apiClient.post("/release-gate/evaluate", params).then((r) => r.data),

  // ── Monitoring ────────────────────────────────────────────────────────────
  simulateTimeSeries: (baseline: Record<string, number>, days?: number) =>
    apiClient.post("/monitoring/simulate-time-series", { baseline, days }).then((r) => r.data),

  /** `demo` marks the built-in demo series, so the server never alerts Slack or Datadog for it. */
  analyzeTimeSeries: (series: any[], demo = false) =>
    apiClient.post("/monitoring/analyze", { series, demo }).then((r) => r.data),

  // ── Incidents ─────────────────────────────────────────────────────────────
  createIncident: (data: { anomaly: any; column_comparison?: any[]; recent_commits?: string[]; related_alerts?: any[]; title?: string }) =>
    apiClient.post("/incidents", data).then((r) => r.data),

  listIncidents: () =>
    apiClient.get("/incidents").then((r) => r.data as any[]),

  getIncident: (id: string) =>
    apiClient.get(`/incidents/${id}`).then((r) => r.data),

  resolveIncident: (id: string, note?: string) =>
    apiClient.put(`/incidents/${id}/resolve`, { note }).then((r) => r.data),

  generatePostmortem: (id: string) =>
    apiClient.post(`/incidents/${id}/postmortem`).then((r) => r.data),

  // ── Sprint Intelligence ───────────────────────────────────────────────────
  generateSprintReport: (params: { owner: string; repo: string; jira_project?: string; sprint_name?: string }) =>
    apiClient.post("/sprint/report", params).then((r) => r.data),

  getDORAMetrics: (owner: string, repo: string) =>
    apiClient.get("/sprint/dora", { params: { owner, repo } }).then((r) => r.data),

  // ── AI Workspace ──────────────────────────────────────────────────────────
  connectWorkspace: (github_url: string, branch: string, pat?: string) =>
    apiClient.post<WorkspaceInfo>("/workspace/connect", { 
      github_url, 
      branch, 
      ...(pat ? { pat } : {}) 
    }).then((r) => r.data),

  getWorkspaceTree: (workspaceId: string) =>
    apiClient.get<{ workspace_id: string; tree: FileNode[] }>(`/workspace/${workspaceId}/tree`).then((r) => r.data),

  getWorkspaceFile: (workspaceId: string, path: string) =>
    apiClient.get<WorkspaceFile>(`/workspace/${workspaceId}/file`, { params: { path } }).then((r) => r.data),

  saveWorkspaceFile: (workspaceId: string, path: string, content: string) =>
    apiClient.put(`/workspace/${workspaceId}/file`, { content }, { params: { path } }).then((r) => r.data),

  deleteWorkspace: (workspaceId: string) =>
    apiClient.delete(`/workspace/${workspaceId}`).then((r) => r.data),

  // Copilot
  suggestCode: (payload: SuggestCodeRequest) =>
    apiClient.post<CopilotSuggestion>("/copilot/suggest", payload).then((r) => r.data),

  addComments: (payload: AddCommentsRequest) =>
    apiClient.post<CopilotSuggestion>("/copilot/add-comments", payload).then((r) => r.data),

  explainCode: (payload: ExplainCodeRequest) =>
    apiClient.post<ExplainCodeResponse>("/copilot/explain", payload).then((r) => r.data),

  suggestWorkspace: (payload: WorkspaceSuggestRequest) =>
    apiClient.post<WorkspaceSuggestResponse>("/copilot/suggest-workspace", payload).then((r) => r.data),

  getSnippets: (params?: { lang?: string; tag?: string; workspace_id?: string }) =>
    apiClient.get<SnippetItem[]>("/copilot/snippets", { params }).then((r) => r.data),

  createSnippet: (payload: CreateSnippetRequest) =>
    apiClient.post<SnippetItem>("/copilot/snippets", payload).then((r) => r.data),

  deleteSnippet: (id: string) =>
    apiClient.delete(`/copilot/snippets/${id}`).then((r) => r.data),

  // Git
  getGitStatus: (workspaceId: string) =>
    apiClient.get<GitStatus>("/git/status", { params: { workspace_id: workspaceId } }).then((r) => r.data),

  getGitLog: (workspaceId: string, maxCount?: number) =>
    apiClient.get<{ workspace_id: string; commits: GitLogEntry[] }>("/git/log", { params: { workspace_id: workspaceId, max_count: maxCount } }).then((r) => r.data),

  getGitDiff: (workspaceId: string, filePath: string) =>
    apiClient.get<{ diff: string }>("/git/diff", { params: { workspace_id: workspaceId, file_path: filePath } }).then((r) => r.data),

  getCommitImpactTree: (workspaceId: string, maxDepth = 4, pat?: string) =>
    apiClient
      .get<CommitImpactTreeResponse>("/commit/impact-tree", {
        params: { workspace_id: workspaceId, max_depth: maxDepth, ...(pat ? { pat } : {}) },
      })
      .then((r) => r.data),

  createBranch: (payload: { workspace_id: string; branch_name: string; from_branch?: string }) =>
    apiClient.post("/git/branch", payload).then((r) => r.data),

  commitAndPush: (payload: CommitRequest) =>
    apiClient.post<CommitResult>("/git/commit", payload).then((r) => r.data),

  /** Push the workspace's existing commits without creating a new one. */
  pushBranch: (payload: PushRequest) =>
    apiClient.post<PushResult>("/git/push", payload).then((r) => r.data),

  // Coverage
  analyzeCoverage: (payload: CoverageAnalyzeRequest) =>
    apiClient.post<CoverageAnalysis>("/coverage/analyze", payload).then((r) => r.data),

  // Test Generation
  generateTests: (payload: TestGenerateRequest) =>
    apiClient.post<TestGenerateResult>("/tests/generate", payload).then((r) => r.data),


  // Playwright Test Generation from Workspace Source
  generatePlaywrightTests: (payload: PlaywrightGenerateRequest) =>
    apiClient.post<PlaywrightGenerateResponse>("/tests/generate-playwright", payload).then((r) => r.data),

  analyzeChain: (payload: ChainAnalyzeRequest) =>
    apiClient.post<ChainAnalyzeResponse>("/tests/analyze-chain", payload).then((r) => r.data),

  exportPlaywrightTests: (payload: PlaywrightExportRequest) =>
    apiClient.post<PlaywrightExportResponse>("/tests/export-playwright", payload).then((r) => r.data),

  // Batch / App / Commit Playwright Generation
  generatePlaywrightBatch: (payload: PlaywrightBatchGenerateRequest) =>
    apiClient.post<PlaywrightGenerateResponse>("/tests/generate-playwright-batch", payload).then((r) => r.data),

  generatePlaywrightApp: (payload: PlaywrightAppGenerateRequest) =>
    apiClient.post<PlaywrightGenerateResponse>("/tests/generate-playwright-app", payload).then((r) => r.data),

  generatePlaywrightCommit: (payload: PlaywrightCommitGenerateRequest) =>
    apiClient.post<PlaywrightGenerateResponse>("/tests/generate-playwright-commit", payload).then((r) => r.data),

  // Saved Test Suites
  saveTestSuite: (payload: SaveTestSuiteRequest) =>
    apiClient.post<TestSuiteInfo>("/tests/workspace-suites", payload).then((r) => r.data),

  listTestSuites: (workspace_id: string) =>
    apiClient.get<TestSuiteInfo[]>("/tests/workspace-suites", { params: { workspace_id } }).then((r) => r.data),

  getTestSuite: (suite_id: string) =>
    apiClient.get<TestSuiteFull>(`/tests/workspace-suites/${suite_id}`).then((r) => r.data),

  deleteTestSuite: (suite_id: string) =>
    apiClient.delete(`/tests/workspace-suites/${suite_id}`).then((r) => r.data),

  // ── Pipeline ──────────────────────────────────────────────────────────────
  // The PAT travels in the body, never as a query parameter (access logs, browser history).
  reviewCommit: (owner: string, repo: string, sha: string, pat?: string, customRules?: string) =>
    apiClient
      .post(`/github/commits/${sha}/review`, { custom_rules: customRules || undefined, pat: pat || undefined }, { params: { owner, repo } })
      .then((r) => r.data as {
        sha: string;
        review: PipelineReview;
        files_reviewed: number;
        files_in_pr?: number;
        files_failed?: number;
        files_skipped?: number;
        files_truncated?: number;
        review_status?: "complete" | "partial" | "incomplete";
      }),

  evaluatePipeline: (payload: PipelineReportRequest) =>
    apiClient.post<PipelineReport>("/pipeline/report", payload).then((r) => r.data),

  listPipelineRuns: () =>
    apiClient.get<PipelineRunSummary[]>("/pipeline/runs").then((r) => r.data),

  // ── Deployments ──────────────────────────────────────────────────────────
  getDeploymentHealth: () =>
    apiClient.get<DeploymentConfigHealth>("/deployments/health").then((r) => r.data),

  getDeploymentRepoOptions: (repoUrl: string, branch?: string) =>
    apiClient
      .get<DeploymentRepoOptionsResponse>("/deployments/repo-options", {
        params: { repo_url: repoUrl, ...(branch ? { branch } : {}) },
      })
      .then((r) => r.data),

  triggerDeployment: (payload: DeploymentTriggerRequest & { github_pat?: string }) =>
    apiClient.post<DeploymentTriggerResponse>("/deployments/trigger", payload).then((r) => r.data),

  getDeploymentStatus: (deploymentId: string) =>
    apiClient.get<DeploymentStatusResponse>(`/deployments/${deploymentId}/status`).then((r) => r.data),

  getDeploymentEvents: (deploymentId: string, limit = 120) =>
    apiClient
      .get<DeploymentEventsResponse>(`/deployments/${deploymentId}/events`, { params: { limit } })
      .then((r) => r.data),

  generatePRD: (payload: PRDGenerateRequest) =>
    apiClient.post<PRDGenerateResponse>("/prd/generate", payload).then((r) => r.data),

  /** Normalise a GitHub URL into a 16-char repo_id matching backend logic. */
  getRepoId: repoIdFromUrl,
};

// ─── Code Impact + Test Intelligence Types ────────────────────────────────────

export interface GraphNode {
  id: string;
  path: string;
  name: string;
  ext: string;
  is_changed: boolean;
  is_impacted: boolean;
  /** Test/spec file — the UI can filter these out of the graph. */
  is_test?: boolean;
  layer: number;
  layer_index: number;
  x: number;
  y: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface DependencyGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  tree: Record<string, unknown>;
  changed_files: string[];
  impacted_files: string[];
  pr_title?: string;
  pr_url?: string;
  commit_message?: string;
  message?: string;
}

export interface ImpactPathResponse {
  focus_file: string;
  root_path: string[];
  leaf_path: string[];
  full_path: string[];
  upstream: string[];
  downstream: string[];
}

export interface FileContentResponse {
  path: string;
  content: string;
  language: string;
}

export interface ImpactGeneratedTest {
  id: string;
  name: string;
  description: string;
  code: string;
  framework: string;
  file_target: string;
  test_type: string;
  tags: string[];
}

export interface ImpactPlaywrightStep {
  action: string;
  selector: string | null;
  value: string | null;
  description: string;
}

export interface ImpactPlaywrightTest {
  id: string;
  analysis_id: string;
  name: string;
  description: string;
  page_name: string;
  severity: string;
  steps: ImpactPlaywrightStep[];
  file_target: string;
}

export interface GenerateTestsResponse {
  tests: ImpactGeneratedTest[];
  framework: string;
  file_path: string;
}

export interface DocScenario {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  priority: string;
}

export interface ParseDocsResponse {
  scenarios: DocScenario[];
  total: number;
}

export interface GenerateFromDocsResponse {
  tests: ImpactPlaywrightTest[];
  total: number;
}

export interface ImpactTestResult {
  test_id: string;
  test_name: string;
  status: "passed" | "failed" | "skipped";
  duration_ms: number;
  error?: string | null;
  output?: string | null;
}

export interface RunTestResponse {
  results: ImpactTestResult[];
  passed: number;
  failed: number;
  total: number;
  pass_rate: number;
}

// ─── Code Impact + Test Intelligence API ─────────────────────────────────────

export const impactApi = {
  buildGraph: (payload: { owner: string; repo: string; pr_number?: number; commit_sha?: string; pat?: string }) =>
    apiClient.post<DependencyGraphResponse>("/impact/graph", payload).then((r) => r.data),

  getImpactPath: (payload: { nodes: GraphNode[]; edges: GraphEdge[]; focus_file: string }) =>
    apiClient.post<ImpactPathResponse>("/impact/impact-path", payload).then((r) => r.data),

  getFileContent: (payload: { owner: string; repo: string; path: string; ref?: string; pat?: string }) =>
    apiClient.post<FileContentResponse>("/impact/file-content", payload).then((r) => r.data),

  generateFromCode: (payload: {
    owner: string;
    repo: string;
    file_path: string;
    file_content: string;
    language: string;
    impact_context?: string[];
  }) =>
    apiClient.post<GenerateTestsResponse>("/impact/generate-from-code", payload).then((r) => r.data),

  uploadDoc: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient
      .post<ParseDocsResponse>("/impact/upload-doc", form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },

  generateFromDocs: (payload: { scenarios: DocScenario[]; framework?: string }) =>
    apiClient.post<GenerateFromDocsResponse>("/impact/generate-from-docs", payload).then((r) => r.data),

  buildWorkspaceGraph: (payload: { workspace_id: string; file_paths?: string[]; pat?: string }) =>
    apiClient
      .post<WorkspaceGraphResponse>("/impact/workspace-graph", payload)
      .then((r) => r.data),
};

// ─── Workspace Dependency Graph Types ────────────────────────────────────────

export interface WorkspaceGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ─── PRD Generator Types ──────────────────────────────────────────────────────

export interface PRDUseCase {
  title: string;
  actor: string;
  description: string;
  steps: string[];
}

export interface PRDUserStory {
  as_a: string;
  i_want: string;
  so_that: string;
  acceptance_criteria: string[];
}

export interface PRDSection {
  executive_summary: string;
  problem_statement: string;
  goals: string[];
  target_users: string[];
  use_cases: PRDUseCase[];
  user_stories: PRDUserStory[];
  functional_requirements: string[];
  non_functional_requirements: string[];
  out_of_scope: string[];
  success_metrics: string[];
}

export interface PRDGenerateRequest {
  product_name: string;
  description: string;
  target_audience: string;
  tech_stack?: string;
  core_features: string[];
  additional_context?: string;
}

export interface PRDGenerateResponse {
  id: string;
  product_name: string;
  markdown: string;
  sections: PRDSection;
  created_at: string;
}

// ─── Repo Baseline API ─────────────────────────────────────────────────────

export const baselineApi = {
  /** Start a scan. First submission → full scan. Subsequent → incremental. */
  scan: (github_url: string, github_token?: string) =>
    apiClient
      .post<BaselineScanResponse>("/baseline/scan", { github_url, github_token })
      .then((r) => r.data),

  /** Poll this every 3s until status === 'done' | 'failed'. */
  getStatus: (session_id: string) =>
    apiClient
      .get<BaselineSessionStatus>(`/baseline/status/${session_id}`)
      .then((r) => r.data),

  /** Fetch all tests + sessions for a repo. Pass session_id to highlight new tests. */
  getRepoTests: (repo_id: string, session_id?: string) =>
    apiClient
      .get<BaselineRepoData>(`/baseline/${repo_id}`, {
        params: session_id ? { session_id } : {},
      })
      .then((r) => r.data),

  /** Push ad-hoc generated tests from Workspace or Live Runner into the baseline. */
  syncTests: (repo_id: string, tests: BaselineTest[], source: "workspace" | "live_runner") =>
    apiClient
      .post<{ status: string; added_count: number }>("/baseline/sync", { repo_id, tests, source })
      .then((r) => r.data),

  /** Normalise a GitHub URL into a 16-char repo_id matching backend logic. */
  getRepoId: repoIdFromUrl,
};

