import { IsString, IsNumber, IsOptional, Min, IsIn, IsInt, IsPositive, IsArray, ValidateNested, IsBoolean, IsNotEmpty, MaxLength } from 'class-validator';
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

  @IsOptional()
  @IsBoolean()
  isConsolidated?: boolean;

  @IsOptional()
  @IsIn(['value', 'weight', 'cbm'])
  costAllocationMethod?: 'value' | 'weight' | 'cbm';
}

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

  @IsOptional()
  @IsBoolean()
  isConsolidated?: boolean;

  @IsOptional()
  @IsIn(['value', 'weight', 'cbm'])
  costAllocationMethod?: 'value' | 'weight' | 'cbm';
}

export class AddShipmentItemDto {
  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  factoryUnitPriceUsd!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitWeightKg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitCbm?: number;

  @IsOptional()
  @IsString()
  hsCode?: string;
}

export class UpdateShipmentItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  receivedQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  targetRetailMargin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  targetWholesaleMargin?: number;

  @IsOptional()
  @IsIn(['capitalize', 'expense'])
  shortageHandlingMethod?: 'capitalize' | 'expense';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitWeightKg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitCbm?: number;

  @IsOptional()
  @IsString()
  hsCode?: string;
}

export class RecordForeignTransferDto {
  @IsString()
  supplierId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amountEgp!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amountForeign!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  exchangeRateContract?: number;

  @IsOptional()
  @IsString()
  proformaInvoiceId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bankAccountId?: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  transferDate?: string;

  @IsOptional()
  @IsString()
  approvalRequestId?: string;

  @IsOptional()
  @IsIn(['bank_transfer', 'cash_carried', 'letter_of_credit', 'cash_against_documents', 'open_account'])
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  paymentReference?: string;

  @IsOptional()
  @IsString()
  bankSwiftCode?: string;

  @IsOptional()
  @IsString()
  form4Number?: string;

  @IsOptional()
  @IsString()
  form4Date?: string;

  @IsOptional()
  @IsString()
  carrierName?: string;

  @IsOptional()
  @IsString()
  travelDate?: string;

  @IsOptional()
  @IsString()
  handoverReceiptNo?: string;

  @IsOptional()
  @IsString()
  lcNumber?: string;

  @IsOptional()
  @IsString()
  lcIssuingBank?: string;

  @IsOptional()
  @IsString()
  lcExpiryDate?: string;

  @IsOptional()
  @IsString()
  lcDocuments?: string;

  @IsOptional()
  @IsString()
  cadHandoverProof?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  paymentDueDate?: string;
}

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

export class CalculateFeasibilityDto {
  @IsArray()
  items!: Array<{
    name: string;
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

export class CreateQcInspectionDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsString()
  stage!: string;

  @IsString()
  inspectionDate!: string;

  @IsOptional()
  @IsString()
  inspectorName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sampleSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  passedQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  failedQuantity?: number;

  @IsOptional()
  @IsString()
  defectNotes?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  reportFileUrl?: string;
}

export class UpsertAciComplianceDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsString()
  acidNumber!: string;

  @IsOptional()
  @IsString()
  acidIssueDate?: string;

  @IsOptional()
  @IsString()
  acidExpiryDate?: string;

  @IsOptional()
  @IsString()
  cargoxDocumentId?: string;

  @IsOptional()
  @IsString()
  importerTaxNumber?: string;

  @IsOptional()
  @IsString()
  exporterId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  complianceChecklist?: any;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateSourcingTripDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  tripTitle!: string;

  @IsString()
  destinationCity!: string;

  @IsString()
  startDate!: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  budgetEgp?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  actualCostEgp?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  findings?: any;
}

export class ProcessLateExpenseDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  lateExpenseAmount!: number;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  payableAccountId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  // INV-IMPORT-SUPPLIER-ATTRIBUTION: the explicit supplier this
  // late expense is owed to. Exactly one of supplierId /
  // unallocableReason must be supplied: a late expense is never
  // silently attributed to the goods supplier. When
  // unallocableReason is recorded, the credit posts to the
  // tenant-designated clearing account, labelled with the reason.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  unallocableReason?: string;
}

