import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * INV-DTO-DELIVERY-REPS-58 (D3): admin target / commission / route
 * DTOs. Three PRE-EXISTING MISMATCHES live here, all NOT fixed in
 * this package — the DTO accepts both spellings so the real caller
 * does not 400, and the service keeps reading only the spelling it
 * knows today:
 * - SetRepTargetDto: the caller (van-sales-admin-ops.ts
 *   setRepTarget) spreads its commissionRates flat with the
 *   non-Percent names (salesCommissionRate / collectionCommissionRate
 *   / targetBonusRate); the slice reads only the Percent names, so
 *   the rates are lost today.
 * - SaveCommissionConfigDto: the caller sends NONE of the Percent
 *   names (defaultSalesRate / defaultCollectionRate /
 *   defaultTargetBonusRate / salesRate / collectionRate /
 *   targetBonusRate), so the call is a no-op today.
 * - SettleRepCommissionDto: the caller sends `month` and `amount`;
 *   the slice reads `periodMonth` and falls back to the current month
 *   when it is absent, so the caller's chosen month is lost today.
 *   `month` is required (the caller always sends it); `periodMonth`
 *   is optional (the service name); `amount` is required (the caller
 *   always sends it) with no Min — the service falls back to
 *   maxPayable for a non-positive amount instead of throwing.
 * targetAmount carries no Min either: the service clamps it to >= 0.
 */
export class SetRepTargetDto {
  @IsInt()
  @Min(1)
  repId!: number;

  @IsString()
  month!: string;

  @IsNumber()
  targetAmount!: number;

  @IsOptional()
  @IsNumber()
  collectionTarget?: number | null;

  @IsOptional()
  @IsNumber()
  visitsTarget?: number | null;

  @IsOptional()
  @IsNumber()
  salesCommissionRatePercent?: number;

  @IsOptional()
  @IsNumber()
  collectionCommissionRatePercent?: number;

  @IsOptional()
  @IsNumber()
  targetBonusRatePercent?: number;

  @IsOptional()
  @IsNumber()
  salesCommissionRate?: number;

  @IsOptional()
  @IsNumber()
  collectionCommissionRate?: number;

  @IsOptional()
  @IsNumber()
  targetBonusRate?: number;
}

export class SaveCommissionConfigDto {
  @IsOptional()
  @IsNumber()
  salesCommissionRatePercent?: number;

  @IsOptional()
  @IsNumber()
  collectionCommissionRatePercent?: number;

  @IsOptional()
  @IsNumber()
  targetBonusRatePercent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  repId?: number;

  @IsOptional()
  @IsNumber()
  defaultSalesRate?: number;

  @IsOptional()
  @IsNumber()
  defaultCollectionRate?: number;

  @IsOptional()
  @IsNumber()
  defaultTargetBonusRate?: number;

  @IsOptional()
  @IsNumber()
  salesRate?: number;

  @IsOptional()
  @IsNumber()
  collectionRate?: number;

  @IsOptional()
  @IsNumber()
  targetBonusRate?: number;
}

export class SettleRepCommissionDto {
  @IsInt()
  @Min(1)
  repId!: number;

  @IsString()
  month!: string;

  @IsOptional()
  @IsString()
  periodMonth?: string;

  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsIn(['cash', 'bank_transfer'])
  paymentMethod?: 'cash' | 'bank_transfer';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CustomerRepScheduleDto {
  @IsInt()
  @Min(1)
  repId!: number;

  @IsOptional()
  @IsString()
  repName?: string;

  @IsArray()
  @IsString({ each: true })
  days!: string[];
}

export class SetCustomerRouteScheduleDto {
  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsNumber()
  routeSequence?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visitDays?: string[];

  @IsOptional()
  @IsString()
  customerCode?: string;

  @IsOptional()
  @IsString()
  locationUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  assignedRepId?: number | null;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  assignedRepIds?: number[];

  @IsOptional()
  @IsString()
  assignedRepName?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomerRepScheduleDto)
  repSchedules?: CustomerRepScheduleDto[];
}

export class BulkAssignCustomerRoutesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  customerIds!: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  assignedRepId?: number | null;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  assignedRepIds?: number[];

  @IsOptional()
  @IsBoolean()
  appendReps?: boolean;

  @IsOptional()
  @IsString()
  assignedRepName?: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visitDays?: string[];
}
