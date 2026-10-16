"""
Repo analysis routes.

POST /repo/analyze                       start async analysis job (returns job_id immediately)
GET  /repo/jobs/{job_id}                 poll analysis job status + step logs
GET  /repo/analyses/{id}                 fetch a saved analysis
GET  /repo/analyses/{id}/tests           list generated tests for an analysis
POST /repo/analyses/{id}/execute         run tests live with Playwright
GET  /repo/execution/{run_id}            poll live execution results (with screenshots)
POST /repo/execute-direct                run tests directly (no analysis needed)
POST /repo/upload-spec                   parse a .spec.ts file into test cases
"""
import asyncio
import re
import uuid
import httpx
import logging

from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, Form, HTTPException, UploadFile

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.models.repo_analysis import ExecuteRequest, RepoAnalysisRequest
from app.services import playwright_service, repo_service
from app.services.analysis_runner import create_job, get_job, run_analysis, run_commit_analysis
from app.services.execution_service import InvalidTargetError, validate_target_url

log = logging.getLogger("repo_analysis")

_ALLOWED_TEST_FIELDS = {"name", "description", "severity", "steps", "page_name"}

_UNREACHABLE_MESSAGE = "The target URL could not be reached"


async def _require_fetchable_target(url: str) -> None:
    """Refuse targets this server must not fetch (private, loopback or link-local in production).

    validate_target_url resolves the host, which blocks, so it runs in a worker thread.
    """
    try:
        await asyncio.to_thread(validate_target_url, url)
    except InvalidTargetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def _check_url_reachable(url: str, allow_insecure_tls: bool = False) -> str | None:
    """
    Try a GET request to url. Returns None if reachable, or a generic message if not.
    Times out after 8 seconds so we don't stall the request. The exception detail
    goes to the server log only.

    TLS certificates are verified unless the request explicitly set
    allow_insecure_tls (self-signed staging hosts), which is logged.
    """
    if allow_insecure_tls:
        log.warning("Pre-flight check %s with TLS verification disabled (allow_insecure_tls)", url)
    try:
        async with httpx.AsyncClient(verify=not allow_insecure_tls, follow_redirects=True) as client:
            resp = await client.get(url, timeout=8.0)
        log.info("Pre-flight check %s → HTTP %d", url, resp.status_code)
        return None  # reachable (even 4xx counts the server is up)
    except Exception as exc:
        log.warning("Pre-flight check for %s failed: %s: %s", url, type(exc).__name__, exc)
        return _UNREACHABLE_MESSAGE

router = APIRouter(prefix="/repo", tags=["Repo Analysis"])


# ── Start analysis job (returns immediately) ──────────────────────────────────

# ── Fetch recent commits (for commit-picker UI) ───────────────────────────────

@router.post("/default-branch")
async def fetch_default_branch(
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
):
    """Return the GitHub default branch (HEAD) without cloning the full repo."""
    github_url = (body.get("github_url") or "").strip()
    if not github_url:
        raise HTTPException(status_code=400, detail="github_url is required")
    try:
        branch = await asyncio.to_thread(repo_service.detect_default_branch, github_url)
        return {"branch": branch}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/commits")
async def fetch_commits(
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
):
    """
    Clone the repo (depth=12) and return the last 10 commits.
    Used by the frontend commit-picker before starting an analysis.
    """
    github_url = body.get("github_url", "").strip()
    pat = (body.get("pat") or "").strip() or None
    if not github_url:
        raise HTTPException(status_code=400, detail="github_url is required")
    try:
        commits = await asyncio.to_thread(repo_service.get_repo_commits, github_url, 10, pat)
        return {"commits": commits}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Start analysis job (returns immediately) ──────────────────────────────────

