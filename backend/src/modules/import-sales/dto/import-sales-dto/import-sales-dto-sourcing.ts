import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CalculateFeasibilityDto {
  @IsArray()
  items!: Array<{
    name: string;
    /** I6-A: link to the real inventory item, carried through the
     * feasibility engine to the output items natively. */
    productId?: number;
    hsCode?: string;
    qty: number;
    factoryPriceUsd: number;
    unitWeightKg?: number;
    unitCbm?: number;
    expectedLocalMarketPriceEgp?: number;
  }>;

  @IsOptional()
  @IsString()
  currency?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  exchangeRateCommercial!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  exchangeRateCustoms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  travelAndSourcingCostEgp?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  internationalShippingUsd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  insuranceUsd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  customsDutyRatePercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vatRatePercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  clearanceAndPortFeesEgp?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  internalTransportEgp?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bankCommissionAndFinancingEgp?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  targetMarkupPercent?: number;

  @IsOptional()
  @IsBoolean()
  vatIsRefundable?: boolean;
}

export class CreateChinaSupplierDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  chineseName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  moqDescription?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  productionLeadTimeDays?: number;

  @IsOptional()
  @IsString()
  bankBeneficiary?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankSwift?: string;

  @IsOptional()
  @IsString()
  bankAccount?: string;

  @IsOptional()
  @IsArray()
  incotermsAccepted?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpsertSupplierMetaDto {
  @IsOptional()
  @IsString()
  chineseName?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  moqDescription?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  productionLeadTimeDays?: number;

  @IsOptional()
  verifiedBankDetails?: any;

  @IsOptional()
  @IsArray()
  incotermsAccepted?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  qcRating?: number;

  @IsOptional()
  @IsArray()
  qualityCertifications?: string[];

  @IsOptional()
  @IsString()
  auditStatus?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
