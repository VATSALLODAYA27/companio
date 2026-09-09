import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';

/**
 * AuthN only — confirms there is a valid, unexpired, non-revoked session
 * belonging to an ACTIVE user, and attaches { userId, sessionId } to the
 * request. It intentionally does NOT decide whether the caller may
 * access a specific resource — that's AuthZ, enforced separately in each
 * service against actual ownership/membership (see SECURITY.md
 * "Authorization Model").
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieName =
      this.config.get<string>('SESSION_COOKIE_NAME') ?? 'companio_sid';
    const sessionId = request.signedCookies?.[cookieName];

    if (!sessionId || typeof sessionId !== 'string') {
      throw new UnauthorizedException('Not authenticated');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { select: { id: true, status: true } } },
    });

    const isValid =
      !!session &&
      !session.revokedAt &&
      session.expiresAt.getTime() > Date.now() &&
      session.user.status === 'ACTIVE';

    if (!isValid) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    request.auth = { userId: session.userId, sessionId: session.id };
    return true;
  }
}
