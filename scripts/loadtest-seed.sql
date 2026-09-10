-- Phase 10 load-test population seed. Bulk-inserts a realistic
-- "background population" of users — profiles, activities, and
-- locations clustered around a real city (Mumbai, matching the
-- coordinates already used in README.md's manual-testing walkthroughs)
-- — so /discovery/nearby and /map/nearby queries during the k6 load
-- test have a genuine candidate set to filter and rank, not a
-- near-empty table. This is deliberately NOT wrapped in
-- BEGIN...ROLLBACK like scripts/phaseN-*-check.sql — the data has to
-- actually persist for the k6 scripts (real HTTP, a real running
-- server) to see it. Pair with scripts/loadtest-cleanup.sql to remove
-- everything it creates once the load test run is over.
--
-- Every seeded row is tagged so cleanup is a single targeted DELETE:
-- emails follow 'loadtest-bg-<n>@loadtest.local'.
--
-- Usage: psql ... -v population=5000 -f scripts/loadtest-seed.sql
-- (defaults to 5000 if -v population is not passed)

\timing on
\if :{?population}
\else
  \set population 5000
\endif

BEGIN;

-- 1) Users — ACTIVE, a small fraction SUSPENDED/DELETED so the
--    status-filter branch of the nearby-match query has real rows to
--    exclude too, not just an always-true check.
INSERT INTO users (id, email, "passwordHash", status, "updatedAt")
SELECT
  gen_random_uuid(),
  'loadtest-bg-' || n || '@loadtest.local',
  NULL,
  CASE
    WHEN n % 50 = 0 THEN 'SUSPENDED'
    WHEN n % 97 = 0 THEN 'DELETED'
    ELSE 'ACTIVE'
  END::"UserStatus",
  now()
FROM generate_series(1, :population) AS n;

-- 2) Profiles — mostly discoverable & not hidden (the common case),
--    a meaningful minority opted out of each, so those exclusion
--    branches are exercised at scale too.
INSERT INTO profiles (id, "userId", "firstName", "discoverable", hidden, "ageRange", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  u.id,
  (ARRAY['Asha','Bala','Chetan','Divya','Esha','Farhan','Gita','Hari','Isha','Jay',
         'Kavya','Lakshay','Meera','Nikhil','Om','Priya','Quasar','Riya','Sahil','Tara'])[1 + (row_number() over () % 20)],
  (row_number() over ()) % 10 != 0,   -- ~90% discoverable
  (row_number() over ()) % 20 = 0,    -- ~5% hidden
  (ARRAY['18-24','25-34','35-44','45-54','55+'])[1 + (row_number() over () % 5)],
  now(),
  now()
FROM users u
WHERE u.email LIKE 'loadtest-bg-%@loadtest.local';

-- 3) Locations — jittered around Mumbai (19.0760 N, 72.8777 E) within
--    roughly a 0.18-degree box (~20km at this latitude), so results
--    fall across every one of the app's fixed radius buckets
--    (1/3/5/10/25/50 km), not just the innermost one.
INSERT INTO user_locations (id, "userId", geo, geohash6, "updatedAt")
SELECT
  gen_random_uuid(),
  u.id,
  ST_SetSRID(
    ST_MakePoint(
      72.8777 + (random() - 0.5) * 0.18,
      19.0760 + (random() - 0.5) * 0.18
    ),
    4326
  )::geography,
  substr(md5(u.id::text), 1, 6),
  now()
FROM users u
WHERE u.email LIKE 'loadtest-bg-%@loadtest.local';

-- 4) Activities — each background user gets 1-3 of the 12 fixed
--    activities, random availability (including some NOT_AVAILABLE,
--    which the query must exclude).
INSERT INTO user_activities (id, "userId", "activityId", availability, "updatedAt")
SELECT
  gen_random_uuid(),
  u.id,
  a.id,
  (ARRAY['NOW','TODAY','WEEKEND','NOT_AVAILABLE'])[1 + floor(random() * 4)]::"Availability",
  now()
FROM users u
CROSS JOIN LATERAL (
  SELECT id FROM activities ORDER BY random() LIMIT (1 + floor(random() * 3))::int
) a
WHERE u.email LIKE 'loadtest-bg-%@loadtest.local';

-- 5) A minority verified (Google), so the badge/EXISTS-subquery branch
--    of the query has real matches to find too.
INSERT INTO verifications (id, "userId", provider, status, "verifiedAt", "createdAt")
SELECT
  gen_random_uuid(),
  u.id,
  'GOOGLE'::"VerificationProvider",
  'VERIFIED'::"VerificationStatus",
  now(),
  now()
FROM users u
WHERE u.email LIKE 'loadtest-bg-%@loadtest.local'
  AND random() < 0.33;

COMMIT;

\echo '--- seed complete ---'
SELECT count(*) AS background_users FROM users WHERE email LIKE 'loadtest-bg-%@loadtest.local';
SELECT status, count(*) FROM users WHERE email LIKE 'loadtest-bg-%@loadtest.local' GROUP BY status ORDER BY status;
SELECT count(*) AS with_location FROM user_locations ul JOIN users u ON u.id = ul."userId" WHERE u.email LIKE 'loadtest-bg-%@loadtest.local';
SELECT count(*) AS activity_rows FROM user_activities ua JOIN users u ON u.id = ua."userId" WHERE u.email LIKE 'loadtest-bg-%@loadtest.local';

\echo '--- how many background users a Mumbai-centered searcher would actually see per radius (trekking, NOW/TODAY/WEEKEND) ---'
SELECT
  r AS radius_meters,
  count(*) AS matches
FROM (VALUES (1000),(3000),(5000),(10000),(25000),(50000)) AS radii(r)
CROSS JOIN LATERAL (
  SELECT 1
  FROM user_activities ua
  JOIN users u ON u.id = ua."userId"
  JOIN profiles p ON p."userId" = u.id
  JOIN user_locations ul ON ul."userId" = u.id
  JOIN activities act ON act.id = ua."activityId"
  WHERE act.key = 'trekking'
    AND ua.availability != 'NOT_AVAILABLE'
    AND p.discoverable = true AND p.hidden = false
    AND u.status = 'ACTIVE'
    AND ST_DWithin(ul.geo, ST_SetSRID(ST_MakePoint(72.8777, 19.0760), 4326)::geography, radii.r)
) matched
GROUP BY r
ORDER BY r;
