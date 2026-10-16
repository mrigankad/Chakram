# Chakram Acceptance Checklist

Version 1.0 | 16 October 2026

Use this checklist during repository audit and delivery. Initial status for every item is **Unverified**. A file that appears to implement behavior is evidence for inspection, not a passing runtime test.

For each executed check record: check ID, milestone, status, revision or tree digest, environment, exact command or browser steps, expected result, observed result, evidence path, owner, timestamp, and defect or blocker reference. Use Passed, Failed, Not run, Blocked, or Waived. A waiver names an authorized decision maker and cannot be used for a mandatory security or data integrity failure.

M1 is the first internal full stack demonstration. M2 is the client pilot. M3 is broader production readiness. Checks can be executed earlier when their dependencies exist. The M1 deployment is staging or a local verified deployment, not production.

## A Repository baseline

| ID | Milestone | Check and expected result |
| --- | --- | --- |
| AUD 01 | M1 | Applicable instructions and Git state are recorded; user work is preserved. |
| AUD 02 | M1 | Current components map to real files and actual startup commands. |
| AUD 03 | M1 | A clean checkout with documented configuration starts the existing product. |
| AUD 04 | M1 | Build and test baseline distinguishes defects from missing accounts or tooling. |
| AUD 05 | M1 | Feature matrix and prioritized gaps include runtime evidence or an Unverified status. |
| AUD 06 | M1 | Claimed GitHub, preview, themes, and model paths have been exercised or explicitly remain unverified. |

## B Workspace and live preview

| ID | Milestone | Check and expected result |
| --- | --- | --- |
| PRE 01 | M1 | Workspace checkout is tied to the selected repository, branch, and exact source revision. |
| PRE 02 | M1 | Actual frontend and API services start through a validated manifest with health checks. |
| PRE 03 | M1 | A visible frontend edit reaches the browser and the running revision is accurate. |
| PRE 04 | M1 | A backend edit restarts the affected service and changes the actual API result. |
| PRE 05 | M1 | Syntax, install, and startup failures show bounded redacted logs and failed state. |
| PRE 06 | M1 | Last working preview is visibly stale after a failed new revision. |
| PRE 07 | M1 | HTTP, HMR WebSocket, deep route refresh, cookies, and API routing work for the profile. |
| PRE 08 | M1 | Preview access is authorized; guessing or sharing a URL does not grant editor access. |
| PRE 09 | M2 | Preview content uses a separate registrable domain and cannot access control plane cookies. |
| PRE 10 | M2 | Idle expiry snapshots recoverable source state and releases compute; restore works. |
| PRE 11 | M2 | Process timeout, memory pressure, crash, and restart leave a recoverable workspace. |
| PRE 12 | M2 | p50 and p95 edit, startup, and restart times are measured against declared targets. |

## C Harness execution and recovery

| ID | Milestone | Check and expected result |
| --- | --- | --- |
| HAR 01 | M1 | A request becomes tasks with dependencies and observable acceptance criteria. |
| HAR 02 | M1 | Invalid tool name, malformed arguments, partial streamed JSON, and disallowed paths are rejected. |
| HAR 03 | M1 | Tool failure reaches the run and user as a real failure with an actionable cause. |
| HAR 04 | M1 | Repair stops at the configured attempt, time, or token limit and preserves progress. |
| HAR 05 | M1 | UI reconnect resumes ordered run events without duplicating tasks. |
| HAR 06 | M1 | Cancellation blocks new tools and terminates the active ordinary process group within the measured limit. |
| HAR 07 | M2 | Worker death expires its lease; a replacement reconciles and resumes from persisted state. |
| HAR 08 | M2 | A stale worker and fencing token cannot mutate an active workspace. |
| HAR 09 | M2 | Two simultaneous edit requests cannot corrupt the same workspace or silently overwrite changes. |
| HAR 10 | M2 | Worker failure after an external write but before receipt persistence does not create a duplicate side effect. |
| HAR 11 | M2 | An unknown external outcome is recorded and reconciled rather than automatically replayed. |
| HAR 12 | M2 | Context reset preserves requirements, source revision, task state, failures, and next action. |

