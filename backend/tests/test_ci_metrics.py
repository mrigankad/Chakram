"""One cached GitHub read and one pass-rate rule behind every page that shows CI numbers."""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.auth.session import create_session_cookie
from app.services import ci_metrics_service, github_service, organization_service

GET_RUNS = "app.services.github_service.get_workflow_runs"


def _runs(*conclusions) -> list[dict]:
    now = datetime.now(timezone.utc)
    return [
        {
            "id": i, "name": "CI", "status": "completed", "conclusion": conclusion,
            "created_at": (now - timedelta(hours=i)).isoformat().replace("+00:00", "Z"),
            "updated_at": now.isoformat(), "head_branch": "main", "head_sha": "abc1234",
            "run_number": i, "html_url": "https://github.com/o/r/actions/runs/1", "run_attempt": 1,
        }
        for i, conclusion in enumerate(conclusions)
    ]


async def _login(app_client, db, name="org_ci"):
    org = await organization_service.create_organization(db, workos_org_id=name, name=name)
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    return org


# ── the shared rule ───────────────────────────────────────────────────────

def test_pass_rate_is_over_evaluated_runs_only():
    summary = ci_metrics_service.summarise_runs(_runs("success", "success", "failure", "cancelled", None, "skipped"))
    assert summary["total_runs"] == 6
    assert summary["evaluated_runs"] == 3
    assert (summary["success_count"], summary["failure_count"], summary["cancelled_count"]) == (2, 1, 1)
    assert summary["pass_rate"] == 66.7 and summary["failure_rate"] == 33.3


def test_no_evaluated_runs_means_no_rate_not_zero():
    summary = ci_metrics_service.summarise_runs(_runs("cancelled", None))
    assert summary["pass_rate"] is None and summary["failure_rate"] is None
    assert ci_metrics_service.summarise_runs([])["pass_rate"] is None


def test_headline_covers_only_the_most_recent_runs():
    runs = _runs(*(["failure"] * ci_metrics_service.HEADLINE_RUNS + ["success"] * 20))
    assert ci_metrics_service.headline(runs)["pass_rate"] == 0.0
    assert ci_metrics_service.headline(runs)["total_runs"] == ci_metrics_service.HEADLINE_RUNS


def test_runs_with_unreadable_dates_are_left_out_of_windows():
    runs = _runs("success", "success")
    runs[1]["created_at"] = "not a date"
    assert len(ci_metrics_service.runs_within(runs, 7)) == 1


# ── every page reports the same number ────────────────────────────────────

async def test_all_pages_report_the_same_pass_rate_from_one_github_request(app_client, db):
    await _login(app_client, db)
    # 12 runs: differs between the old "10 most recent" and "all runs" rules, so a mismatch would show.
    fetched = _runs(*(["failure"] * 3 + ["success"] * 7 + ["cancelled", "success"]))
    fetch = AsyncMock(return_value=fetched)
    quiet_ai = AsyncMock(return_value={"recommendation": "ok"})
    with patch(GET_RUNS, new=fetch), \
         patch("app.routes.release_gate.analyze_release_readiness", new=quiet_ai), \
         patch("app.routes.pipeline.analyze_release_readiness", new=quiet_ai), \
         patch("app.routes.release_gate.slack_service.send_release_blocked", new=AsyncMock()):
        health = (await app_client.get("/api/ci/health", params={"owner": "o", "repo": "r"})).json()
        gate = (await app_client.post("/api/release-gate/evaluate", json={"owner": "o", "repo": "r"})).json()
        pipeline = (await app_client.post("/api/pipeline/report", json={"owner": "o", "repo": "r"})).json()
        proxied = (await app_client.get("/api/github/workflow-runs", params={"owner": "o", "repo": "r"})).json()

    expected = round(8 / 11 * 100, 1)
    assert health["summary"]["success_rate"] == expected
    assert gate["signals"]["test_pass_rate"] == expected
    assert pipeline["signals"]["ci_pass_rate"] == expected
    assert health["summary"]["failure_rate"] == round(3 / 11 * 100, 1)
    assert gate["signals"]["workflow_summary"] == pipeline["signals"]["workflow_summary"] == {
        "total_runs": 12, "recent_evaluated": 11,
    }
    assert len(proxied) == 12

    assert fetch.await_count == 1  # four page loads, one GitHub request
    assert health["cache"]["cached"] is False and gate["cache"]["cached"] is True


