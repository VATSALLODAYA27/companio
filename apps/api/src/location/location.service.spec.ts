import { LocationService } from './location.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LocationService', () => {
  let prisma: {
    $executeRaw: jest.Mock;
    userLocation: { deleteMany: jest.Mock; findUnique: jest.Mock };
  };
  let service: LocationService;

  beforeEach(() => {
    prisma = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      userLocation: { deleteMany: jest.fn(), findUnique: jest.fn() },
    };
    service = new LocationService(prisma as unknown as PrismaService);
  });

  describe('updateMyLocation', () => {
    it('writes through raw SQL only, scoped to the caller, with a geohash', async () => {
      await service.updateMyLocation('u1', 19.1728, 72.9425);

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const values = prisma.$executeRaw.mock.calls[0].slice(1);
      // Tagged-template call: [stringsArray, ...interpolatedValues] —
      // userId and the 6-char geohash must both be among the values
      // actually bound into the query.
      expect(values).toContain('u1');
      expect(values.some((v: unknown) => typeof v === 'string' && /^[0-9a-z]{6}$/.test(v as string))).toBe(
        true,
      );
    });

    it('produces the same geohash for the same coordinates (deterministic)', async () => {
      await service.updateMyLocation('u1', 19.1728, 72.9425);
      const firstValues = prisma.$executeRaw.mock.calls[0].slice(1);
      prisma.$executeRaw.mockClear();

      await service.updateMyLocation('u2', 19.1728, 72.9425);
      const secondValues = prisma.$executeRaw.mock.calls[0].slice(1);

      const geohashOf = (values: unknown[]) =>
        values.find((v) => typeof v === 'string' && /^[0-9a-z]{6}$/.test(v as string));
      expect(geohashOf(firstValues)).toBe(geohashOf(secondValues));
    });
  });

  describe('clearMyLocation', () => {
    it('deletes only the caller\'s own row', async () => {
      await service.clearMyLocation('u1');
      expect(prisma.userLocation.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    });
  });

  describe('hasLocation', () => {
    it('returns true when a row exists', async () => {
      prisma.userLocation.findUnique.mockResolvedValue({ id: 'loc1' });
      await expect(service.hasLocation('u1')).resolves.toBe(true);
      expect(prisma.userLocation.findUnique).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        select: { id: true },
      });
    });

    it('returns false when no row exists', async () => {
      prisma.userLocation.findUnique.mockResolvedValue(null);
      await expect(service.hasLocation('u1')).resolves.toBe(false);
    });
  });
});
