import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    // Global default rate limit; individual routes (e.g. /auth/*,
    // /discovery/nearby) override this with stricter per-route limits
    // once those modules land in Phase 2 / Phase 4.
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_TTL_SECONDS ?? 60) * 1000,
        limit: Number(process.env.RATE_LIMIT_MAX_DEFAULT ?? 100),
      },
    ]),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
