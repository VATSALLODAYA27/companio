import { Injectable } from '@nestjs/common';
import {
  IdentityVerificationProvider,
  VerificationResult,
} from './provider.interface';

export interface GoogleVerificationInput {
  emailVerified: boolean;
}

/**
 * Proves control of a Google account with a verified email — nothing
 * more. Never surfaced to users as "Identity Verified"; the profile
 * badge for this provider must read "Google Verified" specifically.
 */
@Injectable()
export class GoogleVerificationProvider
  implements IdentityVerificationProvider<GoogleVerificationInput>
{
  readonly name = 'GOOGLE' as const;

  async verify(input: GoogleVerificationInput): Promise<VerificationResult> {
    if (input.emailVerified) {
      return { status: 'VERIFIED', verifiedAt: new Date() };
    }
    return { status: 'FAILED' };
  }
}
