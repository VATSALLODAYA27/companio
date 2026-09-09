import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    PassportModule.register({ session: false }),
    UsersModule,
    IdentityVerificationModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionsService, GoogleStrategy],
  exports: [SessionsService],
})
export class AuthModule {}
