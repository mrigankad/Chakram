# Chakram: current state

Date: 2026-10-16. Revision `3c2dbb4` (branch `claude/dazzling-mendel-wckwjs`, identical to `main` HEAD). Evidence is file-based unless a line says "runtime". Runtime evidence in this container is limited to the deterministic checks in `BASELINE_CHECKS.md`; no MongoDB, LLM, browser, GitHub, Jira, Vercel, Datadog or Slack was reachable.

## 1. What Chakram is, as built

Chakram is two products in one repository that share a login, a sidebar and a MongoDB:

1. **A delivery-quality platform** (29 pages): requirement → LLM-generated test cases → real-browser execution → risk ranking → dashboard, plus repo-driven Playwright generation, PR review, CI health, defect hotspots, release gate, sprint/Jira summaries, incidents and a demo-only metric-anomaly page. It was built feature by feature over August–October 2026 (see `docs/superpowers/plans/*`) and has grown five test generators, two browser execution engines and four deploy entry points.
2. **App Studio** (`/ai-ide`): a Lovable-style builder that plans and streams a React + Vite + Tailwind app from a description, ships the Chronos UI kit inside each app, previews it in a sandboxed iframe, lets the user edit code, text, classes and theme, and pushes to GitHub and Vercel. It is the part the owner wants to invest in. Generated apps are frontend-only with mock data; there is no API, data or auth layer in them.

## 2. Stack and topology (actual)

| Layer | Actual | Evidence |
| --- | --- | --- |
| Frontend | React 18.3, TypeScript, Vite 5, Tailwind 3.4, shadcn/ui (50 files, 21 unused), TanStack Query, react-router 6, Recharts, Monaco, Sigma/graphology, @xyflow/react | `frontend/package.json` (72 deps + 25 dev), `src/App.tsx:63-104` (33 routes, 32 pages) |
| Backend | FastAPI 0.135, Motor 3.7 on MongoDB, Pydantic v2, OpenAI SDK 2.26 pointed at an Ollama-compatible endpoint, Playwright 1.61, GitPython + `git` CLI | `backend/requirements.txt`, `backend/main.py` (34 routers under `/api`) |
| Auth | Cookie session (`aidlc_session`), seeded local account, optional WorkOS AuthKit, org-scoped data via `get_current_org` | `backend/app/routes/auth.py`, `app/auth/*`, `docs/superpowers/specs/2026-08-18-auth-multitenancy-design.md` |
| LLM | One provider: Ollama (local or `https://ollama.com`), model from `OLLAMA_MODEL`. 36 completion call sites; all send one `user` message, no system prompt (except the App Studio file generator), no prompt caching, `reasoning_effort: low` in JSON mode, 2 retries on 429/connection errors, no retry on timeout | `backend/app/services/ai_service.py:131-170,223-237`; `app/engines/generator.py:249-271` |
| Data | 30+ Mongo collections created on demand, no migrations. Key ones: `requirements`, `test_cases`, `test_runs`/`test_results`/`test_plans` (Test Execution), `playwright_tests`/`playwright_runs` (repo analysis engine), `repo_baselines`, `workspaces`, `ai_ide_workspaces`/`ai_ide_files`, `api_cost_logs`, `organizations`, `users` | `ARCHITECTURE_MAP.md` §4 |
| Runtime | One process. Long jobs are `BackgroundTasks` or in-process `asyncio` tasks (App Studio runs live in a dict). Azure Container Apps image runs `--workers 1` for that reason | `Dockerfile` (CMD), `app/services/ai_ide_generation.py:73-188`, `ARCHITECTURE_MAP.md` §5 |
| Deploy | Root `Dockerfile` (SPA + API + Chromium) to Azure Container Apps via `infra/azure/deploy.sh`; alternatively Vercel serverless (`api/index.py`, no Playwright). Generated apps deploy to Vercel via `vercel_service` | `infra/azure/README.md`, `vercel.json`, `app/services/vercel_service.py:286-360` |
| CI | GitHub Actions: frontend typecheck + vitest + build (lint non-blocking), backend pytest, Vercel entrypoint import | `.github/workflows/ci.yml` |

