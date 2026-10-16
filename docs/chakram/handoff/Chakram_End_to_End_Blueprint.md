# Chakram End to End Blueprint

_Converted from the owner-supplied .docx with pandoc on 2026-10-16; the architecture diagram image was not carried over._

Version 1.0 \| 16 October 2026 \| Wayam AI

Audience: Chakram product and engineering team, and Claude working
inside the Chakram repository.

# 1 Product decision

We should develop Chakram into a repository based platform that turns a
request into a running, tested, reviewable application. A user should be
able to import a supported application or start from a template,
describe a change, see it running, inspect its backend and data, review
the code, and release it through a controlled deployment process.

The harness is the software around the model: workspace, tools,
execution environment, project context, recovery, verification,
permissions, and delivery. Improving these parts is the main engineering
task. Themes and better prompts contribute to the experience, but
completion must be established by observable application behavior.

The initial product promise should be: **Chakram builds and maintains
complete web applications on a declared supported stack, with a live
preview, persistent backend, version history, and verification
evidence.** Expansion to other languages, mobile apps, specialized
infrastructure, and larger distributed systems should follow
demonstrated capability.

Our intended differentiation is existing repository support, Azure and
Gemini credentials supplied by the customer, transparent execution,
portable source code, backend verification, and predictable recovery.
These are target capabilities to build and measure. We should claim
superiority to another product only after comparative testing.

## Present state and audit boundary

The product owner reports that Chakram has GitHub related functionality
and that recent work includes development improvements, live preview
work, and themes. Claude must establish the actual implementation and
health of each through the repository audit in Section 23. Treat each as
reported functionality until verified. The architecture below is the
target design and can be mapped onto suitable existing modules.

## What complete means

For a supported application, complete includes requirements, a running
frontend, server side business rules, persistent data, authentication
and authorization, integrations, tests, a reproducible build,
environment configuration, deployment instructions, and operational
visibility. Authentication belongs to the generated application as well
as the Chakram platform. Backend delivery must include migrations and
real persistence rather than a UI that only changes local state.

Some projects need external account setup, vendor verification, domain
ownership, or decisions on requirements. Chakram should expose these as
precise dependencies and continue independent work. It should not
silently simulate them or mark an untested integration complete.

# 2 Research and implications

Research was checked against the official sources in Section 27 on 16
October 2026. Product features and SDK behavior can change;
implementation should confirm the selected versions and account
capabilities.

## Lovable as a product benchmark

Lovable documents frontend and backend generation with Cloud database,
authentication, storage, functions, and hosting \[S1\]. It also
documents browser testing, frontend tests, and backend function
verification \[S2\]. GitHub synchronization supports code export and two
way branch synchronization; its documented integration currently lists
importing existing repositories as a limitation \[S3\]. Its connector
engineering account describes a gateway that owns credentials and
handles token refresh \[S4\].

For Chakram, the useful benchmark is an integrated workflow covering
code, runtime, backend, testing, and publishing. Existing repository
onboarding is a promising product emphasis. We should make connector
credentials and refresh behavior deterministic platform services.

## Long running coding harnesses

Anthropic describes persistent feature lists, incremental work, Git
history, and progress artifacts to carry work across sessions \[S5\].
Later work explores planning, generation, and evaluation, with browser
based checking of application behavior, and emphasizes testing the value
of extra harness complexity \[S6\]. Its tool engineering guidance
emphasizes clear tools and evaluation \[S7\].

Our design uses a persisted task list, checkpoints, and executable
acceptance checks. Start with one coding worker and a separate
verification stage. Add specialist concurrency only when evaluations
justify the added cost and coordination.

## Runtime and framework options

OpenHands offers a software engineering SDK with tools, workspaces,
persistence, and a REST based agent server \[S8\]. E2B documents managed
sandbox lifecycle operations \[S9\]. WebContainers executes Node.js
workloads in the browser, with browser compatibility and native addon
limitations \[S10, S11\]. Vercel AI SDK provides an abstraction for
model access and tools \[S12\].

Use these as integration candidates. A browser runtime is useful for
fast compatible previews; server side isolated execution remains
necessary for the supported backend, services, private credentials, and
representative deployment checks. Select one execution backend and one
model orchestration approach for the first milestone.

## Model integration facts

Microsoft documents an Azure OpenAI v1 API with OpenAI client support,
Azure deployment names, and no mandatory dated api version on that v1
route \[S13\]. Google recommends Google GenAI SDKs, including
@google/genai for TypeScript and google-genai for Python \[S14\]. Gemini
function calling leaves tool execution to the application \[S15\];
thinking related state has its own documented handling \[S16\].

We should verify deployed model capabilities in each customer account
and preserve provider specific state. A common chat interface alone
cannot guarantee correct tool execution or feature parity.

## Security and workflow references

GitHub documents installation scoped App authentication and webhook
validation \[S17, S18\]. MCP documents specific authorization and
security considerations \[S19\]. Playwright supports starting
application servers for browser tests \[S20\]. Temporal is an option for
durable workflows when complexity warrants it \[S21\]. Renovate is an
optional source of dependency update proposals \[S22\].

The remaining architecture, priorities, timings, budgets, schemas, and
acceptance thresholds in this document are proposed engineering
decisions. They are not vendor performance claims.

# 3 First three builds

## Build one Repository audit and reproducible baseline

Establish what works, preserve it, and make the application start
reliably from a clean checkout. Produce a file evidenced inventory,
baseline build and test results, a map of the GitHub integration, a
provider map, and a preview diagnosis. Add a health check and a minimal
smoke path where absent. Create a prioritized gap register before major
code changes.

Deliverables: current state report, feature matrix, architecture map,
local setup instructions, captured baseline results, and a branch
containing small repairs to the existing product. Completion means
another developer can reproduce the baseline and distinguish preexisting
failures from new failures.

## Build two Workspace runtime and trustworthy live preview

Create a project workspace at an exact commit, start the supported
services inside an isolated environment, stream logs, expose
authenticated preview routes, and show which revision is running. Handle
restart, cancellation, expired environments, and failed builds. This
establishes a way for users and agents to observe real software while it
is being built.

Deliverables: runtime adapter, workspace manifest, process supervisor,
preview gateway, revision status, log capture, and a browser smoke
check. Completion means a code edit changes the live application, a
backend edit restarts the correct service, a syntax error is visible,
and the last working preview is clearly identified.

## Build three One verified full stack delivery path

Use a small issue tracker as the reference application. Generate or
modify its UI, authenticated API, database migrations, role checks, file
upload, and one sandboxed integration. Verify persistence, denied
access, and external failure behavior. Package a reviewable diff and a
deployable artifact.

Deliverables: task orchestrator, model adapter, golden template, test
evidence, GitHub branch workflow, staging deployment recipe, and release
summary. Completion means the acceptance journey in Section 21 passes
from a clean environment, including restart and data persistence.

These builds form a dependency sequence. Theme expansion, a large
connector catalog, simultaneous autonomous agents, and additional stacks
should follow this path.

