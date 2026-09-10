import { VerificationsService } from './verifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('VerificationsService', () => {
  let prisma: {
    verification: { create: jest.Mock; findFirst: jest.Mock };
  };
  let service: VerificationsService;

  beforeEach(() => {
    prisma = {
      verification: { create: jest.fn(), findFirst: jest.fn() },
    };
    service = new VerificationsService(prisma as unknown as PrismaService);
  });

  describe('recordGoogleVerification', () => {
    it('persists only provider/status/verifiedAt — never a raw payload from the provider', () => {
      const verifiedAt = new Date('2026-01-01T00:00:00.000Z');
      service.recordGoogleVerification('u1', { status: 'VERIFIED', verifiedAt });
      expect(prisma.verification.create).toHaveBeenCalledWith({
        data: { userId: 'u1', provider: 'GOOGLE', status: 'VERIFIED', verifiedAt },
      });
    });

    it('records a FAILED result too (verifiedAt undefined), not just successes', () => {
      service.recordGoogleVerification('u1', { status: 'FAILED' });
      expect(prisma.verification.create).toHaveBeenCalledWith({
        data: { userId: 'u1', provider: 'GOOGLE', status: 'FAILED', verifiedAt: undefined },
      });
    });
  });

  describe('getBadge', () => {
    it('returns GOOGLE_VERIFIED when a VERIFIED verification row exists for this user', async () => {
      prisma.verification.findFirst.mockResolvedValue({ id: 'v1', status: 'VERIFIED' });
      const badge = await service.getBadge('u1');
      expect(badge).toBe('GOOGLE_VERIFIED');
      expect(prisma.verification.findFirst).toHaveBeenCalledWith({
        where: { userId: 'u1', status: 'VERIFIED' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns NONE when there is no VERIFIED row (never seen, or only FAILED/PENDING/EXPIRED rows)', async () => {
      prisma.verification.findFirst.mockResolvedValue(null);
      const badge = await service.getBadge('u1');
      expect(badge).toBe('NONE');
    });

    it('never returns the raw provider/status row itself — only the two-value badge', async () => {
      prisma.verification.findFirst.mockResolvedValue({
        id: 'v1',
        userId: 'u1',
        provider: 'GOOGLE',
        status: 'VERIFIED',
        verifiedAt: new Date(),
      });
      const badge = await service.getBadge('u1');
      expect(badge).toBe('GOOGLE_VERIFIED');
      expect(typeof badge).toBe('string');
    });
  });
});
