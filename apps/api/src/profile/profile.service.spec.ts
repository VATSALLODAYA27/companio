import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivitiesService } from '../activities/activities.service';
import { VerificationsService } from '../identity-verification/verifications.service';

describe('ProfileService', () => {
  let prisma: {
    profile: { findUnique: jest.Mock; upsert: jest.Mock };
    userActivity: { findMany: jest.Mock; deleteMany: jest.Mock; upsert: jest.Mock };
    $transaction: jest.Mock;
  };
  let activities: jest.Mocked<Pick<ActivitiesService, 'findIdsByKeys'>>;
  let verifications: jest.Mocked<Pick<VerificationsService, 'getBadge'>>;
  let service: ProfileService;

  const fakeProfileRow = {
    firstName: 'Nia',
    photoUrl: null,
    ageRange: null,
    bio: null,
    city: null,
    languages: [],
    discoverable: true,
    hidden: false,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    prisma = {
      profile: { findUnique: jest.fn(), upsert: jest.fn() },
      userActivity: { findMany: jest.fn(), deleteMany: jest.fn(), upsert: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    activities = { findIdsByKeys: jest.fn() } as unknown as jest.Mocked<ActivitiesService>;
    verifications = { getBadge: jest.fn().mockResolvedValue('NONE') } as unknown as jest.Mocked<
      Pick<VerificationsService, 'getBadge'>
    >;

    service = new ProfileService(
      prisma as unknown as PrismaService,
      activities as unknown as ActivitiesService,
      verifications as unknown as VerificationsService,
    );
  });

  describe('getMyProfile', () => {
    it('throws NotFoundException when no profile row exists yet', async () => {
      prisma.profile.findUnique.mockResolvedValue(null);
      await expect(service.getMyProfile('u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('scopes the lookup to the caller and returns an explicit shape with the badge', async () => {
      prisma.profile.findUnique.mockResolvedValue(fakeProfileRow);
      verifications.getBadge.mockResolvedValue('GOOGLE_VERIFIED');

      const result = await service.getMyProfile('u1');

      expect(prisma.profile.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(verifications.getBadge).toHaveBeenCalledWith('u1');
      expect(result).toEqual({
        firstName: 'Nia',
        photoUrl: null,
        ageRange: null,
        bio: null,
        city: null,
        languages: [],
        discoverable: true,
        hidden: false,
        verificationBadge: 'GOOGLE_VERIFIED',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      // Never a raw Prisma row leaking extra/internal fields.
      expect(Object.keys(result)).not.toContain('id');
      expect(Object.keys(result)).not.toContain('userId');
    });
  });

  describe('upsertMyProfile', () => {
    it('upserts scoped to the caller, defaulting optional fields', async () => {
      prisma.profile.upsert.mockResolvedValue(fakeProfileRow);

      await service.upsertMyProfile('u1', { firstName: 'Nia' });

      expect(prisma.profile.upsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        create: {
          userId: 'u1',
          firstName: 'Nia',
          photoUrl: null,
          ageRange: null,
          bio: null,
          city: null,
          languages: [],
        },
        update: {
          firstName: 'Nia',
          photoUrl: null,
          ageRange: null,
          bio: null,
          city: null,
          languages: [],
        },
      });
    });

    it('only touches discoverable/hidden when explicitly provided', async () => {
      prisma.profile.upsert.mockResolvedValue(fakeProfileRow);

      await service.upsertMyProfile('u1', { firstName: 'Nia', hidden: true });

      const call = prisma.profile.upsert.mock.calls[0][0];
      expect(call.update.hidden).toBe(true);
      expect(call.update.discoverable).toBeUndefined();
    });
  });

  describe('setMyActivities', () => {
    it('rejects duplicate activity keys without writing anything', async () => {
      await expect(
        service.setMyActivities('u1', [
          { activityKey: 'gym', availability: 'NOW' },
          { activityKey: 'gym', availability: 'TODAY' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects unknown activity keys defensively', async () => {
      activities.findIdsByKeys.mockResolvedValue(new Map());
      await expect(
        service.setMyActivities('u1', [{ activityKey: 'gym', availability: 'NOW' }]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('replaces the set in one transaction, scoped to the caller', async () => {
      activities.findIdsByKeys.mockResolvedValue(
        new Map([
          ['gym', 'act-gym'],
          ['running', 'act-run'],
        ]),
      );
      prisma.userActivity.findMany.mockResolvedValue([]);

      await service.setMyActivities('u1', [
        { activityKey: 'gym', availability: 'NOW' },
        { activityKey: 'running', availability: 'WEEKEND' },
      ]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.userActivity.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', activityId: { notIn: ['act-gym', 'act-run'] } },
      });
      expect(prisma.userActivity.upsert).toHaveBeenCalledWith({
        where: { userId_activityId: { userId: 'u1', activityId: 'act-gym' } },
        create: { userId: 'u1', activityId: 'act-gym', availability: 'NOW' },
        update: { availability: 'NOW' },
      });
      expect(prisma.userActivity.upsert).toHaveBeenCalledWith({
        where: { userId_activityId: { userId: 'u1', activityId: 'act-run' } },
        create: { userId: 'u1', activityId: 'act-run', availability: 'WEEKEND' },
        update: { availability: 'WEEKEND' },
      });
    });
  });

  describe('getMyActivities', () => {
    it('scopes to the caller and maps to a flat shape', async () => {
      prisma.userActivity.findMany.mockResolvedValue([
        { availability: 'NOW', activity: { key: 'gym', label: 'Gym' } },
      ]);

      const result = await service.getMyActivities('u1');

      expect(prisma.userActivity.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        include: { activity: { select: { key: true, label: true } } },
        orderBy: { activity: { label: 'asc' } },
      });
      expect(result).toEqual([{ activityKey: 'gym', label: 'Gym', availability: 'NOW' }]);
    });
  });
});
