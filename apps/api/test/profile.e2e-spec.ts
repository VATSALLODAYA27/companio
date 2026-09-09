import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { ProfileController } from '../src/profile/profile.controller';
import { ProfileService } from '../src/profile/profile.service';
import { ActivitiesController } from '../src/activities/activities.controller';
import { ActivitiesService } from '../src/activities/activities.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionAuthGuard } from '../src/common/guards/session-auth.guard';
import { CsrfGuard } from '../src/common/guards/csrf.guard';

describe('Profile + Activities (e2e)', () => {
  let app: INestApplication;

  const profileServiceMock = {
    getMyProfile: jest.fn(),
    upsertMyProfile: jest.fn(),
    getMyActivities: jest.fn(),
    setMyActivities: jest.fn(),
  };
  const activitiesServiceMock = { findAll: jest.fn() };

  const configValues: Record<string, string> = {
    SESSION_COOKIE_NAME: 'companio_sid',
    SESSION_SECRET: 'test-secret-not-for-production',
    NODE_ENV: 'test',
  };
  const configServiceMock = { get: (key: string) => configValues[key] };

  // Every authenticated test below uses this same live-looking session so
  // SessionAuthGuard resolves userId "u1" — never a client-supplied id —
  // proving there is no request field that can select another user.
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
      controllers: [ProfileController, ActivitiesController],
      providers: [
        { provide: ProfileService, useValue: profileServiceMock },
        { provide: ActivitiesService, useValue: activitiesServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: PrismaService, useValue: prismaMock },
        SessionAuthGuard,
        CsrfGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser(configValues.SESSION_SECRET));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(async () => app.close());

  function signCookie(name: string, value: string): string {
    // Reuses cookie-parser's own signing so the guard's signedCookies
    // lookup succeeds, mirroring how a real login response would look.
    const cookieSignature = require('cookie-signature');
    return `${name}=s:${cookieSignature.sign(value, configValues.SESSION_SECRET)}`;
  }

  describe('GET /activities', () => {
    it('is public — no session required', async () => {
      activitiesServiceMock.findAll.mockResolvedValue([
        { id: '1', key: 'gym', label: 'Gym' },
        { id: '2', key: 'bowling', label: 'Bowling' },
      ]);
      const res = await request(app.getHttpServer()).get('/activities');
      expect(res.status).toBe(200);
      expect(res.body.activities).toEqual([
        { key: 'gym', label: 'Gym' },
        { key: 'bowling', label: 'Bowling' },
      ]);
    });
  });

  describe('GET /profile/me', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get('/profile/me');
      expect(res.status).toBe(401);
      expect(profileServiceMock.getMyProfile).not.toHaveBeenCalled();
    });

    it('returns the caller\'s own profile only', async () => {
      profileServiceMock.getMyProfile.mockResolvedValue({
        firstName: 'Nia',
        verificationBadge: 'NONE',
      });
      const res = await request(app.getHttpServer())
        .get('/profile/me')
        .set('Cookie', signCookie('companio_sid', 'session-1'));

      expect(res.status).toBe(200);
      expect(profileServiceMock.getMyProfile).toHaveBeenCalledWith('u1');
      expect(res.body.firstName).toBe('Nia');
    });

    it('surfaces 404 when the profile has not been created yet', async () => {
      profileServiceMock.getMyProfile.mockRejectedValue(
        new (require('@nestjs/common').NotFoundException)('Profile not created yet'),
      );
      const res = await request(app.getHttpServer())
        .get('/profile/me')
        .set('Cookie', signCookie('companio_sid', 'session-1'));
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /profile/me', () => {
    it('rejects a mutating request without a CSRF token even with a valid session', async () => {
      const res = await request(app.getHttpServer())
        .put('/profile/me')
        .set('Cookie', signCookie('companio_sid', 'session-1'))
        .send({ firstName: 'Nia' });

      expect(res.status).toBe(403);
      expect(profileServiceMock.upsertMyProfile).not.toHaveBeenCalled();
    });

    it('rejects an invalid payload (bad ageRange bucket) with 400', async () => {
      const csrfRes = await request(app.getHttpServer())
        .get('/auth/csrf')
        .catch(() => null);
      // /auth/csrf isn't mounted in this focused test module — issue our
      // own matching pair the same way the CsrfGuard checks them.
      void csrfRes;
      const token = 'test-csrf-token';
      const res = await request(app.getHttpServer())
        .put('/profile/me')
        .set('Cookie', [signCookie('companio_sid', 'session-1'), signCookie('companio_csrf', token)].join('; '))
        .set('X-CSRF-Token', token)
        .send({ firstName: 'Nia', ageRange: '99-120' });

      expect(res.status).toBe(400);
      expect(profileServiceMock.upsertMyProfile).not.toHaveBeenCalled();
    });

    it('updates the profile with a valid session + CSRF token', async () => {
      profileServiceMock.upsertMyProfile.mockResolvedValue({ firstName: 'Nia' });
      const token = 'test-csrf-token';

      const res = await request(app.getHttpServer())
        .put('/profile/me')
        .set('Cookie', [signCookie('companio_sid', 'session-1'), signCookie('companio_csrf', token)].join('; '))
        .set('X-CSRF-Token', token)
        .send({ firstName: 'Nia', ageRange: '25-34', languages: ['English', 'Hindi'] });

      expect(res.status).toBe(200);
      expect(profileServiceMock.upsertMyProfile).toHaveBeenCalledWith('u1', {
        firstName: 'Nia',
        ageRange: '25-34',
        languages: ['English', 'Hindi'],
      });
    });

    it('rejects a payload carrying unknown fields rather than silently ignoring them', async () => {
      const token = 'test-csrf-token';

      const res = await request(app.getHttpServer())
        .put('/profile/me')
        .set('Cookie', [signCookie('companio_sid', 'session-1'), signCookie('companio_csrf', token)].join('; '))
        .set('X-CSRF-Token', token)
        .send({ firstName: 'Nia', isAdmin: true, exactLatitude: 19.1234 });

      // forbidNonWhitelisted: an unrecognized field (e.g. a client trying
      // to smuggle in isAdmin or a raw coordinate) is a hard 400, not a
      // silently-dropped field — the surer failure mode for this data.
      expect(res.status).toBe(400);
      expect(profileServiceMock.upsertMyProfile).not.toHaveBeenCalled();
    });
  });

  describe('PUT /profile/me/activities', () => {
    it('rejects an activity key outside the fixed set', async () => {
      const token = 'test-csrf-token';
      const res = await request(app.getHttpServer())
        .put('/profile/me/activities')
        .set('Cookie', [signCookie('companio_sid', 'session-1'), signCookie('companio_csrf', token)].join('; '))
        .set('X-CSRF-Token', token)
        .send({ activities: [{ activityKey: 'skydiving', availability: 'NOW' }] });

      expect(res.status).toBe(400);
      expect(profileServiceMock.setMyActivities).not.toHaveBeenCalled();
    });

    it('accepts a valid activity selection scoped to the caller', async () => {
      profileServiceMock.setMyActivities.mockResolvedValue([
        { activityKey: 'gym', label: 'Gym', availability: 'NOW' },
      ]);
      const token = 'test-csrf-token';

      const res = await request(app.getHttpServer())
        .put('/profile/me/activities')
        .set('Cookie', [signCookie('companio_sid', 'session-1'), signCookie('companio_csrf', token)].join('; '))
        .set('X-CSRF-Token', token)
        .send({ activities: [{ activityKey: 'gym', availability: 'NOW' }] });

      expect(res.status).toBe(200);
      expect(profileServiceMock.setMyActivities).toHaveBeenCalledWith('u1', [
        { activityKey: 'gym', availability: 'NOW' },
      ]);
    });
  });
});
