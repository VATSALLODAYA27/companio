# ARCHITECTURE.md — Companio Prototype

## Scope

The only problem this prototype solves: *help a user find a verified
person nearby who wants to do the same activity, and let them connect and
chat safely.* No payments, business accounts, AI recommendations, events,
or tourism features.

## System Overview

```
┌─────────────────┐    HTTPS / WSS    ┌──────────────────────┐
│   Next.js Web     │ ────────────────▶ │   NestJS API (REST)   │
│  (mobile-first)   │ ◀──────────────── │  + Socket.IO Gateway  │
└─────────────────┘                    └──────────┬────────────┘
                                                     │
                    ┌────────────────────────────────┼──────────────────────┐
                    ▼                                ▼                      ▼
          ┌────────────────┐             ┌─────────────────┐     ┌──────────────────┐
          │  PostgreSQL      │             │      Redis        │     │  Event layer (opt) │
          │  + PostGIS       │             │ sessions/cache/    │     │  in-process now →   │
          │  (Prisma ORM)    │             │ rate-limit/pubsub  │     │  Kafka later         │
          └────────────────┘             └─────────────────┘     └──────────────────┘
```

The API is a **modular monolith**, not microservices: modules
(`auth`, `users`, `activities`, `discovery`, `connections`, `chat`,
`safety`, `identity-verification`, `admin`, `health`) are isolated enough
to split into separate services later, but there is no operational reason
to do that at prototype scale.

## Why this stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Next.js + TS + Tailwind | Fast mobile-first iteration; no server logic lives here |
| Backend | NestJS + TS | DI, guards, interceptors, pipes map directly onto the auth/authz/validation requirements |
| DB | PostgreSQL + PostGIS | Correct radius math (`ST_DWithin` on `geography`) at the database level, not app code |
| ORM | Prisma 7, WASM engine + `@prisma/adapter-pg` | Type-safe for everything except the PostGIS geography column, which is isolated to one raw-SQL repository. See "Prisma engine strategy" below for why the engine choice is called out explicitly. |
| Cache/session/rate-limit | Redis | One dependency for three needs; also the Socket.IO cross-instance adapter later |
| Realtime | Socket.IO | Built-in reconnection + room semantics (one room per conversation) |
| Auth | Google OAuth + first-party opaque session | Revocable without a token blocklist |

## Module boundaries (apps/api/src)

