import { IsString, IsNotEmpty, IsOptional, IsIn, IsBoolean } from 'class-validator';
import type { PivotMetric } from '../engines/pivot-aggregation.engine';

export class ExecuteDynamicPivotDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['sales', 'purchases', 'inventory', 'expenses'])
  dataset!: 'sales' | 'purchases' | 'inventory' | 'expenses';

  @IsString()
  @IsNotEmpty()
  rowDimension!: string;

  @IsOptional()
  @IsString()
  colDimension?: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['total_amount', 'net_profit', 'quantity', 'count', 'avg_amount', 'net_profit_percent'])
  metric!: PivotMetric;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  branchId?: number;
}

export class SavePivotTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  dataset!: string;

  @IsString()
  @IsNotEmpty()
  rowDimension!: string;

  @IsOptional()
  @IsString()
  colDimension?: string;

  @IsString()
  @IsNotEmpty()
  metric!: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  filters?: any;

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;
}