# 4 Supported product scope

## Initial application profile

Prioritize TypeScript web applications with a React frontend, an
explicit Node backend or the repository's existing server framework, and
PostgreSQL. Support managed authentication and object storage through
one selected provider. Existing supported applications should be
imported without rewriting their framework. Use a golden template for
new applications.

For a new project, the preferred fast path is React with Vite, a small
Node API such as Fastify, PostgreSQL, and managed auth and storage such
as Supabase. If Chakram already uses Next.js successfully, keep that as
the initial profile and use its server routes where appropriate. Resolve
this once in the audit decision record. Do not maintain both new project
profiles in the first milestone.

Choose one deployment target for the pilot, preferably the client's
Azure environment if access and budget are available. The code should
export with Docker configuration and documented environment contracts so
the application is not dependent on Chakram to run.

## Scope by release

| **Capability**        | **First working path**                     | **Client pilot**                         | **Later expansion**               |
|-----------------------|--------------------------------------------|------------------------------------------|-----------------------------------|
| New applications      | One golden template                        | Harden template and provisioning         | More supported profiles           |
| Existing repositories | One supported application profile          | Diagnose unsupported cases and conflicts | More languages and monorepos      |
| Backend               | API, database, auth, storage               | Jobs, webhooks, richer business rules    | Specialized infrastructure        |
| Preview               | Real frontend and backend                  | Branch previews and reliable recovery    | Multiple service topologies       |
| Models                | First provider, then second parity check   | Azure and Gemini BYOK                    | Other approved providers          |
| Connectors            | GitHub plus one app integration            | Small tested catalog                     | Managed MCP and more vendors      |
| Design                | Tokens, theme selection, responsive states | Element selection and consistent edits   | More design systems               |
| Delivery              | Export and staging recipe                  | CI, staged releases, rollback            | More cloud targets                |
| Governance            | Roles, audit trail, budgets                | Tenant isolation and retention controls  | Enterprise identity and residency |

## Explicit boundaries

Native mobile, arbitrary operating systems, complex Kubernetes
generation, production data manipulation, unrestricted MCP installation,
and autonomous production releases are outside the first path.
Unsupported repositories should receive a useful diagnosis and export
path. A preview that does not run its required backend should be labeled
as limited.

# 5 User journeys and interface

## Project entry

The user chooses Create application or Import repository. Creation
collects a short goal, application type, data needs, authentication
needs, theme, provider profile, and deployment target. Import selects
repository and branch through a GitHub App and shows stack detection,
setup requirements, and supported status. Preserve the repository
identity, commit SHA, lockfile, and startup contract.

Chakram presents the proposed requirements, assumptions, and acceptance
scenarios before a large build. Users can revise these in the same
workspace. Ordinary scoped edits can run under existing project policy
without repetitive dialogs.

## Builder workspace

Use a familiar three part working area: project navigation, conversation
and task activity, and a live preview or code view. On narrower screens
switch panes instead of compressing them. The primary tabs should be
Preview, Code, Backend, Checks, History, and Deploy. Model and budget
controls belong near run settings; raw provider configuration belongs in
settings.

A run should show planned tasks, the task being executed, changed files,
service health, actual checks, elapsed time, and budget usage. Show a
brief action summary and tool results rather than private model
reasoning. Controls include Stop, Resume, Retry failed step, View diff,
Restore checkpoint, and Open preview.

## Live preview states

Distinguish Provisioning, Installing, Starting services, Live, Updating,
Build failed, Sleeping, and Expired. Always show the running revision
and the latest source revision. If they differ, show that the preview is
stale. Keep the last working preview visible only with an explicit stale
indicator; never imply failed code is running.

Support desktop and mobile widths, open in new tab, reload, route
selection, console output, network errors, and an authenticated preview
session. A build error should link to the failing step and affected
files. The agent may attempt a bounded repair; the user can stop it.

## Backend and design surfaces

Backend shows schema, migrations, API routes, auth configuration,
storage, jobs, environment variable names, and redacted logs.
Development data tools must show their environment. Destructive database
actions require a concrete migration review.

Design shows tokens for colors, typography, spacing, radius, and
components. A theme change edits tokens and shared components rather
than duplicating styles across screens. Element selection can capture a
source reference and bounded DOM context; use a run scoped channel,
validate message origin, and strip sensitive page data before model
access.

## Review and delivery

History connects a user request to tasks, patch, checkpoint, checks,
commit, preview, and release. Review shows the diff, tests passed and
not run, migration impact, connector scopes, configuration requirements,
and known limits. Deploy distinguishes a preview, staging application,
and production application. A shareable preview grants access to the
application only; editor access, repository access, and chat history
have separate permissions.

# 6 System architecture

Separate the trusted control plane from generated code execution and
from the runtime of published applications. Use a modular backend and
one background worker initially. These are logical boundaries and do not
require a microservice for every box.

<img src="media/image1.png" style="width:6.9in;height:5.02462in"
alt="Chakram control plane, model gateway, isolated workspace, verification and release architecture" />

*Logical components and trust boundaries*

The browser never receives model keys, GitHub installation tokens, or
shared connector secrets. Generated code never executes inside the
Chakram API process. The worker calls the model gateway with scoped
context and invokes tools only after authorization. Published
applications use their own runtime identities and connector bindings;
they do not inherit the builder's control plane privileges.

## Core modules

| **Module**           | **Responsibilities**                      | **Durable record**            |
|----------------------|-------------------------------------------|-------------------------------|
| Project service      | Membership, repository, profile, settings | Project and environment       |
| Workspace service    | Checkout, revision, file state, locks     | Workspace and checkpoint      |
| Run orchestrator     | Tasks, transitions, retries, budgets      | Run and ordered events        |
| Model gateway        | Provider capability, streaming, usage     | Model call metadata           |
| Tool service         | Validation, policy, execution, receipts   | Tool execution                |
| Runtime service      | Provision, processes, files, quotas       | Runtime lease and manifest    |
| Preview service      | Authenticated routing, health, HMR        | Preview revision              |
| Git service          | Fetch, branch, compare, commit, PR        | Repository operation          |
| Backend service      | Provisioning, schema, migrations          | Backend binding and migration |
| Connector gateway    | OAuth, refresh, request policy            | Connection and receipt        |
| Verification service | Tests, browser, evidence                  | Check result and artifact     |
| Release service      | Build, deploy, promote, rollback          | Release and deployment        |

# 7 Technology choices and reuse

## Keep the repository stack when it is serviceable

Claude should preserve a healthy existing frontend framework, backend
framework, database, auth provider, editor, and styling library.
Refactor only with a file evidenced reason such as missing isolation,
unmaintainable coupling, unsupported dependency, or a reproducible
defect. Add adapters around stable existing parts before replacing them.

For missing platform pieces, use PostgreSQL for durable platform
metadata, object storage for artifacts, server sent events for ordered
run updates, and a separate worker for long jobs. A browser editor such
as Monaco is optional if an existing editor is already sufficient. Use
Playwright for the browser journey and the repository's existing unit
and integration test tools.

