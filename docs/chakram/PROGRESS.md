# Progress

## 2026-10-16 — Audit and plan (T-000 done)

Revision `3c2dbb4`, branch `claude/dazzling-mendel-wckwjs`. Working tree: only `docs/chakram/**` added.

**Completed**
- Baseline checks from a clean checkout: backend 577 pass / 4 environmental failures (sandbox exports `GITHUB_TOKEN`; 39/39 pass with it unset), frontend tsc + 501 vitest + build pass, lint 87 errors (advisory in CI). See `audit/BASELINE_CHECKS.md`.
- Full inventory of 34 backend routers, 32 pages, App Studio pipeline, Chronos kit and theming: `audit/CURRENT_STATE.md`, `audit/FEATURE_MATRIX.md`, `audit/ARCHITECTURE_MAP.md`.
- 28 gaps with evidence and repairs: `audit/GAP_REGISTER.md`. One P0 by file evidence (GAP-01: test credentials in the repo-analysis LLM prompt).
- Plan for the streamlined product, installable design packs, spec-first composition and the templated API: `IMPLEMENTATION_PLAN.md`; decisions in `DECISIONS.md`; executable backlog in `tasks.json`.

**Findings that drive the next work**
- A 5-page App Studio build is ~7 LLM calls and ~34K prompt tokens; ~60% is the kit reference re-sent per file (GAP-05). Fixable in days (Phase A).
- Generated apps are frontend-only with mock data (GAP-11). The spec/composer design (Phase B) is the prerequisite for a templated API (Phase C).
- Theming cannot be installed per client today (GAP-08) and Chakram's own UI uses a different token vocabulary from the kit (GAP-09).
- Half the sidebar is merge/park/cut material; nothing needs deleting to streamline it (ADR-5).

**Not done / blocked**
- No runtime verification of LLM, browser, GitHub, Jira, Vercel paths (no services in the audit container). Those rows are Unverified in the matrix.
- No code changes beyond docs. Phase 0 repairs (T-001..T-004) are the next tasks.

**Next task:** T-001 (GAP-01 redaction), then T-003 (sidebar streamlining), then Phase A (T-010..T-015).

## 2026-10-16 — Phase 0 repairs and Phase A built (T-001..T-003, T-010..T-015 done)

Working tree on `claude/dazzling-mendel-wckwjs`, on top of the audit commit. Checks: backend 635 passed / 1 skipped (`env -u GITHUB_TOKEN -u GH_TOKEN .venv/bin/python -m pytest -q`), frontend tsc clean, 517 vitest passed, production build passed. Lint unchanged (pre-existing errors only).

**Security (Phase 0)**
- GAP-01: test-site credentials never enter an LLM prompt. The repo-analysis prompts ask the model to write `{{TEST_EMAIL}}` / `{{TEST_PASSWORD}}`; `playwright_service._run_step` substitutes them in the browser and logs `<credential>`. A placeholder step in a run that has no account fails with a clear message instead of typing the placeholder. Re-runs from Root Cause and Test Selection still start without an account (follow-up noted in GAP-01).
- GAP-02: commit-review PAT moved to the request body; App Studio's GitHub token is session-scoped.
- GAP-03: target-URL pre-flight verifies TLS by default (`allow_insecure_tls` opt-in, logged). GAP-22: commit author from settings.

**Sidebar (Phase 0, ADR-5)**
- 13 default items; Test Suite tabs (Cases, Baseline, Selection, Root Cause, Repair, From Docs); CI Health / Sprint Health / Release Gate / Incidents appear only when their connector is configured; Monitoring, Code Impact and Requirement Insights are URL- and search-reachable only; Usage & Cost linked from the footer. No route or backend removed.

