# Companio (Prototype)

Help me find a verified person nearby who wants to do the same activity as
me. That is the entire scope of this prototype — no payments, business
accounts, AI recommendations, events, or tourism features.

## Status

**All 11 phases complete.** Project scaffold, database schema, security
model, authentication (Google OAuth + email/password, sessions, CSRF,
rate limiting), profile CRUD + activity selection + verification badge
display, location + nearby discovery (1 km default radius, one indexed
PostGIS query, distance shown only as a bucketed label — see
`DATABASE.md`), connection requests (send/accept/decline/cancel, list
connections, unmatch — duplicate-request spam blocked at the database
level), chat — REST message history/send/read-receipts plus a Socket.IO
gateway for live delivery, both scoped to the two participants of a
conversation (see `API.md` "Chat") — the map: `GET /map/nearby` returns
the same nearby matches as discovery, but with a position on each pin
that's always randomized within ~150 m and never the real coordinate
(see `API.md` "Map") — and safety/privacy: block and report (`/safety/*`),
where creating a block proactively ends any active connection and
declines any pending connection request between the pair, not just a
flag other endpoints have to separately check (see `API.md` "Safety") —
and Phase 9's project-wide testing audit, which closed three
cross-cutting coverage gaps (the global exception filter, `UsersService`,
and the identity-verification module all had no dedicated tests before
this phase, even though the code itself shipped earlier) and re-ran
every phase's live-database verification script as a single regression
pass with zero failures (see `TESTING.md`) — and Phase 10's k6 load
testing against a 5,000-user seeded population, which found the server
stays correct under load (never a 5xx, clean 429s once the configured
rate limit engages) but also surfaced a real fairness gap — the rate
limiter's default IP-based tracking shares one budget across every
authenticated user behind the same IP, so two unrelated users on the
same mobile carrier's network can throttle each other — documented as
a recommendation rather than patched ad hoc (see `SCALING.md`) — and
Phase 11's deployment path: multi-stage Dockerfiles for the API and web
app, a `docker-compose.prod.yml` wiring them up with Postgres/Redis and
a migration-as-a-release-step, and TLS/managed-platform guidance (see
`DEPLOYMENT.md`). See `ARCHITECTURE.md` "Phase status" for what's
deliberately out of scope rather than unfinished.

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
PostgreSQL + PostGIS via Prisma · Redis · Socket.IO (chat, live since
Phase 6) · Docker Compose for local infrastructure.

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
npm run prisma:generate  # WASM engine — see ARCHITECTURE.md "Prisma engine strategy"
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

