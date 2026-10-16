# Check results

Statuses: Passed, Failed, Not run, Blocked, Waived (with an authorised reason). Every row records the exact revision and environment.

| Check ID | Milestone | Status | Revision | Environment | Command / steps | Expected | Observed | Evidence | Date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD 01 | M1 | Passed | 3c2dbb4 | cloud container, Linux | `git status`, `git log`, read CLAUDE.md and handoff docs | Instructions and git state recorded, user work preserved | Clean tree on `claude/dazzling-mendel-wckwjs` = `main`; only docs added | `audit/CURRENT_STATE.md` §1 | 2026-10-16 |
| AUD 02 | M1 | Passed | 3c2dbb4 | same | inventory by file (3 audits) | Components map to real files and commands | 34 routers, 32 pages, 40 services mapped | `audit/ARCHITECTURE_MAP.md` | 2026-10-16 |
| AUD 03 | M1 | Passed (build) / Blocked (start) | 3c2dbb4 | Python 3.12.3, Node 22.22 | `uv venv` + `uv pip install`, `npm ci`, `npm run build` | Clean checkout starts the product | Installs and builds; server start needs MongoDB which is absent here | `audit/BASELINE_CHECKS.md` | 2026-10-16 |
| AUD 04 | M1 | Passed | 3c2dbb4 | same | `pytest -q`; `tsc`; `vitest`; `npm run lint` | Defects distinguished from missing tooling | 4 pytest failures traced to sandbox `GITHUB_TOKEN`; lint 87 errors pre-existing | `audit/BASELINE_CHECKS.md` | 2026-10-16 |
| AUD 05 | M1 | Passed | 3c2dbb4 | same | matrix + gap register | Runtime evidence or Unverified per row | Every row carries file evidence and runtime evidence or Unverified | `audit/FEATURE_MATRIX.md`, `audit/GAP_REGISTER.md` | 2026-10-16 |
| AUD 06 | M1 | Partial | 3c2dbb4 | same | GitHub, preview, themes, model paths read and unit-tested only | Exercised or explicitly Unverified | Explicitly Unverified for live GitHub/LLM/preview; control flow covered by fakes | `audit/FEATURE_MATRIX.md` §A | 2026-10-16 |
| REL 01 | M1 | Partial | 3c2dbb4 | same | type, unit, build | Actual results | tsc pass, 1,078 unit tests pass, build pass; integration and browser checks Blocked (no services) | `audit/BASELINE_CHECKS.md` | 2026-10-16 |
| SEC 01 | M1 | Failed (file evidence) | 3c2dbb4 | same | grep for credential handling in prompts and URLs | No secret in source, bundles, logs, prompts | Test credentials interpolated into an LLM prompt (`ai_service.py:574-582`); PAT accepted as query param (`github.py:123`); App Studio token in localStorage (`AiIde.tsx:69,859`). No secret values found in source. | `audit/GAP_REGISTER.md` GAP-01, GAP-02 | 2026-10-16 |
| All other checks | — | Not run | — | — | — | — | Need Mongo, Ollama, Chromium, GitHub, Jira, Vercel or a deployed environment | — | 2026-10-16 |