async def test_refresh_bypasses_the_cache_and_orgs_do_not_share_it(app_client, db):
    await _login(app_client, db, "org_one")
    fetch = AsyncMock(side_effect=[_runs("success"), _runs("failure"), _runs("failure", "failure")])
    with patch(GET_RUNS, new=fetch):
        params = {"owner": "o", "repo": "r"}
        first = (await app_client.get("/api/ci/health", params=params)).json()
        again = (await app_client.get("/api/ci/health", params=params)).json()
        fresh = (await app_client.get("/api/ci/health", params={**params, "refresh": "true"})).json()
        await _login(app_client, db, "org_two")
        other_org = (await app_client.get("/api/ci/health", params=params)).json()

    assert first["summary"]["success_rate"] == again["summary"]["success_rate"] == 100.0
    assert again["cache"]["cached"] is True
    assert fresh["summary"]["success_rate"] == 0.0 and fresh["cache"]["cached"] is False
    assert other_org["summary"]["total_runs"] == 2
    assert fetch.await_count == 3


async def test_expired_cache_entry_is_fetched_again(db):
    fetch = AsyncMock(side_effect=[["a"], ["b"]])
    first, _ = await ci_metrics_service.cached(db, "org", "k", "o", "r", "p", fetch, ttl_seconds=60)
    await db[ci_metrics_service.CACHE].update_many({}, {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}})
    second, info = await ci_metrics_service.cached(db, "org", "k", "o", "r", "p", fetch, ttl_seconds=60)
    assert (first, second) == (["a"], ["b"]) and info["cached"] is False


async def test_health_with_no_completed_runs_reports_null_rates(app_client, db):
    await _login(app_client, db)
    with patch(GET_RUNS, new=AsyncMock(return_value=_runs("cancelled", None))):
        health = (await app_client.get("/api/ci/health", params={"owner": "o", "repo": "r"})).json()
    assert health["summary"]["success_rate"] is None
    assert health["summary"]["evaluated_runs"] == 0 and health["summary"]["total_runs"] == 2


# ── GitHub rate limit ─────────────────────────────────────────────────────

def _limited_response() -> httpx.Response:
    return httpx.Response(
        403,
        headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000"},
        json={"message": "API rate limit exceeded for 1.2.3.4."},
        request=httpx.Request("GET", "https://api.github.com/repos/o/r/actions/runs"),
    )


def test_rate_limit_response_becomes_a_typed_error_with_the_reset_time():
    with pytest.raises(github_service.GitHubRateLimitError) as caught:
        github_service.raise_for_github_status(_limited_response(), authenticated=False)
    assert caught.value.reset_at == datetime.fromtimestamp(1893456000, tz=timezone.utc)
    assert "resets at" in caught.value.message and "GitHub token" in caught.value.message

    plain_403 = httpx.Response(
        403, json={"message": "Resource not accessible"},
        request=httpx.Request("GET", "https://api.github.com/repos/o/r"),
    )
    with pytest.raises(github_service.GitHubAPIError) as other:
        github_service.raise_for_github_status(plain_403, authenticated=True)
    assert not isinstance(other.value, github_service.GitHubRateLimitError)


@pytest.mark.parametrize("method,path,payload", [
    ("GET", "/api/ci/health", None),
    ("GET", "/api/ci/flaky-tests", None),
    ("GET", "/api/defect-prediction/risk-scores", None),
    ("GET", "/api/github/commits", None),
    ("POST", "/api/release-gate/evaluate", {"owner": "o", "repo": "r"}),
    ("POST", "/api/pipeline/report", {"owner": "o", "repo": "r"}),
])
async def test_github_rate_limit_is_a_429_with_the_reset_time(app_client, db, method, path, payload):
    await _login(app_client, db)
    limited = github_service.GitHubRateLimitError(datetime.fromtimestamp(1893456000, tz=timezone.utc), False)
    with patch(GET_RUNS, new=AsyncMock(side_effect=limited)), \
         patch("app.services.github_service.get_commits", new=AsyncMock(side_effect=limited)):
        if method == "GET":
            resp = await app_client.get(path, params={"owner": "o", "repo": "r"})
        else:
            resp = await app_client.post(path, json=payload)

    assert resp.status_code == 429
    body = resp.json()
    assert body["source"] == "github" and body["reset_at"] == "2030-01-01T00:00:00+00:00"
    assert "rate limit" in body["detail"].lower()
    assert resp.headers["x-ratelimit-reset"] == "1893456000"


