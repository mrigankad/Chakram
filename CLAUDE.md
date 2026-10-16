# Chakram AI-Powered SDLC Platform

## What this is

Chakram (formerly AIDLC) is a full-stack platform that brings AI into every stage of
the software delivery lifecycle: requirement analysis, test generation, real browser
test execution, code review, risk ranking, release gating, and monitoring. It's built
by WayamAI.

The product name is defined in `frontend/src/lib/brand.ts` (`BRAND_NAME`) and the logo
assets live in `frontend/public/brand/` (source copies in `Chakram Assets/`). Internal
identifiers deliberately still say `aidlc`: the repo folder and GitHub repo, the Mongo
database name, the `aidlc_session` cookie, browser storage keys, the `aidlc-mongo`
container, and Azure resource names. Renaming those would drop data or sessions, so
leave them unless asked.

- **Frontend**: React 18 + TypeScript + Vite, Tailwind CSS + shadcn/ui,
  TanStack Query, React Router, Recharts, Monaco Editor, Sigma.js (dependency
  graphs). Dev server on port **8081**.
- **Backend**: FastAPI + Motor (async MongoDB) + Pydantic v2. Talks to an
  Ollama-compatible LLM (local or Ollama Cloud) for all AI features. Dev
  server runs on port **8001** in development.
- **Database**: MongoDB (run locally via Docker, or Atlas in production).
- **AI provider**: Ollama (local `http://localhost:11434` or Ollama Cloud), OpenAI,
  Azure OpenAI or Gemini, chosen per organization (`services/model_providers.py`).

## Repo layout

```
AIDLC-main/
├── backend/
│   ├── main.py                 # FastAPI app, router registration, CORS, lifespan
│   ├── app/
│   │   ├── config.py            # pydantic-settings, reads backend/.env
│   │   ├── database.py          # Motor/MongoDB connection helpers
│   │   ├── routes/               # one file per feature area, all mounted under /api
│   │   │   ├── requirements.py, test_cases.py, test_execution.py,
│   │   │   ├── synthetic_data.py, prioritization.py, dashboard.py,
│   │   │   ├── repo_analysis.py, github.py, jira.py, ci_intelligence.py,
│   │   │   ├── defect_prediction.py, release_gate.py, monitoring.py,
│   │   │   ├── incidents.py, workspace.py, copilot.py,
│   │   │   ├── git_ops.py, coverage.py, test_gen.py, pipeline.py,
│   │   │   ├── impact.py, commit.py, deployments.py, prd.py,
│   │   │   ├── cost_logs.py, ai_ide.py, baseline.py
│   │   ├── services/             # business logic, AI calls, integrations
│   │   ├── engines/               # AI test-generation pipeline
│   │   └── models/                # Pydantic / DB models
│   └── .venv/                    # Python virtualenv (already created)
├── frontend/
│   ├── src/
│   │   ├── App.tsx                # all frontend routes defined here
│   │   ├── pages/                  # one component per route
│   │   ├── components/             # UI components (shadcn/ui based)
│   │   └── lib/                    # API client (lib/api.ts), design system
│   └── vite.config.ts             # dev server config incl. /api proxy
├── api/index.py                  # serverless FastAPI entrypoint (Vercel)
├── vercel.json                   # full-stack Vercel deploy config
├── requirements.txt              # slim Python deps for Vercel (no Playwright)
└── README.md / SETUP.md / VERCEL_DEPLOY.md
```

## Frontend routes (src/App.tsx)

`/dashboard` (default), `/projects` and `/projects/:id` (project view), `/requirements`, `/synthetic-data`, `/test-execution`,
`/prioritization`, `/live-testing` (`/live-test-runner` alias), `/code-review`,
`/ci-intelligence`, `/defect-prediction`, `/generated-tests`, `/incidents`,
`/monitoring`, `/release-gate`, `/requirements-intelligence`,
`/workspace`, `/pipeline`, `/deployments`,
`/code-impact`, `/doc-tests`, `/prd`, `/profile`, `/cost-tracker` (Usage & Cost), `/ai-ide`
(App Studio), `/repo-baseline`, `/root-cause`, `/test-selection`, `/self-healing`,
`/settings/connectors`, `/login`.

