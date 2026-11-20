import { useMemo, useState } from 'react';
import type { VanStockItem } from './van-settle-types';

export function useStockAudit({ inventory }: { inventory: VanStockItem[] }) {
  const [showStockAudit, setShowStockAudit] = useState<boolean>(false);
  const [countedStockMap, setCountedStockMap] = useState<Record<number, string>>({});
  const [stockAuditSearch, setStockAuditSearch] = useState<string>('');
  // INV-VAN-SELF-SETTLE-PIN-REQUIRED: explicit supervisor approval to
  // keep remaining stock in the van overnight. Defaults off; the
  // supervisor authorizes it with the PIN at settle time. Merely not
  // unloading never approves it.
  const [nightStockApproved, setNightStockApproved] = useState<boolean>(false);

  const handleMatchAllStock = () => {
    const nextMap: Record<number, string> = {};
    for (const item of inventory) {
      nextMap[item.productId] = String(item.qty);
    }
    setCountedStockMap(nextMap);
  };

  const handleSetItemCount = (productId: number, val: string) => {
    setCountedStockMap((prev) => ({ ...prev, [productId]: val }));
  };

  const filteredAuditInventory = useMemo(() => {
    if (!stockAuditSearch.trim()) return inventory;
    const q = stockAuditSearch.trim().toLowerCase();
    return inventory.filter(
      (it) => it.productName.toLowerCase().includes(q) || (it.barcode && it.barcode.toLowerCase().includes(q)),
    );
  }, [inventory, stockAuditSearch]);

  const stockAuditSummary = useMemo(() => {
    let totalShortageQty = 0;
    let totalShortageCost = 0;
    let shortageCount = 0;
    let countedCount = 0;

    for (const it of inventory) {
      const inputVal = countedStockMap[it.productId];
      if (inputVal !== undefined && inputVal !== '') {
        countedCount++;
        const counted = Number(inputVal);
        const sys = Number(it.qty);
        if (counted < sys) {
          const diff = sys - counted;
          totalShortageQty += diff;
          totalShortageCost += diff * Number(it.costPrice || 0);
          shortageCount++;
        }
      }
    }

    return { totalShortageQty, totalShortageCost, shortageCount, countedCount };
  }, [inventory, countedStockMap]);

  return {
    showStockAudit,
    setShowStockAudit,
    countedStockMap,
    setCountedStockMap,
    stockAuditSearch,
    setStockAuditSearch,
    nightStockApproved,
    setNightStockApproved,
    handleMatchAllStock,
    handleSetItemCount,
    filteredAuditInventory,
    stockAuditSummary,
  };
}
