-- Phase 7 verification: the REAL DiscoveryRepository.findNearbyForMap
-- query (not a redescription of it) against a live PostGIS database.
-- Primary goal: prove ST_Y/ST_X extract latitude/longitude in the
-- correct order (a very easy axis to swap by accident — PostGIS points
-- are (lng, lat) internally, the opposite of how humans usually say
-- "lat, lng") against a fixture where latitude and longitude are far
-- enough apart to catch a swap immediately, not just "close enough to
-- look plausible". Secondary goal: confirm the exact same
-- filter/exclusion set as findNearby (Phase 4) still applies — activity
-- match, availability, discoverable/hidden, block, status, radius.
-- Transactional, rolled back at the end.

BEGIN;

INSERT INTO users (id, email, status, "updatedAt") VALUES
  ('00000000-0000-0000-0000-000000000001', 'viewer@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-00000000000a', 'usera@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-00000000000c', 'userc@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-00000000000f', 'userf@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-000000000010', 'userg@test.local', 'ACTIVE', now());

INSERT INTO profiles (id, "userId", "firstName", discoverable, hidden, "updatedAt") VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'Asha (300m, trekking, NOW)', true, false, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000c', 'Chetan (1500m, trekking, NOW -> too far)', true, false, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000f', 'Farhan (300m, trekking, NOW -> hidden)', true, true, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000010', 'Gauri (300m, trekking, NOW -> blocked)', true, false, now());

-- Deliberately asymmetric lat/lng (19.x vs 72.x) so a swapped ST_X/ST_Y
-- would produce an obviously-wrong result (e.g. latitude > 90 territory
-- for the offset math, or simply not matching the inserted longitude at
-- all) rather than a subtly-off-by-a-little-bit value.
INSERT INTO user_locations (id, "userId", geo, "updatedAt") VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', ST_MakePoint(72.9425, 19.1728)::geography, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', ST_MakePoint(72.942500, 19.175495)::geography, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000c', ST_MakePoint(72.942500, 19.186275)::geography, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000000f', ST_MakePoint(72.944402, 19.174597)::geography, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000010', ST_MakePoint(72.940598, 19.171003)::geography, now());

INSERT INTO user_activities (id, "userId", "activityId", availability, "updatedAt")
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000000a'::uuid, id, 'NOW'::"Availability", now() FROM activities WHERE key = 'trekking'
UNION ALL
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000000c'::uuid, id, 'NOW'::"Availability", now() FROM activities WHERE key = 'trekking'
UNION ALL
SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000000f'::uuid, id, 'NOW'::"Availability", now() FROM activities WHERE key = 'trekking'
UNION ALL
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000010'::uuid, id, 'NOW'::"Availability", now() FROM activities WHERE key = 'trekking';

INSERT INTO blocks (id, "blockerId", "blockedId", "createdAt") VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', now());

\echo '--- 1) findNearbyForMap query, run as the viewer (expect ONLY Asha — Chetan too far, Farhan hidden, Gauri blocked) ---'
WITH me AS (
  SELECT geo FROM "user_locations" WHERE "userId" = '00000000-0000-0000-0000-000000000001'::uuid
),
candidates AS (
  SELECT
    u.id AS "userId",
    p."firstName",
    ua.availability::text AS availability,
    ST_Distance(ul.geo, (SELECT geo FROM me)) AS distance_m,
    ST_Y(ul.geo::geometry) AS "rawLatitude",
    ST_X(ul.geo::geometry) AS "rawLongitude"
  FROM "user_activities" ua
  JOIN "users" u ON u.id = ua."userId"
  JOIN "profiles" p ON p."userId" = u.id
  JOIN "user_locations" ul ON ul."userId" = u.id
  JOIN activities act ON act.id = ua."activityId"
  WHERE act.key = 'trekking'
    AND ua.availability != 'NOT_AVAILABLE'
    AND p.discoverable = true AND p.hidden = false
    AND u.status = 'ACTIVE'
    AND u.id != '00000000-0000-0000-0000-000000000001'::uuid
    AND EXISTS (SELECT 1 FROM me)
    AND u.id NOT IN (
      SELECT "blockedId" FROM "blocks" WHERE "blockerId" = '00000000-0000-0000-0000-000000000001'::uuid
      UNION
      SELECT "blockerId" FROM "blocks" WHERE "blockedId" = '00000000-0000-0000-0000-000000000001'::uuid
    )
    AND ST_DWithin(ul.geo, (SELECT geo FROM me), 1000)
)
SELECT "firstName", "rawLatitude", "rawLongitude",
  CASE
    WHEN distance_m < 250 THEN '< 250 m'
    WHEN distance_m < 500 THEN '250-500 m'
    WHEN distance_m < 1000 THEN '500 m-1 km'
    ELSE '1+ km'
  END AS "distanceLabel"
FROM candidates
ORDER BY distance_m ASC;
-- expect: exactly one row, "Asha (300m, trekking, NOW)".

\echo '--- 2) axis-order sanity check: rawLatitude/rawLongitude for Asha must equal what was inserted, not swapped ---'
SELECT
  ST_Y(geo::geometry) AS "rawLatitude",
  ST_X(geo::geometry) AS "rawLongitude",
  (round(ST_Y(geo::geometry)::numeric, 6) = 19.175495) AS latitude_correct,
  (round(ST_X(geo::geometry)::numeric, 6) = 72.942500) AS longitude_correct
FROM user_locations
WHERE "userId" = '00000000-0000-0000-0000-00000000000a'::uuid;
-- expect: latitude_correct = t, longitude_correct = t. If these were
-- swapped, rawLatitude would come back as ~72.9 (an impossible latitude
-- greater than 90 would be an even more obvious tell at other
-- coordinates, but this fixture's values are both valid degrees in
-- isolation, which is exactly why the explicit equality check matters
-- more than "is it in range").

\echo '--- 3) query plan: confirm the GIST index is still used for findNearbyForMap''s radius filter, not a sequential scan ---'
EXPLAIN
WITH me AS (
  SELECT geo FROM "user_locations" WHERE "userId" = '00000000-0000-0000-0000-000000000001'::uuid
)
SELECT ST_Y(ul.geo::geometry), ST_X(ul.geo::geometry)
FROM "user_locations" ul
WHERE ST_DWithin(ul.geo, (SELECT geo FROM me), 1000);

ROLLBACK;
