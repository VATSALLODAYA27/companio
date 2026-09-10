# TESTING.md — Companio Prototype

This document explains the testing strategy, not a duplicate of what's
already visible in the test files themselves — read the `*.spec.ts` /
`*.e2e-spec.ts` files for the actual assertions.

## The four layers, and what each one is for

Every phase from Phase 1 onward has gone through the same four layers,
in this order, before being considered done. No phase has shipped with
only some of these.

1. **Unit tests** (`src/**/*.spec.ts`, `npm run test`) — one file per
   service/guard/util, Prisma always mocked. These test *logic*: does
   this method call the database with the right `where`/`data` shape,
   does it throw the right exception for the right input, does a pure
   function (`fuzzPosition`, cookie signing) produce the right output.
   Fast (single-digit seconds for the whole suite) and run constantly
   during development.
2. **E2E tests** (`test/**/*.e2e-spec.ts`, `npm run test:e2e`) — a real
   Nest application built with `supertest`, hitting real HTTP routes
   through the real `SessionAuthGuard`/`CsrfGuard`/`ValidationPipe`
   stack, but with the service layer mocked. These test the *wiring*:
   is this route actually behind auth, does it actually require CSRF,
   does an invalid body actually get rejected by the DTO's validators,
   does the controller actually call the service with the arguments the
   session/URL/body say it should. A service-level unit test can't catch
   "the controller forgot `@UseGuards`" — only an e2e test hitting real
   HTTP can.
3. **Live-database SQL scripts** (`scripts/phaseN-*-check.sql`, `psql -f`)
   — every phase whose correctness depends on something Prisma can't
   fully model or a mock can't meaningfully stand in for (the PostGIS
   `geography` column, a partial unique index, `ON DELETE CASCADE`
   behavior, whether an index is actually used by `EXPLAIN`) gets a
   dedicated script that runs the *real* SQL against a *real* Postgres,
   inside `BEGIN ... ROLLBACK` so it never leaves data behind. This is
   the layer that would have caught the `ST_X`/`ST_Y` axis-order bug
   Phase 7's docblocks talk about — a mocked Prisma client cannot be
   wrong about PostGIS's internal `(lng, lat)` point order, because it
   never runs real PostGIS code at all.
