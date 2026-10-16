"""The monitoring demo dataset is labelled as a demo everywhere and never notifies anyone."""
from unittest.mock import AsyncMock, patch

import pytest

from app.auth.session import create_session_cookie
from app.routes import incidents, monitoring
from app.services import ai_service, organization_service

ALERT = {"alert_message": "Completeness is falling.", "recommended_action": "Check the export job."}


@pytest.fixture
async def client(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_demo", name="D")
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    return app_client


def _notifiers():
    return (
        patch.object(monitoring, "generate_predictive_alert", new=AsyncMock(return_value=ALERT)),
        patch.object(monitoring.slack_service, "send_critical_anomaly", new=AsyncMock(return_value=True)),
    )


def _real_series() -> list[dict]:
    """A measured-looking series with one collapse big enough to be a critical anomaly."""
    points = [
        {"date": f"2026-01-{day:02d}", "completeness": 95.0, "uniqueness": 96.0, "validity": 94.0,
         "consistency": 93.0, "overall": 94.5}
        for day in range(1, 30)
    ]
    points.append({"date": "2026-01-30", "completeness": 20.0, "uniqueness": 96.0, "validity": 94.0,
                   "consistency": 93.0, "overall": 75.75})
    return points


async def test_simulated_series_is_marked_demo_on_the_response_and_every_point(client):
    body = (await client.post("/api/monitoring/simulate-time-series", json={"baseline": {}})).json()
    assert body["demo"] is True
    assert len(body["series"]) == 30 and all(point["demo"] is True for point in body["series"])


async def test_analysing_the_demo_series_sends_no_slack_notification(client):
    demo = (await client.post("/api/monitoring/simulate-time-series", json={"baseline": {}})).json()
    alert, slack = _notifiers()
    with alert, slack as slack_mock:
        # What the UI does today: post the series back as it received it.
        echoed = (await client.post("/api/monitoring/analyze", json={"series": demo["series"]})).json()
        # And with the explicit flag on unmarked points.
        stripped = [{k: v for k, v in p.items() if k != "demo"} for p in demo["series"]]
        flagged = (await client.post("/api/monitoring/analyze", json={"series": stripped, "demo": True})).json()

    assert echoed["demo"] is True and flagged["demo"] is True
    assert echoed["anomaly_count"] >= 1  # the analysis itself still runs
    slack_mock.assert_not_awaited()


async def test_a_real_series_still_notifies(client):
    alert, slack = _notifiers()
    with alert, slack as slack_mock:
        body = (await client.post("/api/monitoring/analyze", json={"series": _real_series()})).json()

    assert body["demo"] is False
    assert any(a["severity"] == "critical" for a in body["anomalies"])
    slack_mock.assert_awaited_once()


async def test_a_dimension_missing_from_the_series_is_not_scored_as_zero(client):
    series = [{k: v for k, v in p.items() if k != "consistency"} for p in _real_series()]
    alert, slack = _notifiers()
    with alert, slack:
        body = (await client.post("/api/monitoring/analyze", json={"series": series})).json()
    assert body["anomalies"] and all(a["dimension"] != "consistency" for a in body["anomalies"])


# ── incidents ─────────────────────────────────────────────────────────────

RCA = {"root_cause": "Export job dropped a column", "evidence": ["e1"], "immediate_action": "Re-run",
       "prevention_action": "Schema check", "confidence": 0.7}


async def test_demo_incident_does_not_notify_slack_but_a_manual_one_does(client):
    notify = AsyncMock(return_value=True)
    with patch.object(incidents, "investigate_incident", new=AsyncMock(return_value=RCA)), \
         patch.object(incidents.slack_service, "send_incident_created", new=notify):
        demo = await client.post("/api/incidents", json={"anomaly": {"dimension": "completeness"}, "source": "demo"})
        assert demo.status_code == 201 and demo.json()["source"] == "demo"
        notify.assert_not_awaited()

        manual = await client.post("/api/incidents", json={"anomaly": {"dimension": "completeness"}})
        assert manual.status_code == 201
        notify.assert_awaited_once()


async def test_failed_root_cause_analysis_leaves_the_fields_empty_and_says_why(client, db):
    with patch.object(incidents, "investigate_incident", new=AsyncMock(side_effect=RuntimeError("model down"))), \
         patch.object(incidents.slack_service, "send_incident_created", new=AsyncMock(return_value=True)):
        resp = await client.post("/api/incidents", json={"anomaly": {"dimension": "validity"}})

    assert resp.status_code == 201
    incident = resp.json()
    assert incident["rca_error"] == "model down"
    assert incident["root_cause"] == "" and incident["evidence"] == []
    assert incident["immediate_action"] == "" and incident["prevention_action"] == ""
    assert incident["confidence"] is None
    assert incident["timeline"][1] == {
        "time": incident["timeline"][1]["time"], "event": "AI RCA unavailable: model down", "type": "ai_analysis_failed",
    }
    stored = await db.incidents.find_one({"_id": incident["id"]})
    assert "Unable to determine" not in str(stored) and "upstream data pipelines" not in str(stored)


async def test_incident_creation_is_429_when_the_ai_quota_is_exhausted(client, db):
    with patch.object(incidents, "investigate_incident", new=AsyncMock(side_effect=ai_service.AIQuotaError("rate limited"))):
        resp = await client.post("/api/incidents", json={"anomaly": {"dimension": "validity"}})
    assert resp.status_code == 429
    assert await db.incidents.count_documents({}) == 0
