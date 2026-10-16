"""
Pydantic models for repository-based AI test generation and live Playwright execution.
"""
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel


class CommitInfo(BaseModel):
    sha: str
    short_sha: str
    message: str
    author: str
    relative_date: str
    date: str = ""


class RepoAnalysisRequest(BaseModel):
    github_url: str
    target_url: str
    test_email: Optional[str] = None
    test_password: Optional[str] = None
    test_preferences: Optional[str] = None
    num_tests: int = 1              # how many test cases to generate (default 1)
    # ── Commit-targeted mode ──────────────────────────────────────
    mode: str = "full"              # "full" | "commit"
    commit_sha: Optional[str] = None    # selected commit SHA (commit mode only)
    commit_message: Optional[str] = None
    # Skip TLS certificate verification on the target-URL pre-flight (self-signed
    # staging hosts). Off by default; logged when used.
    allow_insecure_tls: bool = False


class ExecuteRequest(BaseModel):
    """Optional body of POST /repo/analyses/{id}/execute: the test account that fills
    the {{TEST_EMAIL}} / {{TEST_PASSWORD}} placeholders at run time (never stored)."""
    test_email: Optional[str] = None
    test_password: Optional[str] = None
    allow_insecure_tls: bool = False


class PageInfo(BaseModel):
    name: str
    path: str
    description: str
    key_elements: List[str] = []


class UserFlow(BaseModel):
    name: str
    steps: List[str]


class TestStep(BaseModel):
    action: str  # navigate | click | fill | assert_text | screenshot | wait | hover
    selector: Optional[str] = None
    value: Optional[str] = None
    description: str


class PlaywrightTestIn(BaseModel):
    """Shape returned by AI for a single generated test."""
    name: str
    description: str
    page_name: str
    severity: str = "Medium"
    steps: List[TestStep] = []


class StepResult(BaseModel):
    step_description: str
    screenshot: Optional[str] = None  # base64-encoded PNG
    status: str  # pass | fail
    error: Optional[str] = None


class LiveTestResult(BaseModel):
    test_id: str
    test_name: str
    status: str  # pending | running | passed | failed
    steps_completed: int = 0
    total_steps: int = 0
    step_results: List[StepResult] = []
    error: Optional[str] = None
    duration_ms: Optional[int] = None


class AnalyzeRepoResponse(BaseModel):
    analysis_id: str
    summary: str
    tech_stack: str
    pages: List[PageInfo]
    user_flows: List[UserFlow]
    tests: List[dict]  # raw test dicts with id injected


class ExecuteResponse(BaseModel):
    run_id: str
    total: int
    status: str
