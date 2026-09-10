import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionAuthGuard } from '../src/common/guards/session-auth.guard';
import { CsrfGuard } from '../src/common/guards/csrf.guard';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  const authServiceMock = {
    register: jest.fn(),
    login: jest.fn(),
    loginWithGoogle: jest.fn(),
    logout: jest.fn(),
  };

  const configValues: Record<string, string> = {
    SESSION_COOKIE_NAME: 'companio_sid',
    SESSION_SECRET: 'test-secret-not-for-production',
    NODE_ENV: 'test',
  };
  const configServiceMock = { get: (key: string) => configValues[key] };

  const prismaMock = { session: { findUnique: jest.fn() } };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: PrismaService, useValue: prismaMock },
        SessionAuthGuard,
        CsrfGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser(configValues.SESSION_SECRET));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(async () => app.close());

  it('POST /auth/register sets a session cookie on success', async () => {
    authServiceMock.register.mockResolvedValue({
      id: 'session-abc',
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'new@test.local', password: 'password123', firstName: 'Nia' });

    expect(res.status).toBe(201);
    expect(authServiceMock.register).toHaveBeenCalledWith('new@test.local', 'password123', 'Nia');
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith('companio_sid='))).toBe(true);
    expect(setCookie.some((c) => c.includes('HttpOnly'))).toBe(true);
  });

  it('POST /auth/register rejects a payload missing required fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(authServiceMock.register).not.toHaveBeenCalled();
  });

  it('POST /auth/login returns 401 without leaking whether the account exists', async () => {
    authServiceMock.login.mockRejectedValue(new (require('@nestjs/common').UnauthorizedException)('Invalid email or password'));

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@test.local', password: 'whatever123' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at Object/);
  });

  it('GET /auth/session returns 401 with no cookie', async () => {
    const res = await request(app.getHttpServer()).get('/auth/session');
    expect(res.status).toBe(401);
  });

  it('GET /auth/session returns 401 for an unknown/forged session id', async () => {
    prismaMock.session.findUnique.mockResolvedValue(null);
    const res = await request(app.getHttpServer())
      .get('/auth/session')
      .set('Cookie', 'companio_sid=s.forgedvalue');
    expect(res.status).toBe(401);
  });

  it('rejects logout without a valid CSRF token even with a valid session', async () => {
    // Log in first to get a real signed session cookie from this app instance.
    authServiceMock.login.mockResolvedValue({
      id: 'session-xyz',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@test.local', password: 'password123' });
    const sessionCookie = extractCookie(loginRes, 'companio_sid');

    prismaMock.session.findUnique.mockResolvedValue({
      id: 'session-xyz',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: 'u1', status: 'ACTIVE' },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(403);
    expect(authServiceMock.logout).not.toHaveBeenCalled();
  });

  it('logs out successfully with a valid session + matching CSRF token', async () => {
    authServiceMock.login.mockResolvedValue({
      id: 'session-xyz',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@test.local', password: 'password123' });
    const sessionCookie = extractCookie(loginRes, 'companio_sid');

    const csrfRes = await request(app.getHttpServer())
      .get('/auth/csrf')
      .set('Cookie', sessionCookie);
    const csrfCookie = extractCookie(csrfRes, 'companio_csrf');
    const csrfToken = csrfRes.body.csrfToken as string;

    prismaMock.session.findUnique.mockResolvedValue({
      id: 'session-xyz',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: 'u1', status: 'ACTIVE' },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `${sessionCookie}; ${csrfCookie}`)
      .set('X-CSRF-Token', csrfToken);

    expect(res.status).toBe(200);
    expect(authServiceMock.logout).toHaveBeenCalledWith('session-xyz');
  });
});

function extractCookie(res: request.Response, name: string): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  const found = setCookie.find((c) => c.startsWith(`${name}=`));
  if (!found) throw new Error(`cookie ${name} not set`);
  return found.split(';')[0];
}
