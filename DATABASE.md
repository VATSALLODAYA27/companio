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
(explicitly disallowed by the product spec). The real query — implemented
as a single `$queryRaw` in `discovery.repository.ts` in Phase 4 — performs
activity match, availability match, discovery/privacy opt-in, block
exclusion, and the 1 km geospatial radius **in one indexed pass**:

```sql
SELECT u.id, p.first_name, p.photo_url, v.status AS verification_status,
       ua.availability,
       ST_Distance(ul.geo, ST_MakePoint($lng, $lat)::geography) AS distance_m
FROM "user_activities" ua
JOIN "users" u ON u.id = ua."userId"
JOIN "profiles" p ON p."userId" = u.id
JOIN "user_locations" ul ON ul."userId" = u.id
LEFT JOIN "verifications" v ON v."userId" = u.id AND v.status = 'VERIFIED'
WHERE ua."activityId" = $activityId
  AND ua.availability != 'NOT_AVAILABLE'
  AND p.discoverable = true AND p.hidden = false
  AND u.status = 'ACTIVE' AND u.id != $currentUserId
  AND u.id NOT IN (
    SELECT "blockedId" FROM "blocks" WHERE "blockerId" = $currentUserId
    UNION SELECT "blockerId" FROM "blocks" WHERE "blockedId" = $currentUserId
  )
  AND ST_DWithin(ul.geo, ST_MakePoint($lng, $lat)::geography, $radiusMeters)
ORDER BY (ua.availability = 'NOW') DESC, distance_m ASC
LIMIT $pageSize OFFSET $offset;
```

`distance_m` is computed server-side and converted to a bucketed label
(§5 of SECURITY.md) before it ever reaches an API response — the raw
number never leaves this query.

## Migrations

Prisma-managed for every standard column; the `geo` column and its
`GIST` index are added via a hand-authored statement appended to the
initial migration (Prisma cannot express a GIST index declaratively).
See the migration file under `prisma/migrations/` once generated against
a running database (`npm run prisma:migrate`).
