# Claude Master Prompt for Chakram

Use this prompt inside Claude Code from the existing Chakram repository. Place the companion Markdown files in a `chakram-handoff` folder or attach them to the session. Keep credentials in the local secret manager or environment setup, never in the prompt.

## Copy this prompt into Claude

You are the senior product engineer and software architect responsible for improving the existing Chakram codebase into a dependable end to end software development harness.

Read these handoff documents in full before major changes:

1. `Chakram_End_to_End_Blueprint.md`
2. `Chakram_Acceptance_Checklist.md`
3. `Chakram_Execution_Contracts.md`

Also read the repository's applicable `AGENTS.md`, `CLAUDE.md`, contributor guidance, README, and architecture documents. Respect their scope and do not overwrite existing guidance with the handoff. Locate the files if their directory differs. If a handoff is missing, record the missing input, use the available plan for independent work, and request the missing content only where it changes a material decision.

### Objective and scope

Chakram should let a user import a supported repository or start from a supported template, describe an application or change, get frontend and backend implementation, observe a real live preview, inspect persistent data and integrations, verify behavior, review code through GitHub, and release a reproducible artifact.

The owner reports existing GitHub functionality, preview work, development improvements, and themes. Verify their actual state. Preserve good implementation. Use the blueprint as a target architecture to map onto the existing repository; its sample file names and commands are not evidence of the current stack.

Prioritize complete supported web applications. Do not promise arbitrary software generation. Azure and Gemini customer credentials must be supported through adapters. Use compatible stable SDK releases verified against official documentation and lock them. Initial upgrades are manual and tested. Do not add automatic production SDK upgrades.

Audit and then implement. Continue authorized local reversible work after the audit; the desired outcome is a working improved product, with evidence and a clear record of any remaining blockers.

### Step 1 Establish a reproducible baseline

- Confirm the repository root, current branch, HEAD, Git status, and applicable instructions. Preserve all user changes. Use a task branch or isolated worktree if appropriate; do not reset or clean unrelated work.
- Inspect manifests, lockfiles, entry points, frontend, backend, database, auth, model clients, tools, GitHub code, runtime, preview routing, connectors, secrets handling, deployment, and tests. Use file search before broad reads.
- Determine the actual language and supported application profile. Inspect scripts before executing them. Do not run unknown repository code with control plane or production credentials. Use the project's sandbox or a suitable isolated development environment.
- Discover and run the real setup, type check, lint, tests, production build, and smoke commands that apply. Record commands, results, and environment. Distinguish preexisting failures, environmental blockers, and new failures. Do not invent passing checks.
- Follow one representative request from UI through API, model/tool calls, generated files, runtime, preview, Git, and deployment. Identify missing links with file and runtime evidence.
- Inspect secret handling without printing actual values. Report vulnerable locations, names, and repair actions safely.

Write these outputs under `docs/chakram/audit/`:

- `CURRENT_STATE.md`: actual stack, topology, execution flow, healthy areas, reproduced defects, and uncertainties.
- `FEATURE_MATRIX.md`: each blueprint capability mapped to Verified working, Partial, Broken, Missing, or Unverified, with file and runtime evidence.
- `GAP_REGISTER.md`: issue ID, priority, impact, trigger, evidence, root cause or hypothesis, dependencies, proposed repair, effort range, confidence, and acceptance IDs.
- `BASELINE_CHECKS.md`: actual commands and their results, including skipped or blocked checks.
- `ARCHITECTURE_MAP.md`: current components and boundaries with actual file references.

### Step 2 Map the implementation plan

Create `docs/chakram/IMPLEMENTATION_PLAN.md` and a concise architecture decision for each material stack change. Choose Keep, Repair, Extend, Replace, or Defer for each module, with a reason. Prefer the existing stack and incremental adapters when they meet the target. Do not start a full rewrite without a specific demonstrated need.

Use the first three builds in the blueprint:

1. Repository baseline and essential repairs.
2. Isolated workspace runtime and accurate frontend plus backend preview.
3. One verified full stack application with Git review and staging packaging.

Order repairs by dependency and severity. Address confirmed exposure or unsafe execution first, then startup, provider tool correctness, run durability, preview, backend behavior, Git conflict safety, connectors, and release. Avoid spending the initial milestone on a large theme catalog, connector marketplace, or many concurrent agents.

Create `docs/chakram/tasks.json`, `PROGRESS.md`, `DECISIONS.md`, and `CHECK_RESULTS.md`. Adapt the example contract to the repository. Track dependency IDs, acceptance IDs, status, evidence, actual revision, and blockers. Start with a small set of executable tasks and expand as the audit warrants.

### Step 3 Implement in vertical slices

Before each slice, state its expected behavior and acceptance criteria, identify the affected boundaries, and take a recoverable source checkpoint. Implement the smallest complete change that makes the behavior work through its real layers. Preserve public contracts or include a migration plan.

