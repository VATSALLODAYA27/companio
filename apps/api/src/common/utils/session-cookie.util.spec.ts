import { sign } from 'cookie-signature';
import { extractSignedCookie } from './session-cookie.util';

const SECRET = 'test-secret-not-for-production';

function cookieHeader(name: string, rawValue: string): string {
  return `${name}=s:${sign(rawValue, SECRET)}`;
}

describe('extractSignedCookie', () => {
  it('extracts and verifies a properly signed cookie', () => {
    const header = cookieHeader('companio_sid', 'session-123');
    expect(extractSignedCookie(header, 'companio_sid', SECRET)).toBe('session-123');
  });

  it('reads the right cookie out of a header carrying several', () => {
    const header = [
      'other=irrelevant',
      cookieHeader('companio_sid', 'session-123'),
      cookieHeader('companio_csrf', 'csrf-abc'),
    ].join('; ');
    expect(extractSignedCookie(header, 'companio_sid', SECRET)).toBe('session-123');
    expect(extractSignedCookie(header, 'companio_csrf', SECRET)).toBe('csrf-abc');
  });

  it('returns null when the header is missing entirely', () => {
    expect(extractSignedCookie(undefined, 'companio_sid', SECRET)).toBeNull();
  });

  it('returns null when the named cookie is not present', () => {
    const header = cookieHeader('companio_csrf', 'csrf-abc');
    expect(extractSignedCookie(header, 'companio_sid', SECRET)).toBeNull();
  });

  it('returns null for an unsigned (plain) cookie value', () => {
    const header = 'companio_sid=session-123';
    expect(extractSignedCookie(header, 'companio_sid', SECRET)).toBeNull();
  });

  it('returns null when the signature was made with a different secret', () => {
    const header = `companio_sid=s:${sign('session-123', 'a-different-secret')}`;
    expect(extractSignedCookie(header, 'companio_sid', SECRET)).toBeNull();
  });

  it('returns null when the signed value has been tampered with', () => {
    const good = cookieHeader('companio_sid', 'session-123');
    const tampered = good.replace('session-123', 'session-999');
    expect(extractSignedCookie(tampered, 'companio_sid', SECRET)).toBeNull();
  });
});
