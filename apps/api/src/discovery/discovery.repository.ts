import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const DISCOVERY_PAGE_SIZE = 20;

export interface NearbyRow {
  userId: string;
  firstName: string;
  photoUrl: string | null;
  ageRange: string | null;
  availability: 'NOW' | 'TODAY' | 'WEEKEND';
  verified: boolean;
  distanceLabel: string;
}

/**
 * The only query in the app that touches `user_locations.geo`. One
 * indexed pass — activity match, availability, discoverable/hidden,
 * block exclusion, and the PostGIS radius filter all happen inside this
 * single statement (see DATABASE.md "The nearby-match query"), never as
 * separate fetch-then-filter steps in application code.
 *
 * The caller's own position is read from their own `user_locations` row
 * via the `me` CTE, not passed in from the request — nothing calling
 * this repository ever needs to hold another user's or even the
 * caller's raw coordinates in memory. Distance is bucketed by a CASE
 * expression *inside* the query and is the only distance-related value
 * in the SELECT list — the raw `distance_m` figure is used only in
 * ORDER BY, where SQL can reference it from the CTE without it ever
 * being projected into a returned row.
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
}
