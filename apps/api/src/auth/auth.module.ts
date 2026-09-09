import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleVerificationProvider } from '../identity-verification/google.provider';
import { GovernmentKycProvider } from '../identity-verification/government-kyc.provider';
import { VerificationsService } from '../identity-verification/verifications.service';

@Module({
  imports: [PassportModule.register({ session: false }), UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    GoogleStrategy,
    GoogleVerificationProvider,
    GovernmentKycProvider,
    VerificationsService,
  ],
  exports: [SessionsService],
})
export class AuthModule {}
