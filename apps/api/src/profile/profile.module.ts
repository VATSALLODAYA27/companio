import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [ActivitiesModule, IdentityVerificationModule],
  controllers: [ProfileController],
  providers: [ProfileService],
  // AuthService (Phase 2) uses createInitialProfile() to turn the
  // firstName collected at registration into a real Profile row — see
  // auth.module.ts / auth.service.ts.
  exports: [ProfileService],
})
export class ProfileModule {}
