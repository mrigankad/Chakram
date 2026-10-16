# Architecture map (as built)

Date: 2026-10-16, revision `3c2dbb4`. Blueprint module names are given in brackets where an existing file plays that role.

## 1. Processes and boundaries

```
 Browser (React SPA, Vite :8081 dev / served from backend/static in the image)
   │  /api/* (cookie session)            WebSocket /api/ai-ide/ws/generate/{id}
   ▼
 FastAPI process (uvicorn, 1 worker)  ── Motor ──► MongoDB (db "aidlc")
   ├─ routes/*  (34 routers)                       30+ collections, no migrations
   ├─ services/* (business logic, LLM prompts)
   ├─ engines/*  (App Studio planner/generator/injector/kit)
   ├─ BackgroundTasks + asyncio tasks (jobs live in this process)
   ├─ subprocess: git CLI (list args, worker threads)          ── GitHub (HTTPS, PAT)
   ├─ GitPython on local clones (WORKSPACE_TEMP_DIR, AI_IDE_WORKSPACE_DIR)
   ├─ Playwright → headless Chromium (same container)         ── target sites
   └─ OpenAI SDK → Ollama-compatible endpoint (OLLAMA_BASE_URL)
 Optional outbound: Vercel API, Jira REST, Slack webhook, Datadog, WorkOS
 Preview iframe (sandboxed, opaque origin) → esm.sh, cdn.tailwindcss.com, fonts.googleapis.com
```

Trust notes: generated App Studio code never executes on the server; it is compiled and run only inside the sandboxed iframe (no `allow-same-origin`). The server does run `git` and Chromium against user-supplied repositories and URLs inside the API process's container. There is no separate worker, sandbox or runtime adapter yet (blueprint §10).

## 2. Frontend

