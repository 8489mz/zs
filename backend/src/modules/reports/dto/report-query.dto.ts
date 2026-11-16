import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class ReportRangeQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  branchId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  locationId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  page?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  filter?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  userId?: number;

  // INV-VAN-PROFIT-REP-REPORTING: scopes the SALES side of a report to
  // one delivery rep (delivery_rep_id). Sales totals, tax, discounts,
  // COGS and top products filter to the rep; sale returns filter to
  // the rep's invoices; purchases, services, expenses and treasury
  // are not rep-attributable and stay tenant-wide. employeeSummary
  // stays per-user (created_by) and is unaffected.
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  deliveryRepId?: number;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  activityType?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  days?: number;
}
