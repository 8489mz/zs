import { IsString, IsNotEmpty, IsOptional, IsIn, IsBoolean, IsNumber, IsInt, IsArray, Min } from 'class-validator';

/*
 * New file: backend/src/modules/maritime-freight/dto/freight-jobs.dto.ts
 *
 * WHAT THIS PINS (INV-DTO-MARITIME-FREIGHT-28, D4): the maritime-freight
 * job routes now take DTO classes, so the real global
 * requestValidationPipe validates and whitelists them. Before D4 they
 * took `any` (dispatch-emails targetLineIds aside, which was inline) —
 * and the pipe does nothing for `any`, so any extra field (or a
 * wrong-typed field) reached the service untouched.
 *
 * CALLER VERIFICATION (every field verified against the real caller
 * payload at b48be82b0):
 * - dispatch-emails: FreightAuditTab sends { targetLineIds } (dropped
 *   to {} when undefined); the service falls back to the RFQ's stored
 *   line ids when the array is absent or empty.
 * - parse-email-text / parse-booking-text: the only callers are
 *   maritimeApi.parseEmailText (CarrierBidEntryModal, sends { text })
 *   and maritimeApi.parseBookingText (JobSmartParseDisputeDialogs,
 *   sends { text }). The service has a raw-string branch that no HTTP
 *   caller can reach (the pipe always hands it an object); a raw
 *   string body would no longer reach that branch — no such caller
 *   exists in-repo.
 * - updateJob: every field the service reads is declared optional
 *   (the service applies each field only when !== undefined), plus
 *   the caller-only fields below. PRE-EXISTING IGNORES (NOT fixed
 *   here — flagged to the parent): the service
 *   (maritime-freight-job-close.service.ts:131) never reads
 *   `isConsolidation` (sent by JobConsolidationTab when the user
 *   toggles the consolidation master), `acidNumber` /
 *   `acidIssueDate` / `acidExpiryDate` / `foreignExporterId` /
 *   `importerTaxId` (sent by JobEgyptianAciCard on save), or
 *   `siCutoffDate` / `vgmCutoffDate` / `portCutoffDate` (sent by
 *   JobExportCutoffsCard on save) — grep-proven 0 hits in the file.
 *   Those three saves are silent no-ops today (the service updates
 *   only `updated_at` and returns the job while the UI toasts
 *   success). They MUST still be declared here, or the pipe would
 *   400 those calls; the fix belongs to a later package.
 * - createContainer: the service throws when containerNumber is
 *   blank, defaults containerType to "40' HC" and freeDays to 14,
 *   and throws on a non-integer or negative freeDays and on a
 *   negative demurrageRatePerDay. jobId is required in effect (the
 *   job lookup 404s without it). Callers: JobVoyageContainerDialogs
 *   (voyage containers) and JobSmartParseDisputeDialogs (parsed
 *   containers, freeDays 14).
 * - sub-jobs: JobConsolidationTab sends { customerName, hblNumber?,
 *   cargoDescription?, packageCount, grossWeightKg, cbm,
 *   clientInvoicedTotal, currency }. The service (createJob) reads
 *   NONE of cbm / cargoDescription / clientInvoicedTotal / currency
 *   and they are not in CreateMaritimeJobDto — PRE-EXISTING IGNORE,
 *   NOT fixed here. The DTO mirrors CreateMaritimeJobDto with every
 *   field optional (the service overrides parentJobId,
 *   isConsolidationMaster, the parent's line/ports/vessel/voyage/
 *   booking/mbl/direction/transportMode/etd/eta from the parent job)
 *   plus those 4 caller fields as optional.
 */

// Transport modes a job can carry.
export const JOB_TRANSPORT_MODES = ['sea', 'air', 'road', 'multimodal'] as const;

export type JobTransportMode = (typeof JOB_TRANSPORT_MODES)[number];

