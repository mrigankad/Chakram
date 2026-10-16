"""
Ollama client wrapper (OpenAI-compatible API).
All prompts live here so every other service just calls helpers.
"""
import asyncio
import inspect
import json
import re
import time
import uuid
import weakref
from contextvars import ContextVar, Token
from datetime import datetime, timezone
from typing import Callable, Any

from openai import APIConnectionError, APIError, APITimeoutError, OpenAI, RateLimitError

from app.config import settings
from app.services import connector_settings_service as connectors

# ── Org attribution for cost logging ────────────────────────────────────────
# Set by app.auth.dependencies.get_current_org for the duration of a request,
# and explicitly by background-task entrypoints (analysis_runner, playwright_
# service, baseline_runner) that carry org_id but run detached from request
# scope. Read by _log_cost() so api_cost_logs documents can be attributed to
# an org without threading org_id through every one of the ~20 ai_service
# call sites individually.
_current_org_id: ContextVar[str | None] = ContextVar("_current_org_id", default=None)


def set_current_org_id(org_id: str | None) -> Token:
    """Set the org_id attributed to AI calls made in the current context. Returns a reset token."""
    return _current_org_id.set(org_id)


def reset_current_org_id(token: Token) -> None:
    _current_org_id.reset(token)


def _ollama_cfg() -> tuple[str, str, str]:
    cfg = connectors.active("ollama")
    base = (cfg.get("base_url") or settings.OLLAMA_BASE_URL or "http://localhost:11434").rstrip("/")
    key = cfg.get("api_key") or settings.OLLAMA_API_KEY or "ollama"
    model = cfg.get("model") or settings.OLLAMA_MODEL or "llama3.1"
    return base, key, model


def _get_client() -> OpenAI:
    base, key, _ = _ollama_cfg()
    # max_retries=0: _call_openai_sync owns the only retry loop.
    return OpenAI(
        base_url=f"{base}/v1",
        api_key=key,
        timeout=settings.LLM_TIMEOUT_SECONDS,
        max_retries=0,
    )


_client = OpenAI(
    base_url=f"{settings.OLLAMA_BASE_URL.rstrip('/')}/v1",
    api_key=settings.OLLAMA_API_KEY or "ollama",
    timeout=settings.LLM_TIMEOUT_SECONDS,
    max_retries=0,
)
_MODEL = settings.OLLAMA_MODEL

# Ollama has no per-token billing; costs are recorded as zero but token
# counts are still logged for usage visibility.
_COST_INPUT_PER_TOKEN = 0.0
_COST_OUTPUT_PER_TOKEN = 0.0

_TASK_LABELS: dict[str, str] = {
    "generate_test_cases": "Generate Test Cases",
    "generate_requirement_based_data": "Generate Test Data (Requirement)",
    "generate_column_based_data": "Generate Test Data (Columns)",
    "analyze_codebase": "Analyze Codebase",
    "generate_playwright_tests": "Generate Playwright Tests",
    "analyze_commit_and_generate_tests": "Analyze Commit & Generate Tests",
    "review_pull_request": "Review Pull Request",
    "explain_ci_failure": "Explain CI Failure",
    "generate_defect_risk_narrative": "Generate Defect Risk Narrative",
    "analyze_release_readiness": "Analyze Release Readiness",
    "investigate_incident": "Investigate Incident",
    "generate_incident_postmortem": "Generate Incident Post-mortem",
    "generate_acceptance_criteria": "Generate Acceptance Criteria",
    "generate_predictive_alert": "Generate Predictive Alert",
    "generate_playwright_tests_from_source": "Generate Playwright Tests (Source)",
    "call_ai": "AI Copilot / Workspace",
    "generate_baseline_tests": "Baseline Full Scan",
    "generate_incremental_tests": "Baseline Incremental Scan",
}

# --- rate-limit handling ---------------------------------------------------

class AIQuotaError(Exception):
    """Raised when the AI backend returns 429 after all retries are exhausted."""


class AIResponseError(Exception):
    """Raised when the model's answer is empty or not in the required structure."""


# Failures of the provider call or of its output, as opposed to failures of this app.
AI_PROVIDER_ERRORS = (AIResponseError, APIError)

# Sleep before each retry; the length is the maximum number of retries.
_RETRY_DELAYS = (1.0, 3.0)

_QUOTA_TEXT_RE = re.compile(
    r"too many requests|rate.?limit|quota (?:exceeded|exhausted)|exceeded your (?:current )?quota"
    r"|(?:status|error)(?: code)?:? 429\b|\b429 too many",
    re.IGNORECASE,
)


def _is_quota_error(exc: Exception) -> bool:
    if isinstance(exc, (AIQuotaError, RateLimitError)):
        return True
    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        return status == 429
    return bool(_QUOTA_TEXT_RE.search(str(exc)))


def _is_transient_connection_error(exc: Exception) -> bool:
    # A timeout is not retried: the call already used its whole time budget.
    return isinstance(exc, APIConnectionError) and not isinstance(exc, APITimeoutError)


def _call_openai_sync(
    prompt: str,
    json_mode: bool = True,
    timeout: float | None = None,
    system: str | None = None,
) -> tuple[str, int, int]:
    """Synchronous Ollama chat completion. Returns (content, prompt_tokens, completion_tokens).

    `system`, when given, is sent as the system message. Callers put the static
    part of a prompt there (role, reference material, rules) and the varying
    part in `prompt`, so a provider that caches prompt prefixes can reuse it.
    """
    _, _, model = _ollama_cfg()
    client = _get_client()
    messages: list[dict] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    kwargs: dict = {
        "model": model,
        "messages": messages,
        "timeout": timeout or settings.LLM_TIMEOUT_SECONDS,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
        # Thinking models (kimi-k3, gpt-oss) otherwise spend the whole timeout
        # in reasoning and return empty/truncated JSON.
        kwargs["extra_body"] = {"reasoning_effort": "low"}
    attempt = 0
    while True:
        try:
            response = client.chat.completions.create(**kwargs)
        except Exception as exc:
            quota = _is_quota_error(exc)
            if (quota or _is_transient_connection_error(exc)) and attempt < len(_RETRY_DELAYS):
                time.sleep(_RETRY_DELAYS[attempt])
                attempt += 1
                continue
            if quota:
                raise AIQuotaError(
                    "AI backend quota exceeded or rate limited. "
                    "Please wait a moment and try again. "
                    f"Details: {exc}"
                ) from exc
            raise
        content = _message_text(response.choices[0].message)
        usage = response.usage
        prompt_tokens = usage.prompt_tokens if usage else 0
        completion_tokens = usage.completion_tokens if usage else 0
        return content, prompt_tokens, completion_tokens


# One semaphore per event loop: an asyncio.Semaphore cannot be shared across loops.
_llm_semaphores: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = (
    weakref.WeakKeyDictionary()
)


def _llm_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    semaphore = _llm_semaphores.get(loop)
    if semaphore is None:
        semaphore = asyncio.Semaphore(max(1, settings.LLM_MAX_CONCURRENCY))
        _llm_semaphores[loop] = semaphore
    return semaphore


async def _run_llm(
    prompt: str,
    json_mode: bool = True,
    timeout: float | None = None,
    system: str | None = None,
) -> tuple[str, int, int]:
    """Run one LLM call in a worker thread, at most LLM_MAX_CONCURRENCY at a time."""
    async with _llm_semaphore():
        return await asyncio.to_thread(_call_openai_sync, prompt, json_mode, timeout, system)


async def _log_cost(
    task_name: str, prompt_tokens: int, completion_tokens: int, extra: dict | None = None
) -> None:
    """Persist a cost record to MongoDB. Never raises cost logging must not break AI calls.

    `extra` holds attribution the caller knows and this module does not
    (workspace_id, run_id, path for App Studio builds); only plain string/number
    values are stored.
    """
    try:
        input_cost = round(prompt_tokens * _COST_INPUT_PER_TOKEN, 6)
        output_cost = round(completion_tokens * _COST_OUTPUT_PER_TOKEN, 6)
        total_cost = round(input_cost + output_cost, 6)
        from app.database import get_db
        _, _, model = _ollama_cfg()
        db = get_db()
        doc = {
            "org_id": _current_org_id.get(),
            "task_name": task_name,
            "model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "input_cost_usd": input_cost,
            "output_cost_usd": output_cost,
            "total_cost_usd": total_cost,
            "created_at": datetime.now(timezone.utc),
        }
        for key, value in (extra or {}).items():
            if isinstance(key, str) and key not in doc and isinstance(value, (str, int, float, bool)):
                doc[key] = value
        await db["api_cost_logs"].insert_one(doc)
    except Exception:
        pass  # Never break the main AI call due to cost logging failure


async def _call_openai(
    prompt: str,
    json_mode: bool = True,
    task_name: str | None = None,
    timeout: float | None = None,
    system: str | None = None,
    log_extra: dict | None = None,
    usage_sink: Callable[[int, int], None] | None = None,
) -> str:
    """Async wrapper runs the sync call in a thread so the event loop isn't blocked.

    `usage_sink(prompt_tokens, completion_tokens)` lets a caller total a
    multi-call job; `log_extra` is stored on the usage log row.
    """
    if task_name is None:
        frame = inspect.currentframe()
        caller = frame.f_back.f_code.co_name if (frame and frame.f_back) else "unknown"
        task_name = _TASK_LABELS.get(caller, caller.replace("_", " ").title())

    content, prompt_tokens, completion_tokens = await _run_llm(prompt, json_mode, timeout, system)
    if usage_sink is not None:
        try:
            usage_sink(prompt_tokens, completion_tokens)
        except Exception:  # noqa: BLE001 - totals never break the call
            logger.exception("usage sink failed for %s", task_name)
    asyncio.create_task(_log_cost(task_name, prompt_tokens, completion_tokens, extra=log_extra))
    return content


# Public alias used by impact_service and other services that prefer a shorter name
async def call_ai(prompt: str, max_tokens: int = 2000, task_name: str | None = None) -> str:
    """Public async helper: sends a prompt and returns the raw text response."""
    return await _call_openai(prompt, json_mode=False, task_name=task_name or _TASK_LABELS["call_ai"])

# --------------------------------------------------------------------------


def _message_text(msg: Any) -> str:
    """The model's answer. Reasoning/thinking text is never returned as the answer."""
    content = getattr(msg, "content", None)
    if isinstance(content, str) and content.strip():
        return content
    raise AIResponseError(
        "The AI model returned an empty answer (it may have spent its output on reasoning). "
        "Please try again."
    )


def _is_json(text: str) -> bool:
    try:
        json.loads(text)
        return True
    except ValueError:
        return False


def _first_json_value(text: str) -> str | None:
    """The first balanced top-level JSON object or array in `text` that parses."""
    pos = 0
    while True:
        starts = [i for i in (text.find("{", pos), text.find("[", pos)) if i != -1]
        if not starts:
            return None
        start = min(starts)
        depth = 0
        in_string = False
        escaped = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
            elif ch == '"':
                in_string = True
            elif ch in "{[":
                depth += 1
            elif ch in "}]":
                depth -= 1
                if depth == 0:
                    candidate = text[start:i + 1]
                    if _is_json(candidate):
                        return candidate
                    break
        pos = start + 1


def _clean_json(raw: str) -> str:
    """Strip markdown fences and extract the JSON value if the model added prose."""
    raw = (raw or "").strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw)
    raw = raw.strip()
    if _is_json(raw):
        return raw
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, flags=re.IGNORECASE)
    if fenced:
        inner = fenced.group(1).strip()
        if _is_json(inner):
            return inner
    return _first_json_value(raw) or raw


