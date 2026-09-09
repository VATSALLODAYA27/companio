import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [ActivitiesModule, IdentityVerificationModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
