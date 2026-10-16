# Feature matrix

Date: 2026-10-16, revision `3c2dbb4`. Statuses: **Verified working** (runtime evidence), **Partial**, **Broken**, **Missing**, **Unverified** (file evidence only; no runtime here). Dispositions: **Keep**, **Repair**, **Extend**, **Merge**, **Park** (hide until its integration is configured), **Cut**. Acceptance IDs refer to `Chakram_Acceptance_Checklist.md`.

Runtime evidence available in this container: pytest (577 pass), vitest (501 pass), tsc, production build. Anything that needs Mongo, an LLM, a browser or an external API is Unverified unless a unit test with a fake proves the control flow, in which case it is marked "Partial (tests)".

## A. Blueprint capabilities

| Blueprint capability | Status | File evidence | Runtime evidence | Risk | Disposition | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| Import an existing repository | Partial | `workspace_service.py:163` clones with PAT into `WORKSPACE_TEMP_DIR`; no base-SHA capture, no profile detection, no startup contract | `test_workspace_registry.py`, `test_workspace_isolation.py` | Medium | Extend (Phase H) | PRE 01, GIT 02 |
| Start from a template | Verified (tests) | `template_service.py:54-350`: 37-file Vite template + Chronos kit; Mongo `Templates` override unused | `test_ai_ide_generation.py::test_template_*` | Low | Keep; retire Mongo override when design packs land | AUD 06 |
| Describe → implementation (frontend) | Partial | planner + generator (`engines/*`), 7 LLM calls per 5-page app, no plan validation, no compile check | `test_ai_ide_generation.py` (fake model) | High (cost, reliability) | Repair (Phase A) then Extend (Phase B composer) | HAR 01–04 |
| Describe → implementation (backend, data, auth) | Missing | Planner asks for "typed mock data" only (`planner.py:25,39`); no `fetch` in kit or prompts | — | High | Extend (Phase C API kit) | BE 01–07 |
| Live preview (frontend) | Partial | `preview-runtime.js`: browser-side Sucrase + esm.sh + Tailwind CDN, MemoryRouter shim, stubs for pending files | `AiIdePreview.test.tsx` | Medium (CDN dependence, no type errors, no backend) | Keep; add in-browser store (Phase C) | PRE 03, PRE 07 |
| Live preview (backend services, revision state) | Missing | No runtime adapter, manifest, process supervisor or revision display | — | High for pilot | Defer to Phase H (CHK 03–05) | PRE 02–06 |
| Inspect data and integrations | Missing | No Backend tab, no schema or migration view | — | High | Phase C | BE 05 |
| Verify behaviour (tests, browser) | Verified (tests) for the requirement flow; Partial as a loop | `execution_service.py` (real Chromium, LLM-planned steps, SKIP semantics); not linked to built apps | `test_execution_*`, `test_step_runner.py` | Low | Keep; Extend (Phase V: spec-derived cases, auto-target) | REL 01–03 |
| Review code via GitHub | Partial | PR review (`github.py`, `ai_service.review_pull_request` v2 with legacy fallback), commit review takes PAT in query string | `test_pr_review_coverage.py` | Medium | Keep; Repair GAP-02 | GIT 01–02 |
| Release a reproducible artifact | Partial | Zip download (`ai_ide.py:291-326`); Vercel deploy by git source; no artifact digest, no staging recipe for the generated app | `test_ai_ide_download.py` | Medium | Extend (REL 04–05 in Phase C) | REL 04–05 |
| Harness: persisted runs, leases, cancellation, reconnect | Partial | Runs are in-process dicts (`ai_ide_generation.py:73-188`); reconnect gets a snapshot; no lease, no durable log, no cancel endpoint; Azure runs 1 worker | `test_ai_ide_generation.py::test_attach_*` | High for pilot | Phase H (CHK 06) | HAR 05–12 |
| Typed tools and policy | Missing | No tool layer; the model writes whole files | — | — | Not needed for the composer path; revisit in Phase H | HAR 02 |
| Model gateway, Azure and Gemini adapters | Missing | One provider (Ollama via OpenAI SDK), `_ollama_cfg` per org | — | High for pilot | Phase H (CHK 08, 13) | MOD 01–12 |
| Connectors (GitHub, Jira, Vercel, Slack, Datadog) | Partial | Per-org connector settings (`connector_settings_service.py`), platform-org gate; Jira/Datadog/Slack unconfigured and degrade with 503/`errors` | `test_connector_resolution.py`, `test_connector_clear.py` | Medium | Keep | CON 01 |
| Theme tokens and element selection | Partial | theme-engine (5 knobs), app-design (palette/fonts/radius), source-edit click-to-select; per app only | 109 unit tests | Medium | Extend (Phase D design packs) | OPS 02 |
| Tenant isolation | Partial | org scoping on all newer collections; older ones (`test_cases`, `requirements`) scoped too per tests | `test_data_isolation.py` | Low | Keep | SEC 02 |
| Secrets handling | Partial | server-side only, except GAP-01 (credentials in prompt) and GAP-02 (PAT in query / localStorage) | `test_repo_commits_redaction.py`, `test_path_and_token_safety.py` | **P0/P1** | Repair first | SEC 01 |
| Usage and cost | Partial | every call logged to `api_cost_logs`; cost always 0; no run/workspace id | `test_usage_and_monitoring.py` | Low | Repair (Phase A step 5) | MOD 10, OPS 04 |
| Observability, budgets, correlation IDs | Missing | — | — | Medium | Phase H (CHK 18) | OPS 05 |

