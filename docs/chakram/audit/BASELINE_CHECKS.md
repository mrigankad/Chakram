# Baseline checks

Revision: `3c2dbb424ba3d4f71e8521925b49bc901505094b` (branch `claude/dazzling-mendel-wckwjs`, same tree as `main` HEAD on 2026-10-16).
Environment: Linux cloud container, Python 3.12.3 via `uv venv`, Node v22.22.0 (CI uses Node 20), no MongoDB, no Ollama, no Playwright browsers installed. Dependencies were not checked in; both toolchains were installed from the lockfiles.

| Check | Command (from repo root) | Result | Notes |
| --- | --- | --- | --- |
| Backend install | `cd backend && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt` | Passed | Resolves cleanly from `backend/requirements.txt`. |
| Backend tests | `cd backend && .venv/bin/python -m pytest -q` | 577 passed, 4 failed, 1 skipped (18.3 s) | The 4 failures are in `tests/test_git_push_endpoint.py` and are environmental: this container exports `GITHUB_TOKEN`, so the "no token configured" branch is never taken. Re-run with `env -u GITHUB_TOKEN -u GH_TOKEN` → 39/39 pass in that file. Treat the suite as green. |
| Backend test hygiene | same run | Warning | One `Task was destroyed but it is pending` from `app/engines/generator.py:143` (`_schedule_usage_log`) with a `ContextVar` reset error at `ai_service.py:37`. Not a test failure, but it shows the usage log task is fire-and-forget and can outlive its context. See GAP-14. |
| Frontend install | `cd frontend && npm ci` | Passed | |
| Typecheck | `cd frontend && npx tsc --noEmit -p tsconfig.app.json` | Passed | |
| Unit tests | `cd frontend && npm run test` | 501 passed in 15 files (6.8 s) | All tests are pure-function tests under `src/lib/*.test.ts` plus one example; no component or page tests. |
| Production build | `cd frontend && npm run build` | Passed (20 s) | Main chunk 865 kB (257 kB gzip); LiveTestRunner 531 kB; Workspace 327 kB; AiIde 203 kB. Vite warns about chunks over 500 kB. |
| Lint | `cd frontend && npm run lint` | Failed: 87 errors, 37 warnings | 87 × `no-explicit-any`, 28 × `react-refresh/only-export-components`, 9 × `react-hooks/exhaustive-deps`. CI runs lint as non-blocking (`.github/workflows/ci.yml`). |
| Vercel entrypoint import | `cd api && pip install -r ../requirements.txt && python -c "import index"` | Not run | Would need a second venv with only the root `requirements.txt`; CI covers it. |
| Backend start | `uvicorn main:app` | Not run | No MongoDB in this container. Startup is tolerant of a missing DB (`app/database.py`, logged non-fatal) but every data route would 500. |
| Browser smoke (login → dashboard) | — | Blocked | Needs MongoDB + seeded user + Ollama. Not available here. |
| Test Execution / Live Test Run | — | Blocked | Needs Playwright Chromium (`python -m playwright install chromium`) and a target URL. |
| App Builder generation | — | Blocked | Needs Ollama (local or cloud key). Pipeline logic is covered by `backend/tests/test_ai_ide_generation.py` with a fake model. |

## What this establishes

- A clean checkout builds and its deterministic checks pass on both sides. The only red check is lint, which the repo already treats as advisory.
- Nothing above exercises a real LLM, GitHub, Jira, Vercel, Datadog, Slack, or a browser. Every feature that depends on those is **Unverified at runtime** in `FEATURE_MATRIX.md` unless a unit test with a fake proves the control flow.
- Acceptance checklist coverage from this run: AUD 01, AUD 02, AUD 03 (partial: starts in CI with Mongo; not started here), AUD 04 Passed. AUD 05/AUD 06 are addressed by `FEATURE_MATRIX.md` with Unverified where no runtime evidence exists.
