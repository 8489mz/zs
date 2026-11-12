import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

class ReturnItemDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  productId!: number;

  @IsOptional()
  @IsString()
  productName?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  saleItemId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  purchaseItemId?: number;

  // Required for ambiguous pharmacy purchase returns; single-batch returns can auto-resolve.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  batchId?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serials?: string[];

  @IsOptional()
  @IsString()
  batchNumber?: string;
}

export class CreateReturnDto {
  @IsIn(['sale', 'purchase'])
  type!: 'sale' | 'purchase';

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  invoiceId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];

  @IsOptional()
  @IsIn(['refund', 'store_credit'])
  settlementMode?: 'refund' | 'store_credit';

  @IsOptional()
  @IsIn(['cash', 'card'])
  refundMethod?: 'cash' | 'card';

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  managerPin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  refundOverrideReason?: string;

  /* INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: reprice the kept pieces
   * at original price and forfeit the header discount entirely on a
   * partial sale return (never pro-rata). The backend computes the
   * refund; the dialog only displays it. */
  @IsOptional()
  @IsBoolean()
  forfeitHeaderDiscount?: boolean;

  /* Final goods refund the merchant asks for (computed refund +
   * goodwill). Must sit inside [computed, goodwillCap]; the extra
   * above the computed refund is the goodwill amount and needs
   * goodwillRefundReason plus manager approval for non-admins. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  goodwillRefundAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  goodwillRefundReason?: string;
}
