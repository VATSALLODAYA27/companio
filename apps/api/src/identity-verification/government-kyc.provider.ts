import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  IdentityVerificationProvider,
  VerificationResult,
} from './provider.interface';

/**
 * Placeholder only — deliberately unimplemented in this prototype.
 *
 * Do NOT implement Aadhaar/government-ID verification here directly.
 * When a real, authorized third-party KYC provider is integrated, this
 * class calls that provider's API and returns ONLY the minimum result
 * (status + timestamp) from `verify()`. It must never accept or persist
 * an Aadhaar number, a document image, or any other raw KYC payload —
 * even if the provider's response includes one, it gets discarded before
 * it reaches this return value.
 */
@Injectable()
export class GovernmentKycProvider implements IdentityVerificationProvider {
  readonly name = 'GOVERNMENT_KYC' as const;

  async verify(): Promise<VerificationResult> {
    throw new NotImplementedException(
      'Government ID verification is not available in this prototype.',
    );
  }
}
