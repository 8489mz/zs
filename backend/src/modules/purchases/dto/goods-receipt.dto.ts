import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  Max,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateGoodsReceiptLineDto {
  @Transform(({ value }) => (value !== undefined && value !== null ? Number(value) : undefined))
  @IsOptional()
  @IsInt()
  purchaseOrderItemId?: number;

  @Transform(({ value }) => Number(value))
  @IsInt()
  productId!: number;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  orderedQty!: number;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  receivedQty!: number;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  acceptedQty!: number;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  rejectedQty!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsDateString()
  manufacturingDate?: string;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  unitCost!: number;

  @Transform(({ value }) => (value !== undefined && value !== null ? Number(value) : undefined))
  @IsOptional()
  @IsInt()
  quarantineLocationId?: number;

  @Transform(({ value }) => (value !== undefined && value !== null ? Number(value) : undefined))
  @IsOptional()
  @IsInt()
  coaDocumentId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateGoodsReceiptDto {
  @Transform(({ value }) => (value !== undefined && value !== null ? Number(value) : undefined))
  @IsOptional()
  @IsInt()
  purchaseOrderId?: number;

  @Transform(({ value }) => Number(value))
  @IsInt()
  supplierId!: number;

  @Transform(({ value }) => (value !== undefined && value !== null ? Number(value) : undefined))
  @IsOptional()
  @IsInt()
  locationId?: number;

  /*
   * INV-SHIPPING-ALLOCATION: freight (shipping) paid on this receipt,
   * allocated to item cost at posting time by the same canonical
   * allocator the direct invoice uses, so the WAC reflects the true
   * landed cost. Absent or 0 means no freight and the receipt posts
   * exactly as before. The amount must match the tenant's book
   * digits — postGoodsReceipt fails closed on a sub-minor amount.
   */
  @Transform(({ value }) => (value !== undefined && value !== null && value !== '' ? Number(value) : undefined))
  @IsOptional()
  @IsNumber()
  @Min(0)
  freight?: number;

  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierDeliveryNoteRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGoodsReceiptLineDto)
  lines!: CreateGoodsReceiptLineDto[];
}

export class CreateGrnBillLineDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  grnLineId!: number;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0.001)
  qty!: number;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0.000001)
  unitCost!: number;
}

export class CreateGrnBillDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  purchaseOrderId!: number;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  supplierId!: number;

  @IsString()
  @MaxLength(120)
  supplierInvoiceNo!: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateGrnBillLineDto)
  lines!: CreateGrnBillLineDto[];
}

export class VerifyThreeWayMatchDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  @Max(100)
  tolerancePercentage?: number;

  @IsOptional()
  @IsBoolean()
  isServiceItem?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serviceCompletionRef?: string;

  @IsOptional()
  @IsBoolean()
  allowOverride?: boolean;

  /**
   * 'price_only' clears price-tolerance blocks; 'full' also clears quantity/GRN blocks and is
   * restricted to admin roles. Defaults to the narrower scope when omitted.
   */
  @IsOptional()
  @IsString()
  @IsIn(['price_only', 'full'])
  overrideScope?: 'price_only' | 'full';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideReason?: string;
}
