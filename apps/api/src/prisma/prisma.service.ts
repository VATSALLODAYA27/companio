import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Wraps the generated Prisma client as a Nest provider so it can be
 * dependency-injected and its connection lifecycle managed alongside the
 * app. Query logging is intentionally minimal — Prisma's `query` log level
 * would print parameter values, which can include location coordinates or
 * message bodies; see SECURITY.md "Logging policy".
 *
 * The client runs on the WASM query engine (see prisma/schema.prisma
 * `engineType = "wasm"`) via this `pg`-backed driver adapter rather than
 * a native engine binary — see ARCHITECTURE.md "Prisma engine strategy".
 * Because of that, the connection string is supplied here, to the
 * adapter, not via a `url` in the datasource block.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL');
    if (!connectionString) {
      // Fail loudly at boot rather than connecting to nothing — this
      // mirrors the "placeholder credential" pattern used for Google
      // OAuth in Phase 2 (never crash *silently* into a broken state).
      throw new Error('DATABASE_URL is not set');
    }
    super({
      adapter: new PrismaPg({ connectionString }),
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