**Generation (Phase A)**
- Prompts: one system message per file role (role line + kit sheet + rules) and a user message with only the per-file facts. The data module gets no kit reference and no icon catalogue; the charts sheet is added only when the page blueprint names a chart. Measured on the same 5-page fixture: page prompt ≈ 8.6K chars (was ≈ 22K), data prompt ≈ 2.3K (was ≈ 17K), and the system prefix is byte-identical across the pages of a build.
- Plan contract: `engines/plan_schema.normalize_plan` cleans paths, drops unsafe/duplicate files, derives component names and routes, guarantees one `/` route, validates marks and icons, caps pages at 8, and raises `PlanError` otherwise; the planner gets one repair turn with the reason. Ideas are capped at 12K chars.
- Verification: `engines/verify.verify_file` runs before a file is saved (truncation, unterminated strings, fences, prose, default export, JSX in `.ts`, forbidden packages, unknown kit exports, missing local imports, page-imports-page). A failing file is regenerated once with the reasons; hard problems after that reject the file, soft ones keep it and report a warning. This is a structural check, not `tsc`; the container has no Node toolchain.
- Context: an over-long shared file is shown as an export summary instead of a hard cut, so pages see every dataset name.
- Usage: `GenerationRun` has a `run_id` and totals; `GENERATION_DONE` carries `usage`, `warnings`, `run_id`; `api_cost_logs` rows carry `workspace_id`, `run_id`, `path`. The detached log task no longer resets a ContextVar from another context.
- Naming: `package.json` name and `<title>` are set from the plan's app name (GAP-18).
- Drift: `tests/test_kit_reference.py` fails if the reference or a sheet names anything the kit does not export, if the stated kit version drifts, or if `preview-runtime.js` pins differ from `TEMPLATE_DEPENDENCIES`; `package.json` is rendered from that one list.

**Not done**
- No live model run (no Ollama here): the token figures are prompt sizes, not provider-reported usage. First real build will populate `api_cost_logs` with per-run totals.
- `KIT_API.md` is kept as the human reference; prompts use the sheets.

**Next task:** T-020 (extract the chronos design pack; `src/design/` in apps), then T-021/T-022.

## 2026-10-16 — Phase D1 built: design packs (T-020..T-022 done)

Checks: backend 648 passed / 1 skipped, frontend tsc clean, 525 vitest passed, production build passed.

- **Pack format** (`docs/chakram/DESIGN_PACKS.md`): `pack.json`, `pack.css`, optional `README.md` and `brand/logo.svg`, zipped. The builtin `chronos` pack is the extracted current look (`backend/app/templates/design_packs/chronos/`).
- **Kit 9**: fonts, card radius and sidebar width are custom properties with Chronos defaults; `AppShell` takes `logoSrc`. Existing apps upgrade to kit 9 unchanged in appearance.
- **Install**: a new app gets `src/design/*`; `index.css` loads tokens → `design/pack.css` → `design.css`; `index.html` gets the pack's font links and dark mode; `App.tsx` passes the logo. The kit upgrade never touches `src/design/`.
- **Validation** on upload: metadata, SVG-only logo without script, light-mode contrast (reject < 3:1, warn < 4.5:1 on five pairs), which tokens remain at Chronos defaults, missing dark block, stray files. Rejections come back as one readable message.
- **Org storage**: `design_packs` collection (org + id unique), default on the org document; `GET/POST/DELETE /api/ai-ide/design-packs`, `POST …/{id}/default`; Settings → Design System section; App Studio idea screen has a Design system selector; `POST /ai-ide/workspace/create` takes `pack_id`.
- **Planner** reads the pack's README as design notes.
- **Preview**: `.svg` imports become data URLs; stylesheet order matches the real build.

**Not done / limits**: fonts are Google links or `@font-face` data URLs in `pack.css` (no binary font upload, by design: app files are text). Chakram's own frontend does not yet load the org pack (T-030, Phase D2). No live build was run here.

**Next task:** T-030 (Chakram frontend adopts kit token names and loads the org pack) or T-040 (app spec + composer), per the plan's order: T-040 is the larger token saving; T-030 is what makes "install Mahindra" re-skin Chakram itself.

## 2026-10-16 — Phase B built: app spec and composer (T-040, T-041 done; T-042 partial)

Checks: backend 664 passed / 1 skipped, frontend tsc clean, 525 vitest passed, `npm run check:composed` passes (the golden composed app type-checks against the real kit under `strict` + `noUnusedLocals`), production build passed.