4. **Real-HTTP boot verification** (ad hoc, done once per phase, not
   committed as a repeatable script except where folded into a SQL
   script's live section) — the actual server, built and started with
   `node dist/main.js`, exercised with real registered users over real
   HTTP end to end: register → set up a profile/activities/location →
   the phase's own routes → confirm the *externally observable* result
   (a blocked user actually disappears from `/discovery/nearby`, a
   declined request actually can't be accepted, a live WebSocket
   `message` event actually arrives). This is the layer that catches
   what layers 1–3 individually can't: real interaction between
   modules that are each individually correct in isolation. Phase 8's
   verification is a concrete example — the unit tests mock
   `connection.updateMany`/`connectionRequest.updateMany`'s call shape,
   the SQL script proves the *raw* transaction works against real rows,
   and the real-HTTP pass is what actually proved a block created
   through the real `POST /safety/blocks` endpoint makes a real blocked
   user vanish from a real `GET /map/nearby` call in the same process.

**Why all four, not just one.** Each layer catches a different class of
bug and none of the others can substitute for it: a unit test can be
100% green while the controller has no guard at all; an e2e test can be
100% green while the underlying SQL swaps latitude and longitude; a SQL
script can be 100% green while the route that's supposed to call it
isn't wired into `AppModule`. Phase 6's WebSocket auth race (see
`API.md` "WebSocket gateway", `chat.gateway.spec.ts`) is the sharpest
real example in this codebase: it only surfaced once tested against a
*real* `socket.io-client` connection, because the race is between
Socket.IO's own internal event ordering and an async DB call — a mocked
socket has no event ordering to race against, so a unit test alone
would have stayed green forever with the bug present.

## Coverage snapshot (unit tests, `npm run test -- --coverage`)

As of Phase 8's end: 15 suites, 137 tests, several modules under 100%
statement coverage in the *unit* run specifically because they're
covered at the e2e layer instead (see "Why controller coverage looks
low" below) — with three real, unintentional gaps: `AllExceptionsFilter`
(0% — the one file with no coverage anywhere, not even indirectly, since
no e2e test wires `useGlobalFilters`), `UsersService` (46%, no dedicated
spec file), and the identity-verification module (`VerificationsService`,
`GoogleVerificationProvider` — 0% branch coverage, no dedicated spec
file; only ever touched indirectly through other services' mocks).

**Phase 9 closed all three.** As of this phase: 20 suites, 161 unit
tests (+24), 88 e2e tests (+4 — a new `test/users.e2e-spec.ts`, since
`GET /users/me` had shipped in Phase 2 with zero HTTP-level coverage of
its own). `all-exceptions.filter.ts`, `users.service.ts`,
`verifications.service.ts`, `google.provider.ts`, and
`government-kyc.provider.ts` are now all at 100% statement coverage in
the unit run. Re-run `npm run test -- --coverage` in `apps/api` for the
current numbers; this snapshot will drift as later phases add code.

**Why controller coverage looks low in the unit-only report.** Every
controller in this app (`ConnectionsController`, `SafetyController`,
`ProfileController`, `DiscoveryController`, `MapController`,
`LocationController`, `HealthController`) shows low branch/function
coverage in `npm run test`'s report specifically because this codebase's
convention is to test controllers at the **e2e** layer (real HTTP
through real guards) rather than duplicating that with unit tests that
call controller methods directly and mock everything a guard would have
checked. `test/jest-e2e.json` runs as a fully separate Jest project
(different `rootDir`, different `testRegex`), so `npm run test --
--coverage`'s numbers never include e2e-covered lines — the low number
is an artifact of only measuring one of the four layers, not a real gap.
Cross-reference `test/*.e2e-spec.ts` before concluding a controller is
actually under-tested; `discovery.repository.ts`'s 69% is the same
story from the opposite direction — its raw-SQL methods are proven
correct primarily by `scripts/phase4-discovery-check.sql` and
`scripts/phase7-map-check.sql` (layer 3), which a unit-test coverage
report also can't see.

## The authorization test matrix

SECURITY.md §3 requires every protected route to check not just "is
there a valid session" but "may *this* user act on *this* resource" —
and requires that check to be tested, not just asserted in a docblock.
Concretely, per module that has real cross-user ownership logic (i.e.
excluding modules where every route is inherently self-scoped, like
`profile/` or `location/`, which have nothing to be "the wrong user"
*for*):

| Module | Ownership check | Unit test | E2E test |
|---|---|---|---|
| `connections/` | Only the request's recipient may accept/decline it; only the requester may cancel it; only a participant may unmatch | `connections.service.spec.ts` (`ForbiddenException` for a non-participant on each of accept/decline/cancel/remove) | `connections.e2e-spec.ts` (403 over real HTTP for the same cases) |
| `chat/` | Only a conversation's two participants may read/send/mark-read | `chat.service.spec.ts` (`ForbiddenException` for a non-participant on each of the three operations) | `chat.e2e-spec.ts` (403 over real HTTP) — plus `chat.gateway.spec.ts`'s real-socket test, which additionally proves an *unrelated authenticated* user's `join` is rejected at the WebSocket layer, not just the REST layer |
| `safety/` | Blocking/reporting always acts as the session user (`blockerId`/`reporterId` never client-supplied); unblocking is scoped to `blockerId = caller`, so you can only remove a block you placed | `safety.service.spec.ts` (transaction call-shape asserts `blockerId`/`reporterId` are the caller, never the target; `removeBlock` query is scoped to `blockerId`) | `safety.e2e-spec.ts` (the controller never accepts a `blockerId`/`reporterId` field in the body at all — `forbidNonWhitelisted` rejects one if sent, closing this off at the DTO layer rather than needing a runtime check) |
| `discovery/` + `map/` | A caller can only ever search *from* their own stored location, never an arbitrary one | `discovery.service.spec.ts`/`map.service.spec.ts` (the repository is always called with the session `userId`, never a body/query field) | `location-discovery.e2e-spec.ts`/`map.e2e-spec.ts` (no `latitude`/`longitude` field exists on the request DTO for either route at all — same "closed off at the DTO layer" pattern as safety) |

Every module in this table has at least one *unit* test asserting the
`ForbiddenException`/scoping logic itself, and at least one *e2e* test
proving that logic is actually reachable over real HTTP (not bypassed
by a missing guard). `profile/`, `location/`, `activities/`, `auth/`,
and `users/` are deliberately absent from this table — every route in
those modules only ever reads/writes the session user's own row(s), so
there is no second identity for an authorization check to compare
against; their tests instead prove the session id is what's used (never
a client-supplied id), which is a different, narrower property already
covered inline in each of their own spec files.

## Cross-cutting gaps closed in Phase 9

Phases 1–8 each tested their own new code thoroughly but, by
construction, never went back to audit code that shipped in an earlier
phase. Phase 9 did that audit once, project-wide, and found (and
closed) three real gaps that had nothing to do with any single phase's
feature:

- **`AllExceptionsFilter` had zero test coverage anywhere.** It's
  registered globally in `main.ts` (`app.useGlobalFilters(new
  AllExceptionsFilter())`), but every e2e-spec.ts in this project builds
  a minimal `Test.createTestingModule` for speed and isolation and never
  calls `useGlobalFilters` — so the one piece of code responsible for
  SECURITY.md §9's "no stack trace in the client response" promise had
  never actually been exercised by anything, unit or e2e. `src/common/filters/all-exceptions.filter.spec.ts`
  (new) tests it directly: HttpException status/message pass-through,
  object-shaped exception responses (e.g. class-validator's array of
  messages) spread instead of double-wrapping, a generic 500 with a
  fixed client-safe message for anything else, and — the specific
  regression this guards against — that a crash whose message contains
  connection strings, credentials, or a file-path-bearing stack trace
  never reaches the JSON body, only the server-side logger.
- **`UsersService` had no dedicated spec file.** Its methods were only
  ever exercised indirectly, through other services' mocks of it (e.g.
  `auth.service.spec.ts` mocks the whole interface; `safety.service.spec.ts`
  mocks just `findById`). `src/users/users.service.spec.ts` (new) tests
  each of its six methods' exact Prisma call shape directly — including
  the one substantive thing worth verifying about this file:
  `findActiveById` filters `status: 'ACTIVE'` and `findById` does not,
  which is the entire reason both methods exist side by side (see the
  method's own docblock and API.md "Safety").
- **`GET /users/me` had no e2e test.** It shipped in Phase 2 and has
  been covered only by whatever other flows happen to exercise
  `SessionAuthGuard`; there was no test asserting its own response
  shape. `test/users.e2e-spec.ts` (new) adds that, including the one
  thing actually worth guarding here: that the handler's explicit field
  allowlist (`id`, `email`, `status`, `createdAt`) really does drop
  `passwordHash`/`googleId` from the response even when the mocked
  service hands back a full row that includes them.
- **The identity-verification module had no dedicated spec files.**
  `VerificationsService.getBadge` (what every profile response's
  `verificationBadge` field ultimately comes from) and
  `GoogleVerificationProvider.verify` were both only ever touched
  through other tests' mocks. `verifications.service.spec.ts` and
  `google.provider.spec.ts` (new) test both directly; `government-kyc.provider.spec.ts`
  (new) adds one deliberately narrow test — that the provider still
  throws `NotImplementedException` — specifically so that if someone
  fills in real government-ID verification later without reading the
  class's own docblock, they have to consciously change or delete a
  test that says "this prototype does not implement government ID
  checks", rather than silently shipping it.

## Full regression pass (Phase 9)

As part of closing out this phase, every existing `scripts/phaseN-*-check.sql`
(Phases 1, 3, 4, 5, 6, 7, 8 — Phase 2 has no dedicated script; its
correctness doesn't depend on anything Prisma/mocks can't model) was
re-run in sequence against a single live database. All seven completed
with zero `ERROR` lines and a clean final `ROLLBACK`, confirming that no
later phase's schema or query changes regressed an earlier phase's
already-verified behavior. Each script is transactional and
self-contained, so this is safe to re-run at any time as a cheap
whole-project regression check — it does not require rebuilding or
booting the API server, only a reachable Postgres.

## Running everything

```bash
# Layer 1 — unit tests (fast, no DB needed)
cd apps/api && npm run test
npm run test -- --coverage   # adds the coverage table referenced above

# Layer 2 — e2e tests (fast, no DB needed — Prisma is mocked here too)
npm run test:e2e

# Layer 3 — live-database scripts (needs Postgres + PostGIS running)
export PGPASSWORD=companio_dev_password
for f in ../../scripts/phase*.sql; do
  psql -U companio -h localhost -d companio -f "$f"
done

# Layer 4 — real-HTTP boot verification (needs Postgres + Redis running)
npm run build && node dist/main.js
# ...then exercise routes with curl/a script against http://localhost:4000
# — see README.md's "Manually testing ..." walkthroughs for each module.
```

## What's out of scope for this document

Load testing (concurrent users, throughput, latency percentiles) is
Phase 10's job — see `SCALING.md` once that phase lands. This document
covers correctness testing only.