## D Models and SDKs

Run applicable MOD checks once for each certified provider and endpoint kind. At M1 one provider may be certified; Azure and Gemini are both required for the claimed M2 feature set. An account inaccessible during testing remains Blocked.

| ID | Milestone | Check and expected result |
| --- | --- | --- |
| MOD 01 | M1 | Settings validate endpoint, model or deployment, credential reference, and tested capabilities. |
| MOD 02 | M1 | Azure route selection uses the correct endpoint kind and deployed identifier. |
| MOD 03 | M2 | Gemini uses the supported official SDK and correct API or Vertex configuration. |
| MOD 04 | M1 | Streaming handles normal completion, interruption, cancellation, and malformed chunks safely. |
| MOD 05 | M1 | At least three consecutive tool rounds preserve call IDs, structured arguments, and results. |
| MOD 06 | M2 | Required opaque provider continuation data survives persistence and process restart. |
| MOD 07 | M1 | 401, 403, missing deployment, 429, timeout, filtering, and unsupported capability have distinct safe handling. |
| MOD 08 | M2 | Retry cannot repeat an already completed external tool action. |
| MOD 09 | M2 | Provider switch starts from a reconciled task and obeys approved data destinations. |
| MOD 10 | M2 | Usage and partial stream cost estimates are recorded without exposing private reasoning. |
| MOD 11 | M1 | Dependency versions and lockfiles are reproducible; no runtime install of unbounded latest. |
| MOD 12 | M2 | Compatibility record names SDK, runtime, model or deployment, capabilities, and live test evidence. |

## E Generated application backend

| ID | Milestone | Check and expected result |
| --- | --- | --- |
| BE 01 | M1 | A feature works through UI, API, and real database; reload and process restart preserve data. |
| BE 02 | M1 | Server rejects invalid input and returns stable safe error responses. |
| BE 03 | M1 | Sign in, sign out, expired session, and unauthorized direct API calls behave correctly. |
| BE 04 | M1 | A second user cannot read, modify, list, or download another team's data. |
| BE 05 | M1 | Additive migration runs on clean and existing data and preserves previous records. |
| BE 06 | M1 | Generated app cannot access the Chakram platform database or builder credentials. |
| BE 07 | M1 | Upload validates size and type, and attachment access is server authorized. |
| BE 08 | M2 | Transaction failures do not leave partial business state. |
| BE 09 | M2 | Jobs survive restart, use deduplication, and expose retry and dead letter states. |
| BE 10 | M2 | Webhooks validate signatures where available and reject replay or duplicate effects. |
| BE 11 | M2 | Rate limits, pagination, and relevant indexes behave under the reference dataset. |
| BE 12 | M3 | Backup restore and migration recovery meet the agreed data recovery target. |

## F GitHub and collaboration

| ID | Milestone | Check and expected result |
| --- | --- | --- |
| GIT 01 | M1 | App access is limited to installed repositories and required capabilities. |
| GIT 02 | M1 | A task branch and reviewable diff preserve base revision and user changes. |
| GIT 03 | M2 | Remote divergence is detected and does not trigger overwrite or force push. |
| GIT 04 | M2 | Commit and PR retry do not duplicate commits or PRs. |
| GIT 05 | M2 | Validated webhook delivery is durably queued; invalid signatures and duplicate deliveries are handled. |
| GIT 06 | M2 | Revoked installation, rate limit, and GitHub outage preserve workspace progress and expose recovery. |
| GIT 07 | M2 | Branch protection and required checks remain enforced. |

## G Connectors

| ID | Milestone | Check and expected result |
| --- | --- | --- |
| CON 01 | M1 | One real sandbox integration works through server side credentials and a declared action contract. |
| CON 02 | M2 | Builder, app, end user, project, and environment connections remain separate. |
| CON 03 | M2 | OAuth state, redirects, scopes, and PKCE where applicable are validated. |
| CON 04 | M2 | Concurrent expiry causes one refresh; rotated tokens persist safely. |
| CON 05 | M2 | Revoked connection produces a reconnect state and preserves application data. |
| CON 06 | M2 | Pagination, rate limits, timeout, retries, and unknown write outcomes are tested. |
| CON 07 | M2 | Duplicate event delivery creates one intended external side effect. |
| CON 08 | Before enablement | Generic REST and MCP destinations reject unauthorized internal hosts, redirects, metadata targets, and token passthrough. |

