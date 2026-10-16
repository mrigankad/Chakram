"""AI usage aggregation, generator usage logging, and the monitoring breach projection."""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.auth.session import create_session_cookie
from app.engines import generator
from app.routes import monitoring
from app.routes.monitoring import BREACH_THRESHOLD, project_breach
from app.services import ai_service, organization_service


def _cookies(app_client, org_id: str, user_id: str = "user") -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    app_client.cookies.set("aidlc_session", token)


def _log(org_id: str, task: str, prompt: int, completion: int, when: datetime) -> dict:
    return {
        "org_id": org_id, "task_name": task, "model": "m",
        "prompt_tokens": prompt, "completion_tokens": completion,
        "total_tokens": prompt + completion, "created_at": when,
    }


# ── /cost-logs/summary ────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_usage_summary_groups_by_task_and_day_for_the_callers_org(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_u1", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_u2", name="B")
    now = datetime.utcnow()
    yesterday = now - timedelta(days=1)
    await db.api_cost_logs.insert_many([
        _log(org_a.id, "Review Pull Request", 100, 50, now),
        _log(org_a.id, "Review Pull Request", 10, 5, yesterday),
        _log(org_a.id, "AI App Builder: Generate File", 0, 0, now),
        _log(org_a.id, "Old", 999, 999, now - timedelta(days=60)),
        _log(org_b.id, "Other Org", 5000, 5000, now),
    ])

    _cookies(app_client, org_a.id)
    resp = await app_client.get("/api/cost-logs/summary", params={"days": 7})
    assert resp.status_code == 200
    body = resp.json()

    assert body["totals"] == {
        "calls": 3, "prompt_tokens": 110, "completion_tokens": 55,
        "total_tokens": 165, "calls_without_usage": 1,
    }
    by_task = {row["task_name"]: row for row in body["by_task"]}
    assert set(by_task) == {"Review Pull Request", "AI App Builder: Generate File"}
    assert by_task["Review Pull Request"]["calls"] == 2
    assert by_task["Review Pull Request"]["total_tokens"] == 165
    assert by_task["AI App Builder: Generate File"]["calls_without_usage"] == 1

    assert len(body["by_day"]) == 7
    by_day = {row["date"]: row for row in body["by_day"]}
    assert by_day[now.strftime("%Y-%m-%d")]["calls"] == 2
    assert by_day[yesterday.strftime("%Y-%m-%d")]["total_tokens"] == 15
    assert sum(row["calls"] for row in body["by_day"]) == 3


@pytest.mark.anyio
async def test_cost_log_listing_no_longer_returns_cost_fields(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_u3", name="A")
    await db.api_cost_logs.insert_one({
        **_log(org.id, "t", 1, 1, datetime.utcnow()),
        "input_cost_usd": 0.0, "output_cost_usd": 0.0, "total_cost_usd": 0.0,
    })
    _cookies(app_client, org.id)
    body = (await app_client.get("/api/cost-logs")).json()

    assert "grand_total_cost_usd" not in body
    assert body["logs"][0]["total_tokens"] == 2
    assert not any(key.endswith("_cost_usd") for key in body["logs"][0])


# ── generator usage logging ───────────────────────────────────────────────

def _chunk(content: str | None = None, usage: tuple[int, int] | None = None):
    choices = [SimpleNamespace(delta=SimpleNamespace(content=content))] if content is not None else []
    usage_obj = SimpleNamespace(prompt_tokens=usage[0], completion_tokens=usage[1]) if usage else None
    return SimpleNamespace(choices=choices, usage=usage_obj)


class _FakeClient:
    def __init__(self, chunks):
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))
        self._chunks = chunks

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return iter(self._chunks)


async def _run_stream(client, org_id="org-x"):
    logged = AsyncMock()
    with patch.object(ai_service, "_get_client", return_value=client), \
         patch.object(ai_service, "_ollama_cfg", return_value=("http://x", "key", "org-model")), \
         patch.object(ai_service, "_log_cost", new=logged):
        tokens = [t async for t in generator.stream_file({"path": "src/A.tsx"}, org_id=org_id)]
        await asyncio.sleep(0)  # let the fire-and-forget log task run
    return tokens, logged


async def test_generator_logs_reported_usage_and_uses_resolved_model():
    client = _FakeClient([_chunk("import "), _chunk("x"), _chunk(usage=(120, 340))])
    tokens, logged = await _run_stream(client)

    assert tokens == ["import ", "x"]
    assert client.calls[0]["model"] == "org-model"
    assert client.calls[0]["stream_options"] == {"include_usage": True}
    logged.assert_awaited_once()
    assert logged.await_args.args == (generator._TASK_NAME, 120, 340)


async def test_generator_logs_zero_tokens_when_provider_reports_no_usage():
    client = _FakeClient([_chunk("a"), _chunk("b")])
    _tokens, logged = await _run_stream(client)

    logged.assert_awaited_once()
    assert logged.await_args.args == (generator._TASK_NAME, 0, 0)


# ── monitoring: linear breach projection ──────────────────────────────────

def _series(values: list[float], dim: str = "completeness") -> list[dict]:
    start = datetime(2026, 3, 1, tzinfo=timezone.utc)
    rows = []
    for i, value in enumerate(values):
        row = {"date": (start + timedelta(days=i)).strftime("%Y-%m-%d"),
               "completeness": 95.0, "uniqueness": 95.0, "validity": 95.0, "consistency": 95.0, "overall": 95.0}
        row[dim] = value
        rows.append(row)
    return rows


def test_projection_extrapolates_a_falling_line_to_the_threshold():
    # 90, 89, 88, 87, 86: slope -1/day, 6 points above 80 -> 6 days = 144h
    projection = project_breach(_series([90, 89, 88, 87, 86]))
    assert projection["dimension"] == "completeness"
    assert projection["method"] == "linear"
    assert projection["slope_per_day"] == -1.0
    assert projection["predicted_breach_in_hours"] == 144.0
    assert projection["threshold"] == BREACH_THRESHOLD
    assert projection["already_breached"] is False


def test_no_projection_when_trend_is_flat_or_rising():
    assert project_breach(_series([86, 87, 88, 89, 90])) is None
    assert project_breach(_series([90, 90, 90, 90])) is None


def test_no_projection_beyond_the_horizon_or_with_too_few_points():
    assert project_breach(_series([99.0, 98.99, 98.98, 98.97])) is None
    assert project_breach(_series([90, 85])) is None


def test_projection_reports_a_dimension_already_below_threshold():
    projection = project_breach(_series([85, 82, 78]))
    assert projection["already_breached"] is True
    assert projection["predicted_breach_in_hours"] == 0.0


@pytest.mark.anyio
async def test_analyze_uses_computed_projection_and_survives_ai_failure(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_m1", name="M")
    _cookies(app_client, org.id)
    # Steady values then a sharp fall: an anomaly on the last point and a falling trend.
    series = _series([95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 83])
    with patch.object(monitoring, "generate_predictive_alert", new=AsyncMock(side_effect=RuntimeError("model down"))):
        resp = await app_client.post("/api/monitoring/analyze", json={"series": series})

    assert resp.status_code == 200
    body = resp.json()
    assert body["anomaly_count"] >= 1
    assert body["projection"] == project_breach(series)
    assert body["projection"]["dimension"] == "completeness"
    alert = body["predictive_alert"]
    assert alert["predicted_breach_in_hours"] == body["projection"]["predicted_breach_in_hours"]
    assert alert["alert_message"] == ""
    assert "model down" in body["alert_error"]
