import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { ChatController } from '../src/chat/chat.controller';
import { ChatService } from '../src/chat/chat.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionAuthGuard } from '../src/common/guards/session-auth.guard';
import { CsrfGuard } from '../src/common/guards/csrf.guard';

describe('Chat (e2e)', () => {
  let app: INestApplication;

  const chatServiceMock = {
    listMessages: jest.fn(),
    sendMessage: jest.fn(),
    markRead: jest.fn(),
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
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: chatServiceMock },
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

  const CONVERSATION_ID = '4b1b2e6a-3a1a-4a8b-9c2d-1f0a2b3c4d5e';

  describe('GET /conversations/:id/messages', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get(
        `/conversations/${CONVERSATION_ID}/messages`,
      );
      expect(res.status).toBe(401);
      expect(chatServiceMock.listMessages).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID conversationId', async () => {
      const res = await request(app.getHttpServer())
        .get('/conversations/not-a-uuid/messages')
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(400);
      expect(chatServiceMock.listMessages).not.toHaveBeenCalled();
    });

    it('lists messages for the session user, no CSRF needed for a GET', async () => {
      chatServiceMock.listMessages.mockResolvedValue([
        {
          id: 'm1',
          conversationId: CONVERSATION_ID,
          senderId: 'u2',
          body: 'hey',
          sentAt: '2026-01-01T00:00:00.000Z',
          readAt: null,
        },
      ]);
      const res = await request(app.getHttpServer())
        .get(`/conversations/${CONVERSATION_ID}/messages`)
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(200);
      expect(chatServiceMock.listMessages).toHaveBeenCalledWith(
        'u1',
        CONVERSATION_ID,
        undefined,
        undefined,
      );
      expect(res.body).toHaveLength(1);
    });

    it('passes before/limit query params through', async () => {
      chatServiceMock.listMessages.mockResolvedValue([]);
      const res = await request(app.getHttpServer())
        .get(`/conversations/${CONVERSATION_ID}/messages?before=2026-01-01T00:00:00.000Z&limit=10`)
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(200);
      expect(chatServiceMock.listMessages).toHaveBeenCalledWith(
        'u1',
        CONVERSATION_ID,
        '2026-01-01T00:00:00.000Z',
        10,
      );
    });

    it('rejects a malformed before value', async () => {
      const res = await request(app.getHttpServer())
        .get(`/conversations/${CONVERSATION_ID}/messages?before=not-a-date`)
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(400);
      expect(chatServiceMock.listMessages).not.toHaveBeenCalled();
    });

    it('surfaces a 403 when the caller is not a participant', async () => {
      chatServiceMock.listMessages.mockRejectedValue(
        new ForbiddenException('You are not a participant in this conversation'),
      );
      const res = await request(app.getHttpServer())
        .get(`/conversations/${CONVERSATION_ID}/messages`)
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(403);
    });
  });

  describe('POST /conversations/:id/messages', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer())
        .post(`/conversations/${CONVERSATION_ID}/messages`)
        .send({ body: 'hi' });
      expect(res.status).toBe(401);
      expect(chatServiceMock.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects a mutating request without a CSRF token', async () => {
      const res = await request(app.getHttpServer())
        .post(`/conversations/${CONVERSATION_ID}/messages`)
        .set('Cookie', sessionCookie())
        .send({ body: 'hi' });
      expect(res.status).toBe(403);
      expect(chatServiceMock.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects an empty body', async () => {
      const res = await request(app.getHttpServer())
        .post(`/conversations/${CONVERSATION_ID}/messages`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ body: '' });
      expect(res.status).toBe(400);
      expect(chatServiceMock.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects a body over 2000 characters', async () => {
      const res = await request(app.getHttpServer())
        .post(`/conversations/${CONVERSATION_ID}/messages`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ body: 'x'.repeat(2001) });
      expect(res.status).toBe(400);
      expect(chatServiceMock.sendMessage).not.toHaveBeenCalled();
    });

    it('sends the message scoped to the session user as sender', async () => {
      chatServiceMock.sendMessage.mockResolvedValue({
        id: 'm1',
        conversationId: CONVERSATION_ID,
        senderId: 'u1',
        body: 'hello',
        sentAt: '2026-01-01T00:00:00.000Z',
        readAt: null,
      });
      const res = await request(app.getHttpServer())
        .post(`/conversations/${CONVERSATION_ID}/messages`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ body: 'hello' });
      expect(res.status).toBe(201);
      expect(chatServiceMock.sendMessage).toHaveBeenCalledWith('u1', CONVERSATION_ID, 'hello');
      expect(res.body.senderId).toBe('u1');
    });

    it('surfaces a 400 once the connection has ended', async () => {
      chatServiceMock.sendMessage.mockRejectedValue(
        new BadRequestException('This connection has ended — you can no longer send messages here'),
      );
      const res = await request(app.getHttpServer())
        .post(`/conversations/${CONVERSATION_ID}/messages`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ body: 'hello' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /conversations/:id/messages/read', () => {
    it('requires auth + CSRF and marks read scoped to the session user', async () => {
      chatServiceMock.markRead.mockResolvedValue({ updated: 2 });
      const res = await request(app.getHttpServer())
        .post(`/conversations/${CONVERSATION_ID}/messages/read`)
        .set('Cookie', csrfPair())
        .set('X-CSRF-Token', 'test-csrf-token');
      expect(res.status).toBe(201);
      expect(chatServiceMock.markRead).toHaveBeenCalledWith('u1', CONVERSATION_ID);
      expect(res.body).toEqual({ updated: 2 });
    });

    it('rejects without CSRF', async () => {
      const res = await request(app.getHttpServer())
        .post(`/conversations/${CONVERSATION_ID}/messages/read`)
        .set('Cookie', sessionCookie());
      expect(res.status).toBe(403);
      expect(chatServiceMock.markRead).not.toHaveBeenCalled();
    });
  });
});
