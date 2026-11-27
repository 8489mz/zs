import type { MoneyDigits } from '@/shared/utils/money';
import type { Product } from '@/types/domain';
import type { PosItem } from '@/features/pos/types/pos.types';
import { getMinimumSaleQuantity, getResolvedStockLimit, normalizeSaleQuantity, safeUnits } from '@/features/pos/lib/pos-domain/pos-domain-helpers';
import { getProductItemCode, getProductPrice, getSaleUnit, UNBOUNDED_STOCK_LIMIT } from '@/features/pos/lib/pos-domain/pos-domain-pricing';
import { isServiceProduct } from '@/features/pos/lib/pos-domain/pos-domain-line-keys';
import { trimSerialsToRequiredCount } from '@/features/pos/lib/pos-domain/pos-domain-serials';
import { normalizeUnitName } from '@/shared/utils/unit-name';

// normalizeUnitName moved to shared (F5k): the pos.domain barrel keeps
// re-exporting it from here, so no importer changes.
export { normalizeUnitName } from '@/shared/utils/unit-name';

export function syncPosCartStock(cart: PosItem[], products: Product[], options: { allowNegativeStockSales?: boolean; digits: MoneyDigits }) {
  let changed = false;
  let removedCount = 0;
  let clampedCount = 0;
  let heldUnavailableCount = 0;

  const nextCart = cart.flatMap((item) => {
    const product = products.find((entry) => String(entry.id) === String(item.productId));
    if (!product) return [item];
    const unit = safeUnits(product).find((entry) => String(entry.id || '') === String(item.unitId || '') || String(entry.name || '') === String(item.unitName || '')) || getSaleUnit(product);
    const isWeighted = item.isWeighted === true;
    const minQty = getMinimumSaleQuantity(isWeighted);
    // INV-SERVICE-STOCK-NO-STOCK-CHECK: services sell without stock —
    // the same exemption addPosItem already applies at the add. Without
    // it a 0-stock service line was removed here (limit 0 < minQty 1).
    const isService = isServiceProduct(product);
    const stockLimit = (options.allowNegativeStockSales || !!product.hasBom || isService) ? UNBOUNDED_STOCK_LIMIT : getResolvedStockLimit(product, unit, isWeighted);
    /* INV-REST-HOLD-RECALL-TRUTH (R5-B): a held price is the agreed
     * price. A line restored from a hold (priceHeldAt) is never
     * repriced and never silently deleted: a stock-out held line is
     * KEPT and flagged so the cashier decides (remove or replace);
     * submit still enforces stock. Only the stock figures refresh. */
    if (item.priceHeldAt != null) {
      const heldUnavailable = stockLimit < minQty;
      if (heldUnavailable) heldUnavailableCount += 1;
      if (
        heldUnavailable !== Boolean(item.heldUnavailable)
        || Number(stockLimit) !== Number(item.stockLimit)
        || Number(product.stock || 0) !== Number(item.currentStock)
      ) {
        changed = true;
        return [{ ...item, stockLimit, currentStock: Number(product.stock || 0), heldUnavailable }];
      }
      return [item];
    }
    if (stockLimit < minQty) {
      changed = true;
      removedCount += 1;
      return [];
    }

    const normalizedQty = normalizeSaleQuantity(Number(item.qty || minQty), isWeighted);
    const nextQty = Math.min(normalizedQty, stockLimit);
    const nextItem = {
      ...item,
      name: product.name || item.name,
      unitId: String(unit.id || item.unitId || ''),
      unitName: unit.name || item.unitName,
      itemCode: getProductItemCode(product, unit) || item.itemCode,
      unitMultiplier: Number.isFinite(Number(unit.multiplier)) && Number(unit.multiplier) > 0 ? Number(unit.multiplier) : 1,
      stockLimit,
      currentStock: Number(product.stock || 0),
      minStock: Number(product.minStock || 0),
      price: getProductPrice(product, item.priceType, nextQty, Number(unit.multiplier) > 0 ? Number(unit.multiplier) : 1, options.digits),
      qty: nextQty,
      quantityChunks: nextQty === Number(item.qty || 0) ? item.quantityChunks : undefined,
      serials: trimSerialsToRequiredCount(item.serials, item, nextQty),
    };

    if (nextQty !== item.qty) {
      changed = true;
      clampedCount += 1;
    }

    if (
      String(nextItem.name || '') !== String(item.name || '')
      || Number(nextItem.stockLimit) !== Number(item.stockLimit)
      || Number(nextItem.currentStock) !== Number(item.currentStock)
      || Number(nextItem.minStock) !== Number(item.minStock)
      || Number(nextItem.unitMultiplier) !== Number(item.unitMultiplier)
      || Number(nextItem.price) !== Number(item.price)
      || String(nextItem.unitId || '') !== String(item.unitId || '')
      || String(nextItem.unitName || '') !== String(item.unitName || '')
    ) {
      changed = true;
    }

    return [nextItem];
  });

  return {
    cart: changed ? nextCart : cart,
    removedCount,
    clampedCount,
    heldUnavailableCount,
  };
}

/* SPICE-PKG3 (b): a sale unit sold by weight (kg / g, in any
 * spelling the catalog uses) is a weighed line — fractional
 * quantities survive the add, the stepper and the submit
 * normalizer, which all already branch on item.isWeighted. Exact
 * match on the normalized unit name only: 'نصف كيلو' (a
 * 0.5-multiplier pack sold by the piece) must NOT match. */
export function isWeightedSaleUnit(unitName?: string): boolean {
  const normalized = normalizeUnitName(unitName);
  return normalized === 'kg' || normalized === 'g';
}

export function summarizeCartQuantities(cart: Array<{ unitName?: string; qty: number }>): string[] {
  const map = new Map<string, number>();
  for (const item of cart) {
    const unit = normalizeUnitName(item.unitName);
    map.set(unit, (map.get(unit) || 0) + Number(item.qty || 0));
  }
  return Array.from(map.entries()).map(([unit, qty]) => `${qty.toLocaleString('ar-EG', { maximumFractionDigits: 3 })} ${unit}`);
}
