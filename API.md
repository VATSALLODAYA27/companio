# API.md — Companio Prototype

Base URL: `http://localhost:4000/api/v1` (the `/health` endpoint is the
one exception — it is served at `/health`, outside the `/api/v1` prefix,
so uptime checks don't need to know the API version).

All endpoints return JSON. Errors follow the shape:
```json
{ "statusCode": 401, "path": "/api/v1/auth/session", "timestamp": "...", "message": "..." }
```
— never a stack trace or internal error detail (see SECURITY.md "Logging policy").

## Auth (Phase 2)

| Method | Path | Auth required | Notes |
|---|---|---|---|
| POST | `/auth/register` | no | `{ email, password, firstName }`. Sets the session cookie on success. Rate-limited. |
| POST | `/auth/login` | no | `{ email, password }`. Same generic 401 whether the email doesn't exist or the password is wrong. Rate-limited. |
| GET | `/auth/google` | no | Redirects to Google's OAuth consent screen. |
| GET | `/auth/google/callback` | no | Google redirects back here; sets the session cookie, then redirects to the web app. |
| GET | `/auth/session` | yes | 401 if not authenticated; otherwise `{ authenticated: true, userId }`. |
| POST | `/auth/logout` | yes + CSRF | Revokes the current session and clears the cookie. |
| GET | `/auth/csrf` | no | Issues the CSRF cookie/token pair the SPA echoes back via `X-CSRF-Token` on mutating authenticated requests. |

**Session cookie:** `companio_sid`, httpOnly, signed, `SameSite=Lax`, `Secure` in production. Contains only an opaque session id — never a JWT with embedded claims (see SECURITY.md). Expires per `SESSION_TTL_HOURS`.

**CSRF:** double-submit cookie (`companio_csrf`, readable by JS) + `X-CSRF-Token` header, required on every mutating request behind `SessionAuthGuard` from Phase 3 onward. Not required on `/auth/register` or `/auth/login` — there is no session cookie yet at that point for it to protect.

**Rate limiting:** `/auth/register` and `/auth/login` use a stricter limit (`RATE_LIMIT_MAX_AUTH`, default 10/min) than the platform default (`RATE_LIMIT_MAX_DEFAULT`, default 100/min). Backed by Redis so the limit is shared across API instances, not reset by hitting a different one.

## Users (Phase 2 — minimal)

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/users/me` | yes | Returns `{ id, email, status, createdAt }` only — no `passwordHash`, `googleId`, or internal fields. |

## Activities (Phase 3)

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/activities` | no | Public reference data — the fixed 12-activity list (`{ activities: [{ key, label }] }`). Nothing user-specific, so no auth is required. |

## Profile (Phase 3)

Every route below is the caller's **own** profile only — every handler
reads `userId` from the session (`@CurrentUser()`), never from a request
parameter, so there is no field a client can set to read or write
someone else's profile. Viewing *other* users' profiles (privacy-filtered,
distance-bucketed) is Discovery's job starting Phase 4, not this module's.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/profile/me` | yes | 404 if the profile hasn't been created yet (first-run signal for onboarding). Returns `{ firstName, photoUrl, ageRange, bio, city, languages, discoverable, hidden, verificationBadge, updatedAt }`. `ageRange` is always a bucket (e.g. `"25-34"`) — never a date of birth or exact age. `verificationBadge` is `"GOOGLE_VERIFIED"` or `"NONE"`, computed from the Verification table — the raw provider/status rows never leave the server. |
| PUT | `/profile/me` | yes + CSRF | Upserts the caller's profile. Body: `{ firstName, photoUrl?, ageRange?, bio?, city?, languages?, discoverable?, hidden? }`. `photoUrl` must be `https://...` (rejects `javascript:`/`data:` etc). `ageRange` must be one of the fixed buckets — anything else is a 400. Unknown fields in the body are a 400 (`forbidNonWhitelisted`), not silently dropped. |
| GET | `/profile/me/activities` | yes | The caller's own selected activities: `[{ activityKey, label, availability }]`. |
| PUT | `/profile/me/activities` | yes + CSRF | Replace-all: body `{ activities: [{ activityKey, availability }] }` becomes the caller's complete activity set — anything not listed is removed. `activityKey` must be one of the 12 fixed keys; duplicate keys in one request are a 400. `availability` is one of `NOW \| TODAY \| WEEKEND \| NOT_AVAILABLE`. |

## Location (Phase 4)

| Method | Path | Auth required | Notes |
|---|---|---|---|
| PUT | `/location/me` | yes + CSRF | Body: `{ latitude, longitude }` (validated as real lat/lng ranges). Upserts the caller's own location — `userId` always comes from the session, never from the body. Written through raw SQL only (the geography column has no Prisma-native type); a privacy-safe geohash6 (~1.2km cell) is stored alongside it for future use. Returns `{ updated: true }`. |
| DELETE | `/location/me` | yes + CSRF | Clears the caller's own location row. Once cleared, the caller drops out of everyone else's discovery results and `GET /discovery/nearby` returns 400 for the caller until they set a location again. Returns `{ cleared: true }`. |

No endpoint ever accepts another user's id here, and there is no route
that reads a location back as raw coordinates — the only consumer of
`user_locations.geo` is the discovery repository below, and even it never
projects a raw coordinate into a response (see SECURITY.md §5).

## Discovery (Phase 4)

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/discovery/nearby` | yes | Query params: `activityKey` (required, one of the 12 fixed keys), `radiusMeters` (optional, one of `1000 \| 3000 \| 5000 \| 10000 \| 25000 \| 50000`, defaults to `DEFAULT_SEARCH_RADIUS_METERS`), `offset` (optional, `>= 0`, defaults to `0`, page size fixed at 20). 400 if the caller hasn't set a location yet (`PUT /location/me` first). Rate-limited separately from the platform default (`RATE_LIMIT_MAX_DISCOVERY`, default 20/min) since this is the most query-heavy route in the app. |

**Response shape:** `{ results: [{ userId, firstName, photoUrl, ageRange, verificationBadge, activityKey, availability, distanceLabel }] }`. There is no `distanceLabel` finer than `"< 250 m"` and no raw distance in meters anywhere in the payload — distance is bucketed entirely inside the SQL query before the row is even fetched into the API process (see DATABASE.md "The nearby-match query"). `availability` is never `NOT_AVAILABLE` here — matching Availability is excluded by the query itself, not filtered afterward.

**Origin point:** the caller's own saved location, read once per query from their own `user_locations` row — a client can never pass an arbitrary lat/lng to search *from*, only the radius and activity to search *with*.

**Exclusions applied inside the single query, not afterward in application code:** the caller themselves; users who don't have `discoverable = true` and `hidden = false`; users with `status != ACTIVE`; anyone the caller has blocked or who has blocked the caller (checked both directions); anyone outside the requested radius; anyone not selecting the requested activity with an availability other than `NOT_AVAILABLE`.

**Ordering:** `NOW` availability first, then ascending distance.

## Connections (Phase 5)

Every route requires a session; the mutating ones (`POST`/`DELETE`) also
require CSRF. `requesterId`/`recipientId`/participant checks always come
from the session on one side and a client-supplied id on the other (e.g.
`recipientId`, or `:id` in the URL) — every write is additionally scoped
by who the session says the caller is, so a client can send a *request*
to any id but can never accept, decline, cancel, or unmatch on someone
else's behalf (403 if the session user isn't the actual participant).

| Method | Path | Auth required | Notes |
|---|---|---|---|
| POST | `/connections/requests` | yes + CSRF | Body: `{ recipientId, activityKey }`. `recipientId` is the candidate's id exactly as returned by `GET /discovery/nearby`'s `userId`. 400 if sending to yourself; **the same generic 400** ("Unable to send a connection request to this user") whether the recipient doesn't exist, isn't `ACTIVE`, or a block exists in either direction — a requester can never learn *which* of those is true. 409 if already connected for this activity, or if a PENDING request in this direction for this activity already exists (see DATABASE.md "Connection request de-duplication"). Rate-limited (`RATE_LIMIT_MAX_CONNECTIONS`, default 20/min). |
| GET | `/connections/requests/incoming` | yes | The caller's pending received requests, newest first: `[{ id, activityKey, status, createdAt, respondedAt, otherUser: { userId, firstName, photoUrl, verificationBadge } }]`. |
| GET | `/connections/requests/outgoing` | yes | Same shape, the caller's pending sent requests — `otherUser` is the recipient. |
| POST | `/connections/requests/:id/accept` | yes + CSRF | Only the request's recipient may accept. 403 if not the recipient, 409 if no longer `PENDING`. Creates (or revives, if this pair previously unmatched for this activity) a `Connection` row. Returns `{ connectionId }`. |
| POST | `/connections/requests/:id/decline` | yes + CSRF | Only the recipient may decline. 403 / 409 as above. A declined request does **not** permanently block future requests — the duplicate-prevention index only blocks a second *pending* one (see DATABASE.md). Returns `{ status: "DECLINED" }`. |
| DELETE | `/connections/requests/:id` | yes + CSRF | Only the requester may cancel their own still-pending request — a hard delete, not a status change. 403 if not the requester, 409 if no longer `PENDING`. Returns `{ cancelled: true }`. |
| GET | `/connections` | yes | The caller's active (non-unmatched) connections, newest first: `[{ id, activityKey, createdAt, otherUser }]`. `otherUser` is always "the other participant", regardless of who originally sent the request. |
| DELETE | `/connections/:id` | yes + CSRF | Unmatch — either participant may do this. Soft-delete (`removedAt`), so a later fresh request between the same pair for the same activity, if accepted, revives the same row rather than erroring. 403 if the caller isn't a participant, 404 if not found or already removed. Returns `{ removed: true }`. |

## Not yet implemented

Chat, map, block/report, and admin endpoints land in Phases 6–8 and will
be documented here as each ships — see `ARCHITECTURE.md` for the phase
list and status. Note that `ConnectionsService` already checks the
`Block` table (in both directions) before letting a request go through,
even though there is no endpoint yet to *create* a block — that lands in
Phase 8.
