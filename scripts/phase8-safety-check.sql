-- Phase 8 verification: the REAL SafetyService.createBlock transaction
-- (insert block + end active connections + decline pending requests,
-- not activity-scoped) against a live database, plus a duplicate-block
-- unique-violation check, plus a report insert/read-back. Also
-- illustrates (does not fix — see DATABASE.md "Blocks/reports and
-- account-deletion retention") the current schema/SECURITY.md §10
-- mismatch around cascade-deleting blocks/reports. Transactional,
-- rolled back at the end.

BEGIN;

INSERT INTO users (id, email, status, "updatedAt") VALUES
  ('00000000-0000-0000-0000-000000000001', 'a@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-000000000002', 'b@test.local', 'ACTIVE', now());

\echo '--- 1) fixture: two active Connections (different activities) + a PENDING request each direction ---'
INSERT INTO connections (id, "userAId", "userBId", "activityId")
SELECT '00000000-0000-0000-0000-0000000000c1'::uuid,
       LEAST('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')::uuid,
       GREATEST('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')::uuid,
       id
FROM activities WHERE key = 'trekking';

INSERT INTO connections (id, "userAId", "userBId", "activityId")
SELECT '00000000-0000-0000-0000-0000000000c2'::uuid,
       LEAST('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')::uuid,
       GREATEST('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')::uuid,
       id
FROM activities WHERE key = 'bowling';

INSERT INTO connection_requests (id, "requesterId", "recipientId", "activityId", status, "createdAt")
SELECT '00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-000000000001'::uuid,
       '00000000-0000-0000-0000-000000000002'::uuid, id, 'PENDING', now()
FROM activities WHERE key = 'gym';

INSERT INTO connection_requests (id, "requesterId", "recipientId", "activityId", status, "createdAt")
SELECT '00000000-0000-0000-0000-00000000000b'::uuid, '00000000-0000-0000-0000-000000000002'::uuid,
       '00000000-0000-0000-0000-000000000001'::uuid, id, 'PENDING', now()
FROM activities WHERE key = 'running';

\echo '--- 2) the real createBlock transaction: A blocks B ---'
INSERT INTO blocks (id, "blockerId", "blockedId", "createdAt")
VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', now());

UPDATE connections SET "removedAt" = now()
WHERE "userAId" = LEAST('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')::uuid
  AND "userBId" = GREATEST('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')::uuid
  AND "removedAt" IS NULL;

UPDATE connection_requests SET status = 'DECLINED', "respondedAt" = now()
WHERE status = 'PENDING'
  AND (
    ("requesterId" = '00000000-0000-0000-0000-000000000001'::uuid AND "recipientId" = '00000000-0000-0000-0000-000000000002'::uuid)
    OR
    ("requesterId" = '00000000-0000-0000-0000-000000000002'::uuid AND "recipientId" = '00000000-0000-0000-0000-000000000001'::uuid)
  );

\echo '--- 3) both connections (both activities) are now ended ---'
SELECT count(*) AS still_active_connections FROM connections
WHERE id IN ('00000000-0000-0000-0000-0000000000c1'::uuid, '00000000-0000-0000-0000-0000000000c2'::uuid)
  AND "removedAt" IS NULL;
-- expect: 0 (a block is not activity-scoped — it ends every connection
-- between the pair, not just one)

\echo '--- 4) both pending requests (both directions) are now DECLINED ---'
SELECT id, status FROM connection_requests
WHERE id IN ('00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000b'::uuid)
ORDER BY id;
-- expect: both DECLINED — this is what closes the gap where
-- acceptRequest never itself re-checks the Block table (see
-- SafetyService.createBlock's docblock)

\echo '--- 5) a second block attempt by A on B hits the unique constraint ---'
DO $$
BEGIN
  INSERT INTO blocks (id, "blockerId", "blockedId", "createdAt")
  VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', now());
  RAISE EXCEPTION 'expected a unique_violation but a duplicate block succeeded';
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'confirmed: blocks_blockerId_blockedId_key stops a duplicate block';
END $$;

\echo '--- 6) discovery/map-style exclusion query now excludes B from A''s results (and vice versa) ---'
SELECT count(*) AS b_visible_to_a
FROM users u
WHERE u.id = '00000000-0000-0000-0000-000000000002'::uuid
  AND u.id NOT IN (
    SELECT "blockedId" FROM blocks WHERE "blockerId" = '00000000-0000-0000-0000-000000000001'::uuid
    UNION
    SELECT "blockerId" FROM blocks WHERE "blockedId" = '00000000-0000-0000-0000-000000000001'::uuid
  );
-- expect: 0

\echo '--- 7) report insert/read-back: category + optional details + default OPEN status ---'
INSERT INTO reports (id, "reporterId", "reportedId", category, details, status, "createdAt")
VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'HARASSMENT', 'sent threatening messages', DEFAULT, now());
SELECT category, details, status FROM reports WHERE "reporterId" = '00000000-0000-0000-0000-000000000001';
-- expect: HARASSMENT, 'sent threatening messages', OPEN

\echo '--- 8) illustration only (NOT a passing/failing assertion): deleting a user today cascades away their blocks/reports ---'
\echo '--- this CONTRADICTS SECURITY.md §10 ("Reports/blocks involving the deleted account are retained in anonymized form") ---'
\echo '--- flagged in DATABASE.md as a known gap for whichever future phase implements account deletion, not fixed in Phase 8 (block/report creation) ---'
SELECT count(*) AS blocks_before_delete FROM blocks WHERE "blockerId" = '00000000-0000-0000-0000-000000000001';
DELETE FROM users WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT count(*) AS blocks_after_delete FROM blocks WHERE "blockerId" = '00000000-0000-0000-0000-000000000001';
-- today: blocks_before_delete=1, blocks_after_delete=0 (cascaded away in
-- full, not anonymized) — this is the gap being illustrated, not a check
-- that's supposed to pass.

ROLLBACK;
