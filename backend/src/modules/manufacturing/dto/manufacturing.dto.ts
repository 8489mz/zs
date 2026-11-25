import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBomLineDto {
  @IsNumber()
  componentProductId!: number;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsString()
  unitName!: string;

  @IsNumber()
  @Min(0.000001)
  unitMultiplier!: number;

  @IsNumber()
  @Min(0)
  expectedCost!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99.9, { message: 'نسبة الهالك يجب ألا تتجاوز 99.9%' })
  wastePercentage?: number;
}

export class CreateBomDto {
  @IsNumber()
  productId!: number;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overheadCost?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBomLineDto)
  lines!: CreateBomLineDto[];
}

export class CreateWorkOrderDto {
  @IsNumber()
  bomId!: number;

  @IsNumber()
  @Min(0.001)
  quantityToProduce!: number;

  @IsOptional()
  @IsNumber()
  sourceLocationId?: number;

  @IsOptional()
  @IsNumber()
  destinationLocationId?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CompleteWorkOrderDto {
  @IsOptional()
  @IsNumber()
  sourceLocationId?: number;

  @IsOptional()
  @IsNumber()
  destinationLocationId?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWoOperationDto)
  operations?: CreateWoOperationDto[];

  @IsOptional()
  @IsArray()
  byProducts?: {
    productId: number;
    productName?: string;
    quantity: number;
    unitCost?: number;
    locationId?: number;
  }[];
}

export class CreateUnbuildOrderDto {
  @IsNumber()
  productId!: number;

  @IsNumber()
  bomId!: number;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  warehouseId?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateMtoWorkOrderDto {
  @IsNumber()
  salesOrderId!: number;

  @IsNumber()
  productId!: number;

  @IsNumber()
  @Min(0.001)
  quantityToProduce!: number;

  @IsOptional()
  @IsNumber()
  bomId?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpsertWorkCenterDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPerHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capacity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  timeEfficiency?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateWoOperationDto {
  @IsNumber()
  workCenterId!: number;

  @IsString()
  operationName!: string;

  @IsOptional()
  @IsNumber()
  sequence?: number;

  @IsNumber()
  @Min(0.01)
  durationHours!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyCost?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