All of these routes stay reachable, but the sidebar (`frontend/src/lib/nav-config.ts`)
shows only the streamlined set: Build & Code, Requirements & Planning, Testing &
Quality, Release & Ops, plus Connectors and Usage & Cost in the footer. Test
Baseline, Test Selection, Root Cause, Test Repair and Tests from Docs are tabs of
Test Suite (`components/TestSuiteTabs.tsx`); CI Health, Release Gate and Incidents
are parked and appear only when the connector that feeds them (GitHub, Jira, Slack)
is configured; Code Impact, Requirement Insights and Metric Anomalies are reachable
by URL and global search only. Sprint Health was removed (its DORA figures came
from GitHub and live in CI Health).

Guided 4-step core workflow (sidebar "Beta / In Progress" group):
Requirements → Test Suite → Test Execution → Risk Ranking, with Synthetic
Data as a supporting step.

## Running it locally

Dependencies are not checked in. On a fresh clone:

```bash
cd backend && uv venv --python 3.12 .venv && uv pip install --python .venv/Scripts/python.exe -r requirements.txt
.venv/Scripts/python.exe -m playwright install chromium   # Test Execution and Live Test Runner drive a real browser
cd ../frontend && npm ci
cp backend/.env.example backend/.env                       # then set OLLAMA_API_KEY
```

(`.venv/Scripts/...` is the Windows path; use `.venv/bin/...` on macOS/Linux.)

### Start sequence

```bash
# 1. MongoDB (create once, then `docker start aidlc-mongo`)
docker run -d --name aidlc-mongo -p 127.0.0.1:27017:27017 -v aidlc-mongo-data:/data/db mongo:7

# 2. Backend on 8001
cd backend && .venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001

# 3. Frontend on 8081 (separate terminal)
cd frontend && npm run dev
```

Open **http://localhost:8081**. `vite.config.ts` serves on 8081 and proxies `/api`
to `BACKEND_PORT` (default **8001**). In development a local account is seeded at
startup; see `_SEED_EMAIL` in `backend/app/services/user_service.py`.

`uvicorn --reload` can leave the old worker serving on Windows after a change
while background browser runs are alive. If an edit does not take effect, restart
the backend.

### Stopping processes

Other projects on the developer's machine use neighbouring ports and container
names. **Never use a broad pattern** like `pkill -f vite` or `pkill -f uvicorn`.
Find the PID listening on the Chakram port, confirm its command line, and stop that
PID only. Do not touch Docker containers other than `aidlc-mongo`.

## How results are produced (keep it this way)

- **Test Execution** (`execution_service.py`) runs a requirement's cases in headless
  Chromium against a target URL: snapshot the site, have the LLM plan steps from the
  snapshot, execute them. PASS needs every step to succeed and at least one assertion;
  cases that cannot be checked through the UI are SKIP with a reason and stay out of
  the pass rate. Plans are saved per case and target (`test_plans`) and reused until
  the case text changes or the user asks to re-plan. Credentials are substituted only
  in the browser; they are never stored or sent to the LLM.
- **Risk Ranking** and the **Dashboard** are computed from those results
  (`prioritization_service.score_case`), not generated. Rows in `test_results`
  without `test_case_id` come from a retired simulator and are ignored.
- **Release Gate** scores only the signals it actually measured, returns
  `INSUFFICIENT_DATA` without a CI signal, and derives the verdict from thresholds;
  the LLM writes the narrative only.
- General rule: compute numbers from stored data, show "not evaluated" honestly, and
  raise an error rather than substituting generated placeholder content when the LLM
  or an integration fails.

## AI App Builder (`/ai-ide`)