## Choose one harness engine

Default: retain the working Chakram loop and add typed tools,
persistence, and verification. For a missing or unsalvageable loop, run
a bounded spike comparing a small provider neutral loop against an
OpenHands integration \[S8\]. An existing TypeScript AI SDK
implementation can remain if it preserves required provider behavior
\[S12\]. Claude Agent SDK can be evaluated as an optional Claude
backend; it should not be the dependency through which Azure and Gemini
must operate.

The spike uses the same three tasks and measures completion, tool
correctness, resume behavior, cost, and integration complexity. Choose
one path and write an architecture decision. Do not adopt several
orchestration frameworks at once.

## Durable execution

Use the existing durable job system if it works. Otherwise a PostgreSQL
job table with transactional enqueue, leases, heartbeat, retry
scheduling, and event persistence is sufficient for the pilot. Redis may
accelerate delivery but must not be the sole record of progress. A
sweeper detects expired leases. Long workflows with complex compensation
may justify Temporal later \[S21\]; adopting it has its own operational
cost.

Use a transactional outbox for changes that must publish an event and
enqueue work consistently. Design for at least once delivery, with
deduplication and reconciliation at side effect boundaries. Do not claim
exactly once execution for external API calls.

# 8 Agent execution and context

## Execution loop

1.  Resolve project, permissions, environment, and accepted request.

2.  Load exact source revision, current workspace state, project
    manifest, and relevant context.

3.  Create tasks with dependencies and observable acceptance criteria.

4.  Take a checkpoint before edits and acquire a workspace mutation
    lease.

5.  Ask the chosen model for the next bounded action.

6.  Validate tool name, arguments, paths, capabilities, permissions, and
    budget.

7.  Execute in the authorized runtime and persist a redacted result and
    side effect receipt.

8.  Run targeted validation after meaningful changes; repair within the
    task budget.

9.  Run the required independent checks against the exact changed
    revision.

10. Package evidence, diff, commit or local checkpoint, and release
    readiness. Continue to the next task or finish with explicit
    remaining dependencies.

The model proposes actions. The platform decides whether actions are
allowed and whether checks passed. Tool output, repository files,
issues, webpages, and connector responses are data with provenance, not
authority to override platform policy.

## Persisted run states

Use queued, preparing, planning, executing, verifying, repairing,
awaiting_input, paused, succeeded, failed, and cancelled. Terminal runs
are immutable; retry creates an attempt or child run. Each transition
records actor, expected prior state, reason, timestamp, and monotonic
event sequence.

Persist state before acknowledging a transition to the UI. Reconnect
reads the durable log using a sequence cursor. Worker death expires a
lease and moves the run to reconciliation before resuming. Only the
current lease holder and fencing token may mutate a workspace.
Cancellation rejects new tool calls immediately, then terminates the
active process group and records any action already completed.

## Context management

Use a repository map, selected files, stack profile, task contract,
relevant tests, and bounded recent tool results. Search before loading
whole directories. Exclude secrets, large binaries, generated output,
dependencies, and unnecessary customer data. An embeddings database is
optional; file search and dependency maps are enough to begin.

Persist project decisions, requirements, task statuses, startup
commands, and concise progress summaries independently of chat. A
context handoff must include current revision, changed files, open
failures, next task, and pending external effects. Keep provider
continuation state opaque and tied to its provider and model. A new
provider gets a clean task context, not an incompatible raw transcript.

## Starting run budgets

Pilot defaults are proposed limits to tune through evaluation: 30
minutes per ordinary task, 40 model turns, 3 repair attempts, 120
seconds per normal tool command, and 10 minutes for an explicitly
classified install or build step. Projects may set lower cost and
runtime caps. A hard monetary cap requires trusted pricing and preflight
reservations; if price data is absent, enforce token and runtime caps
and label currency usage as an estimate.

Detect repeated identical errors and unchanged patches. Stop the repair
loop with a useful diagnosis instead of continuing indefinitely.
Increasing a configured budget requires an authorized user action or an
existing project rule.

# 9 Model gateway and customer credentials

## Configuration and capability registry

Store a provider profile containing provider kind, endpoint, region,
credential reference, model or deployment identifier, allowed projects,
data handling policy, and tested capabilities. The registry records
streaming, tools, supported schema subset, image input, context limit,
cancellation behavior, and provider continuation rules. Features should
be enabled by tested capability rather than matching a model name
string.

The settings flow includes add provider, store secret, validate
endpoint, test credentials, choose an available model or deployment, run
a small tool roundtrip, and save verified configuration. A successful
text reply alone does not establish coding tool compatibility.
Connection errors should distinguish auth, quota, unsupported feature,
endpoint, deployment, and region problems.

## Azure adapter

Treat Azure OpenAI, other Foundry model endpoints, and generic
compatible endpoints as separate configured endpoint kinds. For the
documented Azure OpenAI v1 route, normalize the configured resource base
URL to the required v1 path exactly once and pass the deployment name as
the model argument \[S13\]. Keep any legacy dated API route isolated in
its adapter rather than mixing configuration styles. Confirm that the
deployed model supports the selected API and tools.

Support a customer API key for the initial setup. Where deployment and
customer access permit, use a managed identity or Entra credential
instead of a stored long lived key. Document required role and scope
from current Microsoft guidance. Handle 401, 403, 404 deployment errors,
429, transient errors, and content filtering separately. Parse only
required response fields and tolerate additive fields.

## Gemini adapter

Use the official Google GenAI package for the repository language
\[S14\]. Configure Gemini Developer API separately from Vertex AI so
project, location, authentication, and endpoint assumptions do not leak
between them. Implement streaming text, function declarations, function
results, usage, and errors through that adapter \[S15\].

Preserve required opaque thinking or continuation data and content part
order using the official SDK and current guidance \[S16\]. Never
stringify the entire provider response into a generic text message and
discard its structured state. Do not reveal private thinking in the user
interface. Test multiple tool rounds and restart from persisted state
for every certified provider profile.

## Normalized model contract

The internal adapter should expose validateConfiguration,
getCapabilities, generateTurn, countOrEstimateTokens, and cancel. A
model turn contains normalized text, tool calls, usage, finish reason,
and an opaque provider state reference. Preserve request IDs and error
class. The tool executor receives validated structured arguments, never
partially streamed JSON.

Retry read only model requests with bounded exponential backoff and
jitter when safe. A retry after an unknown response requires checking
which tool calls already executed. Switch provider only at a reconciled
task boundary and only within the project's approved provider and region
policy. Sending code to another provider is an explicit project
configuration choice.

## Key handling

Keep secrets in a vault or encrypted server storage with separate
encryption key management. Database rows contain secret references and
redacted metadata. Use project and environment scoping, rotation,
revocation, and audit logs. Redact model prompts, tool results, terminal
output, traces, and error reports at ingestion and presentation. Prevent
provider settings from accepting arbitrary internal endpoints; use
approved host rules, DNS and redirect validation, and explicit
enterprise exceptions where configured.

