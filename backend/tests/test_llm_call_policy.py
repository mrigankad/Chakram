"""LLM call policy: timeout default, a single retry layer, and bounded concurrency."""
import asyncio
import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import openai
import pytest

from app.config import settings
from app.services import ai_service

_REQUEST = httpx.Request("POST", "http://llm.test/v1/chat/completions")


def _status_error(cls, status: int, message: str = "provider error"):
    return cls(message, response=httpx.Response(status, request=_REQUEST), body=None)


def _ok_response(content: str = "hello"):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=3, completion_tokens=4),
    )


@pytest.fixture
def llm(monkeypatch):
    """A fake client plus the list of backoff sleeps the retry loop asked for."""
    client = MagicMock()
    sleeps: list[float] = []
    monkeypatch.setattr(ai_service, "_get_client", lambda: client)
    monkeypatch.setattr(ai_service, "_ollama_cfg", lambda: ("http://llm.test", "k", "m"))
    monkeypatch.setattr(ai_service.time, "sleep", sleeps.append)
    return client, sleeps


# ── client construction and timeout ───────────────────────────────────────

def test_client_disables_sdk_retries_and_uses_the_configured_timeout(monkeypatch):
    monkeypatch.setattr(settings, "LLM_TIMEOUT_SECONDS", 45.0)
    client = ai_service._get_client()
    assert client.max_retries == 0
    assert client.timeout == 45.0


def test_timeout_defaults_to_the_setting(llm, monkeypatch):
    client, _ = llm
    monkeypatch.setattr(settings, "LLM_TIMEOUT_SECONDS", 33.0)
    client.chat.completions.create.return_value = _ok_response()

    ai_service._call_openai_sync("p", json_mode=False)
    assert client.chat.completions.create.call_args.kwargs["timeout"] == 33.0


def test_explicit_timeout_wins_over_the_setting(llm, monkeypatch):
    client, _ = llm
    monkeypatch.setattr(settings, "LLM_TIMEOUT_SECONDS", 33.0)
    client.chat.completions.create.return_value = _ok_response()

    ai_service._call_openai_sync("p", json_mode=False, timeout=70.0)
    assert client.chat.completions.create.call_args.kwargs["timeout"] == 70.0


def test_default_settings():
    assert type(settings).model_fields["LLM_TIMEOUT_SECONDS"].default == 120.0
    assert type(settings).model_fields["LLM_MAX_CONCURRENCY"].default == 4


# ── retry loop ────────────────────────────────────────────────────────────

def test_rate_limit_is_retried_then_succeeds(llm):
    client, sleeps = llm
    client.chat.completions.create.side_effect = [
        _status_error(openai.RateLimitError, 429),
        _ok_response("after retry"),
    ]
    content, prompt_tokens, completion_tokens = ai_service._call_openai_sync("p", json_mode=False)
    assert (content, prompt_tokens, completion_tokens) == ("after retry", 3, 4)
    assert client.chat.completions.create.call_count == 2
    assert sleeps == [ai_service._RETRY_DELAYS[0]]


def test_rate_limit_gives_up_after_two_retries_with_quota_error(llm):
    client, sleeps = llm
    client.chat.completions.create.side_effect = _status_error(openai.RateLimitError, 429)

    with pytest.raises(ai_service.AIQuotaError):
        ai_service._call_openai_sync("p", json_mode=False)
    assert client.chat.completions.create.call_count == 3  # one call + at most 2 retries
    assert len(sleeps) == 2
    assert sum(sleeps) <= 10


def test_connection_error_is_retried_then_raised_unchanged(llm):
    client, sleeps = llm
    error = openai.APIConnectionError(request=_REQUEST)
    client.chat.completions.create.side_effect = error

    with pytest.raises(openai.APIConnectionError) as raised:
        ai_service._call_openai_sync("p", json_mode=False)
    assert raised.value is error
    assert client.chat.completions.create.call_count == 3
    assert len(sleeps) == 2


def test_connection_error_recovers_on_retry(llm):
    client, _ = llm
    client.chat.completions.create.side_effect = [
        openai.APIConnectionError(request=_REQUEST),
        _ok_response("ok"),
    ]
    assert ai_service._call_openai_sync("p", json_mode=False)[0] == "ok"


def test_timeout_is_not_retried(llm):
    client, sleeps = llm
    client.chat.completions.create.side_effect = openai.APITimeoutError(request=_REQUEST)

    with pytest.raises(openai.APITimeoutError):
        ai_service._call_openai_sync("p", json_mode=False)
    assert client.chat.completions.create.call_count == 1
    assert sleeps == []