- A build is a server-side run (`backend/app/services/ai_ide_generation.py`): the
  WebSocket only streams it. A reload or dropped socket does not stop the run; the
  page re-attaches with `{"attach": true}` and gets a snapshot (plan, files so far,
  the file streaming now) before live events. The run task lives in the process, its
  record does not: `services/run_store.py` keeps every build (`runs`, ordered token-free
  `run_events`, a lease renewed by heartbeat, the plan). A restart marks runs whose lease
  expired as interrupted; **Stop build** cancels (no new model call starts), **Resume
  build** continues from the stored plan skipping files already written. See
  `docs/chakram/RUNS.md`.
- The run announces a `PLAN` first, strips stray markdown fences before saving, and
  re-wires `src/App.tsx` routes each time a page finishes, so the preview shows pages
  as they land. Failed files get `FILE_ERROR` and nothing is written for them.
- The planner's reply is normalised by `engines/plan_schema.normalize_plan` (paths,
  routes, one `/` route, marks, icons, at most 8 pages) and the model gets one repair
  turn on `PlanError`. Every generated file passes `engines/verify.verify_file` (a
  structural check: truncation, fences, default export, kit exports, local imports) and
  is regenerated once with the reasons; hard failures reject the file, soft ones warn.
- Prompts are split: a per-role **system** message (role + a sheet from
  `backend/app/templates/chronos_kit/sheets/` + rules, identical across the pages of a
  build) and a per-file **user** message. `KIT_API.md` is the human reference;
  `tests/test_kit_reference.py` fails when it, a sheet, or `preview-runtime.js` drifts
  from the kit's exports or `TEMPLATE_DEPENDENCIES`. `GENERATION_DONE` reports
  `usage`, `warnings` and `run_id`; `api_cost_logs` rows carry `workspace_id`/`run_id`/`path`.
- The Live preview (`frontend/src/components/ai-ide/preview-runtime.js`, inlined by
  `AiIdePreview.tsx`) compiles the workspace in a sandboxed iframe (no
  `allow-same-origin`): Sucrase + es-module-lexer from esm.sh, packages pinned to the
  versions in `template_service.TEMPLATE_DEPENDENCIES`, one React instance via
  `?deps=`. `react-router-dom` is shimmed so Browser/HashRouter become a MemoryRouter
  (a sandboxed document cannot change its own URL). Planned-but-unwritten files are
  stood in for with placeholders. It needs the browser to reach esm.sh and
  cdn.tailwindcss.com.
- Pushing to GitHub and deploying to Vercel is explicit (Push & Deploy on the
  Deployed view); nothing is pushed automatically.
- Generated apps ship the **Chronos kit** (`backend/app/templates/chronos_kit/`, ported from
  the Chronos project): AppShell, PageHeader, Panel, KpiTile, DataTable, Chart, Mark… Pages
  compose it instead of hand-writing UI, so the model writes far less code. `KIT_API.md` is
  the reference fed to the model. Bump `src/chronos/VERSION` on any kit change: opening an
  app with an older kit replaces its `src/chronos/*` (`kit.outdated_kit_files`).
- **3D icon library**: `frontend/public/marks/*.png` (≈920, built by
  `backend/scripts/build_icon_library.py` from the Wayam icon library, Manthan, Setu,
  WayamEye and Chronos) described by `backend/app/templates/marks_manifest.json`. Prompts get
  only the icons relevant to the app/page (`marks_service.relevant_marks`). Used icons are
  copied into an app on download and push.
- **Composer** (`AI_IDE_COMPOSER`, default on): the planner emits an app spec
  (`engines/spec.py`: entities with typed fields, pages of kit blocks bound to metrics),
  one seed-data call fills the entities, and `engines/composer.py` writes `src/data/*`
  and every page deterministically; only `custom` blocks go to the model. The spec is
  saved as `app.spec.json`. When no usable spec can be planned the run falls back to
  per-file generation. `backend/tests/golden/composed_app` is the composer's golden
  output; `cd frontend && npm run check:composed` type-checks it against the kit (CI).
- **API kit** (`docs/chakram/API_KIT.md`): composed apps also get `api/` (Hono + zod +
  PostgreSQL, org-scoped CRUD per entity, sessions and roles, SQL migrations, seed) from
  `engines/api_kit.py`, and `src/data/store.ts` (`useAppData()`: seed or live API via
  `VITE_API_URL`; writes go to the API or stay in memory). `npm run check:api-kit`
  type-checks the golden kit with its pinned dependencies (CI). A `form` block in the spec
  composes `src/components/<Entity>Form.tsx` (inputs by field kind, `api.<collection>.create`).
