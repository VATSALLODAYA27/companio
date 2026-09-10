import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { ConnectionsController } from '../src/connections/connections.controller';
import { ConnectionsService } from '../src/connections/connections.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionAuthGuard } from '../src/common/guards/session-auth.guard';
import { CsrfGuard } from '../src/common/guards/csrf.guard';

describe('Connections (e2e)', () => {
  let app: INestApplication;

  const connectionsServiceMock = {
    sendRequest: jest.fn(),
    listIncoming: jest.fn(),
    listOutgoing: jest.fn(),
    acceptRequest: jest.fn(),
    declineRequest: jest.fn(),
    cancelRequest: jest.fn(),
    listConnections: jest.fn(),
    removeConnection: jest.fn(),
  };

  const configValues: Record<string, string> = {
    SESSION_COOKIE_NAME: 'companio_sid',
    SESSION_SECRET: 'test-secret-not-for-production',
    NODE_ENV: 'test',
  };
  const configServiceMock = { get: (key: string) => configValues[key] };

  // Same live-looking session as the other e2e suites — proves every
  // route below resolves "the caller" from the session, never a
  // client-supplied field.
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
      controllers: [ConnectionsController],
      providers: [
        { provide: ConnectionsService, useValue: connectionsServiceMock },
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

  const RECIPIENT_ID = '02261e0c-3323-4260-b71d-5ea6974e0592';
  const REQUEST_ID = 'fe794dab-6578-4b9e-92bb-f3caca72302d';
  const CONNECTION_ID = 'b79f8c69-ae14-427e-b6ca-ac5ee7542478';

  describe('POST /connections/requests', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer())
        .post('/connections/requests')
        .send({ recipientId: RECIPIENT_ID, activityKey: 'trekking' });
      expect(res.status).toBe(401);
      expect(connectionsServiceMock.sendRequest).not.toHaveBeenCalled();
    });

    it('rejects a mutating request without a CSRF token', async () => {
      const res = await request(app.getHttpServer())
        .post('/connections/requests')
        .set('Cookie', sessionCookie())
        .send({ recipientId: RECIPIENT_ID, activityKey: 'trekking' });
      expect(res.status).toBe(403);
      expect(connectionsServiceMock.sendRequest).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID recipientId', async () => {
      const res = await request(app.getHttpServer())
        .post('/connections/requests')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ recipientId: 'not-a-uuid', activityKey: 'trekking' });
      expect(res.status).toBe(400);
      expect(connectionsServiceMock.sendRequest).not.toHaveBeenCalled();
    });

    it('rejects an activity key outside the fixed set', async () => {
      const res = await request(app.getHttpServer())
        .post('/connections/requests')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ recipientId: RECIPIENT_ID, activityKey: 'skydiving' });
      expect(res.status).toBe(400);
      expect(connectionsServiceMock.sendRequest).not.toHaveBeenCalled();
    });

    it('sends the request scoped to the session user as requester', async () => {
      connectionsServiceMock.sendRequest.mockResolvedValue({
        id: REQUEST_ID,
        activityKey: 'trekking',
        status: 'PENDING',
        createdAt: '2026-01-01T00:00:00.000Z',
        respondedAt: null,
        otherUser: {
          userId: RECIPIENT_ID,
          firstName: 'Bhavesh',
          photoUrl: null,
          verificationBadge: 'NONE',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/connections/requests')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ recipientId: RECIPIENT_ID, activityKey: 'trekking' });

      expect(res.status).toBe(201);
      expect(connectionsServiceMock.sendRequest).toHaveBeenCalledWith(
        'u1',
        RECIPIENT_ID,
        'trekking',
      );
      expect(res.body.id).toBe(REQUEST_ID);
    });

    it('surfaces a 409 when already connected', async () => {
      connectionsServiceMock.sendRequest.mockRejectedValue(
        new ConflictException('You are already connected with this user for this activity'),
      );
      const res = await request(app.getHttpServer())
        .post('/connections/requests')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ recipientId: RECIPIENT_ID, activityKey: 'trekking' });
      expect(res.status).toBe(409);
    });
  });

  describe('GET /connections/requests/incoming and /outgoing', () => {
    it('rejects unauthenticated requests on both', async () => {
      const incoming = await request(app.getHttpServer()).get('/connections/requests/incoming');
      const outgoing = await request(app.getHttpServer()).get('/connections/requests/outgoing');
      expect(incoming.status).toBe(401);
      expect(outgoing.status).toBe(401);
    });

    it('lists incoming requests for the session user, no CSRF needed for a GET', async () => {
      connectionsServiceMock.listIncoming.mockResolvedValue([
        {
          id: REQUEST_ID,
          activityKey: 'trekking',
          status: 'PENDING',
          createdAt: '2026-01-01T00:00:00.000Z',
          respondedAt: null,
          otherUser: {
            userId: RECIPIENT_ID,
            firstName: 'Bhavesh',
            photoUrl: null,
            verificationBadge: 'NONE',
          },
        },
      ]);
      const res = await request(app.getHttpServer())
        .get('/connections/requests/incoming')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(200);
      expect(connectionsServiceMock.listIncoming).toHaveBeenCalledWith('u1');
      expect(res.body).toHaveLength(1);
    });

    it('lists outgoing requests for the session user', async () => {
      connectionsServiceMock.listOutgoing.mockResolvedValue([]);
      const res = await request(app.getHttpServer())
        .get('/connections/requests/outgoing')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(200);
      expect(connectionsServiceMock.listOutgoing).toHaveBeenCalledWith('u1');
    });
  });

  describe('POST /connections/requests/:id/accept', () => {
    it('requires auth + CSRF', async () => {
      const noAuth = await request(app.getHttpServer()).post(
        `/connections/requests/${REQUEST_ID}/accept`,
      );
      expect(noAuth.status).toBe(401);

      const noCsrf = await request(app.getHttpServer())
        .post(`/connections/requests/${REQUEST_ID}/accept`)
        .set('Cookie', sessionCookie());
      expect(noCsrf.status).toBe(403);
      expect(connectionsServiceMock.acceptRequest).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID id param', async () => {
      const res = await request(app.getHttpServer())
        .post('/connections/requests/not-a-uuid/accept')
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token');
      expect(res.status).toBe(400);
      expect(connectionsServiceMock.acceptRequest).not.toHaveBeenCalled();
    });

    it('accepts scoped to the session user as recipient, never a body-supplied id', async () => {
      connectionsServiceMock.acceptRequest.mockResolvedValue({
        connectionId: CONNECTION_ID,
        conversationId: 'conv-1',
      });
      const res = await request(app.getHttpServer())
        .post(`/connections/requests/${REQUEST_ID}/accept`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token');
      expect(res.status).toBe(201);
      expect(connectionsServiceMock.acceptRequest).toHaveBeenCalledWith('u1', REQUEST_ID);
      expect(res.body.connectionId).toBe(CONNECTION_ID);
    });

    it('surfaces a 403 when the request was not sent to this user', async () => {
      connectionsServiceMock.acceptRequest.mockRejectedValue(
        new ForbiddenException('This request was not sent to you'),
      );
      const res = await request(app.getHttpServer())
        .post(`/connections/requests/${REQUEST_ID}/accept`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /connections/requests/:id/decline', () => {
    it('declines scoped to the session user', async () => {
      connectionsServiceMock.declineRequest.mockResolvedValue({ status: 'DECLINED' });
      const res = await request(app.getHttpServer())
        .post(`/connections/requests/${REQUEST_ID}/decline`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token');
      expect(res.status).toBe(201);
      expect(connectionsServiceMock.declineRequest).toHaveBeenCalledWith('u1', REQUEST_ID);
    });
  });

  describe('DELETE /connections/requests/:id', () => {
    it('requires auth + CSRF and cancels scoped to the session user', async () => {
      connectionsServiceMock.cancelRequest.mockResolvedValue({ cancelled: true });
      const res = await request(app.getHttpServer())
        .delete(`/connections/requests/${REQUEST_ID}`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token');
      expect(res.status).toBe(200);
      expect(connectionsServiceMock.cancelRequest).toHaveBeenCalledWith('u1', REQUEST_ID);
    });
  });

  describe('GET /connections', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get('/connections');
      expect(res.status).toBe(401);
    });

    it('lists active connections for the session user', async () => {
      connectionsServiceMock.listConnections.mockResolvedValue([
        {
          id: CONNECTION_ID,
          activityKey: 'trekking',
          createdAt: '2026-01-01T00:00:00.000Z',
          conversationId: 'conv-1',
          otherUser: {
            userId: RECIPIENT_ID,
            firstName: 'Bhavesh',
            photoUrl: null,
            verificationBadge: 'NONE',
          },
        },
      ]);
      const res = await request(app.getHttpServer())
        .get('/connections')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(200);
      expect(connectionsServiceMock.listConnections).toHaveBeenCalledWith('u1');
      expect(res.body).toHaveLength(1);
    });
  });

  describe('DELETE /connections/:id', () => {
    it('requires auth + CSRF and removes scoped to the session user', async () => {
      connectionsServiceMock.removeConnection.mockResolvedValue({ removed: true });
      const res = await request(app.getHttpServer())
        .delete(`/connections/${CONNECTION_ID}`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token');
      expect(res.status).toBe(200);
      expect(connectionsServiceMock.removeConnection).toHaveBeenCalledWith('u1', CONNECTION_ID);
    });

    it('surfaces a 403 when the caller is not a participant', async () => {
      connectionsServiceMock.removeConnection.mockRejectedValue(
        new ForbiddenException('You are not a participant in this connection'),
      );
      const res = await request(app.getHttpServer())
        .delete(`/connections/${CONNECTION_ID}`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token');
      expect(res.status).toBe(403);
    });
  });
});
