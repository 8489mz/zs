import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class StockTransferBatchAllocationDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  batchId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;
}

class StockTransferItemDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  productId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;

  /** Source IMEIs/serial numbers. Required for ambiguous partial transfers. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serials?: string[];

  /** Explicit batch distribution, expressed in base stock units. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockTransferBatchAllocationDto)
  batchAllocations?: StockTransferBatchAllocationDto[];
}

export class CreateStockTransferDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-1)
  fromLocationId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  toLocationId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  toBranchId?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  carrierEmployeeId?: number;

  @IsOptional()
  @IsString()
  carrierName?: string;

  @IsOptional()
  @IsString()
  managerPin?: string;

  @IsOptional()
  @IsString()
  issueMode?: 'final_issue' | 'transfer_to_branch_stock';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockTransferItemDto)
  items!: StockTransferItemDto[];
}
