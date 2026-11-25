/*
 * D5 sales — installment DTOs converted from interfaces to
 * classes (Rule 5, in place).
 *
 * CreateInstallmentPlanDto: the caller (CreateInstallmentPlanModal)
 * sends exactly these fields (firstDueDate = startDate). The
 * service's own bars are mirrored here: totalAmount must be
 * positive after rounding; installmentCount 1..600.
 *
 * PayInstallmentDto: the caller (the InstallmentsPage pay modal)
 * sends { amount, paymentMethod, notes } only — no
 * transferReference, no receiptNo (both stay optional).
 * paymentMethod is REQUIRED in the DTO: the interface marked it
 * optional, but the service THROWS INSTALLMENT_PAYMENT_METHOD_
 * REQUIRED when it is missing and the only caller always sends
 * it (defaults 'cash').
 */

import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateInstallmentPlanDto {
  @IsOptional()
  @IsNumber()
  saleId?: number | null;

  @IsInt()
  @Min(1)
  customerId!: number;

  @IsNumber()
  @Min(0)
  totalAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  downPayment?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  interestRatePercent?: number;

  @IsInt()
  @Min(1)
  @Max(600)
  installmentCount!: number;

  @IsOptional()
  @IsString()
  startDate?: string;

  // INV-INSTALLMENT-FIRST-DUE-DATE: the entered first-installment due
  // date. When supplied, the schedule starts on it; when absent, the
  // schedule keeps the old shape (first due one month after start).
  @IsOptional()
  @IsString()
  firstDueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  branchId?: number | null;
}

export class PayInstallmentDto {
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsIn(['cash', 'card', 'bank_transfer', 'instapay'])
  paymentMethod!: 'cash' | 'card' | 'bank_transfer' | 'instapay';

  /* INV-INSTALLMENT-PAYMENT-CHANNEL: the real transfer reference
   * (bank / card / InstaPay transaction reference) of this payment.
   * Mandatory for any non-cash method — the service gate refuses
   * the payment without one (same bar as the general-receipt gate,
   * INV-REP-NONCASH-EVIDENCE-GATE). Stored in
   * customer_payments.transfer_reference; cash stores NULL. */
  @IsOptional()
  @IsString()
  transferReference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  receiptNo?: string;
}

export interface ListInstallmentsQueryDto {
  planId?: number;
  customerId?: number;
  status?: string;
  dueFrom?: string;
  dueTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}
