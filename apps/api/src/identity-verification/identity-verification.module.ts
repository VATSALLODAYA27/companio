import { Module } from '@nestjs/common';
import { GoogleVerificationProvider } from './google.provider';
import { GovernmentKycProvider } from './government-kyc.provider';
import { VerificationsService } from './verifications.service';

/**
 * Owns the IdentityVerificationProvider abstraction and the
 * Verification table access. Extracted into its own module (rather than
 * living inside AuthModule, where it started in Phase 2) so any module
 * that needs the verification badge — ProfileModule now, Discovery in
 * Phase 4 — can import it directly without creating a dependency on
 * AuthModule.
 */
@Module({
  providers: [GoogleVerificationProvider, GovernmentKycProvider, VerificationsService],
  exports: [VerificationsService, GoogleVerificationProvider, GovernmentKycProvider],
})
export class IdentityVerificationModule {}
