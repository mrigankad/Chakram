# Durable runs

An App Studio build is a server-side task; `backend/app/services/run_store.py` is the part
of it that survives the process.

| Collection | One document per | Holds |
| --- | --- | --- |
| `runs` | build | `run_id`, `org_id`, `workspace_id`, `status` (`running`, `done`, `failed`, `cancelled`, `interrupted`), `seq` (last event number), `worker`, `lease_until`, `cancel_requested`, `plan` (app name, routes, the model's file specs, composed or not), `summary`, `error`, `resume_of` |
| `run_events` | event | `run_id`, `seq` (gap-free per run, unique index), the event without file contents (the workspace holds the file), `at` |

Streamed tokens are not stored; every other event is, written by one writer task per run so
`seq` stays ordered.

**Lease and heartbeat.** The worker that owns a run renews `lease_until` every 10 s
(30 s lease). At startup `run_store.reap_stale` marks running runs with an expired lease
as `interrupted`, with the reason. Nothing is replayed on its own.

**Cancel.** `POST /ai-ide/workspace/{id}/cancel` stops the run at once when it is in this
process and sets `cancel_requested` on the record for any other; the owning worker's
heartbeat picks that up and cancels the task, and `check_cancel` runs before every model
call so no new call starts after a cancel. The model stream already in flight is dropped,
not killed (it runs in a thread); nothing it produced is written. The run ends `cancelled`
with an `ERROR` event carrying `cancelled: true`.

**Resume.** `POST /ai-ide/runs/{run_id}/resume` starts a new run with `resume_of` set.
It reads the stored plan (no planner call), skips every file already present in the
workspace, regenerates the missing ones, keeps the routes of the skipped pages wired and
reports `files_skipped` in `GENERATION_DONE`. A composed app re-reads `app.spec.json`;
the seed call runs only when `src/data/seed.ts` is missing. A run that stopped before a
plan was made cannot be resumed (409): start it again.

**Attach after a restart.** The generation socket, asked to attach when no run is in
memory, consults the store: an `interrupted` or `cancelled` latest run is reported as
`RUN_INTERRUPTED` (status, files done, files planned, resumable) before `NO_RUN`, and
App Studio shows **Resume build**. **Stop build** shows while a run is going.

**Reads.** `GET /ai-ide/workspace/{id}/runs` lists the workspace's builds with what each
finished; `GET /ai-ide/runs/{run_id}?after=<seq>` returns a run and its events after a
sequence number, so a client can catch up without duplicates (HAR 05).

What is covered by `backend/tests/test_durable_runs.py`: ordered token-free events and the
closed record; cancel from the route and cancel through the store reaching the worker by
heartbeat with nothing written for the file in flight; a reaped lease, the interrupted
attach reply, and a resume that regenerates only the missing files and keeps the routes;
refusals (no plan, still running, another org).

Not done: test-execution runs use their own `test_runs` record (a run missing from the
process after a restart is marked failed when read); a fencing token for workspace writes
(HAR 08); multi-worker scheduling. The lease and the store make those possible without a
format change.