async def test_unknown_repository_is_a_404_not_a_400(app_client, db):
    await _login(app_client, db)
    # The message is the one raise_for_github_status builds for an anonymous 404.
    missing = github_service.GitHubAPIError(
        404, github_service.describe_github_error(404, "/repos/o/nope/actions/runs", "Not Found", False)
    )
    with patch(GET_RUNS, new=AsyncMock(side_effect=missing)):
        resp = await app_client.get("/api/ci/health", params={"owner": "o", "repo": "nope"})
    detail = resp.json()["detail"]
    assert resp.status_code == 404 and "o/nope" in detail and "private" in detail and "/repos/" not in detail


# ── defect prediction ─────────────────────────────────────────────────────

def _commits(n: int) -> list[dict]:
    return [
        {"sha": f"{i:040x}", "message": "fix: bug" if i % 2 else "feat: thing", "author": f"dev{i % 3}",
         "date": "2026-01-01T00:00:00Z", "files": []}
        for i in range(n)
    ]


async def test_defect_prediction_fetches_commits_concurrently_and_counts_what_it_read(app_client, db):
    await _login(app_client, db)
    in_flight = {"now": 0, "peak": 0}

    async def detail(owner, repo, sha):
        in_flight["now"] += 1
        in_flight["peak"] = max(in_flight["peak"], in_flight["now"])
        await asyncio.sleep(0.01)
        in_flight["now"] -= 1
        if sha.endswith("3"):
            raise github_service.GitHubAPIError(500, "GitHub returned 500")
        return {"files": [{"filename": "app/core.py", "additions": 5, "deletions": 1}]}

    fetch_detail = AsyncMock(side_effect=detail)
    with patch("app.services.github_service.get_commits", new=AsyncMock(return_value=_commits(8))) as list_commits, \
         patch("app.services.github_service.get_commit_detail", new=fetch_detail), \
         patch("app.services.github_service.commit_detail_budget", return_value=8), \
         patch("app.routes.defect_prediction.generate_defect_risk_narrative", new=AsyncMock(side_effect=RuntimeError("model down"))):
        params = {"owner": "o", "repo": "r"}
        first = (await app_client.get("/api/defect-prediction/risk-scores", params=params)).json()
        calls_after_first = fetch_detail.await_count
        second = (await app_client.get("/api/defect-prediction/risk-scores", params=params)).json()

    assert 1 < in_flight["peak"] <= ci_metrics_service.GITHUB_CONCURRENCY
    assert first["total_commits"] == 8
    assert first["total_commits_analysed"] == 7  # the number actually read, not a constant
    assert [c["sha"] for c in first["commits_failed"]] == ["0000000"]
    assert first["files"][0]["filename"] == "app/core.py" and first["files"][0]["change_count"] == 7
    assert first["narrative"] is None and "model down" in first["narrative_error"]

    # Second load: commit list and the 7 readable commits come from the cache; only the failed one is retried.
    assert calls_after_first == 8 and fetch_detail.await_count == 9
    assert list_commits.await_count == 1
    assert second["cache"]["cached"] is True and second["files"] == first["files"]


async def test_defect_prediction_with_no_readable_commit_is_an_error_not_an_empty_result(app_client, db):
    await _login(app_client, db)
    with patch("app.services.github_service.get_commits", new=AsyncMock(return_value=_commits(3))), \
         patch("app.services.github_service.get_commit_detail",
               new=AsyncMock(side_effect=github_service.GitHubAPIError(500, "GitHub returned 500"))):
        resp = await app_client.get("/api/defect-prediction/risk-scores", params={"owner": "o", "repo": "r"})
    assert resp.status_code == 502
    assert "Could not read any" in resp.json()["detail"]