- **Spec** (`backend/app/engines/spec.py`): `name`, `entities` (fields: id, string, text, number, money, percent, boolean, date, datetime, email, url, `enum:a|b`, `ref:Entity`) and `pages` of blocks (`kpis`, `chart` line/area/bar/donut, `table`, `list`, `barlist`, `progress`, `panel`, `split`, `grid`, `custom`) bound to metrics (`count/sum/avg/min/max(Entity.field)` with `where`) and groups (by value/day/week/month). Normalisation repairs what it can (unknown fields and entities dropped from bindings, defaults derived, one `/` route, names made unique) and raises `SpecError` with the reason otherwise.
- **Planner** (`planner.plan_spec`): one call with a ~0.9K-token system message that is the whole contract, one repair turn. `planner.seed_rows`: one call for realistic rows; the composer validates and coerces them (ids, enums, refs, dates, numbers) and completes short lists with plain rows, reporting that as a warning.
- **Composer** (`backend/app/engines/composer.py`): writes `src/data/types.ts`, `src/data/queries.ts` (fixed generic helpers), `src/data/seed.ts`, one page per spec page and `app.spec.json`. Pages import only what they use; tables get typed columns with money/date/percent formatting, enum badges with tone by keyword, and ref lookups; charts bind to `series()`/`top()`.
- **Run** (`ai_ide_generation`): `AI_IDE_COMPOSER` (default on). Order: spec → PLAN → seed → types/queries/seed written → custom components through the model (verified, retried once) → composed pages → routes. If no usable spec can be planned, the run says so and falls back to the per-file path. `GENERATION_DONE` carries `composed: true/false`.
- **Cost for the five-page clinic fixture**: 1 spec call (~1.2K prompt tokens) + 1 seed call (~0.4K) + 0–2 custom blocks, versus 7 calls at ~34K before Phase A and ~14K after it. Pages are byte-reproducible from the spec.
- **Evidence**: `tests/test_spec.py` (7), `tests/test_composer.py` (5, golden), `tests/test_generation_composed.py` (4: composed run, seed failure, fallback, flag off). CI step `check:composed`.

**Not done**: structural edits in the Design tab do not recompose from the spec yet (text and class edits still write to the TSX, which keeps working). `app.spec.json` is written so that can be added without a format change. No live model run here; the first real build will show whether `kimi-k3:cloud` produces a valid spec on the first try (the repair turn and the fallback cover the failure modes).

**Next task:** T-060 (API kit from entities: the spec's entities already carry what it needs) or T-030 (Chakram adopts the kit tokens). Suggested: T-060, since it completes the "same API every time" goal and the issue-tracker journey in the blueprint.

## 2026-10-16 — Phase C started: the API kit (T-060 partial)

Checks: backend 665 passed / 1 skipped; `npm run check:composed` and `npm run check:api-kit` pass (the golden kit installs its pinned hono/zod/postgres and type-checks under NodeNext); CI runs both.

- Every composed app now ships `api/` (`docs/chakram/API_KIT.md`): the same Hono service for every app with zod schemas, a PostgreSQL store and an in-memory dev store, scrypt passwords and server-side sessions, roles owner/member/viewer, org-scoped CRUD per entity with ref checks, numbered SQL migrations, a seed loader and a README. Only entities differ between apps; the model writes none of it.
- `src/data/store.ts` gives pages `useAppData()`: the seed by default, the API when `VITE_API_URL` is set, plus typed `create/update/remove`. Composed pages render a loading state until data is ready and build their table columns inside the component so lookups see live rows.
- The first `check:api-kit` run caught real errors (NodeNext needs explicit `.js` import extensions); fixed and kept as a CI gate.

**Not done**: form and detail blocks (the UI for writes), uploads, jobs, webhooks, a Vercel function wrapper, and a live PostgreSQL run of the blueprint's BE 01–04 checks.

**Next task:** T-070/T-071 (verify stage: spec-derived test cases against a built app; one TestRun shape across both engines) or T-030 (Chakram adopts the kit tokens).

## 2026-10-16 — Phase V: verify what Build just made (T-070 done)

Checks: backend 667 passed / 1 skipped; frontend tsc clean, 525 vitest passed, build passed.

- `engines/spec_tests.py` turns a composed app's spec and seed into acceptance cases with no model call: open the home page and see the sidebar, navigate to each page, KPI tiles show figures (with the exact seeded count), tables list a named seeded row and search narrows them, charts and lists render, custom sections show no error box, unknown routes show the shell's placeholder.
- `POST /api/ai-ide/workspace/{id}/test-cases` stores them as one requirement per app (`source: app_studio`, `workspace_id`) in the `test_cases` collection the Test Suite and Test Execution pages already read; a second call reuses it, `?refresh=true` regenerates.
- App Studio's Deployed view gets **Test this app** once a deployment URL exists; it opens Test Execution with the requirement and the URL preselected, so the existing browser engine runs the cases against the deployed app.

**Next task:** T-071 (one TestRun shape across both engines; Pipeline reads stored results) or T-030 (Chakram adopts the kit tokens). T-004 (dead code) and T-050 (kit controls) remain open.
