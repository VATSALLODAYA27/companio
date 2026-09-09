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
| ORM | Prisma | Type-safe for everything except the PostGIS geography column, which is isolated to one raw-SQL repository |
| Cache/session/rate-limit | Redis | One dependency for three needs; also the Socket.IO cross-instance adapter later |
| Realtime | Socket.IO | Built-in reconnection + room semantics (one room per conversation) |
| Auth | Google OAuth + first-party opaque session | Revocable without a token blocklist |

## Module boundaries (apps/api/src)

- `prisma/` — the only place the Prisma client is instantiated (`PrismaService`, injected everywhere else).
- `health/` — public liveness/readiness endpoint, no auth required.
- `common/filters` — global exception sanitization (see SECURITY.md §9).
- Modules added in later phases follow this same pattern: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/*.ts`, and — where the module owns a non-trivial query — a dedicated `*.repository.ts` (this is where `discovery`'s raw PostGIS query will live in Phase 4).

## Event layer (Kafka readiness without Kafka in the loop yet)

Async, non-request-path events (connection accepted, message sent,
report filed) are published through a single `DomainEventsService`
interface backed by an in-process `EventEmitter2` for local development.
Swapping it for a Kafka producer later is a one-file change — nothing
else in the codebase imports Kafka directly. This satisfies "Kafka only
where it provides real benefit" without deploying a broker for a
prototype with no consumers yet.

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
- [ ] Phase 3 — profile + activities
- [ ] Phase 4 — location + 1 km matching
- [ ] Phase 5 — connection requests
- [ ] Phase 6 — chat
- [ ] Phase 7 — map
- [ ] Phase 8 — safety / privacy
- [ ] Phase 9 — testing
- [ ] Phase 10 — load testing
- [ ] Phase 11 — deployment
