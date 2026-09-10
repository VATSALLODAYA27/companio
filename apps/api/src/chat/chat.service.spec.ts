import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../common/events/domain-events.service';

describe('ChatService', () => {
  let prisma: {
    conversation: { findUnique: jest.Mock };
    message: { findMany: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
  };
  let events: jest.Mocked<Pick<DomainEventsService, 'publishMessageSent'>>;
  let service: ChatService;

  const USER_A = 'u-a';
  const USER_B = 'u-b';
  const OUTSIDER = 'u-outsider';
  const CONVERSATION_ID = 'conv-1';
  const CONNECTION_ID = 'conn-1';

  const activeConnection = (removedAt: Date | null = null) => ({
    id: CONNECTION_ID,
    userAId: USER_A,
    userBId: USER_B,
    removedAt,
  });

  beforeEach(() => {
    prisma = {
      conversation: { findUnique: jest.fn() },
      message: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), updateMany: jest.fn() },
    };
    events = { publishMessageSent: jest.fn() };
    service = new ChatService(prisma as unknown as PrismaService, events as unknown as DomainEventsService);
  });

  describe('listMessages', () => {
    it('404s when the conversation does not exist', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);
      await expect(
        service.listMessages(USER_A, CONVERSATION_ID, undefined, undefined),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('403s when the caller is not a participant', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ connection: activeConnection() });
      await expect(
        service.listMessages(OUTSIDER, CONVERSATION_ID, undefined, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows reading history even after the connection has ended', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        connection: activeConnection(new Date()),
      });
      await expect(
        service.listMessages(USER_A, CONVERSATION_ID, undefined, undefined),
      ).resolves.toEqual([]);
    });

    it('returns the fetched page reversed to oldest-first, mapped to the public shape', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ connection: activeConnection() });
      prisma.message.findMany.mockResolvedValue([
        {
          id: 'm2',
          conversationId: CONVERSATION_ID,
          senderId: USER_B,
          body: 'second',
          sentAt: new Date('2026-01-01T00:01:00.000Z'),
          readAt: null,
        },
        {
          id: 'm1',
          conversationId: CONVERSATION_ID,
          senderId: USER_A,
          body: 'first',
          sentAt: new Date('2026-01-01T00:00:00.000Z'),
          readAt: new Date('2026-01-01T00:05:00.000Z'),
        },
      ]);

      const result = await service.listMessages(USER_A, CONVERSATION_ID, undefined, undefined);

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: CONVERSATION_ID },
        orderBy: { sentAt: 'desc' },
        take: 50,
      });
      expect(result.map((m) => m.id)).toEqual(['m1', 'm2']);
      expect(result[0]).toEqual({
        id: 'm1',
        conversationId: CONVERSATION_ID,
        senderId: USER_A,
        body: 'first',
        sentAt: '2026-01-01T00:00:00.000Z',
        readAt: '2026-01-01T00:05:00.000Z',
      });
    });

    it('passes a before cursor through as a strict sentAt < filter', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ connection: activeConnection() });
      await service.listMessages(USER_A, CONVERSATION_ID, '2026-01-01T00:00:00.000Z', 10);
      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: CONVERSATION_ID, sentAt: { lt: new Date('2026-01-01T00:00:00.000Z') } },
        orderBy: { sentAt: 'desc' },
        take: 10,
      });
    });

    it('caps an oversized limit at 100', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ connection: activeConnection() });
      await service.listMessages(USER_A, CONVERSATION_ID, undefined, 500);
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('sendMessage', () => {
    it('403s when the caller is not a participant', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ connection: activeConnection() });
      await expect(
        service.sendMessage(OUTSIDER, CONVERSATION_ID, 'hi'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('rejects sending once the connection has ended', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        connection: activeConnection(new Date()),
      });
      await expect(
        service.sendMessage(USER_A, CONVERSATION_ID, 'hi'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('persists the message, scoped to the caller as sender, and publishes a domain event', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ connection: activeConnection() });
      prisma.message.create.mockResolvedValue({
        id: 'm1',
        conversationId: CONVERSATION_ID,
        senderId: USER_A,
        body: 'hello',
        sentAt: new Date('2026-01-01T00:00:00.000Z'),
        readAt: null,
      });

      const result = await service.sendMessage(USER_A, CONVERSATION_ID, 'hello');

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: { conversationId: CONVERSATION_ID, senderId: USER_A, body: 'hello' },
      });
      expect(result).toEqual({
        id: 'm1',
        conversationId: CONVERSATION_ID,
        senderId: USER_A,
        body: 'hello',
        sentAt: '2026-01-01T00:00:00.000Z',
        readAt: null,
      });
      expect(events.publishMessageSent).toHaveBeenCalledWith({
        conversationId: CONVERSATION_ID,
        message: result,
      });
    });
  });

  describe('markRead', () => {
    it('403s when the caller is not a participant', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ connection: activeConnection() });
      await expect(service.markRead(OUTSIDER, CONVERSATION_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('marks only messages from the OTHER participant, never the caller\'s own, as read', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ connection: activeConnection() });
      prisma.message.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markRead(USER_A, CONVERSATION_ID);

      expect(prisma.message.updateMany).toHaveBeenCalledWith({
        where: { conversationId: CONVERSATION_ID, senderId: { not: USER_A }, readAt: null },
        data: { readAt: expect.any(Date) },
      });
      expect(result).toEqual({ updated: 3 });
    });

    it('is allowed even after the connection has ended', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        connection: activeConnection(new Date()),
      });
      prisma.message.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.markRead(USER_A, CONVERSATION_ID)).resolves.toEqual({ updated: 0 });
    });
  });

  describe('isParticipant', () => {
    it('returns false when the conversation does not exist', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);
      await expect(service.isParticipant(USER_A, CONVERSATION_ID)).resolves.toBe(false);
    });

    it('returns true for either participant and false for an outsider', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ connection: activeConnection() });
      await expect(service.isParticipant(USER_A, CONVERSATION_ID)).resolves.toBe(true);
      await expect(service.isParticipant(USER_B, CONVERSATION_ID)).resolves.toBe(true);
      await expect(service.isParticipant(OUTSIDER, CONVERSATION_ID)).resolves.toBe(false);
    });
  });
});
