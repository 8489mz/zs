import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * INV-DTO-DELIVERY-REPS-58 (D3): admin trip / fleet / requisition
 * DTOs. PerDayCashDto and CountedStockDto are shared with the driver
 * settle DTOs (same per-day split shape, INV-VAN-DAILY-SPLIT-
 * SETTLEMENT). Ranges mirror the service throws: countedCash carries
 * no Min (the admin settle service defaults a missing value to 0 and
 * never throws on a negative one); review approvedItems is a required
 * array with NO min-size (the service stores it as JSON and tolerates
 * an empty list). AdminRequisitionItemDto whitelists the display
 * fields the admin caller always sends (productName / barcode): the
 * service stores items verbatim, so the extras survive in the stored
 * JSON instead of being dropped. RejectWithReasonDto is shared by the
 * admin return reject, the requisition reject, and the driver
 * transfer reject — all three take only an optional reason.
 */
export class PerDayCashDto {
  @IsString()
  businessDay!: string;

  @IsNumber()
  countedCash!: number;
}

export class CountedStockDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsNumber()
  countedQty!: number;
}

export class SettleTripAdminDto {
  @IsInt()
  @Min(1)
  repId!: number;

  @IsNumber()
  countedCash!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PerDayCashDto)
  perDayCash?: PerDayCashDto[];

  @IsBoolean()
  unloadRemainingToWarehouse!: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CountedStockDto)
  countedStock?: CountedStockDto[];

  @IsOptional()
  @IsBoolean()
  nightStockApproved?: boolean;

  @IsOptional()
  @IsString()
  nightStockNotes?: string;

  @IsOptional()
  @IsNumber()
  endOdometer?: number;

  @IsOptional()
  @IsBoolean()
  chargeStockVarianceToRep?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  plateNumber!: string;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsString()
  vehicleType?: string;

  @IsOptional()
  @IsString()
  vinChassis?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  branchId?: number;

  @IsOptional()
  @IsNumber()
  currentOdometer?: number;

  @IsOptional()
  @IsString()
  fuelType?: string;

  @IsOptional()
  @IsString()
  licenseExpiresAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  assignedRepId?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  plateNumber?: string;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsString()
  vehicleType?: string;

  @IsOptional()
  @IsString()
  vinChassis?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  branchId?: number;

  @IsOptional()
  @IsNumber()
  currentOdometer?: number;

  @IsOptional()
  @IsString()
  fuelType?: string;

  @IsOptional()
  @IsString()
  licenseExpiresAt?: string;

  @IsOptional()
  @IsIn(['available', 'assigned', 'maintenance', 'retired'])
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  assignedRepId?: number | null;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AssignRepDto {
  @ValidateIf((o) => o.repId !== null)
  @IsInt()
  @Min(1)
  repId!: number | null;

  @IsOptional()
  @IsString()
  shiftName?: string;
}

export class RejectWithReasonDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminRequisitionItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsNumber()
  qty!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  sourceWarehouseId?: number;

  @IsOptional()
  @IsString()
  sourceWarehouseName?: string;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsString()
  barcode?: string;
}

export class CreateAdminRequisitionDto {
  @IsInt()
  @Min(1)
  repId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  sourceWarehouseId?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdminRequisitionItemDto)
  items!: AdminRequisitionItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  dispatchImmediately?: boolean;
}

export class ReviewRequisitionItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsNumber()
  qty!: number;
}

export class ReviewRequisitionDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewRequisitionItemDto)
  approvedItems!: ReviewRequisitionItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sourceWarehouseId?: number;
}
