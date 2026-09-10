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
| POST | `/connections/requests/:id/accept` | yes + CSRF | Only the request's recipient may accept. 403 if not the recipient, 409 if no longer `PENDING`. Creates (or revives, if this pair previously unmatched for this activity) a `Connection` row, and — new in Phase 6 — eagerly upserts the one `Conversation` row for that connection in the same transaction, so chat is immediately usable. Returns `{ connectionId, conversationId }`. |
| POST | `/connections/requests/:id/decline` | yes + CSRF | Only the recipient may decline. 403 / 409 as above. A declined request does **not** permanently block future requests — the duplicate-prevention index only blocks a second *pending* one (see DATABASE.md). Returns `{ status: "DECLINED" }`. |
| DELETE | `/connections/requests/:id` | yes + CSRF | Only the requester may cancel their own still-pending request — a hard delete, not a status change. 403 if not the requester, 409 if no longer `PENDING`. Returns `{ cancelled: true }`. |
| GET | `/connections` | yes | The caller's active (non-unmatched) connections, newest first: `[{ id, activityKey, createdAt, otherUser, conversationId }]`. `otherUser` is always "the other participant", regardless of who originally sent the request. A row is silently skipped (never emitted with a null `conversationId`) if its conversation can't be loaded — should not happen in practice since accept always creates one. |
| DELETE | `/connections/:id` | yes + CSRF | Unmatch — either participant may do this. Soft-delete (`removedAt`), so a later fresh request between the same pair for the same activity, if accepted, revives the same row rather than erroring. 403 if the caller isn't a participant, 404 if not found or already removed. Returns `{ removed: true }`. |

## Chat (Phase 6)

Persistence, validation, CSRF, and rate limiting all live on the REST
routes below — the same rigor as every other mutating route in the app.
The WebSocket gateway (below) is *only* for live push; a client never
writes a message over the socket.

Every route is scoped to `:conversationId`. `ChatService` resolves the
`Conversation` → its `Connection` → checks the session user is one of
`userAId`/`userBId` on every call — never trusts a client-supplied
identity for who's allowed to read or write. This is the literal route
shape SECURITY.md §3 specified before any Phase 6 code existed.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/conversations/:conversationId/messages` | yes | Cursor-paginated history, oldest-first: `[{ id, conversationId, senderId, body, sentAt, readAt }]`. Query params: `before` (optional ISO-8601 timestamp — strict `sentAt <` cursor), `limit` (optional, 1–100, default 50, oversized values silently capped rather than rejected). 404 if the conversation doesn't exist, 403 if the caller isn't one of its two participants. **Reading history is allowed even after the connection has ended** (unmatched) — only *sending* is blocked at that point (see SECURITY.md §10 retention philosophy). |
| POST | `/conversations/:conversationId/messages` | yes + CSRF | Body: `{ body }`, 1–2000 characters. 403 if not a participant, 400 once the connection has ended ("This connection has ended — you can no longer send messages here"). Persists the message with `senderId` from the session (never the body), then publishes a domain event that the WebSocket gateway rebroadcasts to the conversation's room. Rate-limited (`RATE_LIMIT_MAX_MESSAGES`, default 60/min). Returns the created message. |
| POST | `/conversations/:conversationId/messages/read` | yes + CSRF | Marks every unread message from the *other* participant as read — never the caller's own messages, regardless of body. Allowed even after the connection has ended, same as `GET`. Returns `{ updated: <count> }`. |

### WebSocket gateway (`ChatGateway`)

Same origin as the REST API (`ws://localhost:4000` in dev), CORS-scoped
to `CORS_ALLOWED_ORIGIN` with credentials. Socket.IO's handshake does not
run Express's cookie-parser, so the session cookie is parsed and unsigned
by hand (`extractSignedCookie`, replicating cookie-parser's `s:<value>.<hmac>`
scheme) and checked against the same validity rules `SessionAuthGuard`
uses (not revoked, not expired, user `ACTIVE`).

Authentication runs as Socket.IO server-side middleware (`io.use()`,
registered in `afterInit`), not in `handleConnection` — the client's
`connect` event, and therefore anything the client does the instant it
fires (like emitting `join`), only ever happens *after* the middleware
chain resolves. Authenticating in `handleConnection` instead would have
been a real, exploitable-by-nobody-but-still-wrong race: an async DB
lookup racing a client's immediate `join` could make a legitimate
participant's join fail exactly like an outsider's. An unauthenticated
or invalid-session socket never completes its handshake — the client
gets `connect_error`, never `connect`.

| Client emits | Payload | Ack | Notes |
|---|---|---|---|
| `join` | `{ conversationId }` | `{ joined: boolean }` | Re-checks participation via `ChatService.isParticipant` on *every* call, never cached on the socket — membership can change (unmatch) for the lifetime of a long-held connection. Joins the room `conversation:<id>` only on `joined: true`. |
| `leave` | `{ conversationId }` | `{ left: true }` | Always acknowledges; a no-op if `conversationId` is missing. |

| Server emits | Payload | Notes |
|---|---|---|
| `message` | The same shape `POST /conversations/:id/messages` returns | Pushed to everyone currently joined to `conversation:<id>` the moment `ChatService.sendMessage` persists a new message — via the in-process domain-event bus (`DomainEventsService` → `EventEmitter2`), not a direct call from the REST controller into the gateway. |