| Area | Files | Role (blueprint) |
| --- | --- | --- |
| Shell | `src/App.tsx`, `components/DashboardLayout.tsx`, `AppSidebar.tsx`, `lib/nav-config.ts`, `GlobalSearch.tsx` | navigation |
| Auth | `context/AuthContext.tsx`, `components/ProtectedRoute.tsx`, `pages/Login.tsx` | session |
| API client | `lib/api.ts` (1,869 lines: 132 hand-written types, `api` 113 methods, `impactApi` 7, `baselineApi` 5), `lib/api-error.ts`; App Studio, PRD, cost logs and auth call `apiClient` directly | — |
| Design system (Chakram's own) | `styles/imcc-tokens.css`, `styles/imcc-bridge.css`, `src/index.css`, `tailwind.config.ts`, `components/imcc/{Panel,StatusBadge,DataTable}.tsx`, `PageHeader.tsx`, `PageCard.tsx`, `PageShell.tsx`, `dashboard/DashboardUi.tsx`, `ui/*` (shadcn, 29 used / 21 unused) | design |
| App Studio | `pages/AiIde.tsx` (1,846), `components/ai-ide/*` (AiIdePreview + `preview-runtime.js`, AiCodeEditor, AiFileTree, AppLibrary, DesignPanel, ElementInspector, ThemeEditor), `hooks/useAiGenerationWS.ts`, `lib/{theme-engine,app-design,source-edit,tw-classes,ai-ide-download,marks}.ts` | builder workspace, preview, design |
| Workspace | `pages/Workspace.tsx`, `components/workspace/*` (TreeFlowView 1,586, GephiSigmaGraph 1,008, ViewEntryTree 965, TestGenerator 733, CopilotChat, CommitPanel, EditorArea…) | code view, git |
| Pipeline | `pages/SDLCPipeline.tsx`, `components/pipeline/*` (Stage{Workspace,CodeReview,Deployment,TestRunner,Report}, UnifiedTestIntelligence) | history / delivery |
| Testing | `pages/{GeneratedTests,TestExecution,LiveTestRunner,RepoBaseline,TestSelection,RootCauseAnalysis,RootCauseDetail,SelfHealingTests,DocTests,Prioritization}.tsx`, `components/live-testing/HealFailedTest.tsx`, `hooks/use-live-testing.ts` | verification |
| Other pages | Dashboard, Requirements, RequirementsIntelligence, SyntheticData, CodeReview, CodeImpact, PRDGenerator, CIIntelligence, DefectPrediction, Deployments, ReleaseGate, SprintIntelligence, Monitoring, Incidents, ConnectorsSettings, ApiCosts, UserProfile, NotFound | — |
| Tests | 15 vitest files, 501 cases, all `lib/*` + 3 component tests; no page tests | — |

## 3. Backend

| Blueprint module | Existing files | Notes |
| --- | --- | --- |
| Project / tenant service | `routes/auth.py`, `routes/organizations.py`, `app/auth/*`, `services/user_service.py`, `organization_service.py`, `connector_settings_service.py` | org-scoped connectors; platform-org gate for server credentials |
| Workspace service | `routes/workspace.py`, `routes/deps.py` (`attach_workspace`), `services/workspace_service.py` (GitPython clone into `WORKSPACE_TEMP_DIR`); App Studio has its own: `services/ai_ide_service.py` (disk + `ai_ide_files` mirror) | two workspace systems |
| Run orchestrator | `services/ai_ide_generation.py` (in-process `GenerationRun`, snapshot + live events), `analysis_runner.py` and `baseline_runner.py` (BackgroundTasks + job docs), `durable_state.py` | no leases, no durable event log, no cancel |
| Model gateway | `services/ai_service.py` (`_call_openai*`, `call_ai`, `_parse_json_object`, retry, semaphore, cost log), `engines/generator.py` (streaming) | single provider; 36 call sites; prompts spread across 7 modules |
| Tool service | — | none; model writes whole files |
| Runtime / preview service | `frontend/src/components/ai-ide/preview-runtime.js` (browser) | no server runtime |
| Git service | `services/git_service.py`, `repo_service.py` (git CLI), `diff_service.py`, `routes/git_ops.py`, `routes/commit.py`, App Studio `ai_ide_service.init_git_and_create_repo` / `commit_and_push_workspace` | |
| Backend (generated app) service | — | none |
| Connector gateway | `services/{github,jira,vercel,slack,datadog}_service.py`, `connector_settings_service.py` | per-org keys; no OAuth, no refresh |
| Verification service | `services/execution_service.py` (+ `test_plans` cache), `playwright_service.py` (second engine), `test_case_service.py`, `prioritization_service.py`, `dashboard_service.py`, `root_cause_service.py`, `healing_service.py`, `test_selection_service.py` | two engines |
| Release service | `services/vercel_service.py`, `routes/deployments.py`, `routes/release_gate.py`, `routes/pipeline.py` | Vercel only |
| Template / design | `services/template_service.py` (37-file template, Mongo `Templates` override), `engines/kit.py`, `templates/chronos_kit/**`, `services/marks_service.py` + `templates/marks_manifest.json` (920 icons) | the owner's templatization base |
| Other | `routes/{prd,cost_logs,activity,webhooks,monitoring,incidents,sprint,ci_intelligence,defect_prediction,impact,test_gen,coverage,copilot,synthetic_data,requirements,test_cases,test_execution,prioritization,dashboard,repo_analysis,baseline,test_selection,root_cause,healing}.py` | see `FEATURE_MATRIX.md` |

## 4. Collections (who writes, who reads)

| Collection | Written by | Read by |
| --- | --- | --- |
| `users`, `user_profiles`, `organizations` | auth, organizations, webhooks | every request (`get_current_org`) |
| `requirements`, `test_cases` | requirements | test_cases, synthetic_data, test_execution, dashboard |
| `test_runs`, `test_results`, `test_plans` | execution_service | prioritization, dashboard, test_execution |
| `synthetic_datasets` | synthetic_data | dashboard |
| `repo_analysis_jobs`, `repo_analyses`, `playwright_tests`, `playwright_runs`, `playwright_run_screenshots` | repo_analysis, analysis_runner, playwright_service | root_cause, healing, test_selection, live testing |
| `repo_baselines`, `baseline_scan_sessions` | baseline | test_selection, pipeline stage, live testing, App Studio sync |
| `test_selection_runs`, `root_cause_analyses`, `healing_attempts` | their routes | their pages |
| `workspaces`, `workspace_test_suites`, `snippets` | workspace, test_gen, copilot | workspace pages |
| `ai_ide_workspaces`, `ai_ide_files`, `Templates` | ai_ide_service, template_service | App Studio |
| `github_cache` | ci_metrics_service | github, ci, defect_prediction, release_gate, sprint, test_selection |
| `pipeline_runs`, `incidents`, `activity_history`, `api_cost_logs` | pipeline, incidents, activity, ai_service | their pages |

Indexes are created at startup in ~12 independent try/except blocks in `main.py::_ensure_indexes_and_seed`. There is no schema versioning; `durable_state.py` is a small helper for job documents.

## 5. Runtime behaviours worth knowing

- Startup tolerates a missing Mongo (logged, non-fatal); routes then 500/503 until it appears. `serverless_db_warmup` middleware reconnects on each `/api` request.
- `request_time_limit` middleware returns 504 after `REQUEST_TIMEOUT_SECONDS` on `/api`; long work is pushed to background tasks.
- `/ready` and `/api/ready` call the LLM endpoint (`/api/tags`, 3 s) on every request (GAP-04).
- `LLM_MAX_CONCURRENCY` semaphore guards `ai_service` calls; the App Studio streaming generator bypasses it and uses its own `PAGE_CONCURRENCY=3`.
- `MAX_CONCURRENT_BROWSERS` / `TEST_EXECUTION_CONCURRENCY` bound Chromium instances.
- Static SPA serving with a path-traversal guard when `backend/static` exists (the Docker image).
- All git subprocess calls use list arguments in worker threads; no `shell=True` anywhere (verified by grep). GitPython spawns `git` for clone/commit/push.

## 6. Where the blueprint's control plane would attach

- **Project runtime manifest** (blueprint §10): nothing exists; App Studio apps have a fixed implicit manifest (Vite SPA) and repo workspaces have none.
- **Preview gateway** (§11): the sandboxed iframe plays this role for App Studio only; there is no server-routed preview and no revision state.
- **Durable runs** (§8): `GenerationRun` is the seed; it needs persistence, sequence numbers, leases and cancel.
- **Model gateway** (§9): `ai_service` is the seed; it needs a provider interface (`validateConfiguration`, `getCapabilities`, `generateTurn`, `cancel`), a system/user split and per-provider adapters.
- **Design** (§5 "Backend and design surfaces"): `theme-engine.ts` + `app-design.ts` + the kit's `tokens.css`/`theme.json` are the seed of the design-pack format in `IMPLEMENTATION_PLAN.md` §2.
