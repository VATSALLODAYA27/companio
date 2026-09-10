# DATABASE.md — Companio Prototype

## Engine

PostgreSQL with the PostGIS extension. Prisma is the ORM for everything
except the geography column, which Prisma has no native type for.

## Entity-Relationship overview

```
User ──1:1── Profile
User ──1:1── UserLocation
User ──1:N── Session
User ──1:N── UserActivity ──N:1── Activity
User ──1:N── Verification
User ──1:N── ConnectionRequest (as requester)
User ──1:N── ConnectionRequest (as recipient)
Connection ──1:1── Conversation ──1:N── Message ──N:1── User (sender)
User ──1:N── Report (as reporter / as reported)
User ──1:N── Block (as blocker / as blocked)
```

Full field-level definitions live in `prisma/schema.prisma` — this
document explains the *decisions*, not a duplicate listing.

## Key decisions

- **UUID primary keys** everywhere — no sequential integer IDs are ever
  exposed via the API, which also removes enumeration attacks as a
  concern for "guess another user's ID."
- **No location history table.** `UserLocation` is one row per user,
  upserted in place. This is a deliberate privacy trade-off: it makes
  "how has this person moved over time" structurally impossible to
  answer from the database, at the cost of not being able to build
  location-based analytics later without an explicit, opt-in redesign.
- **`Unsupported("geography(Point, 4326)")`** — Prisma's escape hatch for
  types it doesn't model. The column is created by Prisma migrations but
  only ever read/written through raw SQL in the discovery repository
  (Phase 4), never through the generated client's normal query builder.
- **Verification stores only the minimum result** (`provider`, `status`,
  `verifiedAt`) — never raw KYC payloads, Aadhaar numbers, or document
  images, even from a future provider that returns them.
- **Soft deletion for `User`** (`status = DELETED`, `deletedAt`) rather
  than a hard delete, so that conversations the *other* participant
  still relies on don't break — see SECURITY.md §10 for exactly what is
  and isn't retained.

## Indexes

| Table | Index | Purpose |
|---|---|---|
| `user_activities` | `(activityId, availability)` | Core filter for the nearby-match query |
| `user_locations` | `GIST(geo)` (raw SQL migration) | `ST_DWithin` radius queries |
| `users` | `status` | Exclude suspended/deleted accounts everywhere |
| `sessions` | `userId`, `expiresAt` | Session lookup and expiry sweeps |
| `verifications` | `(userId, status)` | Verification badge lookup |
| `connection_requests` | `(recipientId, status)`, `(requesterId, status)` | Inbox/outbox queries |
| `connections` | `userAId`, `userBId` | "My connections" queries |
| `messages` | `(conversationId, sentAt)` | Paginated message history |
| `reports` | `(reportedId, status)` | Moderation queue |
| `blocks` | `blockedId` | Fast exclusion check in discovery |

## The nearby-match query

Discovery must never fetch every user and filter in application code
(explicitly disallowed by the product spec). The real query — a single
`$queryRaw` in `apps/api/src/discovery/discovery.repository.ts` (Phase 4)
— performs activity match, availability match, discovery/privacy opt-in,
block exclusion, and the geospatial radius **in one indexed pass**. The
caller's own coordinates are never passed in from the request; they are
read once per query, from the caller's own `user_locations` row, via a
`me` CTE:

```sql
WITH me AS (
  SELECT geo FROM "user_locations" WHERE "userId" = $currentUserId::uuid
),
candidates AS (
  SELECT
    u.id AS "userId", p."firstName", p."photoUrl", p."ageRange",
    ua.availability::text AS availability,
    EXISTS (
      SELECT 1 FROM "verifications" v
      WHERE v."userId" = u.id AND v.status = 'VERIFIED'
    ) AS verified,
    ST_Distance(ul.geo, (SELECT geo FROM me)) AS distance_m
  FROM "user_activities" ua
  JOIN "users" u ON u.id = ua."userId"
  JOIN "profiles" p ON p."userId" = u.id
  JOIN "user_locations" ul ON ul."userId" = u.id
  WHERE ua."activityId" = $activityId::uuid
    AND ua.availability != 'NOT_AVAILABLE'
    AND p.discoverable = true AND p.hidden = false
    AND u.status = 'ACTIVE'
    AND u.id != $currentUserId::uuid
    AND EXISTS (SELECT 1 FROM me)   -- caller has no location -> zero rows, not an error
    AND u.id NOT IN (
      SELECT "blockedId" FROM "blocks" WHERE "blockerId" = $currentUserId::uuid
      UNION
      SELECT "blockerId" FROM "blocks" WHERE "blockedId" = $currentUserId::uuid
    )
    AND ST_DWithin(ul.geo, (SELECT geo FROM me), $radiusMeters)
)
SELECT
  "userId", "firstName", "photoUrl", "ageRange", availability, verified,
  CASE
    WHEN distance_m < 250 THEN '< 250 m'
    WHEN distance_m < 500 THEN '250-500 m'
    WHEN distance_m < 1000 THEN '500 m-1 km'
    WHEN distance_m < 3000 THEN '1-3 km'
    WHEN distance_m < 5000 THEN '3-5 km'
    WHEN distance_m < 10000 THEN '5-10 km'
    WHEN distance_m < 25000 THEN '10-25 km'
    ELSE '25-50 km'
  END AS "distanceLabel"
FROM candidates
ORDER BY (availability = 'NOW') DESC, distance_m ASC
LIMIT $pageSize OFFSET $offset;
```

