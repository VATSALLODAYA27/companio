import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { ProfileModule } from '../profile/profile.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    PassportModule.register({ session: false }),
    UsersModule,
    IdentityVerificationModule,
    // For createInitialProfile() — see auth.service.ts register(). No
    // circular dependency: ProfileModule does not import AuthModule.
    ProfileModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionsService, GoogleStrategy],
  exports: [SessionsService],
})
export class AuthModule {}
