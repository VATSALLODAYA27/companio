import { Test } from '@nestjs/testing';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { MapController } from '../src/map/map.controller';
import { MapService } from '../src/map/map.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionAuthGuard } from '../src/common/guards/session-auth.guard';
import { CsrfGuard } from '../src/common/guards/csrf.guard';

describe('Map (e2e)', () => {
  let app: INestApplication;

  const mapServiceMock = { findNearbyPins: jest.fn() };

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
      controllers: [MapController],
      providers: [
        { provide: MapService, useValue: mapServiceMock },
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

  describe('GET /map/nearby', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get('/map/nearby?activityKey=gym');
      expect(res.status).toBe(401);
      expect(mapServiceMock.findNearbyPins).not.toHaveBeenCalled();
    });

    it('rejects an activity key outside the fixed set', async () => {
      const res = await request(app.getHttpServer())
        .get('/map/nearby?activityKey=skydiving')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(400);
      expect(mapServiceMock.findNearbyPins).not.toHaveBeenCalled();
    });

    it('rejects a radius outside the fixed set', async () => {
      const res = await request(app.getHttpServer())
        .get('/map/nearby?activityKey=gym&radiusMeters=2000')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(400);
      expect(mapServiceMock.findNearbyPins).not.toHaveBeenCalled();
    });

    it('rejects a negative offset', async () => {
      const res = await request(app.getHttpServer())
        .get('/map/nearby?activityKey=gym&offset=-1')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(400);
      expect(mapServiceMock.findNearbyPins).not.toHaveBeenCalled();
    });

    it('searches scoped to the session user, never a client-supplied id, and no CSRF needed for a GET', async () => {
      mapServiceMock.findNearbyPins.mockResolvedValue([
        {
          userId: 'u2',
          firstName: 'Asha',
          photoUrl: null,
          ageRange: '25-34',
          activityKey: 'gym',
          availability: 'NOW',
          verificationBadge: 'NONE',
          distanceLabel: '< 250 m',
          latitude: 19.174,
          longitude: 72.941,
        },
      ]);

      const res = await request(app.getHttpServer())
        .get('/map/nearby?activityKey=gym&radiusMeters=5000&offset=0')
        .set('Cookie', sessionCookie());

      expect(res.status).toBe(200);
      expect(mapServiceMock.findNearbyPins).toHaveBeenCalledWith('u1', 'gym', 5000, 0);
      expect(res.body.pins).toHaveLength(1);
      expect(res.body.pins[0].userId).toBe('u2');
      expect(typeof res.body.pins[0].latitude).toBe('number');
      expect(typeof res.body.pins[0].longitude).toBe('number');
    });

    it('surfaces a clear 400 when the caller has not set a location yet', async () => {
      mapServiceMock.findNearbyPins.mockRejectedValue(
        new BadRequestException('Set your location (PUT /location/me) before viewing the map'),
      );
      const res = await request(app.getHttpServer())
        .get('/map/nearby?activityKey=gym')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/set your location/i);
    });
  });
});