`distance_m` is computed in the `candidates` CTE and used only in
`ORDER BY` and the bucketing `CASE` expression — it is never in the outer
`SELECT` list, so the raw figure literally cannot be projected into a
returned row by accident; only the bucketed `distanceLabel` (§5 of
SECURITY.md) reaches the API response. Verified against a live database
in `scripts/phase4-discovery-check.sql`, including confirming
`EXPLAIN` shows an `Index Scan` on the `GIST(geo)` index (not a
sequential scan) even with the `me` self-join in place, and that a
caller with no `user_locations` row gets zero rows rather than an error
or "everyone."

## Connection request de-duplication (Phase 5)

SECURITY.md §8 requires "duplicate-request prevention on
`ConnectionRequest` (unique constraint)... stops repeated-request spam
to the same person." This is a **partial** unique index —

```sql
CREATE UNIQUE INDEX "connection_requests_pending_unique_idx"
  ON "connection_requests" ("requesterId", "recipientId", "activityId")
  WHERE "status" = 'PENDING';
```

— not a plain one, and deliberately so: a plain unique constraint on
those three columns would permanently block ever re-requesting the same
person for the same activity after a single `DECLINE`, which is not what
"stop spam" means. A second *pending* request in the same direction is
spam; a fresh request after the other person declined, or after the
connection later ended, is normal product behavior and is allowed.
`ConnectionsService.sendRequest` also checks for this case up front
(a friendlier 409 than a raw constraint violation) and additionally
catches the constraint violation itself (Postgres `23505` -> Prisma
`P2002`) as a fallback for the race between two near-simultaneous
identical requests — see `scripts/phase5-connections-check.sql` for a
live-database proof of both the block and the post-decline exception.

Prisma's schema DSL has no `WHERE` clause for `@@unique`, so — exactly
like the PostGIS `GIST` index in Phase 1 — this index exists only in a
hand-authored migration
(`prisma/migrations/20260909020000_connection_request_pending_unique`),
not in `schema.prisma` itself; see that migration's comment.

**Canonical pair ordering for `Connection`.** `Connection.userAId`/
`userBId` are always written in sorted order (`[a, b].sort()`), never
"requester"/"recipient" order, by every read and write in
`ConnectionsService`. Postgres's plain `UNIQUE(userAId, userBId,
activityId)` constraint is **not** symmetric — `(X, Y, activity)` and
`(Y, X, activity)` are different index keys and the database would
happily allow both — so it is this application-level sorting discipline,
not the constraint alone, that guarantees one connection row per
unordered pair per activity. `scripts/phase5-connections-check.sql` §7
demonstrates the un-sorted case actually inserting a second row, to make
that risk concrete rather than theoretical.

## Migrations

The initial migration (`prisma/migrations/20260909000000_init/`) is
hand-authored SQL, not `prisma migrate dev` output — it was written to
mirror `schema.prisma` exactly, including the `geo` column and its
`GIST` index, which Prisma cannot express declaratively as of this
schema (`Unsupported("geography(Point, 4326)")`). The Phase 5 migration
(`20260909020000_connection_request_pending_unique/`) is hand-authored
for the same reason — a partial (`WHERE`-clause) unique index, which
`@@unique` also cannot express — see "Connection request
de-duplication" above. `npm run prisma:migrate` works from here on for
anyone with an unrestricted network path to Prisma's engine CDN; this
prototype was built in a network-restricted environment where that
wasn't available, so schema changes were verified directly against a
live database instead (see `scripts/*.sql`) — see ARCHITECTURE.md
"Prisma engine strategy" for the full story and why it doesn't affect
the generated Prisma Client used at runtime. One practical wrinkle
specific to this sandbox: the tables were originally created by the
`postgres` superuser, not the `companio` app role, so DDL (`CREATE
INDEX`, etc.) must run as `postgres` (`sudo -u postgres psql`) even
though the app's normal DML runs fine as `companio` — a real deployment
would provision the app role as the schema owner and not hit this.