Maintain separate credentials for the builder's models and for AI
features in generated applications. Never copy platform keys into a
generated application's environment or frontend bundle.

# 10 Workspace execution and isolation

## Runtime adapter

Expose create, restore, readFiles, applyPatch, exec, startService,
getServiceHealth, streamLogs, exposePort, snapshot, stop, and destroy.
Each call carries tenant, project, workspace, run, capability, and
fencing token. Resolve the runtime from server side state rather than
trusting a browser supplied runtime ID.

Use a managed isolated sandbox if procurement, region, quotas, and
economics fit; E2B is a candidate \[S9\]. For local single developer
use, Docker can provide a reproducible development environment. For
customer workloads, use a hardened sandbox boundary such as a suitable
managed runtime or isolated VM class with tested containment. Ordinary
containers share a host kernel and should not be treated as a sufficient
boundary for arbitrary hostile tenants.

Run as non root, drop unnecessary capabilities, restrict system calls,
bound CPU, RAM, storage, process count, and execution time, and restrict
outbound network access. Never mount the host Docker socket, host
credentials, control plane filesystem, or production secrets into
generated code. Give package installation explicit controlled egress and
time limits; lifecycle scripts are executable code and must run only in
the sandbox.

## Project runtime manifest

Use an explicit checked startup contract rather than guessing commands
every turn. Example schema, to adapt to the repository's actual profile:

schemaVersion: 1

profile: ts-react-node-postgres

runtimeImageDigest: "REPLACE_WITH_VERIFIED_DIGEST"

workingDirectory: /workspace/project

packageManager: pnpm

lockfile: pnpm-lock.yaml

installCommand: \[pnpm, install, --frozen-lockfile\]

services:

web:

command: \[pnpm, --filter, web, dev, --host, 0.0.0.0\]

port: 5173

readinessPath: /

restartOn: \[frontend-source\]

api:

command: \[pnpm, --filter, api, dev\]

port: 3001

readinessPath: /health/ready

restartOn: \[backend-source, environment-change\]

requiredSecrets: \[APP_DATABASE_URL, APP_AUTH_SECRET\]

checks: \[typecheck, lint, unit, integration, e2e, build\]

These commands and names are illustrative, not a statement about
Chakram's current repository. Validate manifests against a schema and
project policy. Let a trusted supervisor translate allowed commands into
processes; never interpolate unvalidated fields into shell strings.

## Checkpoints and persistence

Capture source revision, uncommitted patch, lockfile digest, runtime
image, manifest version, config references, and test data seed
reference. Do not place secret values in snapshots. Database persistence
has a separate environment binding and backup lifecycle. A filesystem
snapshot alone cannot restore a database or reverse an external action.

On idle expiry, snapshot recoverable source state, terminate processes,
revoke runtime credentials, and release compute. Restore the workspace
and restart services from the declared contract. Verify that the
environment is healthy before publishing a preview route.

# 11 Live preview implementation

## Routing and process management

The preview gateway maps an opaque preview identifier to an authorized
workspace revision and registered services. It supports HTTP and the
WebSocket traffic required by hot module replacement. Backend requests
can use a same preview origin /api route where compatible; profile
adapters define route and cookie behavior for frameworks that differ. Do
not rewrite arbitrary external destinations.

Provision the runtime, install dependencies, set app scoped environment,
apply development migrations, start the API, start the frontend, check
readiness, and then expose the route. The supervisor records PID or
provider process ID, start time, health, exit status, revision, and log
cursor for each service. File changes should use frontend HMR or restart
the affected backend; dependency and configuration changes can require a
controlled full restart.

Bind a source revision to a preview only after the required services are
ready. During mixed HMR or backend restart, label it Updating and
postpone verification until coherent. The browser checker should verify
a rendered application assertion; an HTTP 200 response can still be an
error page.

## Preview isolation

Serve untrusted preview content on a different registrable domain from
the Chakram control application. Use host only cookies and short lived
preview sessions. A signed one time exchange can establish preview
access without exposing platform cookies. Set framing and content
security policy deliberately so the authorized editor can embed the app.
Avoid credential carrying URLs; never rely on an unguessable URL as the
only authorization control.

Use strict origin, source window, message schema, and run nonce
validation for any preview bridge. A published application must not be
able to invoke builder tools through that bridge. Sanitize captured logs
and browser artifacts before they leave the runtime.

## Proposed performance objectives

Measure p50 and p95 per supported profile. Initial objectives on a
declared test environment: warm frontend edits visible within 5 seconds
p95; backend restart within 15 seconds p95; warm workspace ready within
30 seconds p95; cold setup within 180 seconds p95 for the golden
template; cancellation blocks new tool scheduling within 2 seconds and
terminates ordinary active processes within 10 seconds p95. These are
targets to validate, not promised results. Report install time, model
latency, and service start time separately.

# 12 Generated backend delivery

## Backend contract

For each feature, define data entities, validation, permissions, API
contract, transactions, indexes, error states, observability, and
acceptance tests. Generate typed client usage from a shared schema or
API definition. Every protected API enforces identity and authorization
server side. UI hiding is not an access control.

For the fast path, a managed backend can provide PostgreSQL,
authentication, and storage, while the generated Node service implements
business logic and integration calls. If a customer already has backend
services, build against approved contracts using an adapter and test
environment. Avoid creating a second competing source of truth.

## Data and migrations

Use versioned migrations in the repository. Apply them to an isolated
development database or schema with restricted credentials, then test on
a clean database and an existing seeded database. Record migration
checksums and applied versions. Do not let generated SQL operate on the
Chakram control database.

For production, prefer additive changes with an expand and contract
sequence. A release records backup status, compatibility implications,
and recovery strategy. Application rollback is safe only if the active
schema remains compatible. Use a forward fix or a verified data restore
process when a migration cannot be reversed without loss.

## Auth and tenant boundaries

Use a supported authentication provider rather than inventing password
cryptography. Supabase is one candidate with documented auth and
PostgreSQL row level security \[S23, S24\]. Separate the platform's
users and project membership from the generated application's users and
roles. For tenant applications, include tenant scoping in all relevant
records, queries, authorization checks, jobs, and storage paths. Use row
level security where appropriate as an additional control and test it
with the application's actual runtime credentials.

## Storage jobs and events

File upload requires size and type constraints, safe object naming,
authorized access, and signed URL expiry. Background jobs require
durable state, retry and dead letter behavior, idempotency, and
environment scoping. Webhooks require signature validation, timestamp or
replay controls where supported, deduplicated delivery IDs, and safe
retries. Test these behaviors using vendor sandboxes or controlled test
endpoints before real traffic.

# 13 Connectors and MCP

## Two connector categories

Builder connectors help Chakram inspect and deliver a project, such as
GitHub and documentation sources. Application connectors power the
generated app, such as a CRM API, storage service, or email provider. A
builder's authorization must not be inherited by the app or its end
users.

