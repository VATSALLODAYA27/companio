-- Removes everything scripts/loadtest-seed.sql created (background
-- population) AND every real user the k6 scripts registered over HTTP
-- during a load test run (loadtest/*.js all register real accounts
-- under the 'loadtest-vu-...@loadtest.local' pattern). ON DELETE
-- CASCADE on every child table (profiles, user_locations,
-- user_activities, verifications, sessions, connections, connection
-- requests, messages/conversations, blocks, reports — see
-- schema.prisma) means deleting the user rows is sufficient; nothing
-- is orphaned.
\timing on

BEGIN;

SELECT count(*) AS users_to_delete FROM users WHERE email LIKE 'loadtest-%@loadtest.local';

DELETE FROM users WHERE email LIKE 'loadtest-%@loadtest.local';

COMMIT;

\echo '--- orphan check across every child table ---'
SELECT
  (SELECT count(*) FROM profiles WHERE "userId" NOT IN (SELECT id FROM users)) AS orphan_profiles,
  (SELECT count(*) FROM user_activities WHERE "userId" NOT IN (SELECT id FROM users)) AS orphan_activities,
  (SELECT count(*) FROM user_locations WHERE "userId" NOT IN (SELECT id FROM users)) AS orphan_locations,
  (SELECT count(*) FROM verifications WHERE "userId" NOT IN (SELECT id FROM users)) AS orphan_verifications,
  (SELECT count(*) FROM sessions WHERE "userId" NOT IN (SELECT id FROM users)) AS orphan_sessions,
  (SELECT count(*) FROM blocks WHERE "blockerId" NOT IN (SELECT id FROM users) OR "blockedId" NOT IN (SELECT id FROM users)) AS orphan_blocks,
  (SELECT count(*) FROM reports WHERE "reporterId" NOT IN (SELECT id FROM users) OR "reportedId" NOT IN (SELECT id FROM users)) AS orphan_reports,
  (SELECT count(*) FROM connections WHERE "userAId" NOT IN (SELECT id FROM users) OR "userBId" NOT IN (SELECT id FROM users)) AS orphan_connections,
  (SELECT count(*) FROM connection_requests WHERE "requesterId" NOT IN (SELECT id FROM users) OR "recipientId" NOT IN (SELECT id FROM users)) AS orphan_requests,
  (SELECT count(*) FROM users WHERE email LIKE 'loadtest-%@loadtest.local') AS remaining_loadtest_users;
