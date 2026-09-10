import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BlockedUserView, ReportCategory, ReportView } from '@companio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

interface ReportRow {
  id: string;
  reportedId: string;
  category: string;
  details: string | null;
  status: string;
  createdAt: Date;
}

/**
 * Blocks and reports (Phase 8). Every method takes the caller's userId
 * from the session, never a request parameter — same discipline as
 * connections/chat (see SECURITY.md §3).
 *
 * Blocking is more than an insert. It's meant to fully sever the
 * relationship going forward, and this module is the only place that
 * actually creates a Block row — so it's also the one place responsible
 * for retroactively closing out whatever already exists between the
 * pair: `createBlock` ends every active Connection between them
 * (across every activity, not just one — a block isn't
 * activity-scoped) and declines any ConnectionRequest still PENDING in
 * either direction. Without that second part there's a real gap:
 * `ConnectionsService.acceptRequest` never re-checks the Block table
 * (only `sendRequest` does, via `isEligibleRecipient`), so a request
 * sent before a block existed could otherwise still be accepted after
 * the block. Closing it here — rather than adding a defensive re-check
 * to `acceptRequest` — means there is provably no PENDING request left
 * between two blocked users the instant the block transaction commits,
 * not just at accept-time.
 *
 * Deliberately does not import ConnectionsService/ConnectionsModule for
 * this — it touches the `connection`/`connectionRequest` tables
 * directly via PrismaService, the same defense-in-depth posture
 * DiscoveryRepository and ConnectionsService already have toward the
 * `blocks` table (querying the table a feature depends on directly,
 * rather than adding a fine-grained cross-module service dependency for
 * one check).
 */
@Injectable()
export class SafetyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async createBlock(blockerId: string, blockedUserId: string): Promise<{ blocked: true }> {
    if (blockerId === blockedUserId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const target = await this.users.findById(blockedUserId);
    if (!target) {
      throw new NotFoundException('User not found');
    }

    const [userAId, userBId] = [blockerId, blockedUserId].sort();

    try {
      await this.prisma.$transaction([
        this.prisma.block.create({ data: { blockerId, blockedId: blockedUserId } }),
        // Not activity-scoped: a block ends the relationship entirely,
        // across every Connection the pair has (they could have more
        // than one, one per activity — see the unique constraint on
        // Connection).
        this.prisma.connection.updateMany({
          where: { userAId, userBId, removedAt: null },
          data: { removedAt: new Date() },
        }),
        this.prisma.connectionRequest.updateMany({
          where: {
            status: 'PENDING',
            OR: [
              { requesterId: blockerId, recipientId: blockedUserId },
              { requesterId: blockedUserId, recipientId: blockerId },
            ],
          },
          data: { status: 'DECLINED', respondedAt: new Date() },
        }),
      ]);
    } catch (err) {
      // Block.@@unique([blockerId, blockedId]) — a second block attempt
      // on someone already blocked is a no-op from the caller's point of
      // view, not a server error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('You have already blocked this user');
      }
      throw err;
    }

    return { blocked: true };
  }

  async removeBlock(blockerId: string, blockedUserId: string): Promise<{ unblocked: true }> {
    // Unblocking is a plain hard delete of the relationship row — unlike
    // account deletion (SECURITY.md §10), a voluntary unblock has no
    // retention requirement of its own; the pair simply becomes eligible
    // to interact again (isEligibleRecipient re-checks the Block table
    // live on every future request).
    const deleted = await this.prisma.block.deleteMany({
      where: { blockerId, blockedId: blockedUserId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Block not found');
    }
    return { unblocked: true };
  }

  async listBlocks(userId: string): Promise<BlockedUserView[]> {
    const rows = await this.prisma.block.findMany({
      where: { blockerId: userId },
      orderBy: { createdAt: 'desc' },
    });
    if (rows.length === 0) {
      return [];
    }

    const profiles: Array<{ userId: string; firstName: string; photoUrl: string | null }> =
      await this.prisma.profile.findMany({
        where: { userId: { in: rows.map((r) => r.blockedId) } },
        select: { userId: true, firstName: true, photoUrl: true },
      });
    const profileById = new Map(profiles.map((p) => [p.userId, p]));

    return rows.map((r) => {
      const profile = profileById.get(r.blockedId);
      return {
        userId: r.blockedId,
        firstName: profile?.firstName ?? null,
        photoUrl: profile?.photoUrl ?? null,
        blockedAt: r.createdAt.toISOString(),
      };
    });
  }

  async createReport(
    reporterId: string,
    reportedUserId: string,
    category: ReportCategory,
    details: string | undefined,
  ): Promise<ReportView> {
    if (reporterId === reportedUserId) {
      throw new BadRequestException('You cannot report yourself');
    }

    const target = await this.users.findById(reportedUserId);
    if (!target) {
      throw new NotFoundException('User not found');
    }

    const report: ReportRow = await this.prisma.report.create({
      data: { reporterId, reportedId: reportedUserId, category, details: details ?? null },
    });
    return this.toReportView(report);
  }

  async listMyReports(userId: string): Promise<ReportView[]> {
    const rows: ReportRow[] = await this.prisma.report.findMany({
      where: { reporterId: userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toReportView(r));
  }

  private toReportView(row: ReportRow): ReportView {
    return {
      id: row.id,
      reportedUserId: row.reportedId,
      category: row.category as ReportCategory,
      details: row.details,
      status: row.status as ReportView['status'],
      createdAt: row.createdAt.toISOString(),
    };
  }
}
