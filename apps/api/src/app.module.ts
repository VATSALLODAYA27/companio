import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { PrismaModule } from './prisma/prisma.module';
import { DomainEventsModule } from './common/events/domain-events.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ActivitiesModule } from './activities/activities.module';
import { ProfileModule } from './profile/profile.module';
import { LocationModule } from './location/location.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { ConnectionsModule } from './connections/connections.module';
import { ChatModule } from './chat/chat.module';
import { MapModule } from './map/map.module';
import { SafetyModule } from './safety/safety.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    // Global default rate limit; individual routes (e.g. /auth/*,
    // /discovery/nearby) override this with stricter per-route limits
    // (see @Throttle() usage in AuthController). Redis-backed storage
    // shares limits across API instances once there is more than one —
    // an in-memory counter would let an attacker reset their limit just
    // by hitting a different instance behind the load balancer — but
    // that only matters once you actually run more than one instance.
    // REDIS_URL is optional for exactly that reason: the free-tier
    // deployment (DEPLOYMENT.md) runs a single instance with no Redis at
    // all, and Nest's ThrottlerModule already defaults to an in-memory
    // ThrottlerStorageService when no `storage` is given, so this just
    // doesn't override that default when REDIS_URL is unset rather than
    // falling back to a localhost URL that wouldn't exist in that
    // deployment anyway.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        return {
          throttlers: [
            {
              ttl: Number(config.get('RATE_LIMIT_TTL_SECONDS') ?? 60) * 1000,
              limit: Number(config.get('RATE_LIMIT_MAX_DEFAULT') ?? 100),
            },
          ],
          ...(redisUrl ? { storage: new ThrottlerStorageRedisService(redisUrl) } : {}),
        };
      },
    }),
    PrismaModule,
    DomainEventsModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ActivitiesModule,
    ProfileModule,
    LocationModule,
    DiscoveryModule,
    ConnectionsModule,
    ChatModule,
    MapModule,
    SafetyModule,
  ],
  providers: [
    // Registers ThrottlerGuard as a global guard so @Throttle() overrides
    // (and the default limit) are actually enforced on every route — a
    // ThrottlerModule import alone does not apply it.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
