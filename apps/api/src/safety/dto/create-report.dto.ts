import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { REPORT_CATEGORY_VALUES, ReportCategory } from '@companio/shared';

export class CreateReportDto {
  @IsUUID()
  reportedUserId!: string;

  @IsIn(REPORT_CATEGORY_VALUES)
  category!: ReportCategory;

  // Matches Report.details' @db.VarChar(1000) in prisma/schema.prisma.
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  details?: string;
}
