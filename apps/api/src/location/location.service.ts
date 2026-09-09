import { Injectable } from '@nestjs/common';
import * as geohash from 'ngeohash';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The only place `user_locations.geo` is ever written or read. It's a
 * PostGIS `geography(Point,4326)` column — Prisma has no native type
 * for it (see prisma/schema.prisma), so every operation here goes
 * through raw SQL, never the generated client's normal query builder.
 *
 * There is deliberately no "get my raw coordinates back" method and no
 * history table — see DATABASE.md "No location history table". The
 * only outputs this module (or discovery, which reads the same table)
 * ever produces are a boolean ("do I have a location set") and, for
 * other users, a bucketed distance label — never latitude/longitude.
 */
@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}

  async updateMyLocation(userId: string, latitude: number, longitude: number) {
    // geohash6 (~1.2km x 0.6km cell) is a coarse, privacy-safe stand-in
    // for the exact point — safe to log or cache later; never precise
    // enough to reconstruct someone's exact position. It isn't read by
    // any query yet (discovery uses the real geography column directly
    // under the GIST index), but is stored now per the schema's design.
    const geohash6 = geohash.encode(latitude, longitude, 6);

    await this.prisma.$executeRaw`
      INSERT INTO "user_locations" ("id", "userId", "geo", "geohash6", "updatedAt")
      VALUES (
        gen_random_uuid(),
        ${userId}::uuid,
        ST_SetSRID(ST_MakePoint(${longitude}::double precision, ${latitude}::double precision), 4326)::geography,
        ${geohash6},
        now()
      )
      ON CONFLICT ("userId") DO UPDATE SET
        "geo" = EXCLUDED."geo",
        "geohash6" = EXCLUDED."geohash6",
        "updatedAt" = now()
    `;

    return { updated: true };
  }

  async clearMyLocation(userId: string) {
    await this.prisma.userLocation.deleteMany({ where: { userId } });
    return { cleared: true };
  }

  async hasLocation(userId: string): Promise<boolean> {
    const row = await this.prisma.userLocation.findUnique({
      where: { userId },
      select: { id: true },
    });
    return !!row;
  }
}
