import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * INV-DRIVER-REQUISITION-DTO-WHITELIST: the driver load-requisition
 * route accepts ONLY these fields. In particular there is NO
 * `allowMultiplePending` property here on purpose: the global
 * requestValidationPipe runs with `forbidNonWhitelisted: true`, so a
 * driver-sent `allowMultiplePending: true` is rejected with
 * VALIDATION_ERROR (400) at the boundary and never reaches the
 * service — the single-pending-requisition rule cannot be bypassed
 * from the driver portal. The flag stays an admin-only, server-set
 * value: `createLoadRequisitionByAdmin` sets it from
 * `dispatchImmediately` in the service funnel.
 *
 * Shape mirrors the driver frontend payload exactly
 * (frontend/src/features/delivery-reps/api/van-sales.api.ts
 * `submitLoadRequisition`, built in
 * DriverNewLoadRequisitionView.tsx `handleSubmit`): sourceWarehouseId /
 * items / notes at the top level, and per item the display fields the
 * frontend ALWAYS sends — unitName / isWeight / packingText, plus the
 * carton breakdown (cartons / pieces / cartonMultiplier /
 * packagingUnitName) when defined. INV-DRIVER-REQUISITION-ITEM-FIELDS:
 * those per-item fields are whitelisted here (all @IsOptional()) so
 * the real frontend payload passes the pipe; they are display-only
 * (packingText is what the supervisor sees when reviewing) and the
 * service already spreads items into requested_items /
 * approved_items, so the info is stored, not dropped. Before this
 * invariant the DTO whitelisted only productId / qty /
 * sourceWarehouseId / sourceWarehouseName per item, so EVERY driver
 * submit was rejected with VALIDATION_ERROR at the boundary and the
 * load-request button appeared to do nothing.
 */
export class LoadRequisitionItemDto {
  @IsInt()
  productId!: number;

  @IsNumber()
  qty!: number;

  @IsOptional()
  @IsInt()
  sourceWarehouseId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceWarehouseName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  unitName?: string;

  @IsOptional()
  @IsBoolean()
  isWeight?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  packingText?: string;

  @IsOptional()
  @IsNumber()
  cartons?: number;

  @IsOptional()
  @IsNumber()
  pieces?: number;

  @IsOptional()
  @IsNumber()
  cartonMultiplier?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  packagingUnitName?: string;
}

export class SubmitLoadRequisitionDto {
  @IsOptional()
  @IsInt()
  sourceWarehouseId?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LoadRequisitionItemDto)
  items!: LoadRequisitionItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
