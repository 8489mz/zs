/*
 * New file: backend/src/modules/accounting/dto/accounting-write.dto.ts
 *
 * D6 (INV-DTO-ACCOUNTING-25): DTO classes for the 10 accounting
 * write sites that took inline object types or `any` (cost centers,
 * allocation calculate, fixed assets, auto-depreciation toggle,
 * currencies, WHT status, auto-FIFO). Every field is caller-verified
 * against the real frontend caller (see dto-accounting.spec.ts).
 *
 * Notes:
 * - CreateCostCenterDto.parentId / UpdateCostCenterDto.parentId keep
 *   the `number | null` union: the caller sends a JSON number or null,
 *   so no implicit conversion is needed (the D5 union trap only bites
 *   when the client sends a value of a DIFFERENT type than the field).
 * - DepreciateFixedAssetDto is all-optional: the callers send
 *   `body || {}` and the service defaults months to 1.
 * - UpsertCurrencyDto.currencyCode has NO pattern: the service
 *   uppercases before testing /^[A-Z]{3}$/, so a lowercase code the
 *   service accepts must not 400 at the pipe.
 * - ConvertCurrencyDto.amount has NO @IsPositive(): the service
 *   accepts 0 (Number(amount || 0), finite check only) and there is
 *   no frontend caller — the interface shape is the positive case.
 * - ToggleAutoDepreciationDto.enabled / UpsertCurrencyDto.isBase are
 *   booleans under enableImplicitConversion: the string "false"
 *   converts to boolean true (pinned in the spec, not fixed).
 */

import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class CreateCostCenterDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  dimension?: string;

  @IsOptional()
  @IsNumber()
  budgetAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  parentId?: number | null;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCostCenterDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  dimension?: string;

  @IsOptional()
  @IsNumber()
  budgetAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  parentId?: number | null;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CalculateCostCenterSplitDto {
  @IsNumber()
  amount!: number;
}

export class CreateFixedAssetDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsNumber()
  @IsPositive()
  purchaseCost!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salvageValue?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  usefulLifeMonths?: number;

  @IsOptional()
  @IsIn(['straight_line', 'declining_balance'])
  depreciationMethod?: 'straight_line' | 'declining_balance';

  @IsOptional()
  @IsDateString()
  purchaseDate?: string;
}

export class DepreciateFixedAssetDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  months?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ToggleAutoDepreciationDto {
  @IsBoolean()
  enabled!: boolean;
}

export class UpsertCurrencyDto {
  @IsString()
  @IsNotEmpty()
  currencyCode!: string;

  @IsString()
  @IsNotEmpty()
  currencyName!: string;

  @IsNumber()
  @IsPositive()
  exchangeRate!: number;

  @IsOptional()
  @IsBoolean()
  isBase?: boolean;

  @IsOptional()
  @IsString()
  symbol?: string;
}

export class ConvertCurrencyDto {
  @IsNumber()
  amount!: number;

  @IsString()
  @IsNotEmpty()
  fromCurrency!: string;

  @IsString()
  @IsNotEmpty()
  toCurrency!: string;

  @IsOptional()
  @IsString()
  asOf?: string;
}

export class UpdateWhtStatusDto {
  @IsIn(['draft', 'declared', 'paid'])
  status!: 'draft' | 'declared' | 'paid';

  @IsOptional()
  @IsString()
  payment_reference?: string;
}

export class AutoAllocateFifoDto {
  @IsIn(['customer', 'supplier'])
  partnerType!: 'customer' | 'supplier';

  @IsInt()
  @Min(1)
  partnerId!: number;

  @IsInt()
  @Min(1)
  paymentId!: number;
}