## B. Product surface (pages and their backend)

Columns: inputs a user must supply before the page shows anything; what feeds it; verdict and disposition.

### Core loop

| Page | Route | Needs | Backed by | Status | Disposition |
| --- | --- | --- | --- | --- | --- |
| App Studio | `/ai-ide` | idea or PRD; GitHub token for push | `ai_ide`, engines, kit, Vercel | Partial (frontend-only apps) | **Keep, invest** (Phases A, B, C, D) |
| Test Suite | `/generated-tests` | a requirement | `test_cases` | Verified (tests) | Keep; becomes the tabbed home for all test lists |
| Test Execution | `/test-execution` | requirement + URL | `execution_service` | Verified (tests) | Keep; auto-target built apps (Phase V) |
| Live Test Run | `/live-testing` (+ alias `/live-test-runner`) | repo URL or spec + URL | `repo_analysis`, `playwright_service`, healing | Unverified; 1,984-line page, 213 Chronos vs 53 shadcn class uses, 34 hand-written panels | Keep; refactor into the Test Suite tabs |
| Code Review | `/code-review` | repo | `github` | Partial (public repos only without token) | Keep; repair GAP-02 |
| Code Workspace | `/workspace` | repo + branch | `workspace`, `git_ops`, `copilot`, `coverage`, `test_gen`, `commit`, `impact` | Unverified | Keep |
| SDLC Pipeline | `/pipeline` | repo + branch | `pipeline` + stage components (2,500 lines reusing Workspace, Code Review, Deploy, Live Test) | Unverified; report trusts client-supplied signals (GAP-13) | **Keep as the one guided loop**; make it read Chakram's own results; stop duplicating stage UIs in standalone pages |
| Dashboard | `/dashboard` | prior runs | `dashboard_service` | Verified (tests) | Keep |

### Supporting