- **Test this app**: for a composed app, `POST /ai-ide/workspace/{id}/test-cases` derives
  acceptance cases from `app.spec.json` (`engines/spec_tests.py`, no model call) into one
  requirement per app, and the Deployed view opens Test Execution with that requirement and
  the deployed URL preselected.
- **Design packs** (`docs/chakram/DESIGN_PACKS.md`): a client's visual system as a zip
  (`pack.json`, `pack.css`, optional `README.md`, `brand/logo.svg`), validated and stored per
  org (`design_packs`), chosen when an app is created and installed under `src/design/`.
  `index.css` loads `chronos/tokens.css` → `design/pack.css` → `design.css`; the kit reads
  fonts, radius and the logo from variables/props and the kit upgrade never touches
  `src/design/`. `backend/app/services/design_pack_service.py`; the builtin pack is
  `backend/app/templates/design_packs/chronos/`.
- **Storage**: every App Builder file is mirrored to MongoDB (`ai_ide_files`, one doc per
  file) and restored from there when the disk copy is gone (Azure container restarts).
  `ai_ide_workspaces` holds name/idea/status for the "Your apps" list.
- **Design tab**: visual edit (click-to-select, text/class/icon edits written back to source
  via `source-edit.ts`; kit-internal clicks map to the page that used the component; undo/redo)
  and the theme editor (`theme-engine.ts`: brand, surfaces, mode, status/chart colours →
  `src/design.css` overriding the kit's CSS variables, plus fonts/radius in `design.json`).

## Projects and connectors

- A **Project** (`backend/app/services/project_service.py`, `/api/projects`) is the record both
  halves share: created with an App Studio workspace (or `POST /projects/import` for a
  repository), updated by push (repo), deploy (deployments), Test this app (requirement) and
  the build (name, status, spec summary). `GET /projects/{id}` computes Build / Verify /
  Review / Release / Operate stage statuses from stored data; nothing is copied from runs.
  `POST /projects/{id}/health` pings the deployed app's `/api/health` and `/api/ready` and
  stores the result; `GET /projects/{id}/gate` scores the project's own latest run and health
  (`INSUFFICIENT_DATA` without a run). The Projects page and the project view
  (`frontend/src/pages/Projects.tsx`, `ProjectView.tsx`) read these; the Dashboard lists
  the five most recent projects.
  See `docs/chakram/PRODUCT_DIRECTION.md` and ADR-6.
- **Connectors** are declared once in `backend/app/services/connector_registry.py` (kind,
  secret fields, the features they feed, the pinned API version, a read-only check).
  `GET /orgs/current/connectors/status` and `POST …/{id}/check` drive the Settings page and
  the sidebar gating. Add a connector only with a feed and a check (ADR-7). Datadog was removed.

## UI conventions

The UI follows the Chronos design system (grey page, white containers, 1px muted
strokes, 8px radius). Michroma is for page titles and metric figures only; everything
else is Geist. Panel titles are 11px uppercase tracked captions. Compose pages from
`components/imcc/Panel.tsx` (Panel, KpiStat), `components/imcc/StatusBadge.tsx`,
`PageHeader`, `PageCard` and `dashboard/DashboardUi.tsx`; use the semantic classes
(`bg-page`, `bg-container`, `bg-raised`, `text-ink*`, `border-stroke-muted`), never raw
palette colours or gradients. Light is the default theme (`:root` in
`styles/imcc-tokens.css`); dark is the `.dark` class next-themes sets. The tokens carry the
Chronos kit's names and every Tailwind colour, including the shadcn ones, reads them, so the
org's default design pack restyles Chakram itself (`components/OrgDesignPack.tsx`,
`GET /orgs/current/design-pack`); see `docs/chakram/DESIGN_PACKS.md`.

## Environment variables

