import { useMemo } from 'react';

import type { TenderItem } from './tender-page-types';

export function useTenderCalculations(
  items: TenderItem[],
  selectedTradeFilter: string,
  globalProfitMargin: number,
  globalOverhead: number,
  globalWaste: number
) {
  // Calculations per item
  const calculateItemRates = (item: TenderItem) => {
    let directCost = 0;
    if (item.components && item.components.length > 0) {
      directCost = item.components.reduce((sum, c) => sum + (c.qtyPerUnit * c.unitRate), 0);
    } else {
      directCost = 100;
    }

    const withWaste = directCost * (1 + (item.wastePercent || 0) / 100);
    const withOverhead = withWaste * (1 + (item.overheadPercent || 0) / 100);
    const sellingUnitPrice = withOverhead * (1 + (item.profitMarkupPercent || 0) / 100);
    const totalItemValue = sellingUnitPrice * item.estimatedQty;
    const totalItemDirectCost = directCost * item.estimatedQty;
    const totalItemProfit = (sellingUnitPrice - directCost) * item.estimatedQty;

    return {
      directCost,
      sellingUnitPrice,
      totalItemValue,
      totalItemDirectCost,
      totalItemProfit,
    };
  };

  // Grand totals across all items
  const grandTotals = useMemo(() => {
    let totalSellingPrice = 0;
    let totalDirectCost = 0;
    let totalProfit = 0;

    items.forEach((item) => {
      const { totalItemValue, totalItemDirectCost, totalItemProfit } = calculateItemRates(item);
      totalSellingPrice += totalItemValue;
      totalDirectCost += totalItemDirectCost;
      totalProfit += totalItemProfit;
    });

    const profitMargin = totalSellingPrice > 0 ? (totalProfit / totalSellingPrice) * 100 : 0;

    return {
      totalSellingPrice,
      totalDirectCost,
      totalProfit,
      profitMargin,
    };
  }, [items]);

  // Distinct Source Files / Sheets
  const availableSourceFiles = useMemo(() => {
    const fileMap = new Map<string, number>();
    items.forEach((it) => {
      const fn = it.sourceFileName || it.sourceSheetName;
      if (fn) {
        fileMap.set(fn, (fileMap.get(fn) || 0) + 1);
      }
    });
    return Array.from(fileMap.entries()).map(([fileName, count]) => ({ fileName, count }));
  }, [items]);

  // Distinct Trades in Current Tender Items
  const availableTrades = useMemo(() => {
    const tradeSet = new Set<string>();
    items.forEach((it) => {
      if (it.trade) tradeSet.add(it.trade);
    });
    return Array.from(tradeSet);
  }, [items]);

  // Filtered Items for Display by File or Trade
  const displayedItems = useMemo(() => {
    if (selectedTradeFilter === 'all') return items;
    if (selectedTradeFilter.startsWith('file:')) {
      const targetFile = selectedTradeFilter.replace('file:', '');
      return items.filter((it) => (it.sourceFileName || it.sourceSheetName) === targetFile);
    }
    return items.filter(
      (it) =>
        it.trade === selectedTradeFilter ||
        (selectedTradeFilter === 'fire_fighting' && (it.trade === 'hvac_firefighting' || it.itemCode.startsWith('FF')))
    );
  }, [items, selectedTradeFilter]);

  // Trade Subtotal
  const tradeSubtotal = useMemo(() => {
    return displayedItems.reduce((acc, it) => {
      const rates = calculateItemRates(it);
      return acc + rates.totalItemValue;
    }, 0);
  }, [displayedItems, globalProfitMargin, globalOverhead, globalWaste]);

  // Pre-Procurement Consolidated Materials Summary (Consolidated MRP)
  const consolidatedMaterials = useMemo(() => {
    const materialsMap: Record<string, { code: string; name: string; unit: string; totalQty: number; totalCost: number }> = {};

    items.forEach((item) => {
      if (item.components && item.components.length > 0) {
        item.components.forEach((c) => {
          const key = c.componentCode || c.componentName;
          const componentTotalQty = c.qtyPerUnit * item.estimatedQty;
          const componentTotalCost = componentTotalQty * c.unitRate;

          if (!materialsMap[key]) {
            materialsMap[key] = {
              code: c.componentCode,
              name: c.componentName,
              unit: c.unit,
              totalQty: componentTotalQty,
              totalCost: componentTotalCost,
            };
          } else {
            materialsMap[key].totalQty += componentTotalQty;
            materialsMap[key].totalCost += componentTotalCost;
          }
        });
      }
    });

    return Object.values(materialsMap);
  }, [items]);

  return {
    calculateItemRates,
    grandTotals,
    availableSourceFiles,
    availableTrades,
    displayedItems,
    tradeSubtotal,
    consolidatedMaterials,
  };
}
