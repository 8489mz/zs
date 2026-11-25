import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

// INV-DTO-PILOT-PURCHASES-INVENTORY (D2 pilot): POST
// /api/inventory/smart-replenishment/execute took an inline body type,
// so the global validation pipe never ran on it. The DTO mirrors the
// shape the service cleans: items is required and non-empty (the service
// throws on an empty list), while per-item productId/qty carry no @Min —
// the service FILTERS non-positive values instead of throwing, and the
// all-filtered case still throws at the service level.
export class ReplenishmentItemDto {
  @Type(() => Number)
  @IsInt()
  productId!: number;

  @Type(() => Number)
  @IsNumber()
  qty!: number;
}

export class ExecuteReplenishmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fromLocationId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  toLocationId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReplenishmentItemDto)
  items!: ReplenishmentItemDto[];

  @IsOptional()
  @IsString()
  note?: string;
}
