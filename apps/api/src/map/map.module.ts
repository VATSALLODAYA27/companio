import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module';
import { LocationModule } from '../location/location.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { MapController } from './map.controller';
import { MapService } from './map.service';

@Module({
  // DiscoveryModule is imported (not duplicated) so this module reuses
  // DiscoveryRepository.findNearbyForMap — the exact same
  // activity/availability/block/radius filtering Discovery already has
  // verified, rather than a second, independently-drifting copy of that
  // SQL. See DiscoveryModule's `exports` and the repository's docblock.
  imports: [ActivitiesModule, LocationModule, DiscoveryModule],
  controllers: [MapController],
  providers: [MapService],
})
export class MapModule {}
