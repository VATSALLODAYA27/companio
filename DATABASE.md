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

## The map-position query and coordinate fuzzing (Phase 7)

`DiscoveryRepository.findNearbyForMap` is the same `candidates` CTE as
above (identical activity/availability/discoverable/hidden/status/
block/radius filtering, kept as a separate statement rather than a
shared query builder specifically so Phase 4's already-verified
`findNearby` can never regress from a Phase 7 change), with two extra
projected columns:

```sql
ST_Y(ul.geo::geometry) AS "rawLatitude",
ST_X(ul.geo::geometry) AS "rawLongitude"
```

`ST_X`/`ST_Y` require a `geometry`, not `geography` — hence the cast —
and, critically, PostGIS points are internally `(x, y)` i.e. `(lng,
lat)`, the reverse of how coordinates are normally spoken/written. Mixing
these up is an easy, silent bug: swapped values still look like
plausible-ish numbers rather than an obvious error. `scripts/phase7-map-check.sql`
§2 guards against exactly this by asserting the extracted values against
the literal numbers that were inserted, at coordinates chosen so a swap
would not coincidentally look right.

These raw coordinates are real — this repository method is the one
deliberate exception, project-wide, to "another user's exact location
never leaves the database layer." What makes it safe is `MapService`:
every row is immediately passed through `fuzzPosition`
(`apps/api/src/map/location-fuzz.util.ts`) before anything is returned,
replacing the real point with one randomized by up to 150 m
(`MAP_FUZZ_RADIUS_METERS`). The repository's return type names the
fields `rawLatitude`/`rawLongitude` specifically so any code that might
someday forward them has to visibly touch something called "raw" first.

**Fuzzing scheme.** The offset for a given `(viewerId, targetId)` pair
is derived from `SHA-256(viewerId:targetId:YYYY-MM-DD)` (UTC calendar
day) — two independent uniform values are read from disjoint 4-byte
ranges of the digest and converted to a point drawn uniformly over the
*area* of a disk of radius 150 m (`radius = 150 * sqrt(u1)`, not `150 *
u1`, which would bunch points near the center). No random seed or
per-request state is involved, so the scheme needs nothing stored in the
database beyond the real coordinate itself: the same three inputs always
reproduce the same offset, so a viewer's map doesn't jitter around on
every refresh; a different viewer, a different target, or the next
calendar day all produce an unrelated offset, so results can't be
compared across viewers to triangulate the real point (SECURITY.md §5).

**Known, accepted residual risk.** A disk offset with mean zero means
that averaging enough distinct days' fuzzed positions for the same
target trends back toward the real coordinate — a viewer who logged one
target's daily pin for long enough could, in principle, reconstruct
something close to their true position. This is a real limitation of
"randomize within N meters, changing daily" schemes, not unique to this
implementation (comparable issues have been publicly reported against
production dating apps that used a similar approach). It is accepted
here, not overlooked: `RATE_LIMIT_MAX_MAP` bounds how fast one viewer can
accumulate samples, and the fixed 24-hour cadence bounds how many
distinct samples even exist to average. A production hardening path
would add either a cap on how many distinct days of one target's
position a single viewer can retain, or a per-`(viewer, target)` offset
that never changes at all (trading "impossible to average" for "always
identical, easier to memorize") — out of scope for this prototype but
flagged here rather than silently accepted.

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

## Conversation and Message (Phase 6)

`Conversation.connectionId` is `@unique` — a true 1:1 with `Connection`,
not 1:N. There is exactly one conversation per connection for the
lifetime of that connection, created eagerly by
`ConnectionsService.acceptRequest` (an `upsert` inside the same
transaction as the `Connection` upsert/revive) rather than lazily on
first message — SECURITY.md §3's route design (`/conversations/:id/...`,
resolved by walking `Conversation` → `Connection` → participant check)
assumes a `conversationId` always already exists once a connection is
active, so there is no "conversation not created yet" branch to handle
anywhere in `ChatService` or `ChatController`.

`Message.senderId` and `Message.conversationId` both cascade-delete from
their respective parents at the schema level, verified live in
`scripts/phase6-chat-check.sql` §5 (deleting a `Connection` row leaves
zero orphaned `Conversation`/`Message` rows). In the running app this
path never actually fires — unmatch is `Connection.removedAt` (a soft
delete, see "Soft deletion" above and SECURITY.md §10), never a row
`DELETE` — so this proves the schema's safety net works as a backstop,
not something the API relies on for its normal unmatch flow. Message
*history* stays fully readable (and mark-as-read stays functional) after
`removedAt` is set; only `POST .../messages` (sending a new message) is
rejected once a connection has ended.

