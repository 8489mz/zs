import { IsString, IsNumber, IsOptional, Min, IsIn, IsInt, IsPositive, IsBoolean, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateShipmentCostsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingCostUsd?: number;

  @IsOptional()
  @IsString()
  shippingAccountId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  customsCostEgp?: number;

  @IsOptional()
  @IsString()
  customsAccountId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  internalTransportCostEgp?: number;

  @IsOptional()
  @IsString()
  transportAccountId?: string;

  // INV-IMPORT-SUPPLIER-ATTRIBUTION: the explicit supplier each
  // cost component is owed to. Recorded before posting; a nonzero
  // component with no payee and no unallocable reason fails the
  // receipt closed. Null (omitted) leaves the stored payee
  // untouched; an explicit null clears it (see the service: the
  // payload mapping treats null as clear, undefined as untouched).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  freightSupplierId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customsSupplierId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  transportSupplierId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  demurrageSupplierId?: number;

  // Recorded reason when a cost component is genuinely
  // unallocable: the component posts to the tenant-designated
  // clearing account, labelled with this reason. An empty string
  // clears the recorded reason.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  unallocableCostReason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  exchangeRateAtArrival?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pricingExchangeRate?: number;

  @IsOptional()
  @IsIn(['Pending', 'In Customs', 'Arrived'])
  status?: string;

  @IsOptional()
  @IsString()
  shippedDate?: string;

  @IsOptional()
  @IsString()
  etaDate?: string;

  @IsOptional()
  @IsString()
  clearanceDate?: string;

  @IsOptional()
  @IsString()
  form4Number?: string;

  @IsOptional()
  @IsString()
  form4Date?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  receiptLocationId?: number;

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
  @Type(() => Number)
  @IsNumber()
  actualDemurrageFees?: number;

  @IsOptional()
  @IsString()
  customsDeclarationNo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  vatRefundableEgp?: number;

  // INV-IMPORT-LANDED-COST-DUTY-VAT: see CreateShipmentDto —
  // the itemized customs tax rates and the CIF insurance. They
  // freeze with the posted receipt (service), like the other
  // valuation fields; a nonzero rate needs the customs payee
  // (or a recorded unallocable reason) before the receipt posts.
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

  // INV-IMPORT-FORM4-CLEARANCE-GATE: see CreateShipmentDto —
  // the funding type may be corrected before clearance/receipt.
  // It freezes with the posted receipt (service) and feeds the
  // gate on every clearance/receipt transition in the same call.
  @IsOptional()
  @IsIn(['bank_transfer', 'cash_carried'])
  fundingType?: 'bank_transfer' | 'cash_carried';
}
