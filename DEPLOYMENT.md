# DEPLOYMENT.md — Companio Prototype (Phase 11)

## Scope

How to run Companio outside local dev: build the API and web images,
apply migrations, wire everything together with Docker Compose, put TLS
in front of it, and — as a secondary, more loosely-grounded option — what
deploying to a managed platform (Railway/Render/Fly.io) looks like today.

The primary, concrete path here is **self-hosted Docker Compose**,
because it's the one this document can actually describe from having
built and exercised it (see "Phase 11 verification notes" at the bottom
for exactly what was and wasn't possible to run in this project's own
build sandbox). The managed-platform section is real but necessarily
softer — current free-tier terms and pricing shift often enough that you
should re-check the linked docs before relying on any number here.

## Prerequisites

- Docker Engine + the Compose plugin (`docker compose version` — this
  project uses Compose v2 syntax throughout, including `profiles` and
  `${VAR:?err}` required-variable interpolation).
- A machine with outbound network access to `registry.npmjs.org` (npm
  package installs during the image build) and, the first time you run
  `prisma migrate deploy`, to `binaries.prisma.sh` (see "Migration
  strategy" below for why, and what to do if that host is blocked on
  your build network).
- A domain name and a way to point DNS at your host, if you want a real
  public deployment rather than a local smoke test.

## Environment variables

`.env.prod.example` is the full checklist for `docker-compose.prod.yml`
— copy it to `.env.prod` (not `.env`; see the file's own header comment
for why that name is reserved for the local dev stack) and fill in real
values. It is a superset of `.env.example` (which is for running
`apps/api`/`apps/web` directly against `docker-compose.yml`'s local dev
stack) plus the three Postgres role variables the `db` container itself
needs (`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`).

Every variable with no safe default in `docker-compose.prod.yml` is
declared with `${VAR:?VAR is required}` — Compose refuses to start with a
clear error if you haven't set it, rather than silently falling back to
a dev-shaped default. The ones worth calling out specifically:

- `SESSION_SECRET` / `CSRF_SECRET` — generate real ones per deployment:
  `openssl rand -base64 48`. Never reuse the dev placeholder, never
  reuse the same value for both, never reuse either across environments.
- `POSTGRES_PASSWORD` — `openssl rand -base64 32`, and it must match the
  password embedded in `DATABASE_URL`.
