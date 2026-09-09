import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SessionAuthGuard } from './session-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

function contextWithCookies(cookies: Record<string, string>): ExecutionContext {
  const request = { signedCookies: cookies, auth: undefined as unknown };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('SessionAuthGuard', () => {
  const config = { get: () => 'companio_sid' } as never;
  let prisma: { session: { findUnique: jest.Mock } };
  let guard: SessionAuthGuard;

  beforeEach(() => {
    prisma = { session: { findUnique: jest.fn() } };
    guard = new SessionAuthGuard(prisma as unknown as PrismaService, config);
  });

  it('rejects when there is no session cookie at all', async () => {
    const ctx = contextWithCookies({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the session id does not exist in the database', async () => {
    prisma.session.findUnique.mockResolvedValue(null);
    const ctx = contextWithCookies({ companio_sid: 'does-not-exist' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000), // in the past
      user: { id: 'u1', status: 'ACTIVE' },
    });
    const ctx = contextWithCookies({ companio_sid: 's1' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a revoked session even if not yet expired', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: 'u1', status: 'ACTIVE' },
    });
    const ctx = contextWithCookies({ companio_sid: 's1' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a valid session belonging to a non-ACTIVE (e.g. suspended) user', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: 'u1', status: 'SUSPENDED' },
    });
    const ctx = contextWithCookies({ companio_sid: 's1' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a valid session and attaches { userId, sessionId } to the request', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: 'u1', status: 'ACTIVE' },
    });
    const request: Record<string, unknown> = { signedCookies: { companio_sid: 's1' } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.auth).toEqual({ userId: 'u1', sessionId: 's1' });
  });
});
