import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ACTIVITY_KEYS, ActivityKey, SEARCH_RADIUS_METERS_VALUES } from '@companio/shared';

// Deliberately mirrors discovery/dto/nearby-query.dto.ts field-for-field
// — the map view and the list view are the same underlying search, just
// rendered differently — kept as its own file per this module's
// boundary (see ARCHITECTURE.md "Module boundaries").
export class MapNearbyQueryDto {
  @IsIn(ACTIVITY_KEYS)
  activityKey!: ActivityKey;

  @IsOptional()
  @Type(() => Number)
  @IsIn(SEARCH_RADIUS_METERS_VALUES)
  radiusMeters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
