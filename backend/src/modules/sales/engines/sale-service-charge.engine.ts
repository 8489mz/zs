import { AppError } from '../../../common/errors/app-error';
import { type MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

/**
 * R4-A (INV-REST-SALE-MONEY-TRUTH): the dine-in service charge is a
 * tenant decision, not a client assertion — the Tax F1 shape applied
 * to the restaurant charge.
 *
 * The frontend computes the charge for dine-in only as
 * (subtotal - discount) x percent, percent default 12
 * (usePosWorkspaceDerived.ts, settings.schema.ts), and the held-draft
 * bill recomputes the same formula server-side
 * (computeTableBillTotals, percent default 12, fail-closed on a
 * garbled rate with TABLE_BILL_RATE_INVALID). This engine is the
 * third, shared formulation of that rule, used by createSale and
 * updateSale so the stored sales.service_charge, the totals, the
 * tender allocation and postSale all consume the same truth.
 *
 * Scoping (the storefront trap): only a POS sale may be recomputed.
 * A storefront order can reach createSale with orderType 'dine_in',
 * no service charge, and a paid total computed without one — an
 * unscoped recompute would invent a charge the customer never paid
 * and the tender gate would throw INVALID_PAID_AMOUNT (or silently
 * book credit). A non-POS source therefore returns null: the caller
 * keeps the charge exactly as sent. Van pre-sales and quotations
 * send no orderType / service charge and are safe at 0.
 *
 * Returns the charge to store, or null to leave the sent charge
 * untouched (non-POS source only).
 */
export const DEFAULT_SERVICE_CHARGE_PERCENT = 12;
const MAX_RATE_PERCENT = 100;

export type SaleServiceChargeInput = {
  orderType: string | null | undefined;
  source: string | null | undefined;
  enabled: unknown;
  percent: unknown;
  netBase: number;
  digits: MoneyDigits;
};

function isEnabled(value: unknown): boolean {
  // Settings arrive JSON-parsed (boolean true) or raw (string
  // 'true'); the held-draft reader compares to 'true' only because
  // its map stays raw. Accept both shapes here.
  return value === true || value === 'true';
}

function resolvePercent(value: unknown): number {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return DEFAULT_SERVICE_CHARGE_PERCENT;
  }
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE_PERCENT) {
    throw new AppError(
      'نسبة رسم الخدمة غير صالحة: يجب أن تكون رقماً بين 0 و100',
      'TABLE_BILL_RATE_INVALID',
      400,
    );
  }
  return rate;
}

export function resolveSaleServiceCharge(input: SaleServiceChargeInput): number | null {
  if (String(input.source || '').trim() !== 'pos') return null;
  if (String(input.orderType || '').trim() !== 'dine_in') return 0;
  if (!isEnabled(input.enabled)) return 0;
  const percent = resolvePercent(input.percent);
  const base = Math.max(0, Number(input.netBase || 0));
  return roundMoney((base * percent) / 100, input.digits);
}
