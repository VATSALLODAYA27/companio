import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Owns the Session table: issuing, revoking, and expiring server-side
 * sessions. The cookie handed to the browser only ever contains a
 * session id from here — never a token with embedded claims. See
 * SECURITY.md "Authentication Model" for why.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private ttlHours(): number {
    return Number(this.config.get('SESSION_TTL_HOURS') ?? 24);
  }

  /** User-Agent is hashed, never stored raw — it's only used to spot an
   *  unexpected client reusing a session id, not to fingerprint the user. */
  private hashUserAgent(userAgent?: string): string | undefined {
    if (!userAgent) return undefined;
    return createHash('sha256').update(userAgent).digest('hex');
  }

  create(userId: string, userAgent?: string) {
    const expiresAt = new Date(Date.now() + this.ttlHours() * 60 * 60 * 1000);
    return this.prisma.session.create({
      data: {
        userId,
        expiresAt,
        userAgentHash: this.hashUserAgent(userAgent),
      },
    });
  }

  async findValid(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { select: { id: true, status: true } } },
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    if (session.user.status !== 'ACTIVE') {
      return null;
    }
    return session;
  }

  async revoke(sessionId: string) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Used on account deletion / suspicious-activity response — see SECURITY.md §11. */
  async revokeAllForUser(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