Each connection binds a tenant, owner, project, environment, credential
reference, approved scopes, and allowed actions. Each generated
application user needing their own vendor account has a separate
connection and authorization lifecycle. The gateway rechecks ownership
for every request.

## Connector contract

Define connector ID and version, authentication mechanism, scopes,
environment support, input and output schema, read and write actions,
side effects, idempotency behavior, pagination, rate limits, timeout,
health check, webhook support, redaction policy, and test fixtures.
Implement connect, validate, execute, refresh, disconnect, and optional
receiveWebhook.

The OAuth service uses state and PKCE when applicable, exact redirect
validation, secure token storage, and connection scoped refresh locking.
Persist rotated refresh tokens atomically and surface a reconnect state
when refresh fails. Retry reads safely; for writes with unknown
outcomes, reconcile using provider operation IDs or idempotency keys.
Test revoked and expired credentials and concurrent refresh.

## Integration order

First secure and verify GitHub. Then add one real application
integration chosen for the first client demo, using test credentials.
Next add a constrained generic REST connector with OpenAPI schema
import, host allow rules, and server side credential injection. Add
managed MCP connections after the tool policy and OAuth foundation is
stable.

MCP is a protocol, not a source of automatically trusted tools. Permit
only registered servers with pinned configuration and approved scopes,
prevent token passthrough, validate metadata and destinations against
SSRF, and separate read and write capabilities. Show newly requested
permissions to an authorized administrator \[S19\]. A broad unreviewed
marketplace should not be part of the pilot.

# 14 GitHub integration and concurrent work

Use a GitHub App with selected repository access, installation scoped
credentials, and minimum permissions. Implement contents read and write,
metadata read, pull request operations, and checks as required. Workflow
file editing needs its own explicit permission decision; do not request
administration access by default. Keep long lived app signing material
in the vault \[S17\].

Capture a base SHA at run start. Work on a feature branch or isolated
local worktree. The agent owns its task patch; the user can keep editing
through a separate workspace lease or coordinated edit protocol. If
source changes during a run, compare base, current remote, and task head
before applying or pushing. Do not overwrite human changes or force push
to resolve conflicts.

Verify webhook signatures against raw request bytes, deduplicate
delivery IDs, acknowledge after durable enqueue, and process
asynchronously \[S18\]. Reconcile missed events periodically. Track
disconnected, syncing, synchronized, diverged, and error states. Sync
retries must not create duplicate commits or pull requests.

The product should support reviewable commit and PR creation under
project policy. Merge and production deployment are separate authorized
operations. Git stores source history; the platform database stores
runs, access, connection metadata, and check records. GitHub
availability should not erase local workspace progress.

# 15 Platform data model

Use tenant scoping and foreign key ownership relationships in every
relevant table. Validate parent child membership in server queries as
well as in application code. The schema below describes records, not a
forced ORM or migration naming convention.

| **Record**            | **Key fields**                           | **Important rule**               |
|-----------------------|------------------------------------------|----------------------------------|
| Tenant and Membership | tenant ID, user ID, role                 | Authorization on every operation |
| Project               | tenant, profile, repo binding            | Tenant owns repository binding   |
| Environment           | project, kind, backend refs              | Dev, staging, prod separated     |
| Workspace             | project, branch, base and head SHA       | Single current mutation lease    |
| Run                   | workspace, request, state, budget        | State transitions conditional    |
| Task                  | run, dependencies, criteria, status      | Done requires check references   |
| RunEvent              | run, sequence, type, payload ref         | Unique run and sequence          |
| ToolExecution         | run, tool call, action key, result       | Deduplicate side effects         |
| RuntimeLease          | workspace, holder, fencing token, expiry | Reject stale worker writes       |
| Checkpoint            | source refs, manifest, config refs       | No secret values                 |
| ProviderProfile       | tenant, endpoint kind, model, secret ref | Tested capabilities versioned    |
| Connection            | tenant, owner, env, scopes, secret ref   | Binding checked on every use     |
| CheckResult           | revision, check ID, status, evidence     | Exact tested revision recorded   |
| Artifact              | project, object key, digest, type        | Authorized expiring access       |
| Deployment            | revision, artifact digest, env, state    | Immutable release identity       |
| Approval              | actor, action digest, env, expiry        | Cannot apply to changed action   |
| UsageLedger           | run, provider, tokens, runtime units     | Reconcile incomplete usage       |
| AuditEvent            | actor, tenant, resource, action          | Redacted append only history     |

Use database constraints for unique webhook deliveries, action keys,
event sequences, and active workspace ownership. Index project and time,
run and sequence, queued jobs and next attempt, and runtime leases by
expiry. Implement deletion and retention for code artifacts, logs,
chats, runtime snapshots, and credential metadata with clear ownership.

# 16 API and tool contracts

## Public control API

Suggested resource oriented endpoints, to align with the existing API
conventions:

| **Method and path**           | **Purpose**              | **Required behavior**                 |
|-------------------------------|--------------------------|---------------------------------------|
| POST /projects/import         | Link approved repository | Detect profile and persist base SHA   |
| POST /projects/{id}/runs      | Start accepted request   | Idempotency key and budget validation |
| GET /runs/{id}/events         | Stream ordered events    | Resume after sequence cursor          |
| POST /runs/{id}/cancel        | Cancel work              | Idempotent and durable                |
| POST /runs/{id}/resume        | Resume reconciled work   | New attempt and lease validation      |
| GET /workspaces/{id}/preview  | Preview status and entry | Check access and revision             |
| POST /workspaces/{id}/restore | Restore checkpoint       | Validate ownership and effects        |
| POST /providers/validate      | Test a provider profile  | Server side credentials only          |
| POST /connections/{id}/test   | Check app integration    | Scoped harmless test                  |
| GET /runs/{id}/checks         | Verification results     | Include not run and blocked           |
| POST /projects/{id}/releases  | Build release candidate  | Exact revision and artifact digest    |
| POST /releases/{id}/promote   | Deploy to target         | Policy and action bound authorization |

Use structured errors with stable code, safe message, retryability, run
ID, and correlation ID. Long operations return job identity rather than
holding an HTTP request until the model completes. Rate limit by tenant,
user, project, provider, and expensive operation.

## Tool envelope

Every tool request includes toolCallId, runId, taskId, workspaceId,
expectedRevision, actionKey, and typed arguments. The server derives
tenant and authorization from the run. Every response includes status,
exit code where relevant, bounded redacted output, artifact references,
resulting revision, side effect receipt, and retry classification.

Initial tools: search and read files, apply patch with expected content
hash, run bounded command, start and inspect services, query logs, run
checks, inspect browser, create checkpoint, inspect schema, apply
development migration, call approved connector, and produce a diff. File
tools reject traversal and symlinks escaping the workspace. Command
tools use structured argument arrays and a policy checked runtime. Shell
execution, where needed for coding, remains a separate capability inside
the sandbox.

## Side effect recovery

