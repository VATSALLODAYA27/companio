import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationResult } from './provider.interface';

@Injectable()
export class VerificationsService {
  constructor(private readonly prisma: PrismaService) {}

  recordGoogleVerification(userId: string, result: VerificationResult) {
    return this.prisma.verification.create({
      data: {
        userId,
        provider: 'GOOGLE',
        status: result.status,
        verifiedAt: result.verifiedAt,
      },
    });
  }

  /** What the profile badge (Phase 3) reads — never the raw provider rows. */
  async getBadge(userId: string): Promise<'GOOGLE_VERIFIED' | 'NONE'> {
    const verified = await this.prisma.verification.findFirst({
      where: { userId, status: 'VERIFIED' },
      orderBy: { createdAt: 'desc' },
    });
    return verified ? 'GOOGLE_VERIFIED' : 'NONE';
  }
}