## 3. One representative request, traced

**"Build me a clinic appointments app" in App Studio** (`frontend/src/pages/AiIde.tsx` → `POST /ai-ide/workspace/create` → WebSocket `/ai-ide/ws/generate/{id}`):

1. `ai_ide_service.create_workspace` writes the 37-file template (14 base files + 22 Chronos kit files + `design.css`) to disk and mirrors every file to `ai_ide_files` (`template_service.py:338-350`, `ai_ide_service.py:193-244`).
2. `ai_ide_generation.start` creates an in-process run. **Planner**: one LLM call, ~1.5K prompt tokens (3.1K-char prompt + 60 relevant 3D icon hints + idea). No schema validation; `_parse_json_object` picks the first balanced JSON (`planner.py:79-98`, `ai_service.py:301-330`).
3. `_wire_routes` rewrites `src/App.tsx` markers with the full nav before any page exists (`ai_ide_generation.py:280-303`, `injector.py:57-94`).
4. **Files**: the shared data file runs first, then pages run three at a time. Each file is one streaming LLM call carrying the full 13.6 KB `KIT_API.md`, 30 icon hints, up to 14 KB of previously written files and the rules; `max_tokens=8000`, `temperature=0.3`, no retry, no compile check (`generator.py:80-111,184-271`). Fences are stripped; JSX in a `.ts` file renames it to `.tsx`; an empty or failed file emits `FILE_ERROR` and is not written.
5. **Preview**: the browser compiles the workspace with Sucrase from esm.sh, pulls packages from esm.sh at pinned versions and Tailwind from the Play CDN, shims `react-router-dom` to a MemoryRouter, and stands in for unwritten files with stubs (`preview-runtime.js`). No TypeScript errors are surfaced; after the run, the client sends up to four `/copilot/suggest` repair calls for compile/render errors it sees (`AiIde.tsx:1226-1247`).
6. **Design tab**: click-to-select edits write back to source (`source-edit.ts`); the theme editor writes `src/design.css` and `design.json` (five knobs: mode, accent, surface tint, status colours, chart colours; plus 10 fonts and a radius multiplier).
7. **Push & Deploy**: `POST /ai-ide/git/init-and-push` creates a GitHub repo and pushes with a token held in memory (and in the browser's localStorage, `AiIde.tsx:69,859`); `POST /ai-ide/deploy` triggers a Vercel deployment into the org's connector project (`vercel_service.py:309-311`).

Cost of step 2–4 for a 5-page app: 7 LLM calls, about 34K prompt tokens, of which about 20K is the kit reference re-sent six times (App Builder audit, §A). Every `api_cost_logs` row records cost 0 because Ollama rates are 0 (`ai_service.py:67-70`).

**"Run a requirement's test cases against a URL"** (Test Execution): `POST /requirements` → `ai_service.generate_test_cases` → `test_cases`; `POST /test-execution/run` → `execution_service` launches headless Chromium, snapshots the page, asks the LLM for a step plan per case (cached in `test_plans`), executes, stores `test_results`; Risk Ranking and Dashboard aggregate those rows (`execution_service.py`, `prioritization_service.py:51-66`, `dashboard_service.py:58-133`). This path is honest and well tested (`test_execution_*`, `test_step_runner.py`). It is **not** connected to App Studio: nothing registers a freshly built app as a target.

## 4. Healthy areas (keep)

- Test Execution engine and its scoring (`execution_service`, `prioritization_service`, `dashboard_service`): computed from stored data, SKIP semantics, credentials never sent to the LLM, 5 test files.
- Org isolation: every newer collection is org-scoped and tested (`test_data_isolation.py`, `test_requirements_isolation.py`, `test_workspace_isolation.py`).
- Honesty rules in LLM features: PR review returns INCOMPLETE rather than a fake approval; Release Gate returns INSUFFICIENT_DATA; incidents store `rca_error`; impact generation raises instead of placeholders (`ai_service.py:748-751`, `release_gate.py`, `incidents.py:125-158`, `impact_service.py:1095`).
- App Studio storage and recovery: files mirrored to Mongo, restored on container restart, kit upgrade path, org-scoped download (`ai_ide_service.py:193-244,370-402`, `test_ai_ide_storage.py`).
- The Chronos kit itself: 22 files, ~165 KB, every component tolerant of bad props, error boundaries per section, formatters that never print NaN (`KIT_API.md` "Robustness", `boundary.tsx`, `safe.ts`, `format.ts`).
- Design editing libraries: `theme-engine.ts`, `app-design.ts`, `source-edit.ts`, `tw-classes.ts` carry 70% of the frontend's 501 unit tests.
- Frontend colour discipline: 0 raw palette classes, 0 hex, 0 framer-motion across all 32 pages (two exceptions in `Login.tsx` and one in `Incidents.tsx:88`).

## 5. Reproduced defects and confirmed problems (file evidence)

Numbered in `GAP_REGISTER.md`. The ones that change decisions:

- **GAP-01** Repo-analysis test generation puts the user's test login credentials into the LLM prompt (`ai_service.py:574-582,645-647`), contradicting the rule Test Execution follows (`execution_service.py`: substituted only in the browser).
- **GAP-02** `POST /github/commits/{sha}/review` accepts a GitHub PAT as a **query parameter** (`routes/github.py:123`); App Studio keeps the GitHub token in `localStorage` (`AiIde.tsx:69,859`).
- **GAP-05** Prompt cost: the kit reference is re-sent per file, including to the data file that cannot use it, and the static part comes after the variable part, so no prefix cache can help.
- **GAP-06** The plan is never validated (page count, `/` route, route→file mapping, mark ids); file generation has no retry and no compile check; the planner and file prompts contradict each other about where mock data lives.
- **GAP-07** `KIT_API.md` is stale (says version 6, kit is 8; says charts are not re-exported, they are; documents series 1–10, kit has 6) and three dependency lists (`TEMPLATE_DEPENDENCIES`, the `package.json` string, `preview-runtime.js PINNED`) are hand-kept copies.
- **GAP-08** Theming is per app, after the fact, five knobs; no org-level or client-level design system; a client's edited `tokens.css` would be overwritten by the next kit upgrade; no logo/favicon/typography scale/spacing/shell variant.
- **GAP-09** Chakram's own frontend uses a different token vocabulary (`text-ink*`, `border-stroke-muted`, dark-in-`:root`) from the kit (`text-primary`, `border-muted`, light-in-`:root`), so one theme file cannot drive both.
- **GAP-10** Five test generators writing to four stores; two browser execution engines (`execution_service` vs `playwright_service`) whose failures are invisible to each other (Root Cause and Test Repair only see `playwright_runs`).
- **GAP-12** Monitoring is demo-only (seeded random series, `monitoring.py:153-212`; the UI defaults to the Demo tab). Incidents are mostly fed by it.
- **GAP-13** Pipeline's report trusts live-test counts and the review verdict supplied by the client body (`pipeline.py:203-210,225-232`) instead of reading Chakram's own results.
- Dead weight: 21 unused shadcn files, 6 unimported npm packages, 15 `api.ts` methods never called, `generate_column_based_data` and module-level `_client`/`_MODEL` dead in `ai_service.py`, three settings never read, `/cost-tracker` unreachable from any link, `lib/analytics-charts.ts` orphaned.

## 6. Uncertainties (need runtime to resolve)

- Whether a real `kimi-k3:cloud` run of the five-page app hits `FILE_TIMEOUT` (90 s) or the 8000-token cap on larger pages; only estimates exist. Phase A of the plan adds per-run token logging so this becomes a measurement.
- Whether the theme editor's "sans" font choice changes body text in a real build: `tokens.css:356` hard-codes Geist on `body` and the kit never uses `font-sans` (App Builder audit §C). Needs one build to confirm.
- Whether `enableSystem` in `ThemeProvider.tsx` actually shows dark to OS-dark users despite "light is the default" (frontend audit §5). Needs a browser.
- The production Azure environment (`vakyam-rg` / `aidlc`) state is unknown from the repo.
