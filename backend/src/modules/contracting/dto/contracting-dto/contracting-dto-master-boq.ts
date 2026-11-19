import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMasterBoqLibraryItemDto {
  @IsString()
  @IsNotEmpty()
  tradeCategory!: string;

  @IsString()
  @IsNotEmpty()
  tradeNameAr!: string;

  @IsString()
  @IsNotEmpty()
  itemCode!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  unit!: string;

  @IsNumber()
  @Min(0)
  standardCost!: number;

  @IsNumber()
  @Min(0)
  standardPrice!: number;
}

export class UpdateMasterBoqLibraryItemDto {
  @IsString()
  @IsOptional()
  tradeCategory?: string;

  @IsString()
  @IsOptional()
  tradeNameAr?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  standardCost?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  standardPrice?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class BatchImportMasterBoqDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMasterBoqLibraryItemDto)
  items!: CreateMasterBoqLibraryItemDto[];
}

export class ToggleMasterBoqItemStatusDto {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ImportMasterBoqToProjectDto {
  @IsArray()
  itemIds!: (string | number)[];
}

// 1. BOQ Takeoffs DTOs
export class BoqTakeoffItemDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  boqItemId?: string;

  @IsString()
  @IsOptional()
  drawingRef?: string;

  @IsString()
  @IsOptional()
  axisRef?: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsNumber()
  @Min(0)
  length!: number;

  @IsNumber()
  @Min(0)
  width!: number;

  @IsNumber()
  @Min(0)
  height!: number;

  @IsNumber()
  @Min(0.01)
  countMultiplier!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  voidDeduction?: number;

  @IsNumber()
  @IsOptional()
  netQty?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  wastePercent?: number;

  @IsNumber()
  @IsOptional()
  totalWithWaste?: number;

  @IsNumber()
  @IsOptional()
  calculatedQty?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  createdAt?: string;

  @IsString()
  @IsOptional()
  updatedAt?: string;
}

export class SaveBoqTakeoffsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BoqTakeoffItemDto)
  takeoffs!: BoqTakeoffItemDto[];

  @IsOptional()
  syncToBoqQuantity?: boolean;
}

// 2. Site Mobilization DTOs
