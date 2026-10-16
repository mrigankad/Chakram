# Chakram implementation plan

Date: 2026-10-16. Baseline revision `3c2dbb4`. Companion documents: `audit/CURRENT_STATE.md`, `audit/FEATURE_MATRIX.md`, `audit/GAP_REGISTER.md`, `audit/ARCHITECTURE_MAP.md`, `audit/BASELINE_CHECKS.md`, `DECISIONS.md`, `tasks.json`.

This plan answers three questions the owner asked:

1. Which features are not earning their place, and what is the streamlined product?
2. How does Chronos become a design system a client (for example Mahindra) can **install** so every generated app and every Chakram screen follows it?
3. How does generation stop paying for the same tokens on every build, with an API structure that is the same every time?

The blueprint's own order (audit → workspace runtime → one verified full-stack path) still applies. This plan sits inside that order: the templatization work below *is* the "golden template" and "model adapter" that Build 3 needs, so doing it first does not detour from the blueprint. It also does not start the full harness rewrite (durable runs, leases, sandboxes); those stay in the blueprint backlog as CHK 04–08 and are sequenced after this plan's first two phases.

---

## 1. The streamlined product

Chakram today has 31 pages, 34 route modules and 40 services. The audit (`audit/FEATURE_MATRIX.md`) sorts them into four groups. The headline: **one core loop, five supporting features, and roughly half the surface area is either a demo, a duplicate of another page, or unreachable without an integration the product does not have.**

### Core loop (keep, invest)

```
 Describe ──► Build ──► Preview ──► Verify ──► Review ──► Release
 (idea/PRD)  App Studio  live iframe  Test Suite  Code Review  Deploy
                                      + Execution              (Vercel)
```

| Stage | Page(s) | Backend | Status |
| --- | --- | --- | --- |
| Describe | `/ai-ide` idea screen, `/prd` | `prd`, `ai_ide` | Partial. PRD → App Studio is a copy-paste, not a link. |
| Build | `/ai-ide` | `engines/*`, `ai_ide_generation`, `template_service`, `chronos_kit` | Works for frontend-only apps with mock data. |
| Preview | `/ai-ide` Live tab | `preview-runtime.js` | Works; browser-only, depends on esm.sh and Tailwind CDN. |
| Verify | `/generated-tests`, `/test-execution`, `/live-testing` | `test_cases`, `test_execution`, `execution_service`, `playwright_service` | Works against any URL; not yet pointed at the app that was just built. |
| Review | `/code-review`, `/workspace` | `github`, `workspace`, `git_ops`, `commit` | Works for public repos. |
| Release | Push & Deploy in `/ai-ide`, `/deployments`, `/release-gate` | `vercel_service`, `release_gate` | Works for one Vercel project; Release Gate needs CI + Jira signals. |

### Supporting (keep, do not expand)

Requirements (`/requirements`), Synthetic Data (`/synthetic-data`), Risk Ranking (`/prioritization`), Connectors (`/settings/connectors`), Usage & Cost (`/cost-tracker`), Profile and auth.

### Park behind a feature flag (hidden from the sidebar until an integration is actually configured)

CI Health, Sprint Health, Release Gate, Incidents. Each one is honest code that returns "not configured" without Jira/CI data, which means a fresh install shows empty pages. Show them only when the connector that feeds them is saved. This is a one-file change (`nav-config.ts` reads connector status) and no backend removal. Usage & Cost, which today has no link at all, gets a sidebar footer entry.

### Merge or remove

See `audit/FEATURE_MATRIX.md` for the per-page verdicts and evidence. The short version:

- Merge the "which tests should I run" pages into one: Test Baseline, Test Selection and Root Cause all read the same `repo_baselines` / `playwright_runs` data and each has its own list UI. One "Test Suite" page with tabs (Cases, Baseline, Selection, Root Cause) replaces four sidebar items.
- Fold Test Repair into Live Test Run (which already has inline heal/approve/reject) and Tests from Docs into Live Test Run's spec/document upload (it hands off there through sessionStorage today).
- Merge Code Impact into Code Workspace: both draw the same workspace graph (`TreeFlowView.tsx:898` vs `CodeImpact.tsx`).
- Merge the manual-story half of Requirement Insights into Requirements; its Jira half is parked with the other Jira pages.
- Keep `/pipeline` as the **one guided loop**. Its five stage components (2,500 lines) already reuse Workspace, Code Review, Deploy and Live Test; the fix is to make its report read Chakram's own stored results instead of client-supplied counts (GAP-13), and to stop the standalone pages from re-implementing the same stages.
- Remove Metric Anomalies from the sidebar (demo-only). Keep the z-score and projection functions for when a real series source exists.
- Retire the legacy (non-kit) generation prompts and the Mongo `Templates` override once design packs exist (section 2); they are a second template system nobody seeds.

