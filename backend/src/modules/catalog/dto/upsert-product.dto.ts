import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

class ProductUnitDto {
  @IsString()
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  multiplier!: number;

  @IsOptional()
  @IsString()
  barcode?: string;

  @Type(() => Boolean)
  @IsBoolean()
  isBaseUnit!: boolean;

  @Type(() => Boolean)
  @IsBoolean()
  isSaleUnit!: boolean;

  @Type(() => Boolean)
  @IsBoolean()
  isPurchaseUnit!: boolean;
}

class ProductOfferDto {
  @IsIn(['percent', 'fixed', 'price', 'bundle', 'bogo'])
  type!: 'percent' | 'fixed' | 'price' | 'bundle' | 'bogo';

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  minQty?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  bogoBuyQty?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  bogoGetQty?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  bogoDiscountPercent?: number;

  @IsOptional()
  @IsString()
  happyHourStart?: string;

  @IsOptional()
  @IsString()
  happyHourEnd?: string;

  @IsOptional()
  @IsString()
  daysOfWeek?: string;
}

class ProductCustomerPriceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customerId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;
}

class ProductFashionVariantDto {
  @IsString()
  color!: string;

  @IsString()
  size!: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  retailPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  wholesalePrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minStock?: number;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class UpsertProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  nameEn?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsIn(['product', 'raw_material', 'service'])
  itemType?: 'product' | 'raw_material' | 'service';

  @IsOptional()
  @IsIn(['standard', 'fashion'])
  itemKind?: 'standard' | 'fashion';

  @IsOptional()
  @IsString()
  styleCode?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsString()
  binLocation?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  trackSerials?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value == null || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  categoryId?: number;

  @IsOptional()
  @Transform(({ value }) => (value == null || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  supplierId?: number;

  @IsOptional()
  @Transform(({ value }) => (value == null || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  warehouseId?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPrice!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  retailPrice!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  wholesalePrice!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditPrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  consumerPrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minSellingPrice?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minStock!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ProductUnitDto)
  units!: ProductUnitDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductOfferDto)
  offers?: ProductOfferDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ProductCustomerPriceDto)
  customerPrices?: ProductCustomerPriceDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => ProductFashionVariantDto)
  fashionVariants?: ProductFashionVariantDto[];

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;

  @IsOptional()
  metadata?: Record<string, any>;

  @IsOptional()
  @Transform(({ value }) => (value == null || value === '' ? undefined : Number(value)))
  @IsNumber()
  variantStock?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isCombo?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  comboComponents?: any[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  calories?: number | null;

  @IsOptional()
  @IsArray()
  allergens?: string[];

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isSpicy?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isVegetarian?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isGlutenFree?: boolean;
}

export type NormalizedProductUnit = {
  name: string;
  multiplier: number;
  barcode: string;
  isBaseUnit: boolean;
  isSaleUnit: boolean;
  isPurchaseUnit: boolean;
};

export type NormalizedProductOffer = {
  type: 'percent' | 'fixed' | 'price' | 'bundle' | 'bogo';
  value: number;
  minQty: number;
  from: string | null;
  to: string | null;
  bogoBuyQty?: number | null;
  bogoGetQty?: number | null;
  bogoDiscountPercent?: number | null;
  happyHourStart?: string | null;
  happyHourEnd?: string | null;
  daysOfWeek?: string | null;
};

export type NormalizedProductCustomerPrice = {
  customerId: number;
  price: number;
};

export type NormalizedFashionVariant = {
  color: string;
  size: string;
  barcode: string;
  stock: number;
  costPrice?: number;
  retailPrice?: number;
  wholesalePrice?: number;
  minStock?: number;
  sku?: string;
  /** Per-variant photo. Undefined = inherit the parent photo on create;
   * '' = no photo. Stored in the child row's metadata.imageUrl. */
  imageUrl?: string;
};

export class FashionGroupRowDto extends UpsertProductDto {
  @IsOptional()
  @IsString()
  expectedCatalogUpdatedAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id?: number;
}

export class SaveFashionGroupDto {
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => FashionGroupRowDto)
  rows!: FashionGroupRowDto[];

  @IsOptional()
  @IsBoolean()
  consolidateStock?: boolean;

  @IsOptional()
  @IsBoolean()
  zeroRemovedStock?: boolean;
}

export type NormalizedUpsertProduct = {
  name: string;
  nameEn?: string | null;
  barcode: string;
  sku: string;
  itemType: 'product' | 'raw_material' | 'service';
  itemKind: 'standard' | 'fashion';
  styleCode: string;
  color: string;
  size: string;
  binLocation?: string;
  trackSerials?: boolean;
  categoryId: number | null;
  supplierId: number | null;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  creditPrice?: number | null;
  consumerPrice?: number | null;
  minSellingPrice?: number | null;
  minStock: number;
  notes: string;
  units: NormalizedProductUnit[];
  offers: NormalizedProductOffer[];
  customerPrices: NormalizedProductCustomerPrice[];
  fashionVariants: NormalizedFashionVariant[];
  icon?: string;
  imageUrl?: string;
  metadata?: Record<string, any>;
  stock?: number;
  warehouseId?: number;
  calories?: number | null;
  allergens?: string[];
  isSpicy?: boolean;
  isVegetarian?: boolean;
  isGlutenFree?: boolean;
};
