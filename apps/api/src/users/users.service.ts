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
