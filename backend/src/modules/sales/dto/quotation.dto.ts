/*
 * D5 sales — quotation DTOs: QuotationItemDto and
 * UpdateQuotationDto converted from interfaces to classes
 * (Rule 5, in place).
 *
 * CreateQuotationDto STAYS an interface — it is NOT converted
 * here, and that is deliberate, not an oversight. TWO
 * declarations share the name: this sales interface (the
 * controller imports it) and a real decorated class
 * CreateQuotationDto in
 * modules/import-sales/dto/import-sales-dto/import-sales-dto-commercial.ts
 * (a completely different shape: projectId, supplierId,
 * quotationNo, itemName, unitPriceForeign). The census
 * classifier's declaration index is first-seen-wins across the
 * whole tree, so the sales create site resolves to the
 * import-sales CLASS and is counted dto-class — while in reality
 * the controller imports the sales INTERFACE and the pipe does
 * nothing for it. The create site is unvalidated today and NOT
 * in the census list (the true unvalidated population is 265,
 * not 264 — a census-script name-collision blind spot). Fixing
 * the script (resolve declarations per-import) and converting
 * the sales CreateQuotationDto belongs in a later package, NOT
 * D5 (the task forbids converting a site the census does not
 * list). Extra trap for whoever converts it later: the create
 * caller (CreateQuotationPage) sends tax_rate + tax_amount per
 * item, and the sales createQuotation service NEVER reads them
 * (it inserts product_id, product_name, unit_name, quantity,
 * unit_price, discount, total, notes only) — converting without
 * tax_rate? / tax_amount? on items would 400 the create call.
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

  @IsNumber()
  @Min(0)
  total!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export interface CreateQuotationDto {
  customerId?: number | null;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  branchId?: number | null;
  subtotal: number;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount: number;
  validUntil?: string;
  notes?: string;
  termsConditions?: string;
  items: QuotationItemDto[];
  // I10-A (R8): creation-time status. Only 'sent' may be set here —
  // the approve-and-save button issues the quotation instead of
  // leaving it a draft. 'accepted' is the customer's response and
  // 'converted' is set by convertToSale; both are rejected by the
  // service whitelist, which fails closed to 'draft'.
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