`backend/.env` (already configured):
- `MONGODB_URI`, `MONGODB_DB=aidlc`
- `MODEL_PROVIDER` (`ollama` default, or `openai`, `azure_openai`, `gemini`),
  `OLLAMA_BASE_URL` (`https://ollama.com` for Ollama Cloud; the resource endpoint for
  Azure), `OLLAMA_API_KEY`, `OLLAMA_MODEL` (default `kimi-k3:cloud`; the deployment name
  for Azure). An organization can save its own provider and key in Settings; see
  `docs/chakram/MODEL_PROVIDERS.md` and `backend/app/services/model_providers.py`.
- `APP_ENV` (`development` locally). With `APP_ENV=production` the app refuses to
  start unless `SESSION_SECRET` is 32+ random characters, sign-up is closed except
  for `SIGNUP_ALLOWED_DOMAINS` / `ALLOW_OPEN_SIGNUP`, and only orgs in
  `PLATFORM_ORG_IDS` may use the server's GitHub/Jira/Vercel/Slack/Datadog
  credentials (other orgs save their own in Settings → Connectors).
- `GITHUB_TOKEN` is **empty**. GitHub features still work against public
  repos via unauthenticated calls, but share the 60 requests/hour limit and
  cannot reach private repos. Set a token to lift this to 5,000/hour.
- `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_NAME` configured
- `JIRA_DOMAIN` / `JIRA_EMAIL` / `JIRA_TOKEN` **not configured**. Jira
  endpoints return `503` with an actionable message (expected, not a bug);
  Release Gate and Pipeline degrade gracefully and record it in `errors`. Jira does
  two jobs: `POST /jira/stories/import` turns sprint stories into requirements
  (Requirements → Import from Jira) and `POST /jira/stories/{key}/post-results`
  comments a requirement's latest run on its story (Test Execution → Post results).
- `SLACK_WEBHOOK_URL` not configured (Datadog was removed: nothing read it)

`frontend/.env` exists, standard Vite env file.

## Known quirks / non-bugs

- (Fixed) `frontend/src/pages/SyntheticData.tsx` previously held 11 stray
  CP-1252 bytes that rendered as `�`; the file is valid UTF-8 now.
- Breadcrumbs on some pages (e.g. CI Intelligence, Incidents,
  Requirements Intelligence) show a generic "Chakram /" prefix
  instead of a proper category name cosmetic, auto-generated from route.
- Several pages show a greyed-out/disabled "step" UI until a prior step in
  the workflow has data (e.g. Test Execution / Risk Ranking before any
  requirement exists) this is intentional progressive-disclosure design,
  not a rendering bug.
- When driving the app through browser automation, Chrome pauses
  `requestAnimationFrame` in a **hidden/background** tab, which freezes
  framer-motion entrance animations at `opacity: 0`. Pages then look blank or
  washed out even though the DOM is complete — an automation artifact, not a
  bug. Check `document.hidden` before reporting a page as broken.
- Vite's dev server (`watch: { usePolling: true }`) can crash with an
  `EACCES: permission denied, lstat '.../frontend/.vite/deps'` error when
  restarting after a config/`.env` change, if run inside a sandboxed shell
  that blocks filesystem access to that cache path. Fix: run the frontend
  start command with the sandbox disabled, or run it directly in a normal
  terminal (not through a sandboxed tool).

## Checks

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q          # ~580 tests
cd frontend && npx tsc --noEmit -p tsconfig.app.json && npm run test && npm run build
```

CI (`.github/workflows/ci.yml`) runs these plus an import of the Vercel entrypoint
using only the root `requirements.txt`. Any package the backend imports at startup
must be in **both** `backend/requirements.txt` and the root `requirements.txt`.

## Deployment

Deploys to Vercel as a single project: `vercel.json` builds the frontend and
runs the FastAPI backend as a serverless function at `/api` via
`api/index.py`. See `VERCEL_DEPLOY.md` for the full walkthrough. Required
Vercel env vars: `MONGODB_URI` (Atlas), `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`,
`OLLAMA_MODEL`.
