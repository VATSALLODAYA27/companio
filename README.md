# Companio (Prototype)

Help me find a verified person nearby who wants to do the same activity as
me. That is the entire scope of this prototype — no payments, business
accounts, AI recommendations, events, or tourism features.

## Status

**Phases 1–2 complete:** project scaffold, database schema, security
model, and authentication (Google OAuth + email/password, sessions,
CSRF, rate limiting). Profile editing, activity selection, and nearby
discovery are not implemented yet — see `ARCHITECTURE.md` for the phase
plan.

**Everything works with free-tier tools only.** Email/password login
needs no external setup at all. Google OAuth needs a client ID/secret
from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
(free — no billing account required, just create an "OAuth client ID" of
type "Web application" with `http://localhost:4000/api/v1/auth/google/callback`
as an authorized redirect URI). Until you add those to `.env`, `/auth/google`
simply won't work — every other route, including email/password signup and
login, works immediately.

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
npm run test:e2e       # end-to-end tests (apps/api) — these mock Prisma, no DB needed
```

## Manually testing auth once it's running

```bash
# Register (sets a session cookie in cookies.txt)
curl -i -c cookies.txt -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"correcthorse1","firstName":"You"}'

# Confirm the session is recognized
curl -i -b cookies.txt http://localhost:4000/api/v1/auth/session

# Get a CSRF token, then log out (logout requires both the session cookie and a matching CSRF token)
curl -s -c cookies.txt -b cookies.txt http://localhost:4000/api/v1/auth/csrf
CSRF_TOKEN=$(curl -s -b cookies.txt http://localhost:4000/api/v1/auth/csrf | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")
curl -i -b cookies.txt -X POST http://localhost:4000/api/v1/auth/logout -H "X-CSRF-Token: $CSRF_TOKEN"
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
