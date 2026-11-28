import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class DamagedBatchAllocationDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  batchId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;
}

export class CreateDamagedStockDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  productId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serials?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DamagedBatchAllocationDto)
  batchAllocations?: DamagedBatchAllocationDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  branchId?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  locationId!: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsString()
  note!: string;

  @IsOptional()
  @IsString()
  managerPin?: string;

  @IsOptional()
  @IsString()
  evidenceImageUrl?: string;
}
