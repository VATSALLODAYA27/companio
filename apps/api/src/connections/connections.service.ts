import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityKey,
  ConnectionCounterpart,
  ConnectionRequestStatus,
  ConnectionRequestView,
  ConnectionView,
} from '@companio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ActivitiesService } from '../activities/activities.service';
import { UsersService } from '../users/users.service';

interface RequestRow {
  id: string;
  activityId: string;
  status: string;
  createdAt: Date;
  respondedAt: Date | null;
  requesterId: string;
  recipientId: string;
}

/**
 * Connection requests + connections (Phase 5). Every method takes the
 * caller's userId from the session (never a request parameter) and
 * checks it against actual row ownership/membership before acting —
 * see SECURITY.md §3. `recipientId`/other-party ids ARE client-supplied
 * (they come from a discovery result or a request/connection the caller
 * can already see), but every write is additionally scoped by who the
 * session says the caller is.
 */
@Injectable()
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: ActivitiesService,
    private readonly users: UsersService,
  ) {}

  async sendRequest(requesterId: string, recipientId: string, activityKey: ActivityKey) {
    if (requesterId === recipientId) {
      throw new BadRequestException('You cannot send a connection request to yourself');
    }

    const activityId = await this.resolveActivityId(activityKey);

    // One generic error whether the recipient doesn't exist, isn't
    // ACTIVE, or a block exists in either direction — same principle as
    // AuthService's login error (see auth.service.ts): never give a
    // requester a way to distinguish "no such user" from "that person
    // blocked you" from "that account was suspended".
    const eligible = await this.isEligibleRecipient(requesterId, recipientId);
    if (!eligible) {
      throw new BadRequestException('Unable to send a connection request to this user');
    }

    if (await this.hasActiveConnection(requesterId, recipientId, activityId)) {
      throw new ConflictException('You are already connected with this user for this activity');
    }

    try {
      const request = await this.prisma.connectionRequest.create({
        data: { requesterId, recipientId, activityId },
      });
      return this.toRequestView(request as RequestRow, activityKey, recipientId);
    } catch (err) {
      // The partial unique index (requesterId, recipientId, activityId)
      // WHERE status = 'PENDING' — see prisma/schema.prisma and
      // DATABASE.md — is the actual source of truth; this turns a race
      // (two near-simultaneous identical requests) into a clean 409
      // instead of a raw 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'You already have a pending request to this user for this activity',
        );
      }
      throw err;
    }
  }

  async listIncoming(userId: string): Promise<ConnectionRequestView[]> {
    const rows: RequestRow[] = await this.prisma.connectionRequest.findMany({
      where: { recipientId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return this.toRequestViews(rows, 'requesterId');
  }

  async listOutgoing(userId: string): Promise<ConnectionRequestView[]> {
    const rows: RequestRow[] = await this.prisma.connectionRequest.findMany({
      where: { requesterId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return this.toRequestViews(rows, 'recipientId');
  }

  async acceptRequest(
    recipientId: string,
    requestId: string,
  ): Promise<{ connectionId: string; conversationId: string }> {
    const request = await this.loadRequestForRecipient(recipientId, requestId);

    const [userAId, userBId] = [request.requesterId, request.recipientId].sort();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.connectionRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });
      if (updated.count === 0) {
        // Someone else (a concurrent accept/decline, or expiry) resolved
        // it between the load above and this write.
        throw new ConflictException('This request is no longer pending');
      }

      // upsert, not create: if this pair previously connected for this
      // activity and then unmatched (Connection.removedAt set), the
      // unique constraint on (userAId, userBId, activityId) means the
      // row already exists — reviving it is the correct behavior for
      // "we unmatched, then one of us asked again and the other said
      // yes", not a conflict.
      const connection = await tx.connection.upsert({
        where: {
          userAId_userBId_activityId: { userAId, userBId, activityId: request.activityId },
        },
        create: { userAId, userBId, activityId: request.activityId },
        update: { removedAt: null },
      });

      // Every Connection has exactly one Conversation (see DATABASE.md
      // ERD) — created here, once, rather than lazily on first message,
      // so Phase 6 (chat) never has to special-case "no conversation
      // yet" and every connections-list response can always include a
      // usable conversationId. Upsert because reviving a previously
      // unmatched connection (above) must not try to create a second
      // Conversation row for the same connectionId (unique constraint).
      const conversation = await tx.conversation.upsert({
        where: { connectionId: connection.id },
        create: { connectionId: connection.id },
        update: {},
      });

      return { connectionId: connection.id, conversationId: conversation.id };
    });
  }

  async declineRequest(recipientId: string, requestId: string): Promise<{ status: 'DECLINED' }> {
    await this.loadRequestForRecipient(recipientId, requestId);
    const updated = await this.prisma.connectionRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ConflictException('This request is no longer pending');
    }
    return { status: 'DECLINED' };
  }

  async cancelRequest(requesterId: string, requestId: string): Promise<{ cancelled: true }> {
    const request = await this.prisma.connectionRequest.findUnique({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException('Connection request not found');
    }
    if (request.requesterId !== requesterId) {
      throw new ForbiddenException('You cannot cancel a request you did not send');
    }
    // A still-pending, self-initiated, not-yet-responded-to request has
    // no retention requirement (unlike reports/blocks/messages — see
    // SECURITY.md §10) so cancellation is a hard delete, not a status
    // change; this also frees the pending-uniqueness slot immediately.
    const deleted = await this.prisma.connectionRequest.deleteMany({
      where: { id: requestId, status: 'PENDING' },
    });
    if (deleted.count === 0) {
      throw new ConflictException('This request is no longer pending');
    }
    return { cancelled: true };
  }

  async listConnections(userId: string): Promise<ConnectionView[]> {
    const rows = await this.prisma.connection.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }], removedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (rows.length === 0) {
      return [];
    }

    const activityKeyById = await this.activityKeysById(rows.map((r) => r.activityId));
    const otherIds = rows.map((r) => (r.userAId === userId ? r.userBId : r.userAId));
    const counterparts = await this.loadCounterparts(otherIds);
    const conversationIdByConnectionId = await this.conversationIdsByConnectionId(
      rows.map((r) => r.id),
    );

    return rows
      .map((r) => {
        const otherUserId = r.userAId === userId ? r.userBId : r.userAId;
        const otherUser = counterparts.get(otherUserId);
        const conversationId = conversationIdByConnectionId.get(r.id);
        // Defensive: both the other user's profile and the conversation
        // are guaranteed to exist in the normal flow (acceptRequest
        // always creates both), but a missing one shouldn't crash the
        // whole list — skip that row rather than 500 or emit a null id.
        if (!otherUser || !conversationId) {
          return null;
        }
        return {
          id: r.id,
          activityKey: activityKeyById.get(r.activityId)!,
          createdAt: r.createdAt.toISOString(),
          conversationId,
          otherUser,
        };
      })
      .filter((v): v is ConnectionView => v !== null);
  }

  async removeConnection(userId: string, connectionId: string): Promise<{ removed: true }> {
    const connection = await this.prisma.connection.findUnique({ where: { id: connectionId } });
    if (!connection || connection.removedAt) {
      throw new NotFoundException('Connection not found');
    }
    if (connection.userAId !== userId && connection.userBId !== userId) {
      throw new ForbiddenException('You are not a participant in this connection');
    }
    await this.prisma.connection.update({
      where: { id: connectionId },
      data: { removedAt: new Date() },
    });
    return { removed: true };
  }

  // ── helpers ────────────────────────────────────────────────────────

  private async resolveActivityId(activityKey: ActivityKey): Promise<string> {
    const idsByKey = await this.activities.findIdsByKeys([activityKey]);
    const activityId = idsByKey.get(activityKey);
    if (!activityId) {
      // Defensive only — the DTO's @IsIn already restricts activityKey
      // to the fixed set; this would mean the DB wasn't seeded.
      throw new BadRequestException(`Unknown activity key: ${activityKey}`);
    }
    return activityId;
  }

  private async isEligibleRecipient(requesterId: string, recipientId: string): Promise<boolean> {
    const recipient = await this.users.findActiveById(recipientId);
    if (!recipient) {
      return false;
    }
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: requesterId, blockedId: recipientId },
          { blockerId: recipientId, blockedId: requesterId },
        ],
      },
      select: { id: true },
    });
    return !block;
  }

  private async hasActiveConnection(
    userA: string,
    userB: string,
    activityId: string,
  ): Promise<boolean> {
    const [userAId, userBId] = [userA, userB].sort();
    const connection = await this.prisma.connection.findFirst({
      where: { userAId, userBId, activityId, removedAt: null },
      select: { id: true },
    });
    return !!connection;
  }

  private async loadRequestForRecipient(recipientId: string, requestId: string) {
    const request = await this.prisma.connectionRequest.findUnique({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException('Connection request not found');
    }
    if (request.recipientId !== recipientId) {
      throw new ForbiddenException('This request was not sent to you');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException('This request is no longer pending');
    }
    return request;
  }

  private async activityKeysById(activityIds: string[]): Promise<Map<string, ActivityKey>> {
    const unique = [...new Set(activityIds)];
    const rows: Array<{ id: string; key: string }> = await this.prisma.activity.findMany({
      where: { id: { in: unique } },
      select: { id: true, key: true },
    });
    return new Map(rows.map((r) => [r.id, r.key as ActivityKey]));
  }

  private async conversationIdsByConnectionId(
    connectionIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(connectionIds)];
    if (unique.length === 0) {
      return new Map();
    }
    const rows: Array<{ id: string; connectionId: string }> =
      await this.prisma.conversation.findMany({
        where: { connectionId: { in: unique } },
        select: { id: true, connectionId: true },
      });
    return new Map(rows.map((r) => [r.connectionId, r.id]));
  }

  /** Bulk-loads the public counterpart shape for a set of user ids in two queries, not N+1. */
  private async loadCounterparts(userIds: string[]): Promise<Map<string, ConnectionCounterpart>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) {
      return new Map();
    }
    const [profiles, verifiedRows] = await Promise.all([
      this.prisma.profile.findMany({
        where: { userId: { in: unique } },
        select: { userId: true, firstName: true, photoUrl: true },
      }),
      this.prisma.verification.findMany({
        where: { userId: { in: unique }, status: 'VERIFIED' },
        select: { userId: true },
      }),
    ]);
    const verifiedIds = new Set(verifiedRows.map((v: { userId: string }) => v.userId));
    return new Map(
      profiles.map((p: { userId: string; firstName: string; photoUrl: string | null }) => [
        p.userId,
        {
          userId: p.userId,
          firstName: p.firstName,
          photoUrl: p.photoUrl,
          verificationBadge: verifiedIds.has(p.userId) ? 'GOOGLE_VERIFIED' : 'NONE',
        } as ConnectionCounterpart,
      ]),
    );
  }

  private async toRequestViews(
    rows: RequestRow[],
    counterpartField: 'requesterId' | 'recipientId',
  ): Promise<ConnectionRequestView[]> {
    if (rows.length === 0) {
      return [];
    }
    const activityKeyById = await this.activityKeysById(rows.map((r) => r.activityId));
    const counterparts = await this.loadCounterparts(rows.map((r) => r[counterpartField]));

    return rows
      .map((r) => {
        const otherUser = counterparts.get(r[counterpartField]);
        if (!otherUser) {
          return null;
        }
        return {
          id: r.id,
          activityKey: activityKeyById.get(r.activityId)!,
          status: r.status as ConnectionRequestStatus,
          createdAt: r.createdAt.toISOString(),
          respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
          otherUser,
        };
      })
      .filter((v): v is ConnectionRequestView => v !== null);
  }

  private async toRequestView(
    row: RequestRow,
    activityKey: ActivityKey,
    counterpartId: string,
  ): Promise<ConnectionRequestView> {
    const counterparts = await this.loadCounterparts([counterpartId]);
    const otherUser = counterparts.get(counterpartId) ?? {
      userId: counterpartId,
      firstName: '',
      photoUrl: null,
      verificationBadge: 'NONE' as const,
    };
    return {
      id: row.id,
      activityKey,
      status: row.status as ConnectionRequestStatus,
      createdAt: row.createdAt.toISOString(),
      respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
      otherUser,
    };
  }
}
