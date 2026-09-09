import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

describe('AppModule', () => {
  it('compiles the dependency graph without errors', async () => {
    // PrismaService is overridden so this test verifies module wiring
    // (guards, controllers, providers all resolve) without requiring a
    // generated Prisma client or a live database connection — that is
    // covered separately by the e2e health check and the direct
    // PostGIS query verification in scripts/phase1-discovery-check.sql.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn(), $on: jest.fn() })
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
