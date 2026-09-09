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
})
export class DiscoveryModule {}
