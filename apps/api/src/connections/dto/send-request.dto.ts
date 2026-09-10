import { IsIn, IsUUID } from 'class-validator';
import { ACTIVITY_KEYS, ActivityKey } from '@companio/shared';

export class SendConnectionRequestDto {
  // The candidate's id, exactly as returned by GET /discovery/nearby's
  // `userId` field — never accepted as an email or any other
  // client-controlled lookup key.
  @IsUUID()
  recipientId!: string;

  @IsIn(ACTIVITY_KEYS)
  activityKey!: ActivityKey;
}
