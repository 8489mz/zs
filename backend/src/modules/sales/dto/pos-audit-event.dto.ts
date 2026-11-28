import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class PosAuditCartItemDto {
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  productId?: number;

  @IsString()
  @MaxLength(255)
  productName!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qty!: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  previousQty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  unitName?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lineTotal!: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;
}

export type PosAuditEventType =
  | 'no_sale'
  | 'cart_remove'
  | 'draft_cancel'
  | 'qty_decrease'
  | 'receipt_reprint'
  | 'weighted_barcode_replay';

export class PosAuditEventDto {
  @IsIn(['no_sale', 'cart_remove', 'draft_cancel', 'qty_decrease', 'receipt_reprint', 'weighted_barcode_replay'])
  eventType!: PosAuditEventType;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  branchId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  saleId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  saleDocNo?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  productId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  productName?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  qty?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  previousQty?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  removedValue?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  total?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  cartItemsCount?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosAuditCartItemDto)
  items?: PosAuditCartItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceBarcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  terminalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  managerPin?: string;
}
