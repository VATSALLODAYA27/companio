import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ACTIVITY_KEYS, ActivityKey, SEARCH_RADIUS_METERS_VALUES } from '@companio/shared';

export class NearbyQueryDto {
  @IsIn(ACTIVITY_KEYS)
  activityKey!: ActivityKey;

  // Defaults to DEFAULT_SEARCH_RADIUS_METERS (1km) in the service when
  // omitted. Only the fixed set of radii the product offers — never an
  // arbitrary client-supplied number.
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
