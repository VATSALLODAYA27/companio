import { MessageView } from '@companio/shared';

export const MESSAGE_SENT_EVENT = 'message.sent';

export interface MessageSentEvent {
  conversationId: string;
  message: MessageView;
}