export class CalculateCustomsTaxDto {
  @IsString()
  hsCode!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cifValueEgp!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overrideDutyRatePercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overrideVatRatePercent?: number;
}

export class VerifyBankDetailsDto {
  @IsOptional()
  @IsString()
  verificationNotes?: string;
}


export class CreateQuotationDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  supplierId!: string;

  @IsString()
  quotationNo!: string;

  @IsOptional()
  @IsString()
  inquiryDate?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  incoterm?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  itemName!: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPriceForeign!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  moq?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productionLeadDays?: number;

  @IsOptional()
  @IsString()
  portOfLoading?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estimatedFreightUsd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estimatedCustomsRatePercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  exchangeRate?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SelectQuotationDto {
  @IsOptional()
  @IsString()
  selectionReason?: string;
}

export class CreateSampleOrderDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  supplierId!: string;

  @IsString()
  sampleCode!: string;

  @IsString()
  itemName!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sampleCostForeign?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  freightCostForeign?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  requestDate?: string;

  @IsOptional()
  @IsString()
  courierTrackingNo?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateSampleOrderInspectionDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  qualityScore?: number;

  @IsOptional()
  @IsIn(['pending', 'approved_reference', 'rejected', 'rework_requested'])
  decision?: string;

  @IsOptional()
  @IsBoolean()
  referenceSampleApproved?: boolean;

  @IsOptional()
  @IsString()
  defectAnalysis?: string;

  @IsOptional()
  @IsArray()
  photoUrls?: string[];

  @IsOptional()
  @IsString()
  receivedDate?: string;
}

export class ConvertFeasibilityToProjectDto {
  @IsString()
  projectId!: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  targetPort?: string;

  @IsOptional()
  @IsNumber()
  advancePaymentPercentage?: number;
}

export class ProformaInvoiceItemDto {
  @IsOptional()
  @IsNumber()
  productId?: number;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  qty?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitPriceForeign?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  factoryPriceUsd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitPriceUsd?: number;

  @IsOptional()
  @IsString()
  hsCode?: string;
}