- `DATABASE_URL` — inside the compose network, the host is the service
  name `db`, not `localhost` (containers reach each other by service
  name — see `.env.prod.example`'s example value).
- `CORS_ALLOWED_ORIGIN` — the exact origin the web app is actually
  served from (`https://your-real-domain.example`, no trailing slash,
  no wildcard — credentialed cookie requests require an exact match; see
  `apps/api/src/main.ts`).
- `GOOGLE_CALLBACK_URL` — must point at your real public API domain and
  must be registered as an authorized redirect URI for that OAuth client
  in the Google Cloud Console, or Google OAuth login will fail with a
  redirect_uri_mismatch error.
- `DB_POOL_MAX` — leave unset unless you've read SCALING.md's
  "Connection pool" section; it has to be sized against real Postgres
  `max_connections` and however many API replicas will share that
  budget, and Phase 10's load test found the naive "bigger pool is
  faster" assumption was actually wrong under the sandbox's resource
  constraints.

## Building the images

```bash
# From the repo root — both Dockerfiles need the whole monorepo as their
# build context (npm workspaces: apps/api depends on packages/shared and
# the root package-lock.json). See each Dockerfile's own header comment
# for the full reasoning behind its stages.
docker build -f apps/api/Dockerfile -t companio-api:latest .
docker build -f apps/web/Dockerfile -t companio-web:latest .
```

Or let Compose build both as part of the workflow below — that's the
normal path; building by hand like this is mainly for a one-off
`docker run` smoke test of a single image.

`apps/api/Dockerfile` ships the full `node_modules` from its build stage
rather than pruning to a production-only install — a deliberate,
documented scope tradeoff (see the Dockerfile's own comment for the two
concrete `npm prune`/Prisma footguns that motivated it). The image is
larger than it strictly needs to be; revisit if image size or cold-start
time becomes a real constraint.

## Self-hosted Docker Compose deployment

This is the path actually exercised while building this phase.

1. `cp .env.prod.example .env.prod` and fill in real values (see
   "Environment variables" above).

2. Build the images and start the stateful services:

   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml \
     up -d --build db redis
   ```

3. Apply migrations (release-phase step — see "Migration strategy"
   below). This builds the same `apps/api` image the `api` service uses
   and runs `prisma migrate deploy` in it, then exits:

   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml \
     --profile migrate up migrate
   ```

4. Start the API and web app:

   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml \
     up -d --build api web
   ```

5. Verify:

   ```bash
   curl http://localhost:${API_PORT:-4000}/health
   # { "status": "ok", "database": "ok", "uptimeSeconds": ..., "checkedInMs": ... }
   curl -I http://localhost:${WEB_PORT:-3000}/
   # HTTP/1.1 200 OK
   ```

Redeploying a new version of the code: rebuild, re-run the `migrate`
profile (a no-op if there's nothing new to apply — `prisma migrate
deploy` is idempotent against an up-to-date database), then recreate
`api`/`web` with the new images:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml \
  build api web
docker compose --env-file .env.prod -f docker-compose.prod.yml \
  --profile migrate up migrate
docker compose --env-file .env.prod -f docker-compose.prod.yml \
  up -d api web
```

## Migration strategy

Migrations are applied by a one-off `migrate` service/profile that runs
`prisma migrate deploy` inside the same image the `api` service runs,
**before** `api` is (re)started on a new image — not baked into the
always-running container's own `CMD`. This keeps "apply schema changes"
and "serve traffic" as two separate, separately-observable steps in a
deploy, and means a migration failure blocks the rollout instead of
crash-looping a running API container.

`prisma migrate deploy` needs a genuine native schema-engine binary (it
does real diff/introspection work against the target database, unlike
`prisma generate`'s WASM-only path used for the runtime client — see
ARCHITECTURE.md "Prisma engine strategy" for the full story on why this
project's generated client avoids that binary but the CLI's migration
tooling can't). On a normal build/deploy machine with outbound network
access, this "just works" the first time it runs and the binary gets
cached locally after that.

**This project's own sandbox blocks `binaries.prisma.sh`** (the same
constraint already documented in ARCHITECTURE.md and DATABASE.md for
`prisma migrate dev`), so `prisma migrate deploy` itself could not be
executed end-to-end while building this phase — see "Phase 11
verification notes" below for what was verified instead. If your build
network also blocks that host, either build/migrate from a network that
can reach it (the common case), or bake a pre-fetched schema-engine
binary into the image and point `PRISMA_SCHEMA_ENGINE_BINARY` at it
(unlike `generate`'s WASM path, this one actually has to be a working
binary — `migrate deploy` executes it, not just resolves its path).

Both existing migrations
(`prisma/migrations/20260909000000_init/`,
`prisma/migrations/20260909020000_connection_request_pending_unique/`)
are hand-authored SQL rather than raw `prisma migrate dev` diff output —
see DATABASE.md "Migrations" for why (the PostGIS `geography` column and
a partial unique index, both inexpressible in `schema.prisma` as of this
Prisma version). `prisma migrate deploy` runs exactly this SQL and
records it in Postgres's own `_prisma_migrations` tracking table; it
doesn't generate or modify migration content.

## TLS / reverse proxy

Neither `apps/api` nor `apps/web` terminates TLS itself (SECURITY.md §6:
"TLS everywhere, enforced at the load balancer / reverse proxy in
deployment"). `docker-compose.prod.yml` exposes plain HTTP on
`API_PORT`/`WEB_PORT`; put a reverse proxy in front of the host that
terminates TLS and forwards to those ports. A minimal
[Caddy](https://caddyserver.com/) example (automatic Let's Encrypt
certificates, no manual renewal):

```caddyfile
your-real-domain.example {
    reverse_proxy localhost:3000
}

api.your-real-domain.example {
    reverse_proxy localhost:4000
}
```

Whatever proxy you use: forward `Host`/`X-Forwarded-For`/
`X-Forwarded-Proto` so the app sees the real client IP (the rate
limiter's default tracker is `req.ip` — see SCALING.md "Finding 1" for
why that specific detail matters) and the real scheme, and make sure the
proxy — not a browser — is what enforces HTTPS-only via HSTS if you want
that.

## Deploying to a managed platform

All three of these support deploying an arbitrary Dockerfile and offer
managed Postgres and Redis/key-value, which is what this project needs.
Specifics — free-tier limits and pricing — change often; the figures
below are what each platform's own docs showed as of September 2026;
verify against the linked page before relying on them.

- **[Render](https://render.com/pricing)** — free web-service tier
  exists (512 MB RAM, shared CPU) but Render's own docs describe it as
  sleeping/limited for always-on production use; paid web services start
  around $7/month. Managed Postgres has a free tier with limitations and
  paid tiers from ~$6/month. Managed Redis/Key-Value has a small free
  tier (25 MB) and paid tiers from ~$10/month. Custom Docker images are
  explicitly supported; PostGIS support specifically isn't documented on
  the pricing page — confirm with Render support or by testing before
  committing to it for the `db` service, or run just `api`/`web` there
  and point `DATABASE_URL` at Postgres hosted elsewhere.
- **[Railway](https://docs.railway.com/pricing/plans)** — usage-based:
  a Free plan with a small monthly credit, a Hobby plan ($5/month base +
  included usage), then metered RAM/CPU/egress beyond that. Dockerfile
  builds and managed Postgres/Redis are both directly supported per
  Railway's own docs.
- **[Fly.io](https://fly.io/docs/about/pricing/)** — per-second metered
  compute (no flat free tier for running Machines as of this writing),
  Managed Postgres as a separate paid product, Redis via the Upstash
  extension (separately billed). Docker/OCI image deploys are a first-
  class path.

The general shape on any of them: point the platform's Docker build at
`apps/api/Dockerfile` / `apps/web/Dockerfile` with the repo root as
build context (same as the self-hosted path above), provision managed
Postgres (with the PostGIS extension enabled — check the specific
platform's docs for how) and Redis, set the same environment variables
as `.env.prod.example`, and run the `migrate` step (either as the
platform's "release command" feature if it has one, or manually once via
its shell/exec access) before traffic hits a new `api` deploy.

## Production readiness checklist

Beyond what's already covered above:

- Real `SESSION_SECRET`/`CSRF_SECRET`/`POSTGRES_PASSWORD` generated per
  environment, stored in the platform's secret manager, never committed
  (SECURITY.md §7).
- `CORS_ALLOWED_ORIGIN` set to the real web origin, not a wildcard.
- `GOOGLE_CALLBACK_URL` registered in the Google Cloud Console for the
  real domain.
- TLS terminated in front of both `api` and `web` (see above), and the
  web app's requests to the API use `https://`.
- Automated backups for the Postgres volume (this document's Compose
  setup uses a named volume with no backup automation — a managed
  Postgres product's built-in backups are the simplest way to get this
  without hand-rolling `pg_dump` cron jobs).
- Read SCALING.md before assuming default rate limits and connection
  pool sizing hold up under real traffic — Phase 10's load test found
  real, specific bottlenecks (documented there, one fixed as
  `DB_POOL_MAX`, one — per-IP rate-limit sharing across users behind the
  same NAT/proxy — deliberately left as a recommendation rather than
  fixed in this phase).
- SECURITY.md §10's documented gap (blocks/reports data isn't
  anonymized on account deletion because no account-deletion endpoint
  exists yet) — revisit before this prototype handles real user data.

## Phase 11 verification notes

What was actually built and run while writing this phase, and what
couldn't be, so this document doesn't claim more than was checked:

- **Verified**: `apps/api/dist/main.js`, built via the exact command
  sequence `apps/api/Dockerfile`'s build stage runs (`prisma generate`
  then `npm run build --workspace=packages/shared && npm run build
  --workspace=apps/api`), booted successfully under production-shaped
  environment variables against the real dev Postgres/Redis, served
  `GET /health` (200, `database: "ok"`), and completed a full real-HTTP
  register → session-cookie → `GET /users/me` round trip.
- **Verified**: the equivalent for `apps/web` — `next build` with
  `output: 'standalone'` (added to `next.config.js` in this phase), the
  resulting `.next/standalone/apps/web/server.js` (note: nested under
  `apps/web/`, not at the standalone root — a consequence of this being
  an npm-workspaces monorepo, documented in `apps/web/Dockerfile`'s
  comment) booted and served a real `200` for `/` including its static
  CSS/JS assets, using the exact directory layout
  (`standalone/` + `.next/static/` + `public/`) the Dockerfile's runtime
  stage assembles.
- **Verified**: both `prisma/migrations/*/migration.sql` files apply
  cleanly, in order, to a genuinely fresh (empty) database, producing
  the expected 14 tables and 37 indexes — run directly via `psql`
  against a scratch database created and dropped for this check.
- **Verified**: `docker-compose.prod.yml` parses correctly, the required
  (`${VAR:?...}`) variables are enforced, and the `migrate` service is
  correctly hidden behind the `migrate` profile (`docker compose config
  --services` omits it by default, includes it with `--profile
  migrate`).
- **Not possible in this project's build sandbox**: an actual `docker
  build`/`docker compose up` of either image, and an actual `prisma
  migrate deploy` run. This sandbox's network policy returned `403` for
  every container registry tried (`registry-1.docker.io`, `gcr.io`,
  `ghcr.io`, `quay.io`, `public.ecr.aws`, `mcr.microsoft.com`,
  `registry.k8s.io`) as well as for `binaries.prisma.sh` (the same host
  ARCHITECTURE.md and DATABASE.md already document as blocked for
  `prisma generate`'s preflight and `prisma migrate dev`). Neither is
  specific to this phase's Dockerfiles — they're properties of this
  sandbox's egress allowlist, not of the deployment design. The
  verification above (running each stage's actual command sequence
  directly, and applying the migration SQL directly) is the closest
  substitute achievable here; a real Docker daemon with normal registry
  access should build and run both images as written. If you hit an
  issue actually doing that build, it's a real gap this document missed
  — the Dockerfiles themselves were not exercised end-to-end as
  containers.
