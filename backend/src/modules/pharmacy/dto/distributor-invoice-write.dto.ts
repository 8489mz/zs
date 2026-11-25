/*
 * D10 — pharmacy distributor-invoice write DTO (new file; 1 site).
 *
 * Caller traps (verified against pharmacy.api.ts + the distributor
 * invoice engine at 7413c4f3e):
 * - invoiceNumber is REQUIRED though the caller type marks it optional
 *   (the service 422s when it is missing, empty, or longer than 100
 *   chars — D5 precedent).
 * - lines must be a NON-EMPTY array (the engine throws otherwise);
 *   quantity must be positive and prices non-negative (the engine
 *   enforces both); expiryDate is required by the slice type and the
 *   caller always sends it.
 * - supplierId / locationId / paymentType are accepted though the
 *   caller never sends them (the service accepts them).
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class DistributorInvoiceLineDto {
  @IsString()
  @IsNotEmpty()
  productName!: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bonusQuantity?: number;

  @IsNumber()
  @Min(0)
  publicPrice!: number;

  @IsNumber()
  @Min(0)
  costPrice!: number;

  @IsString()
  expiryDate!: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;
}

export class ImportDistributorInvoiceDto {
  // The service trims both fields before its blank/length checks, so the
  // pipe trims too — a whitespace-only value is rejected, like the service.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  distributor!: string;

  @IsOptional()
  @IsNumber()
  supplierId?: number;

  @IsOptional()
  @IsNumber()
  locationId?: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  invoiceNumber!: string;

  @IsOptional()
  @IsString()
  invoiceDate?: string;

  @IsOptional()
  @IsEnum(['credit', 'cash'])
  paymentType?: 'credit' | 'cash';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DistributorInvoiceLineDto)
  lines!: DistributorInvoiceLineDto[];
}
