# Companio (Prototype)

Help me find a verified person nearby who wants to do the same activity as
me. That is the entire scope of this prototype — no payments, business
accounts, AI recommendations, events, or tourism features.

## Status

**Phases 1–6 complete:** project scaffold, database schema, security
model, authentication (Google OAuth + email/password, sessions, CSRF,
rate limiting), profile CRUD + activity selection + verification badge
display, location + nearby discovery (1 km default radius, one indexed
PostGIS query, distance shown only as a bucketed label — see
`DATABASE.md`), connection requests (send/accept/decline/cancel, list
connections, unmatch — duplicate-request spam blocked at the database
level, block relationships already respected even though there's no way
to create one yet), and chat — REST message history/send/read-receipts
plus a Socket.IO gateway for live delivery, both scoped to the two
participants of a conversation (see `API.md` "Chat"). The map is not
implemented yet — see `ARCHITECTURE.md` for the phase plan.

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
