import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionAuthGuard } from '../src/common/guards/session-auth.guard';

/**
 * GET /users/me had no HTTP-level test anywhere before Phase 9 — every
 * other module has had an e2e-spec.ts since the phase it shipped in, but
 * this Phase-2 route was only ever exercised indirectly, through other
 * flows that happen to call SessionAuthGuard. This file closes that gap.
 */
describe('Users (e2e)', () => {
  let app: INestApplication;

  const usersServiceMock = { findActiveById: jest.fn() };

  const configValues: Record<string, string> = {
    SESSION_COOKIE_NAME: 'companio_sid',
    SESSION_SECRET: 'test-secret-not-for-production',
    NODE_ENV: 'test',
  };
  const configServiceMock = { get: (key: string) => configValues[key] };

  const activeSession = {
    id: 'session-1',
    userId: 'u1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3600_000),
    user: { id: 'u1', status: 'ACTIVE' },
  };
  const prismaMock = { session: { findUnique: jest.fn().mockResolvedValue(activeSession) } };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: PrismaService, useValue: prismaMock },
        SessionAuthGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser(configValues.SESSION_SECRET));
    await app.init();
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(async () => app.close());

  function sessionCookie(): string {
    const cookieSignature = require('cookie-signature');
    return `companio_sid=s:${cookieSignature.sign('session-1', configValues.SESSION_SECRET)}`;
  }

  it('rejects an unauthenticated request', async () => {
    const res = await request(app.getHttpServer()).get('/users/me');
    expect(res.status).toBe(401);
    expect(usersServiceMock.findActiveById).not.toHaveBeenCalled();
  });

  it('rejects a tampered session cookie', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', 'companio_sid=s:not-a-real-signature');
    expect(res.status).toBe(401);
  });

  it('returns only the allowlisted fields for the session user — never passwordHash or googleId', async () => {
    usersServiceMock.findActiveById.mockResolvedValue({
      id: 'u1',
      email: 'a@test.local',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      passwordHash: '$argon2id$should-never-leave-this-handler',
      googleId: 'g-should-also-never-leave',
    });
    const res = await request(app.getHttpServer()).get('/users/me').set('Cookie', sessionCookie());

    expect(res.status).toBe(200);
    expect(usersServiceMock.findActiveById).toHaveBeenCalledWith('u1');
    expect(res.body).toEqual({
      id: 'u1',
      email: 'a@test.local',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.googleId).toBeUndefined();
  });

  it('returns 404, not the session\'s stale identity, once the account is gone/suspended', async () => {
    usersServiceMock.findActiveById.mockResolvedValue(null);
    const res = await request(app.getHttpServer()).get('/users/me').set('Cookie', sessionCookie());
    expect(res.status).toBe(404);
  });
});
