# SDLC Intelligence Suite Local Setup

## Project Overview

Two independent codebases that together form the "TestGen AI Suite" / SDLC Intelligence platform:

- **`backend/`** FastAPI service providing requirements analysis, test generation,
  code review, CI/CD intelligence, defect prediction, release gating, monitoring, sprint
  intelligence, an AI workspace/copilot, and integrations with GitHub, Jira, Slack, Datadog and Vercel.
- **`frontend/`** Vite + React + TypeScript SPA (shadcn/ui component library) that consumes
  the backend API.

They run as two separate processes locally: backend on `:8001`, frontend dev server on `:8081`
(Vite proxies `/api/*` requests to the backend).

## Architecture

```
frontend (Vite/React, :8081)
   │  /api/*  (proxied in dev, direct via VITE_API_URL in prod)
   ▼
backend (FastAPI, :8001)
   │
   ▼
MongoDB (Motor/PyMongo async driver)
   │
   ▼
Ollama (chat completions for AI features)
```

Both projects also deploy independently to Vercel (see each project's `vercel.json`).

## Required Software

| Tool | Version | Notes |
|---|---|---|
| Python | 3.12+ | Project requires `>=3.12` (pyproject.toml). System Python is often older install via Homebrew: `brew install python@3.12`. |
| Node.js | 18+ (tested on v26) | |
| npm | bundled with Node | **This is the standardized package manager for the frontend** do not mix in `bun` or `yarn`. |
| Docker | any recent version | Used to run MongoDB locally. |
| Git | any | |

## Database Setup

The backend uses MongoDB via Motor (async driver). For local development we run MongoDB in Docker
rather than depending on a shared/remote Atlas cluster:

```bash
docker run -d --name aidlc-mongo -p 27017:27017 -v aidlc-mongo-data:/data/db mongo:7
```

This persists data in the `aidlc-mongo-data` Docker volume. To stop/start:

```bash
docker stop aidlc-mongo
docker start aidlc-mongo
```

No migrations or seed scripts exist in this project MongoDB collections and indexes are created
on demand by the application (see `app/services/baseline_store.py:ensure_indexes` for an example
run automatically at startup).

## Environment Variables

### Backend (`backend/.env`)

Copy `.env.example` to `.env` and fill in the values you need:

```bash
cd backend
cp .env.example .env
```

| Variable | Required for | Notes |
|---|---|---|
| `MONGODB_URI` | Everything | `mongodb://localhost:27017` for the Docker container above. |
| `MONGODB_DB` | Everything | Defaults to `aidlc`. |
| `OLLAMA_BASE_URL` / `OLLAMA_API_KEY` / `OLLAMA_MODEL` | AI-powered routes (requirements analysis, test generation, copilot, PRD generator, etc.) | Local Ollama or Ollama cloud (https://ollama.com with an API key). The server starts fine without these, but AI calls will fail. |
| `GITHUB_TOKEN` / `GITHUB_REPO_ID` | GitHub integration, Vercel deploy status | |
| `VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID` / `VERCEL_PROJECT_NAME` | Deployment status routes | |
| `JIRA_DOMAIN` / `JIRA_EMAIL` / `JIRA_TOKEN` | Jira integration | |
| `SLACK_WEBHOOK_URL` | Slack notifications | |
| `CORS_ORIGINS` | Always | Already includes `localhost:8081` (Vite dev server). |

> **Security note:** `app/config.py` currently ships hardcoded fallback values for several of the
> secrets above (a MongoDB Atlas URI, a Jira token, a Slack webhook, Datadog keys). Those are
> real-looking credentials committed to source and were **not used** for this local setup the
> `.env` file above overrides them with local/blank values instead. This should be cleaned up
> (move to `.env`-only, no hardcoded defaults) and the credentials should be rotated by whoever
> owns them, independent of this onboarding.

### Frontend (`frontend/.env`)

```bash
cd frontend
cp .env.example .env
```

| Variable | Notes |
|---|---|
| `VITE_API_URL` | Leave **blank** for local dev the app falls back to `/api`, which Vite proxies to `http://localhost:8001`. Only set this when pointing at a deployed backend (see `.env.production`). |

## How to Start the Backend

```bash
cd backend
python3.12 -m venv .venv          # first time only
source .venv/bin/activate
pip install -r requirements.txt   # first time / after dependency changes
docker start aidlc-mongo           # if not already running
uvicorn main:app --reload --port 8001
```

Verify: `curl http://localhost:8001/health` → `{"status":"healthy"}`

## How to Start the Frontend

```bash
cd frontend
npm install                       # first time / after dependency changes
npm run dev
```

Verify: open http://localhost:8081

Run both at once from two terminals (or use a process manager of your choice there's no
monorepo tool wiring them together).

## How to Build

```bash
# Frontend production bundle
cd frontend && npm run build     # outputs to dist/

# Backend has no build step (interpreted Python); for prod it runs via Vercel's
# Python runtime per backend/vercel.json.
```

## How to Run Tests

```bash
# Frontend
cd frontend && npm run test        # vitest run
cd frontend && npm run test:watch  # watch mode

# Backend: no test suite exists in this repository yet.
```

## How to Reset the Database

```bash
docker rm -f aidlc-mongo
docker volume rm aidlc-mongo-data
docker run -d --name aidlc-mongo -p 27017:27017 -v aidlc-mongo-data:/data/db mongo:7
```

## Common Issues / Troubleshooting

- **`ModuleNotFoundError: No module named 'git'`** on backend startup `requirements.txt` was
  missing `gitpython` and `playwright` (present in `pyproject.toml` but never synced into the lock
  file used for `pip install`). This has been fixed by regenerating `requirements.txt`; if it
  reappears after adding a new dependency to `pyproject.toml`, install it manually and run
  `pip freeze > requirements.txt` inside the venv.
- **Playwright browser missing** routes that use `app/services/playwright_service.py` need a
  browser binary installed once: `python -m playwright install chromium` (run inside the venv).
- **`pip install` fails on Python <3.12** check `python3 --version`; this project requires 3.12.
  On macOS: `brew install python@3.12`, then create the venv with
  `/opt/homebrew/bin/python3.12 -m venv .venv`.
- **Backend starts but DB calls fail** confirm `docker ps` shows `aidlc-mongo` running and
  `MONGODB_URI=mongodb://localhost:27017` in `.env`.
- **AI routes return errors** `OLLAMA_API_KEY` is blank by default;
  supply an Ollama cloud API key (https://ollama.com/settings/keys) or run a local Ollama server.
- **CORS errors in the browser** only happens if you bypass the Vite proxy and call the backend
  directly from a page served on a non-listed origin; `CORS_ORIGINS` in `.env` covers `:8081`.
- **`tsc --noEmit` reports 2 pre-existing type errors** (`use-live-testing.ts`, `use-prd.ts`) —
  these predate this setup and don't block `npm run build` (Vite doesn't type-check on build with
  this config) or `npm run dev`. Worth fixing separately.
- **`npm run lint` reports ~150 pre-existing errors** (mostly `@typescript-eslint/no-explicit-any`)
  spread across many files; left untouched here as out-of-scope tech debt rather than a
  large, unrequested rewrite.
