import { Test } from '@nestjs/testing';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { LocationController } from '../src/location/location.controller';
import { LocationService } from '../src/location/location.service';
import { DiscoveryController } from '../src/discovery/discovery.controller';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionAuthGuard } from '../src/common/guards/session-auth.guard';
import { CsrfGuard } from '../src/common/guards/csrf.guard';

describe('Location + Discovery (e2e)', () => {
  let app: INestApplication;

  const locationServiceMock = {
    updateMyLocation: jest.fn(),
    clearMyLocation: jest.fn(),
  };
  const discoveryServiceMock = { findNearby: jest.fn() };

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
      controllers: [LocationController, DiscoveryController],
      providers: [
        { provide: LocationService, useValue: locationServiceMock },
        { provide: DiscoveryService, useValue: discoveryServiceMock },
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
    const cookieSignature = require('cookie-signature');
    return `${name}=s:${cookieSignature.sign(value, configValues.SESSION_SECRET)}`;
  }
  const sessionCookie = () => signCookie('companio_sid', 'session-1');
  const csrfPair = (token = 'test-csrf-token') =>
    [sessionCookie(), signCookie('companio_csrf', token)].join('; ');

  describe('PUT /location/me', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer())
        .put('/location/me')
        .send({ latitude: 19.17, longitude: 72.94 });
      expect(res.status).toBe(401);
      expect(locationServiceMock.updateMyLocation).not.toHaveBeenCalled();
    });

    it('rejects a mutating request without a CSRF token', async () => {
      const res = await request(app.getHttpServer())
        .put('/location/me')
        .set('Cookie', sessionCookie())
        .send({ latitude: 19.17, longitude: 72.94 });
      expect(res.status).toBe(403);
      expect(locationServiceMock.updateMyLocation).not.toHaveBeenCalled();
    });

    it('rejects an out-of-range latitude', async () => {
      const res = await request(app.getHttpServer())
        .put('/location/me')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ latitude: 200, longitude: 72.94 });
      expect(res.status).toBe(400);
      expect(locationServiceMock.updateMyLocation).not.toHaveBeenCalled();
    });

    it('updates the location for the session user only, from the session — never a client-supplied id', async () => {
      locationServiceMock.updateMyLocation.mockResolvedValue({ updated: true });
      const res = await request(app.getHttpServer())
        .put('/location/me')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ latitude: 19.1728, longitude: 72.9425 });

      expect(res.status).toBe(200);
      expect(locationServiceMock.updateMyLocation).toHaveBeenCalledWith('u1', 19.1728, 72.9425);
    });
  });

  describe('DELETE /location/me', () => {
    it('requires auth + CSRF and clears only the caller\'s own row', async () => {
      locationServiceMock.clearMyLocation.mockResolvedValue({ cleared: true });
      const res = await request(app.getHttpServer())
        .delete('/location/me')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token');

      expect(res.status).toBe(200);
      expect(locationServiceMock.clearMyLocation).toHaveBeenCalledWith('u1');
    });
  });

  describe('GET /discovery/nearby', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get('/discovery/nearby?activityKey=gym');
      expect(res.status).toBe(401);
      expect(discoveryServiceMock.findNearby).not.toHaveBeenCalled();
    });

    it('rejects an activity key outside the fixed set', async () => {
      const res = await request(app.getHttpServer())
        .get('/discovery/nearby?activityKey=skydiving')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(400);
      expect(discoveryServiceMock.findNearby).not.toHaveBeenCalled();
    });

    it('rejects a radius outside the fixed set', async () => {
      const res = await request(app.getHttpServer())
        .get('/discovery/nearby?activityKey=gym&radiusMeters=2000')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(400);
      expect(discoveryServiceMock.findNearby).not.toHaveBeenCalled();
    });

    it('searches scoped to the session user, never a client-supplied id, and no CSRF needed for a GET', async () => {
      discoveryServiceMock.findNearby.mockResolvedValue([
        {
          userId: 'u2',
          firstName: 'Asha',
          photoUrl: null,
          ageRange: '25-34',
          activityKey: 'gym',
          availability: 'NOW',
          verificationBadge: 'NONE',
          distanceLabel: '< 250 m',
        },
      ]);

      const res = await request(app.getHttpServer())
        .get('/discovery/nearby?activityKey=gym&radiusMeters=5000&offset=0')
        .set('Cookie', sessionCookie());

      expect(res.status).toBe(200);
      expect(discoveryServiceMock.findNearby).toHaveBeenCalledWith('u1', 'gym', 5000, 0);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].userId).toBe('u2');
    });

    it('surfaces a clear 400 when the caller has not set a location yet', async () => {
      discoveryServiceMock.findNearby.mockRejectedValue(
        new BadRequestException('Set your location (PUT /location/me) before searching for nearby companions'),
      );
      const res = await request(app.getHttpServer())
        .get('/discovery/nearby?activityKey=gym')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/set your location/i);
    });
  });
});
