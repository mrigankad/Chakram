# Product direction: how the two halves become one product

Date: 2026-10-16. Decisions taken by the engineering lead on the owner's instruction ("take the decisions on your own for now"). Each is reversible and recorded as an ADR in `DECISIONS.md` (ADR-6 to ADR-9).

## 1. The two halves and the one object that joins them

Chakram has a **build** half (App Studio: spec → composed app → API kit → design pack → push → deploy) and a **delivery** half (requirements, test cases, browser execution, risk ranking, code review, CI health, release gate, incidents). Today they meet only through a URL typed into Test Execution.

**Decision (ADR-6): a Project is the unit of the product.** One app = one project. A project record holds what both halves need:

| Field | Written by | Read by |
| --- | --- | --- |
| `workspace_id`, `pack_id`, `spec` summary | App Studio at creation | everything below |
| `repo` (owner/name, default branch) | Push & Deploy | Code Review, CI Health, Change Hotspots, Workspace |
| `deployments[]` (Vercel id, url, state, revision) | Deploy | Test Execution target, Release Gate, Operate |
| `requirement_id` | Test this app | Test Suite, Test Execution, Risk Ranking |
| `runs[]` (test run ids with pass rate) | Test Execution | Release Gate, Dashboard |
| `connections` (which connectors this project uses) | Settings | gating, health |

The Pipeline page becomes the **project view** with five stages that read this record: **Build** (spec, files, last generation usage) → **Verify** (spec-derived cases, last run, pass rate) → **Review** (open PRs on the project's repo, model review) → **Release** (deployments; the gate reads the project's own test results, not Jira) → **Operate** (the deployed app's `/api/health` and `/api/ready`, uptime since last deploy, incidents linked to the project). Every stage shows "not evaluated" until its input exists.

Imported repositories become projects too (source = repo instead of workspace); the delivery stages work on them without the Build stage.

**Why this and not "a bigger Pipeline page":** a record that every feature writes to and reads from is the only way the dashboard, release gate and risk ranking stop being separate silos with their own inputs. It is also the blueprint's `Project` / `Environment` / `Deployment` model, so the harness work (durable runs, leases) attaches to it later.

## 2. Connectors: what stays, what goes, and how they stay healthy

What each connector actually does today, from the code (`audit/FEATURE_MATRIX.md` and `services/*_service.py`):

| Connector | Real use today | Decision |
| --- | --- | --- |
| **Ollama** (model) | Every AI feature | Keep. Becomes the first entry of the provider registry (Azure, Gemini later via the same interface, ADR-4). |
| **GitHub** | PR review, commit review, workflow runs, push from App Studio and Workspace, change hotspots | Keep, first-class. The project's repo is the source of truth for code. |
| **Vercel** | Deploy App Studio apps and tracked repos | Keep. The project's deployment target; one Vercel project per app (GAP-17). |
| **Jira** | Read stories (Requirement Insights, Sprint Health), read open bugs (Release Gate, Pipeline), write acceptance criteria as a comment | **Keep, narrowed to two jobs**: import stories as requirements and write results back. Sprint analytics and DORA (computed from GitHub anyway) are retired with the Sprint Health page. The gate stops depending on Jira bugs (it reads the project's own test results); Jira bugs become an optional extra signal. |
| **Slack** | Three one-way notifications (release blocked, critical anomaly, incident created) | Keep as the only implementation of a `notify` interface. Notifications become project events ("build finished", "tests failed", "deployed"); the demo-anomaly one goes with Monitoring. |
| **Datadog** | A push nobody reads (`tag_dataset_analysis` from the demo Monitoring page); `get_events` has no caller | **Remove.** It implied an observability integration that does not exist. Operate gets real signals from the deployed app's own health endpoints first; a metrics vendor returns only when a project needs it. |
| **WorkOS** | Optional SSO | Keep as auth, not a "connector" in the product sense. |

**Decision (ADR-7): one connector registry.** `backend/app/services/connector_registry.py` is the only list of connectors. Each entry declares its kind, secret fields, what features it **feeds**, the **API version** it is written against, and a **read-only check** (GitHub `rate_limit`, Jira `myself`, Vercel `user`, Ollama `tags`, Slack URL shape). The Settings page, the sidebar gating and readiness read from it. Adding a connector means adding one entry and one service module, nothing else.

**How they stay updated**
- Every call site pins the API version the registry states (GitHub `X-GitHub-Api-Version`, Jira `/rest/api/3`, Vercel `/v13`). A version bump is a registry change plus a test, never an ad-hoc edit in a route.
- "Check connection" runs the read-only probe on demand and stores `{ok, message, checked_at}` on the organization; the sidebar and project view show stale or failing connectors instead of discovering it inside a feature.
- Credentials stay org-scoped with the platform fallback that already exists; secrets never leave the server (the audit's SEC 01 fixes hold).
- Each connector has a contract test against recorded fixtures (`tests/test_connector_*`), so an upstream shape change fails CI, not a customer run.
- OAuth, refresh and webhooks (blueprint §13) come only for connectors a project needs; GitHub App installation first, because it removes the shared-token problem.

**Rule for new connectors:** a connector is added only when a project stage needs it and a check can prove it works. No connector without a feed; no feed without a page that shows its data.

## 3. Next plan, in order

| # | Slice | What it delivers | Depends on |
| --- | --- | --- | --- |
| 1 | **Connector registry + Datadog removal** (this commit) | One registry, status + check endpoints, Settings shows what each connector enables and whether it works; Datadog gone; Incidents gated on Slack | — |
| 2 | **Project record** | `projects` collection; App Studio creates one; Push, Deploy and Test this app update it; `GET /projects`, `GET /projects/{id}`; Dashboard lists projects | 1 |
| 3 | **Project view** | Pipeline page reads the project record; the five stages above; Release Gate scores the project's own test run (Jira bugs optional); Operate pings the deployed app's health | 2 |
| 4 | **Write paths in composed apps** | `form` and `detail` blocks; pages call `api.<collection>.create/update/remove`; spec-derived cases cover create/edit; the blueprint's issue-tracker journey (sign in, create, reload, deny another org) runs end to end against the API kit | — |
| 5 | **Chakram wears the pack** | Chakram's own frontend adopts the kit token names and loads the org's design pack (D2) | — |
| 6 | **Jira narrowed; Sprint retired** | Jira = import stories as requirements + write results back; Sprint Health and the DORA endpoints removed; Release Gate's Jira signal optional | 3 |
| 7 | **Provider registry** | Azure OpenAI and Gemini adapters behind the same `complete()` interface, per-org provider profiles with a tested-capabilities record (blueprint §9) | 1 |
| 8 | **Durable runs** | Generation and test runs persisted with sequence numbers, leases and cancel (blueprint §8); needed before more than one worker | 2 |
| 9 | **Cleanup** | Dead code and unused packages (T-004), kit controls (T-050), spec-aware visual edit | any time |

Slices 1 to 3 make Chakram one product with one object in the middle. Slice 4 makes the build half produce complete apps. Slice 7 and 8 are what the client pilot needs.

## 4. What "a really good product" looks like at the end of this plan

A client installs their design pack once. A product owner describes an app; Chakram plans a spec, composes the pages and the API, seeds it, previews it, pushes it to a repo the client owns and deploys it. The same screen then derives the acceptance cases, runs them in a real browser against the deployment, reviews the pull request, and shows a release gate scored on those results. After release, the project view shows the app's health and links incidents to a repair run. Every number on every screen is computed from something that happened; every connector shows what it enables and whether it works; the model writes only what a program cannot.
