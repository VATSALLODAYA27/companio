import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DomainEventsService } from './domain-events.service';

// Global, like PrismaModule — this is cross-cutting infrastructure, not
// a feature module, so every module that needs to publish a domain
// event (today: ChatService) can inject DomainEventsService without an
// explicit import creating another spoke of dependencies to track.
@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [DomainEventsService],
  exports: [DomainEventsService],
})
export class DomainEventsModule {}
