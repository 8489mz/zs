import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

// INV-DTO-PILOT-PURCHASES-INVENTORY (D2 pilot): the three purchase-order
// DTOs were interfaces — the global validation pipe does nothing for an
// interface, so a caller could send any extra field (or a wrong-typed
// field) and it reached the service untouched. They are now classes,
// every field decorated, so the pipe validates and whitelists them.
// The rules mirror the service throws exactly: items is required and
// non-empty (assertOrderItems throws on an empty list), quantity carries
// no @Min (the service throws on quantity <= 0 — the DTO does not
// duplicate that check), submitForApproval is a boolean under
// enableImplicitConversion (a string "false" coerces to true — pinned in
// dto-purchases-inventory.spec.ts), and status is the full 6-value union
// the interface declared (the service narrows it to 'draft' itself).
export class PurchaseOrderItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId!: number;

  @IsString()
  productName!: string;

  @IsOptional()
  @IsString()
  unitName?: string;

  @Type(() => Number)
  @IsNumber()
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  receivedQuantity?: number;

  @Type(() => Number)
  @IsNumber()
  unitCost!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  taxRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  discount?: number;

  @Type(() => Number)
  @IsNumber()
  total!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreatePurchaseOrderDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number | null;

  @IsString()
  supplierName!: string;

  @IsOptional()
  @IsString()
  supplierPhone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouseId?: number | null;

  @IsOptional()
  @IsString()
  warehouseName?: string;

  @Type(() => Number)
  @IsNumber()
  subtotal!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  taxAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  discountAmount?: number;

  @Type(() => Number)
  @IsNumber()
  totalAmount!: number;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string | null;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  termsConditions?: string;

  /**
   * When true, the order is created and immediately run through the
   * same approval check as confirmOrder (INV-PURCHASE-ORDER-DRAFT-APPROVE):
   * 'confirmed' when no approval rule applies, 'pending_approval' when
   * one does. When false/omitted the order stays a server-side draft.
   * The status is never taken from the client: only this intent flag is.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  submitForApproval?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];
}

export class UpdatePurchaseOrderDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number | null;

  @IsOptional()
  @IsString()
  supplierName?: string;

  @IsOptional()
  @IsString()
  supplierPhone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouseId?: number | null;

  @IsOptional()
  @IsString()
  warehouseName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  subtotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  taxAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  discountAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalAmount?: number;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string | null;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  termsConditions?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  submitForApproval?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items?: PurchaseOrderItemDto[];

  @IsOptional()
  @IsIn(['draft', 'confirmed', 'partially_received', 'received', 'converted_to_bill', 'cancelled'])
  status?: 'draft' | 'confirmed' | 'partially_received' | 'received' | 'converted_to_bill' | 'cancelled';
}