## H Isolation and authorization

These are mandatory before a client pilot. No aggregate score can compensate for a failed applicable isolation check.

| ID | Milestone | Check and expected result |
| --- | --- | --- |
| SEC 01 | M1 | No model, platform, or connector secret appears in source, browser bundles, logs, traces, or checkpoints. |
| SEC 02 | M2 | Cross tenant API access to projects, runs, artifacts, previews, deployments, and connections is denied. |
| SEC 03 | M1 | Generated code executes outside the trusted API with no host Docker socket or control secrets. |
| SEC 04 | M2 | Runtime containment, quotas, egress, cleanup, and credential expiry are tested. |
| SEC 05 | M1 | File traversal, escaping symlinks, command injection, and unsafe interpolation are blocked at execution boundaries. |
| SEC 06 | M2 | Repository instructions and connector output cannot grant permissions or change approved destinations. |
| SEC 07 | M2 | Preview bridge rejects wrong origins, windows, nonce, or malformed messages. |
| SEC 08 | M2 | All roles are enforced server side, including viewer and reviewer restrictions. |
| SEC 09 | M2 | Production or destructive action authorization binds revision, action digest, environment, and expiry. |
| SEC 10 | M2 | Audit events and artifact links expose only authorized redacted information. |

## I Verification and delivery

| ID | Milestone | Check and expected result |
| --- | --- | --- |
| REL 01 | M1 | Applicable type, unit, integration, browser, and production build checks have actual results. |
| REL 02 | M1 | Test evidence records exact source revision or tree digest and environment. |
| REL 03 | M1 | Failed deterministic tests prevent a success claim; blocked checks remain visible. |
| REL 04 | M1 | Exported app builds and runs outside Chakram with documented environment and migrations. |
| REL 05 | M1 | Staging deployment runs the verified source and artifact, not a later untested build. |
| REL 06 | M2 | Health, critical journeys, and denied access pass against the staged app. |
| REL 07 | M2 | Application rollback is exercised with compatible schema; database recovery is a separate procedure. |
| REL 08 | M2 | Post verification changes invalidate affected evidence before release. |
| REL 09 | M3 | Production promotion, failure, rollback, and incident runbook are exercised with authorized operators. |

## J Experience and operations

| ID | Milestone | Check and expected result |
| --- | --- | --- |
| OPS 01 | M1 | Users can see task, running revision, failures, diff, and checks without reading raw model output. |
| OPS 02 | M2 | Theme changes stay consistent across components, mobile layouts, errors, empty states, and login. |
| OPS 03 | M2 | Keyboard focus, readable contrast, labels, and navigation work in the builder's critical path. |
| OPS 04 | M2 | Time, turn, token, runtime, and configured currency limits stop or pause safely. |
| OPS 05 | M2 | Correlation IDs link a request to model calls, tools, previews, checks, and release. |
| OPS 06 | M2 | Idle runtime and artifact retention policies clean up resources without losing required records. |
| OPS 07 | M2 | Fixed evaluation suite reports every run, intervention, defect, time, and consumption. |
| OPS 08 | M3 | Platform metadata restore, customer data restore, alerting, and operational ownership are established. |

## Milestone completion record

- M1 requires its applicable checks to pass and the blueprint's reference application journey to run through staging or the documented local deployment. Missing live provider or connector access must be disclosed and narrows the achieved demonstration.
- M2 requires all applicable M1 and M2 checks, both claimed provider profiles, the proposed 24 of 30 fixed suite threshold, and zero unresolved mandatory security, data integrity, or recovery failures.
- M3 additionally requires agreed load, recovery, production authorization, support, and data handling requirements. Define these with the client before making a production readiness claim.

Every deferred feature should be hidden, labeled unavailable, or described with its actual support boundary in the product. A decorative button must not imply a working integration.