| Page | Route | Needs | Backed by | Status | Disposition |
| --- | --- | --- | --- | --- | --- |
| Requirements | `/requirements` | text | `requirements` (LLM) | Verified (tests) | Keep |
| Test Data | `/synthetic-data` | a requirement | `synthetic_data` (LLM) | Verified (tests) | Keep |
| Risk Ranking | `/prioritization` | prior runs | `prioritization_service` | Verified (tests) | Keep |
| Change Hotspots | `/defect-prediction` | repo | GitHub history + LLM narrative | Unverified; formula copied into `test_selection_service.py:31-60` | Keep; de-duplicate the formula |
| Product Specs | `/prd` | name + description | `prd` (LLM, not persisted) | Unverified; bypasses `api.ts` | Keep; link its output into App Studio (one button) |
| Deployments | `/deployments` | repo + branch | Vercel | Unverified; 4 deploy entry points | Keep; single deploy service |
| Test Baseline | `/repo-baseline` | repo | `baseline` | Unverified; 1,042-line page, 8 hand panels, uses axios directly | **Merge** into Test Suite tab |
| Test Selection | `/test-selection` | repo + two SHAs + URL + existing baseline | `test_selection` | Partial (tests) | **Merge** into Test Suite tab |
| Root Cause Analysis | `/root-cause`, `/root-cause/:id` | Live Test failures | `root_cause` (only sees `playwright_runs`) | Partial (tests) | **Merge** into Test Suite tab; feed from both engines (GAP-10) |
| Test Repair | `/self-healing` | Live Test failures | `healing` (always scans `/`, GAP-16) | Partial (tests) | **Merge** into Live Test Run (it already has inline heal) |
| Tests from Docs | `/doc-tests` | document + URL | `impact` upload/generate (not persisted) | Unverified; hands off to Live Test Run via sessionStorage | **Merge** into Live Test Run's spec/doc upload |
| Code Impact | `/code-impact` | repo + branch | `impact /workspace-graph` | Unverified; same graph as Workspace `TreeFlowView.tsx:898`; 17 px-text classes, no PageShell | **Merge** into Workspace (one graph) |
| Requirement Insights | `/requirements-intelligence` | pasted story or Jira key | `jira` (503 without Jira) | Partial | **Merge** the manual-story analysis into Requirements; Park the Jira half |
| Connectors | `/settings/connectors` | credentials | `organizations` | Unverified | Keep |
| Usage & Cost | `/cost-tracker` | — | `cost_logs` | Unverified; **no link to it anywhere** | Keep; add to sidebar footer |
| Profile, Login | `/profile`, `/login` | — | `auth` | Partial (tests) | Keep |

### Park (hide from the sidebar until the feeding connector is configured)

| Page | Route | Why | Disposition |
| --- | --- | --- | --- |
| CI Health | `/ci-intelligence` | GitHub Actions only; duplicates `/github/workflow-runs/*/explain`; DORA computed in three places | Park until a repo is connected; remove the duplicate endpoint |
| Sprint Health | `/sprint-intelligence` | Jira + GitHub; Jira unconfigured; overlaps CI Health and Release Gate | Removed (T-140): page, `routes/sprint.py` and the sprint summary are gone |
| Release Gate | `/release-gate` | needs CI + Jira; Pipeline already imports its scoring | Park; Merge scoring into Pipeline report |
| Incidents | `/incidents` | real storage, but fed by demo Monitoring in practice | Park until Monitoring has a real source |
| Metric Anomalies | `/monitoring` | **Demo-only**: seeded random series (`monitoring.py:153-212`), Demo tab default, no stored series, Datadog read unused | **Cut** from the sidebar now; keep the z-score/projection functions for when a real series exists |

### Backend modules with no page or with a duplicate

| Module | Finding | Disposition |
| --- | --- | --- |
| `commit.py` | one endpoint, same tree as `impact /workspace-graph`, no tests | Merge into `impact` |
| `coverage.py` | AST cross-reference, no LLM; marginal | Keep (cheap) |
| `test_gen.py` | fifth test generator, own store `workspace_test_suites` | Merge generation into one service (Phase 0/V) |
| `github.py` `/workflow-runs/{id}/explain` | identical to `/ci/runs/{id}/explain` | Cut one |
| `jira.py` AC generation, 15 `api.ts` methods, 4 `use-impact` hooks | never called from the UI (`sprint.py /dora` removed in T-140) | Cut |
| `monitoring.py /simulate-time-series` | demo generator | Cut with the page |
| `webhooks.py` | WorkOS only; 503 otherwise | Keep (dormant) |

## C. Counting it up

| | Count |
| --- | --- |
| Sidebar items today | 29 (+ Dashboard, Pipeline) |
| After Merge/Park/Cut | 13 visible by default: Dashboard, Pipeline, App Studio, Workspace, Code Review, Product Specs, Requirements, Test Data, Test Suite (tabs: Cases, Baseline, Selection, Root Cause), Test Execution, Live Test Run, Risk Ranking, Change Hotspots, Deployments, Connectors; plus 4 parked items that appear when their connector is saved |
| Pages whose code is removed in Phase 0 | 0 (routes stay reachable; sidebar changes only) |
| Frontend dead weight removable now | 21 `ui/*` files, 6 unimported packages (`framer-motion`, `@babel/parser`, `@babel/traverse`, `@hookform/resolvers`, `zod`, `@hugeicons/core-free-icons`), ~15 packages used only by unused `ui/*` files, `lib/analytics-charts.ts`, ~20 unused CSS classes in `index.css` |