@pytest.mark.parametrize(
    "error",
    [
        _status_error(openai.InternalServerError, 500),
        _status_error(openai.BadRequestError, 400),
        _status_error(openai.AuthenticationError, 401),
        ValueError("unexpected"),
    ],
)
def test_other_errors_are_not_retried(llm, error):
    client, sleeps = llm
    client.chat.completions.create.side_effect = error

    with pytest.raises(type(error)):
        ai_service._call_openai_sync("p", json_mode=False)
    assert client.chat.completions.create.call_count == 1
    assert sleeps == []


# ── _is_quota_error ───────────────────────────────────────────────────────

def test_quota_detection_uses_type_and_status_code_first():
    assert ai_service._is_quota_error(_status_error(openai.RateLimitError, 429))
    assert ai_service._is_quota_error(ai_service.AIQuotaError("x"))
    assert ai_service._is_quota_error(_status_error(openai.APIStatusError, 429, "slow down"))
    # The status code decides, even when the message mentions 429 or a quota.
    assert not ai_service._is_quota_error(
        _status_error(openai.InternalServerError, 500, "upstream said 429 quota exceeded")
    )


@pytest.mark.parametrize(
    "message",
    [
        "Error code: 429 - {'error': 'too many requests'}",
        "HTTP status 429",
        "Rate limit reached for model",
        "You exceeded your current quota",
        "quota exceeded for this key",
    ],
)
def test_quota_detection_text_fallback_matches_real_quota_messages(message):
    assert ai_service._is_quota_error(RuntimeError(message))


@pytest.mark.parametrize(
    "message",
    [
        "file src/page429.tsx could not be parsed",
        "expected 1429 tokens, got 12",
        "Connection reset by peer on port 4290",
        "The requirement mentions a disk quota feature",
        "model not found",
    ],
)
def test_quota_detection_text_fallback_ignores_incidental_text(message):
    assert not ai_service._is_quota_error(RuntimeError(message))


# ── concurrency bound ─────────────────────────────────────────────────────

async def test_concurrent_llm_calls_are_bounded_by_the_setting(monkeypatch):
    monkeypatch.setattr(settings, "LLM_MAX_CONCURRENCY", 2)
    lock = threading.Lock()
    state = {"active": 0, "peak": 0}

    def fake_sync(prompt, json_mode=True, timeout=None, system=None):
        with lock:
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
        time.sleep(0.05)
        with lock:
            state["active"] -= 1
        return prompt, 0, 0

    monkeypatch.setattr(ai_service, "_call_openai_sync", fake_sync)

    results = await asyncio.gather(*(ai_service._run_llm(f"p{i}", False) for i in range(8)))
    assert [r[0] for r in results] == [f"p{i}" for i in range(8)]
    assert state["peak"] == 2


async def test_call_openai_goes_through_the_bound_and_still_logs_usage(monkeypatch):
    monkeypatch.setattr(settings, "LLM_MAX_CONCURRENCY", 1)
    lock = threading.Lock()
    state = {"active": 0, "peak": 0}
    logged: list[tuple] = []

    def fake_sync(prompt, json_mode=True, timeout=None, system=None):
        with lock:
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
        time.sleep(0.02)
        with lock:
            state["active"] -= 1
        return "text", 5, 7

    async def fake_log(task_name, prompt_tokens, completion_tokens, extra=None):
        logged.append((task_name, prompt_tokens, completion_tokens))

    monkeypatch.setattr(ai_service, "_call_openai_sync", fake_sync)
    monkeypatch.setattr(ai_service, "_log_cost", fake_log)

    out = await asyncio.gather(*(ai_service.call_ai("p") for _ in range(4)))
    await asyncio.sleep(0)  # let the fire-and-forget log tasks run
    assert out == ["text"] * 4
    assert state["peak"] == 1
    assert logged == [(ai_service._TASK_LABELS["call_ai"], 5, 7)] * 4


async def test_a_failed_call_releases_its_slot(monkeypatch):
    monkeypatch.setattr(settings, "LLM_MAX_CONCURRENCY", 1)
    calls = {"n": 0}

    def fake_sync(prompt, json_mode=True, timeout=None, system=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")
        return "ok", 0, 0

    monkeypatch.setattr(ai_service, "_call_openai_sync", fake_sync)

    with pytest.raises(RuntimeError):
        await ai_service._run_llm("p", False)
    assert (await asyncio.wait_for(ai_service._run_llm("p", False), timeout=5))[0] == "ok"
