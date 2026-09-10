import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivitiesService } from '../activities/activities.service';
import { LocationService } from '../location/location.service';
import { DiscoveryRepository } from '../discovery/discovery.repository';
import { fuzzPosition } from './location-fuzz.util';

/**
 * Same authorization/precondition shape as DiscoveryService (Phase 4) —
 * deliberately, since a map view and a list view are the same search —
 * plus one extra step neither Discovery nor Location has ever done
 * before: fuzzing another user's real coordinate before it's allowed to
 * leave this method. See location-fuzz.util.ts and SECURITY.md §5.
 */
@Injectable()
export class MapService {
  constructor(
    private readonly repository: DiscoveryRepository,
    private readonly activities: ActivitiesService,
    private readonly location: LocationService,
    private readonly config: ConfigService,
  ) {}

  async findNearbyPins(
    userId: string,
    activityKey: string,
    radiusMeters: number | undefined,
    offset: number | undefined,
  ) {
    const hasLocation = await this.location.hasLocation(userId);
    if (!hasLocation) {
      throw new BadRequestException(
        'Set your location (PUT /location/me) before viewing the map',
      );
    }

    const idsByKey = await this.activities.findIdsByKeys([activityKey]);
    const activityId = idsByKey.get(activityKey);
    if (!activityId) {
      // Defensive only — @IsIn on the DTO already restricts activityKey
      // to the fixed set, so this would mean the DB wasn't seeded.
      throw new BadRequestException(`Unknown activity key: ${activityKey}`);
    }

    const defaultRadius = Number(this.config.get('DEFAULT_SEARCH_RADIUS_METERS') ?? 1000);

    const rows = await this.repository.findNearbyForMap({
      currentUserId: userId,
      activityId,
      radiusMeters: radiusMeters ?? defaultRadius,
      offset: offset ?? 0,
    });

    return rows.map((row) => {
      const { latitude, longitude } = fuzzPosition({
        viewerId: userId,
        targetId: row.userId,
        realLatitude: row.rawLatitude,
        realLongitude: row.rawLongitude,
      });

      return {
        userId: row.userId,
        firstName: row.firstName,
        photoUrl: row.photoUrl,
        ageRange: row.ageRange,
        activityKey,
        availability: row.availability,
        verificationBadge: row.verified ? ('GOOGLE_VERIFIED' as const) : ('NONE' as const),
        distanceLabel: row.distanceLabel,
        latitude,
        longitude,
      };
    });
  }
}
