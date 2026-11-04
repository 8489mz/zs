import { AppError } from '../errors/app-error';

export type FlowItem = {
  productId: number;
  qty: number;
  unitMultiplier?: number;
  lineId?: number;
  /** Selling price (sale lines) or unit cost (purchase lines, as `cost`). */
  price?: number;
  cost?: number;
};

export type PaymentEntry = {
  paymentChannel: 'cash' | 'card' | 'wallet' | 'instapay';
  amount: number;
};

/**
 * Legacy two-decimal rounding ONLY (INV-ROUND-MONEY-COLLISION-RESOLVED).
 * This is deliberately NOT the canonical money rounder: the canonical
 * roundMoney lives in the money-minor-units engine and takes the
 * tenant's book digits (2 or 3). This function hard-codes 2 decimals
 * and swallows non-finite input to 0, and is kept under this explicit
 * name only for the sale-payment validation below, which has no
 * tenant-digits context today. Never import this for a posting or a
 * stored amount — that is what the canonical engine is for.
 */
export function roundMoneyToTwoDecimals(value: number): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return sign * (Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100);
}

export function roundQty(value: number): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return sign * (Math.round((Math.abs(n) + Number.EPSILON) * 1000) / 1000);
}

/*
 * INV-SPIRIT-DUPLICATE-LINES: two lines for the same product and unit
 * at DIFFERENT prices are two lines, not a duplicate — only an exact
 * duplicate (same product, unit and price) is rejected. The price
 * segment reads the caller's own field: `price` on normalized sale
 * lines, `cost` on purchase lines; callers without a price (stock
 * transfers, line-id returns) keep the previous product-and-unit
 * identity. The COGS remainder grouping is unaffected: it groups by
 * product and FROZEN COST (sale_items.cost_price), never by selling
 * price, so two price lines for one product aggregate into one cost
 * group exactly as two same-price lines do.
 */
export function ensureUniqueFlowItems(items: FlowItem[], code: string, message: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (item.lineId) {
      const key = `line::${item.lineId}`;
      if (seen.has(key)) throw new AppError(message, code, 400);
      seen.add(key);
      continue;
    }
    const price = item.price != null ? Number(item.price) : item.cost != null ? Number(item.cost) : null;
    const key = price == null
      ? `${Number(item.productId)}::${Number(item.unitMultiplier || 1)}`
      : `${Number(item.productId)}::${Number(item.unitMultiplier || 1)}::${price}`;
    if (seen.has(key)) throw new AppError(message, code, 400);
    seen.add(key);
  }
}

export function ensureNonNegativeStock(afterQty: number, code = 'INSUFFICIENT_STOCK', message = 'Stock cannot go negative'): void {
  if (roundQty(afterQty) < 0) throw new AppError(message, code, 409);
}

export function ensureReturnQtyWithinLimit(requestedQty: number, alreadyReturnedQty: number, invoiceQty: number): void {
  const requested = roundQty(requestedQty);
  const alreadyReturned = roundQty(alreadyReturnedQty);
  const soldOrPurchased = roundQty(invoiceQty);
  if (requested <= 0) {
    throw new AppError('Return quantity must be greater than zero', 'RETURN_QTY_INVALID', 400);
  }
  if (requested + alreadyReturned > soldOrPurchased + 0.0001) {
    throw new AppError('Return quantity exceeds the remaining quantity on the invoice', 'RETURN_QTY_EXCEEDED', 400);
  }
}

export function validateSalePayments(params: {
  paymentType: 'cash' | 'credit';
  collectibleTotal: number;
  payments: PaymentEntry[];
}): { paidAmount: number } {
  const collectibleTotal = roundMoneyToTwoDecimals(params.collectibleTotal);
  const payments = params.payments || [];

  if (params.paymentType === 'credit') {
    if (payments.length) {
      throw new AppError('Credit sale must not include immediate payment rows', 'CREDIT_PAYMENTS_NOT_ALLOWED', 400);
    }
    return { paidAmount: 0 };
  }

  for (const payment of payments) {
    if (roundMoneyToTwoDecimals(payment.amount) <= 0) {
      throw new AppError('Payment amount must be greater than zero', 'PAYMENT_AMOUNT_INVALID', 400);
    }
  }

  const paidAmount = roundMoneyToTwoDecimals(payments.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
  if (paidAmount + 0.0001 < collectibleTotal) {
    throw new AppError('Cash/card payments must cover the collectible total', 'PAYMENT_AMOUNT_INSUFFICIENT', 400);
  }
  return { paidAmount };
}
