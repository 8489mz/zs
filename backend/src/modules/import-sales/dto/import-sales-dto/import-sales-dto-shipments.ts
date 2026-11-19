import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateShipmentDto {
  @IsString()
  containerNumber!: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  arrivalDate?: string;

  @IsOptional()
  @IsString()
  billOfLading?: string;

  @IsOptional()
  @IsString()
  shippingDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  exchangeRateAtArrival?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pricingExchangeRate?: number;

  @IsOptional()
  @IsString()
  freightType?: string;

  @IsOptional()
  @IsString()
  containerSize?: string;

  @IsOptional()
  @IsString()
  portOfLoading?: string;

  @IsOptional()
  @IsString()
  portOfDischarge?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  cbmVolume?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  grossWeightKg?: number;

  @IsOptional()
  @IsString()
  carrierName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  freeDemurrageDays?: number;

  @IsOptional()
  @IsString()
  demurrageStartDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  demurrageRatePerDay?: number;

  @IsOptional()
  @IsString()
  customsDeclarationNo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vatRefundableEgp?: number;

  // INV-IMPORT-LANDED-COST-DUTY-VAT: itemized customs tax,
  // carried from the feasibility study when the shipment is
  // created from it (explicit values win; a missing study rate
  // falls back to the feasibility engine's own 5% / 14%
  // defaults). The flat customs_cost_egp stays a clearance fee,
  // never the tax. insuranceCostUsd belongs in the CIF basis
  // (goods + freight + insurance), without which the shipment
  // could never reproduce the study's duty/VAT.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  customsDutyRatePercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  vatRatePercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  insuranceCostUsd?: number;

  @IsOptional()
  @IsBoolean()
  isConsolidated?: boolean;

  @IsOptional()
  @IsIn(['value', 'weight', 'cbm'])
  costAllocationMethod?: 'value' | 'weight' | 'cbm';

  // INV-IMPORT-FORM4-CLEARANCE-GATE: how this shipment's goods
  // are funded. Bank-channel funding above USD 2,000 requires a
  // Form 4 before clearance/receipt; cash carried by a traveller
  // is exempt (no bank-issued Form 4 exists). Defaults to
  // bank_transfer (the common case) when omitted; the service
  // persists that default so the gate always has a method to
  // key on — a shipment with no funding rows no longer slips
  // through as "unrecorded funding".
  @IsOptional()
  @IsIn(['bank_transfer', 'cash_carried'])
  fundingType?: 'bank_transfer' | 'cash_carried';
}
