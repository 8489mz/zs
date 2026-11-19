import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateImportProjectDto {
  @IsOptional()
  @IsString()
  projectNo?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  targetMarket?: string;

  @IsOptional()
  @IsString()
  countryOrigin?: string;

  @IsOptional()
  @IsString()
  countryDestination?: string;

  @IsOptional()
  @IsString()
  budgetCurrency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  allocatedCapital?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  targetRoiPercentage?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  feasibilityData?: any;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  sectorPreset?: string;

  @IsOptional()
  @IsArray()
  partners?: Array<{ partnerId?: string; name?: string; capitalShare?: number; profitPercentage: number }>;
}

export class UpdateImportProjectDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  targetMarket?: string;

  @IsOptional()
  @IsString()
  countryOrigin?: string;

  @IsOptional()
  @IsString()
  countryDestination?: string;

  @IsOptional()
  @IsString()
  budgetCurrency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  allocatedCapital?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  targetRoiPercentage?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  feasibilityData?: any;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  sectorPreset?: string | null;
}
