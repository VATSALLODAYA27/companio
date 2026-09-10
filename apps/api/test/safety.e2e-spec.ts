import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { SafetyController } from '../src/safety/safety.controller';
import { SafetyService } from '../src/safety/safety.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionAuthGuard } from '../src/common/guards/session-auth.guard';
import { CsrfGuard } from '../src/common/guards/csrf.guard';

describe('Safety (e2e)', () => {
  let app: INestApplication;

  const safetyServiceMock = {
    createBlock: jest.fn(),
    removeBlock: jest.fn(),
    listBlocks: jest.fn(),
    createReport: jest.fn(),
    listMyReports: jest.fn(),
  };

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
      controllers: [SafetyController],
      providers: [
        { provide: SafetyService, useValue: safetyServiceMock },
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

  const OTHER_USER_ID = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';

  describe('POST /safety/blocks', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer())
        .post('/safety/blocks')
        .send({ blockedUserId: OTHER_USER_ID });
      expect(res.status).toBe(401);
      expect(safetyServiceMock.createBlock).not.toHaveBeenCalled();
    });

    it('rejects a mutating request without a CSRF token', async () => {
      const res = await request(app.getHttpServer())
        .post('/safety/blocks')
        .set('Cookie', sessionCookie())
        .send({ blockedUserId: OTHER_USER_ID });
      expect(res.status).toBe(403);
      expect(safetyServiceMock.createBlock).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID blockedUserId', async () => {
      const res = await request(app.getHttpServer())
        .post('/safety/blocks')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ blockedUserId: 'not-a-uuid' });
      expect(res.status).toBe(400);
      expect(safetyServiceMock.createBlock).not.toHaveBeenCalled();
    });

    it('creates the block for the session user as blocker', async () => {
      safetyServiceMock.createBlock.mockResolvedValue({ blocked: true });
      const res = await request(app.getHttpServer())
        .post('/safety/blocks')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ blockedUserId: OTHER_USER_ID });
      expect(res.status).toBe(201);
      expect(safetyServiceMock.createBlock).toHaveBeenCalledWith('u1', OTHER_USER_ID);
      expect(res.body).toEqual({ blocked: true });
    });

    it('surfaces a 400 when blocking yourself', async () => {
      safetyServiceMock.createBlock.mockRejectedValue(
        new BadRequestException('You cannot block yourself'),
      );
      const res = await request(app.getHttpServer())
        .post('/safety/blocks')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ blockedUserId: OTHER_USER_ID });
      expect(res.status).toBe(400);
    });

    it('surfaces a 409 for an already-blocked user', async () => {
      safetyServiceMock.createBlock.mockRejectedValue(
        new ConflictException('You have already blocked this user'),
      );
      const res = await request(app.getHttpServer())
        .post('/safety/blocks')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ blockedUserId: OTHER_USER_ID });
      expect(res.status).toBe(409);
    });
  });

  describe('GET /safety/blocks', () => {
    it('requires auth and lists only the caller\'s own blocks, no CSRF needed for a GET', async () => {
      safetyServiceMock.listBlocks.mockResolvedValue([
        { userId: OTHER_USER_ID, firstName: 'Riya', photoUrl: null, blockedAt: '2026-01-01T00:00:00.000Z' },
      ]);
      const res = await request(app.getHttpServer())
        .get('/safety/blocks')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(200);
      expect(safetyServiceMock.listBlocks).toHaveBeenCalledWith('u1');
      expect(res.body.blocks).toHaveLength(1);
    });
  });

  describe('DELETE /safety/blocks/:userId', () => {
    it('requires auth + CSRF and unblocks scoped to the caller', async () => {
      safetyServiceMock.removeBlock.mockResolvedValue({ unblocked: true });
      const res = await request(app.getHttpServer())
        .delete(`/safety/blocks/${OTHER_USER_ID}`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token');
      expect(res.status).toBe(200);
      expect(safetyServiceMock.removeBlock).toHaveBeenCalledWith('u1', OTHER_USER_ID);
      expect(res.body).toEqual({ unblocked: true });
    });

    it('surfaces a 404 when there was no such block', async () => {
      safetyServiceMock.removeBlock.mockRejectedValue(new NotFoundException('Block not found'));
      const res = await request(app.getHttpServer())
        .delete(`/safety/blocks/${OTHER_USER_ID}`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /safety/reports', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer())
        .post('/safety/reports')
        .send({ reportedUserId: OTHER_USER_ID, category: 'SPAM' });
      expect(res.status).toBe(401);
      expect(safetyServiceMock.createReport).not.toHaveBeenCalled();
    });

    it('rejects a mutating request without a CSRF token', async () => {
      const res = await request(app.getHttpServer())
        .post('/safety/reports')
        .set('Cookie', sessionCookie())
        .send({ reportedUserId: OTHER_USER_ID, category: 'SPAM' });
      expect(res.status).toBe(403);
      expect(safetyServiceMock.createReport).not.toHaveBeenCalled();
    });

    it('rejects a category outside the fixed set', async () => {
      const res = await request(app.getHttpServer())
        .post('/safety/reports')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ reportedUserId: OTHER_USER_ID, category: 'MURDER' });
      expect(res.status).toBe(400);
      expect(safetyServiceMock.createReport).not.toHaveBeenCalled();
    });

    it('rejects details over 1000 characters', async () => {
      const res = await request(app.getHttpServer())
        .post('/safety/reports')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ reportedUserId: OTHER_USER_ID, category: 'OTHER', details: 'x'.repeat(1001) });
      expect(res.status).toBe(400);
      expect(safetyServiceMock.createReport).not.toHaveBeenCalled();
    });

    it('files the report scoped to the session user as reporter', async () => {
      safetyServiceMock.createReport.mockResolvedValue({
        id: 'r1',
        reportedUserId: OTHER_USER_ID,
        category: 'HARASSMENT',
        details: 'sent threats',
        status: 'OPEN',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      const res = await request(app.getHttpServer())
        .post('/safety/reports')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ reportedUserId: OTHER_USER_ID, category: 'HARASSMENT', details: 'sent threats' });
      expect(res.status).toBe(201);
      expect(safetyServiceMock.createReport).toHaveBeenCalledWith(
        'u1',
        OTHER_USER_ID,
        'HARASSMENT',
        'sent threats',
      );
      expect(res.body.status).toBe('OPEN');
    });

    it('surfaces a 400 when reporting yourself', async () => {
      safetyServiceMock.createReport.mockRejectedValue(
        new BadRequestException('You cannot report yourself'),
      );
      const res = await request(app.getHttpServer())
        .post('/safety/reports')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ reportedUserId: OTHER_USER_ID, category: 'OTHER' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /safety/reports', () => {
    it('requires auth and lists only reports the caller filed, no CSRF needed for a GET', async () => {
      safetyServiceMock.listMyReports.mockResolvedValue([]);
      const res = await request(app.getHttpServer())
        .get('/safety/reports')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(200);
      expect(safetyServiceMock.listMyReports).toHaveBeenCalledWith('u1');
      expect(res.body).toEqual({ reports: [] });
    });
  });
});
