-- Exercises the nearby-match query from DATABASE.md against real seeded
-- data, to verify: activity filter, availability filter, discoverable/
-- hidden filter, block exclusion, and the 1km PostGIS radius filter all
-- work together as one indexed query (not app-level filtering).

BEGIN;

INSERT INTO users (id, email, status, "updatedAt") VALUES
  ('00000000-0000-0000-0000-000000000001', 'viewer@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-00000000000a', 'usera@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-00000000000b', 'userb@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-00000000000c', 'userc@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-00000000000d', 'userd@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-00000000000e', 'usere@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-00000000000f', 'userf@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-000000000010', 'userg@test.local', 'ACTIVE', now());

INSERT INTO profiles (id, "userId", "firstName", discoverable, hidden, "updatedAt") VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Asha (300m, trekking, NOW)', true, false, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'Bilal (800m, trekking, TODAY)', true, false, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000c', 'Chetan (1500m, trekking, NOW -> too far)', true, false, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000d', 'Divya (300m, trekking, NOT_AVAILABLE)', true, false, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000e', 'Esha (300m, bowling -> wrong activity)', true, false, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000f', 'Farhan (300m, trekking, NOW -> hidden)', true, true, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000010', 'Gauri (300m, trekking, NOW -> blocked)', true, false, now());

INSERT INTO user_locations (id, "userId", geo, "updatedAt") VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', ST_MakePoint(72.9425, 19.1728)::geography, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', ST_MakePoint(72.942500, 19.175495)::geography, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', ST_MakePoint(72.950109, 19.172800)::geography, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000c', ST_MakePoint(72.942500, 19.186275)::geography, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000d', ST_MakePoint(72.942500, 19.170105)::geography, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000e', ST_MakePoint(72.939647, 19.172800)::geography, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000f', ST_MakePoint(72.944402, 19.174597)::geography, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000010', ST_MakePoint(72.940598, 19.171003)::geography, now());

INSERT INTO user_activities (id, "userId", "activityId", availability, "updatedAt")
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000000a'::uuid, id, 'NOW'::"Availability", now() FROM activities WHERE key = 'trekking'
UNION ALL
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000000b'::uuid, id, 'TODAY'::"Availability", now() FROM activities WHERE key = 'trekking'
UNION ALL
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000000c'::uuid, id, 'NOW'::"Availability", now() FROM activities WHERE key = 'trekking'
UNION ALL
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000000d'::uuid, id, 'NOT_AVAILABLE'::"Availability", now() FROM activities WHERE key = 'trekking'
UNION ALL
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000000e'::uuid, id, 'NOW'::"Availability", now() FROM activities WHERE key = 'bowling'
UNION ALL
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000000f'::uuid, id, 'NOW'::"Availability", now() FROM activities WHERE key = 'trekking'
UNION ALL
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000010'::uuid, id, 'NOW'::"Availability", now() FROM activities WHERE key = 'trekking';

-- viewer blocks Gauri
INSERT INTO blocks (id, "blockerId", "blockedId", "createdAt") VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', now());

\echo '--- Nearby-match query result (expect ONLY Asha and Bilal) ---'
SELECT p."firstName", ua.availability,
       round(ST_Distance(ul.geo, ST_MakePoint(72.9425, 19.1728)::geography)::numeric, 1) AS distance_m
FROM user_activities ua
JOIN users u ON u.id = ua."userId"
JOIN profiles p ON p."userId" = u.id
JOIN user_locations ul ON ul."userId" = u.id
JOIN activities a ON a.id = ua."activityId"
WHERE a.key = 'trekking'
  AND ua.availability != 'NOT_AVAILABLE'
  AND p.discoverable = true AND p.hidden = false
  AND u.status = 'ACTIVE' AND u.id != '00000000-0000-0000-0000-000000000001'
  AND u.id NOT IN (
    SELECT "blockedId" FROM blocks WHERE "blockerId" = '00000000-0000-0000-0000-000000000001'
    UNION SELECT "blockerId" FROM blocks WHERE "blockedId" = '00000000-0000-0000-0000-000000000001'
  )
  AND ST_DWithin(ul.geo, ST_MakePoint(72.9425, 19.1728)::geography, 1000)
ORDER BY (ua.availability = 'NOW') DESC, distance_m ASC;

\echo '--- Query plan (confirm GIST index is used, not a sequential scan) ---'
EXPLAIN SELECT 1
FROM user_locations ul
WHERE ST_DWithin(ul.geo, ST_MakePoint(72.9425, 19.1728)::geography, 1000);

ROLLBACK;