export class CreateProformaInvoiceDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  supplierId!: string;

  @IsString()
  piNumber!: string;

  @IsString()
  piDate!: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalAmountForeign!: number;

  @IsOptional()
  @IsString()
  incoterm?: string;

  @IsOptional()
  @IsString()
  deliveryPort?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  exchangeRateContract?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  advancePercentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  balancePercentage?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProformaInvoiceItemDto)
  items?: ProformaInvoiceItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateCustomsBrokerDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  licenseNo?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsArray()
  customsPorts?: string[];

  @IsOptional()
  @IsString()
  taxNumber?: string;

  @IsOptional()
  @IsString()
  commercialRegistry?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class DisburseBrokerAdvanceDto {
  @IsString()
  brokerId!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsString()
  advanceNo!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amountEgp!: number;

  @IsOptional()
  @IsString()
  disbursementDate?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  treasuryAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class LiquidateBrokerExpenseDto {
  @IsString()
  brokerId!: string;

  @IsOptional()
  @IsString()
  advanceId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsString()
  receiptNo!: string;

  @IsOptional()
  @IsString()
  expenseDate?: string;

  @IsIn(['customs_duty', 'vat', 'port_fees', 'demurrage', 'inspection', 'broker_fee', 'transport', 'other'])
  category!: 'customs_duty' | 'vat' | 'port_fees' | 'demurrage' | 'inspection' | 'broker_fee' | 'transport' | 'other';

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amountEgp!: number;

  @IsOptional()
  @IsBoolean()
  isCapitalized?: boolean;

  @IsOptional()
  @IsBoolean()
  isRefundableVat?: boolean;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordContainerDepositDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  shipmentId!: string;

  @IsString()
  containerNo!: string;

  @IsString()
  shippingLine!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  depositAmountEgp!: number;

  @IsOptional()
  @IsString()
  paymentDate?: string;

  @IsString()
  expectedReturnDate!: string;

  @IsOptional()
  @IsString()
  treasuryAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordContainerReturnRefundDto {
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsString()
  actualReturnDate!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  refundedAmountEgp!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deductionsAmountEgp?: number;

  @IsOptional()
  @IsString()
  deductionReason?: string;

  @IsOptional()
  @IsString()
  treasuryAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateContainerPreorderDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  shipmentId!: string;

  @IsString()
  customerId!: string;

  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  reservedQuantity!: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  unitPriceEgp!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  depositAmountEgp?: number;

  @IsOptional()
  @IsString()
  depositTreasuryAccountId?: string;

  @IsOptional()
  @IsString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ConvertPreorderToSaleDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  branchId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  locationId?: number;
}

export class RefundImportPreorderDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amountEgp!: number;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  treasuryAccountId?: string;
}

export class RecordFxAcquisitionDto {
  @IsString()
  currency!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  foreignAmount!: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  egpCost!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  exchangeRate?: number;

  @IsOptional()
  @IsString()
  acquisitionDate?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** EGP source (cash/bank) account the EGP was paid from. Defaults via the bank resolver; must differ from the destination account. */
  @IsOptional()
  @IsString()
  sourceAccountId?: string;

  /** Foreign transfer (supplier payment id) this acquisition funds. The transfer's currency must match the acquisition currency. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  transferId?: number;
}

export class PostSourcingTripExpenseDto {
  @IsString()
  @IsNotEmpty()
  approvalRequestId!: string;

  /** Tenant supplier the trip expense is owed to (the payable leg's partner). */
  @Type(() => Number)
  @IsNumber()
  supplierId!: number;

  /** Expense-type account the trip cost posts to (validated as an expense account, never defaulted). */
  @Type(() => Number)
  @IsNumber()
  expenseAccountId!: number;
}

export class CreateImportDocumentDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsString()
  documentType!: string;

  @IsString()
  fileName!: string;

  @IsString()
  fileUrl!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fileSizeBytes?: number;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  issueDate?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateApprovalRequestDto {
  @IsIn(['supplier_bank_change', 'large_transfer', 'broker_settlement', 'partner_distribution', 'project_closure', 'import_receipt_reversal', 'import_legacy_receipt_review', 'broker_expense_verification', 'sourcing_trip_expense'])
  actionType!: 'supplier_bank_change' | 'large_transfer' | 'broker_settlement' | 'partner_distribution' | 'project_closure' | 'import_receipt_reversal' | 'import_legacy_receipt_review' | 'broker_expense_verification' | 'sourcing_trip_expense';

  @IsString()
  referenceId!: string;

  @IsOptional()
  requestPayload?: any;
}

export class CloseImportProjectDto {
  @IsString()
  @IsNotEmpty()
  approvalRequestId!: string;
}

export class ReverseImportReceiptDto {
  @IsString()
  @IsNotEmpty()
  approvalRequestId!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class ResolveLegacyReceiptDto {
  @IsString()
  @IsNotEmpty()
  approvalRequestId!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class VerifyBrokerExpenseDto {
  @IsString()
  @IsNotEmpty()
  approvalRequestId!: string;
}

export class DecideApprovalRequestDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  decisionNotes?: string;

  @IsOptional()
  @IsString()
  comments?: string;
}

export class ResolveExceptionDto {
  @IsString()
  resolutionNotes!: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class RecordPartnerPayoutDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'مبلغ صرف الأرباح يجب أن يكون أكبر من الصفر.' })
  amount!: number;

  @IsString()
  @IsNotEmpty({ message: 'معرّف طلب الاعتماد (approvalRequestId) إلزامي لصرف أرباح الشركاء وفق سياسة Maker-Checker.' })
  approvalRequestId!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  treasuryAccountId?: string;
}