`markRead`'s update is intentionally one-directional —
`WHERE "senderId" != $callerId AND "readAt" IS NULL` — so a caller
marking a conversation read can only ever flip the *other* participant's
messages to read, never their own; `scripts/phase6-chat-check.sql` §4
demonstrates this against real rows rather than relying on the mocked
unit tests alone.

## Block creation side effects (Phase 8)

`SafetyService.createBlock` is a single Prisma `$transaction` (the array
form — no intermediate result needs to be read between steps) with three
operations, not a plain insert:

```ts
this.prisma.$transaction([
  this.prisma.block.create({ data: { blockerId, blockedId } }),
  this.prisma.connection.updateMany({
    where: { userAId: sortedA, userBId: sortedB, removedAt: null },
    data: { removedAt: new Date() },
  }),
  this.prisma.connectionRequest.updateMany({
    where: {
      status: 'PENDING',
      OR: [
        { requesterId: blockerId, recipientId: blockedId },
        { requesterId: blockedId, recipientId: blockerId },
      ],
    },
    data: { status: 'DECLINED', respondedAt: new Date() },
  }),
]);
```

**Why this needs to be transactional and proactive, not a follow-up
cleanup step.** `ConnectionsService.acceptRequest` has never itself
re-checked the `Block` table — only `sendRequest`'s `isEligibleRecipient`
does (Phase 5). Before Phase 8, that was fine: there was no way to
create a block *after* a request was already sent, so the gap was
theoretical. Once blocking exists, it isn't: user A could send a
request, user B could block A a moment later, and without this
transaction, B's still-`PENDING` request from A would remain acceptable
by B in a later, confused session — a block that doesn't actually stop
the person it names. Rather than adding a second, easy-to-forget guard
inside `acceptRequest` (or scattering the check across every place a
connection or request is read), `createBlock` closes the gap by
construction: the instant a block exists, there is no longer a pending
request or an active connection left for the rest of the app to act on
inconsistently. This mirrors the "queries the domain table directly
rather than importing the owning module" pattern used elsewhere (see
ARCHITECTURE.md's `safety/` bullet) — `SafetyModule` does not import
`ConnectionsModule` for this.

**Not activity-scoped.** The `connection.updateMany` above matches on
`(userAId, userBId)` alone, not a third `activityId` clause — a block
between two people ends *every* connection between that pair, regardless
of how many different activities they were separately connected for.
Similarly the `connectionRequest.updateMany` declines every pending
request in either direction, for any activity. A block is a statement
about not wanting contact with a specific person at all, not about one
activity. Verified against a live database in
`scripts/phase8-safety-check.sql` §3/§4 with a two-activity, two-pending-
request fixture, and over real HTTP with a real accepted connection and
a real still-pending request.

**Unblocking does not undo either side effect.** `removeBlock` only
deletes the `(blockerId, blockedId)` block row — the ended connection
stays ended (`removedAt` is never cleared) and the declined request
stays `DECLINED`. A fresh connection request has to be sent and accepted
again from scratch. This is a deliberate simplicity choice for the
prototype, not an oversight: silently reviving a connection or request
on unblock would be a surprising side effect for a "just let me undo a
block" action.

**Known gap: blocks/reports and account-deletion retention.** Both
`Block` and `Report` have `onDelete: Cascade` on their `User` relations
in `schema.prisma` today, meaning deleting a `User` row cascades away
every block and report that user was party to, in full — verified
(illustrated, not asserted as a pass/fail check) in
`scripts/phase8-safety-check.sql` §8. This directly contradicts
SECURITY.md §10's stated policy that "reports/blocks involving the
deleted account are retained in anonymized form for trust & safety
continuity." The contradiction is latent rather than live: no
account-deletion endpoint exists anywhere in this codebase yet (it
isn't one of the 11 planned phases as currently scoped), so nothing
today can actually trigger the cascade in production use. It is flagged
here deliberately, the same judgment call as the map-fuzzing residual
risk above, rather than silently fixed with a bigger schema change
(nullable FK columns, `onDelete: SetNull`, an explicit anonymization
step) that itself needs dedicated design work — that work belongs to
whichever future phase actually implements account deletion, which
should update this section once it does.

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
