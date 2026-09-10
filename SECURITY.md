# SECURITY.md — Companio Prototype

This document is written before application code, per the project's
security-first development process. It governs every phase that follows.

## 1. Threat Model

**In scope for this prototype:**

- Account takeover (credential stuffing, session hijacking, CSRF)
- Location harvesting — an attacker repeatedly querying discovery to build
  a movement profile of a specific target
- Unauthorized access to another user's private data (profile fields not
  meant to be public, messages, exact location) via API/ID manipulation
- Abuse between matched users (harassment, spam, fake profiles) after a
  connection is made
- Injection (SQL, XSS) via user-supplied profile/message/report content
- Data exposure through verbose errors, logs, or over-fetching APIs

**Explicitly out of scope for this prototype** (documented so it isn't
mistaken for an oversight): payments, government ID/Aadhaar verification
implementation, business accounts, content moderation ML, push
notification infrastructure. The verification and event-layer
abstractions are designed so these can be added later without a rewrite.

**Primary adversary assumption:** a malicious *authenticated user* is the
main threat, not just an anonymous outsider — the core risk in a
stranger-meeting product is what a matched or unmatched user can do to
another user's privacy and safety, not just classic perimeter attacks.

## 2. Authentication Model

- **Google OAuth (primary):** Authorization Code flow. The Google
  access/refresh token is exchanged server-side and never returned to the
  browser. On success, the API creates a first-party `Session` row and
  sets an `httpOnly`, `Secure`, `SameSite=Lax` cookie containing only the
  session id.
- **Email/password (optional):** `argon2id` hashing. Plaintext passwords
  are never logged, stored, or included in any error message.
- **Session over JWT:** we deliberately use an opaque, server-checked
  session id rather than a self-contained JWT, because a JWT cannot be
  revoked without an additional blocklist — an opaque session is a single
  `DELETE`/`revokedAt` write.
- **Expiration:** sessions expire after `SESSION_TTL_HOURS` (default 24h)
  and are revoked on logout, password change, or suspicious activity.
- **Rate limiting on auth endpoints** is stricter than the platform
  default (`RATE_LIMIT_MAX_AUTH`) to blunt credential stuffing.

## 3. Authorization Model

Every protected endpoint enforces two independent checks:

1. **AuthN** — is there a valid, unexpired session? (`AuthGuard`)
2. **AuthZ** — may *this* user act on *this specific resource*? Checked
   against actual ownership/membership in the database on every request
   — never inferred from a URL parameter alone.

Concretely: reading `/conversations/:id/messages` checks that the
requesting user is one of the two participants in the `Connection` behind
that `Conversation`, every time. Changing the ID in the URL/API request
gets a `403`, not another user's messages. This is enforced in the
service layer, with a dedicated authorization test for it (see
TESTING.md).

## 4. Data Classification

| Class | Examples | Handling |
|---|---|---|
| Public (to matched/nearby users) | First name, photo, bio, activities, verification badge, bucketed distance | Returned by discovery/profile APIs |
| Private (owner only) | Email, exact coordinates, session id, internal UUIDs used for anything beyond routing | Never serialized to other users |
| Sensitive (never stored) | Aadhaar number, Aadhaar images, government ID documents, plaintext passwords | Not collected; verification providers return only status |
| Ephemeral | Live location | Current value only, no history table, overwritten in place |

## 5. Location Privacy Model

- Coordinates travel client→server over HTTPS only, in the request body
  (never a URL/query string), and are never written to logs.
- The server stores only the current position (`UserLocation`, upserted)
  plus a coarse geohash for safe caching — **no location history table**.
- Other users never receive raw coordinates. The API returns:
  - a **bucketed distance label** (e.g. "< 250 m"), not raw meters,
  - a **fuzzed map position**, randomized within ~150 m, deterministic
    per (viewer, target, day) so it doesn't jitter into an average on
    refresh but differs per viewer so results can't be compared to
    triangulate.
- `discovery/nearby` and `map/nearby` each carry their own, tighter rate
  limit (`RATE_LIMIT_MAX_DISCOVERY`, `RATE_LIMIT_MAX_MAP`) specifically
  because repeated querying is the realistic attack for profiling one
  target's movement over time — the map endpoint is if anything more
  sensitive, since it hands back a position rather than a distance
  bucket.
- A minimum location-delta threshold gates when a location update is even
  written, reducing both write volume and the granularity of any
  server-side record.
