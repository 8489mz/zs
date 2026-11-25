import { AppError } from '../../../common/errors/app-error';
import { type MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

/**
 * Dine-in table-bill totals (INV-TABLE-BILL-DIGITS-AND-RATE-VALIDATION).
 *
 * Pure engine for the held-draft branch of getActiveTableBill and for
 * the pay-at-table total. The bill formulas are the service's own and
 * are preserved exactly — service charge on (subtotal - discount),
 * tax on (subtotal - discount + service charge), taxable base floored
 * at zero — with two changes only:
 *
 * 1. Every derived amount rounds through the canonical engine at the
 *    tenant's book digits (required), never at a hard-coded 2 decimals.
 *    The subtotal and discount pass through raw, exactly as the service
 *    returns them; only service charge, tax, and total round. This
 *    engine deliberately does NOT delegate to computeInvoiceTotals:
 *    that engine rounds every result to 3 decimals internally, which
 *    would overstate a 2-decimal tenant's bill.
 * 2. Both configured rates fail closed. A rate is absent (undefined,
 *    null, or blank) only when the tenant never set it — tax then
 *    means 0, service percent then means the 12 default. Any present
 *    rate must be a finite number in [0, 100]; a garbled, negative, or
 *    over-100 rate throws TABLE_BILL_RATE_INVALID instead of silently
 *    producing a zero or absurd charge. The service-charge percent is
 *    validated only while service charge is enabled: a disabled charge
 *    ignores a stale percent, as it always did.
 *
 * Rates arrive as unknown because settings store strings; numeric
 * strings ("15") are accepted, exactly as the service's old Number()
 * coercion accepted them.
 */

const DEFAULT_SERVICE_CHARGE_PERCENT = 12;
const MAX_RATE_PERCENT = 100;

function resolveRate(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return fallback;
  }
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE_PERCENT) {
    throw new AppError(`نسبة ${label} غير صالحة: يجب أن تكون رقماً بين 0 و100`, 'TABLE_BILL_RATE_INVALID', 400);
  }
  return rate;
}

export type TableBillTotalsInput = {
  subtotal: number;
  discount: number;
  serviceChargeEnabled: boolean;
  serviceChargePercent: unknown;
  taxRate: unknown;
  digits: MoneyDigits;
};

export type TableBillTotals = {
  subtotal: number;
  discount: number;
  serviceCharge: number;
  taxableBase: number;
  tax: number;
  total: number;
};

export function computeTableBillTotals(input: TableBillTotalsInput): TableBillTotals {
  const taxRate = resolveRate(input.taxRate, 0, 'الضريبة');
  const serviceChargePercent = input.serviceChargeEnabled
    ? resolveRate(input.serviceChargePercent, DEFAULT_SERVICE_CHARGE_PERCENT, 'رسم الخدمة')
    : 0;
  const serviceCharge = input.serviceChargeEnabled
    ? roundMoney((input.subtotal - input.discount) * (serviceChargePercent / 100), input.digits)
    : 0;
  const taxableBase = Math.max(0, input.subtotal - input.discount + serviceCharge);
  const tax = taxRate > 0 ? roundMoney(taxableBase * (taxRate / 100), input.digits) : 0;
  const total = roundMoney(taxableBase + tax, input.digits);
  return { subtotal: input.subtotal, discount: input.discount, serviceCharge, taxableBase, tax, total };
}

/** Pay-at-table total: the bill total plus the guest's tip, at book digits. The caller clamps a negative tip to zero, as before. */
export function computeTableBillPaymentTotal(billTotal: number, tipAmount: number, digits: MoneyDigits): number {
  return roundMoney(Number(billTotal || 0) + Number(tipAmount || 0), digits);
}
