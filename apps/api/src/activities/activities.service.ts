import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Read-only access to the fixed activity list (seeded once via
 * prisma/seed.ts — see packages/shared ACTIVITY_KEYS for the canonical
 * set). Nothing here ever creates, edits, or deletes an activity at
 * request time; the list is product-defined, not user-generated.
 */
@Injectable()
export class ActivitiesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.activity.findMany({
      orderBy: { label: 'asc' },
      select: { id: true, key: true, label: true },
    });
  }

  /** Map activity keys ("trekking", ...) to their DB ids in one query. */
  async findIdsByKeys(keys: string[]): Promise<Map<string, string>> {
    if (keys.length === 0) {
      return new Map();
    }
    const rows: Array<{ id: string; key: string }> = await this.prisma.activity.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });
    return new Map(rows.map((r) => [r.key, r.id]));
  }
}
