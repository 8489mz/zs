import { AppError } from '../../../common/errors/app-error';

type RemovedFashionStock = {
  stock_qty?: number | string | null;
  reserved_qty?: number | string | null;
  cost_price?: number | string | null;
};

type FashionLocationBalance = { qty?: number | string | null };

/**
 * A removed variant may not be archived while reservations survive, or while
 * stock held outside the listed location balances would be silently discarded.
 * Merging differently-valued variants needs a proper valuation adjustment;
 * never quietly rewrite cost through a stock-only transfer.
 */
export function assertFashionRemovedStockSafe(
  product: RemovedFashionStock,
  locationBalances: FashionLocationBalance[],
  targetUnitCost?: number,
  options?: { allowMismatchForZeroing?: boolean },
): void {
  const reserved = Number(product.reserved_qty || 0);
  if (!Number.isFinite(reserved) || reserved > 0.0001) {
    throw new AppError('لا يمكن دمج أو تصفير مقاس عليه حجز مخزني قائم', 'FASHION_VARIANT_RESERVED', 409);
  }
  const stock = Number(product.stock_qty || 0);
  const located = locationBalances.reduce((sum, balance) => sum + Number(balance.qty || 0), 0);
  if (!options?.allowMismatchForZeroing) {
    if (
      !Number.isFinite(stock) ||
      !Number.isFinite(located) ||
      stock < -0.0001 ||
      Math.abs(Number((stock - located).toFixed(3))) > 0.001
    ) {
      throw new AppError(
        'مخزون المقاس لا يتطابق مع أرصدة المواقع؛ يلزم جرد وتسوية أولاً',
        'FASHION_STOCK_RECONCILIATION_REQUIRED',
        409,
      );
    }
  }
  if (
    targetUnitCost !== undefined &&
    (!Number.isFinite(targetUnitCost) ||
      (stock > 0.0001 && Math.abs(Number(product.cost_price || 0) - targetUnitCost) > 0.0001))
  ) {
    throw new AppError(
      'لا يمكن دمج مقاسين بتكلفتين مختلفتين دون تسوية تقييم مخزون',
      'FASHION_VALUATION_ADJUSTMENT_REQUIRED',
      409,
    );
  }
}

/** Reject an obsolete stock snapshot for explicit fashion adjustments. */
export function assertFashionExpectedStock(expected: number | undefined, current: number): void {
  if (
    expected === undefined ||
    !Number.isFinite(expected) ||
    !Number.isFinite(current) ||
    Math.abs(expected - current) > 0.0001
  ) {
    throw new AppError('الرصيد تغير منذ فتح الموديل؛ حدّث المقاسات قبل تسوية المخزون', 'FASHION_STOCK_STALE', 409);
  }
}

/** Editing descriptions only needs read access; stock-affecting saves need branch write scope. */
export function fashionLocationAccessMode(
  isNewVariant: boolean,
  hasStockUpdate: boolean,
  requestedConsolidation: boolean,
): 'read' | 'write' {
  return isNewVariant || hasStockUpdate || requestedConsolidation ? 'write' : 'read';
}