Verified against a real `socket.io-client` connection (not just mocks):
cookie-based handshake auth (success, missing cookie, tampered cookie —
all three exercised), join authorization for both an actual participant
and an unrelated third user, and a live `message` event delivered to a
joined socket when the other participant posts via REST.

## Map (Phase 7)

The same underlying search as `/discovery/nearby` — same auth
requirement, same activity/radius/offset query params, same
exclusions (self, non-`ACTIVE`, non-discoverable/hidden, blocked in
either direction, wrong activity/availability, outside radius) — but
shaped for rendering pins on a map instead of cards in a list.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| GET | `/map/nearby` | yes | Query params identical to `/discovery/nearby`: `activityKey` (required), `radiusMeters` (optional, same fixed set), `offset` (optional). 400 if the caller hasn't set a location yet. Rate-limited separately (`RATE_LIMIT_MAX_MAP`, default 20/min) — same rationale as discovery's own limit (§5 of SECURITY.md): a position, even a fuzzed one, is exactly what repeated querying is trying to profile. |

**Response shape:** `{ pins: [{ userId, firstName, photoUrl, ageRange, verificationBadge, activityKey, availability, distanceLabel, latitude, longitude }] }` — every field except `latitude`/`longitude` is identical to a `/discovery/nearby` result.

**`latitude`/`longitude` are always fuzzed, never real.** This is the one endpoint in the entire API that returns a lat/lng pair for a user other than the caller, and it is deliberately never the real one: each position is randomized by up to 150 m (`MAP_FUZZ_RADIUS_METERS` in `@companio/shared`), computed deterministically from `(viewer, target, calendar day)` — see `apps/api/src/map/location-fuzz.util.ts` and SECURITY.md §5. Practically: refreshing the map within the same day shows the same pin position (it doesn't jitter around), but two different viewers see two different fuzzed positions for the same target, and tomorrow's position for the same viewer/target pair will differ from today's. Verified against a live database (axis-order correctness — `ST_Y`/`ST_X` are easy to swap — see `scripts/phase7-map-check.sql`) and over real HTTP (fuzzed position within bound, stable across repeated calls the same day, and gone entirely once a block exists between the two users).

## Safety (Phase 8)

Every route requires a session; the mutating ones (`POST`/`DELETE`) also
require CSRF. Both blocking and reporting are always scoped to the
caller as the acting party (`blockerId`/`reporterId` from the session,
never the body) — a client can name a *target* but never act on another
user's behalf.

| Method | Path | Auth required | Notes |
|---|---|---|---|
| POST | `/safety/blocks` | yes + CSRF | Body: `{ blockedUserId }`. 400 if blocking yourself, 404 if the target doesn't exist. 409 if already blocked. Creating a block is **not just an insert** — in the same transaction it also ends any active `Connection` between the pair and declines any `PENDING` `ConnectionRequest` in either direction (see DATABASE.md "Block creation side effects"). Returns `{ blocked: true }`. |
| GET | `/safety/blocks` | yes | The caller's own block list, newest first: `{ blocks: [{ userId, firstName, photoUrl, blockedAt }] }`. `firstName`/`photoUrl` are `null` if the blocked user's profile can no longer be resolved (never an error). |
| DELETE | `/safety/blocks/:userId` | yes + CSRF | Unblocks — scoped to `blockerId = caller`, so you can only remove a block *you* created, never one the other person placed on you. 404 if no such block exists. Returns `{ unblocked: true }`. Unblocking does **not** restore the ended connection or revive the declined request — those stay ended; a fresh connection request would need to be sent again. |
| POST | `/safety/reports` | yes + CSRF | Body: `{ reportedUserId, category, details? }`. `category` is one of `HARASSMENT \| SPAM \| FAKE_PROFILE \| INAPPROPRIATE_BEHAVIOR \| SUSPICIOUS_ACTIVITY \| OTHER`. `details` is optional free text, 0–1000 characters. 400 if reporting yourself, 404 if the target doesn't exist. Always created with `status: "OPEN"`. Rate-limited separately (`RATE_LIMIT_MAX_REPORTS`, default 5/min) — filing reports has a real mass-filing abuse vector that blocking doesn't. Returns the created report. |
| GET | `/safety/reports` | yes | Reports **filed by** the caller, newest first: `{ reports: [{ id, reportedUserId, category, details, status, createdAt }] }`. Never includes reports filed *against* the caller — there is no route anywhere that lets a user see who reported them. |

**Why blocking has no dedicated throttle but reporting does:** blocking
someone has no meaningful abuse value to a malicious caller (there's
nothing to gain from mass-blocking), so it relies on the platform
default limit; filing many false reports against a target is a real
harassment vector, so reports get their own stricter limit — same
reasoning as `/discovery/nearby` and `/map/nearby`'s dedicated limits
for a different kind of abuse (§5/§8 of SECURITY.md).

**Closing the accept-after-block gap.** `ConnectionsService.acceptRequest`
never re-checks the `Block` table itself — only `sendRequest` did, prior
to Phase 8. Rather than adding a second check there, `SafetyService.createBlock`
closes the gap *by construction*: the moment a block is created, every
`PENDING` request between the pair is atomically declined in the same
transaction, so there is no longer a pending request left for
`acceptRequest` to ever see. See DATABASE.md and the service's own
docblock for the full reasoning.
