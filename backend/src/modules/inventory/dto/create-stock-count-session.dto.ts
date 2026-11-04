import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

class StockCountBatchDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  batchId?: number;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  countedQty!: number;
}

class StockCountItemDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  productId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  countedQty!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  countedSerials?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockCountBatchDto)
  batchCounts?: StockCountBatchDto[];

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateStockCountSessionDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  locationId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  branchId?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockCountItemDto)
  items!: StockCountItemDto[];
}

export class PostStockCountSessionDto {
  @IsOptional()
  @IsString()
  adminPassword?: string;

  @IsOptional()
  @IsString()
  managerPin?: string;
}

export class RecountStockCountItemDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  countedQty!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  countedSerials?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockCountBatchDto)
  batchCounts?: StockCountBatchDto[];

  @IsString()
  @MinLength(1)
  reason!: string;
}
