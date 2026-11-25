/*
 * D5 sales — quotation DTOs: QuotationItemDto and
 * UpdateQuotationDto converted from interfaces to classes
 * (Rule 5, in place).
 *
 * Package C — CreateQuotationDto is converted here (it STAYED an
 * interface in D5 deliberately: TWO declarations share the name —
 * this sales interface and the import-sales CLASS in
 * modules/import-sales/dto/import-sales-dto/import-sales-dto-commercial.ts
 * — and the census classifier's first-seen-wins index resolved the
 * sales create site to the import-sales class, counting it dto-class
 * while the pipe did nothing for it. Package C fixes the script to
 * resolve declarations per-import, which reveals the site as
 * dto-interface, then converts it). The tax trap from D5 is handled:
 * the create caller sends tax_rate + tax_amount per item and the
 * service never reads them, so QuotationItemDto carries them as
 * optional @IsNumber @Min(0) fields — without them the nested
 * forbidNonWhitelisted check 400s every real create call (proven by
 * RED-2: 'الحقل أصناف الطلب > tax_rate غير مسموح إرساله').
 * productId stays required: quotation_items.product_id is integer
 * NOT NULL (migration 2040000000021), so an item without it fails at
 * the DB today (500) and the pipe turns it into a 400.
 *
 * UpdateQuotationDto: ZERO frontend callers (no page calls the
 * update endpoint), so the positive case is the interface shape
 * itself. A class cannot extend Omit<Partial<...>> of an
 * interface, so the fields are spelled out explicitly — all
 * optional, with the full lifecycle status vocabulary.
 */

import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class QuotationItemDto {
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

  // Package C: the create caller (CreateQuotationPage.handleSubmit)
  // ALWAYS sends these per item (Number(item.tax_rate) || 0 /
  // Number(item.tax_amount) || 0) and the service NEVER reads them.
  // They must be whitelisted here or the nested
  // forbidNonWhitelisted check 400s every real create call (proven by
  // RED-2: 'الحقل أصناف الطلب > tax_rate غير مسموح إرساله').
  @IsOptional()
  @IsNumber()
  @Min(0)
  tax_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tax_amount?: number;

  @IsNumber()
  @Min(0)
  total!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateQuotationDto {
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
  validUntil?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  termsConditions?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items!: QuotationItemDto[];

  // I10-A (R8): creation-time status. Only 'sent' may be set here —
  // the approve-and-save button issues the quotation instead of
  // leaving it a draft. 'accepted' is the customer's response and
  // 'converted' is set by convertToSale; both are rejected by the
  // service whitelist, which fails closed to 'draft'.
  @IsOptional()
  @IsIn(['draft', 'sent'])
  status?: 'draft' | 'sent';
}

export class UpdateQuotationDto {
  @IsOptional()
  @IsNumber()
  customerId?: number | null;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  customerAddress?: string;

  @IsOptional()
  @IsNumber()
  branchId?: number | null;

  @IsOptional()
  @IsNumber()
  subtotal?: number;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  taxAmount?: number;

  @IsOptional()
  @IsNumber()
  totalAmount?: number;

  @IsOptional()
  @IsString()
  validUntil?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  termsConditions?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items?: QuotationItemDto[];

  // Update keeps the full lifecycle vocabulary; creation (above) is
  // narrowed to 'draft' | 'sent'.
  @IsOptional()
  @IsIn(['draft', 'sent', 'accepted', 'rejected', 'converted'])
  status?: 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted';
}
