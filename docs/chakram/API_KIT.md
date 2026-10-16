# The API kit

Every composed app ships a backend whose shape never comes from the model. `backend/app/engines/api_kit.py` renders it from the entities in `app.spec.json`; only the entity tables, schemas and seed differ between apps. The pages read through `src/data/store.ts`, which serves the seed rows until `VITE_API_URL` points at a running API.

## What an app gets

```
api/
  package.json                hono, @hono/node-server, zod, postgres (pinned); tsx + typescript for dev
  tsconfig.json
  .env.example                DATABASE_URL, PORT, DEFAULT_ORG_*, SEED_OWNER_*
  README.md                   run, routes, migrations, deploy
  migrations/0001_init.sql    orgs, users, sessions, one table per entity (org_id on every row, indexes on org_id and refs)
  src/schema.ts               zod schema + types per entity; the `entities` registry (collection, table, refs)
  src/store.ts                Store interface; PgStore (PostgreSQL, parameterised SQL) and MemoryStore (dev)
  src/auth.ts                 scrypt passwords, server-side sessions in an httpOnly cookie, roles owner/member/viewer
  src/routes.ts               per entity: GET list (?sort, dir, limit, offset, <field>=), GET one, POST, PUT, DELETE
  src/index.ts                the Hono app: /api/health, /api/ready, /api/auth/{signup,login,logout,me}, role change (owner)
  src/seed.ts + seed.json     loads the app's seed rows and an owner account into an empty store
src/data/store.ts             useAppData() + typed `api.<collection>.create/update/remove`
```

Rules the kit enforces, the same in every app:

- **Auth and roles server-side.** Reads need a session with at least `viewer`; writes need `member`; role changes need `owner`. Sessions are opaque tokens stored in the database, 14 days, `httpOnly`, `SameSite=Lax`.
- **Org scoping on every query.** Each row carries `org_id`; list, get, update and delete filter by the signed-in user's org. Another org's rows are 404, never 403 (no existence leak).
- **Validation from one source.** `schema.ts` is generated from the spec's field kinds (money/number finite, percent 0–1, enum values, email/url formats, ISO dates). Refs must point at existing rows in the same org. Errors are `{ code, message, retryable, fields? }` with a correlation id header.
- **Migrations are files.** `0001_init.sql` is additive-only; later changes go in new numbered files (expand, backfill, contract).
- **No secrets in the app.** The API has its own `.env`; the Vite app only knows `VITE_API_URL`.

## Running it

```bash
cd api && npm install && cp .env.example .env
npm run dev                                  # in-memory store, owner@example.com / change-me-now, seed loaded
# with PostgreSQL:
psql "$DATABASE_URL" -f migrations/0001_init.sql && DATABASE_URL=... npm run dev
```

Then `VITE_API_URL=http://localhost:3001 npm run dev` in the app. Pages show "Loading…" until the first fetch, then the same UI over live rows. `api.appointments.create({...})` reloads the store after a write.

## How it is verified

- `backend/tests/test_composer.py` checks the generated SQL, schemas and store against the clinic fixture and keeps the golden copy under `backend/tests/golden/composed_app/api`.
- `cd frontend && npm run check:api-kit` installs the kit's pinned dependencies in a temp folder and runs `tsc` on the golden kit; `npm run check:composed` type-checks the pages and `src/data/store.ts` against the real Chronos kit. Both run in CI.
- Not verified here: a live PostgreSQL round-trip and the browser journey (sign in, create, reload, deny another org). Those are the blueprint's BE 01–04 checks and need a running database.

## What is not in the kit yet

- Create/edit forms in composed pages (`form` and `detail` blocks): the `api` client exists, the UI blocks do not.
- File upload, background jobs, webhooks (blueprint BE 07–10).
- A Vercel function wrapper (`@hono/vercel`); the README shows where it goes.
