import { type MoneyDigits, roundMoney as roundBookMoney } from '../../accounting/engines/money-minor-units.engine';
import type { VanStockAuditItem, VanStockAuditResult, VanStockItemVariance, VanStockUncountedItem } from './van-trip-reconciliation.types';

/**
 * Reconciles physical stock audit of items in the van against system stock balances.
 */
export function reconcileVanStockAudit(items: VanStockAuditItem[], digits: MoneyDigits): VanStockAuditResult {
  const toQty = (val: number) => Number((Number(val) || 0).toFixed(4));

  let totalStockShortageCost = 0;
  let totalStockOverageCost = 0;
  const itemVariances: VanStockItemVariance[] = [];
  const uncountedItems: VanStockUncountedItem[] = [];

  for (const item of items) {
    const systemQty = toQty(item.systemQty);
    // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: an uncounted item's
    // countedQty falls back to the system qty ONLY as a display
    // value — `counted: false` below (and the uncountedItems list)
    // is the authoritative signal, and the caller must refuse to
    // certify the audit while any item is uncounted. Never read
    // countedQty as a verified count without checking `counted`.
    const counted = item.countedQty !== undefined;
    const countedQty = item.countedQty !== undefined ? toQty(item.countedQty) : systemQty;
    if (!counted) {
      uncountedItems.push({
        productId: item.productId,
        productName: item.productName,
        systemQty,
        costPrice: Number(item.costPrice || 0),
      });
    }
    const varianceQty = toQty(countedQty - systemQty);
    const costPrice = Number(item.costPrice || 0);
    const retailPrice = Number(item.retailPrice || 0);

    let status: 'balanced' | 'shortage' | 'overage' = 'balanced';
    let shortageCost = 0;
    let overageCost = 0;

    if (varianceQty < -0.0001) {
      status = 'shortage';
      shortageCost = roundBookMoney(Math.abs(varianceQty) * costPrice, digits);
      totalStockShortageCost += shortageCost;
    } else if (varianceQty > 0.0001) {
      status = 'overage';
      overageCost = roundBookMoney(varianceQty * costPrice, digits);
      totalStockOverageCost += overageCost;
    }

    itemVariances.push({
      productId: item.productId,
      productName: item.productName,
      systemQty,
      countedQty,
      counted,
      varianceQty,
      costPrice,
      retailPrice,
      shortageCost,
      overageCost,
      status,
    });
  }

  totalStockShortageCost = roundBookMoney(totalStockShortageCost, digits);
  totalStockOverageCost = roundBookMoney(totalStockOverageCost, digits);
  const netStockVarianceCost = roundBookMoney(totalStockOverageCost - totalStockShortageCost, digits);
  const varianceItemsCount = itemVariances.filter((iv) => iv.status !== 'balanced').length;

  return {
    totalSystemItems: items.length,
    auditedItemsCount: items.filter((i) => i.countedQty !== undefined).length,
    varianceItemsCount,
    hasStockDiscrepancy: varianceItemsCount > 0,
    totalStockShortageCost,
    totalStockOverageCost,
    netStockVarianceCost,
    itemVariances,
    hasUncountedItems: uncountedItems.length > 0,
    uncountedItemsCount: uncountedItems.length,
    uncountedItems,
  };
}
