"""Baseline scans: chunk failures are reported, never swallowed into an empty 'successful' scan."""
import json

import pytest

from app.models.repo_baseline import RepoBaseline, ScanSession
from app.services import ai_service, baseline_runner, baseline_store

TEST = {
    "name": "Login works", "description": "valid login", "category": "page", "severity": "high",
    "steps": [{"action": "navigate", "target": "/login", "value": None, "assertion": None}],
    "playwright_code": "test('x', async () => {});",
}


def _answer(*names: str) -> str:
    return json.dumps({"tests": [{**TEST, "name": name} for name in names]})


def _llm(monkeypatch, outcomes: dict):
    """Fake the single LLM entry point. `outcomes` maps a marker in the prompt to an answer or exception."""
    calls: list[str] = []

    async def run_llm(prompt, json_mode=True, timeout=None, system=None):
        for marker, outcome in outcomes.items():
            if marker in prompt:
                calls.append(marker)
                if isinstance(outcome, Exception):
                    raise outcome
                return outcome, 10, 20
        raise AssertionError("unexpected prompt")

    async def no_cost(*_a, **_k):
        return None

    monkeypatch.setattr(ai_service, "_run_llm", run_llm)
    monkeypatch.setattr(ai_service, "_log_cost", no_cost)
    return calls


async def test_failed_chunks_are_reported_alongside_the_tests_that_were_generated(monkeypatch):
    calls = _llm(monkeypatch, {
        "CHUNK-A": _answer("A1", "A2"),
        "CHUNK-B": RuntimeError("provider returned 500"),
        "CHUNK-C": _answer("C1"),
    })
    tests, failed = await ai_service.generate_baseline_tests(["CHUNK-A", "CHUNK-B", "CHUNK-C"], "sess")

    assert sorted(t["name"] for t in tests) == ["A1", "A2", "C1"]
    assert failed == [{"chunk": 2, "error": "provider returned 500"}]
    # One call per chunk: a failed call is not retried on top of the module's own retry policy.
    assert sorted(calls) == ["CHUNK-A", "CHUNK-B", "CHUNK-C"]


async def test_unparseable_answer_fails_that_chunk_after_the_single_plain_text_retry(monkeypatch):
    calls = _llm(monkeypatch, {"CHUNK-A": "I could not produce JSON, sorry", "CHUNK-B": _answer("B1")})
    tests, failed = await ai_service.generate_baseline_tests(["CHUNK-A", "CHUNK-B"], "sess")

    assert [t["name"] for t in tests] == ["B1"]
    assert failed[0]["chunk"] == 1 and "valid JSON" in failed[0]["error"]
    assert calls.count("CHUNK-A") == 2  # JSON mode, then the one non-JSON-mode retry of _call_openai_json


async def test_every_chunk_failing_raises_instead_of_returning_no_tests(monkeypatch):
    _llm(monkeypatch, {"CHUNK-A": RuntimeError("down"), "CHUNK-B": RuntimeError("down")})
    with pytest.raises(RuntimeError, match="down"):
        await ai_service.generate_baseline_tests(["CHUNK-A", "CHUNK-B"], "sess")

    _llm(monkeypatch, {"CHUNK-A": ai_service.AIQuotaError("rate limited")})
    with pytest.raises(ai_service.AIQuotaError):
        await ai_service.generate_baseline_tests(["CHUNK-A"], "sess")


async def test_a_model_that_finds_nothing_is_a_valid_empty_result(monkeypatch):
    _llm(monkeypatch, {"CHUNK-A": '{"tests": []}'})
    assert await ai_service.generate_baseline_tests(["CHUNK-A"], "sess") == ([], [])


async def test_incremental_generation_raises_on_bad_output_instead_of_returning_empty(monkeypatch):
    calls = _llm(monkeypatch, {"CHANGED": "not json at all"})
    with pytest.raises(ai_service.AIResponseError):
        await ai_service.generate_incremental_tests("CHANGED code", [], "sess")
    assert len(calls) == 2

    _llm(monkeypatch, {"CHANGED": '{"wrong": true}'})
    with pytest.raises(ai_service.AIResponseError, match="tests"):
        await ai_service.generate_incremental_tests("CHANGED code", [], "sess")


def test_dead_json_fixer_is_gone():
    assert not hasattr(ai_service, "_fix_json_response")


# ── the scan session records what happened ────────────────────────────────

@pytest.fixture
def _no_git(monkeypatch):
    monkeypatch.setattr(baseline_runner.repo_service, "clone_repo", lambda url, with_history=False: "/tmp/x")
    monkeypatch.setattr(baseline_runner.repo_service, "cleanup_repo", lambda path: None)
    monkeypatch.setattr(baseline_runner.repo_service, "extract_codebase", lambda path: "A" * 30_000)
    monkeypatch.setattr(baseline_runner.diff_service, "get_current_commit_sha", lambda path: "sha-new")


async def _scan(db, generate, monkeypatch):
    session = ScanSession(scan_type="full")
    await baseline_store.create_repo(
        db, "org-1", RepoBaseline(repo_id="repo-1", github_url="https://github.com/o/r", sessions=[session])
    )
    monkeypatch.setattr(baseline_runner, "generate_baseline_tests", generate)
    await baseline_runner.run_baseline_scan(db, "org-1", "repo-1", "https://github.com/o/r", session, None)
    return (await baseline_store.get_repo(db, "org-1", "repo-1")).sessions[0]


async def test_partial_scan_is_marked_partial_and_does_not_record_the_commit_as_scanned(db, monkeypatch, _no_git):
    async def generate(code_chunks, session_id):
        valid = ai_service._validate_ai_test(dict(TEST), session_id)
        return [valid], [{"chunk": 2, "error": "provider returned 500"}]

    session = await _scan(db, generate, monkeypatch)

    assert session.status == "done" and session.tests_added == 1
    assert session.chunks_total == 2
    assert session.chunks_failed == [{"chunk": 2, "error": "provider returned 500"}]
    assert "1 of 2" in session.progress_message
    baseline = await baseline_store.get_repo(db, "org-1", "repo-1")
    assert baseline.last_commit_sha == ""  # so the next scan covers the whole repo again


async def test_scan_fails_with_the_reason_when_generation_fails(db, monkeypatch, _no_git):
    async def generate(code_chunks, session_id):
        raise ai_service.AIResponseError("The AI model did not return valid JSON")

    session = await _scan(db, generate, monkeypatch)

    assert session.status == "failed"
    assert "valid JSON" in session.error
    assert (await baseline_store.get_repo(db, "org-1", "repo-1")).tests == []
