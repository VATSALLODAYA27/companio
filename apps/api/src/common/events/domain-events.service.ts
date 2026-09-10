import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MESSAGE_SENT_EVENT, MessageSentEvent } from './domain-events.types';

/**
 * The single place application code publishes cross-cutting, non-
 * request-path events (see ARCHITECTURE.md "Event layer"). Backed by an
 * in-process EventEmitter2 for now; a later move to a real broker for
 * events that need to cross process/service boundaries touches only
 * this file's implementation, not any of its callers.
 *
 * ChatGateway's own `@OnEvent(MESSAGE_SENT_EVENT)` listener (see
 * chat.gateway.ts) is a deliberate exception to "nothing else imports
 * the event bus directly" — pushing a message to a live WebSocket room
 * is an in-process, single-instance concern today, not something a
 * message broker would improve, so the Nest event-emitter decorator is
 * used there directly rather than being wrapped a second time.
 */
@Injectable()
export class DomainEventsService {
  constructor(private readonly emitter: EventEmitter2) {}

  publishMessageSent(event: MessageSentEvent): void {
    this.emitter.emit(MESSAGE_SENT_EVENT, event);
  }
}
