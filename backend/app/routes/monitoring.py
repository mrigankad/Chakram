"""
Production Monitoring & Anomaly Detection routes.
Uses dataset quality time series + AI predictive alerts.
"""
import math
import random
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.models.organization import OrganizationOut
from app.services.ai_service import generate_predictive_alert, AIQuotaError
from app.services import slack_service

router = APIRouter(prefix="/monitoring", tags=["Monitoring"])


def _z_score(value: float, mean: float, std: float) -> float:
    if std == 0:
        return 0.0
    return (value - mean) / std


DIMENSIONS = ("completeness", "uniqueness", "validity", "consistency", "overall")

# ── Linear breach projection ─────────────────────────────────────────────────
# A dimension is "breached" when its score is at or below BREACH_THRESHOLD (%).
# The projection fits a least-squares line to the last TREND_WINDOW points of
# each dimension (points are assumed evenly spaced) and extends it from the
# latest value. A dimension is reported only if that line reaches the threshold
# within PROJECTION_HORIZON_HOURS; a flat or rising trend yields no projection.
BREACH_THRESHOLD = 80.0
TREND_WINDOW = 14
MIN_TREND_POINTS = 3
PROJECTION_HORIZON_HOURS = 30 * 24


def _hours_per_point(series: list[dict]) -> float:
    """Median spacing between consecutive points, from their dates; 24h if unparseable."""
    stamps = []
    for point in series:
        try:
            stamps.append(datetime.fromisoformat(str(point.get("date"))))
        except ValueError:
            return 24.0
    try:
        gaps = [(b - a).total_seconds() / 3600 for a, b in zip(stamps, stamps[1:])]
    except TypeError:  # mixed naive/aware timestamps
        return 24.0
    gaps = [g for g in gaps if g > 0]
    return statistics.median(gaps) if gaps else 24.0


def _linear_slope(values: list[float]) -> float:
    """Least-squares slope of values against their index (change per point)."""
    n = len(values)
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n
    denominator = sum((i - x_mean) ** 2 for i in range(n))
    return sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values)) / denominator


def project_breach(series: list[dict], threshold: float = BREACH_THRESHOLD) -> dict | None:
    """Soonest projected threshold breach across dimensions, or None.

    A computed linear extrapolation, not a forecast model: see the constants above.
    """
    window = series[-TREND_WINDOW:]
    if len(window) < MIN_TREND_POINTS:
        return None
    hours_per_point = _hours_per_point(window)

    best: dict | None = None
    for dim in DIMENSIONS:
        values = [p.get(dim) for p in window]
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
            continue
        current = float(values[-1])
        slope = _linear_slope([float(v) for v in values])
        if current <= threshold:
            hours = 0.0
        elif slope >= 0:
            continue
        else:
            hours = (current - threshold) / -slope * hours_per_point
        if hours > PROJECTION_HORIZON_HOURS:
            continue
        if best is None or hours < best["predicted_breach_in_hours"]:
            best = {
                "dimension": dim,
                "method": "linear",
                "threshold": threshold,
                "window_points": len(window),
                "current_value": round(current, 2),
                "slope_per_day": round(slope / hours_per_point * 24, 3),
                "predicted_breach_in_hours": round(hours, 1),
                "already_breached": current <= threshold,
            }
    return best


def _detect_anomalies(series: list[dict], threshold: float = 2.5) -> list[dict]:
    """Z-score anomaly detection on quality dimensions.

    Each point is scored against the mean and standard deviation of the whole
    series for its dimension (not a rolling window), plus a single-step drop check.
    """
    dimensions = list(DIMENSIONS)
    anomalies = []
    for dim in dimensions:
        values = [p.get(dim) for p in series]
        # A dimension the series does not fully report is not scored (never read as 0).
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
            continue
        if len(values) < 3:
            continue
        mean = statistics.mean(values)
        std = statistics.stdev(values) if len(values) > 1 else 0
        for i, (point, val) in enumerate(zip(series, values)):
            z = _z_score(val, mean, std)
            if abs(z) > threshold:
                # Also check single-step drop
                prev_val = values[i - 1] if i > 0 else val
                drop = prev_val - val
                anomalies.append({
                    "date": point["date"],
                    "dimension": dim,
                    "value": round(val, 2),
                    "z_score": round(z, 2),
                    "drop": round(drop, 2),
                    "severity": "critical" if abs(z) > 3.5 else "warning",
                })
        # Also flag single-day drops > 10pp
        for i in range(1, len(values)):
            drop = values[i - 1] - values[i]
            if drop > 10:
                existing = [a for a in anomalies if a["date"] == series[i]["date"] and a["dimension"] == dim]
                if not existing:
                    anomalies.append({
                        "date": series[i]["date"],
                        "dimension": dim,
                        "value": round(values[i], 2),
                        "z_score": round(_z_score(values[i], mean, std), 2),
                        "drop": round(drop, 2),
                        "severity": "warning",
                    })
    return sorted(anomalies, key=lambda x: abs(x["z_score"]), reverse=True)