- **Accepted residual risk:** because the fuzz offset is redrawn each
  calendar day and its expected value is the real point (a random offset
  over a disk averages to its center), a viewer who recorded one target's
  fuzzed pin every day for long enough could, in principle, average those
  samples back toward the real coordinate. This is a known trade-off of
  "randomize within N meters, refreshed daily" schemes generally, not
  specific to this implementation — see DATABASE.md "The map-position
  query and coordinate fuzzing" for the fuller discussion and the
  hardening options considered out of scope for this prototype.

## 6. Encryption Strategy

- **In transit:** TLS everywhere (enforced at the load balancer /
  reverse proxy in deployment; local dev uses plain HTTP intentionally,
  documented in DEPLOYMENT.md).
- **At rest:** managed Postgres/Redis encryption-at-rest in any real
  deployment target (RDS/Cloud SQL/Railway all offer this by default) —
  the prototype does not hand-roll disk encryption.
- **Passwords:** `argon2id`, never reversible.
- **Sessions:** opaque random ids, not signed/encrypted tokens carrying
  claims.

## 7. Secrets Management

- All secrets are read from environment variables (`@nestjs/config`).
- `.env.example` documents every required variable with placeholder
  values only.
- `.env` is gitignored; a real `.env` is never committed.
- In deployment, secrets move to the platform's secret manager (see
  DEPLOYMENT.md) — never baked into a Docker image layer.

## 8. Rate Limiting & Abuse Prevention

- Redis-backed (`@nestjs/throttler`), per-user/IP.
- Tiered limits: default, stricter on `/auth/*`, stricter still on
  `/discovery/nearby` (see §5).
- Duplicate-request prevention on `ConnectionRequest` (unique constraint)
  stops repeated-request spam to the same person.
- Block relationships are enforced server-side in the discovery query
  itself (blocked users never appear in each other's results), not just
  hidden client-side.
- **Block and report (Phase 8):** `POST /safety/blocks` relies on the
  platform default limit — there is no realistic abuse gain from mass-
  blocking. `POST /safety/reports` gets its own stricter limit
  (`RATE_LIMIT_MAX_REPORTS`, default 5/min) since mass-filing false
  reports against a target is a real harassment vector, the same
  reasoning as the dedicated discovery/map limits above. Creating a
  block proactively ends any active connection and declines any pending
  connection request between the pair (see DATABASE.md "Block creation
  side effects") — the block itself is the enforcement point, not a
  flag other endpoints have to remember to check.

## 9. Logging Policy

**Never logged, under any circumstance:** passwords, OAuth/session
tokens, Aadhaar/government ID data, exact coordinates, private message
bodies, full request bodies of any authenticated endpoint.

**Logged:** request method/path/status/latency, sanitized error class and
message (no stack trace in the client response; stack traces may reach
server-side logs but never user-supplied content), user id (not email) for
correlation.

## 10. Data Retention & Account Deletion

- No location history is retained — only the current position, which is
  deleted with the account.
- On account deletion: `User.status = DELETED`, `deletedAt` set,
  `Profile`/`UserLocation`/`UserActivity` rows removed, messages
  attributed to the deleted user are retained for the *other*
  participant's conversation integrity but the sender's personal fields
  are no longer resolvable (profile is gone).
- Reports/blocks involving the deleted account are retained in
  anonymized form for trust & safety continuity — this is a legitimate
  exception to full deletion and is disclosed in the privacy-facing
  copy. **Current implementation gap:** the schema's `Block`/`Report`
  rows today cascade-delete in full when a `User` row is deleted
  (`onDelete: Cascade`), which does not yet implement the anonymized-
  retention policy stated above. This is latent, not live — no
  account-deletion endpoint exists yet in any shipped phase — and is
  tracked explicitly in DATABASE.md "Block creation side effects" as
  something whichever future phase adds account deletion needs to
  address (nullable FK / `SetNull` / explicit anonymization), rather
  than left as a silent surprise.

## 11. Incident Response Basics (prototype-level)

- `GET /health` plus structured error logs are the primary detection
  surface at this stage.
- Any suspected data exposure: rotate `SESSION_SECRET`/`CSRF_SECRET`
  (invalidates all sessions), review the exception filter's logs for the
  affected window, and — because there is no location history table —
  the blast radius of a location leak is bounded to *current* position
  only, not historical movement.
- This section will expand with real on-call/escalation procedures
  before any production deployment; it is deliberately minimal for a
  prototype with no real users yet.
