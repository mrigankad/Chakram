"""GAP-01: the test account never enters an LLM prompt; generated steps carry
{{TEST_EMAIL}} / {{TEST_PASSWORD}} placeholders that the browser step runner fills
at run time, from values held only for that run."""
import json
import logging

import pytest

from app.auth.session import create_session_cookie
from app.routes import repo_analysis as repo_routes
from app.services import ai_service, organization_service, playwright_service
from tests.test_step_runner import FakePage as _BasePage


class FakePage(_BasePage):
    """The step-runner fake plus the keyboard and event hooks the run loop uses."""

    async def type(self, text, delay=0):  # page.keyboard.type
        self.calls.append(("type", text))

    def on(self, event, handler):
        pass

EMAIL = "qa-account@example.com"
PASSWORD = "Sup3r-s3cret-pw!"

ANALYSIS = {
    "summary": "A todo app with login",
    "tech_stack": "React",
    "pages": [{"name": "Login", "path": "/login", "description": "Sign in", "key_elements": ["Sign In button"]}],
    "user_flows": [{"name": "Login", "steps": ["Open /login", "Fill email", "Fill password", "Submit"]}],
}


# ── (a) prompts ──────────────────────────────────────────────────────────────

async def test_generate_playwright_tests_prompt_holds_placeholders_not_the_account(monkeypatch):
    prompts: list[str] = []

    async def capture(prompt, *_a, **_k):
        prompts.append(prompt)
        return {"tests": []}

    monkeypatch.setattr(ai_service, "_call_openai_json", capture)
    await ai_service.generate_playwright_tests(ANALYSIS, "https://app.test", EMAIL, PASSWORD)

    assert len(prompts) == 1
    prompt = prompts[0]
    assert PASSWORD not in prompt
    assert EMAIL not in prompt
    assert playwright_service.TEST_EMAIL_TOKEN in prompt
    assert playwright_service.TEST_PASSWORD_TOKEN in prompt


async def test_generate_playwright_tests_email_only_prompt_holds_no_email(monkeypatch):
    prompts: list[str] = []

    async def capture(prompt, *_a, **_k):
        prompts.append(prompt)
        return {"tests": []}

    monkeypatch.setattr(ai_service, "_call_openai_json", capture)
    await ai_service.generate_playwright_tests(ANALYSIS, "https://app.test", EMAIL, None)

    assert EMAIL not in prompts[0]
    assert playwright_service.TEST_EMAIL_TOKEN in prompts[0]


async def test_commit_analysis_prompt_holds_placeholders_not_the_account(monkeypatch):
    prompts: list[str] = []

    async def capture(prompt, *_a, **_k):
        prompts.append(prompt)
        return json.dumps({"analysis": {}, "tests": []})

    monkeypatch.setattr(ai_service, "_call_openai", capture)
    await ai_service.analyze_commit_and_generate_tests(
        commit_sha="abcdef1234",
        commit_message="Add login",
        diff_text="+ <LoginForm />",
        file_contents="export default LoginForm",
        changed_files=["src/Login.tsx"],
        target_url="https://app.test",
        test_email=EMAIL,
        test_password=PASSWORD,
    )

    prompt = prompts[0]
    assert PASSWORD not in prompt
    assert EMAIL not in prompt
    assert playwright_service.TEST_EMAIL_TOKEN in prompt
    assert playwright_service.TEST_PASSWORD_TOKEN in prompt


# ── (b) run-time substitution in the step runner ────────────────────────────

def test_substitute_credentials_replaces_both_tokens():
    creds = {"email": EMAIL, "password": PASSWORD}
    assert playwright_service.substitute_credentials("{{TEST_EMAIL}}", creds) == EMAIL
    assert playwright_service.substitute_credentials("{{TEST_PASSWORD}}", creds) == PASSWORD
    assert playwright_service.substitute_credentials("plain", creds) == "plain"
    # Without credentials the placeholder is left as it is (nothing to put in).
    assert playwright_service.substitute_credentials("{{TEST_EMAIL}}", None) == "{{TEST_EMAIL}}"


async def _step(page, step, **kwargs):
    return await playwright_service._run_step(page, step, "http://app.test", "run", "test", 1, **kwargs)


async def test_fill_step_types_the_real_account_in_place_of_the_placeholders(monkeypatch, caplog):
    async def no_sleep(_s):
        pass

    monkeypatch.setattr(playwright_service.asyncio, "sleep", no_sleep)
    page = FakePage()
    creds = {"email": EMAIL, "password": PASSWORD}
    with caplog.at_level(logging.INFO, logger=playwright_service.log.name):
        r1 = await _step(page, {"action": "fill", "selector": 'input[type="email"]', "value": "{{TEST_EMAIL}}"},
                         credentials=creds, screenshot="never")
        r2 = await _step(page, {"action": "fill", "selector": 'input[type="password"]', "value": "{{TEST_PASSWORD}}"},
                         credentials=creds, screenshot="never")
        r3 = await _step(page, {"action": "type_into", "selector": "#pw", "value": "{{TEST_PASSWORD}}"},
                         credentials=creds, screenshot="never")

    assert r1["status"] == r2["status"] == r3["status"] == "pass"
    fills = [c for c in page.calls if c[0] == "fill"]
    assert fills[0][2] == EMAIL and fills[1][2] == PASSWORD
    assert ("type", PASSWORD) in page.calls
    # The substituted values are not written to the log.
    assert PASSWORD not in caplog.text and EMAIL not in caplog.text
    assert "{{TEST_PASSWORD}}" in caplog.text


