-- Phase 5 verification: the duplicate-request partial unique index and
-- the connections unique constraint, exercised directly against a live
-- database (the actual accept/decline/cancel business logic lives in
-- ConnectionsService and is covered by connections.service.spec.ts +
-- connections.e2e-spec.ts — this script only proves the two DB-level
-- invariants those tests can't reach because they mock Prisma).
-- Transactional, rolled back at the end.

BEGIN;

INSERT INTO users (id, email, status, "updatedAt") VALUES
  ('00000000-0000-0000-0000-000000000001', 'p5-a@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-000000000002', 'p5-b@test.local', 'ACTIVE', now());

\echo '--- 1) a PENDING request from A->B for trekking can be inserted ---'
INSERT INTO connection_requests (id, "requesterId", "recipientId", "activityId", status)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-000000000002', id, 'PENDING'
FROM activities WHERE key = 'trekking';

\echo '--- 2) a SECOND PENDING request, same direction + same activity, must be rejected (partial unique index) ---'
DO $$
BEGIN
  INSERT INTO connection_requests (id, "requesterId", "recipientId", "activityId", status)
  SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
         '00000000-0000-0000-0000-000000000002', id, 'PENDING'
  FROM activities WHERE key = 'trekking';
  RAISE EXCEPTION 'expected a unique_violation but the duplicate insert succeeded';
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'duplicate PENDING request correctly rejected by connection_requests_pending_unique_idx';
END $$;

\echo '--- 3) a request for a DIFFERENT activity between the same pair is fine (index is per-activity) ---'
INSERT INTO connection_requests (id, "requesterId", "recipientId", "activityId", status)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-000000000002', id, 'PENDING'
FROM activities WHERE key = 'bowling';
SELECT count(*) AS pending_requests_ab FROM connection_requests
  WHERE "requesterId" = '00000000-0000-0000-0000-000000000001' AND status = 'PENDING';
-- expect: 2 (trekking + bowling)

\echo '--- 4) decline the trekking request, then a FRESH pending request for the same pair+activity is allowed again ---'
UPDATE connection_requests SET status = 'DECLINED', "respondedAt" = now()
  WHERE "requesterId" = '00000000-0000-0000-0000-000000000001'
    AND "recipientId" = '00000000-0000-0000-0000-000000000002'
    AND "activityId" = (SELECT id FROM activities WHERE key = 'trekking')
    AND status = 'PENDING';

INSERT INTO connection_requests (id, "requesterId", "recipientId", "activityId", status)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-000000000002', id, 'PENDING'
FROM activities WHERE key = 'trekking';
\echo 'a re-request after DECLINE was accepted (partial index only blocks PENDING duplicates, not history)'

\echo '--- 5) accept: insert the Connection with sorted (userAId, userBId) ---'
INSERT INTO connections (id, "userAId", "userBId", "activityId")
SELECT gen_random_uuid(),
       LEAST('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')::uuid,
       GREATEST('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')::uuid,
       id
FROM activities WHERE key = 'bowling';

\echo '--- 6) a duplicate active connection for the same pair+activity is rejected (connections unique constraint) ---'
DO $$
BEGIN
  INSERT INTO connections (id, "userAId", "userBId", "activityId")
  SELECT gen_random_uuid(),
         LEAST('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')::uuid,
         GREATEST('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')::uuid,
         id
  FROM activities WHERE key = 'bowling';
  RAISE EXCEPTION 'expected a unique_violation but the duplicate connection insert succeeded';
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'duplicate connection correctly rejected by connections_userAId_userBId_activityId_key';
END $$;

\echo '--- 7) the constraint is a plain (not symmetric) unique index: an UN-sorted insert of the SAME pair, reversed, is NOT caught by the DB ---'
-- This is exactly why ConnectionsService.acceptRequest always computes
-- `[userAId, userBId] = [requesterId, recipientId].sort()` before every
-- read AND write (see hasActiveConnection / acceptRequest) instead of
-- ever writing requester/recipient order directly — the uniqueness
-- guarantee is an application-level discipline the schema comment on
-- `Connection` documents, not something Postgres enforces for you.
INSERT INTO connections (id, "userAId", "userBId", "activityId")
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
       '00000000-0000-0000-0000-000000000001', id
FROM activities WHERE key = 'bowling';
SELECT count(*) AS bowling_connection_rows_for_the_pair FROM connections
  WHERE "activityId" = (SELECT id FROM activities WHERE key = 'bowling');
-- expect: 2 — proving the DB alone would allow two rows for one pair if
-- the app ever forgot to canonicalize the order; delete the bad one so
-- the cascade check below starts from a clean, correct state.
DELETE FROM connections WHERE "userAId" = '00000000-0000-0000-0000-000000000002'
  AND "userBId" = '00000000-0000-0000-0000-000000000001';

\echo '--- 8) cascade: deleting user A removes their connection_requests and connections rows ---'
DELETE FROM users WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT
  (SELECT count(*) FROM connection_requests WHERE "requesterId" = '00000000-0000-0000-0000-000000000001') AS orphan_requests,
  (SELECT count(*) FROM connections WHERE "userAId" = '00000000-0000-0000-0000-000000000001' OR "userBId" = '00000000-0000-0000-0000-000000000001') AS orphan_connections;
-- expect: 0, 0

ROLLBACK;
