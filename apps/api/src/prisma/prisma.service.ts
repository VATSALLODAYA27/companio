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
 *
 * `DB_POOL_MAX` (Phase 10): the driver adapter passes its config
 * straight through to `pg`'s own `Pool`, which defaults to `max: 10` if
 * never set — a limit nothing in this codebase had ever previously
 * overridden or even surfaced as configurable. Phase 10's load test
 * (see SCALING.md "Connection pool") found this was the actual binding
 * constraint on discovery/map throughput under concurrent load, well
 * before Postgres or CPU became the bottleneck: `pg_stat_activity`
 * plateaued at ~10 active connections throughout a 40-VU run regardless
 * of load. Left unset, behavior is unchanged from before this option
 * existed (pg's own default of 10 applies) — this only matters once an
 * operator has sized it deliberately against real Postgres
 * `max_connections` and however many API instances will share that
 * budget (see SCALING.md "Recommendations" before changing it).
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
    const poolMaxRaw = config.get<string>('DB_POOL_MAX');
    const poolMax = poolMaxRaw ? Number(poolMaxRaw) : undefined;
    super({
      adapter: new PrismaPg({
        connectionString,
        ...(poolMax && Number.isFinite(poolMax) ? { max: poolMax } : {}),
      }),
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
