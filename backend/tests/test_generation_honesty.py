"""Generators return what the model produced or an error: no default counts, confidences or placeholder files."""
import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest

from app.routes import ci_intelligence
from app.services import ai_service, copilot_service, prd_service, test_gen_service, workspace_service
from app.services.ai_service import AIQuotaError, AIResponseError


def _answers(monkeypatch, module, payload):
    async def _call(prompt, json_mode=False, **_kwargs):
        return payload if isinstance(payload, str) else json.dumps(payload)

    monkeypatch.setattr(module, "_call_openai", _call)


# ── copilot ───────────────────────────────────────────────────────────────

async def test_suggestion_confidence_is_the_models_own_or_absent(monkeypatch):
    _answers(monkeypatch, copilot_service, {"modified": "x = 2\n", "confidence": 0.62})
    assert (await copilot_service.suggest_code("a.py", "x = 1\n", "bump", []))["confidence"] == 0.62

    _answers(monkeypatch, copilot_service, {"modified": "x = 2\n"})
    assert (await copilot_service.suggest_code("a.py", "x = 1\n", "bump", []))["confidence"] is None
    assert (await copilot_service.add_comments("a.py", "x = 1\n"))["confidence"] is None


async def test_answer_without_a_rewritten_file_is_an_error_not_the_original_echoed_back(monkeypatch):
    _answers(monkeypatch, copilot_service, {"explanation": "I would change x"})
    with pytest.raises(AIResponseError, match="no modified file content"):
        await copilot_service.suggest_code("a.py", "x = 1\n", "bump", [])
    with pytest.raises(AIResponseError):
        await copilot_service.add_comments("a.py", "x = 1\n")

    _answers(monkeypatch, copilot_service, {"key_points": []})
    with pytest.raises(AIResponseError, match="no explanation"):
        await copilot_service.explain_code("a.py", "x = 1\n")


async def test_workspace_suggestion_drops_entries_that_carry_no_content(monkeypatch, tmp_path):
    (tmp_path / "app.py").write_text("x = 1\n", encoding="utf-8")
    workspace_service._WORKSPACES["ws_h"] = {"workspace_id": "ws_h", "org_id": "org_a", "clone_dir": str(tmp_path)}
    try:
        _answers(monkeypatch, copilot_service, {"files": [
            {"file_path": "app.py", "modified": "x = 2\n"},
            {"file_path": "other.py"},  # would have blanked the file
            "not an object",
        ]})
        result = await copilot_service.suggest_workspace("ws_h", "bump", [], ["app.py"], org_id="org_a")
    finally:
        workspace_service._WORKSPACES.pop("ws_h", None)
    assert [f["file_path"] for f in result["files"]] == ["app.py"]


async def test_empty_prd_is_an_error(monkeypatch):
    _answers(monkeypatch, prd_service, {"unrelated": True})
    with pytest.raises(AIResponseError, match="empty PRD"):
        await prd_service.generate_prd("Product", "Description")


# ── test generation ───────────────────────────────────────────────────────

async def test_unit_test_generation_without_file_content_is_an_error_not_a_stub_file(monkeypatch):
    monkeypatch.setattr(test_gen_service, "_call_openai_json", AsyncMock(return_value={"tests": []}))
    with pytest.raises(AIResponseError, match="no test file content"):
        await test_gen_service.generate_tests("w", "app/core.py", "def f(): pass\n", [])


def _files(*names):
    return [{"file_path": name, "content": "export default function X() {}"} for name in names]


async def test_batch_generation_runs_files_concurrently_and_names_the_ones_that_failed(monkeypatch):
    in_flight = {"now": 0, "peak": 0}

    async def generate(file_path, content, target_url=None):
        in_flight["now"] += 1
        in_flight["peak"] = max(in_flight["peak"], in_flight["now"])
        await asyncio.sleep(0.02)
        in_flight["now"] -= 1
        if file_path == "b.tsx":
            raise AIResponseError("The AI model did not return valid JSON")
        return [{"name": f"test for {file_path}"}]

    monkeypatch.setattr(test_gen_service, "generate_playwright_tests_from_source", generate)
    result = await test_gen_service.generate_playwright_tests_batch(_files("a.tsx", "b.tsx", "c.tsx"))

    assert in_flight["peak"] == 3
    assert [t["name"] for t in result["tests"]] == ["test for a.tsx", "test for c.tsx"]
    assert result["failed_files"] == [{"file_path": "b.tsx", "error": "The AI model did not return valid JSON"}]


