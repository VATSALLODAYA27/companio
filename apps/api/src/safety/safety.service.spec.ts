import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SafetyService } from './safety.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

describe('SafetyService', () => {
  let prisma: {
    $transaction: jest.Mock;
    block: { create: jest.Mock; deleteMany: jest.Mock; findMany: jest.Mock };
    connection: { updateMany: jest.Mock };
    connectionRequest: { updateMany: jest.Mock };
    profile: { findMany: jest.Mock };
    report: { create: jest.Mock; findMany: jest.Mock };
  };
  let users: jest.Mocked<Pick<UsersService, 'findById'>>;
  let service: SafetyService;

  const USER_A = 'user-a';
  const USER_B = 'user-b';

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn().mockResolvedValue(undefined),
      block: {
        create: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      connection: { updateMany: jest.fn() },
      connectionRequest: { updateMany: jest.fn() },
      profile: { findMany: jest.fn().mockResolvedValue([]) },
      report: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    users = { findById: jest.fn().mockResolvedValue({ id: USER_B, status: 'ACTIVE' }) };
    service = new SafetyService(prisma as unknown as PrismaService, users as unknown as UsersService);
  });

  describe('createBlock', () => {
    it('rejects blocking yourself', async () => {
      await expect(service.createBlock(USER_A, USER_A)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('404s when the target user does not exist', async () => {
      users.findById.mockResolvedValue(null);
      await expect(service.createBlock(USER_A, USER_B)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates the block and ends any active connection + declines pending requests, in one transaction', async () => {
      await service.createBlock(USER_A, USER_B);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = prisma.$transaction.mock.calls[0][0];
      expect(ops).toHaveLength(3);

      expect(prisma.block.create).toHaveBeenCalledWith({
        data: { blockerId: USER_A, blockedId: USER_B },
      });

      const [sortedA, sortedB] = [USER_A, USER_B].sort();
      expect(prisma.connection.updateMany).toHaveBeenCalledWith({
        where: { userAId: sortedA, userBId: sortedB, removedAt: null },
        data: { removedAt: expect.any(Date) },
      });

      expect(prisma.connectionRequest.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          OR: [
            { requesterId: USER_A, recipientId: USER_B },
            { requesterId: USER_B, recipientId: USER_A },
          ],
        },
        data: { status: 'DECLINED', respondedAt: expect.any(Date) },
      });
    });

    it('turns a duplicate-block unique-constraint violation into a 409, not a 500', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      });
      prisma.$transaction.mockRejectedValue(p2002);

      await expect(service.createBlock(USER_A, USER_B)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rethrows an unrelated database error', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection reset'));
      await expect(service.createBlock(USER_A, USER_B)).rejects.toThrow('connection reset');
    });
  });

  describe('removeBlock', () => {
    it('404s when no such block exists for the caller', async () => {
      prisma.block.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.removeBlock(USER_A, USER_B)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes only the caller-as-blocker row', async () => {
      const result = await service.removeBlock(USER_A, USER_B);
      expect(prisma.block.deleteMany).toHaveBeenCalledWith({
        where: { blockerId: USER_A, blockedId: USER_B },
      });
      expect(result).toEqual({ unblocked: true });
    });
  });

  describe('listBlocks', () => {
    it('returns an empty list without querying profiles when there are no blocks', async () => {
      const result = await service.listBlocks(USER_A);
      expect(result).toEqual([]);
      expect(prisma.profile.findMany).not.toHaveBeenCalled();
    });

    it('maps blocked users to the public shape, tolerating a missing profile', async () => {
      prisma.block.findMany.mockResolvedValue([
        { id: 'b1', blockerId: USER_A, blockedId: 'u2', createdAt: new Date('2026-01-01T00:00:00.000Z') },
        { id: 'b2', blockerId: USER_A, blockedId: 'u3', createdAt: new Date('2026-01-02T00:00:00.000Z') },
      ]);
      prisma.profile.findMany.mockResolvedValue([
        { userId: 'u2', firstName: 'Riya', photoUrl: null },
      ]);

      const result = await service.listBlocks(USER_A);

      expect(result).toEqual([
        { userId: 'u2', firstName: 'Riya', photoUrl: null, blockedAt: '2026-01-01T00:00:00.000Z' },
        { userId: 'u3', firstName: null, photoUrl: null, blockedAt: '2026-01-02T00:00:00.000Z' },
      ]);
    });
  });

  describe('createReport', () => {
    it('rejects reporting yourself', async () => {
      await expect(
        service.createReport(USER_A, USER_A, 'HARASSMENT', undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.report.create).not.toHaveBeenCalled();
    });

    it('404s when the reported user does not exist', async () => {
      users.findById.mockResolvedValue(null);
      await expect(
        service.createReport(USER_A, USER_B, 'HARASSMENT', undefined),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.report.create).not.toHaveBeenCalled();
    });

    it('creates the report scoped to the caller as reporter and maps the response', async () => {
      prisma.report.create.mockResolvedValue({
        id: 'r1',
        reporterId: USER_A,
        reportedId: USER_B,
        category: 'SPAM',
        details: 'kept sending links',
        status: 'OPEN',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await service.createReport(USER_A, USER_B, 'SPAM', 'kept sending links');

      expect(prisma.report.create).toHaveBeenCalledWith({
        data: { reporterId: USER_A, reportedId: USER_B, category: 'SPAM', details: 'kept sending links' },
      });
      expect(result).toEqual({
        id: 'r1',
        reportedUserId: USER_B,
        category: 'SPAM',
        details: 'kept sending links',
        status: 'OPEN',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('stores a null details when omitted', async () => {
      prisma.report.create.mockResolvedValue({
        id: 'r1',
        reporterId: USER_A,
        reportedId: USER_B,
        category: 'OTHER',
        details: null,
        status: 'OPEN',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await service.createReport(USER_A, USER_B, 'OTHER', undefined);

      expect(prisma.report.create).toHaveBeenCalledWith({
        data: { reporterId: USER_A, reportedId: USER_B, category: 'OTHER', details: null },
      });
    });
  });

  describe('listMyReports', () => {
    it('scopes to reports filed BY the caller, never reports filed against them', async () => {
      await service.listMyReports(USER_A);
      expect(prisma.report.findMany).toHaveBeenCalledWith({
        where: { reporterId: USER_A },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
