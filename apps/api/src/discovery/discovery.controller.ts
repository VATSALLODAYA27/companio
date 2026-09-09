import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DiscoveryService } from './discovery.service';
import { NearbyQueryDto } from './dto/nearby-query.dto';

const discoveryThrottle = () => ({
  default: {
    limit: Number(process.env.RATE_LIMIT_MAX_DISCOVERY ?? 20),
    ttl: Number(process.env.RATE_LIMIT_TTL_SECONDS ?? 60) * 1000,
  },
});

@Controller('discovery')
@UseGuards(SessionAuthGuard)
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Throttle(discoveryThrottle())
  @Get('nearby')
  async nearby(@CurrentUser() userId: string, @Query() query: NearbyQueryDto) {
    const results = await this.discoveryService.findNearby(
      userId,
      query.activityKey,
      query.radiusMeters,
      query.offset,
    );
    return { results };
  }
}