Before an external write, persist an intent with its action key and
expected target state. After execution persist the provider receipt. If
the worker dies between these steps, reconcile the target before
retrying. For APIs without idempotency or lookup support, mark the
outcome unknown and require resolution for that operation. Continue
independent tasks that do not depend on it.

# 17 Permissions and isolation tests

Roles should include Owner, Administrator, Developer, Reviewer, and
Viewer, with project specific memberships where needed. Project policy
can authorize routine sandbox editing, tests, development migrations,
and staging actions within limits. Reading or modifying secrets,
installing connectors, changing deployment policy, merging, and
production promotion have separate capabilities.

Require specific review for production release, destructive production
migration, a new vendor scope, a changed data transfer destination, or
spending beyond the agreed cap. Bind authorization to the action payload
digest, target environment, source revision, and expiry; editing the
action invalidates it. Ordinary already authorized fixes should continue
without repeated permission requests.

Security verification must cover cross tenant project reads and writes,
guessed workspace or artifact IDs, preview session reuse, secret
leakage, malicious repository instructions, path traversal, symlink
escapes, command injection, SSRF and DNS rebinding, connector privilege
escalation, and stale worker access. Run these tests against the actual
service boundaries, not only frontend components.

# 18 Build verification and release

## Verification layers

Use deterministic checks first: schema and configuration validation,
type checks, lint where configured, unit tests for business logic, API
and database integration tests, production build, and browser acceptance
journeys. Add dependency, secret, and static security scans that fit the
stack. Browser screenshots help inspect layout; they cannot establish
API permissions or persistence.

An evaluator pass can inspect the plan, changed code, observed app
behavior, and check evidence. It must not override failed deterministic
tests or change criteria to make a task pass. If tests need correction,
record the reason and preserve the original intent. Use model based
review where it adds value and measure its defect detection \[S6\].

## Exact revision evidence

Each check records source SHA or working tree digest, lockfile digest,
runtime image, environment kind, test command, timestamp, exit status,
and evidence path. Mark outcomes Passed, Failed, Not run, Blocked, or
Waived with a named authorized reason. A provider mock establishes
control flow, not live provider certification. A frontend mock does not
establish backend delivery.

Freeze a release candidate before final checks. Changes after
verification invalidate affected checks. Bind release artifacts to that
revision and include migration versions, environment requirements, and
an SBOM where feasible. Do not rebuild a different untested revision
during promotion.

## Deployment path

Build in an isolated CI worker, run required checks, create an immutable
artifact, deploy to staging, run migrations under a restricted
deployment identity, check health, run smoke tests, and present the
release record. Production promotion follows environment policy and
records the authorized actor. Use CI workload identity where supported
to avoid long lived cloud credentials.

The pilot should provide a verified Docker deployment and one Azure
recipe. A practical Azure split is Container Apps for the Chakram
control API and ordinary generated application services, managed
PostgreSQL for metadata, Blob Storage for artifacts, and Key Vault for
secret references \[S25, S26\]. Untrusted build workers need their own
isolated execution boundary and must not be cohosted with the trusted
API. Validate subscription services and region availability before
implementation; this is a proposed topology, not a claim about the
current account.

## Rollback and operations

Keep the last known healthy application artifact and compatible
configuration. Rollback application code through the deployment service
and rerun smoke checks. Test data recovery separately; a code revert
does not undo emails, payments, or database mutations. Expose runtime
errors, release history, job failures, and resource health. Link an
observed incident to a new scoped repair run and a reviewable patch.

# 19 Dependency and SDK maintenance

The initial policy is manual upgrades to tested releases. At
implementation time Claude should inspect current dependency files and
official release guidance, choose supported compatible releases, pin
direct versions where appropriate, commit lockfiles, and pin runtime
images by digest. Avoid installing an unbounded latest version during
every build.

Maintain a compatibility record with provider and endpoint kind, SDK
package and version, model or deployment, capabilities, runtime version,
date checked, official source, conformance results, deprecation notice,
and rollback version. Keep documentation snapshots or approved guidance
references with retrieval dates. Retrieval is input to an upgrade
decision; it must not mutate production packages automatically.

Upgrade procedure: inspect release notes; create a maintenance branch;
update one dependency group; regenerate lockfiles; run unit, provider
conformance, runtime, preview, template, and end to end checks; measure
quality and usage changes; deploy staging; record a review decision;
canary where possible; retain rollback. A lightweight monthly review and
an urgent review for security or deprecation notices are reasonable
operational defaults. This document does not schedule them.

Renovate can later open proposals \[S22\], but auto merging model SDKs,
runtime changes, or migration tooling is outside the initial policy.
Separate updates to Chakram from dependency updates in generated
customer applications. Both need evidence.

# 20 Observability budgets and reliability

Give every run, model call, tool execution, preview, check, and
deployment a correlation ID. Capture model latency, token usage, retry
count, install duration, service start duration, run success, repair
count, runtime minutes, user interruptions, and cost estimate. Keep
customer code and sensitive payloads out of routine metrics. Configure
log and artifact retention per environment and tenant policy.

Reserve estimated cost before a task and reconcile afterward. Record
known usage even when a model stream fails. A provider quota error
should pause the task with a reason and preserve the workspace. Circuit
breakers should stop repeated failing provider or connector calls. Limit
concurrent runs and apply fair scheduling by tenant.

Backup platform metadata and test a restore; test source checkpoint
recovery and generated application data recovery separately. Alert on
stuck runs, expired leases, preview failures, repeated authorization
failures, and unexpected spending. A small pilot needs a runbook and
support owner, even before a formal service level agreement.

## Operating cost model

Use measured tokens and actual contracted rates. Model cost equals input
tokens divided by one million times input rate, plus output tokens
divided by one million times output rate, plus cache or other billed
modalities. Runtime cost equals active sandbox hours times the actual
runtime rate. Add platform compute, databases, storage, egress, logs,
connector vendor fees, and published application runtime separately.
BYOK moves billing responsibility; it does not remove consumption.

Illustration only, not a vendor quote: 100 tasks with 150000 input
tokens and 20000 output tokens each use 15 million input and 2 million
output tokens. At hypothetical rates of USD 3 and USD 15 per million,
model usage is USD 75. If each task uses 20 sandbox minutes, usage is
33.33 sandbox hours; at a hypothetical USD 0.20 per hour, that adds USD
6.67. The variable subtotal is USD 81.67 before all other costs. Replace
every assumption with measurements before commercial pricing. Repeated
full repository prompts, uncontrolled repairs, and idle previews can
change this materially.

# 21 Reference application and acceptance journey

Build an issue tracker with users, teams, projects, issues, comments,
attachments, and role based access. It is small enough for repeatable
evaluation while exercising the required backend and delivery paths. Use
synthetic data only.

1.  Start from a clean supported template and a configured model
    profile.

2.  Ask Chakram to create an issue tracker with login and team scoped
    issues.

3.  Inspect the plan, data schema, tasks, and acceptance criteria.

4.  Observe actual running UI changes in the preview as implementation
    progresses.

