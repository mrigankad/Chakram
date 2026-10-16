"""Pydantic schemas for the AI Workspace feature."""
from typing import Optional
from pydantic import BaseModel


# ── Workspace ──────────────────────────────────────────────────────────────

class ConnectRepoRequest(BaseModel):
    github_url: str          # e.g. "https://github.com/owner/repo"
    branch: str = "main"
    pat: Optional[str] = None  # GitHub personal access token (stored server-side only)


class FileNode(BaseModel):
    name: str
    path: str                # relative path from repo root
    type: str                # "file" | "directory"
    language: Optional[str] = None
    children: Optional[list["FileNode"]] = None

FileNode.model_rebuild()


class WorkspaceInfo(BaseModel):
    workspace_id: str
    repo_url: str
    branch: str
    tree: list[FileNode]


class FileContentResponse(BaseModel):
    path: str
    content: str
    language: str
    size_bytes: int


class SaveFileRequest(BaseModel):
    content: str


# ── Copilot ────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class SuggestCodeRequest(BaseModel):
    workspace_id: str
    file_path: str
    content: str
    instruction: str
    history: list[ChatMessage] = []
    language: Optional[str] = None


class SnippetInfo(BaseModel):
    name: str
    code: str
    language: str
    tags: list[str] = []


class SuggestCodeResponse(BaseModel):
    original: str
    modified: str
    diff_summary: str
    explanation: str
    commit_message: str
    snippets: list[SnippetInfo] = []
    # The model's self-reported confidence (0-1); null when it did not give one.
    confidence: Optional[float] = None


class AddCommentsRequest(BaseModel):
    workspace_id: str
    file_path: str
    content: str
    language: Optional[str] = None
    style: str = "google"  # "google" | "numpy" | "jsdoc"


class ExplainCodeRequest(BaseModel):
    workspace_id: str
    file_path: str
    content: str
    selection: Optional[str] = None  # selected code block, if any
    question: Optional[str] = None


class ExplainCodeResponse(BaseModel):
    explanation: str
    key_points: list[str] = []


class CreateSnippetRequest(BaseModel):
    workspace_id: str
    name: str
    code: str
    language: str
    tags: list[str] = []


class SnippetResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    code: str
    language: str
    tags: list[str]
    usage_count: int
    created_at: str


# ── Git Operations ─────────────────────────────────────────────────────────

class CommitRequest(BaseModel):
    workspace_id: str
    branch: str
    files: list[str]          # relative paths to stage
    message: str
    author_name: Optional[str] = None   # defaults to settings.COMMIT_AUTHOR_NAME
    author_email: Optional[str] = None  # defaults to settings.COMMIT_AUTHOR_EMAIL
    new_file_contents: dict[str, str] = {}  # path -> new content to write before commit


class CommitResponse(BaseModel):
    sha: str
    message: str
    branch: str
    github_url: str
    timestamp: str
    push_ok: bool = True
    push_error: str | None = None


class BranchRequest(BaseModel):
    workspace_id: str
    branch_name: str
    # None: branch from the workspace's current branch (its cloned default branch).
    from_branch: str | None = None


class GitStatusResponse(BaseModel):
    workspace_id: str
    branch: str
    staged: list[str]
    unstaged: list[str]
    untracked: list[str]


class GitLogEntry(BaseModel):
    sha: str
    short_sha: str
    message: str
    author: str
    date: str


# ── Workspace-wide Copilot ────────────────────────────────────────────────

class WorkspaceSuggestRequest(BaseModel):
    workspace_id: str
    instruction: str
    history: list[ChatMessage] = []
    context_files: list[str] = []   # optional: specific files to include as context


class FileSuggestion(BaseModel):
    file_path: str
    original: str
    modified: str
    summary: str
    is_new: bool = False


class WorkspaceSuggestResponse(BaseModel):
    files: list[FileSuggestion]
    overall_summary: str
    commit_message: str
    explanation: str


# ── Coverage ───────────────────────────────────────────────────────────────

