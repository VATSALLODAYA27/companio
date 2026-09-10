import { Prisma } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConnectionsService } from './connections.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivitiesService } from '../activities/activities.service';
import { UsersService } from '../users/users.service';

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
  });
}

describe('ConnectionsService', () => {
  let prisma: {
    connectionRequest: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    connection: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
    };
    conversation: { upsert: jest.Mock; findMany: jest.Mock };
    block: { findFirst: jest.Mock };
    profile: { findMany: jest.Mock };
    verification: { findMany: jest.Mock };
    activity: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let activities: jest.Mocked<Pick<ActivitiesService, 'findIdsByKeys'>>;
  let users: jest.Mocked<Pick<UsersService, 'findActiveById'>>;
  let service: ConnectionsService;

  const REQUESTER = 'u-requester';
  const RECIPIENT = 'u-recipient';
  const ACTIVITY_ID = 'act-trekking';

  beforeEach(() => {
    prisma = {
      connectionRequest: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      connection: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      conversation: {
        upsert: jest.fn().mockResolvedValue({ id: 'conv-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      block: { findFirst: jest.fn().mockResolvedValue(null) },
      profile: { findMany: jest.fn().mockResolvedValue([]) },
      verification: { findMany: jest.fn().mockResolvedValue([]) },
      activity: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    activities = {
      findIdsByKeys: jest.fn().mockResolvedValue(new Map([['trekking', ACTIVITY_ID]])),
    };
    users = {
      findActiveById: jest.fn().mockResolvedValue({ id: RECIPIENT, status: 'ACTIVE' }),
    };

    service = new ConnectionsService(
      prisma as unknown as PrismaService,
      activities as unknown as ActivitiesService,
      users as unknown as UsersService,
    );
  });

  describe('sendRequest', () => {
    it('rejects sending a request to yourself', async () => {
      await expect(service.sendRequest(REQUESTER, REQUESTER, 'trekking')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.connectionRequest.create).not.toHaveBeenCalled();
    });

    it('rejects an activity key the DB has no id for (defensive)', async () => {
      activities.findIdsByKeys.mockResolvedValue(new Map());
      await expect(
        service.sendRequest(REQUESTER, RECIPIENT, 'trekking'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.connectionRequest.create).not.toHaveBeenCalled();
    });

    it('rejects with a generic message when the recipient does not exist', async () => {
      users.findActiveById.mockResolvedValue(null);
      await expect(
        service.sendRequest(REQUESTER, RECIPIENT, 'trekking'),
      ).rejects.toMatchObject({ message: 'Unable to send a connection request to this user' });
      expect(prisma.connectionRequest.create).not.toHaveBeenCalled();
    });

    it('rejects with the SAME generic message when the requester has blocked the recipient', async () => {
      prisma.block.findFirst.mockResolvedValue({ id: 'block-1' });
      await expect(
        service.sendRequest(REQUESTER, RECIPIENT, 'trekking'),
      ).rejects.toMatchObject({ message: 'Unable to send a connection request to this user' });
    });

    it('rejects with the SAME generic message when the recipient has blocked the requester', async () => {
      prisma.block.findFirst.mockImplementation(
        ({ where }: { where: { OR: Array<{ blockerId: string; blockedId: string }> } }) =>
          Promise.resolve(
            where.OR.some((c) => c.blockerId === RECIPIENT && c.blockedId === REQUESTER)
              ? { id: 'block-2' }
              : null,
          ),
      );
      await expect(
        service.sendRequest(REQUESTER, RECIPIENT, 'trekking'),
      ).rejects.toMatchObject({ message: 'Unable to send a connection request to this user' });
    });

    it('rejects when the pair is already connected for this activity (409)', async () => {
      prisma.connection.findFirst.mockResolvedValue({ id: 'conn-1' });
      await expect(
        service.sendRequest(REQUESTER, RECIPIENT, 'trekking'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.connectionRequest.create).not.toHaveBeenCalled();
    });

    it('creates a pending request and returns the public view', async () => {
      prisma.connectionRequest.create.mockResolvedValue({
        id: 'req-1',
        activityId: ACTIVITY_ID,
        status: 'PENDING',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        respondedAt: null,
        requesterId: REQUESTER,
        recipientId: RECIPIENT,
      });
      prisma.profile.findMany.mockResolvedValue([
        { userId: RECIPIENT, firstName: 'Bhavesh', photoUrl: null },
      ]);

      const result = await service.sendRequest(REQUESTER, RECIPIENT, 'trekking');

      expect(prisma.connectionRequest.create).toHaveBeenCalledWith({
        data: { requesterId: REQUESTER, recipientId: RECIPIENT, activityId: ACTIVITY_ID },
      });
      expect(result).toEqual({
        id: 'req-1',
        activityKey: 'trekking',
        status: 'PENDING',
        createdAt: '2026-01-01T00:00:00.000Z',
        respondedAt: null,
        otherUser: {
          userId: RECIPIENT,
          firstName: 'Bhavesh',
          photoUrl: null,
          verificationBadge: 'NONE',
        },
      });
    });

    it('translates a unique-constraint race into a clean 409, not a 500', async () => {
      prisma.connectionRequest.create.mockRejectedValue(p2002());
      await expect(
        service.sendRequest(REQUESTER, RECIPIENT, 'trekking'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows an unrelated database error unchanged', async () => {
      const boom = new Error('connection reset');
      prisma.connectionRequest.create.mockRejectedValue(boom);
      await expect(service.sendRequest(REQUESTER, RECIPIENT, 'trekking')).rejects.toBe(boom);
    });
  });

  describe('listIncoming / listOutgoing', () => {
    it('maps pending incoming requests to the requester-as-counterpart shape', async () => {
      prisma.connectionRequest.findMany.mockResolvedValue([
        {
          id: 'req-1',
          activityId: ACTIVITY_ID,
          status: 'PENDING',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          respondedAt: null,
          requesterId: REQUESTER,
          recipientId: RECIPIENT,
        },
      ]);
      prisma.activity.findMany.mockResolvedValue([{ id: ACTIVITY_ID, key: 'trekking' }]);
      prisma.profile.findMany.mockResolvedValue([
        { userId: REQUESTER, firstName: 'Ayesha', photoUrl: null },
      ]);

      const result = await service.listIncoming(RECIPIENT);

      expect(prisma.connectionRequest.findMany).toHaveBeenCalledWith({
        where: { recipientId: RECIPIENT, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([
        {
          id: 'req-1',
          activityKey: 'trekking',
          status: 'PENDING',
          createdAt: '2026-01-01T00:00:00.000Z',
          respondedAt: null,
          otherUser: {
            userId: REQUESTER,
            firstName: 'Ayesha',
            photoUrl: null,
            verificationBadge: 'NONE',
          },
        },
      ]);
    });

    it('queries outgoing requests scoped to the caller as requester', async () => {
      await service.listOutgoing(REQUESTER);
      expect(prisma.connectionRequest.findMany).toHaveBeenCalledWith({
        where: { requesterId: REQUESTER, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns [] without querying activities/profiles when there are no rows', async () => {
      prisma.connectionRequest.findMany.mockResolvedValue([]);
      const result = await service.listIncoming(RECIPIENT);
      expect(result).toEqual([]);
      expect(prisma.activity.findMany).not.toHaveBeenCalled();
      expect(prisma.profile.findMany).not.toHaveBeenCalled();
    });
  });

  describe('acceptRequest', () => {
    const pendingRequest = {
      id: 'req-1',
      activityId: ACTIVITY_ID,
      status: 'PENDING',
      requesterId: REQUESTER,
      recipientId: RECIPIENT,
      createdAt: new Date(),
      respondedAt: null,
    };

    it('rejects when the caller is not the recipient', async () => {
      prisma.connectionRequest.findUnique.mockResolvedValue(pendingRequest);
      await expect(service.acceptRequest('someone-else', 'req-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects when the request no longer exists', async () => {
      prisma.connectionRequest.findUnique.mockResolvedValue(null);
      await expect(service.acceptRequest(RECIPIENT, 'req-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects when the request is no longer pending', async () => {
      prisma.connectionRequest.findUnique.mockResolvedValue({
        ...pendingRequest,
        status: 'DECLINED',
      });
      await expect(service.acceptRequest(RECIPIENT, 'req-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('upserts the connection with userAId/userBId in sorted order, not requester/recipient order', async () => {
      prisma.connectionRequest.findUnique.mockResolvedValue(pendingRequest);
      prisma.connectionRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.connection.upsert.mockResolvedValue({ id: 'conn-1' });
      prisma.conversation.upsert.mockResolvedValue({ id: 'conv-1' });

      const result = await service.acceptRequest(RECIPIENT, 'req-1');

      const [userAId, userBId] = [REQUESTER, RECIPIENT].sort();
      expect(prisma.connection.upsert).toHaveBeenCalledWith({
        where: { userAId_userBId_activityId: { userAId, userBId, activityId: ACTIVITY_ID } },
        create: { userAId, userBId, activityId: ACTIVITY_ID },
        update: { removedAt: null },
      });
      expect(result).toEqual({ connectionId: 'conn-1', conversationId: 'conv-1' });
    });

    it('also upserts (not creates) the Conversation, so reviving an unmatched connection never double-creates one', async () => {
      prisma.connectionRequest.findUnique.mockResolvedValue(pendingRequest);
      prisma.connectionRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.connection.upsert.mockResolvedValue({ id: 'conn-1' });
      prisma.conversation.upsert.mockResolvedValue({ id: 'conv-1' });

      await service.acceptRequest(RECIPIENT, 'req-1');

      expect(prisma.conversation.upsert).toHaveBeenCalledWith({
        where: { connectionId: 'conn-1' },
        create: { connectionId: 'conn-1' },
        update: {},
      });
    });

    it('raises a conflict if the request was resolved concurrently inside the transaction', async () => {
      prisma.connectionRequest.findUnique.mockResolvedValue(pendingRequest);
      prisma.connectionRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.acceptRequest(RECIPIENT, 'req-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.connection.upsert).not.toHaveBeenCalled();
    });
  });

  describe('declineRequest', () => {
    it('rejects when the caller is not the recipient', async () => {
      prisma.connectionRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        requesterId: REQUESTER,
        recipientId: RECIPIENT,
      });
      await expect(service.declineRequest('someone-else', 'req-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('marks a pending request DECLINED', async () => {
      prisma.connectionRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        requesterId: REQUESTER,
        recipientId: RECIPIENT,
      });
      prisma.connectionRequest.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.declineRequest(RECIPIENT, 'req-1');

      expect(prisma.connectionRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: 'PENDING' },
        data: { status: 'DECLINED', respondedAt: expect.any(Date) },
      });
      expect(result).toEqual({ status: 'DECLINED' });
    });
  });

  describe('cancelRequest', () => {
    it('rejects when the caller is not the requester', async () => {
      prisma.connectionRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        requesterId: REQUESTER,
        recipientId: RECIPIENT,
      });
      await expect(service.cancelRequest('someone-else', 'req-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.connectionRequest.deleteMany).not.toHaveBeenCalled();
    });

    it('404s when the request does not exist', async () => {
      prisma.connectionRequest.findUnique.mockResolvedValue(null);
      await expect(service.cancelRequest(REQUESTER, 'req-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('hard-deletes a still-pending own request', async () => {
      prisma.connectionRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        requesterId: REQUESTER,
        recipientId: RECIPIENT,
      });
      prisma.connectionRequest.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.cancelRequest(REQUESTER, 'req-1');

      expect(prisma.connectionRequest.deleteMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: 'PENDING' },
      });
      expect(result).toEqual({ cancelled: true });
    });
  });

  describe('listConnections', () => {
    it('resolves the OTHER party regardless of which side (A or B) the caller is on', async () => {
      prisma.connection.findMany.mockResolvedValue([
        {
          id: 'conn-1',
          userAId: REQUESTER,
          userBId: RECIPIENT,
          activityId: ACTIVITY_ID,
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          removedAt: null,
        },
        {
          id: 'conn-2',
          userAId: 'other-caller',
          userBId: REQUESTER, // caller is userB here
          activityId: ACTIVITY_ID,
          createdAt: new Date('2026-01-03T00:00:00.000Z'),
          removedAt: null,
        },
      ]);
      prisma.activity.findMany.mockResolvedValue([{ id: ACTIVITY_ID, key: 'trekking' }]);
      prisma.profile.findMany.mockResolvedValue([
        { userId: RECIPIENT, firstName: 'Bhavesh', photoUrl: null },
        { userId: 'other-caller', firstName: 'Chetan', photoUrl: null },
      ]);
      prisma.conversation.findMany.mockResolvedValue([
        { id: 'conv-1', connectionId: 'conn-1' },
        { id: 'conv-2', connectionId: 'conn-2' },
      ]);

      const result = await service.listConnections(REQUESTER);

      expect(result.map((r) => r.otherUser.userId)).toEqual([RECIPIENT, 'other-caller']);
      expect(result.map((r) => r.conversationId)).toEqual(['conv-1', 'conv-2']);
      expect(prisma.connection.findMany).toHaveBeenCalledWith({
        where: { OR: [{ userAId: REQUESTER }, { userBId: REQUESTER }], removedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('skips a row whose conversation cannot be loaded rather than emitting a null conversationId', async () => {
      prisma.connection.findMany.mockResolvedValue([
        {
          id: 'conn-1',
          userAId: REQUESTER,
          userBId: RECIPIENT,
          activityId: ACTIVITY_ID,
          createdAt: new Date(),
          removedAt: null,
        },
      ]);
      prisma.activity.findMany.mockResolvedValue([{ id: ACTIVITY_ID, key: 'trekking' }]);
      prisma.profile.findMany.mockResolvedValue([
        { userId: RECIPIENT, firstName: 'Bhavesh', photoUrl: null },
      ]);
      prisma.conversation.findMany.mockResolvedValue([]); // no conversation row found

      const result = await service.listConnections(REQUESTER);
      expect(result).toEqual([]);
    });

    it('skips a row whose other-party profile cannot be loaded rather than throwing', async () => {
      prisma.connection.findMany.mockResolvedValue([
        {
          id: 'conn-1',
          userAId: REQUESTER,
          userBId: RECIPIENT,
          activityId: ACTIVITY_ID,
          createdAt: new Date(),
          removedAt: null,
        },
      ]);
      prisma.activity.findMany.mockResolvedValue([{ id: ACTIVITY_ID, key: 'trekking' }]);
      prisma.profile.findMany.mockResolvedValue([]); // recipient has no profile row
      prisma.conversation.findMany.mockResolvedValue([{ id: 'conv-1', connectionId: 'conn-1' }]);

      const result = await service.listConnections(REQUESTER);
      expect(result).toEqual([]);
    });
  });

  describe('removeConnection', () => {
    it('rejects when the caller is not a participant', async () => {
      prisma.connection.findUnique.mockResolvedValue({
        id: 'conn-1',
        userAId: REQUESTER,
        userBId: RECIPIENT,
        removedAt: null,
      });
      await expect(service.removeConnection('someone-else', 'conn-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.connection.update).not.toHaveBeenCalled();
    });

    it('404s when the connection does not exist or was already removed', async () => {
      prisma.connection.findUnique.mockResolvedValue(null);
      await expect(service.removeConnection(REQUESTER, 'conn-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.connection.findUnique.mockResolvedValue({
        id: 'conn-1',
        userAId: REQUESTER,
        userBId: RECIPIENT,
        removedAt: new Date(),
      });
      await expect(service.removeConnection(REQUESTER, 'conn-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('soft-deletes (sets removedAt) for either participant', async () => {
      prisma.connection.findUnique.mockResolvedValue({
        id: 'conn-1',
        userAId: REQUESTER,
        userBId: RECIPIENT,
        removedAt: null,
      });

      const result = await service.removeConnection(RECIPIENT, 'conn-1');

      expect(prisma.connection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: { removedAt: expect.any(Date) },
      });
      expect(result).toEqual({ removed: true });
    });
  });
});
