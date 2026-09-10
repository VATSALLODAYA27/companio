import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageView } from '@companio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../common/events/domain-events.service';

export const DEFAULT_MESSAGE_PAGE_SIZE = 50;

interface MessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  sentAt: Date;
  readAt: Date | null;
}

/**
 * Chat (Phase 6) — every method re-derives membership from the
 * `Connection` behind the `Conversation`, on every call, exactly as
 * SECURITY.md §3 describes: "reading /conversations/:id/messages checks
 * that the requesting user is one of the two participants in the
 * Connection behind that Conversation, every time." There is no route
 * or method here that trusts a client-supplied participant identity.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
  ) {}

  /**
   * Loads the conversation and confirms the caller is a participant in
   * the connection behind it. Read access (list/markRead) is allowed
   * even after the connection has ended (removedAt set) — unmatching
   * doesn't erase history for either side, see SECURITY.md §10 — but
   * the caller only finds that out by checking the returned
   * `connectionRemovedAt` themselves (sendMessage does, below).
   */
  private async assertParticipant(
    userId: string,
    conversationId: string,
  ): Promise<{ connectionId: string; connectionRemovedAt: Date | null }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        connection: { select: { id: true, userAId: true, userBId: true, removedAt: true } },
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    const { connection } = conversation;
    if (connection.userAId !== userId && connection.userBId !== userId) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }
    return { connectionId: connection.id, connectionRemovedAt: connection.removedAt };
  }

  async listMessages(
    userId: string,
    conversationId: string,
    before: string | undefined,
    limit: number | undefined,
  ): Promise<MessageView[]> {
    await this.assertParticipant(userId, conversationId);

    const pageSize = Math.min(limit ?? DEFAULT_MESSAGE_PAGE_SIZE, 100);
    const rows: MessageRow[] = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(before ? { sentAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { sentAt: 'desc' },
      take: pageSize,
    });

    // Fetched newest-first for the LIMIT to apply to the most recent
    // page; returned oldest-first, the order a chat thread reads in.
    return rows.reverse().map(toMessageView);
  }

  async sendMessage(userId: string, conversationId: string, body: string): Promise<MessageView> {
    const { connectionRemovedAt } = await this.assertParticipant(userId, conversationId);
    if (connectionRemovedAt) {
      throw new BadRequestException(
        'This connection has ended — you can no longer send messages here',
      );
    }

    const message: MessageRow = await this.prisma.message.create({
      data: { conversationId, senderId: userId, body },
    });

    const view = toMessageView(message);
    this.events.publishMessageSent({ conversationId, message: view });
    return view;
  }

  async markRead(userId: string, conversationId: string): Promise<{ updated: number }> {
    await this.assertParticipant(userId, conversationId);
    const result = await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  /**
   * Used only by ChatGateway (see chat.gateway.ts) to authorize a
   * socket joining a conversation's room — same participant check as
   * every REST route, just without the HTTP-flavored exceptions the
   * gateway can't use directly.
   */
  async isParticipant(userId: string, conversationId: string): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { connection: { select: { userAId: true, userBId: true } } },
    });
    if (!conversation) {
      return false;
    }
    return (
      conversation.connection.userAId === userId || conversation.connection.userBId === userId
    );
  }
}

function toMessageView(row: MessageRow): MessageView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    body: row.body,
    sentAt: row.sentAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}
