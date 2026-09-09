# Companio (Prototype)

Help me find a verified person nearby who wants to do the same activity as
me. That is the entire scope of this prototype — no payments, business
accounts, AI recommendations, events, or tourism features.

## Status

**Phase 1 complete:** project scaffold, database schema, and security
model. Login, activity selection, and nearby discovery are not
implemented yet — see `ARCHITECTURE.md` for the phase plan.

## Stack

Next.js + TypeScript + Tailwind (web) · NestJS + TypeScript (API) ·
PostgreSQL + PostGIS via Prisma · Redis · Socket.IO (chat, from Phase 6) ·
Docker Compose for local infrastructure.

## Project layout

```
apps/api/       NestJS backend
apps/web/       Next.js frontend
packages/shared/  Types shared between web and api
prisma/         Database schema, seed script, migrations
```

Full explanation: `ARCHITECTURE.md` · `DATABASE.md` · `SECURITY.md`.

## Prerequisites

- Node.js 20+ and npm 10+
- Docker (for local Postgres+PostGIS and Redis)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables
cp .env.example .env
# Edit .env: at minimum set SESSION_SECRET and CSRF_SECRET to random values
# (openssl rand -base64 48), and Google OAuth credentials once Phase 2 lands.

# 3. Start Postgres + Redis
docker compose up -d

# 4. Generate the Prisma client and apply the schema
npm run prisma:generate
npm run prisma:migrate   # creates the database tables, prompts for a migration name
npm run prisma:seed      # loads the fixed activity list (Trekking, Bowling, ...)

# 5. Run the API and web app (separate terminals)
npm run dev:api    # http://localhost:4000
npm run dev:web    # http://localhost:3000
```

## Verifying it's working

```bash
curl http://localhost:4000/health
# { "status": "ok", "database": "ok", ... }
```

Open `http://localhost:3000` — you should see the Companio placeholder
screen confirming the scaffold booted.

## Tests

```bash
npm run test          # unit tests (apps/api)
npm run test:e2e       # end-to-end tests (apps/api), requires the dev DB running
```

## Documentation index

| File | Covers |
|---|---|
| `ARCHITECTURE.md` | System design, module boundaries, scale-up path |
| `SECURITY.md` | Threat model, auth/authz, location privacy, data retention |
| `DATABASE.md` | Schema decisions, indexes, the nearby-match query |
| `API.md` | Endpoint reference (added as each phase's endpoints land) |
| `DEPLOYMENT.md` | Docker/cloud deployment (added in Phase 11) |
| `SCALING.md` | Load test results and bottleneck analysis (added in Phase 10) |
| `TESTING.md` | Test strategy and coverage (added in Phase 9) |

## Security notes

Never commit a real `.env`. Report a suspected vulnerability by opening a
private issue rather than a public one — this is a prototype, not yet
handling real user data.
