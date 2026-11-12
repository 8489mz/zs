import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
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
 * `submitLoadRequisition`): sourceWarehouseId / items / notes only.
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
