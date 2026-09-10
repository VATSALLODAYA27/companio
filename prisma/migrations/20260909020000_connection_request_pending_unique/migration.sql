-- Phase 5 — duplicate connection-request prevention (SECURITY.md §8:
-- "Duplicate-request prevention on ConnectionRequest (unique
-- constraint) stops repeated-request spam to the same person").
--
-- Hand-authored (not `prisma migrate dev`-generated) for the same reason
-- as the initial migration's GIST index: this is a *partial* unique
-- index (`WHERE status = 'PENDING'`), which `schema.prisma`'s DSL cannot
-- express — Prisma unique constraints/indexes have no WHERE clause. It
-- is deliberately partial rather than a plain unique constraint on
-- (requesterId, recipientId, activityId): a plain constraint would
-- permanently block ever re-requesting the same person for the same
-- activity after a single DECLINE, which is not what "stop spam" means.
-- A *pending* duplicate in the same direction is spam; a fresh request
-- after the other person declined or the connection ended is not.
--
-- Application-level checks in ConnectionsService also guard against
-- duplicates and translate a race into a clean 409 (Postgres error code
-- 23505 -> Prisma P2002) rather than a 500, but the index is the actual
-- source of truth — see DATABASE.md "Connection request de-duplication".
CREATE UNIQUE INDEX "connection_requests_pending_unique_idx"
  ON "connection_requests" ("requesterId", "recipientId", "activityId")
  WHERE "status" = 'PENDING';
