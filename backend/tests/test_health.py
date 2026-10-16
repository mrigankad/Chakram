from unittest.mock import AsyncMock, patch

import httpx
import pytest
from bson import ObjectId

import main
from app.auth.session import create_session_cookie
from app.services import organization_service


async def test_health_endpoint(app_client):
    resp = await app_client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "healthy"}


async def test_health_touches_no_dependency(app_client):
    """Liveness answers with MongoDB and the LLM provider both unreachable."""
    with patch.object(main, "get_db", side_effect=AssertionError("health must not use the database")), \
         patch.object(main.httpx, "AsyncClient", side_effect=AssertionError("health must not call out")):
        resp = await app_client.get("/health")
    assert resp.status_code == 200 and resp.json() == {"status": "healthy"}


class _LLM:
    """httpx.AsyncClient stand-in for the readiness probe of the LLM provider."""

    def __init__(self, status: int | None = 200, **_kwargs):
        self.status = status
        self.requests: list[tuple[str, dict]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, headers=None):
        self.requests.append((url, headers or {}))
        if self.status is None:
            raise httpx.ConnectError("refused")
        return httpx.Response(self.status, request=httpx.Request("GET", url))


def _settings(**overrides):
    values = {
        "GITHUB_TOKEN": "", "JIRA_DOMAIN": "", "JIRA_EMAIL": "", "JIRA_TOKEN": "", "VERCEL_TOKEN": "",
        "SLACK_WEBHOOK_URL": "", "OLLAMA_BASE_URL": "http://llm.test",
        "OLLAMA_API_KEY": "sk-llm-secret", "OLLAMA_MODEL": "test-model", **overrides,
    }
    return patch.multiple(main.settings, **values)


@pytest.mark.parametrize("path", ["/ready", "/api/ready"])
async def test_ready_reports_mongo_llm_and_integrations_without_secrets(app_client, db, path):
    llm = _LLM(200)
    with _settings(GITHUB_TOKEN="ghp_server_token", SLACK_WEBHOOK_URL="https://hooks.slack.test/x"), \
         patch.object(main.httpx, "AsyncClient", return_value=llm):
        resp = await app_client.get(path)

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["checks"]["mongo"] is True and body["checks"]["llm"] is True
    assert body["llm"] == {"reachable": True, "model": "test-model", "error": None}
    assert body["integrations"] == {
        "github": True, "jira": False, "vercel": False, "slack": True,
    }
    assert body["integrations_context"] == "server"
    assert llm.requests == [("http://llm.test/api/tags", {"Authorization": "Bearer sk-llm-secret"})]
    for secret in ("ghp_server_token", "hooks.slack.test", "sk-llm-secret"):
        assert secret not in resp.text


async def test_ready_stays_200_and_says_so_when_the_llm_is_unreachable(app_client, db):
    for llm, expected in ((_LLM(None), "could not be reached"), (_LLM(401), "HTTP 401")):
        with _settings(), patch.object(main.httpx, "AsyncClient", return_value=llm):
            resp = await app_client.get("/ready")
        assert resp.status_code == 200
        body = resp.json()
        assert body["checks"]["llm"] is False and body["llm"]["reachable"] is False
        assert expected in body["llm"]["error"]


async def test_ready_is_503_when_mongo_does_not_answer(app_client, db):
    broken = AsyncMock(side_effect=RuntimeError("no primary"))
    with patch.object(type(db), "command", new=broken, create=True), \
         patch.object(main.httpx, "AsyncClient", side_effect=AssertionError("LLM is not probed without MongoDB")):
        resp = await app_client.get("/ready")
    assert resp.status_code == 503
    assert resp.json()["status"] == "not_ready" and resp.json()["checks"]["mongo"] is False


async def test_ready_reports_integrations_for_the_signed_in_org(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_ready", name="R")
    await db.organizations.update_one(
        {"_id": ObjectId(org.id)},
        {"$set": {"connectors": {"jira": {"domain": "acme.atlassian.net", "email": "a@b.c", "token": "jira-secret"}}}},
    )
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    with _settings(GITHUB_TOKEN="ghp_server_token"), patch.object(main.httpx, "AsyncClient", return_value=_LLM(200)):
        body = (await app_client.get("/ready")).json()

    assert body["integrations_context"] == "org"
    assert body["integrations"]["jira"] is True
    assert body["integrations"]["github"] is True  # development: the org may use the server's token
    assert "jira-secret" not in str(body)


def test_console_streams_cannot_raise_on_unicode_progress_lines():
    """The app prints progress lines with characters a legacy Windows code page cannot encode."""
    import io
    import sys

    import main

    legacy = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", errors="strict")
    original = sys.stdout
    sys.stdout = legacy
    try:
        main._make_console_unicode_safe()
        print("[Job 1234] ✓ Repository cloned → analysing")
        sys.stdout.flush()
    finally:
        sys.stdout = original
    assert legacy.encoding.lower().replace("-", "") == "utf8"
