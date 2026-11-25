import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, Min, ValidateNested } from 'class-validator';

// INV-DTO-PILOT-PURCHASES-INVENTORY (D2 pilot): POST
// /api/purchases/:id/receive-goods took an inline body type, so the
// global validation pipe never ran on it. receivedItems is required and
// non-empty (the service throws PURCHASE_RECEIPT_EMPTY on an empty list).
// serials is typed any[] in the old inline shape and the service reads it
// opaquely, so the DTO validates only that it is an array — it does not
// impose an element type the service never promised.
export class ReceivePurchaseGoodsItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itemId!: number;

  @Type(() => Number)
  @IsNumber()
  receivedQty!: number;

  @IsOptional()
  @IsArray()
  serials?: unknown[];
}

export class ReceivePurchaseGoodsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseGoodsItemDto)
  receivedItems!: ReceivePurchaseGoodsItemDto[];
}