@router.post("/analyze", status_code=202)
async def start_analyze(
    body: RepoAnalysisRequest,
    background_tasks: BackgroundTasks,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Returns a job_id immediately.
    mode="full"   → full codebase analysis (default).
    mode="commit" → diff-based analysis for a specific commit (commit_sha required).
    Poll GET /repo/jobs/{job_id} for progress + result.
    """
    await _require_fetchable_target(body.target_url)
    reach_err = await _check_url_reachable(body.target_url, body.allow_insecure_tls)
    if reach_err:
        log.warning(
            "Target URL pre-flight warning: %s %s (continuing anyway)",
            body.target_url, reach_err,
        )

    if body.mode == "commit" and not body.commit_sha:
        raise HTTPException(status_code=400, detail="commit_sha is required for mode='commit'")

    job_id = await create_job(
        db,
        org.id,
        body.github_url,
        body.target_url,
        body.test_email,
        body.test_password,
        body.test_preferences,
        num_tests=body.num_tests,
        mode=body.mode,
        commit_sha=body.commit_sha,
        commit_message=body.commit_message,
    )

    if body.mode == "commit":
        background_tasks.add_task(run_commit_analysis, db, job_id)
    else:
        background_tasks.add_task(run_analysis, db, job_id)

    return {"job_id": job_id, "status": "pending", "mode": body.mode}


# ── Poll job status + logs ────────────────────────────────────────────────────

@router.get("/jobs/{job_id}")
async def get_job_status(
    job_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Returns the current job status, step, log lines, and (when completed) the full result.

    status: pending | running | completed | failed
    step:   pending | cloning | extracting | analyzing | generating | completed | failed
    logs:   list of human-readable progress lines
    result: populated only when status == 'completed'
    error:  the reason, when status == 'failed' (an AI failure fails the job; a job
            cut off by a server restart is reported as failed, not left running)
    """
    job = await get_job(db, job_id, org.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ── Fetch a saved analysis ────────────────────────────────────────────────────

@router.get("/analyses/{analysis_id}")
async def get_analysis(
    analysis_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    doc = await db.repo_analyses.find_one({"_id": analysis_id, "org_id": org.id})
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis not found")
    doc["id"] = doc.pop("_id")
    return doc


# ── List tests for an analysis ────────────────────────────────────────────────

@router.get("/analyses/{analysis_id}/tests")
async def get_tests(
    analysis_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    cursor = db.playwright_tests.find({"analysis_id": analysis_id, "org_id": org.id})
    docs = await cursor.to_list(length=100)
    for d in docs:
        d["id"] = d.pop("_id")
    return docs


# ── Execute tests live ────────────────────────────────────────────────────────

@router.post("/analyses/{analysis_id}/execute", status_code=202)
async def execute_tests(
    analysis_id: str,
    background_tasks: BackgroundTasks,
    body: ExecuteRequest | None = None,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Starts a Playwright execution run in the background.
    Returns run_id poll GET /repo/execution/{run_id} for live results.

    The optional body carries the test account (test_email / test_password) that
    fills the {{TEST_EMAIL}} / {{TEST_PASSWORD}} placeholders in the stored steps
    at run time. The password is never stored; the email defaults to the one the
    analysis was generated with.
    """
    body = body or ExecuteRequest()
    analysis = await db.repo_analyses.find_one({"_id": analysis_id, "org_id": org.id})
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    # ── Pre-flight: verify the target URL is actually reachable ───────────────
    target_url: str = analysis["target_url"]
    await _require_fetchable_target(target_url)
    reach_err = await _check_url_reachable(target_url, body.allow_insecure_tls)
    if reach_err:
        log.error("Pre-flight failed for %s: %s", target_url, reach_err)
        raise HTTPException(
            status_code=400,
            detail=(
                f"{reach_err}. "
                f"Make sure your app is running at {target_url} and is accessible "
                f"from this server before running tests."
            ),
        )

    cursor = db.playwright_tests.find({"analysis_id": analysis_id, "org_id": org.id})
    tests = await cursor.to_list(length=100)

    if not tests:
        raise HTTPException(
            status_code=400,
            detail="No tests found for this analysis. Run /analyze first."
        )

    import uuid
    run_id = str(uuid.uuid4())
    background_tasks.add_task(
        playwright_service.execute_playwright_tests,
        db,
        org.id,
        tests,
        analysis["target_url"],
        run_id,
        analysis_id,
        test_email=body.test_email or analysis.get("test_email"),
        test_password=body.test_password,
    )

    return {"run_id": run_id, "total": len(tests), "status": "started"}


# ── Update a playwright test case ─────────────────────────────────────────────

@router.put("/tests/{test_id}")
async def update_test(
    test_id: str,
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    doc = await db.playwright_tests.find_one({"_id": test_id, "org_id": org.id})
    if not doc:
        raise HTTPException(status_code=404, detail="Test not found")
    updates = {k: v for k, v in body.items() if k in _ALLOWED_TEST_FIELDS}
    if not updates:
        raise HTTPException(status_code=400, detail="No updatable fields provided")
    await db.playwright_tests.update_one({"_id": test_id, "org_id": org.id}, {"$set": updates})
    updated = await db.playwright_tests.find_one({"_id": test_id, "org_id": org.id})
    updated["id"] = updated.pop("_id")
    return updated


# ── Poll execution results ────────────────────────────────────────────────────

@router.get("/execution/{run_id}")
async def get_execution_status(
    run_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Returns live execution status and per-step screenshots.
    Poll at ~1 s intervals while status == 'running'.
    Falls back to MongoDB for runs from previous sessions.
    """
    run = await playwright_service.load_run(db, org.id, run_id, with_screenshots=True)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


# ── Run history ───────────────────────────────────────────────────────────────

@router.get("/runs")
async def list_runs(
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Return the 20 most recent test runs (summary rows, no screenshots)."""
    runs = await playwright_service.list_runs_from_db(db, org.id, limit=20)
    return {"runs": runs}


@router.get("/runs/{run_id}")
async def get_run_detail(
    run_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Full run detail including step results, without screenshots."""
    run = await playwright_service.load_run(db, org.id, run_id, with_screenshots=False)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


# ── Direct execution (skip analysis use provided tests) ─────────────────────

@router.post("/execute-direct", status_code=202)
async def execute_tests_direct(
    body: dict = Body(...),
    background_tasks: BackgroundTasks = None,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Run a list of test cases directly against a target URL without going through
    the analysis pipeline. Useful when tests are already committed or uploaded.
    """
    tests = body.get("tests", [])
    target_url = body.get("target_url", "").strip()
    allow_insecure_tls = body.get("allow_insecure_tls") is True

    if not tests:
        raise HTTPException(status_code=400, detail="tests list is required")
    if not target_url:
        raise HTTPException(status_code=400, detail="target_url is required")

    try:
        import playwright  # noqa: F401
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Playwright is not installed on this server. Run: pip install playwright && playwright install chromium",
        )

    await _require_fetchable_target(target_url)
    reach_err = await _check_url_reachable(target_url, allow_insecure_tls)
    if reach_err:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{reach_err}. "
                f"Make sure your app is running at {target_url} and is accessible from this server."
            ),
        )

    run_id = str(uuid.uuid4())
    analysis_id = f"direct-{run_id}"

    prepared: list[dict] = []
    for t in tests:
        doc = dict(t)
        doc.setdefault("id", str(uuid.uuid4()))
        doc["analysis_id"] = analysis_id
        prepared.append(doc)

    for doc in prepared:
        persist = {
            "_id": doc["id"],
            "org_id": org.id,
            "analysis_id": analysis_id,
            "name": doc.get("name") or "Test",
            "description": doc.get("description") or "",
            "page_name": doc.get("page_name") or "",
            "severity": doc.get("severity") or "Medium",
            "steps": doc.get("steps") or [],
        }
        await db.playwright_tests.replace_one({"_id": persist["_id"], "org_id": org.id}, persist, upsert=True)

    background_tasks.add_task(
        playwright_service.execute_playwright_tests,
        db,
        org.id,
        prepared,
        target_url,
        run_id,
        analysis_id,
        test_email=(body.get("test_email") or None),
        test_password=(body.get("test_password") or None),
    )

    return {"run_id": run_id, "total": len(prepared), "status": "started"}


# ── Spec file upload + parse ──────────────────────────────────────────────────

def _parse_block_to_steps(block: str) -> list[dict]:
    """Convert a Playwright test body into our internal step format."""
    steps: list[dict] = []

    for line in block.splitlines():
        line = line.strip()
        if not line or line in ("{", "}"):
            continue

        # page.goto
        m = re.search(r"await page\.goto\s*\(\s*['\"]([^'\"]+)['\"]", line)
        if m:
            steps.append({"action": "navigate", "selector": None, "value": m.group(1),
                          "description": f"Navigate to {m.group(1)}"})
            continue

        # page.fill
        m = re.search(r"await page\.fill\s*\(\s*['\"]([^'\"]+)['\"],\s*['\"]([^'\"]*)['\"]", line)
        if m:
            steps.append({"action": "fill", "selector": m.group(1), "value": m.group(2),
                          "description": f"Fill '{m.group(1)}' with '{m.group(2)}'"})
            continue

        # page.type
        m = re.search(r"await page\.type\s*\(\s*['\"]([^'\"]+)['\"],\s*['\"]([^'\"]*)['\"]", line)
        if m:
            steps.append({"action": "type_into", "selector": m.group(1), "value": m.group(2),
                          "description": f"Type into '{m.group(1)}'"})
            continue

        # page.selectOption
        m = re.search(r"await page\.selectOption\s*\(\s*['\"]([^'\"]+)['\"],\s*['\"]([^'\"]*)['\"]", line)
        if m:
            steps.append({"action": "select_option", "selector": m.group(1), "value": m.group(2),
                          "description": f"Select '{m.group(2)}' in '{m.group(1)}'"})
            continue

        # page.click
        m = re.search(r"await page\.click\s*\(\s*['\"]([^'\"]+)['\"]", line)
        if m:
            steps.append({"action": "click", "selector": m.group(1), "value": None,
                          "description": f"Click '{m.group(1)}'"})
            continue

        # expect(...).toContainText
        m = re.search(r"\.toContainText\s*\(\s*['\"]([^'\"]+)['\"]", line)
        if m:
            steps.append({"action": "assert_text", "selector": "body", "value": m.group(1),
                          "description": f"Assert page contains '{m.group(1)}'"})
            continue

        # page.waitForTimeout
        m = re.search(r"waitForTimeout\s*\(\s*(\d+)\s*\)", line)
        if m:
            ms = int(m.group(1))
            steps.append({"action": "wait", "selector": None, "value": str(max(1, ms // 1000)),
                          "description": f"Wait {ms} ms"})
            continue

        # page.screenshot
        if re.search(r"await page\.screenshot\s*\(", line):
            steps.append({"action": "screenshot", "selector": None, "value": None,
                          "description": "Take screenshot"})
            continue

    return steps


def _parse_spec_to_tests(spec_content: str, filename: str) -> list[dict]:
    """Parse a .spec.ts file and return a list of internal test-case dicts."""
    tests: list[dict] = []
    test_decl_re = re.compile(r"test\s*\(\s*['\"]([^'\"]+)['\"]")

    for match in test_decl_re.finditer(spec_content):
        name = match.group(1)
        brace_start = spec_content.find("{", match.end())
        if brace_start == -1:
            continue

        depth = 0
        brace_end = brace_start
        for i in range(brace_start, len(spec_content)):
            if spec_content[i] == "{":
                depth += 1
            elif spec_content[i] == "}":
                depth -= 1
                if depth == 0:
                    brace_end = i
                    break

        block = spec_content[brace_start : brace_end + 1]
        steps = _parse_block_to_steps(block)

        # Use first comment in block as description
        comment_m = re.search(r"//\s*(.+)", block)
        description = comment_m.group(1).strip() if comment_m else f"Test: {name}"

        tests.append({
            "id": str(uuid.uuid4()),
            "analysis_id": "uploaded",
            "name": name,
            "description": description,
            "page_name": filename,
            "severity": "Medium",
            "steps": steps,
        })

    return tests


@router.post("/upload-spec")
async def upload_spec(file: UploadFile = File(...), org: OrganizationOut = Depends(get_current_org)):
    """
    Parse a Playwright .spec.ts file and return structured test cases.
    The returned tests can be passed to POST /repo/execute-direct to run them.
    """
    if not file.filename or not file.filename.endswith((".ts", ".js", ".spec.ts", ".spec.js")):
        raise HTTPException(status_code=400, detail="Please upload a .spec.ts or .spec.js file")

    raw = await file.read()
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be valid UTF-8 text")

    tests = _parse_spec_to_tests(content, file.filename)
    if not tests:
        raise HTTPException(
            status_code=400,
            detail="No test() blocks found in the uploaded file. Make sure it contains Playwright test cases."
        )

    return {"filename": file.filename, "test_count": len(tests), "tests": tests}