Nothing is deleted in the first phase. Pages leave the sidebar and routes stay reachable, so no data or deep link breaks. Deletion is a later decision once usage confirms the cut.

---

## 2. Chronos as an installable design system ("design packs")

### What exists

Theming is per app, after generation, and limited to five knobs: mode, accent, surface tint, four status colours, six chart colours (`frontend/src/lib/theme-engine.ts:14-20`). Fonts are ten Google fonts, radius is one multiplier (`app-design.ts`). The kit's 426-line `tokens.css` is copied into every app and overwritten on every kit upgrade, so a client's hand-edited tokens would be lost. There is no logo, no favicon, no typography scale, no spacing or density control, no shell variant, no org-level default, and Chakram's own frontend uses a *different* token vocabulary (`text-ink*`, `border-stroke-muted`) from the kit (`text-primary`, `border-muted`), so the product and the apps it generates cannot share one theme file.

### Target: one pack format, three consumers

A **design pack** is a versioned folder that fully describes a client's visual system. The same pack is consumed by (a) the Chronos kit inside generated apps, (b) Chakram's own frontend, and (c) the prompt builder, so the model is told what the client calls things.

```
design-packs/<pack-id>/
  pack.json          id, name, version, kit_compat, default mode, density, radius scale,
                     font roles (sans, display, mono) with source (google | self-hosted),
                     logo + favicon references, shell variant, status/chart tone names
  tokens.css         full tier-1 palette + tier-2 semantic tokens, light and dark
  theme.json         Tailwind extend: colours, fontSize, spacing, borderRadius, boxShadow
  brand/             logo-light.svg, logo-dark.svg, mark.svg, favicon.ico
  fonts/             optional self-hosted woff2 + fonts.css
  marks/             optional client icon set (same manifest shape as marks_manifest.json)
  overrides/         optional kit component overrides (app-shell.tsx for a top-nav variant)
  README.md          voice and usage notes fed to the planner (what to call things, tone)
```

Rules that make this safe:

- Pack files live in `src/design/` inside a generated app, **never** in `src/chronos/`. The kit upgrade (`kit.outdated_kit_files`) keeps replacing `src/chronos/*` and never touches `src/design/*`.
- The kit reads only CSS variables and Tailwind semantic classes. A pack can override every variable; the kit never hard-codes a font, colour or radius (today `tokens.css:356` hard-codes Geist on `body`, and the sidebar uses `w-[252px]`; those move to tokens).
- `chronos` (the default pack) is just the first pack in the folder. It is what ships today, extracted.
- Packs are stored per org in Mongo (`design_packs`) with the same file-mirroring as `ai_ide_files`, uploaded as a zip through Settings → Design System, validated on upload (token completeness, contrast ratios via `contrastRatio()`, font availability, logo presence).
- Chakram's frontend adopts the kit token names (one-time rename of `text-ink*` → `text-primary` etc., mechanical, covered by `tw-classes.test.ts`), then loads the org's active pack at login. That is how "install Mahindra" also re-skins Chakram itself for that tenant.

### How a client install works end to end

1. Upload `mahindra.zip` in Settings → Design System. The validator reports missing tokens and contrast failures; nothing is saved until it passes.
2. Mark it the org default. Existing apps are untouched; new apps get `src/design/*` from the pack at creation and `design.json.pack = "mahindra@1.0.0"`.
3. Planner and composer prompts receive the pack's `README.md` and the pack's tone names, nothing else changes in the prompt.
4. The Design tab's theme editor becomes a *delta over the pack* (same five knobs), written to `src/design/overrides.css`, so a client's pack is never edited in place by a page author.
5. Chakram's own shell loads the pack's `tokens.css` and brand assets for that org.

### Scope added to the kit so pages stop hand-writing UI

The audit found pages hand-write buttons, inputs, tabs, dialogs, forms and toasts because the kit has none. Every hand-written control is output tokens and inconsistency. Add to the kit, in this order: `Button`, `IconButton`, `TextField`, `Textarea`, `Checkbox`, `Switch`, `Tabs`, `Dialog`, `Drawer`, `Toast`, `FormRow`, `Breadcrumbs`, `Card` variants, `Skeleton`. Each is tone/size enums only, like `KpiTile`, and each gets one line in the kit reference.

---

## 3. Cheaper, repeatable generation ("spec first, compose second")

### The cost today

Per the App Builder audit: a 5-page app is 1 planner call plus 6 file calls, about 34K prompt tokens, of which about 20K is the same `KIT_API.md` re-sent six times, including to the data file that cannot use it. Variable text comes *before* the static reference in every prompt, so even a provider with prefix caching would get no hits. There is no schema validation of the plan, no retry, no compile check, and the data file and page prompts give contradictory instructions about where mock data lives.