165 unit tests, 88 e2e tests as of Phase 10. See `TESTING.md` for the
full strategy (four layers: unit, e2e, live-database SQL scripts, and
real-HTTP boot verification — and why each catches bugs the others
can't), the authorization test matrix, and how to re-run every phase's
live-DB regression script in one pass.

## Load testing

```bash
k6 run loadtest/00-provision-sessions.js   # one-time: registers 10 real load-test users
k6 run loadtest/01-rate-limit-fairness.js  # ~1s — proves the rate limiter shares one budget per IP
k6 run loadtest/02-default-config-load.js  # ~1 min — confirms correct behavior at the app's real limits
k6 run loadtest/03-capacity-relaxed-limits.js  # ~75s — needs a server booted with rate limits raised, see its own docblock
```

Requires [k6](https://k6.io) and `scripts/loadtest-seed.sql` run first
to populate a realistic background dataset; run `scripts/loadtest-cleanup.sql`
afterward to remove everything these scripts create. See `SCALING.md`
for the results, the methodology's caveats, and what each script's
scenario is actually testing.

## Deploying

```bash
cp .env.prod.example .env.prod   # fill in real values — see DEPLOYMENT.md
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build db redis
docker compose --env-file .env.prod -f docker-compose.prod.yml --profile migrate up migrate
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build api web
```

Multi-stage Dockerfiles for both apps (`apps/api/Dockerfile`,
`apps/web/Dockerfile`), migrations run as a one-off release step rather
than baked into the running container, and TLS/reverse-proxy +
managed-platform guidance are all in `DEPLOYMENT.md`.

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

## Manually testing profile + activities once you're logged in

```bash
# Public — the fixed activity list, no auth needed
curl -s http://localhost:4000/api/v1/activities

# 404 until you PUT a profile at least once
curl -i -b cookies.txt http://localhost:4000/api/v1/profile/me

# CSRF token is required for every mutating request from here on
CSRF_TOKEN=$(curl -s -c cookies.txt -b cookies.txt http://localhost:4000/api/v1/auth/csrf | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")

curl -i -b cookies.txt -X PUT http://localhost:4000/api/v1/profile/me \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -d '{"firstName":"Nia","ageRange":"25-34","bio":"Weekend hiker","languages":["English"]}'

curl -i -b cookies.txt -X PUT http://localhost:4000/api/v1/profile/me/activities \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -d '{"activities":[{"activityKey":"hiking","availability":"WEEKEND"},{"activityKey":"gym","availability":"NOW"}]}'

curl -s -b cookies.txt http://localhost:4000/api/v1/profile/me/activities
```

## Manually testing location + discovery once you're logged in

```bash
CSRF_TOKEN=$(curl -s -c cookies.txt -b cookies.txt http://localhost:4000/api/v1/auth/csrf | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")

# Set your own location (upserts your user_locations row)
curl -i -b cookies.txt -X PUT http://localhost:4000/api/v1/location/me \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -d '{"latitude":19.1728,"longitude":72.9425}'

# Search for people nearby doing the same activity (needs another
# discoverable, non-hidden user with a location + matching activity to
# return anything — see scripts/phase4-discovery-check.sql for a full
# multi-user fixture)
curl -s -b cookies.txt "http://localhost:4000/api/v1/discovery/nearby?activityKey=trekking&radiusMeters=1000"

# 400 once you clear your own location — you can't search without one
curl -i -b cookies.txt -X DELETE http://localhost:4000/api/v1/location/me -H "X-CSRF-Token: $CSRF_TOKEN"
curl -i -b cookies.txt "http://localhost:4000/api/v1/discovery/nearby?activityKey=trekking"
```

## Manually testing the map (needs the same setup as discovery above)

```bash
# Same query params, same matches as /discovery/nearby — set your
# location again first if you cleared it above.
curl -i -b cookies.txt -X PUT http://localhost:4000/api/v1/location/me \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -d '{"latitude":19.1728,"longitude":72.9425}'

curl -s -b cookies.txt "http://localhost:4000/api/v1/map/nearby?activityKey=trekking&radiusMeters=1000"
# Each pin's latitude/longitude is randomized within ~150m of that
# person's real position — request it again right away and the same
# pin comes back at the exact same position (it's deterministic for
# today), but it'll be a different position tomorrow, and a different
# viewer querying the same target sees a different position than you
# do. See API.md "Map" and SECURITY.md §5 for why.
```

## Manually testing connections (needs two logged-in users)

Register a second account in a separate cookie jar first (`cookies2.txt`,
same `/auth/register` call as above), then, as the first user:

```bash
CSRF_TOKEN=$(curl -s -c cookies.txt -b cookies.txt http://localhost:4000/api/v1/auth/csrf | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")
OTHER_USER_ID=$(curl -s -b cookies2.txt http://localhost:4000/api/v1/auth/session | python3 -c "import sys,json;print(json.load(sys.stdin)['userId'])")

# Send a request (recipientId is the id GET /discovery/nearby would return)
REQUEST_ID=$(curl -s -b cookies.txt -X POST http://localhost:4000/api/v1/connections/requests \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -d "{\"recipientId\":\"$OTHER_USER_ID\",\"activityKey\":\"trekking\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

# As the second user: see it, then accept it
CSRF2=$(curl -s -c cookies2.txt -b cookies2.txt http://localhost:4000/api/v1/auth/csrf | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")
curl -s -b cookies2.txt http://localhost:4000/api/v1/connections/requests/incoming
curl -i -b cookies2.txt -X POST http://localhost:4000/api/v1/connections/requests/$REQUEST_ID/accept -H "X-CSRF-Token: $CSRF2"

# Both users now see the connection, each with a conversationId
curl -s -b cookies.txt http://localhost:4000/api/v1/connections
curl -s -b cookies2.txt http://localhost:4000/api/v1/connections
```

## Manually testing chat (needs an accepted connection from above)

```bash
CONVERSATION_ID=$(curl -s -b cookies2.txt http://localhost:4000/api/v1/connections/requests/$REQUEST_ID/accept -X POST -H "X-CSRF-Token: $CSRF2" | python3 -c "import sys,json;print(json.load(sys.stdin)['conversationId'])")
# (or read it off GET /connections above, if you already accepted)

# User 1 sends a message
curl -s -b cookies.txt -X POST http://localhost:4000/api/v1/conversations/$CONVERSATION_ID/messages \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -d '{"body":"hey, still on for trekking saturday?"}'

# User 2 reads the history, then marks it read
curl -s -b cookies2.txt http://localhost:4000/api/v1/conversations/$CONVERSATION_ID/messages
curl -s -b cookies2.txt -X POST http://localhost:4000/api/v1/conversations/$CONVERSATION_ID/messages/read -H "X-CSRF-Token: $CSRF2"
```

The REST calls above are the full story for persistence — a curl script
can't easily demonstrate the WebSocket half, since that needs a real
Socket.IO client (not plain HTTP) to hold a connection open. To see live
push yourself: connect with `socket.io-client` to `http://localhost:4000`
sending your session cookie as a `Cookie` header (Socket.IO's handshake
doesn't run cookie-parser, so the raw `companio_sid=...` cookie value is
what the server expects — see `API.md` "WebSocket gateway"), emit
`join` with `{ conversationId }`, and you'll receive a `message` event
the instant the other participant posts one over REST — no polling.

## Manually testing safety (block/report, needs two logged-in users)

Continuing from the connections walkthrough above (`cookies.txt` /
`cookies2.txt`, `OTHER_USER_ID`):

```bash
CSRF_TOKEN=$(curl -s -c cookies.txt -b cookies.txt http://localhost:4000/api/v1/auth/csrf | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")

# User 1 blocks user 2 — this also ends any active connection between
# them and declines any still-pending request in either direction, in
# the same transaction (see API.md "Safety" and DATABASE.md "Block
# creation side effects")
curl -i -b cookies.txt -X POST http://localhost:4000/api/v1/safety/blocks \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -d "{\"blockedUserId\":\"$OTHER_USER_ID\"}"

# User 2 has now disappeared from user 1's discovery/map results, and
# from user 1's connection list
curl -s -b cookies.txt "http://localhost:4000/api/v1/discovery/nearby?activityKey=trekking"
curl -s -b cookies.txt http://localhost:4000/api/v1/connections

# User 1's own block list
curl -s -b cookies.txt http://localhost:4000/api/v1/safety/blocks

# Undo it — this does NOT revive the ended connection or the declined
# request, only removes the block itself
curl -i -b cookies.txt -X DELETE http://localhost:4000/api/v1/safety/blocks/$OTHER_USER_ID -H "X-CSRF-Token: $CSRF_TOKEN"

# User 2 files a report against user 1 (works regardless of block state)
CSRF2=$(curl -s -c cookies2.txt -b cookies2.txt http://localhost:4000/api/v1/auth/csrf | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")
ME=$(curl -s -b cookies.txt http://localhost:4000/api/v1/auth/session | python3 -c "import sys,json;print(json.load(sys.stdin)['userId'])")
curl -i -b cookies2.txt -X POST http://localhost:4000/api/v1/safety/reports \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF2" \
  -d "{\"reportedUserId\":\"$ME\",\"category\":\"HARASSMENT\",\"details\":\"example report\"}"

# User 2 sees their own filed report; user 1 never sees reports filed against them
curl -s -b cookies2.txt http://localhost:4000/api/v1/safety/reports
curl -s -b cookies.txt http://localhost:4000/api/v1/safety/reports
```

## Documentation index

| File | Covers |
|---|---|
| `ARCHITECTURE.md` | System design, module boundaries, scale-up path |
| `SECURITY.md` | Threat model, auth/authz, location privacy, data retention |
| `DATABASE.md` | Schema decisions, indexes, the nearby-match query |
| `API.md` | Endpoint reference (added as each phase's endpoints land) |
| `DEPLOYMENT.md` | Docker Compose deployment, migrations, TLS, managed platforms |
| `SCALING.md` | Load test results, bottleneck analysis, and recommendations |
| `TESTING.md` | Test strategy and coverage, the authorization test matrix |

## Security notes

Never commit a real `.env`. Report a suspected vulnerability by opening a
private issue rather than a public one — this is a prototype, not yet
handling real user data.
