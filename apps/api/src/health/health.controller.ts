import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * GET /health — unauthenticated liveness + dependency check.
 * Intentionally returns only booleans and timings, never connection
 * strings, internal hostnames, or stack traces.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const startedAt = Date.now();
    let databaseOk = false;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      databaseOk = true;
    } catch {
      databaseOk = false;
    }

    const body = {
      status: databaseOk ? 'ok' : 'degraded',
      database: databaseOk ? 'ok' : 'unreachable',
      uptimeSeconds: Math.round(process.uptime()),
      checkedInMs: Date.now() - startedAt,
    };

    if (!databaseOk) {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return body;
  }
}
