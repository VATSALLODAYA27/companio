import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const DISCOVERY_PAGE_SIZE = 20;
export const MAP_PAGE_SIZE = 20;

export interface NearbyRow {
  userId: string;
  firstName: string;
  photoUrl: string | null;
  ageRange: string | null;
  availability: 'NOW' | 'TODAY' | 'WEEKEND';
  verified: boolean;
  distanceLabel: string;
}

// Deliberately named "raw" — these are the caller's real, unfuzzed
// coordinates for another user. This type must never cross a service
// boundary un-fuzzed; MapService.findNearbyPins fuzzes every row before
// it leaves that method (see location-fuzz.util.ts and SECURITY.md §5).
export interface NearbyPositionRow extends NearbyRow {
  rawLatitude: number;
  rawLongitude: number;
}

/**
 * The only repository in the app that touches `user_locations.geo`. One
 * indexed pass — activity match, availability, discoverable/hidden,
 * block exclusion, and the PostGIS radius filter all happen inside a
 * single statement (see DATABASE.md "The nearby-match query"), never as
 * separate fetch-then-filter steps in application code.
 *
 * The caller's own position is read from their own `user_locations` row
 * via the `me` CTE, not passed in from the request — nothing calling
 * this repository ever needs to pass in another user's or even the
 * caller's raw coordinates.
 *
 * `findNearby` (Phase 4) buckets distance by a CASE expression *inside*
 * the query and never selects the raw `distance_m` figure — it's used
 * only in ORDER BY, where SQL can reference it from the CTE without it
 * ever being projected into a returned row. `findNearbyForMap` (Phase 7)
 * is the one deliberate exception to "raw coordinates never leave this
 * layer": it selects another user's real lat/lng because the map needs
 * *some* real position to fuzz. Those fields are named `rawLatitude`/
 * `rawLongitude` specifically so nothing downstream can forward them
 * without visibly touching a field called "raw" — `MapService` fuzzes
 * every row before returning (see location-fuzz.util.ts).
 */
