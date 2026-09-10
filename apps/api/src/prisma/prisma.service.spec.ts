import { ConfigService } from '@nestjs/config';

// PrismaPg's constructor is mocked so this test never touches a real
// Postgres connection — PrismaService's own constructor never calls
// $connect() (that happens in onModuleInit), so what's actually worth
// testing here is narrow and mechanical: does DB_POOL_MAX (Phase 10,
// see the class's own docblock and SCALING.md "Connection pool") get
// read and passed through to the adapter correctly, and does leaving
// it unset preserve the old, unconfigured behavior exactly.
const PrismaPgMock = jest.fn();
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: PrismaPgMock,
}));

// PrismaClient's real constructor validates the adapter's shape (it's
// not just a plain constructor call) — mocked out too so this test can
// exercise PrismaService's own constructor logic (parsing DB_POOL_MAX,
// building the adapter config) in isolation from that validation, which
// has nothing to do with what Phase 10 changed here.
jest.mock('@prisma/client', () => ({
  PrismaClient: class {},
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaService } = require('./prisma.service');

describe('PrismaService — DB_POOL_MAX', () => {
  beforeEach(() => PrismaPgMock.mockClear());

  function configWith(values: Record<string, string>): ConfigService {
    return { get: (key: string) => values[key] } as unknown as ConfigService;
  }

  it('passes DATABASE_URL through with no `max` override when DB_POOL_MAX is unset — unchanged from before this option existed', () => {
    new PrismaService(configWith({ DATABASE_URL: 'postgresql://x' }));
    expect(PrismaPgMock).toHaveBeenCalledWith({ connectionString: 'postgresql://x' });
  });

  it('passes a numeric `max` through when DB_POOL_MAX is set', () => {
    new PrismaService(configWith({ DATABASE_URL: 'postgresql://x', DB_POOL_MAX: '30' }));
    expect(PrismaPgMock).toHaveBeenCalledWith({ connectionString: 'postgresql://x', max: 30 });
  });

  it('ignores a non-numeric DB_POOL_MAX rather than passing NaN through to the pool', () => {
    new PrismaService(configWith({ DATABASE_URL: 'postgresql://x', DB_POOL_MAX: 'not-a-number' }));
    expect(PrismaPgMock).toHaveBeenCalledWith({ connectionString: 'postgresql://x' });
  });

  it('still fails loudly at construction when DATABASE_URL is missing, regardless of DB_POOL_MAX', () => {
    expect(() => new PrismaService(configWith({ DB_POOL_MAX: '30' }))).toThrow(
      'DATABASE_URL is not set',
    );
  });
});
