import { GoogleVerificationProvider } from './google.provider';

describe('GoogleVerificationProvider', () => {
  const provider = new GoogleVerificationProvider();

  it('is named GOOGLE, not e.g. "identity" or "kyc" — the badge text depends on this staying specific', () => {
    expect(provider.name).toBe('GOOGLE');
  });

  it('returns VERIFIED with a verifiedAt timestamp when the Google email is verified', async () => {
    const result = await provider.verify({ emailVerified: true });
    expect(result.status).toBe('VERIFIED');
    expect(result.verifiedAt).toBeInstanceOf(Date);
  });

  it('returns FAILED with no verifiedAt when the Google email is not verified', async () => {
    const result = await provider.verify({ emailVerified: false });
    expect(result.status).toBe('FAILED');
    expect(result.verifiedAt).toBeUndefined();
  });
});
