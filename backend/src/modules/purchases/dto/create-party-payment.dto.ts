import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateSupplierPaymentDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  supplierId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsIn(['cash', 'bank', 'card', 'wallet', 'instapay'])
  paymentChannel?: 'cash' | 'bank' | 'card' | 'wallet' | 'instapay';

  /* INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT: true marks this payment as a
   * supplier ADVANCE, not a settlement of a payable. An advance posts
   * Dr 1185 Supplier Advances / Cr cash-or-bank, leaves the supplier
   * payable balance untouched, and is skipped by the no-balance /
   * overpayment / reserved-schedule guards (a true advance needs no
   * outstanding balance). False/absent keeps the old behaviour:
   * Dr 2110 / Cr cash-or-bank against the payable. */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isAdvance?: boolean;

  /* INV-INSTAPAY-FIELD-MISSING: the counterparty InstaPay account number
   * (IPA) this payment was sent to. Stored only when the channel is
   * 'instapay' (see normalizeInstapayAddress); the global validation
   * pipe is whitelist + forbidNonWhitelisted, so without this field
   * the value could never reach the service. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  instapayAddress?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  branchId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  locationId?: number;
}

export class CreateCustomerPaymentDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  customerId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsIn(['cash', 'bank', 'card', 'wallet', 'instapay'])
  paymentChannel?: 'cash' | 'bank' | 'card' | 'wallet' | 'instapay';

  /* INV-INSTAPAY-FIELD-MISSING: the customer InstaPay account number
   * (IPA) this receipt came from. Stored only when the channel is
   * 'instapay' (see normalizeInstapayAddress). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  instapayAddress?: string;

  /* INV-REP-NONCASH-EVIDENCE-GATE (PD1): the real transfer reference
   * (bank / card / wallet / InstaPay transaction reference) of this
   * receipt. Mandatory for any non-cash channel — the service gate
   * refuses the receipt without one. Stored in
   * customer_payments.transfer_reference; cash receipts store NULL. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  transferReference?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  branchId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  locationId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  jobId?: number;
}

/* INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT: apply part or all of a supplier
 * advance (created with isAdvance) against a later bill. Posts
 * Dr 2110 / Cr 1185 and reduces both the payable and the outstanding
 * advance. `amount` is capped at the outstanding advance AND at the
 * supplier payable balance; `purchaseId` is optional — when given,
 * the bill must belong to the same supplier and not be cancelled. */
export class ApplySupplierAdvanceDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  purchaseId?: number;
}
