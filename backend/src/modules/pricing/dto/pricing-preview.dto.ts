import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class PricingFiltersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds?: number[];

  @IsOptional()
  @IsIn(['standard', 'fashion'])
  itemKind?: 'standard' | 'fashion';

  @IsOptional()
  @IsString()
  styleCode?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  activeOnly?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  inStockOnly?: boolean;
}

export class PricingOperationDto {
  @IsIn(['percent_increase', 'percent_decrease', 'fixed_increase', 'fixed_decrease', 'set_price', 'margin_from_cost'])
  type!:
    'percent_increase' | 'percent_decrease' | 'fixed_increase' | 'fixed_decrease' | 'set_price' | 'margin_from_cost';

  @Type(() => Number)
  @IsNumber()
  value!: number;
}

export class PricingRoundingDto {
  @IsIn(['none', 'nearest', 'ending'])
  mode!: 'none' | 'nearest' | 'ending';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  nearestStep?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ending?: number;
}

export class PricingOptionsDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  applyToWholeStyleCode?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  applyToPricingGroup?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  skipActiveOffers?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  skipCustomerPrices?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  skipManualExceptions?: boolean;
}

export class PricingSafeguardsDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  preventBelowCost?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  skipActiveOffers?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  skipManualExceptions?: boolean;
}

class PricingProfilePayloadDto {
  @IsIn(['standard', 'inherit', 'manual'])
  pricingMode!: 'standard' | 'inherit' | 'manual';

  @IsOptional()
  @IsString()
  pricingGroupKey?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  preserveExistingGroupKey?: boolean;
}

export class PricingRuleUpsertDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id?: number;

  @IsString()
  name!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingFiltersDto)
  filters?: PricingFiltersDto;

  @ValidateNested()
  @Type(() => PricingOperationDto)
  operation!: PricingOperationDto;

  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['retail', 'wholesale'], { each: true })
  targets!: Array<'retail' | 'wholesale'>;

  @ValidateNested()
  @Type(() => PricingRoundingDto)
  rounding!: PricingRoundingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingOptionsDto)
  options?: PricingOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingSafeguardsDto)
  safeguards?: PricingSafeguardsDto;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class PricingRuleListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @IsOptional()
  @IsIn(['standard', 'fashion'])
  itemKind?: 'standard' | 'fashion';

  @IsOptional()
  @IsString()
  styleCode?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  activeOnly?: boolean;
}

export class PricingRuleMatchDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @IsOptional()
  @IsIn(['standard', 'fashion'])
  itemKind?: 'standard' | 'fashion';

  @IsOptional()
  @IsString()
  styleCode?: string;
}

export class PricingPagingDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class PricingPreviewDto {
  @ValidateNested()
  @Type(() => PricingFiltersDto)
  filters!: PricingFiltersDto;

  @ValidateNested()
  @Type(() => PricingOperationDto)
  operation!: PricingOperationDto;

  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['retail', 'wholesale'], { each: true })
  targets!: Array<'retail' | 'wholesale'>;

  @ValidateNested()
  @Type(() => PricingRoundingDto)
  rounding!: PricingRoundingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingOptionsDto)
  options?: PricingOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingSafeguardsDto)
  safeguards?: PricingSafeguardsDto;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingPagingDto)
  paging?: PricingPagingDto;
}

export class PricingUndoDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  runId!: number;
}

export class PricingBulkSetProfileDto {
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds!: number[];

  @ValidateNested()
  @Type(() => PricingProfilePayloadDto)
  profile!: PricingProfilePayloadDto;
}

export type PricingPreviewPayload = {
  paging?: {
    page?: number;
    pageSize?: number;
  };

  filters: {
    supplierId?: number;
    categoryId?: number;
    productIds?: number[];
    itemKind?: 'standard' | 'fashion';
    styleCode?: string;
    q?: string;
    activeOnly?: boolean;
    inStockOnly?: boolean;
  };
  operation: {
    type:
      'percent_increase' | 'percent_decrease' | 'fixed_increase' | 'fixed_decrease' | 'set_price' | 'margin_from_cost';
    value: number;
  };
  targets: Array<'retail' | 'wholesale'>;
  rounding: {
    mode: 'none' | 'nearest' | 'ending';
    nearestStep?: number;
    ending?: number;
  };
  options: {
    applyToWholeStyleCode: boolean;
    applyToPricingGroup: boolean;
    skipActiveOffers: boolean;
    skipCustomerPrices: boolean;
    skipManualExceptions: boolean;
  };
  safeguards?: {
    preventBelowCost?: boolean;
    skipActiveOffers?: boolean;
    skipManualExceptions?: boolean;
  };
  reason?: string;
};

export type PricingPreviewRow = {
  productId: number;
  name: string;
  barcode: string;
  itemKind: 'standard' | 'fashion';
  styleCode: string;
  pricingMode: 'standard' | 'inherit' | 'manual';
  pricingGroupKey: string;
  stockQty: number;
  costPrice: number;
  retailPriceBefore: number;
  retailPriceAfter: number;
  wholesalePriceBefore: number;
  wholesalePriceAfter: number;
  hasActiveOffer: boolean;
  hasCustomerPrice: boolean;
  skipped: boolean;
  skipReasons: string[];
  changed: boolean;
  belowCostAfter: boolean;
};
