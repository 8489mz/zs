import type { StockCountSession, Product } from '@/types/domain';
import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';

export type SessionVarianceSummary = {
  itemsCount: number;
  varianceItemsCount: number;
  totalVariance: number;
  totalAbsoluteVariance: number;
  hasVariance: boolean;
  expectedValue: number;
  countedValue: number;
  netFinancialVariance: number;
  deficitCost: number;
  surplusCost: number;
};

export function getSessionStatusLabel(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'draft') return 'مسودة / بانتظار المراجعة';
  if (normalized === 'posting') return 'بانتظار استكمال الاعتماد';
  if (normalized === 'posted') return 'معتمد';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'ملغي';
  return status || '—';
}

/* INV-FE2-FRONTEND-BOOK-DIGITS (U6 FE2): the money legs of a stock-count
 * summary round at the tenant's book digits. `digits` is a required
 * param (FE1 convention) — the callers resolve it from the
 * tenant base currency. It sits BEFORE the optional products list:
 * TypeScript forbids a required param after an optional one.
 * The quantity legs stay toFixed(3): quantities
 * are 3dp by design (the ledger's quantity precision), not money. */
export function summarizeSessionVariance(
  session: StockCountSession,
  digits: MoneyDigits,
  products?: Product[],
): SessionVarianceSummary {
  const items = Array.isArray(session.items) ? session.items : [];
  const itemsCount = items.length;
  let varianceItemsCount = 0;
  let totalVariance = 0;
  let totalAbsoluteVariance = 0;
  let expectedValue = 0;
  let countedValue = 0;
  let netFinancialVariance = 0;
  let deficitCost = 0;
  let surplusCost = 0;

  const productMap = products ? new Map<string, Product>(products.map((p) => [String(p.id), p])) : null;

  for (const item of items) {
    const variance = Number(item.varianceQty || 0);
    const expectedQty = Number(item.expectedQty || 0);
    const countedQty = Number(item.countedQty || 0);

    totalVariance += variance;
    totalAbsoluteVariance += Math.abs(variance);
    if (Math.abs(variance) > 0) varianceItemsCount += 1;

    const prod = productMap?.get(String(item.productId));
    const cost = Number(prod?.costPrice ?? (item as { unitCost?: number }).unitCost ?? 0);

    expectedValue += expectedQty * cost;
    countedValue += countedQty * cost;

    const finVar = variance * cost;
    netFinancialVariance += finVar;

    if (variance < 0) {
      deficitCost += Math.abs(finVar);
    } else if (variance > 0) {
      surplusCost += finVar;
    }
  }

  return {
    itemsCount,
    varianceItemsCount,
    totalVariance: Number(totalVariance.toFixed(3)),
    totalAbsoluteVariance: Number(totalAbsoluteVariance.toFixed(3)),
    hasVariance: varianceItemsCount > 0,
    expectedValue: roundMoneyValue(expectedValue, digits),
    countedValue: roundMoneyValue(countedValue, digits),
    netFinancialVariance: roundMoneyValue(netFinancialVariance, digits),
    deficitCost: roundMoneyValue(deficitCost, digits),
    surplusCost: roundMoneyValue(surplusCost, digits),
  };
}
