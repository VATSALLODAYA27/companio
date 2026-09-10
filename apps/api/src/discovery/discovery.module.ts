import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module';
import { LocationModule } from '../location/location.module';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { DiscoveryRepository } from './discovery.repository';

@Module({
  imports: [ActivitiesModule, LocationModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, DiscoveryRepository],
  // Exported so MapModule (Phase 7) can reuse the same raw-SQL
  // nearby-match filtering (findNearbyForMap) rather than duplicating
  // the activity/availability/block/radius query a second time.
  exports: [DiscoveryRepository],
})
export class DiscoveryModule {}
