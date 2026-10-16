"""The connector registry: one list, what each feeds, and read-only checks stored per org."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.auth.session import create_session_cookie
from app.config import settings
from app.services import connector_registry as registry, connector_settings_service as connectors, organization_service


def test_registry_matches_the_settings_keys_and_every_connector_feeds_something():
    assert set(registry.REGISTRY) == set(connectors.CONNECTOR_KEYS)
    assert "datadog" not in registry.REGISTRY
    for c in registry.REGISTRY.values():
        assert c.feeds, c.id
        assert c.api_version
        assert set(c.secret_fields) == connectors.SECRET_FIELDS[c.id]


def test_configured_and_source_follow_the_resolution_rules(monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_TOKEN", "")
    monkeypatch.setattr(settings, "JIRA_DOMAIN", "x.atlassian.net")
    monkeypatch.setattr(settings, "JIRA_EMAIL", "a@b.c")
    monkeypatch.setattr(settings, "JIRA_TOKEN", "env-token")
    github, jira = registry.REGISTRY["github"], registry.REGISTRY["jira"]
    platform = {connectors._PLATFORM_KEY: True}
    assert registry.is_configured(github, connectors.resolve(platform, "github")) is False  # no token needed, but none set
    assert registry.is_configured(jira, connectors.resolve(platform, "jira")) is True
    assert registry._source({}, jira, connectors.resolve(platform, "jira")) == "env"
    raw = {"jira": {"token": "org-token"}}
    assert registry._source(raw, jira, connectors.resolve({**raw, **platform}, "jira")) == "org"


async def _login(app_client, db, name="org_a"):
    org = await organization_service.create_organization(db, workos_org_id=name, name=name)
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    return org


async def test_status_lists_every_connector_with_feeds(app_client, db, monkeypatch):
    monkeypatch.setattr(settings, "SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T1/B1/x")
    await _login(app_client, db)
    body = (await app_client.get("/api/orgs/current/connectors/status")).json()
    rows = {r["id"]: r for r in body["connectors"]}
    assert list(rows) == ["ollama", "github", "vercel", "jira", "slack"]
    assert rows["slack"]["configured"] is True and rows["slack"]["source"] == "env"
    assert rows["slack"]["last_check"] is None
    assert {f["id"] for f in rows["github"]["feeds"]} >= {"code-review", "ci-health", "app-studio-push"}
    assert rows["jira"]["api_version"] == "REST v3"


async def test_check_runs_a_probe_stores_the_result_and_reports_failures_as_ok_false(app_client, db, monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_TOKEN", "ghp_test")
    await _login(app_client, db)

    class _Resp:
        def __init__(self, status, payload):
            self.status_code = status
            self._payload = payload

        def json(self):
            return self._payload

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, **kwargs):
            assert kwargs["headers"]["Authorization"] == "Bearer ghp_test"
            return _Resp(200, {"resources": {"core": {"limit": 5000, "remaining": 4990}}})

    with patch.object(registry.httpx, "AsyncClient", _Client):
        resp = await app_client.post("/api/orgs/current/connectors/github/check")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True and "4990 of 5000" in body["message"] and body["checked_at"]

    status = (await app_client.get("/api/orgs/current/connectors/status")).json()
    github = next(r for r in status["connectors"] if r["id"] == "github")
    assert github["last_check"]["ok"] is True

    class _Down(_Client):
        async def get(self, url, **kwargs):
            raise httpx.ConnectError("boom")

    with patch.object(registry.httpx, "AsyncClient", _Down):
        body = (await app_client.post("/api/orgs/current/connectors/github/check")).json()
    assert body["ok"] is False and "Could not reach GitHub" in body["message"]

    body = (await app_client.post("/api/orgs/current/connectors/jira/check")).json()
    assert body == {"ok": False, "message": "Not configured.", "checked_at": body["checked_at"]}
    assert (await app_client.post("/api/orgs/current/connectors/datadog/check")).status_code == 404


async def test_slack_check_validates_the_webhook_shape_without_posting():
    ok, message = await registry._check_slack({"webhook_url": "https://example.com/hook"})
    assert ok is False and "hooks.slack.com" in message
    ok, message = await registry._check_slack({"webhook_url": "https://hooks.slack.com/services/T1/B1/abc"})
    assert ok is True


async def test_ollama_check_warns_when_the_configured_model_is_missing():
    class _Resp:
        status_code = 200

        def json(self):
            return {"models": [{"name": "llama3.1:8b"}]}

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, **kwargs):
            return _Resp()

    with patch.object(registry.httpx, "AsyncClient", _Client):
        ok, message = await registry._check_ollama({"base_url": "http://x", "api_key": "", "model": "kimi-k3:cloud"})
    assert ok is True and "not in the endpoint's model list" in message