def _parse_json(raw: str) -> Any:
    """Parse the model's JSON answer; AIResponseError when it is not JSON."""
    try:
        return json.loads(_clean_json(raw))
    except (TypeError, ValueError) as exc:
        raise AIResponseError(f"The AI model did not return valid JSON: {exc}") from exc


def _parse_json_object(raw: str) -> dict[str, Any]:
    """_parse_json for answers that must be a JSON object."""
    data = _parse_json(raw)
    if not isinstance(data, dict):
        raise AIResponseError("The AI model did not return a JSON object.")
    return data


async def _call_openai_json(
    prompt: str,
    timeout: float | None = None,
    task_name: str | None = None,
) -> Any:
    """JSON-mode call with a non-JSON retry if the model wraps or truncates output."""
    if task_name is None:
        frame = inspect.currentframe()
        caller = frame.f_back.f_code.co_name if (frame and frame.f_back) else "unknown"
        task_name = _TASK_LABELS.get(caller, caller.replace("_", " ").title())
    raw = await _call_openai(prompt, json_mode=True, timeout=timeout, task_name=task_name)
    try:
        return json.loads(_clean_json(raw))
    except (json.JSONDecodeError, TypeError, ValueError):
        raw = await _call_openai(prompt, json_mode=False, timeout=timeout, task_name=task_name)
        return _parse_json(raw)


TEST_CASE_CATEGORIES = ("functional", "edge", "api", "failure", "regression")
_TEST_CASE_SEVERITIES = {"critical": "Critical", "high": "High", "medium": "Medium", "low": "Low"}


def _validate_test_cases(data: Any) -> dict[str, list[dict[str, str]]]:
    """Keep the well-formed generated cases; raise AIResponseError if none remain.

    A case needs a name. The other fields the app stores (tc_id, description,
    severity, expected) are coerced to strings, and severity to one of the four
    known values. Unknown categories and non-object entries are dropped.
    """
    if not isinstance(data, dict):
        raise AIResponseError("The AI model did not return a test-case object.")
    cleaned: dict[str, list[dict[str, str]]] = {category: [] for category in TEST_CASE_CATEGORIES}
    for category in TEST_CASE_CATEGORIES:
        entries = data.get(category)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            name = entry.get("name")
            if not isinstance(name, str) or not name.strip():
                continue
            severity = _TEST_CASE_SEVERITIES.get(str(entry.get("severity") or "").strip().lower(), "Medium")
            cleaned[category].append({
                "tc_id": str(entry.get("tc_id") or "").strip(),
                "name": name.strip(),
                "description": str(entry.get("description") or ""),
                "severity": severity,
                "expected": str(entry.get("expected") or ""),
            })
    if not any(cleaned.values()):
        raise AIResponseError("The AI model returned no usable test cases. Please try again.")
    return cleaned


async def generate_test_cases(requirement: str, instructions: str = None) -> dict[str, list[dict[str, str]]]:
    """
    Returns a dict with keys: functional, edge, api, failure, regression.
    Each value is a list of test-case objects.
    """
    prompt = f"""
You are a senior QA engineer. Given the software requirement below, generate comprehensive test cases.
{f"USER INSTRUCTIONS: {instructions}" if instructions else ""}

REQUIREMENT:
{requirement}

Return ONLY valid JSON (no markdown) with this exact shape:
{{
  "functional": [
    {{"tc_id": "TC-001", "name": "...", "description": "...", "severity": "Critical|High|Medium|Low", "expected": "..."}}
  ],
  "edge": [ ... ],
  "api":  [ ... ],
  "failure": [ ... ],
  "regression": [ ... ]
}}

Rules:
- functional: 4-6 tests, core happy-path scenarios
- edge: 3-4 tests, boundary / unusual inputs
- api: 3-4 tests, HTTP-level validations
- failure: 2-3 tests, error and degraded-mode scenarios
- regression: 2-3 tests, backward-compat / migration
- severity must be exactly one of: Critical, High, Medium, Low
- tc_id must be unique across all categories, starting TC-001
"""
    return _validate_test_cases(await _call_openai_json(prompt))


async def generate_requirement_based_data(
    requirement_text: str,
    count: int,
) -> dict[str, Any]:
    """
    Given a software requirement, ask the model to:
      1. Decide the most relevant test-data schema (field names, types, descriptions).
      2. Generate `count` realistic rows for that schema.

    Returns:
    {
      "schema": [{"name": str, "type": str, "description": str}, ...],
      "rows":   [{field: value, ...}, ...]
    }
    """
    prompt = f"""You are a test-data engineer.

A software team is testing the following requirement:

REQUIREMENT:
{requirement_text}

Your job has two parts:

PART 1 SCHEMA DESIGN
Decide what data fields are needed to properly test this requirement.
Do NOT use generic or vehicle-specific fields unless the requirement is about vehicles.
Infer meaningful, domain-specific fields directly from the requirement text.
Give 5-10 fields. Each field must have:
  - name: snake_case column identifier
  - type: one of "string", "integer", "float", "boolean", "datetime"
  - description: one sentence describing what realistic values look like

PART 2 DATA GENERATION
Generate {count} realistic, varied test data rows using exactly the schema you designed above.
Each row must cover different realistic scenarios implied by the requirement
(normal cases, boundary cases, edge cases, failure-prone values).

Return ONLY valid JSON (no markdown, no explanation) in this exact shape:
{{
  "schema": [
    {{"name": "...", "type": "...", "description": "..."}}
  ],
  "rows": [
    {{"field_name": value, ...}},
    ...
  ]
}}

Rules:
- Every row must have every field from the schema.
- Vary values across the {count} rows do not repeat the same values.
- Values must be realistic and directly relevant to the requirement.
- Boolean fields use true/false (JSON), not strings.
- datetime fields use ISO 8601 format strings.
- Numbers must be JSON numbers, not strings.
"""
    raw = await _call_openai(prompt)
    return _parse_json_object(raw)


async def generate_column_based_data(
    columns: list[str],
    count: int = 20,
    requirement: str | None = None,
) -> list[dict[str, Any]]:
    """
    Given a list of column names (and optional requirement context),
    ask the model to generate `count` realistic data rows for those columns.
    Returns a list of dicts keyed by the column names.
    """
    req_hint = f'\nRequirement context: "{requirement}"' if requirement else ""
    prompt = f"""You are a test data generator.{req_hint}

Generate {count} realistic test data rows for a dataset with these columns:
{columns}

Return ONLY a valid JSON object with a single key "rows" containing a JSON array.
Each element must be an object with exactly these keys: {columns}
Infer sensible data types and realistic value ranges from the column names.
Vary the values realistically across rows."""

    raw = await _call_openai(prompt)
    parsed = _parse_json(raw)
    # Accept either a bare array or {"rows": [...]}
    rows: list[dict[str, Any]] = parsed if isinstance(parsed, list) else parsed.get("rows", parsed)
    return rows


async def analyze_codebase(codebase_content: str, target_url: str) -> dict[str, Any]:
    """
    Analyse an extracted codebase and return structured UI information:
    summary, tech_stack, pages (with key elements), and user flows.
    """
    prompt = f"""You are a senior QA engineer performing UI analysis on a web application codebase.

TARGET URL: {target_url}

CODEBASE (extracted source files):
{codebase_content[:70000]}

Carefully read the code and identify:
1. All distinct pages / views / routes in this application
2. The key interactive UI elements on each page (buttons, inputs, links, modals, forms)
3. The main user flows (sequences of actions a user would follow)
4. The technology stack being used

Return ONLY valid JSON (no markdown, no explanation) with exactly this shape:
{{
  "summary": "One-paragraph description of what this application does",
  "tech_stack": "e.g. React + TypeScript + Tailwind + React Router",
  "pages": [
    {{
      "name": "Human-readable page name",
      "path": "/route-path",
      "description": "What the user can do on this page",
      "key_elements": ["Login button", "Email input", "Password input", "Remember me checkbox"]
    }}
  ],
  "user_flows": [
    {{
      "name": "Flow name (e.g. User Registration)",
      "steps": ["Navigate to /register", "Fill name field", "Fill email field", "Submit form", "See confirmation"]
    }}
  ]
}}

Rules:
- Identify 3–8 pages. If the app has fewer pages, identify all of them.
- Identify 2–5 meaningful user flows.
- key_elements must name the actual UI text/labels visible in the code (e.g. "Sign In button" not "button").
- path must be the actual route path as defined in the router.
"""
    return await _call_openai_json(prompt)