async def test_batch_generation_raises_when_every_file_failed(monkeypatch):
    monkeypatch.setattr(test_gen_service, "generate_playwright_tests_from_source",
                        AsyncMock(side_effect=AIQuotaError("rate limited")))
    with pytest.raises(AIQuotaError):
        await test_gen_service.generate_playwright_tests_batch(_files("a.tsx", "b.tsx"))

    monkeypatch.setattr(test_gen_service, "generate_playwright_tests_from_source",
                        AsyncMock(side_effect=RuntimeError("connection reset")))
    with pytest.raises(AIResponseError, match="connection reset"):
        await test_gen_service.generate_playwright_tests_batch(_files("a.tsx"))


async def test_chain_analysis_gives_no_invented_count_for_files_the_model_skipped(monkeypatch, tmp_path):
    for name in ("root.tsx", "leaf.tsx"):
        (tmp_path / name).write_text("export const x = 1;\n", encoding="utf-8")
    workspace_service._WORKSPACES["ws_c"] = {"workspace_id": "ws_c", "org_id": "org_a", "clone_dir": str(tmp_path)}
    answer = {"analyses": [
        {"file_path": "leaf.tsx", "summary": "s", "changes_description": "c", "suggested_count": 4, "reason": "r"},
        {"file_path": "invented.tsx", "summary": "s", "changes_description": "c", "suggested_count": 9, "reason": "r"},
    ]}
    try:
        monkeypatch.setattr(test_gen_service, "_call_openai_json", AsyncMock(return_value=answer))
        result = await test_gen_service.analyze_chain_for_tests("ws_c", ["root.tsx", "leaf.tsx"], ["leaf.tsx"], org_id="org_a")

        monkeypatch.setattr(test_gen_service, "_call_openai_json", AsyncMock(return_value={"analyses": []}))
        with pytest.raises(AIResponseError, match="no analysis"):
            await test_gen_service.analyze_chain_for_tests("ws_c", ["root.tsx", "leaf.tsx"], [], org_id="org_a")
    finally:
        workspace_service._WORKSPACES.pop("ws_c", None)

    assert [a["file_path"] for a in result] == ["root.tsx", "leaf.tsx"]
    assert result[0]["analysed"] is False and result[0]["suggested_count"] == 0
    assert result[1]["analysed"] is True and result[1]["suggested_count"] == 4


# ── CI failure explanation ────────────────────────────────────────────────

async def test_run_without_logs_is_reported_unavailable_without_calling_the_model():
    explain = AsyncMock()
    with patch.object(ci_intelligence.github_service, "get_run_logs_text", new=AsyncMock(return_value="")), \
         patch.object(ci_intelligence, "explain_ci_failure", new=explain):
        result = await ci_intelligence.explain_workflow_run("o", "r", 1)

    assert result["available"] is False
    assert result["confidence"] is None and result["is_flaky_candidate"] is None and result["fix"] == ""
    explain.assert_not_awaited()


async def test_run_with_logs_is_explained_from_them():
    answer = {"explanation": "pytest failed", "fix": "fix the import", "category": "test", "confidence": 0.8,
              "is_flaky_candidate": False}
    explain = AsyncMock(return_value=answer)
    with patch.object(ci_intelligence.github_service, "get_run_logs_text",
                      new=AsyncMock(return_value="step ok\n##[error] ImportError: no module x\n")), \
         patch.object(ci_intelligence.github_service, "get_repo_languages", new=AsyncMock(return_value={"Python": 9})), \
         patch.object(ci_intelligence, "explain_ci_failure", new=explain):
        result = await ci_intelligence.explain_workflow_run("o", "r", 1)

    assert result == {"available": True, **answer}
    step, error_message, _logs, language = explain.await_args.args
    assert "ImportError" in step and "ImportError" in error_message and language == "Python"


def test_unused_llm_ranking_function_is_gone():
    assert not hasattr(ai_service, "prioritize_tests")


