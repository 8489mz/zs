import { AppError } from '../../../common/errors/app-error';

/**
 * R4-A (INV-REST-SALE-MONEY-TRUTH): sales-order money is recomputed
 * from the lines, never trusted from the client-supplied header.
 *
 * The dashboard form's arithmetic is the contract (see
 * CreateSalesOrderPage.tsx):
 * - subtotal is GROSS: sum(qty x unitPrice) over the lines, before
 *   any discount. It is NOT the sum of the per-line totals.
 * - discountAmount FOLDS the line discounts in: it is the line
 *   discount total plus the global (header) discount.
 * - total = max(0, subtotal - discountAmount) + taxAmount.
 * - a per-line total is max(0, qty x unitPrice - discount).
 *
 * That is why the helper takes the header discountAmount (line
 * discounts included) and NOT the global remainder: the conversion
 * seam splits it back into line discounts + global discount
 * (resolveConversionDiscounts), and the sale writer's own total is
 * sum(line totals) - globalDiscount + tax — the same number.
 *
 * Tolerance is 0.001, the same as the conversion discount
 * reconciliation: stored rows are compared with each other, never
 * with settings, and dashboard float hair sits far below it.
 */
export const SALES_ORDER_MONEY_TOLERANCE = 0.001;

export type SalesOrderMoneyItem = {
  quantity: number | string | null;
  unitPrice: number | string | null;
  discount?: number | string | null;
  total?: number | string | null;
};

export type SalesOrderMoney = {
  lineTotals: number[];
  subtotal: number;
  total: number;
};

function failLine(): never {
  throw new AppError(
    'إجمالي بند أمر البيع لا يطابق الكمية × السعر − الخصم',
    'SALES_ORDER_LINE_MISMATCH',
    400,
  );
}

function failTotal(): never {
  throw new AppError(
    'إجمالي أمر البيع لا يطابق البنود والخصم والضريبة',
    'SALES_ORDER_TOTAL_MISMATCH',
    400,
  );
}

export function recomputeSalesOrderMoney(
  items: SalesOrderMoneyItem[],
  discountAmount: number | string | null,
  taxAmount: number | string | null,
): SalesOrderMoney {
  const headerDiscount = Number(discountAmount ?? 0);
  const tax = Number(taxAmount ?? 0);
  if (!Number.isFinite(headerDiscount) || headerDiscount < 0) failTotal();
  if (!Number.isFinite(tax) || tax < 0) failTotal();

  const lineTotals = items.map((item) => {
    const qty = Number(item.quantity ?? 0);
    const price = Number(item.unitPrice ?? 0);
    const discount = Number(item.discount ?? 0);
    if (!Number.isFinite(qty) || !Number.isFinite(price) || !Number.isFinite(discount)) failLine();
    if (qty < 0 || price < 0 || discount < 0) failLine();
    const gross = qty * price;
    // A line discount above its gross is nonsense data, not a zero
    // line: conversion already fails closed on it
    // (CONVERSION_DISCOUNT_MISMATCH), and create must not store a
    // row conversion would refuse.
    if (discount > gross + SALES_ORDER_MONEY_TOLERANCE) failLine();
    return Math.max(0, gross - discount);
  });

  // Gross subtotal: sum(qty x price), before any discount.
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0), 0);
  const total = Math.max(0, subtotal - headerDiscount) + tax;
  return { lineTotals, subtotal, total };
}

/**
 * Compare a recomputation against stored values. Only the fields
 * the caller passes are checked, so the two call sites share the
 * one recompute but assert what each of them owns:
 * - createOrder asserts lines + subtotal + total (the whole DTO is
 *   client-supplied, so the whole DTO is verified before storage).
 * - convertToSale asserts the total only: per-line totals are
 *   deliberately NOT read at conversion (a stale per-line total is
 *   inert display data — the sale is recomputed from qty/price/
 *   discount alone), and the stored subtotal is not an input to
 *   the payment leg.
 */
export function assertSalesOrderMoney(
  recomputed: SalesOrderMoney,
  stored: {
    lineTotals?: Array<number | string | null>;
    subtotal?: number | string | null;
    total?: number | string | null;
  },
): void {
  if (stored.lineTotals !== undefined) {
    if (stored.lineTotals.length !== recomputed.lineTotals.length) failLine();
    for (let index = 0; index < recomputed.lineTotals.length; index += 1) {
      const expected = Number(stored.lineTotals[index] ?? 0);
      if (!Number.isFinite(expected)) failLine();
      if (Math.abs(expected - recomputed.lineTotals[index]) > SALES_ORDER_MONEY_TOLERANCE) failLine();
    }
  }
  if (stored.subtotal !== undefined) {
    const expected = Number(stored.subtotal ?? 0);
    if (!Number.isFinite(expected)) failTotal();
    if (Math.abs(expected - recomputed.subtotal) > SALES_ORDER_MONEY_TOLERANCE) failTotal();
  }
  if (stored.total !== undefined) {
    const expected = Number(stored.total ?? 0);
    if (!Number.isFinite(expected)) failTotal();
    if (Math.abs(expected - recomputed.total) > SALES_ORDER_MONEY_TOLERANCE) failTotal();
  }
}