async def generate_playwright_tests(
    analysis: dict[str, Any],
    target_url: str,
    test_email: str | None = None,
    test_password: str | None = None,
    test_preferences: str | None = None,
    num_tests: int = 1,
) -> list[dict[str, Any]]:
    """
    Given a structured codebase analysis, generate Playwright test cases with
    specific, executable steps (navigate, click, fill, assert_text, screenshot).
    The real test_email / test_password never enter the prompt: when they are
    available the model is told to write the {{TEST_EMAIL}} / {{TEST_PASSWORD}}
    placeholders, which playwright_service substitutes in the browser at run time.
    """
    from app.services.playwright_service import TEST_EMAIL_TOKEN, TEST_PASSWORD_TOKEN

    # Build credentials hint for the prompt
    cred_section = ""
    if test_email and test_password:
        cred_section = f"""
TEST CREDENTIALS: A real test account is available. Its values are substituted at run time, so in fill
steps for login forms use EXACTLY these placeholder strings as the value:
  Email/username field: {TEST_EMAIL_TOKEN}
  Password field:       {TEST_PASSWORD_TOKEN}

IMPORTANT: Do NOT invent email or password values such as "testuser@example.com" or "Password123!"
for login use the placeholders above, written literally.
"""
    elif test_email:
        cred_section = f"""
TEST CREDENTIALS: A test email is available and is substituted at run time: write EXACTLY the placeholder
string {TEST_EMAIL_TOKEN} as the value of email/username fill steps.
  Password: (not provided skip tests that require a password)
"""
    else:
        cred_section = """
TEST CREDENTIALS: Not provided.
Use placeholder values but add a comment in the description that real credentials are needed.
"""

    pref_string = f"USER TEST PREFERENCES:\n{test_preferences}\n" if test_preferences else ""
    compact = {
        "pages": (analysis.get("pages") or [])[:6],
        "user_flows": (analysis.get("user_flows") or [])[:6],
        "tech_stack": analysis.get("tech_stack"),
        "summary": (analysis.get("summary") or "")[:800],
    }

    prompt = f"""You are a Playwright engineer. Generate EXACTLY {num_tests} test(s) for this app.

TARGET URL: {target_url}
{cred_section}{pref_string}
ANALYSIS:
{json.dumps(compact, indent=2)}

Return ONLY JSON:
{{"tests":[{{"name":str,"description":str,"page_name":str,"severity":"Critical|High|Medium|Low","steps":[{{"action":str,"selector":str|null,"value":str|null,"description":str}}]}}]}}

Rules:
- Start each test with action "navigate" (value = full URL or path).
- Include a screenshot at start and end.
- Buttons: button:has-text("Label"). Inputs: input[type="email"] etc. Quote attribute values.
- Actions: navigate, click, fill, assert_text, screenshot, wait, hover, hover_and_click, press.
"""
    parsed = await _call_openai_json(prompt, timeout=70.0)
    tests: list[dict[str, Any]] = parsed.get("tests", []) if isinstance(parsed, dict) else []
    return tests