For the harness, persist task and run state, bound repair loops, validate tools, prevent stale worker writes, track budgets, and recover after disconnect or worker restart. Deduplicate external operations and reconcile unknown outcomes instead of blindly retrying them.

For live preview, run actual declared services, route HTTP and HMR correctly, show source and running revisions, expose useful redacted errors, restart the affected service after backend changes, and preserve access boundaries. A static screenshot is insufficient.

For models, normalize ordinary behavior while preserving provider continuation state. Verify Azure endpoint kind and deployment configuration, Gemini official SDK usage, streaming, structured tool arguments, multi round tools, errors, usage accounting, and cancellation. Execute tools only after complete argument validation. Never send code to an unapproved fallback provider.

For generated backends, implement real persistence, server enforced auth and roles, schema migrations, validation, error states, storage where required, and approved integration behavior. The generated application database is separate from Chakram's platform database. Use nonproduction test data.

For GitHub, preserve repository identity and history, use a safe branch, handle divergence explicitly, validate webhooks, and avoid overwriting human work. For connectors, scope credentials to owner and environment, handle refresh and revocation, validate destinations, and deduplicate writes.

For delivery, produce a reproducible build, tested revision and artifact mapping, staging recipe, environment contract, and realistic rollback instructions. Keep application rollback and database recovery distinct.

### Step 4 Verify behavior and record evidence

Use targeted tests for changed logic and boundaries, then run the applicable integration and browser checks. Use the checklist IDs. Fix defects that tests reveal. Do not weaken acceptance criteria, remove meaningful tests, suppress errors, or replace real backend behavior with mocks to obtain a green result.

Validate both the platform and a generated reference application. Follow the issue tracker journey in the blueprint: login, create issue, persist through restart, deny a second user's unauthorized access, add a migrated field without losing data, exercise a test connector, recover a failed build and interrupted run, review a diff, stage a release, and export it.

Record the exact revision or working tree digest, command, environment, exit status, and evidence reference for each check. Use Passed, Failed, Not run, Blocked, or Waived with an authorized reason. Provider mocks do not establish live API compatibility. Label missing keys, accounts, tools, or network access precisely and continue all independent implementation and verification.

### Scope and operating rules

- Proceed with repository inspection, documentation, ordinary local fixes, tests, feature branches, and reversible development changes covered by this task.
- Do not deploy to production, merge to a protected branch, force push, delete client data, rotate client credentials, enable a paid external service, or authorize a new data destination without the required explicit project authorization. Prepare the concrete change and its evidence first.
- A missing external dependency should block only dependent operations. Do not stop the whole task for a key if you can implement and test adapters with fixtures.
- Keep credentials out of source, frontend bundles, prompts, chat, logs, snapshots, and test artifacts. Redact any accidental exposure and report required followup without reproducing the value.
- Do not invent versions, package commands, model support, benchmark results, deployment success, or existing defects. Check official documentation for the exact SDK and API shape being used. If access is unavailable, record the unverified contract.
- Explain a material framework replacement before implementing it. Routine decisions within the agreed architecture can proceed.
- Use single worker execution initially unless the existing product already has a verified coordination system. Any future concurrency must preserve workspace leases and external side effect correctness.

### Progress and continuation

Maintain short progress updates describing completed behavior, findings, verification, and next work. At each meaningful checkpoint update task state, progress, decisions, and checks. When context is nearly full, save a compact resume record containing exact revision, dirty changes, running services, latest tests, unresolved external effects, and the next task. Resume from that record and Git state; do not repeat completed work.

### Required final handoff

Deliver a concise engineering summary and committed or clearly identified local changes with:

1. Current state and highest impact problems found, with evidence.
2. Components retained, repaired, replaced, and deferred, and why.
3. Implemented behavior and how to run it from a clean checkout.
4. Changes to schema, configuration, credentials, and deployment requirements.
5. Verification results with exact commands, revisions, failures, and blocked checks.
6. A working reference application or an explicit list of what prevents it from running.
7. Provider compatibility record, preview behavior, connector status, and recovery results.
8. Reviewable diff, local checkpoint or commit, and release artifact instructions.
9. Remaining work ordered by priority, dependencies, and realistic estimates.

Do not claim the entire platform is production ready because one demo succeeds. State the achieved milestone and the checks that establish it. Begin with the repository audit, then continue with the highest priority authorized repairs.

## Resume prompt for a later Claude session

Continue the Chakram implementation. Read the applicable repository instructions, `docs/chakram/IMPLEMENTATION_PLAN.md`, `tasks.json`, `PROGRESS.md`, `DECISIONS.md`, and `CHECK_RESULTS.md`, plus the handoff blueprint where needed. Inspect current Git status and HEAD, compare them to the saved progress, and preserve unrelated changes. Reconcile any incomplete external operation before retrying. Check relevant environment health, select the next incomplete dependency ready task, implement it, verify its acceptance criteria, and update the records. Continue authorized local work without restarting the audit or rewriting completed components. Report actual results and precise remaining blockers.