5.  Sign in as Alice, create a team and issue, comment, and upload an
    allowed file.

6.  Reload, restart the application runtime, and verify the issue
    remains in the database.

7.  Sign in as Bob without team access and verify list, detail, update,
    attachment, and direct API access are denied.

8.  Ask for a priority field and filter. Apply a versioned migration
    that preserves existing issues. Verify UI, API, and persistence.

9.  Add one approved sandbox integration and trigger a test event.
    Verify one side effect after duplicate webhook delivery.

10. Revoke the connection and confirm useful error and reconnect
    behavior without deleting app data.

11. Inject a syntax error, observe failed build state, repair it, and
    verify the running revision changes correctly.

12. Disconnect the UI, reconnect, and recover run events without
    duplicate tasks.

13. Kill the worker after a checkpoint and verify lease reconciliation
    and resume without repeating an external write.

14. Review the diff and check evidence, create a branch commit, and run
    CI.

15. Deploy the exact candidate to staging, run browser and API checks,
    then exercise an application rollback compatible with the schema.

16. Export the application and run it outside Chakram using its
    documented setup.

This journey is both a demo script and a release check. Passing it once
is the first milestone; repeating it under faults and both certified
provider profiles establishes pilot readiness.

# 22 Evaluation and acceptance strategy

## Test groups

The companion checklist gives individual checks and evidence fields.
Cover the harness state machine, preview health and revision accuracy,
model streaming and tools, persistent backend and authorization, Git
divergence, connector failure handling, tenant isolation, deployment,
and recovery. Use controlled fault injection for network timeout, worker
death, duplicate delivery, and lost acknowledgement.

Test generated applications and Chakram separately. A secure platform
can generate a broken app; a correct demo app can conceal an unsafe
platform. Both need explicit results.

## Fixed task suite

Maintain at least 10 representative tasks: create CRUD app; import
supported repo; repair a frontend defect; repair an API defect; add a
schema field without data loss; enforce a role; add file upload;
implement a webhook; recover interrupted work; and export and deploy.
Freeze their initial code snapshots and acceptance criteria. Use 3
repeated runs per task for a first 30 run comparison and record
variance. Start with one provider and expand the suite to the second
after its conformance checks pass.

Suggested pilot threshold: at least 24 of 30 runs meet their acceptance
contract, with zero unresolved critical tenant or secret exposure
issues. Require all must pass security, persistence, recovery, and
release tests irrespective of aggregate success rate. These are proposed
go or no go criteria. Do not hide failed runs or manually repaired
outcomes in the success count.

Measure elapsed time, model and runtime usage, interventions, defects,
and export reproducibility. Publish comparisons against Chakram's own
baseline first. To compare with Lovable or another builder, run
equivalent prompts and acceptance tests under documented conditions
before making a marketing claim.

# 23 Claude repository audit and repair procedure

## Establish evidence before selecting changes

Read repository instructions, README, package manifests, lockfiles,
environment examples, entry points, runtime config, schema and
migrations, API routes, GitHub integration, model clients, preview code,
connector code, and CI workflows. Inspect Git status before editing.
Preserve unrelated work; use an isolated worktree or branch where
feasible. Review install scripts before running them, and run untrusted
application builds in the intended sandbox.

Do not assume the target folder names in this blueprint already exist.
Map existing files to responsibilities. Record actual commit, stack,
service topology, and startup commands. Search references to deprecated
SDKs, mocked backend paths, browser exposed secret prefixes, direct
shell execution in the API, and frontend only auth checks. Report secret
locations without copying secret values.

## Required audit outputs

Create docs/chakram/audit/CURRENT_STATE.md, FEATURE_MATRIX.md,
GAP_REGISTER.md, BASELINE_CHECKS.md, and ARCHITECTURE_MAP.md. Create
IMPLEMENTATION_PLAN.md and an architecture decision for any material
stack choice. Each feature row needs status, file evidence, runtime
evidence, risk, proposed disposition, and acceptance check ID. Statuses
are Verified working, Partial, Broken, Missing, and Unverified.

Each gap gets an ID, severity, reproducible trigger, impact, affected
files, root cause or hypothesis, dependency, proposed fix, acceptance
test, effort range, and confidence. P0 is an active data, secret,
isolation, or destructive risk. P1 blocks the supported delivery
journey. P2 materially harms usability or maintenance. P3 is a useful
enhancement. Distinguish a suspected problem from a reproduced defect.

## Repair order and autonomy

After writing the audit and plan, continue with authorized local
reversible repairs in dependency order. Resolve P0 containment needs,
then reproducible startup, provider tool correctness, workspace
isolation, preview, backend delivery, Git safety, verification, and
deployment packaging. Use feature flags and incremental adapters to
replace weak modules. Prefer vertical slices that the team can run after
each change.

Do not stop merely to ask whether to continue implementing the agreed
plan. Ask only when a real decision cannot be inferred, access is
missing, or the action crosses an agreed external or destructive
boundary. Continue independent tasks while a dependency is blocked.
Document migrations and ask for action specific authorization before
operating on production.

## Work after context reset

Maintain docs/chakram/tasks.json, PROGRESS.md, DECISIONS.md, and
CHECK_RESULTS.md. Each task includes ID, dependency IDs, expected
change, files, acceptance IDs, status, evidence, and unresolved
constraints. On resume, read these and Git status, verify the recorded
revision, recheck relevant environment health, and continue the next
incomplete task. Do not restart a rewrite or duplicate completed work.

# 24 Implementation phases and estimate

These are planning ranges conditional on the repository audit, supported
stack, working accounts, and a team of three engineers with regular QA
and product review. Existing code can shorten work; unsafe execution,
absent backend, or broken authentication can extend it. Reestimate after
the first audit and vertical slice. AI assistance does not remove
integration and security work.

| **Phase**                      | **Suggested working window** | **Main output**                          | **Exit requirement**                       |
|--------------------------------|------------------------------|------------------------------------------|--------------------------------------------|
| 0 Audit and baseline           | Days 1 to 3                  | Current state and repairs                | Reproducible startup and evidence          |
| 1 Workspace and preview        | Days 4 to 8                  | Isolated runtime and logs                | Correct live revision and recovery         |
| 2 Full stack path              | Days 9 to 15                 | Issue tracker, checks, first provider    | Golden journey passes                      |
| 3 Pilot capability             | Weeks 4 to 6                 | Second provider, Git, connector, staging | Repeated client workflow succeeds          |
| 4 Hardening                    | Weeks 7 to 8                 | Isolation, budgets, recovery, evaluation | Pilot thresholds and mandatory checks      |
| 5 Broader production readiness | Weeks 9 to 12 or longer      | Operations and selected scale needs      | Restore, load, security and support review |

A first credible internal demonstration may be possible in 10 to 15
working days if the foundation is serviceable. A client pilot in 6 to 8
weeks is a target under these assumptions. Neither is a delivery
commitment before audit. A single engineer should replan the schedule
rather than treating these parallel team estimates as their own.

