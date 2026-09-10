import { NotImplementedException } from '@nestjs/common';
import { GovernmentKycProvider } from './government-kyc.provider';

/**
 * This provider is deliberately unimplemented (see the class's own
 * docblock — government ID verification is explicitly out of scope for
 * this prototype, SECURITY.md §1). The one thing worth a test here isn't
 * behavior, it's a guard rail: if someone "helpfully" fills this in later
 * without reading the docblock, this test forces them to also update (or
 * consciously delete) the assertion that it's unimplemented, rather than
 * silently shipping a live government-ID integration.
 */
describe('GovernmentKycProvider', () => {
  const provider = new GovernmentKycProvider();

  it('is named GOVERNMENT_KYC', () => {
    expect(provider.name).toBe('GOVERNMENT_KYC');
  });

  it('refuses to verify anything — this prototype does not implement government ID checks', async () => {
    await expect(provider.verify()).rejects.toBeInstanceOf(NotImplementedException);
  });
});