async def analyze_commit_and_generate_tests(
    commit_sha: str,
    commit_message: str,
    diff_text: str,
    file_contents: str,
    changed_files: list[str],
    target_url: str,
    test_email: str | None = None,
    test_password: str | None = None,
    num_tests: int = 1,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """
    Given the diff of a specific commit, first understand what user-facing
    functionality changed, then generate targeted Playwright tests for those changes.
    Returns (analysis_data, tests_list).

    The real test_email / test_password never enter the prompt: the model writes the
    {{TEST_EMAIL}} / {{TEST_PASSWORD}} placeholders, substituted at run time.
    """
    from app.services.playwright_service import TEST_EMAIL_TOKEN, TEST_PASSWORD_TOKEN

    cred_section = ""
    example_email, example_password = "user@example.com", "password"
    if test_email and test_password:
        example_email, example_password = TEST_EMAIL_TOKEN, TEST_PASSWORD_TOKEN
        cred_section = f"""
TEST CREDENTIALS: A real test account is available and is substituted at run time. In login fill steps
use EXACTLY these placeholder strings as the value, written literally:
  Email/username field: {TEST_EMAIL_TOKEN}
  Password field:       {TEST_PASSWORD_TOKEN}
"""
    elif test_email:
        example_email = TEST_EMAIL_TOKEN
        cred_section = f"""
TEST CREDENTIALS: A test email is available and is substituted at run time: write EXACTLY the placeholder
string {TEST_EMAIL_TOKEN} as the value of email/username fill steps.
  Password: (not provided skip tests that require a password)
"""
    else:
        cred_section = "TEST CREDENTIALS: Not provided. Use placeholder values."

    prompt = f"""You are a senior QA engineer and Playwright automation engineer.

A developer just committed: "{commit_message}" (SHA: {commit_sha[:8]})
CHANGED FILES: {', '.join(changed_files[:20])}

TARGET APP URL: {target_url}
{cred_section}

GIT DIFF (what changed):
{diff_text[:25000]}

CURRENT FILE CONTENTS (after the commit):
{file_contents[:25000]}

Your task has TWO parts:

PART 1 UNDERSTAND THE CHANGE
Analyze what user-facing functionality changed in this commit. Focus on:
- Which pages/views are affected
- What new features or bug fixes were introduced
- What user interactions are affected

PART 2 GENERATE TARGETED PLAYWRIGHT TESTS
Generate EXACTLY {num_tests} targeted Playwright test case(s) that specifically verify the changed functionality.
These are REGRESSION tests confirm the commit's changes work correctly.

Return ONLY valid JSON (no markdown, no explanation):
{{
  "analysis": {{
    "summary": "One paragraph: what this commit changes from a user's perspective",
    "tech_stack": "Technology stack of the app",
    "pages": [
      {{
        "name": "Page name",
        "path": "/route",
        "description": "What changed on this page",
        "key_elements": ["Element 1", "Element 2"]
      }}
    ],
    "user_flows": [
      {{
        "name": "Affected user flow name",
        "steps": ["Step 1", "Step 2", "Step 3"]
      }}
    ]
  }},
  "tests": [
    {{
      "name": "Descriptive test name targeting the changed functionality",
      "description": "What specific change this test validates",
      "page_name": "Page being tested",
      "severity": "Critical|High|Medium|Low",
      "steps": [
        {{"action": "navigate", "selector": null, "value": "/", "description": "Open the app"}},
        {{"action": "screenshot", "selector": null, "value": null, "description": "Capture initial state"}},
        {{"action": "fill", "selector": "input[type=\\"email\\"]", "value": "{example_email}", "description": "Enter email"}},
        {{"action": "fill", "selector": "input[type=\\"password\\"]", "value": "{example_password}", "description": "Enter password"}},
        {{"action": "click", "selector": "button:has-text(\\"Sign In\\")", "value": null, "description": "Sign in"}},
        {{"action": "wait", "selector": null, "value": "4", "description": "Wait for redirect"}},
        {{"action": "assert_text", "selector": null, "value": "Expected text after action", "description": "Verify the change works"}},
        {{"action": "screenshot", "selector": null, "value": null, "description": "Capture final state"}}
      ]
    }}
  ]
}}

STRICT RULES for tests (all apply from the standard test generation):
- ALWAYS start each test with "navigate".
- Include at least 2 "screenshot" steps per test.
- For login steps, use EXACTLY the credential placeholders provided (never invented values).
- After clicking login/submit, add "wait" step of "4" seconds.
- For Radix UI Select triggers: use [role="combobox"], NOT button:has-text("...").
- For Radix UI Checkboxes: use [role="checkbox"], NOT input[type="checkbox"].
- For hover-reveal buttons (opacity-0): use "hover_and_click" action.
  selector = container to hover, value = button selector to click.
- CSS attribute values with spaces MUST use double-quotes.
- severity: Critical=auth/core, High=main feature, Medium=secondary, Low=cosmetic.
SUPPORTED ACTIONS: navigate, click, fill, assert_text, screenshot, wait, hover, hover_and_click, press, check, uncheck, select_option, drag_and_drop, dblclick, type_into, scroll, clear
"""
    raw = await _call_openai(prompt)
    parsed = _parse_json_object(raw)

    analysis_data: dict[str, Any] = parsed.get("analysis", {})
    tests: list[dict[str, Any]] = parsed.get("tests", [])
    return analysis_data, tests


# ─── NEW: SDLC Intelligence prompts ────────────────────────────────────────


async def review_pull_request(pr_title: str, pr_body: str, files: list[dict], custom_rules: str | None = None) -> dict[str, Any]:
  """AI code review for a GitHub pull request with safe v2->legacy fallback.

  The result's `meta` reports coverage (files in the change, reviewed, failed,
  skipped, truncated). When any file's review failed the recommendation is
  "INCOMPLETE", never an approval. Raises AIQuotaError when no file could be
  reviewed because of rate limiting.
  """
  if not settings.PR_REVIEW_V2_ENABLED:
    return await _review_pull_request_legacy(pr_title, pr_body, files, custom_rules)
  try:
    return await _review_pull_request_v2(pr_title, pr_body, files, custom_rules)
  except AIQuotaError:
    raise
  except Exception:
    return await _review_pull_request_legacy(pr_title, pr_body, files, custom_rules)


_OSS_SUMMARIZE_FILE_DIFF_PROMPT = """## GitHub PR Title

`$title`

## Description

```
$description
```

## Diff

```diff
$file_diff
```

## Instructions

I would like you to succinctly summarize the diff within 100 words.
If applicable, your summary should include a note about alterations
to the signatures of exported functions, global data structures and
variables, and any changes that might affect the external interface or
behavior of the code.
"""

_OSS_TRIAGE_FILE_DIFF_PROMPT = """Below the summary, I would also like you to triage the diff as `NEEDS_REVIEW` or
`APPROVED` based on the following criteria:

- If the diff involves any modifications to the logic or functionality, even if they
  seem minor, triage it as `NEEDS_REVIEW`. This includes changes to control structures,
  function calls, or variable assignments that might impact the behavior of the code.
- If the diff only contains very minor changes that don't affect the code logic, such as
  fixing typos, formatting, or renaming variables for clarity, triage it as `APPROVED`.

Please evaluate the diff thoroughly and take into account factors such as the number of
lines changed, the potential impact on the overall system, and the likelihood of
introducing new bugs or security vulnerabilities.
When in doubt, always err on the side of caution and triage the diff as `NEEDS_REVIEW`.

You must strictly follow the format below for triaging the diff:
[TRIAGE]: <NEEDS_REVIEW or APPROVED>

Important:
- In your summary do not mention that the file needs a through review or caution about
  potential issues.
- Do not provide any reasoning why you triaged the diff as `NEEDS_REVIEW` or `APPROVED`.
- Do not mention that these changes affect the logic or functionality of the code in
  the summary. You must only use the triage status format above to indicate that.
"""

_OSS_REVIEW_FILE_DIFF_PROMPT = """## GitHub PR Title

`$title`

## Description

```
$description
```

## Summary of changes

```
$short_summary
```

## IMPORTANT Instructions

Input: New hunks annotated with line numbers and old hunks (replaced code). Hunks represent incomplete code fragments.
Additional Context: PR title, description, summaries and comment chains.
Task: Review new hunks for substantive issues using provided context and respond with comments if necessary.
Output: Review comments in markdown with exact line number ranges in new hunks. Start and end line numbers must be within the same hunk. For single-line comments, start=end line number. Must use example response format below.
Use fenced code blocks using the relevant language identifier where applicable.
Don't annotate code snippets with line numbers. Format and indent code correctly.
Do not use `suggestion` code blocks.
For fixes, use `diff` code blocks, marking changes with `+` or `-`. The line number range for comments with fix snippets must exactly match the range to replace in the new hunk.

- Do NOT provide general feedback, summaries, explanations of changes, or praises
  for making good additions.
- Focus solely on offering specific, objective insights based on the
  given context and refrain from making broad comments about potential impacts on
  the system or question intentions behind the changes.

If there are no issues found on a line range, you MUST respond with the
text `LGTM!` for that line range in the review section.

$custom_rules_section

## Changes made to `$filename` for your review

$patches
"""


def _render_oss_prompt(template: str, values: dict[str, str]) -> str:
  rendered = template
  for key, value in values.items():
    rendered = rendered.replace(f"${key}", value)
  return rendered


def _parse_patch_line_bounds(patch: str) -> tuple[int, int]:
  pattern = re.compile(r"^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@", re.MULTILINE)
  bounds: list[tuple[int, int]] = []
  for match in pattern.finditer(patch):
    start = int(match.group(1))
    length = int(match.group(2) or "1")
    end = start + max(length - 1, 0)
    bounds.append((start, end))
  if not bounds:
    return (1, 1)
  return min(x[0] for x in bounds), max(x[1] for x in bounds)


def _extract_hunks(patch: str, max_hunks: int) -> list[dict[str, Any]]:
  pattern = re.compile(
    r"^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@",
    re.MULTILINE,
  )
  hunks: list[dict[str, Any]] = []
  matches = list(pattern.finditer(patch))
  for idx, match in enumerate(matches):
    start_ix = match.start()
    end_ix = matches[idx + 1].start() if idx + 1 < len(matches) else len(patch)
    new_start = int(match.group(3))
    new_len = int(match.group(4) or "1")
    new_end = new_start + max(new_len - 1, 0)
    hunks.append(
      {
        "start_line": new_start,
        "end_line": new_end,
        "text": patch[start_ix:end_ix].strip(),
      }
    )
    if len(hunks) >= max_hunks:
      break
  return hunks


def _normalize_recommendation(value: str | None) -> str:
  normalized = (value or "").strip().upper()
  allowed = {"APPROVE", "REQUEST_CHANGES", "NEEDS_DISCUSSION", "CONDITIONAL"}
  if normalized in allowed:
    return normalized
  if normalized in {"COMMENT", "COMMENTS"}:
    return "CONDITIONAL"
  return "CONDITIONAL"


def _normalize_severity(value: str | None) -> str:
  normalized = (value or "").strip().lower()
  if normalized in {"critical", "high", "medium", "low"}:
    return normalized
  return "low"


def _normalize_category(value: str | None) -> str:
  normalized = (value or "").strip().lower()
  allowed = {
    "security",
    "bug",
    "performance",
    "style",
    "test-coverage",
    "maintainability",
  }
  return normalized if normalized in allowed else "maintainability"


def _normalize_findings(file_name: str, patch: str, findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
  min_line, max_line = _parse_patch_line_bounds(patch)
  normalized: list[dict[str, Any]] = []
  for raw in findings:
    message_text = str(raw.get("message") or "").strip()
    if message_text.lower() in {"lgtm", "lgtm!", "looks good", "looks good to me", "no changes needed."}:
      continue

    start_line = raw.get("start_line") or raw.get("line") or min_line
    end_line = raw.get("end_line") or start_line
    try:
      start_line = int(start_line)
    except (TypeError, ValueError):
      start_line = min_line
    try:
      end_line = int(end_line)
    except (TypeError, ValueError):
      end_line = start_line

    start_line = max(min_line, min(start_line, max_line))
    end_line = max(start_line, min(end_line, max_line))

    normalized.append(
      {
        "file": file_name,
        "line": start_line,
        "start_line": start_line,
        "end_line": end_line,
        "severity": _normalize_severity(raw.get("severity")),
        "category": _normalize_category(raw.get("category")),
        "message": message_text or "Potential issue identified.",
        "suggestion": str(raw.get("suggestion") or "Review this block and add safeguards."),
      }
    )
  return normalized


_HUNK_HEADER_RE = re.compile(r"^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@", re.MULTILINE)
_NO_TEXT_DIFF = "no text diff available (binary, renamed or too large)"


def _review_coverage_meta(
  files_in_pr: int,
  reviewed: list[str],
  failed: list[dict[str, str]],
  skipped: list[dict[str, str]],
  truncated: list[str],
  engine_version: str,
) -> dict[str, Any]:
  """Coverage counts for a review: what was read, what was not, and why."""
  return {
    "files_in_pr": files_in_pr,
    "files_reviewed": len(reviewed),
    "files_failed": len(failed),
    "files_skipped": len(skipped),
    "files_truncated": len(truncated),
    "failed_files": failed,
    "skipped_files": skipped,
    "truncated_files": truncated,
    "review_status": "incomplete" if failed else "partial" if (skipped or truncated) else "complete",
    "engine_version": engine_version,
  }


async def _review_pull_request_v2(pr_title: str, pr_body: str, files: list[dict], custom_rules: str | None = None) -> dict[str, Any]:
  files_limit = max(1, settings.PR_REVIEW_MAX_FILES)
  patch_limit = max(500, settings.PR_REVIEW_MAX_PATCH_CHARS)
  hunks_limit = max(1, settings.PR_REVIEW_MAX_HUNKS_PER_FILE)

  selected_files: list[dict[str, Any]] = []
  skipped: list[dict[str, str]] = []
  truncated: list[str] = []
  for file_obj in files:
    filename = str(file_obj.get("filename") or "unknown")
    patch = str(file_obj.get("patch") or "")
    if not patch.strip():
      skipped.append({"file": filename, "reason": _NO_TEXT_DIFF})
      continue
    if len(selected_files) >= files_limit:
      skipped.append({"file": filename, "reason": f"over the {files_limit}-file review limit"})
      continue
    if len(patch) > patch_limit:
      truncated.append(filename)
    selected_files.append(
      {
        "filename": filename,
        "additions": int(file_obj.get("additions") or 0),
        "deletions": int(file_obj.get("deletions") or 0),
        "patch": patch[:patch_limit],
      }
    )

  if not selected_files:
    return {
      "summary": {
        "overall_risk": "unknown",
        "what_changed": "No textual diff hunks were available for review.",
        "test_coverage_estimate": "Not evaluated.",
        "review_recommendation": "INCOMPLETE",
      },
      "findings": [],
      "security_flags": [],
      "positive_observations": [],
      "positives": [],
      "recommendation": "INCOMPLETE",
      "meta": _review_coverage_meta(len(files), [], [], skipped, truncated, "v2"),
    }

  file_summaries: list[dict[str, str]] = []
  review_targets: list[dict[str, Any]] = []
  aggregated_security_flags: list[str] = []
  aggregated_positives: list[str] = []
  all_findings: list[dict[str, Any]] = []
  # filename -> exception from the failed LLM call that left the file unreviewed
  failures: dict[str, Exception] = {}

  async def process_summary(file_obj):
    summary_prompt_base = _OSS_SUMMARIZE_FILE_DIFF_PROMPT + "\n\n" + _OSS_TRIAGE_FILE_DIFF_PROMPT
    if custom_rules:
      summary_prompt_base += f"\n\nIMPORTANT: Take into account these TEAM GROUND RULES when deciding triage. If the diff violates any of these, you MUST output NEEDS_REVIEW:\n{custom_rules}"

    summary_prompt = _render_oss_prompt(
      summary_prompt_base,
      {
        "title": pr_title,
        "description": pr_body[:1200] or "no description provided",
        "file_diff": file_obj["patch"],
      },
    ) + """

Return ONLY valid JSON:
{
  "summary": "Max 100 words",
  "triage": "NEEDS_REVIEW|APPROVED"
}
"""
    try:
      summary_raw = await _call_openai(summary_prompt, json_mode=True, task_name="Review Pull Request")
      summary_data = _parse_json(summary_raw)
      if not isinstance(summary_data, dict):
        raise ValueError("summary response was not a JSON object")
    except Exception as exc:
      # No triage was obtained, so the file must go through the deep review.
      failures[file_obj["filename"]] = exc
      return file_obj, "NEEDS_REVIEW", "Summary unavailable: the AI call for this file failed."

    triage = str(summary_data.get("triage") or "NEEDS_REVIEW").strip().upper()
    if triage not in {"NEEDS_REVIEW", "APPROVED"}:
      triage = "NEEDS_REVIEW"
    summary_text = str(summary_data.get("summary") or "No summary returned.")
    return file_obj, triage, summary_text

  summary_results = await asyncio.gather(*(process_summary(f) for f in selected_files))
  for file_obj, triage, summary_text in summary_results:
    file_summaries.append({
      "file": file_obj["filename"],
      "summary": summary_text,
      "triage": triage,
    })
    if triage == "NEEDS_REVIEW":
      review_targets.append(file_obj)

  if not review_targets:
    review_targets = selected_files[: max(1, min(2, len(selected_files)))]

  short_summary_text = "\n".join([f"- {item['file']}: {item['summary']}" for item in file_summaries[:12]])

  async def process_review(file_obj):
    hunks = _extract_hunks(file_obj["patch"], hunks_limit)
    patches_text = "\n\n".join(
      [
        f"---new_hunk---\n```\n{h['text']}\n```\n\n---old_hunk---\n```\nUnavailable from provider patch payload\n```\n\n---end_change_section---"
        for h in hunks
      ]
    )
    custom_rules_section = f"## CRITICAL TEAM GROUND RULES\nThe team relies on you as the final gatekeeper for these rules. You MUST ruthlessly critique the diff hunks against these rules. If the updated code violates ANY of the following constraints, you must explicitly flag it as a finding with a HIGH or CRITICAL severity. DO NOT ignore these:\n\n{custom_rules}\n" if custom_rules else ""

    review_prompt = _render_oss_prompt(
      _OSS_REVIEW_FILE_DIFF_PROMPT,
      {
        "title": pr_title,
        "description": pr_body[:1200] or "no description provided",
        "short_summary": short_summary_text or "No summary available.",
        "filename": file_obj["filename"],
        "patches": patches_text,
        "custom_rules_section": custom_rules_section,
      },
    ) + """

Return ONLY valid JSON with exactly this shape:
{
  "findings": [
    {
      "start_line": 1,
      "end_line": 1,
      "severity": "critical|high|medium|low",
      "category": "security|bug|performance|style|test-coverage|maintainability",
      "message": "Issue detail",
      "suggestion": "Concrete fix"
    }
  ],
  "security_flags": ["string"],
  "positive_observations": ["string"]
}
"""
    try:
      review_raw = await _call_openai(review_prompt, json_mode=True, task_name="Review Pull Request")
      review_data = _parse_json(review_raw)
      if not isinstance(review_data, dict):
        raise ValueError("review response was not a JSON object")
    except Exception as exc:
      failures[file_obj["filename"]] = exc
      return file_obj, None
    # A successful deep review supersedes a failed summary call for the same file.
    failures.pop(file_obj["filename"], None)
    return file_obj, review_data

  review_results = await asyncio.gather(*(process_review(f) for f in review_targets))

  for file_obj, review_data in review_results:
    if len(_HUNK_HEADER_RE.findall(file_obj["patch"])) > hunks_limit and file_obj["filename"] not in truncated:
      truncated.append(file_obj["filename"])
    if review_data is None:
      continue
    findings = review_data.get("findings") or []
    if isinstance(findings, list):
      findings = [f for f in findings if isinstance(f, dict)]
      all_findings.extend(_normalize_findings(file_obj["filename"], file_obj["patch"], findings))

    security_flags = review_data.get("security_flags") or []
    positives = review_data.get("positive_observations") or []
    if isinstance(security_flags, list):
      aggregated_security_flags.extend([str(x) for x in security_flags if str(x).strip()])
    if isinstance(positives, list):
      aggregated_positives.extend([str(x) for x in positives if str(x).strip()])

  failed = [{"file": name, "error": str(exc)[:300]} for name, exc in failures.items()]
  reviewed = [f["filename"] for f in selected_files if f["filename"] not in failures]
  meta = _review_coverage_meta(len(files), reviewed, failed, skipped, truncated, "v2")
  meta["files_triaged_for_deep_review"] = len(review_targets)
  meta["file_summaries"] = file_summaries

  if not reviewed and all(isinstance(exc, AIQuotaError) or _is_quota_error(exc) for exc in failures.values()):
    raise AIQuotaError(
      "AI backend quota exceeded or rate limited: none of the "
      f"{len(selected_files)} file(s) could be reviewed. Please wait a moment and try again."
    )

  final_data: dict[str, Any] = {}
  if reviewed:
    final_prompt = f"""You are a release-focused code reviewer.

PR TITLE: {pr_title}
PR DESCRIPTION: {pr_body[:1200]}

FILE SUMMARIES:
{json.dumps(file_summaries, indent=2)[:12000]}

FINDINGS:
{json.dumps(all_findings, indent=2)[:12000]}

Return ONLY valid JSON:
{{
  "overall_risk": "low|medium|high|critical",
  "what_changed": "1-2 sentence summary",
  "test_coverage_estimate": "Coverage note",
  "review_recommendation": "APPROVE|REQUEST_CHANGES|NEEDS_DISCUSSION|CONDITIONAL"
}}
"""
    try:
      final_raw = await _call_openai(final_prompt, json_mode=True, task_name="Review Pull Request")
      final_data = _parse_json(final_raw)
      if not isinstance(final_data, dict):
        raise ValueError("final review response was not a JSON object")
    except Exception:
      if not failed:
        raise
      final_data = {}

  unique_security = list(dict.fromkeys(aggregated_security_flags))
  unique_positives = list(dict.fromkeys(aggregated_positives))

  if failed:
    # A review with unread files cannot approve. Findings from the files that
    # were read are still returned.
    recommendation = "INCOMPLETE"
    what_changed = (
      f"Review incomplete: {len(failed)} of {len(selected_files)} file(s) could not be reviewed "
      "because the AI call failed."
    )
    if final_data.get("what_changed"):
      what_changed = f"{what_changed} {final_data['what_changed']}"
    summary = {
      "overall_risk": str(final_data.get("overall_risk") or "unknown").lower(),
      "what_changed": what_changed,
      "test_coverage_estimate": str(final_data.get("test_coverage_estimate") or "Not evaluated."),
      "review_recommendation": recommendation,
    }
  else:
    recommendation = _normalize_recommendation(str(final_data.get("review_recommendation") or "CONDITIONAL"))
    summary = {
      "overall_risk": str(final_data.get("overall_risk") or "medium").lower(),
      "what_changed": str(final_data.get("what_changed") or "Updated files and behavior in this pull request."),
      "test_coverage_estimate": str(final_data.get("test_coverage_estimate") or "Tests impact requires manual verification."),
      "review_recommendation": recommendation,
    }

  return {
    "summary": summary,
    "findings": all_findings,
    "security_flags": unique_security,
    "positive_observations": unique_positives,
    "positives": unique_positives,
    "recommendation": recommendation,
    "meta": meta,
  }


_LEGACY_REVIEW_MAX_FILES = 15
_LEGACY_REVIEW_MAX_PATCH_CHARS = 3000
_LEGACY_REVIEW_MAX_DIFF_CHARS = 20000


async def _review_pull_request_legacy(pr_title: str, pr_body: str, files: list[dict], custom_rules: str | None = None) -> dict[str, Any]:
  """Legacy single-pass PR review path kept for fallback compatibility."""
  sections: list[str] = []
  reviewed: list[str] = []
  skipped: list[dict[str, str]] = []
  truncated: list[str] = []
  used_chars = 0
  for f in files:
    filename = str(f.get("filename") or "unknown")
    patch = str(f.get("patch") or "")
    if not patch.strip():
      skipped.append({"file": filename, "reason": _NO_TEXT_DIFF})
      continue
    if len(reviewed) >= _LEGACY_REVIEW_MAX_FILES:
      skipped.append({"file": filename, "reason": f"over the {_LEGACY_REVIEW_MAX_FILES}-file review limit"})
      continue
    separator = 2 if sections else 0
    if used_chars + separator >= _LEGACY_REVIEW_MAX_DIFF_CHARS:
      skipped.append({"file": filename, "reason": f"over the {_LEGACY_REVIEW_MAX_DIFF_CHARS}-character diff limit"})
      continue
    section = f"=== {filename} (+{f.get('additions', 0)} -{f.get('deletions', 0)}) ===\n{patch[:_LEGACY_REVIEW_MAX_PATCH_CHARS]}"
    used_chars += separator + len(section)
    if len(patch) > _LEGACY_REVIEW_MAX_PATCH_CHARS or used_chars > _LEGACY_REVIEW_MAX_DIFF_CHARS:
      truncated.append(filename)
    sections.append(section)
    reviewed.append(filename)
  diff_text = "\n\n".join(sections)
  meta = _review_coverage_meta(len(files), reviewed, [], skipped, truncated, "v1")

  if not reviewed:
    return {
      "summary": "No textual diff hunks were available for review.",
      "findings": [],
      "security_flags": [],
      "positives": [],
      "recommendation": "INCOMPLETE",
      "meta": meta,
    }

  custom_rules_section = f"\nTEAM GROUND RULES TO ENFORCE:\n{custom_rules}\n" if custom_rules else ""

  prompt = f"""You are a senior software engineer performing a thorough code review.

PR TITLE: {pr_title}
PR DESCRIPTION: {pr_body[:1000]}
{custom_rules_section}
DIFF:
{diff_text[:_LEGACY_REVIEW_MAX_DIFF_CHARS]}

Analyse every file in the diff and return structured findings.

Return ONLY valid JSON (no markdown) with exactly this shape:
{{
  "summary": {{
  "overall_risk": "low|medium|high|critical",
  "what_changed": "1–2 sentence description",
  "test_coverage_estimate": "string (e.g. 'No tests included', 'Unit tests added for 3 functions')",
  "review_recommendation": "APPROVE|REQUEST_CHANGES|NEEDS_DISCUSSION"
  }},
  "findings": [
  {{
    "file": "relative/file/path.ts",
    "line": 42,
    "severity": "critical|high|medium|low",
    "category": "security|bug|performance|style|test-coverage|maintainability",
    "message": "Clear description of the issue",
    "suggestion": "Concrete fix or improvement"
  }}
  ],
  "security_flags": ["string"],
  "positive_observations": ["string"]
}}

Focus on: SQL injection, XSS, null dereferences, missing error handling, hardcoded secrets,
N+1 queries, missing input validation, unhandled promises, race conditions.
Return JSON only."""
  raw = await _call_openai(prompt)
  data = _parse_json(raw)
  data["meta"] = meta
  summary_field = data.get("summary", "")
  if isinstance(summary_field, dict):
    parts = []
    if summary_field.get("what_changed"):
      parts.append(summary_field["what_changed"])
    if summary_field.get("overall_risk"):
      parts.append(f"Risk: {summary_field['overall_risk']}")
    if summary_field.get("test_coverage_estimate"):
      parts.append(summary_field["test_coverage_estimate"])
    data["summary"] = " | ".join(parts) if parts else str(summary_field)
    if not data.get("recommendation") and summary_field.get("review_recommendation"):
      data["recommendation"] = summary_field["review_recommendation"]
  if "positive_observations" in data and "positives" not in data:
    data["positives"] = data.pop("positive_observations")
  return data


async def explain_ci_failure(step: str, error_message: str, stack_trace: str, repo_language: str) -> dict[str, Any]:
    """Explain a CI/CD build failure in plain English."""
    prompt = f"""You are a DevOps engineer. A CI build failed.

Repository language: {repo_language}
Failed step: {step}
Error message: {error_message[:2000]}
Stack trace (first 10 lines):
{stack_trace[:3000]}

Return ONLY valid JSON:
{{
  "explanation": "2–3 sentence plain-English explanation of what went wrong",
  "fix": "One concrete actionable fix",
  "category": "test|build|dependency|environment|flaky|lint|timeout",
  "confidence": 0.85,
  "is_flaky_candidate": false
}}"""
    raw = await _call_openai(prompt)
    return _parse_json_object(raw)


async def generate_defect_risk_narrative(top_risk_files: list[dict]) -> str:
    """Write a risk summary narrative for the top high-risk files."""
    prompt = f"""You are a software engineering lead reviewing code quality metrics.
These are the top highest-risk files in the repository based on change frequency,
bug-fix association, code churn, and author diversity:

{json.dumps(top_risk_files, indent=2)[:8000]}

Write a 3-paragraph risk summary for an engineering manager:
1. Which files need immediate attention and why
2. Pattern analysis are these in the same module? Same author?
3. Recommended actions (add tests, refactor, code review gate)

Keep it concise and actionable. Plain text, no markdown headers."""
    raw = await _call_openai(prompt)
    return raw.strip()


async def analyze_release_readiness(
    version: str,
    test_pass_rate: float | None,
    open_critical_bugs: list[dict] | None,
    unresolved_security_findings: int | None,
    high_risk_files: list[str] | None,
    score: int | None,
    verdict: str,
    blockers: list[str] | None = None,
) -> dict[str, Any]:
    """Write the recommendation narrative for a release verdict the caller already decided.

    The verdict and score are computed by the caller; the model only explains them.
    A signal passed as None was not evaluated and is described to the model as such.
    Returns {"recommendation": str}.
    """
    not_evaluated = "not evaluated"
    if open_critical_bugs is None:
        bugs_line = not_evaluated
    else:
        bug_titles = [f"{b.get('key', '?')}: {b.get('summary', '')}" for b in open_critical_bugs[:5]]
        bugs_line = f"{len(open_critical_bugs)} ({', '.join(bug_titles) or 'none'})"
    prompt = f"""You are a release manager. A release was evaluated by a fixed scoring rule and the
verdict below is final. Explain it; do not change it or propose a different verdict.

Version: {version}
Verdict: {verdict}
Release readiness score: {f'{score}/100' if score is not None else not_evaluated}
Blockers: {'; '.join(blockers or []) or 'none'}
CI workflow run pass rate (share of recent GitHub Actions runs that succeeded; not a test pass rate): {f'{test_pass_rate:.1f}%' if test_pass_rate is not None else not_evaluated}
Open critical/high bugs: {bugs_line}
Unresolved security findings: {unresolved_security_findings if unresolved_security_findings is not None else not_evaluated}
High-risk files changed: {(', '.join(high_risk_files[:8]) or 'none') if high_risk_files is not None else not_evaluated}

Write a 2-3 sentence recommendation for the release owner. Use only the figures above.
A signal marked "{not_evaluated}" was not measured: say so if it matters, and never
describe it as passing, clean, or zero. Do not state a confidence level.

Return ONLY valid JSON:
{{
  "recommendation": "2-3 sentence recommendation"
}}"""
    raw = await _call_openai(prompt)
    data = _parse_json(raw)
    recommendation = data.get("recommendation") if isinstance(data, dict) else None
    return {"recommendation": str(recommendation or "").strip()}


async def investigate_incident(
    anomaly: dict,
    column_comparison: list[dict],
    recent_commits: list[str],
    related_alerts: list[dict],
) -> dict[str, Any]:
    """AI root cause analysis for a data quality incident."""
    prompt = f"""You are an incident response engineer. A data quality anomaly has been detected.

Anomaly: {json.dumps(anomaly)}
Affected columns (current vs baseline): {json.dumps(column_comparison[:10])}
Recent commits: {json.dumps(recent_commits[:5])}
Related alerts: {json.dumps(related_alerts[:5])}

Provide a root cause analysis. Return ONLY valid JSON:
{{
  "root_cause": "One sentence most likely root cause",
  "evidence": ["bullet point 1", "bullet point 2", "bullet point 3"],
  "immediate_action": "Single most important remediation step",
  "prevention_action": "How to prevent recurrence",
  "confidence": 0.80
}}"""
    raw = await _call_openai(prompt)
    return _parse_json_object(raw)


async def generate_incident_postmortem(facts: dict) -> str:
    """Write the narrative sections of an incident post-mortem, in Markdown.

    `facts` is the stored incident record (timeline, root-cause hypothesis,
    evidence, resolution note). The model may only restate and organise it.
    """
    prompt = f"""You are an incident manager writing a blameless post-mortem.

These are the only recorded facts about the incident:
{json.dumps(facts, indent=2, default=str)[:8000]}

Write the post-mortem body in Markdown with exactly these level-2 sections, in order:
## Summary
## Impact
## What happened
## Root cause
## Resolution
## Follow-up actions

Rules:
- Use only the facts above. Do not invent times, people, systems, metrics, customer
  impact or causes. Where the record does not say, write "Not recorded".
- The root cause in the record is an automated hypothesis, not a confirmed finding.
  Present it as a hypothesis and say what evidence supports it.
- If the incident is not resolved, say so in Resolution.
- "What happened" is a chronological account built from the timeline entries.
- No title line, no preamble, no closing remarks. Markdown only."""
    raw = await _call_openai(prompt, json_mode=False)
    text = re.sub(r"^```(?:markdown|md)?\s*", "", (raw or "").strip(), flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text).strip()
    if "## " not in text:
        raise AIResponseError("The post-mortem response did not contain the requested sections.")
    return text


async def generate_acceptance_criteria(story: dict, existing_stories: list[dict]) -> dict[str, Any]:
    """Generate BDD acceptance criteria for a Jira user story."""
    context = "\n".join(f"- {s['key']}: {s['summary']}" for s in existing_stories[:10])
    prompt = f"""You are a senior QA engineer and business analyst.

USER STORY:
Key: {story.get('key', 'N/A')}
Summary: {story.get('summary', '')}
Description: {story.get('description', '')[:1500]}
Priority: {story.get('priority', 'Medium')}

EXISTING STORIES (for duplicate detection):
{context}

Generate structured acceptance criteria. Return ONLY valid JSON:
{{
  "acceptance_criteria": [
    {{
      "scenario": "Scenario name",
      "given": "Given context",
      "when": "When action",
      "then": "Then expected outcome"
    }}
  ],
  "ambiguity_flags": [
    {{
      "term": "ambiguous term",
      "question": "specific clarification question"
    }}
  ],
  "risk_score": 65,
  "risk_reasoning": "why this score",
  "duplicate_of": "PROJ-123 or null",
  "test_hints": ["key thing to test 1", "key thing to test 2"]
}}

Generate 3–5 Given/When/Then scenarios. Flag terms that are undefined or ambiguous."""
    raw = await _call_openai(prompt)
    return _parse_json_object(raw)


async def generate_predictive_alert(
    time_series: list[dict],
    anomalies: list[dict],
    projection: dict | None = None,
) -> dict[str, Any]:
    """Write the alert text for detected anomalies.

    The at-risk dimension, severity and any breach projection are computed by
    the caller; the model only words them. Returns
    {"alert_message": str, "recommended_action": str}.
    """
    if projection:
        projection_text = json.dumps(projection, indent=2)
    else:
        projection_text = "none: the recent trend does not reach the threshold within the projection horizon"
    prompt = f"""You are a data observability engineer.

Quality score time series (last 10 points):
{json.dumps(time_series[-10:], indent=2)}

Detected anomalies (statistical, already computed):
{json.dumps(anomalies, indent=2)[:3000]}

Linear trend projection (already computed):
{projection_text}

Write a Slack-ready alert describing the anomalies above. Use only the figures
given. Do not estimate or invent a time to breach: if a projection is given you
may quote it as a linear projection, otherwise do not mention any breach timing.

Return ONLY valid JSON:
{{
  "alert_message": "Slack-ready alert message (2-3 sentences)",
  "recommended_action": "Specific investigation step"
}}"""
    raw = await _call_openai(prompt)
    data = _parse_json(raw)
    if not isinstance(data, dict):
        raise AIResponseError("The alert response was not a JSON object.")
    return {
        "alert_message": str(data.get("alert_message") or "").strip(),
        "recommended_action": str(data.get("recommended_action") or "").strip(),
    }


async def generate_playwright_tests_from_source(
    file_path: str,
    content: str,
    target_url: str | None = None,
  num_tests: int | None = None,
) -> list[dict[str, Any]]:
    """
    Given a React/TypeScript source file from the workspace, generate PlaywrightTestCase
    objects with structured steps. No running app required steps use relative paths.
    """
    url_line = (
        f"TARGET BASE URL: {target_url} (use as prefix for navigate steps)"
        if target_url
        else "TARGET BASE URL: not provided use relative paths like '/', '/login', '/dashboard'"
    )
    truncated = content[:10000]
    requested_tests = max(1, min(int(num_tests or 5), 20))

    prompt = f"""You are a senior Playwright E2E test automation engineer specializing in React, TypeScript, and Radix UI.

Given a React/TypeScript source file from a web application, generate comprehensive Playwright test cases.

FILE PATH: {file_path}
{url_line}

SOURCE FILE:
{truncated}

Analyze the component/page to identify:
- The page name and primary feature
- All interactive elements: buttons, forms, inputs, links, dialogs
- Key user flows (happy path, validation, error states)
- Navigation patterns

Return ONLY raw JSON no markdown fences, no extra text:
{{
  "tests": [
    {{
      "name": "Concise descriptive test name",
      "description": "One-sentence description of what is verified",
      "page_name": "Name of the page or feature (e.g. Login, Dashboard)",
      "severity": "Critical|High|Medium|Low",
      "steps": [
        {{
          "action": "navigate",
          "selector": null,
          "value": "/",
          "description": "Navigate to the page"
        }},
        {{
          "action": "screenshot",
          "selector": null,
          "value": null,
          "description": "Capture initial page state"
        }},
        {{
          "action": "click",
          "selector": "button:has-text(\\"Submit\\")",
          "value": null,
          "description": "Click the Submit button"
        }},
        {{
          "action": "assert_text",
          "selector": null,
          "value": "Expected text on page",
          "description": "Verify expected text is visible"
        }},
        {{
          "action": "screenshot",
          "selector": null,
          "value": null,
          "description": "Capture final state"
        }}
      ]
    }}
  ]
}}

SELECTOR RULES:
- Buttons: button:has-text("Label")
- Links: a:has-text("Label")
- Email input: input[type="email"]
- Password input: input[type="password"]
- Text input with placeholder: input[placeholder="Search..."]
- Radix Select trigger: [role="combobox"]
- Radix Select option: [role="option"]:has-text("Value")
- Radix Checkbox: [role="checkbox"]
- Dialog: [role="dialog"]

VALID ACTIONS: navigate, click, fill, assert_text, screenshot, wait, hover, hover_and_click, press, check, uncheck, select_option, dblclick, type_into, scroll, clear

SEVERITY: Critical=auth/core flows, High=main features, Medium=secondary features, Low=cosmetic

Rules:
- Always start each test with a "navigate" step
- Always include at least one "screenshot" step
- Generate EXACTLY {requested_tests} test cases covering different scenarios
- Each test should be independently executable
- "wait" value is seconds as a string e.g. "2"
- "hover_and_click": selector=element to hover, value=element to click after hover"""

    data = await _call_openai_json(prompt)
    if not isinstance(data, dict):
        data = {}
    tests: list[dict[str, Any]] = data.get("tests", [])

    for test in tests:
        test.setdefault("id", str(uuid.uuid4()))
        test.setdefault("analysis_id", "workspace")

    return tests


# ─── Repo Baseline: Full-Scan & Incremental Generators ─────────────────────
# These two functions power the new "smart baseline" pipeline:
#   generate_baseline_tests  → first scan of a repo (or forced full rescan)
#   generate_incremental_tests → re-scan only changed files

_BASELINE_SYSTEM_PROMPT = """You are a senior QA engineer who writes production-grade Playwright test cases.

RULES:
1. Read the actual code provided do NOT generate generic Lorem-ipsum tests.
2. Assign category from EXACTLY this list:
   auth, api, ui_form, ui_navigation, ui_component, crud, integration, edge_case, performance, accessibility
3. Choose the MOST PRECISE category:
   - auth → anything involving login, logout, sessions, JWT, protected routes
   - api → fetch calls, REST handlers, HTTP status validations
   - ui_form → <form>, handleSubmit, input validation, error messages
   - ui_navigation → <Link>, router.push, nav menus, breadcrumbs
   - ui_component → isolated components (modals, tables, dropdowns)
   - crud → create/read/update/delete operations on entities
   - integration → multiple services cooperating (e.g. API + DB + UI)
   - edge_case → null checks, empty states, 404, boundary values
   - performance → loading skeletons, debounce, lazy load, timeouts
   - accessibility → aria-*, role, keyboard navigation, focus management
   Do NOT default everything to ui_component.
4. page_path = the actual URL route (e.g. /dashboard/users), not a component name
5. component_name = React/Vue component name (e.g. UserEditModal)
6. endpoint = "METHOD /path" for API tests (e.g. "POST /api/orders")
7. severity: critical = auth/payment, high = core CRUD, medium = flows, low = edge cases
8. playwright_code must be valid, runnable Playwright TypeScript code wrapped in:
   test('...', async ({ page }) => { ... });
9. Return ONLY valid JSON. No markdown fences. No explanation outside the JSON."""

_FULL_SCAN_USER_PROMPT = """Analyse this codebase chunk and generate comprehensive Playwright test cases.

CODEBASE CHUNK:
{code_chunks}

Generate between 5 and 15 test cases covering the functionality found in this chunk.
Aim for good distribution across the categories that actually appear in this chunk.
Every test must be grounded in real code you can see above no hallucinated features.

Return JSON with EXACTLY this structure (no extra keys):
{{
  "tests": [
    {{
      "name": "Human-readable test name",
      "description": "One sentence: what this test verifies",
      "category": "auth",
      "page_path": "/login",
      "component_name": null,
      "endpoint": null,
      "severity": "critical",
      "source_file": "src/pages/Login.tsx",
      "steps": [
        {{"action": "navigate", "target": "/login", "value": null, "assertion": null}},
        {{"action": "fill", "target": "input[type=email]", "value": "test@example.com", "assertion": null}},
        {{"action": "fill", "target": "input[type=password]", "value": "password123", "assertion": null}},
        {{"action": "click", "target": "button[type=submit]", "value": null, "assertion": null}},
        {{"action": "expect", "target": "/dashboard", "value": null, "assertion": "url contains /dashboard"}}
      ],
      "playwright_code": "test('User can log in with valid credentials', async ({{ page }}) => {{\\n  await page.goto('/login');\\n  await page.fill('input[type=email]', 'test@example.com');\\n  await page.fill('input[type=password]', 'password123');\\n  await page.click('button[type=submit]');\\n  await page.waitForURL('**/dashboard');\\n  await expect(page).toHaveURL(/dashboard/);\\n}});"
    }}
  ]
}}"""

_INCREMENTAL_USER_PROMPT = """Analyse ONLY the changed files below and generate NEW Playwright test cases.

CHANGED FILES (what was modified in this commit/push):
{changed_code}

EXISTING TESTS ALREADY IN DATABASE (DO NOT duplicate any of these):
{existing_tests_summary}

TASK:
- Generate test cases ONLY for new/changed logic visible in the files above.
- Do NOT outputs tests already covered by the existing list, even if you rephrase the name.
- If the change is minor (typo fix, whitespace, comment-only), return {{"tests": []}}.
- Focus on: new API endpoints, new routes, new components, changed business logic, new validations.
- Same JSON structure and rules as a full scan apply.

Return {{"tests": []}} if nothing genuinely new was introduced."""


def _validate_ai_test(raw: dict[str, Any], session_id: str) -> "dict[str, Any] | None":
    """
    Validate and normalise a single AI-generated test dict.
    Returns None if the test should be discarded (malformed / empty).
    Never raises a bad test from the AI must not crash the whole run.
    """
    try:
        if not raw.get("name") or not raw.get("description"):
            return None
        steps = raw.get("steps", [])
        if not steps:
            return None

        from app.models.repo_baseline import coerce_category
        category = coerce_category(raw.get("category"))

        severity = (raw.get("severity") or "medium").strip().lower()
        if severity not in {"critical", "high", "medium", "low"}:
            severity = "medium"

        return {
            "test_id": f"TC-{uuid.uuid4().hex[:6].upper()}",
            "name": str(raw["name"])[:200],
            "description": str(raw.get("description", ""))[:500],
            "category": category,
            "page_path": raw.get("page_path") or None,
            "component_name": raw.get("component_name") or None,
            "endpoint": raw.get("endpoint") or None,
            "severity": severity,
            "source_file": raw.get("source_file") or None,
            "steps": steps,
            "playwright_code": str(raw.get("playwright_code", "")),
            "added_in_session": session_id,
            "is_active": True,
        }
    except Exception:
        return None


def _tests_from_answer(parsed: Any) -> list[dict[str, Any]]:
    tests = parsed.get("tests") if isinstance(parsed, dict) else None
    if not isinstance(tests, list):
        raise AIResponseError('The AI model did not return a {"tests": [...]} object.')
    return [t for t in tests if isinstance(t, dict)]


async def generate_baseline_tests(
    code_chunks: list[str],
    session_id: str,
    task_name: str = "generate_baseline_tests",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Full-repo scan: send each source chunk to the AI concurrently.

    Returns (tests, failed_chunks). `tests` are validated dicts ready to store;
    `failed_chunks` is [{"chunk": 1-based index, "error": str}] for chunks whose
    call or answer failed. Raises when every chunk failed (AIQuotaError if they
    were all rate-limited), so a scan never completes on no evidence.
    """
    async def process_chunk(chunk: str) -> list[dict[str, Any]]:
        prompt_text = f"{_BASELINE_SYSTEM_PROMPT}\n\n{_FULL_SCAN_USER_PROMPT.format(code_chunks=chunk)}"
        return _tests_from_answer(await _call_openai_json(prompt_text, task_name=task_name))

    outcomes = await asyncio.gather(*(process_chunk(c) for c in code_chunks), return_exceptions=True)

    raw_tests: list[dict[str, Any]] = []
    failures: list[tuple[int, BaseException]] = []
    for index, outcome in enumerate(outcomes, 1):
        if isinstance(outcome, BaseException):
            failures.append((index, outcome))
        else:
            raw_tests.extend(outcome)

    if failures and len(failures) == len(code_chunks):
        first = failures[0][1]
        if all(isinstance(exc, Exception) and _is_quota_error(exc) for _, exc in failures):
            raise AIQuotaError(str(first))
        raise first

    validated = [clean for raw in raw_tests if (clean := _validate_ai_test(raw, session_id))]
    failed_chunks = [{"chunk": index, "error": str(exc)[:300] or type(exc).__name__} for index, exc in failures]
    return validated, failed_chunks


async def generate_incremental_tests(
    changed_code: str,
    existing_tests: list[dict[str, Any]],
    session_id: str,
    task_name: str = "generate_incremental_tests",
) -> list[dict[str, Any]]:
    """
    Incremental scan: send only changed file content + a compact summary of existing
    tests so the AI knows what NOT to generate.

    Returns a list of validated new test dicts. A failed call or an unusable
    answer raises; an empty list means the model found nothing new to test.
    """
    # Compact summary: name + category + page_path only (saves tokens)
    summary = [
        {
            "name": t.get("name"),
            "category": t.get("category"),
            "page_path": t.get("page_path"),
            "endpoint": t.get("endpoint"),
        }
        for t in existing_tests
    ]

    prompt_text = (
        f"{_BASELINE_SYSTEM_PROMPT}\n\n"
        + _INCREMENTAL_USER_PROMPT.format(
            changed_code=changed_code,
            existing_tests_summary=json.dumps(summary, indent=2),
        )
    )

    raw_tests = _tests_from_answer(await _call_openai_json(prompt_text, task_name=task_name))
    return [clean for raw in raw_tests if (clean := _validate_ai_test(raw, session_id))]


async def analyze_test_failure_root_cause(evidence: dict[str, Any], test_name: str) -> dict[str, Any]:
    """
    Correlate a real test-failure's evidence with real Git history and produce
    a root cause explanation. Returns a dict with confidence=0 and an "error"
    key on any AI failure callers must never treat that as a valid result.
    """
    commits_block = "\n".join(
        f"- {c.get('sha', '')[:12]} {c.get('message', '')} (by {c.get('author', 'unknown')})"
        for c in evidence.get("recent_commits", [])
    ) or "No recent commit history available."

    prompt = f"""You are a senior software engineer investigating a failed automated test.

Test name: {test_name}
Error message: {evidence.get('error_message') or 'Not available'}
Failed step: {(evidence.get('failed_step') or {}).get('step_description', 'Not available')}
Recent commits to this repository:
{commits_block}

Git diff of the most recent commit (may be truncated):
{(evidence.get('git_diff') or 'Not available')[:4000]}

Based ONLY on the information above, determine the most likely root cause. Do not invent
information that isn't present above if the evidence is insufficient, say so explicitly
in root_cause_explanation and lower the confidence score accordingly.

Return ONLY valid JSON (no markdown, no commentary) with this exact shape:
{{
  "root_cause_summary": "one sentence, plain language",
  "root_cause_explanation": "2-4 sentences explaining why, citing the specific commit/file/change if evident",
  "confidence": 0-100 integer,
  "likely_commit_sha": "short sha string or null if not evident",
  "affected_files": ["list", "of", "file", "paths", "or", "empty", "list"],
  "affected_tests": ["test names likely impacted, or just this test if unclear"],
  "affected_services": ["service/module names, or empty list"],
  "recommendation": "one concrete, actionable remediation suggestion"
}}"""

    try:
        raw = await _call_openai(prompt, json_mode=True, task_name="analyze_test_failure_root_cause")
        try:
            data: dict[str, Any] = _parse_json(raw)
        except AIResponseError as parse_err:
            return {
                "root_cause_summary": None, "root_cause_explanation": None, "confidence": 0,
                "likely_commit_sha": None, "affected_files": [], "affected_tests": [], "affected_services": [],
                "recommendation": None, "error": f"Invalid JSON from AI: {str(parse_err)[:300]}",
            }
        return {
            "root_cause_summary": data.get("root_cause_summary"),
            "root_cause_explanation": data.get("root_cause_explanation"),
            "confidence": max(0, min(100, int(data.get("confidence", 0) or 0))),
            "likely_commit_sha": data.get("likely_commit_sha") or None,
            "affected_files": data.get("affected_files") or [],
            "affected_tests": data.get("affected_tests") or [test_name],
            "affected_services": data.get("affected_services") or [],
            "recommendation": data.get("recommendation"),
        }
    except AIQuotaError:
        return {
            "root_cause_summary": None, "root_cause_explanation": None, "confidence": 0,
            "likely_commit_sha": None, "affected_files": [], "affected_tests": [], "affected_services": [],
            "recommendation": None, "error": "AI quota exceeded",
        }
    except Exception as exc:
        return {
            "root_cause_summary": None, "root_cause_explanation": None, "confidence": 0,
            "likely_commit_sha": None, "affected_files": [], "affected_tests": [], "affected_services": [],
            "recommendation": None, "error": str(exc)[:300],
        }


async def suggest_selector_repair(
    original_selector: str,
    step_description: str,
    candidates: list[dict],
) -> dict[str, Any]:
    """
    Picks the best-matching REAL candidate (by index) for a broken selector.
    The AI never invents a selector it can only choose an index into the
    candidates list that was actually observed on the live page, or return
    null to signal no safe match. Any index outside the real list's range
    is a hallucination and is rejected here, not trusted.
    """
    if not candidates:
        return {
            "selected_index": None,
            "confidence": 0,
            "reasoning": "No candidate elements were found on the live page.",
        }

    candidates_block = "\n".join(
        f"{i}: <{c.get('tag')}> text={c.get('text')!r} role={c.get('role')!r} selector={c.get('selector')!r}"
        for i, c in enumerate(candidates)
    )
    prompt = f"""A Playwright test step is failing because its selector no longer matches anything on the page.

Original (broken) selector: {original_selector}
Step description: {step_description}

Here are the real interactive elements actually found on the live page right now, indexed from 0:
{candidates_block}

Pick the index of the element most likely to be the intended replacement for the broken selector same
apparent purpose (e.g. same button in a login flow), even if the id/class/text changed. If nothing here
plausibly matches, say so.

Return ONLY valid JSON (no markdown) with this exact shape:
{{
  "selected_index": <integer index from the list above, or null if nothing plausibly matches>,
  "confidence": <0-100 integer>,
  "reasoning": "one or two sentences"
}}"""

    try:
        raw = await _call_openai(prompt, json_mode=True, task_name="suggest_selector_repair")
        data: dict[str, Any] = _parse_json(raw)
        idx = data.get("selected_index")
        if idx is not None and (not isinstance(idx, int) or idx < 0 or idx >= len(candidates)):
            return {
                "selected_index": None,
                "confidence": 0,
                "reasoning": "AI returned an index outside the real candidate list; rejected.",
            }
        return {
            "selected_index": idx,
            "confidence": max(0, min(100, int(data.get("confidence", 0) or 0))) if idx is not None else 0,
            "reasoning": data.get("reasoning"),
        }
    except AIQuotaError:
        return {"selected_index": None, "confidence": 0, "reasoning": None, "error": "AI quota exceeded"}
    except Exception as exc:
        return {"selected_index": None, "confidence": 0, "reasoning": None, "error": str(exc)[:300]}
