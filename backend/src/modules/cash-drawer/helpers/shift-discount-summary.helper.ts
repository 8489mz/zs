import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export type ShiftDiscountSummaryInput = {
  /** SUM of sales.discount over the shift's posted sales (header/manual + loyalty). */
  headerDiscountTotal: number;
  /** SUM of sale_items.line_discount over the shift's posted sales. */
  lineDiscountTotal: number;
  /**
   * Gross sales = SUM of sales.subtotal (net of line discounts) +
   * SUM of sale_items.line_discount, over the same posted sales.
   * Same gross definition the F1a rep cap uses.
   */
  grossSalesTotal: number;
  /** Tenant book digits — required, never silently 2dp. */
  digits: MoneyDigits;
};

export type ShiftDiscountSummary = {
  /** Total discounts the cashier made: header + per-line, at book digits. */
  discountTotal: number;
  /** Gross sales the % is taken against, at book digits. */
  grossSalesTotal: number;
  /** discountTotal / grossSalesTotal * 100, at book digits; 0 when gross is 0. */
  discountPercent: number;
};

/**
 * INV-SHIFT-CLOSE-DISCOUNT-SUMMARY: the shift-close discount summary
 * is the discounts the CASHIER made — the header discount (manual
 * invoice discount + loyalty) PLUS the per-line discounts — over the
 * shift's posted sales only, as a % of GROSS sales (subtotal + line
 * discounts). The F8 system cash discount
 * (sales.system_cash_discount_amount) is automatic, not made by the
 * cashier, so it is never part of this total: the caller must not
 * feed it in. Returns are not in the sum either: return documents
 * are a separate aggregation (computeShiftSaleReturnTotals). Pure:
 * no database, no clock — the caller supplies the three sums and
 * the tenant book digits, and the arithmetic is pinned here.
 */
export function computeShiftDiscountSummary(input: ShiftDiscountSummaryInput): ShiftDiscountSummary {
  const header = Number(input.headerDiscountTotal || 0);
  const line = Number(input.lineDiscountTotal || 0);
  const gross = Number(input.grossSalesTotal || 0);
  const digits = input.digits;
  const discountTotal = roundMoney(header + line, digits);
  const grossSalesTotal = roundMoney(gross, digits);
  const discountPercent = grossSalesTotal > 0 ? roundMoney((discountTotal * 100) / grossSalesTotal, digits) : 0;
  return { discountTotal, grossSalesTotal, discountPercent };
}
