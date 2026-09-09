-- Phase 3 verification: profile upsert + activity replace-all semantics
-- against a live PostGIS database, since the sandbox cannot run a
-- generated Prisma Client (see SECURITY.md / ARCHITECTURE.md notes on
-- the binaries.prisma.sh restriction). Mirrors exactly what
-- ProfileService.upsertMyProfile / setMyActivities issue, one statement
-- at a time, and rolls back at the end — nothing here is persisted.

BEGIN;

-- Two users, so we can also prove activity selection never leaks
-- across users (the same invariant SECURITY.md requires everywhere).
INSERT INTO users (id, email, "passwordHash", status, "updatedAt")
VALUES
  ('00000000-0000-0000-0000-00000000a001', 'phase3-user-a@test.local', 'x', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-00000000a002', 'phase3-user-b@test.local', 'x', 'ACTIVE', now());

-- 1) upsertMyProfile('u-a', { firstName: 'Asha', ageRange: '25-34', ... })
INSERT INTO profiles (id, "userId", "firstName", "ageRange", languages, discoverable, hidden, "updatedAt")
VALUES (gen_random_uuid(), '00000000-0000-0000-0000-00000000a001', 'Asha', '25-34', ARRAY['English','Hindi'], true, false, now())
ON CONFLICT ("userId") DO UPDATE SET
  "firstName" = EXCLUDED."firstName",
  "ageRange" = EXCLUDED."ageRange",
  languages = EXCLUDED.languages,
  "updatedAt" = now();

-- 2) setMyActivities('u-a', [gym:NOW, running:WEEKEND]) — first call, no
--    prior rows, so the deleteMany is a no-op and both upserts insert.
DELETE FROM user_activities
WHERE "userId" = '00000000-0000-0000-0000-00000000a001'
  AND "activityId" NOT IN (SELECT id FROM activities WHERE key IN ('gym','running'));

INSERT INTO user_activities (id, "userId", "activityId", availability, "updatedAt")
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000a001', id, 'NOW'::"Availability", now()
FROM activities WHERE key = 'gym'
ON CONFLICT ("userId", "activityId") DO UPDATE SET availability = EXCLUDED.availability, "updatedAt" = now();

INSERT INTO user_activities (id, "userId", "activityId", availability, "updatedAt")
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000a001', id, 'WEEKEND'::"Availability", now()
FROM activities WHERE key = 'running'
ON CONFLICT ("userId", "activityId") DO UPDATE SET availability = EXCLUDED.availability, "updatedAt" = now();

-- User B picks cricket, entirely independent of user A.
INSERT INTO user_activities (id, "userId", "activityId", availability, "updatedAt")
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000a002', id, 'TODAY'::"Availability", now()
FROM activities WHERE key = 'cricket'
ON CONFLICT ("userId", "activityId") DO UPDATE SET availability = EXCLUDED.availability, "updatedAt" = now();

\echo '--- after first setMyActivities(u-a, [gym:NOW, running:WEEKEND]) ---'
SELECT a.key, ua.availability
FROM user_activities ua JOIN activities a ON a.id = ua."activityId"
WHERE ua."userId" = '00000000-0000-0000-0000-00000000a001'
ORDER BY a.key;
-- expect: gym=NOW, running=WEEKEND

-- 3) setMyActivities('u-a', [gym:TODAY]) — replace-all: running must be
--    removed, gym's availability must change, nothing about user B moves.
DELETE FROM user_activities
WHERE "userId" = '00000000-0000-0000-0000-00000000a001'
  AND "activityId" NOT IN (SELECT id FROM activities WHERE key IN ('gym'));

INSERT INTO user_activities (id, "userId", "activityId", availability, "updatedAt")
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000a001', id, 'TODAY'::"Availability", now()
FROM activities WHERE key = 'gym'
ON CONFLICT ("userId", "activityId") DO UPDATE SET availability = EXCLUDED.availability, "updatedAt" = now();

\echo '--- after second setMyActivities(u-a, [gym:TODAY]) — running must be gone ---'
SELECT a.key, ua.availability
FROM user_activities ua JOIN activities a ON a.id = ua."activityId"
WHERE ua."userId" = '00000000-0000-0000-0000-00000000a001'
ORDER BY a.key;
-- expect: gym=TODAY only (1 row)

\echo '--- cross-user isolation: user A activities must never include user B rows ---'
SELECT count(*) AS leaked_rows
FROM user_activities
WHERE "userId" = '00000000-0000-0000-0000-00000000a001'
  AND "activityId" IN (SELECT id FROM activities WHERE key = 'cricket');
-- expect: 0

\echo '--- user B is untouched by any of user A''s writes ---'
SELECT a.key, ua.availability
FROM user_activities ua JOIN activities a ON a.id = ua."activityId"
WHERE ua."userId" = '00000000-0000-0000-0000-00000000a002'
ORDER BY a.key;
-- expect: cricket=TODAY only

\echo '--- profile row scoped correctly, badge column stays out of the profile table entirely ---'
SELECT "firstName", "ageRange", languages FROM profiles WHERE "userId" = '00000000-0000-0000-0000-00000000a001';
-- expect: Asha, 25-34, {English,Hindi}

\echo '--- @@unique(userId, activityId) actually rejects a raw duplicate insert ---'
DO $$
BEGIN
  INSERT INTO user_activities (id, "userId", "activityId", availability, "updatedAt")
  SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000a001', id, 'NOW'::"Availability", now()
  FROM activities WHERE key = 'gym';
  RAISE EXCEPTION 'expected a unique_violation but the insert succeeded';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'unique_violation correctly raised for duplicate (userId, activityId)';
END $$;

ROLLBACK;
