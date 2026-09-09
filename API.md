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
| GET | `/users/me` | yes | Returns `{ id, email, status, createdAt }` only — no `passwordHash`, `googleId`, or internal fields. Full profile fields (photo, bio, activities, ...) arrive in Phase 3. |

## Not yet implemented

Profile editing, activity selection, nearby discovery, connections, chat, map, block/report, and admin endpoints land in Phases 3–8 and will be documented here as each ships — see `ARCHITECTURE.md` for the phase list and status.
