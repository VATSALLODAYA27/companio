import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Wraps the generated Prisma client as a Nest provider so it can be
 * dependency-injected and its connection lifecycle managed alongside the
 * app. Query logging is intentionally minimal — Prisma's `query` log level
 * would print parameter values, which can include location coordinates or
 * message bodies; see SECURITY.md "Logging policy".
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    this.$on('error' as never, (e: { message: string }) =>
      this.logger.error(e.message),
    );
    this.$on('warn' as never, (e: { message: string }) =>
      this.logger.warn(e.message),
    );
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
