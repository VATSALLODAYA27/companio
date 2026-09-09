import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from '../src/health/health.controller';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Health (e2e)', () => {
  let app: INestApplication;
  const prismaMock = {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };

  beforeAll(async () => {
    // Provide PrismaService directly (rather than importing the real
    // PrismaModule/PrismaClient) so this test never touches a database or
    // requires a generated Prisma client to run.
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prismaMock }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok when the database is reachable', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('ok');
  });

  it('GET /health never leaks internal error detail when the database is down', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(
      new Error('connection refused at 10.0.0.5:5432 user=companio'),
    );
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });
});
