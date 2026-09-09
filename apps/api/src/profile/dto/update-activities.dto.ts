import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, ValidateNested } from 'class-validator';
import { ACTIVITY_KEYS, ActivityKey, AVAILABILITY_VALUES, Availability } from '@companio/shared';

export class ActivitySelectionItemDto {
  @IsIn(ACTIVITY_KEYS)
  activityKey!: ActivityKey;

  @IsIn(AVAILABILITY_VALUES)
  availability!: Availability;
}

// Replace-all semantics: this is the caller's complete set of active
// activities. Anything not included is removed (see ProfileService).
export class UpdateActivitiesDto {
  @IsArray()
  @ArrayMaxSize(ACTIVITY_KEYS.length)
  @ValidateNested({ each: true })
  @Type(() => ActivitySelectionItemDto)
  activities!: ActivitySelectionItemDto[];
}
