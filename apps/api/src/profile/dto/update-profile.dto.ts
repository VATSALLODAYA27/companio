import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
} from 'class-validator';
import { AGE_RANGE_VALUES, AgeRange } from '@companio/shared';

export class UpdateProfileDto {
  @IsString()
  @Length(1, 60)
  firstName!: string;

  // Uploaded/hosted elsewhere (out of scope for this prototype's storage
  // layer) — this field only ever holds a URL, never binary image data,
  // and https-only avoids javascript:/data: URL abuse in the web client.
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Length(1, 2048)
  photoUrl?: string;

  // A fixed bucket, never a date of birth or exact age — see
  // SECURITY.md "Data minimization". @IsIn rejects anything else, so
  // this can never be used to smuggle an arbitrary string into the DB.
  @IsOptional()
  @IsIn(AGE_RANGE_VALUES)
  ageRange?: AgeRange;

  @IsOptional()
  @IsString()
  @Length(0, 280)
  bio?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  city?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 30, { each: true })
  languages?: string[];

  // Opt-in to appearing in discovery results (Phase 4). Defaults to
  // true at profile creation but can be turned off at any time.
  @IsOptional()
  @IsBoolean()
  discoverable?: boolean;

  // Manual "hide me right now" toggle, independent of `discoverable` —
  // see SECURITY.md privacy defaults.
  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}