## Ownership and critical dependencies

One engineer owns orchestration, provider adapters, and run persistence.
One owns runtime, preview, Git, and deployment. One owns builder UX,
generated backend path, and connector integration. QA works from fixed
acceptance scenarios, with an engineering lead reviewing isolation and
data changes. This is a suggested staffing split, not an instruction to
launch autonomous subagents.

The client or product owner must provide repository and branch scope,
local setup needs, a test GitHub installation, Azure endpoint and
deployment metadata, a Gemini test project, approved regions and
providers, a nonproduction backend, the first connector choice,
deployment target, and a spending cap. Credentials should be entered
through secure setup rather than written into prompts or documents.
Missing accounts block only their live certification steps.

# 25 Implementation backlog

| **ID** | **Priority** | **Work item**                           | **Depends on** | **Acceptance result**                         |
|--------|--------------|-----------------------------------------|----------------|-----------------------------------------------|
| CHK 01 | P1           | Audit and baseline                      | None           | Reproducible evidence and gap matrix          |
| CHK 02 | P0           | Secret and execution boundary repairs   | Audit evidence | No exposed keys or API process code execution |
| CHK 03 | P1           | Project profile and manifest            | 01             | Clean supported checkout starts               |
| CHK 04 | P1           | Runtime adapter and quotas              | 02 03          | Isolated processes and cleanup                |
| CHK 05 | P1           | Preview routing and revision state      | 04             | UI and API reflect declared revision          |
| CHK 06 | P1           | Durable runs and mutation lease         | 01             | Worker recovery and no stale writes           |
| CHK 07 | P1           | Typed tools and policy                  | 02 06          | Invalid or unauthorized tools blocked         |
| CHK 08 | P1           | First model adapter                     | 07             | Streaming and multi round tools verified      |
| CHK 09 | P1           | Golden backend template                 | 03 04          | Auth and persistence tests pass               |
| CHK 10 | P1           | Acceptance and repair loop              | 05 08 09       | Golden journey and bounded recovery           |
| CHK 11 | P1           | Git branch and conflict safety          | 06 07          | Human changes preserved                       |
| CHK 12 | P1           | Checks and evidence history             | 10 11          | Exact revision linked to results              |
| CHK 13 | P1           | Second provider certification           | 08 10          | Same tool suite passes                        |
| CHK 14 | P1           | Connector gateway and first integration | 07 09          | OAuth and duplicate events verified           |
| CHK 15 | P1           | Staging release and export              | 12             | Artifact runs outside Chakram                 |
| CHK 16 | P1           | Tenant and preview isolation tests      | 02 05 14       | No cross project access                       |
| CHK 17 | P2           | Theme tokens and element selection      | 05 10          | Consistent responsive visual edits            |
| CHK 18 | P1           | Usage limits and observability          | 06 08 04       | Limits and fault diagnosis work               |
| CHK 19 | P1           | Fixed task suite and regression report  | 12 to 18       | Pilot threshold and mandatory checks          |
| CHK 20 | P2           | Additional stacks and connectors        | 19             | Per profile certification                     |

CHK 02 is P0 only for defects established by the audit; otherwise
implement its required boundary work as a P1 dependency. Do not report
hypothetical exposures as observed incidents.

# 26 Definition of done and handoff

A feature is done when its agreed behavior is implemented through the
real relevant layers, required checks pass on the recorded revision,
changed configuration and migrations are documented, and the diff and
remaining limitations are reviewable. It cannot be marked complete
solely because the model said it is done, the UI looks finished, or a
mock passes.

A client pilot is ready when the fixed suite meets its threshold, all
mandatory security and data checks pass, both claimed provider profiles
are certified, previews and worker recovery behave correctly, staging
and rollback are exercised, export works, and a named owner can operate
the runbook. Defer unsupported claims in the product UI and client
proposal.

The delivery pack should include source changes, audit evidence, mapped
architecture, implementation backlog, setup and environment examples
without secrets, provider compatibility record, backend and migration
documentation, test reports, deployment instructions, operational
runbook, known limitations, and a next task list. Each blocked item must
state what is needed and which results remain unverified.

Use Claude_Master_Prompt.md to begin in the existing repository. Use
Chakram_Acceptance_Checklist.md as the independent completion record.
Use Chakram_Execution_Contracts.md for machine readable examples to
adapt to the codebase.

# 27 Official research sources

All links were checked on 16 October 2026. Version numbers, product
plans, quotas, and pricing must be rechecked at implementation time.
Sources support the research facts and selected integration details;
proposed architecture and targets are our engineering recommendations.

- \[S1\] Lovable Cloud <https://docs.lovable.dev/features/cloud>

- \[S2\] Lovable testing <https://docs.lovable.dev/features/testing>

- \[S3\] Lovable GitHub synchronization
  <https://docs.lovable.dev/integrations/github>

- \[S4\] Lovable connector gateway engineering
  <https://lovable.dev/blog/how-we-made-lovable-apps-work-with-the-rest-of-your-stack>

- \[S5\] Anthropic effective harnesses
  <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>

- \[S6\] Anthropic harness design for application development
  <https://www.anthropic.com/engineering/harness-design-long-running-apps>

- \[S7\] Anthropic tool engineering
  <https://www.anthropic.com/engineering/writing-tools-for-agents>

- \[S8\] OpenHands Software Agent SDK <https://docs.openhands.dev/sdk>

- \[S9\] E2B sandbox lifecycle <https://docs.e2b.dev/sandbox>

- \[S10\] WebContainers introduction
  <https://webcontainers.io/guides/introduction>

- \[S11\] WebContainers limitations
  <https://webcontainers.io/guides/troubleshooting>

- \[S12\] Vercel AI SDK <https://ai-sdk.dev/docs/introduction>

- \[S13\] Microsoft Azure OpenAI v1 API
  <https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle>

- \[S14\] Google GenAI libraries
  <https://ai.google.dev/gemini-api/docs/libraries>

- \[S15\] Gemini function calling
  <https://ai.google.dev/gemini-api/docs/function-calling>

- \[S16\] Gemini thinking guidance
  <https://ai.google.dev/gemini-api/docs/thinking>

- \[S17\] GitHub App installation authentication
  <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation>

- \[S18\] GitHub webhook validation
  <https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries>

- \[S19\] MCP security best practices
  <https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices>

- \[S20\] Playwright application servers
  <https://playwright.dev/docs/test-webserver>

- \[S21\] Temporal documentation <https://docs.temporal.io/>

- \[S22\] Renovate documentation <https://docs.renovatebot.com/>

- \[S23\] Supabase authentication
  <https://supabase.com/docs/guides/auth>

- \[S24\] Supabase row level security
  <https://supabase.com/docs/guides/database/postgres/row-level-security>

- \[S25\] Azure Container Apps overview
  <https://learn.microsoft.com/en-us/azure/container-apps/overview>

- \[S26\] Azure Key Vault overview
  <https://learn.microsoft.com/en-us/azure/key-vault/general/overview>
