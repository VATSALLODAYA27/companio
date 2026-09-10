import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * User lookups/creation only. Profile fields (name, bio, activities, ...)
 * are Phase 3 — this module intentionally knows nothing about them yet.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByGoogleId(googleId: string) {
    return this.prisma.user.findUnique({ where: { googleId } });
  }

  findActiveById(id: string) {
    return this.prisma.user.findFirst({
      where: { id, status: 'ACTIVE' },
    });
  }

  // Deliberately no status filter — used by safety/ (Phase 8) to confirm
  // a block/report target *exists* at all. Unlike sendRequest's
  // isEligibleRecipient (which hides whether a non-ACTIVE user exists,
  // to avoid letting a requester enumerate suspended accounts), blocking
  // or reporting someone who has since gone SUSPENDED/DELETED should
  // still be allowed — a suspended account is exactly the kind of
  // account trust & safety continuity cares about, and its id was
  // already known to the caller from an earlier, legitimate interaction.
  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  createWithPassword(email: string, passwordHash: string) {
    return this.prisma.user.create({
      data: { email, passwordHash },
    });
  }

  createWithGoogle(email: string, googleId: string) {
    return this.prisma.user.create({
      data: { email, googleId },
    });
  }

  linkGoogleId(userId: string, googleId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { googleId },
    });
  }
}
