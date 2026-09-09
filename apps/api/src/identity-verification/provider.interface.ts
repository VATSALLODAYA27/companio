/**
 * Verification provider abstraction (see ARCHITECTURE.md / SECURITY.md).
 *
 * A provider returns ONLY the minimum result — status and a timestamp.
 * It must never return, and callers must never persist, raw identity
 * documents, government ID numbers, or any other sensitive payload a
 * real KYC provider might hand back. The Verification table has no
 * column for such data on purpose — there is nowhere to put it even by
 * accident.
 */

export type VerificationProviderName = 'GOOGLE' | 'GOVERNMENT_KYC';
export type VerificationResultStatus = 'PENDING' | 'VERIFIED' | 'FAILED' | 'EXPIRED';

export interface VerificationResult {
  status: VerificationResultStatus;
  verifiedAt?: Date;
}

export interface IdentityVerificationProvider<TInput = unknown> {
  readonly name: VerificationProviderName;
  verify(input: TInput): Promise<VerificationResult>;
}
