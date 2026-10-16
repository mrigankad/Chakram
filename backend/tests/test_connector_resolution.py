"""Slack and Datadog honour per-org connector settings; Jira AC goes to a comment."""
from contextlib import contextmanager

from app.config import settings
from app.services import connector_settings_service as connectors
from app.services import jira_service, slack_service


@contextmanager
def _org(value):
    token = connectors.set_current_org_connectors(value)
    try:
        yield
    finally:
        connectors.reset_current_org_connectors(token)


def test_slack_uses_org_webhook_then_env(monkeypatch):
    monkeypatch.setattr(settings, "SLACK_WEBHOOK_URL", "https://hooks.example/env")
    with _org({}):
        assert slack_service._webhook_url() == "https://hooks.example/env"
    with _org({"slack": {"webhook_url": "https://hooks.example/org"}}):
        assert slack_service._webhook_url() == "https://hooks.example/org"


async def test_slack_skips_when_nothing_is_configured(monkeypatch):
    monkeypatch.setattr(settings, "SLACK_WEBHOOK_URL", "")
    with _org({}):
        assert await slack_service.send_message("hi") is False


async def test_jira_acceptance_criteria_are_added_as_a_comment(monkeypatch):
    calls = []

    async def _fake_post(path, body):
        calls.append((path, body))
        return {"id": "10001", "self": "https://x/comment/10001"}

    async def _no_put(path, body):
        raise AssertionError("the issue description must not be overwritten")

    monkeypatch.setattr(jira_service, "_post", _fake_post)
    monkeypatch.setattr(jira_service, "_put", _no_put)

    result = await jira_service.add_issue_comment("PROJ-7", "AC 1: works\n\nAC 2: still works")

    assert result["id"] == "10001"
    path, body = calls[0]
    assert path == "/rest/api/3/issue/PROJ-7/comment"
    doc = body["body"]
    assert doc["type"] == "doc" and doc["version"] == 1
    texts = [p["content"][0]["text"] for p in doc["content"]]
    assert texts == ["AC 1: works", "AC 2: still works"]