### Phase A: fix the prompts (days, not weeks; no architecture change)

1. Put the static material in a **system message** in this order: role → kit reference → pack notes → style rules. Put all variable material (path, purpose, routes, context files, marks) in the **user message**. This makes the static prefix identical across the six calls, which is what any prefix cache keys on.
2. Split `KIT_API.md` into per-role sheets: `page.md` (~4K chars), `data.md` (~0.6K), `component.md` (~1.5K), `charts.md` only when the plan names a chart. The data file stops receiving the kit reference and marks.
3. Validate the plan with a Pydantic model (`AppPlan`) and one repair call on failure; reject >5 pages, missing `/` route, routes with no file, unknown mark ids.
4. Remove the contradiction: the data file owns all data; pages get "import only" (one sentence).
5. Log `workspace_id`, run id and file path on every `api_cost_logs` row, and put total tokens in `GENERATION_DONE`, so the next phases can be measured instead of estimated.
6. Fix `KIT_API.md` drift (version 6 vs 8, charts "not re-exported", series 1–10 vs 6) and add a test that the reference names only things `index.ts` exports.

Expected effect: about 34K → about 14K prompt tokens for the same app, with the identical prefix cacheable where supported, and fewer broken builds from unvalidated plans.

### Phase B: the app spec and a deterministic composer

The bigger saving is to stop asking the model to write TSX for things the kit already knows how to lay out. The planner today already describes each page as a blueprint in prose ("KpiGrid: 4 KpiTiles | SplitRow: Chart + BarList | DataTable of bookings"). Make that structure the contract:

```jsonc
// app.spec.json (validated by a JSON Schema + Pydantic model)
{
  "app": { "name": "Clinic Appointments", "pack": "chronos@1" },
  "entities": {
    "Appointment": { "fields": { "id": "id", "patient": "string", "doctor": "ref:Doctor",
                     "start": "datetime", "status": "enum:scheduled|done|cancelled", "fee": "money" } },
    "Doctor":      { "fields": { "id": "id", "name": "string", "speciality": "string" } }
  },
  "pages": [
    { "path": "/", "title": "Overview", "icon": "LayoutDashboard", "mark": "mark-command",
      "blocks": [
        { "type": "kpis", "items": [
          { "label": "Appointments today", "metric": "count(Appointment where start=today)" },
          { "label": "Revenue (month)",    "metric": "sum(Appointment.fee, month)", "format": "currency" } ] },
        { "type": "split", "ratio": "1.4/1", "children": [
          { "type": "chart", "kind": "line", "series": "count(Appointment) by day, 30d" },
          { "type": "barlist", "rows": "top(Doctor, count(Appointment), 5)" } ] },
        { "type": "table", "entity": "Appointment", "columns": ["patient","doctor","start","status","fee"],
          "search": true, "badge": "status" }
      ] }
  ]
}
```