@Injectable()
export class DiscoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findNearby(params: {
    currentUserId: string;
    activityId: string;
    radiusMeters: number;
    offset: number;
  }): Promise<NearbyRow[]> {
    const { currentUserId, activityId, radiusMeters, offset } = params;

    return this.prisma.$queryRaw<NearbyRow[]>(Prisma.sql`
      WITH me AS (
        SELECT geo FROM "user_locations" WHERE "userId" = ${currentUserId}::uuid
      ),
      candidates AS (
        SELECT
          u.id AS "userId",
          p."firstName",
          p."photoUrl",
          p."ageRange",
          ua.availability::text AS availability,
          EXISTS (
            SELECT 1 FROM "verifications" v
            WHERE v."userId" = u.id AND v.status = 'VERIFIED'
          ) AS verified,
          ST_Distance(ul.geo, (SELECT geo FROM me)) AS distance_m
        FROM "user_activities" ua
        JOIN "users" u ON u.id = ua."userId"
        JOIN "profiles" p ON p."userId" = u.id
        JOIN "user_locations" ul ON ul."userId" = u.id
        WHERE ua."activityId" = ${activityId}::uuid
          AND ua.availability != 'NOT_AVAILABLE'
          AND p.discoverable = true AND p.hidden = false
          AND u.status = 'ACTIVE'
          AND u.id != ${currentUserId}::uuid
          AND EXISTS (SELECT 1 FROM me)
          AND u.id NOT IN (
            SELECT "blockedId" FROM "blocks" WHERE "blockerId" = ${currentUserId}::uuid
            UNION
            SELECT "blockerId" FROM "blocks" WHERE "blockedId" = ${currentUserId}::uuid
          )
          AND ST_DWithin(ul.geo, (SELECT geo FROM me), ${radiusMeters})
      )
      SELECT
        "userId", "firstName", "photoUrl", "ageRange", availability, verified,
        CASE
          WHEN distance_m < 250 THEN '< 250 m'
          WHEN distance_m < 500 THEN '250-500 m'
          WHEN distance_m < 1000 THEN '500 m-1 km'
          WHEN distance_m < 3000 THEN '1-3 km'
          WHEN distance_m < 5000 THEN '3-5 km'
          WHEN distance_m < 10000 THEN '5-10 km'
          WHEN distance_m < 25000 THEN '10-25 km'
          ELSE '25-50 km'
        END AS "distanceLabel"
      FROM candidates
      ORDER BY (availability = 'NOW') DESC, distance_m ASC
      LIMIT ${DISCOVERY_PAGE_SIZE} OFFSET ${offset}
    `);
  }

  /**
   * Same filtering contract as `findNearby` — same exclusions, same
   * ordering, same fixed page size pattern — kept as a deliberately
   * separate statement rather than a shared/parametrized query builder,
   * so Phase 4's already-verified `findNearby` (scripts/phase4-discovery-check.sql)
   * is never at risk of behavior drift from a Phase 7 change. The only
   * addition is `ST_X`/`ST_Y` on the same `ul.geo` column already joined
   * in for the radius filter — extracted as plain geometry coordinates
   * (`::geometry` cast; `ST_X`/`ST_Y` don't accept `geography`) instead
   * of a bucketed label. These are real, unfuzzed coordinates — see the
   * `NearbyPositionRow` docblock above for why that's fine as long as
   * they never leave `MapService` un-fuzzed.
   */
  async findNearbyForMap(params: {
    currentUserId: string;
    activityId: string;
    radiusMeters: number;
    offset: number;
  }): Promise<NearbyPositionRow[]> {
    const { currentUserId, activityId, radiusMeters, offset } = params;

    return this.prisma.$queryRaw<NearbyPositionRow[]>(Prisma.sql`
      WITH me AS (
        SELECT geo FROM "user_locations" WHERE "userId" = ${currentUserId}::uuid
      ),
      candidates AS (
        SELECT
          u.id AS "userId",
          p."firstName",
          p."photoUrl",
          p."ageRange",
          ua.availability::text AS availability,
          EXISTS (
            SELECT 1 FROM "verifications" v
            WHERE v."userId" = u.id AND v.status = 'VERIFIED'
          ) AS verified,
          ST_Distance(ul.geo, (SELECT geo FROM me)) AS distance_m,
          ST_Y(ul.geo::geometry) AS "rawLatitude",
          ST_X(ul.geo::geometry) AS "rawLongitude"
        FROM "user_activities" ua
        JOIN "users" u ON u.id = ua."userId"
        JOIN "profiles" p ON p."userId" = u.id
        JOIN "user_locations" ul ON ul."userId" = u.id
        WHERE ua."activityId" = ${activityId}::uuid
          AND ua.availability != 'NOT_AVAILABLE'
          AND p.discoverable = true AND p.hidden = false
          AND u.status = 'ACTIVE'
          AND u.id != ${currentUserId}::uuid
          AND EXISTS (SELECT 1 FROM me)
          AND u.id NOT IN (
            SELECT "blockedId" FROM "blocks" WHERE "blockerId" = ${currentUserId}::uuid
            UNION
            SELECT "blockerId" FROM "blocks" WHERE "blockedId" = ${currentUserId}::uuid
          )
          AND ST_DWithin(ul.geo, (SELECT geo FROM me), ${radiusMeters})
      )
      SELECT
        "userId", "firstName", "photoUrl", "ageRange", availability, verified,
        "rawLatitude", "rawLongitude",
        CASE
          WHEN distance_m < 250 THEN '< 250 m'
          WHEN distance_m < 500 THEN '250-500 m'
          WHEN distance_m < 1000 THEN '500 m-1 km'
          WHEN distance_m < 3000 THEN '1-3 km'
          WHEN distance_m < 5000 THEN '3-5 km'
          WHEN distance_m < 10000 THEN '5-10 km'
          WHEN distance_m < 25000 THEN '10-25 km'
          ELSE '25-50 km'
        END AS "distanceLabel"
      FROM candidates
      ORDER BY (availability = 'NOW') DESC, distance_m ASC
      LIMIT ${MAP_PAGE_SIZE} OFFSET ${offset}
    `);
  }
}
