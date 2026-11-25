/*
 * D5 sales — sales-order DTOs converted from interfaces to
 * classes (Rule 5, in place).
 *
 * CreateSalesOrderDto (MONEY): the caller payload matches the
 * interface field for field (useCreateSalesOrderForm /
 * SalesOrdersPage). Quantity is @Min(0), not @Min(1): fractional
 * quantities exist, and the service owns the > 0 bar. The
 * service's money assert reconciles subtotal / discount /
 * tax / total against the lines, so the DTO mirrors the
 * interface's required money fields and rejects negatives.
 *
 * UpdateSalesOrderDto stays an interface extending
 * Partial<CreateSalesOrderDto> — the update site is NOT one of
 * the 27 census sites (it is not a whole-body route), so it is
 * out of D5 scope.
 */

import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class SalesOrderItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsString()
  @IsNotEmpty()
  productName!: string;

  @IsOptional()
  @IsString()
  unitName?: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsNumber()
  @Min(0)
  total!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateSalesOrderDto {
  @IsOptional()
  @IsNumber()
  customerId?: number | null;

  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  customerAddress?: string;

  @IsOptional()
  @IsNumber()
  branchId?: number | null;

  /**
   * INV-SALES-ORDER-WAREHOUSE-SELECTION: the warehouse the order
   * reserves from. When given, approval validates/reserves stock in
   * THIS warehouse; when omitted, the branch's default selling
   * warehouse applies (previous behaviour, kept).
   */
  @IsOptional()
  @IsNumber()
  warehouseLocationId?: number | null;

  @IsNumber()
  @Min(0)
  subtotal!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsNumber()
  @Min(0)
  totalAmount!: number;

  @IsOptional()
  @IsString()
  reservationExpiresAt?: string | null;

  @IsOptional()
  @IsString()
  deliveryDate?: string | null;

  @IsOptional()
  @IsNumber()
  quotationId?: number | null;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  termsConditions?: string;

  @IsOptional()
  @IsBoolean()
  autoReserve?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderItemDto)
  items!: SalesOrderItemDto[];
}

export interface UpdateSalesOrderDto extends Partial<CreateSalesOrderDto> {
  status?: 'draft' | 'confirmed' | 'partially_delivered' | 'delivered' | 'converted' | 'cancelled';
}
