import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ActivitiesModule } from './activities/activities.module';
import { ProfileModule } from './profile/profile.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    // Global default rate limit; individual routes (e.g. /auth/*,
    // /discovery/nearby) override this with stricter per-route limits
    // (see @Throttle() usage in AuthController). Redis-backed so limits
    // are shared across API instances once there is more than one — an
    // in-memory counter would let an attacker reset their limit just by
    // hitting a different instance behind the load balancer.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: Number(config.get('RATE_LIMIT_TTL_SECONDS') ?? 60) * 1000,
            limit: Number(config.get('RATE_LIMIT_MAX_DEFAULT') ?? 100),
          },
        ],
        storage: new ThrottlerStorageRedisService(
          config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        ),
      }),
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ActivitiesModule,
    ProfileModule,
  ],
  providers: [
    // Registers ThrottlerGuard as a global guard so @Throttle() overrides
    // (and the default limit) are actually enforced on every route — a
    // ThrottlerModule import alone does not apply it.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