class CoverageGap(BaseModel):
    name: str
    type: str       # "function" | "class" | "branch"
    line_start: int
    line_end: int
    covered: bool


class CoverageAnalyzeRequest(BaseModel):
    workspace_id: str
    file_path: str
    content: str


class CoverageAnalyzeResponse(BaseModel):
    file_path: str
    total_functions: int
    covered_functions: int
    coverage_pct: Optional[float] = None  # None when the file has no functions to measure
    gaps: list[CoverageGap]


# ── Test Generation ────────────────────────────────────────────────────────

class TestGenerateRequest(BaseModel):
    workspace_id: str
    file_path: str
    content: str
    gaps: list[str]          # gap function/branch names to target
    framework: str = "pytest"
    existing_tests: Optional[str] = None


class GeneratedTestCase(BaseModel):
    function_name: str
    code: str
    description: str
    gap_covered: str


class TestGenerateResponse(BaseModel):
    test_file_path: str
    test_file_content: str
    tests: list[GeneratedTestCase]


class RunTestsRequest(BaseModel):
    workspace_id: str
    test_file_path: str
    test_content: str


class TestRunResult(BaseModel):
    name: str
    status: str   # "passed" | "failed" | "error"
    duration_ms: Optional[float] = None
    message: Optional[str] = None


class RunTestsResponse(BaseModel):
    passed: int
    failed: int
    errors: int
    results: list[TestRunResult]
    output: str


# ── Playwright Test Generation from Source ─────────────────────────────────

class PlaywrightTestStep(BaseModel):
    action: str
    selector: Optional[str] = None
    value: Optional[str] = None
    description: str


class GeneratedPlaywrightTest(BaseModel):
    id: str
    analysis_id: str = "workspace"
    name: str
    description: str
    page_name: str
    severity: str = "Medium"
    steps: list[PlaywrightTestStep]


class PlaywrightGenerateRequest(BaseModel):
    workspace_id: str
    file_path: str
    content: str
    target_url: Optional[str] = None
    num_tests: Optional[int] = 5
    num_tests: Optional[int] = 5


class PlaywrightGenerateResponse(BaseModel):
    tests: list[GeneratedPlaywrightTest]
    # Batch generation: files whose generation failed, as {file_path, error}.
    failed_files: list[dict] = []


# ── Batch / App-wide / Commit-based Playwright Generation ──────────────────

class FilePayload(BaseModel):
    file_path: str
    content: str


class PlaywrightBatchGenerateRequest(BaseModel):
    files: list[FilePayload]
    target_url: Optional[str] = None


class PlaywrightAppGenerateRequest(BaseModel):
    workspace_id: str
    target_url: Optional[str] = None


class PlaywrightCommitGenerateRequest(BaseModel):
    workspace_id: str
    commit_sha: str
    target_url: Optional[str] = None


# ── Saved Test Suites ──────────────────────────────────────────────────────

class SaveTestSuiteRequest(BaseModel):
    workspace_id: str
    name: str
    scope: str          # "entire_app" | "commits" | "virtual_files" | "single_file"
    tests: list[dict]
    target_url: Optional[str] = None
    commit_sha: Optional[str] = None


class TestSuiteInfo(BaseModel):
    suite_id: str
    workspace_id: str
    name: str
    scope: str
    test_count: int
    target_url: Optional[str] = None
    commit_sha: Optional[str] = None
    created_at: str


# ── Chain Analysis ─────────────────────────────────────────────────────────

class ChainAnalyzeRequest(BaseModel):
    workspace_id: str
    chain: list[str]          # ordered file paths root → leaf
    changed_files: list[str]  # files that were directly modified


class FileChainAnalysis(BaseModel):
    file_path: str
    summary: str              # what this file does
    changes_description: str  # what changed / why it matters
    suggested_count: int      # AI-suggested number of test cases (0 when not analysed)
    analysed: bool = True     # False: the AI answer did not cover this file
    reason: str               # short justification


class ChainAnalyzeResponse(BaseModel):
    analyses: list[FileChainAnalysis]
