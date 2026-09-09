import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';

function contextFor(method: string, headers: Record<string, string>, cookies: Record<string, string>): ExecutionContext {
  const request = {
    method,
    header: (name: string) => headers[name.toLowerCase()],
    signedCookies: cookies,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();

  it('allows safe methods through without a token', () => {
    expect(guard.canActivate(contextFor('GET', {}, {}))).toBe(true);
  });

  it('rejects a mutating request with no token at all', () => {
    expect(() => guard.canActivate(contextFor('POST', {}, {}))).toThrow(ForbiddenException);
  });

  it('rejects when the header token does not match the cookie token', () => {
    const ctx = contextFor(
      'POST',
      { 'x-csrf-token': 'attacker-guessed-value' },
      { companio_csrf: 'real-token' },
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('accepts a mutating request when the header matches the cookie', () => {
    const ctx = contextFor(
      'POST',
      { 'x-csrf-token': 'matching-token' },
      { companio_csrf: 'matching-token' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