@router.post("/simulate-time-series")
async def simulate_time_series(body: dict = Body(...), org: OrganizationOut = Depends(get_current_org)):
    """
    DEMO DATASET. Generate a synthetic 30-day quality score time series from a
    baseline snapshot, with anomalies injected at days 22-26.

    Nothing here is measured. The response and every point carry `"demo": true`
    so the series stays identifiable wherever it is sent next: /monitoring/analyze
    sends no Slack or Datadog notification for it, and incidents raised from it
    are stored with source "demo". No other backend code reads this endpoint.
    """
    baseline = body.get("baseline", {})
    days = body.get("days", 30)
    seed = body.get("seed", 42)

    rng = random.Random(seed)
    start_completeness = baseline.get("completeness", 88.0)
    start_uniqueness = baseline.get("uniqueness", 94.0)
    start_validity = baseline.get("validity", 91.0)
    start_consistency = baseline.get("consistency", 87.0)

    today = datetime.now(timezone.utc)
    series = []

    for i in range(days):
        day = today - timedelta(days=(days - i - 1))
        date_str = day.strftime("%Y-%m-%d")

        # Random walk with drift
        noise = lambda: rng.gauss(0, 0.8)

        completeness = min(100, max(0, start_completeness + noise() * (i + 1) ** 0.3))
        uniqueness = min(100, max(0, start_uniqueness + noise() * 0.5))
        validity = min(100, max(0, start_validity + noise() * 0.7))
        consistency = min(100, max(0, start_consistency + noise() * 0.6))

        # Inject synthetic anomaly at day 22-26
        if 21 <= i <= 25:
            completeness -= rng.uniform(8, 18)
        if i == 27:
            uniqueness -= rng.uniform(5, 12)

        completeness = round(max(0, completeness), 2)
        uniqueness = round(max(0, uniqueness), 2)
        validity = round(max(0, validity), 2)
        consistency = round(max(0, consistency), 2)
        overall = round((completeness + uniqueness + validity + consistency) / 4, 2)

        series.append({
            "date": date_str,
            "completeness": completeness,
            "uniqueness": uniqueness,
            "validity": validity,
            "consistency": consistency,
            "overall": overall,
            "demo": True,
        })

    anomalies = _detect_anomalies(series)
    return {"demo": True, "series": series, "anomalies": anomalies}


@router.post("/analyze")
async def analyze_time_series(body: dict = Body(...), org: OrganizationOut = Depends(get_current_org)):
    """
    Receive a pre-computed quality time series and return anomalies, a computed
    linear breach projection, and an AI-worded alert.

    Body:
      series: list of {date, completeness, uniqueness, validity, consistency, overall}
      breach_threshold: float (optional, default BREACH_THRESHOLD)
      demo: bool (optional) the series is the demo dataset, not real measurements

    A demo series (`demo: true` in the body, or points marked by
    /monitoring/simulate-time-series) is analysed the same way but never sent to
    Slack or Datadog; the response repeats `demo`.

    The anomalies and the projection are computed here. The model only writes
    `alert_message` and `recommended_action`; if that call fails the computed
    results are still returned and `alert_error` says why the text is missing.
    """
    series: list[dict] = body.get("series", [])
    if not series:
        raise HTTPException(status_code=400, detail="series is required")
    try:
        breach_threshold = float(body.get("breach_threshold", BREACH_THRESHOLD))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="breach_threshold must be a number")

    demo = bool(body.get("demo")) or any(isinstance(p, dict) and p.get("demo") for p in series)

    anomalies = _detect_anomalies(series)
    projection = project_breach(series, breach_threshold)

    predictive_alert = None
    alert_error = None
    if anomalies:
        top = anomalies[0]
        predictive_alert = {
            "at_risk_dimension": projection["dimension"] if projection else top["dimension"],
            "severity": "critical" if any(a["severity"] == "critical" for a in anomalies) else "warning",
            "predicted_breach_in_hours": projection["predicted_breach_in_hours"] if projection else None,
            "alert_message": "",
            "recommended_action": "",
        }
        try:
            predictive_alert.update(await generate_predictive_alert(series, anomalies, projection))
        except AIQuotaError as exc:
            alert_error = str(exc)
        except Exception as exc:
            alert_error = f"AI alert text unavailable: {exc}"

        # Optionally send critical anomalies to Slack
        critical = [a for a in anomalies if a["severity"] == "critical"]
        if critical and predictive_alert["alert_message"] and not demo:
            most_critical = critical[0]
            try:
                await slack_service.send_critical_anomaly(
                    column=most_critical["dimension"],
                    metric=most_critical["dimension"],
                    drop=most_critical.get("drop", 0),
                    alert_message=predictive_alert["alert_message"],
                )
            except Exception:
                pass

    return {
        "demo": demo,
        "anomalies": anomalies,
        "anomaly_count": len(anomalies),
        "predictive_alert": predictive_alert,
        "alert_error": alert_error,
        "projection": projection,
        "breach_threshold": breach_threshold,
        "latest_scores": series[-1] if series else {},
    }