- `prisma/` — the only place the Prisma client is instantiated (`PrismaService`, injected everywhere else).
- `health/` — public liveness/readiness endpoint, no auth required.
- `common/filters` — global exception sanitization (see SECURITY.md §9).
- `common/guards`, `common/decorators` — `SessionAuthGuard`, `CsrfGuard`, `@CurrentUser()` — deliberately outside `auth/` so any module can depend on them without creating a cycle back into `AuthModule` (see "Avoiding circular modules" below).
- `identity-verification/` — the `IdentityVerificationProvider` abstraction, `VerificationsService` (owns the Verification table), and the badge computation every profile view reads. Its own module (`IdentityVerificationModule`) so both `AuthModule` (records a verification at login) and `ProfileModule` (displays the badge) can import it without depending on each other.
- `activities/` — read-only access to the fixed 12-activity list seeded by `prisma/seed.ts`. No user data.
- `profile/` — profile CRUD and activity selection (Phase 3), scoped entirely to the caller's own `userId` from the session — no route in this module accepts another user's id as input.
- `location/` — owns `user_locations`, the caller's own row only (Phase 4). Every write goes through raw SQL — `PrismaService` has no generated-client type for the `geography` column — and reads back nothing beyond an existence check (`hasLocation`, used by `DiscoveryService` to give a clear 400 before searching rather than a query that silently returns zero rows). No route or method in this module ever accepts or returns another user's coordinates.
- `discovery/` — the only *repository* that queries across users' locations (Phase 4, extended in Phase 7). Its `DiscoveryRepository` is the sole place `user_locations.geo` is read for anyone other than its owner, entirely inside `$queryRaw` statements (see DATABASE.md "The nearby-match query"). `DiscoveryService` resolves the requested `activityKey` to an id (via `ActivitiesModule`) and confirms the caller has a location (via `LocationModule`) before ever calling the repository, then maps the repository's rows to the public response shape — `verified: boolean` becomes `verificationBadge`, and no raw `distance_m` field exists past the repository layer at all for `findNearby` (the repository's SQL never even projects it — see the repository's own docblock). `DiscoveryModule` exports `DiscoveryRepository` specifically so `MapModule` (Phase 7) can reuse its second method, `findNearbyForMap`, rather than maintaining an independently-drifting copy of the same activity/availability/block/radius filtering.
- `connections/` — connection requests and connections (Phase 5), the bridge between discovery and chat. Imports `ActivitiesModule` (resolve `activityKey` -> id) and `UsersModule` (confirm a recipient exists and is `ACTIVE`); deliberately does **not** import a `BlocksModule` because none exists yet (blocking is Phase 8) — it queries the `Block` table directly via `PrismaService`, the same defense-in-depth posture `DiscoveryRepository` already has. `ConnectionsService` is the one place `Connection.userAId`/`userBId` are ever written, and it always sorts the pair (`[a, b].sort()`) first — see the schema comment on `Connection` and DATABASE.md — so the unique constraint actually catches a duplicate connection regardless of which side reconnects to which. Since Phase 6, `acceptRequest` also upserts the connection's one `Conversation` row inside the same transaction — chat's route design (see below) assumes every accepted connection already has a resolvable conversation, so lazy creation on first message would have meant a second code path for "no conversation yet".
- `chat/` — message persistence + realtime push (Phase 6). `ChatService` owns all authorization (participant check derived from `Conversation` → `Connection` → `userAId`/`userBId`, re-verified on every call, never cached) and all writes; `ChatController` is thin REST plumbing with the usual `SessionAuthGuard` + `CsrfGuard` + rate limiting. `ChatGateway` is *only* a live-push fan-out — it never persists anything and never trusts a client-asserted identity, re-deriving the session user from the signed cookie itself (see "Event layer" below for how it learns about new messages). Imports nothing from `connections/`; it only needs `PrismaService` and its own `Conversation`/`Message` tables, kept decoupled from `ConnectionsService` internals.
- `map/` — the map view (Phase 7). Same precondition/authorization shape as `discovery/` (caller must have a location; same activity/radius/offset query), reusing `DiscoveryRepository.findNearbyForMap` via an import of `DiscoveryModule` rather than a second raw-SQL query. Its only original contribution is `location-fuzz.util.ts`'s `fuzzPosition` — a pure function that replaces another user's real coordinate with a deterministic-per-`(viewer, target, day)` random point within 150 m before `MapService` ever returns it (see SECURITY.md §5). No route or method anywhere in this module can return a real, un-fuzzed coordinate for anyone but the caller.
- Modules added in later phases follow this same pattern: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/*.ts`, and — where the module owns a non-trivial query — a dedicated `*.repository.ts`.

### Avoiding circular modules

`AuthModule` depends on `UsersModule` (for `UsersService`) and on
`IdentityVerificationModule` (to record a Google verification at login).
`ProfileModule` also depends on `IdentityVerificationModule` (to read the
badge) and on `ActivitiesModule` (to resolve activity keys). None of
these ever import `AuthModule` back — `SessionAuthGuard`/`CsrfGuard`
living in `common/` rather than `auth/` is what makes that possible, since
otherwise any module needing auth would have to import `AuthModule`,
which itself imports `UsersModule`, which would need the guard.

## Event layer (Kafka readiness without Kafka in the loop yet)

Async, non-request-path events (connection accepted, message sent,
report filed) are published through a single `DomainEventsService`
interface backed by an in-process `EventEmitter2` for local development.
Swapping it for a Kafka producer later is a one-file change — nothing
else in the codebase imports Kafka directly. This satisfies "Kafka only
where it provides real benefit" without deploying a broker for a
prototype with no consumers yet.

This abstraction existed since Phase 1 purely as a promise; Phase 6's
`message.sent` event (`DomainEventsService.publishMessageSent`, defined
in `common/events/`) is its first real producer *and* consumer.
`ChatService.sendMessage` publishes after persisting; `ChatGateway`
subscribes via `@OnEvent(MESSAGE_SENT_EVENT)` and rebroadcasts to the
Socket.IO room for that conversation. `ChatGateway` importing the event
bus directly (rather than going through some intermediary) is a
deliberate, narrow exception to "nothing else imports the event bus
directly" — WebSocket push is an in-process, single-server-instance
concern today, not something that needs to survive a future move to
Kafka the way cross-service events would. When this API is horizontally
scaled, the fan-out step (not the publish/subscribe contract) is what
gets a Redis/Kafka-backed adapter so a message sent to an instance one
user isn't connected to still reaches them.

## Prisma engine strategy

`schema.prisma`'s generator block sets `engineType = "wasm"`. Concretely:
the generated Prisma Client runs entirely on the WASM query engine
bundled inside `@prisma/client` itself, talking to Postgres through
`@prisma/adapter-pg` (a thin wrapper over `pg`) — `PrismaService`
constructs that adapter from `DATABASE_URL` and passes it to
`PrismaClient` explicitly (see `apps/api/src/prisma/prisma.service.ts`).
There is no native (Rust-compiled) query engine binary anywhere in this
project.

This is deliberate, not incidental. The project was built in a
network-restricted sandbox that could reach `registry.npmjs.org` but not
Prisma's binary CDN (`binaries.prisma.sh`) — the host every native engine
binary is fetched from, for `generate`, `migrate`, and normal runtime
query execution alike. That blocked `prisma generate` outright: even
`prisma validate`, which resolves the schema entirely through a
WASM parser, still ran an unconditional preflight step that tried (and
failed) to resolve a native `schema-engine` binary before doing anything
schema-specific. Prisma 5.20 (this project's original pin) can produce a
WASM *query* engine, but `generate` itself still required a native
`libquery-engine` at generate-time in that version. Prisma 7's fully
WASM-first pipeline (`getConfig`/`validate`/DMMF all run through
`@prisma/prisma-schema-wasm`, and the generated client itself needs no
native binary when `engineType = "wasm"` + a driver adapter are used)
was the first version where the whole path — schema parsing *and* the
generated client's runtime query engine — could avoid the native binary
entirely, given an npm-registry-only network path.

Practical effect: `prisma generate` still runs one preflight check that
tries to resolve a `schema-engine` binary before it gets to the (fully
WASM) real work, even though nothing that follows in `generate` actually
executes it. On an unrestricted network this preflight just succeeds
silently. On a network that blocks `binaries.prisma.sh` specifically,
point `PRISMA_SCHEMA_ENGINE_BINARY` at any existing, executable file —
it only needs to resolve a path, never actually run it, for `generate`
in WASM mode. This is **not** needed on a normal developer machine, CI
runner, or production environment — leave it unset there and `prisma
generate` (and `prisma migrate`, `prisma studio`, which *do* need a real
schema engine) will fetch the real binary normally.

`prisma migrate`/`prisma studio` still need a genuine native
schema-engine binary (they do real migration diffing/introspection, not
just client generation) and are unaffected by any of this on an
unrestricted network — this project doesn't rely on them regardless,
since its migrations are hand-authored SQL (see DATABASE.md).

## Scale-up path

```
1 server (prototype)
  → N stateless NestJS instances behind a load balancer
    → Redis: shared sessions, rate-limit counters, Socket.IO adapter
      → PostgreSQL primary + read replicas (discovery reads → replicas)
        → PgBouncer connection pooling
          → Kafka (async events only, never the sync request path)
            → Kubernetes + HPA once traffic justifies the ops overhead
```

See SCALING.md (added in the deployment phase) for the fully worked-out
version of this with concrete numbers from load testing.

## Phase status

- [x] Phase 1 — project scaffold, database schema, security model
- [x] Phase 2 — authentication (Google OAuth + email/password, sessions, CSRF, rate limiting)
- [x] Phase 3 — profile + activities
- [x] Phase 4 — location + 1 km matching
- [x] Phase 5 — connection requests
- [x] Phase 6 — chat (REST persistence + Socket.IO live push)
- [x] Phase 7 — map (fuzzed positions, ~150 m, deterministic per viewer/target/day)
- [ ] Phase 8 — safety / privacy
- [ ] Phase 9 — testing
- [ ] Phase 10 — load testing
- [ ] Phase 11 — deployment
