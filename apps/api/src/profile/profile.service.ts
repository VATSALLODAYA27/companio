import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivitiesService } from '../activities/activities.service';
import { VerificationsService } from '../identity-verification/verifications.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ActivitySelectionItemDto } from './dto/update-activities.dto';

/**
 * Every method here takes `userId` from the authenticated session
 * (SessionAuthGuard + @CurrentUser) — never from a request parameter —
 * so there is no code path in this service that can read or write
 * another user's profile. Cross-user profile access (viewing someone
 * else's, privacy-filtered) is Discovery's job from Phase 4 onward, not
 * this module's.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: ActivitiesService,
    private readonly verifications: VerificationsService,
  ) {}

  /**
   * Called once, from AuthService.register, right after the User row is
   * created — turns the `firstName` collected on the registration form
   * into a real Profile row immediately, instead of leaving a new user
   * to hit a 404 from getMyProfile() and have to type their name again
   * on the profile screen. Uses create (not upsert): a brand-new userId
   * can never already have a Profile, so a unique-constraint failure
   * here would mean something else is wrong and should surface, not be
   * silently swallowed.
   */
  async createInitialProfile(userId: string, firstName: string) {
    const profile = await this.prisma.profile.create({
      data: { userId, firstName },
    });
    const badge = await this.verifications.getBadge(userId);
    return this.toProfileView(profile, badge);
  }

  async getMyProfile(userId: string) {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) {
      throw new NotFoundException('Profile not created yet');
    }
    const badge = await this.verifications.getBadge(userId);
    return this.toProfileView(profile, badge);
  }

  async upsertMyProfile(userId: string, dto: UpdateProfileDto) {
    const data = {
      firstName: dto.firstName,
      photoUrl: dto.photoUrl ?? null,
      ageRange: dto.ageRange ?? null,
      bio: dto.bio ?? null,
      city: dto.city ?? null,
      languages: dto.languages ?? [],
      ...(dto.discoverable !== undefined ? { discoverable: dto.discoverable } : {}),
      ...(dto.hidden !== undefined ? { hidden: dto.hidden } : {}),
    };

    const profile = await this.prisma.profile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    const badge = await this.verifications.getBadge(userId);
    return this.toProfileView(profile, badge);
  }

  async getMyActivities(userId: string) {
    const rows: Array<{
      availability: string;
      activity: { key: string; label: string };
    }> = await this.prisma.userActivity.findMany({
      where: { userId },
      include: { activity: { select: { key: true, label: true } } },
      orderBy: { activity: { label: 'asc' } },
    });
    return rows.map((r) => ({
      activityKey: r.activity.key,
      label: r.activity.label,
      availability: r.availability,
    }));
  }

  async setMyActivities(userId: string, items: ActivitySelectionItemDto[]) {
    const keys = items.map((i) => i.activityKey);
    const uniqueKeys = new Set(keys);
    if (uniqueKeys.size !== keys.length) {
      throw new BadRequestException('Duplicate activityKey in request');
    }

    const idsByKey = await this.activities.findIdsByKeys(keys);
    const unknown = keys.filter((k) => !idsByKey.has(k));
    if (unknown.length > 0) {
      // Defensive only — the DTO's @IsIn already restricts activityKey
      // to the fixed set, so this would mean the DB wasn't seeded.
      throw new BadRequestException(`Unknown activity key(s): ${unknown.join(', ')}`);
    }

    const activityIds = items.map((i) => idsByKey.get(i.activityKey)!);

    await this.prisma.$transaction([
      this.prisma.userActivity.deleteMany({
        where: { userId, activityId: { notIn: activityIds } },
      }),
      ...items.map((item) =>
        this.prisma.userActivity.upsert({
          where: {
            userId_activityId: { userId, activityId: idsByKey.get(item.activityKey)! },
          },
          create: {
            userId,
            activityId: idsByKey.get(item.activityKey)!,
            availability: item.availability,
          },
          update: { availability: item.availability },
        }),
      ),
    ]);

    return this.getMyActivities(userId);
  }

  private toProfileView(
    profile: {
      firstName: string;
      photoUrl: string | null;
      ageRange: string | null;
      bio: string | null;
      city: string | null;
      languages: string[];
      discoverable: boolean;
      hidden: boolean;
      updatedAt: Date;
    },
    verificationBadge: 'GOOGLE_VERIFIED' | 'NONE',
  ) {
    // Explicit shape — never spread the raw Prisma row. There is no
    // sensitive field on Profile today, but this keeps the contract
    // deliberate rather than accidental as fields are added later.
    return {
      firstName: profile.firstName,
      photoUrl: profile.photoUrl,
      ageRange: profile.ageRange,
      bio: profile.bio,
      city: profile.city,
      languages: profile.languages,
      discoverable: profile.discoverable,
      hidden: profile.hidden,
      verificationBadge,
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
