import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MapService } from './map.service';
import { MapNearbyQueryDto } from './dto/map-nearby-query.dto';

// Its own env var (RATE_LIMIT_MAX_MAP), not a reuse of
// RATE_LIMIT_MAX_DISCOVERY's counter, so ops can tune the two
// independently later — but intentionally the same *default* value and
// the same rationale as discovery/nearby (SECURITY.md §5): repeated
// querying is the realistic attack for profiling a target's movement,
// and this endpoint hands back a position, so it deserves at least as
// tight a limit as the list view over the same data.
const mapThrottle = () => ({
  default: {
    limit: Number(process.env.RATE_LIMIT_MAX_MAP ?? 20),
    ttl: Number(process.env.RATE_LIMIT_TTL_SECONDS ?? 60) * 1000,
  },
});

@Controller('map')
@UseGuards(SessionAuthGuard)
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Throttle(mapThrottle())
  @Get('nearby')
  async nearby(@CurrentUser() userId: string, @Query() query: MapNearbyQueryDto) {
    const pins = await this.mapService.findNearbyPins(
      userId,
      query.activityKey,
      query.radiusMeters,
      query.offset,
    );
    return { pins };
  }
}