// Statuses updateJob accepts (the service throws on any other value).
export const JOB_STATUSES = ['active', 'completed', 'cancelled'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

// Bill-of-lading types the voyage dialog sends.
export const JOB_BL_TYPES = ['original', 'telex_release', 'sea_waybill'] as const;

export type JobBlType = (typeof JOB_BL_TYPES)[number];

export class DispatchRfqEmailsDto {
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  targetLineIds?: number[];
}

export class ParseEmailTextDto {
  @IsString()
  @IsOptional()
  text?: string;

  @IsString()
  @IsOptional()
  rawText?: string;
}

export class ParseBookingTextDto {
  @IsString()
  @IsOptional()
  text?: string;

  @IsString()
  @IsOptional()
  rawText?: string;
}

export class UpdateJobDto {
  @IsIn(JOB_TRANSPORT_MODES)
  @IsOptional()
  transportMode?: JobTransportMode;

  @IsString()
  @IsOptional()
  airCargoType?: string;

  @IsString()
  @IsOptional()
  flightNumber?: string;

  @IsString()
  @IsOptional()
  flightDate?: string;

  @IsString()
  @IsOptional()
  mawbNumber?: string;

  @IsString()
  @IsOptional()
  hawbNumber?: string;

  @IsNumber()
  @IsOptional()
  grossWeightKg?: number;

  @IsNumber()
  @IsOptional()
  volumetricWeightKg?: number;

  @IsNumber()
  @IsOptional()
  chargeableWeightKg?: number;

  @IsNumber()
  @IsOptional()
  totalCbm?: number;

  @IsNumber()
  @IsOptional()
  packageCount?: number;

  @IsIn(JOB_STATUSES)
  @IsOptional()
  status?: JobStatus;

  @IsString()
  @IsOptional()
  vesselName?: string;

  @IsString()
  @IsOptional()
  voyageNumber?: string;

  @IsString()
  @IsOptional()
  bookingNumber?: string;

  @IsString()
  @IsOptional()
  polCode?: string;

  @IsString()
  @IsOptional()
  polName?: string;

  @IsString()
  @IsOptional()
  podCode?: string;

  @IsString()
  @IsOptional()
  podName?: string;

  @IsString()
  @IsOptional()
  etd?: string;

  @IsString()
  @IsOptional()
  eta?: string;

  @IsString()
  @IsOptional()
  portCutOff?: string;

  @IsIn(JOB_BL_TYPES)
  @IsOptional()
  blType?: JobBlType;

  @IsString()
  @IsOptional()
  mblNumber?: string;

  @IsString()
  @IsOptional()
  hblNumber?: string;

  @IsString()
  @IsOptional()
  shipperDetails?: string;

  @IsString()
  @IsOptional()
  consigneeDetails?: string;

  @IsString()
  @IsOptional()
  notifyParty?: string;

  // string | number | null, same bare-optional precedent as
  // SubmitMaritimeBidDto.shippingLineId.
  @IsOptional()
  shippingLineId?: string | number | null;

  @IsString()
  @IsOptional()
  shippingLineName?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  // ---- Caller-only fields the service ignores today (see header) ----
  // Sent by JobConsolidationTab when the user toggles the
  // consolidation master; the service never reads it.
  @IsBoolean()
  @IsOptional()
  isConsolidation?: boolean;

  // Sent by JobEgyptianAciCard on save; the service never reads them.
  @IsString()
  @IsOptional()
  acidNumber?: string;

  @IsString()
  @IsOptional()
  acidIssueDate?: string;

  @IsString()
  @IsOptional()
  acidExpiryDate?: string;

  @IsString()
  @IsOptional()
  foreignExporterId?: string;

  @IsString()
  @IsOptional()
  importerTaxId?: string;

  // Sent by JobExportCutoffsCard on save; the service never reads them.
  @IsString()
  @IsOptional()
  siCutoffDate?: string;

  @IsString()
  @IsOptional()
  vgmCutoffDate?: string;

  @IsString()
  @IsOptional()
  portCutoffDate?: string;
}

export class CreateContainerDto {
  @IsString()
  @IsNotEmpty()
  jobId!: string;

  @IsString()
  @IsNotEmpty()
  containerNumber!: string;

  @IsString()
  @IsOptional()
  containerType?: string;

  @IsString()
  @IsOptional()
  sealNumber?: string;

  @IsNumber()
  @IsOptional()
  grossWeightKg?: number;

  @IsNumber()
  @IsOptional()
  cbm?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  freeDays?: number;

  @IsString()
  @IsOptional()
  returnDeadline?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  demurrageRatePerDay?: number;

  @IsNumber()
  @IsOptional()
  depositAmount?: number;

  @IsString()
  @IsOptional()
  depositCurrency?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// A consolidation sub-job: CreateMaritimeJobDto with every field
// optional (the service overrides the parent's fields and defaults
// the customer name), plus the four caller fields createJob ignores
// (see header).
export class CreateConsolidationSubJobDto {
  @IsString()
  @IsOptional()
  inquiryId?: string;

  @IsString()
  @IsOptional()
  quotationId?: string;

  @IsString()
  @IsOptional()
  rfqId?: string;

  @IsString()
  @IsOptional()
  deliveryAddress?: string;

  // number | null, mirroring CreateMaritimeJobDto (the service does
  // Number(dto.customerId) — a string here would not typecheck
  // against Partial<CreateMaritimeJobDto>).
  @IsOptional()
  customerId?: number | null;

  @IsString()
  @IsOptional()
  customerName?: string;

  @IsIn(['import', 'export', 'cross_trade'])
  @IsOptional()
  direction?: 'import' | 'export' | 'cross_trade';

  @IsIn(JOB_TRANSPORT_MODES)
  @IsOptional()
  transportMode?: JobTransportMode;

  @IsString()
  @IsOptional()
  airCargoType?: string;

  @IsNumber()
  @IsOptional()
  grossWeightKg?: number;

  @IsNumber()
  @IsOptional()
  volumetricWeightKg?: number;

  @IsNumber()
  @IsOptional()
  chargeableWeightKg?: number;

  @IsNumber()
  @IsOptional()
  totalCbm?: number;

  @IsNumber()
  @IsOptional()
  packageCount?: number;

  @IsString()
  @IsOptional()
  flightNumber?: string;

  @IsString()
  @IsOptional()
  flightDate?: string;

  @IsString()
  @IsOptional()
  mawbNumber?: string;

  @IsString()
  @IsOptional()
  hawbNumber?: string;

  @IsIn(['prepaid', 'collect'])
  @IsOptional()
  paymentTerm?: 'prepaid' | 'collect';

  @IsOptional()
  shippingLineId?: string | number | null;

  @IsString()
  @IsOptional()
  shippingLineName?: string;

  @IsString()
  @IsOptional()
  bookingNumber?: string;

  @IsString()
  @IsOptional()
  vesselName?: string;

  @IsString()
  @IsOptional()
  voyageNumber?: string;

  @IsString()
  @IsOptional()
  polCode?: string;

  @IsString()
  @IsOptional()
  polName?: string;

  @IsString()
  @IsOptional()
  podCode?: string;

  @IsString()
  @IsOptional()
  podName?: string;

  @IsString()
  @IsOptional()
  etd?: string;

  @IsString()
  @IsOptional()
  eta?: string;

  @IsString()
  @IsOptional()
  portCutOff?: string;

  @IsIn(JOB_BL_TYPES)
  @IsOptional()
  blType?: JobBlType;

  @IsString()
  @IsOptional()
  mblNumber?: string;

  @IsString()
  @IsOptional()
  hblNumber?: string;

  @IsString()
  @IsOptional()
  shipperDetails?: string;

  @IsString()
  @IsOptional()
  consigneeDetails?: string;

  @IsString()
  @IsOptional()
  notifyParty?: string;

  // Item type mirrors CreateMaritimeJobDto exactly (the caller never
  // sends containers on a sub-job; the field exists so this DTO stays
  // assignable to Partial<CreateMaritimeJobDto>).
  @IsArray()
  @IsOptional()
  containers?: Array<{
    containerNumber: string;
    containerType: string;
    sealNumber?: string;
    grossWeightKg?: number;
    cbm?: number;
    freeDays?: number;
    depositAmount?: number;
    depositCurrency?: string;
  }>;

  @IsString()
  @IsOptional()
  parentJobId?: string;

  @IsBoolean()
  @IsOptional()
  isConsolidationMaster?: boolean;

  @IsString()
  @IsOptional()
  acidNumber?: string;

  @IsString()
  @IsOptional()
  acidIssueDate?: string;

  @IsString()
  @IsOptional()
  acidExpiryDate?: string;

  @IsString()
  @IsOptional()
  foreignExporterId?: string;

  @IsString()
  @IsOptional()
  importerTaxId?: string;

  @IsNumber()
  @IsOptional()
  quoteRoe?: number;

  @IsNumber()
  @IsOptional()
  actualRoe?: number;

  @IsNumber()
  @IsOptional()
  forexGainLoss?: number;

  @IsBoolean()
  @IsOptional()
  roeClauseAgreed?: boolean;

  @IsString()
  @IsOptional()
  siCutoffDate?: string;

  @IsString()
  @IsOptional()
  vgmCutoffDate?: string;

  @IsString()
  @IsOptional()
  portCutoffDate?: string;

  @IsArray()
  @IsOptional()
  charges?: Array<Record<string, unknown>>;

  @IsString()
  @IsOptional()
  notes?: string;

  // ---- Caller-only fields createJob ignores today (see header) ----
  @IsString()
  @IsOptional()
  cargoDescription?: string;

  @IsNumber()
  @IsOptional()
  cbm?: number;

  @IsNumber()
  @IsOptional()
  clientInvoicedTotal?: number;

  @IsString()
  @IsOptional()
  currency?: string;
}
