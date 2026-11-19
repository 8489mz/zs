import { IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateMasterPriceItemDto {
  @IsString()
  @IsIn(['material', 'labor', 'equipment', 'subcontract'])
  itemType!: 'material' | 'labor' | 'equipment' | 'subcontract';

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @Min(0)
  unitRate!: number;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateMasterPriceItemDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitRate?: number;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateEngineeringConstantDto {
  @IsString()
  @IsNotEmpty()
  itemCode!: string;

  @IsString()
  @IsNotEmpty()
  itemName!: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  wastePercent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  overheadPercent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  profitMarkupPercent?: number;

  @IsArray()
  @IsOptional()
  components?: any[];

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AutoPriceBoqItemDto {
  @IsString()
  @IsNotEmpty()
  constantCode!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  customWastePercent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  customOverheadPercent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  customProfitMarkupPercent?: number;
}

export class CreateCostSnapshotDto {
  @IsString()
  @IsNotEmpty()
  snapshotName!: string;
}