async def test_without_credentials_a_placeholder_step_fails_instead_of_typing_the_placeholder(monkeypatch):
    async def no_sleep(_s):
        pass

    monkeypatch.setattr(playwright_service.asyncio, "sleep", no_sleep)
    page = FakePage()
    result = await _step(page, {"action": "fill", "selector": "#email", "value": "{{TEST_EMAIL}}"}, screenshot="never")
    assert result["status"] == "fail"
    assert "test account" in (result["error"] or "")
    assert not [c for c in page.calls if c[0] == "fill"]


async def test_execute_run_hands_the_account_to_every_step(monkeypatch, db):
    seen: list[dict | None] = []

    async def fake_run_step(page, step, target_url, run_id, test_name, step_num, screenshot="always", credentials=None):
        seen.append(credentials)
        return {"step_description": "", "screenshot": None, "status": "pass", "error": None}

    class _Pw:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    class _Ctx:
        async def new_page(self):
            return FakePage()

        async def close(self):
            pass

    class _Browser:
        async def new_context(self, **kw):
            return _Ctx()

        async def close(self):
            pass

    async def launch(pw, **kw):
        return _Browser()

    import types
    monkeypatch.setattr(playwright_service, "_run_step", fake_run_step)
    monkeypatch.setattr(playwright_service, "launch_chromium", launch)
    monkeypatch.setitem(__import__("sys").modules, "playwright.async_api",
                        types.SimpleNamespace(async_playwright=lambda: _Pw()))

    tests = [{"name": "Login", "steps": [{"action": "fill", "selector": "#e", "value": "{{TEST_EMAIL}}"}]}]
    await playwright_service.execute_playwright_tests(
        db, "org-1", tests, "http://t", "run-c", "a1", test_email=EMAIL, test_password=PASSWORD,
    )

    assert seen == [{"email": EMAIL, "password": PASSWORD}]
    stored = await db[playwright_service.RUNS].find_one({"_id": "run-c"})
    assert stored and PASSWORD not in str(stored)


# ── (c) the execute route passes the account through without storing it ─────

async def test_execute_route_passes_the_account_to_the_run_without_storing_it(app_client, db, monkeypatch):
    org = await organization_service.create_organization(db, workos_org_id="org_c", name="C")
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    await db.repo_analyses.insert_one({"_id": "an-1", "org_id": org.id, "target_url": "https://app.test",
                                       "test_email": "stored@example.com"})
    await db.playwright_tests.insert_one({"_id": "t-1", "org_id": org.id, "analysis_id": "an-1", "name": "Login",
                                          "steps": [{"action": "fill", "selector": "#p", "value": "{{TEST_PASSWORD}}"}]})

    async def ok(*_a, **_k):
        return None

    calls: list[dict] = []

    async def fake_execute(db_, org_id, tests, target_url, run_id, analysis_id, test_email=None, test_password=None):
        calls.append({"email": test_email, "password": test_password, "tests": tests})

    monkeypatch.setattr(repo_routes, "_require_fetchable_target", ok)
    monkeypatch.setattr(repo_routes, "_check_url_reachable", ok)
    monkeypatch.setattr(playwright_service, "execute_playwright_tests", fake_execute)

    resp = await app_client.post("/api/repo/analyses/an-1/execute", json={"test_password": PASSWORD})
    assert resp.status_code == 202
    assert calls == [{"email": "stored@example.com", "password": PASSWORD, "tests": calls[0]["tests"]}]
    assert PASSWORD not in str(await db.playwright_tests.find_one({"_id": "t-1"}))

    # No body at all still works (no account: placeholders stay as they are).
    resp = await app_client.post("/api/repo/analyses/an-1/execute")
    assert resp.status_code == 202
    assert calls[1]["password"] is None and calls[1]["email"] == "stored@example.com"


async def test_execute_direct_route_passes_the_account_to_the_run(app_client, db, monkeypatch):
    org = await organization_service.create_organization(db, workos_org_id="org_d", name="D")
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))

    async def ok(*_a, **_k):
        return None

    calls: list[dict] = []

    async def fake_execute(db_, org_id, tests, target_url, run_id, analysis_id, test_email=None, test_password=None):
        calls.append({"email": test_email, "password": test_password})

    monkeypatch.setattr(repo_routes, "_require_fetchable_target", ok)
    monkeypatch.setattr(repo_routes, "_check_url_reachable", ok)
    monkeypatch.setattr(playwright_service, "execute_playwright_tests", fake_execute)

    resp = await app_client.post("/api/repo/execute-direct", json={
        "target_url": "https://app.test",
        "tests": [{"name": "Login", "steps": [{"action": "fill", "selector": "#e", "value": "{{TEST_EMAIL}}"}]}],
        "test_email": EMAIL, "test_password": PASSWORD,
    })
    assert resp.status_code == 202
    assert calls == [{"email": EMAIL, "password": PASSWORD}]