- The **planner** emits this spec in one call (1.5–3K prompt tokens, 1–2K output). It is the only creative call per app.
- A **composer** (plain Python, no model) renders `src/pages/*.tsx`, `src/data/*.ts`, routes and nav from the spec using kit components. Output is deterministic, always compiles, and always follows the pack. A block vocabulary of about 12 types (kpis, chart, table, barlist, split, grid, panel, form, detail, list, empty, custom) covers the dashboards and CRUD screens the product targets.
- `custom` blocks are the escape hatch: only those go to the model (one call per custom block, with the page sheet and the block's data shape), so token spend scales with how unusual the app is, not with its page count.
- A spec is editable. The Design tab's visual edit keeps working because the composer tags source the same way (`data-csrc`), and a text/class edit writes back to the composed file as it does today; a structural edit writes back to the spec and recomposes.

Expected effect for the same 5-page app: 1 planner call (~3K) + 0–2 custom block calls instead of 7 calls at ~34K. Output tokens drop from ~10K to ~2K. Builds become reproducible, which the acceptance checklist needs (REL 02, REL 05).

### Phase C: the repeatable API structure

Generated apps have no data layer: the planner asks for "typed mock data" and no prompt mentions an endpoint (audit, section B). The owner's instinct is right that the API should be the same every time, and the spec above is what makes that possible: **entities in the spec generate the backend deterministically too.**

```
<app>/
  api/                      "Chronos API kit", fixed layout, generated from app.spec.json
    schema/                 one migration per entity change (expand/contract, additive first)
    src/entities/<Entity>.ts   zod schema + types (the single source for client and server)
    src/routes/<entity>.ts     list/get/create/update/delete with filter, sort, page, org scope
    src/auth/                  session + roles (owner/member/viewer), server-enforced
    src/index.ts               app factory, health/ready, error envelope {code, message, retryable, correlation_id}
  src/api/client.ts         typed client generated from the same entity files; pages use react-query hooks
  src/data/seed.ts          the seed replaces today's mock data; it is loaded into the dev database
```

Rules:

- The API shape is **never** written by the model. It is a template plus the entity spec. The model only contributes entity fields and business rules it can express in the spec (derived fields, validation ranges, state transitions). Anything beyond that is a `custom` block on the server side, reviewed like a custom UI block.
- Pages bind to hooks (`useList(Appointment, {filter})`), so the composer emits the same TSX whether data is seeded or live. The preview can run against an in-browser store that implements the same hook contract (no backend needed for Live preview), while the exported app runs the real API. That keeps today's preview working while giving exports a real backend.
- The language choice for the API kit is recorded in `DECISIONS.md` (ADR-3). Recommended: TypeScript (Hono or Fastify) + PostgreSQL + Drizzle migrations, so an exported app is one language, deploys to Vercel as it does today, and matches the blueprint's supported profile. Chakram's own backend stays FastAPI; the two are unrelated.

This is also where the blueprint's "verified full-stack path" (Build 3: issue tracker with auth, persistence, migrations, denied access) becomes achievable: the issue tracker is just a spec with three entities and five pages.

---

## 4. Point Verify at what Build just made

The verify stage today takes any URL. The missing link is small: when a build finishes, register the app (preview URL or deployed URL) as a test target and generate test cases **from the spec**, not from free-text requirements. A spec page with a table block implies "the table lists N seeded rows, search filters them"; a form block implies create/validate/persist cases. Those are deterministic too, so the Test Suite for a generated app is produced with zero model calls and executed by the existing `execution_service` against the deployed URL. This closes the loop the owner described ("from building the tool to testing it") with code that already exists.

---

## 5. Phases, order and estimates

Single engineer with Claude assistance; ranges are working days. Each phase ends with its checks in `CHECK_RESULTS.md`.

| Phase | Work | Depends on | Exit check | Est. |
| --- | --- | --- | --- | --- |
| 0 | This audit; sidebar flags for unconfigured integrations; merge nav of the five test pages | — | Clean checkout starts, FEATURE_MATRIX agreed | 1–2 d |
| A | Prompt restructure, per-role sheets, plan validation, cost logging per run, KIT_API drift test | 0 | Same app ≤ 15K prompt tokens, plan validation tests, build still green | 3–4 d |
| D1 | Extract `chronos` design pack; move hard-coded font/width to tokens; `src/design/` in apps; pack upload + validator; org default | A | Upload a second pack (a test "Mahindra-like" pack) and generate an app that uses it; kit upgrade leaves `src/design/` intact | 5–7 d |
| D2 | Chakram frontend adopts kit token names and loads the org pack | D1 | `tw-classes.test.ts` green for both; Chakram re-skins per org | 3–4 d |
| B | `app.spec.json` schema, planner emits spec, composer renders 12 block types, custom-block escape hatch, spec-aware visual edit | A | 5-page app: 1 planner call + ≤2 custom calls; composed output passes `tsc` in a golden test | 8–10 d |
| K | Kit controls: Button, TextField, Tabs, Dialog, Toast, FormRow… | D1 | Each documented in the role sheets; used by the composer's `form` and `detail` blocks | 4–5 d |
| C | API kit from entities (ADR-3), typed client + hooks, in-browser store for preview, seed loader, migrations | B | Blueprint Build 3 journey steps 5–8 pass on an exported issue tracker | 10–12 d |
| V | Spec-derived test cases; "test this app" after build; results linked to the workspace | B, C | Build → Verify with zero manual input on a generated app | 4–5 d |
| H | Blueprint harness items (durable runs, leases, sandboxed exec, provider adapters for Azure/Gemini) | — | per CHK 04–08 | after the above |

Phases A and D1 are the first two to do; both are reversible, both are measured by tests that exist or are added, and both reduce cost immediately. Phase B is the one that changes what the model is asked to do and should be behind a flag (`AI_IDE_COMPOSER=1`) until its golden tests pass.

---

## 6. Why this does not conflict with the blueprint

The blueprint's first promise is "complete web applications on a declared supported stack, with a live preview, persistent backend, version history and verification evidence". Design packs give the declared stack a declared look; the spec and composer give the model a smaller, checkable job; the API kit gives the persistent backend; spec-derived tests give evidence. The harness hardening (durable runs, leases, sandboxes, Azure and Gemini adapters) is still required for a client pilot and is listed as phase H with the blueprint's own IDs; it is not displaced, only sequenced after the work that makes the product's output cheap and consistent.
