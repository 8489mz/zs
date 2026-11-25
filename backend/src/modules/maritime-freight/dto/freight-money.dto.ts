import { IsString, IsNotEmpty, IsOptional, IsIn, IsBoolean, IsNumber, IsPositive, Min } from 'class-validator';

/*
 * New file: backend/src/modules/maritime-freight/dto/freight-money.dto.ts
 *
 * WHAT THIS PINS (INV-DTO-MARITIME-FREIGHT-28, D4): the maritime-freight
 * money routes now take DTO classes, so the real global
 * requestValidationPipe validates and whitelists them. Before D4 they
 * took `any` (or an inline object type) — and the pipe does nothing
 * for `any` or an inline type, so any extra field (or a wrong-typed
 * field) reached the service untouched. MONEY endpoints: every one
 * gets a positive case with the REAL caller payload in the spec.
 *
 * CALLER VERIFICATION (every field verified against the real caller
 * payload at b48be82b0):
 * - issue-invoice: JobMoneyDialogs sends { amount, notes } (the
 *   amount is client-guarded > 0). The service takes the amount
 *   when given and otherwise defaults to the job's client invoiced
 *   total, and throws when the effective amount is <= 0 — so a
 *   present amount must be positive, an absent one is fine.
 * - record-expense: JobMoneyDialogs sends { amount, expenseType,
 *   paymentMethod, description } (the carrier path goes to
 *   createCarrierInvoice instead). The service throws when the
 *   amount is <= 0 and when the job is completed, so amount stays
 *   required and positive here.
 * - settle-from-balance: JobMoneyDialogs sends { amount } or {}.
 *   The service defaults the amount to the remaining balance and
 *   throws when the amount is < 0 or over the remaining, and when
 *   an exchange rate other than 1 is given — so amount is optional
 *   with Min(0), and exchangeRate is left unconstrained: the
 *   service's own throw stays the guard.
 * - preview carrier-invoice audit: JobMoneyDialogs sends
 *   { invoicedTotal, shippingLineId, currency } (invoicedTotal
 *   client-guarded > 0; shippingLineId may be null when the job has
 *   no line). The service defaults every field (Number(... || 0)),
 *   so all are optional here; shippingLineId is string | number |
 *   null, bare-optional per the SubmitMaritimeBidDto precedent.
 * - create carrier-invoice: JobMoneyDialogs sends
 *   { invoiceNumber, totalInvoicedAmount, currency, shippingLineId,
 *   carrierName, notes }. The service throws when the total is <= 0
 *   or the invoice number is blank — both stay required here; the
 *   rest of the service type (invoiceDate, exchangeRate, the charge
 *   fields, allowOverride/overrideReason) is optional.
 * - override: FreightAuditTab sends the reason only, guarded
 *   non-empty client-side (toast + return when blank). The service
 *   stores it as override_reason.
 * - dispute: FreightAuditTab sends { reason, disputedAmount? }
 *   (disputedAmount is Number(...) || undefined). The service
 *   defaults both, so both stay optional here.
 * - resolve dispute: NO frontend caller (only the api function
 *   exists). The DTO follows the service type exactly: status is
 *   required (the service throws on anything else), the rest
 *   optional; creditNoteAmount is Min(0) (the service throws when
 *   it is < 0, and when it is non-zero on a rejected dispute — that
 *   second rule stays service-side).
 */

export class IssueJobSalesInvoiceDto {
  @IsNumber()
  @IsPositive()
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsNumber()
  @IsOptional()
  exchangeRate?: number;

  @IsString()
  @IsOptional()
  currency?: string;
}

export class RecordJobExpenseVoucherDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsIn(['carrier', 'port', 'other'])
  @IsOptional()
  expenseType?: 'carrier' | 'port' | 'other';

  @IsIn(['payable', 'cash', 'bank'])
  @IsOptional()
  paymentMethod?: 'payable' | 'cash' | 'bank';

  @IsNumber()
  @IsOptional()
  supplierId?: number;

  @IsString()
  @IsOptional()
  supplierName?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @IsOptional()
  exchangeRate?: number;
}

export class SettleJobFromBalanceDto {
  @IsNumber()
  @Min(0)
  @IsOptional()
  amount?: number;

  // The service throws when a rate other than 1 is given; the
  // constraint stays service-side, so no validator pins it here.
  @IsNumber()
  @IsOptional()
  exchangeRate?: number;
}

export class PreviewCarrierInvoiceAuditDto {
  @IsNumber()
  @IsOptional()
  invoicedTotal?: number;

  @IsNumber()
  @IsOptional()
  oceanFreight?: number;

  @IsNumber()
  @IsOptional()
  thcCharges?: number;

  @IsNumber()
  @IsOptional()
  bafCharges?: number;

  @IsNumber()
  @IsOptional()
  otherCharges?: number;

  @IsOptional()
  shippingLineId?: string | number | null;

  @IsString()
  @IsOptional()
  containerType?: string;

  @IsString()
  @IsOptional()
  currency?: string;
}

export class CreateCarrierInvoiceDto {
  @IsString()
  @IsNotEmpty()
  invoiceNumber!: string;

  @IsNumber()
  @IsPositive()
  totalInvoicedAmount!: number;

  @IsString()
  @IsOptional()
  invoiceDate?: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @IsOptional()
  exchangeRate?: number;

  @IsNumber()
  @IsOptional()
  oceanFreight?: number;

  @IsNumber()
  @IsOptional()
  thcCharges?: number;

  @IsNumber()
  @IsOptional()
  bafCharges?: number;

  @IsNumber()
  @IsOptional()
  detentionDemurrage?: number;

  @IsNumber()
  @IsOptional()
  otherCharges?: number;

  @IsOptional()
  shippingLineId?: string | number | null;

  @IsString()
  @IsOptional()
  carrierName?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  allowOverride?: boolean;

  @IsString()
  @IsOptional()
  overrideReason?: string;
}

export class OverrideCarrierInvoiceDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class CreateCarrierDisputeDto {
  @IsString()
  @IsOptional()
  reason?: string;

  @IsNumber()
  @IsOptional()
  disputedAmount?: number;
}

export class ResolveCarrierDisputeDto {
  @IsIn(['accepted', 'rejected', 'partially_accepted'])
  status!: 'accepted' | 'rejected' | 'partially_accepted';

  @IsString()
  @IsOptional()
  resolutionNotes?: string;

  @IsString()
  @IsOptional()
  creditNoteNumber?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  creditNoteAmount?: number;
}
