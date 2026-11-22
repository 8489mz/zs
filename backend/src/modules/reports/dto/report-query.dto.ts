import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

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
  // stays per-user (created_by); F13 adds its per-user profit column
  // (salesProfit = sales - returns - net COGS) on that same grouping.
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  deliveryRepId?: number;

  // F13 (trial problem 18): discounted-invoices-only filter for the sales
  // report. A sale is discounted when its invoice discount is > 0 OR any
  // line carries a line discount > 0 — the shared discountedSaleSql
  // predicate; the query string 'true' is the only truthy spelling
  // (Boolean('false') would be true, so the transform is explicit).
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  discountedOnly?: boolean;

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
