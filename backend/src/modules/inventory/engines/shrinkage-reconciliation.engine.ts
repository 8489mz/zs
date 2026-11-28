export interface DailyFlowReconciliationInput {
  productId: string;
  productName: string;
  locationId: string;
  locationName: string;
  unitCost: number;
  openingQty: number;
  transferredInQty: number;
  purchasedQty: number;
  transferredOutQty: number;
  soldQty: number;
  recordedDamagedQty: number;
  physicalCountedQty: number | null;
}

export interface DailyFlowReconciliationRow extends DailyFlowReconciliationInput {
  expectedEndingQty: number;
  shrinkageQty: number;
  shrinkageCost: number;
  shrinkageRatePct: number;
  status: 'uncounted' | 'matched' | 'shortage' | 'surplus';
}

export interface ShrinkageLossEvent {
  productId: string;
  productName: string;
  locationId: string;
  locationName: string;
  cause: 'damaged' | 'negative_adjustment' | 'count_shortage' | 'transfer_shortage';
  qty: number;
  cost: number;
}

export interface ShrinkageHeatmapEntry {
  productId: string;
  productName: string;
  totalQtyLost: number;
  totalCostLost: number;
  incidentsCount: number;
  topLocationName: string;
  causesBreakdown: {
    damaged: number;
    negative_adjustment: number;
    count_shortage: number;
    transfer_shortage: number;
  };
}

export interface TransferAgingInput {
  transferId: string;
  docNo: string;
  createdAt: Date | string;
  alertHours: number;
  now?: Date;
}

export interface TransferAgingResult {
  transferId: string;
  docNo: string;
  ageHours: number;
  isOverdue: boolean;
  overdueByHours: number;
}

function roundQty(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(3));
}

function roundMoney(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

/**
 * Pure reconciliation formula for daily hall / street / warehouse shrinkage:
 *   expectedEnding = opening + transferredIn + purchased - transferredOut - sold - recordedDamaged
 *   shrinkageQty   = expectedEnding - physicalCounted (positive = missing stock / theft / unrecorded loss)
 */
export function computeDailyFlowReconciliation(inputs: DailyFlowReconciliationInput[]): DailyFlowReconciliationRow[] {
  return inputs.map((item) => {
    const expectedEndingQty = roundQty(
      Number(item.openingQty || 0) +
        Number(item.transferredInQty || 0) +
        Number(item.purchasedQty || 0) -
        Number(item.transferredOutQty || 0) -
        Number(item.soldQty || 0) -
        Number(item.recordedDamagedQty || 0),
    );
    const unitCost = Math.max(0, Number(item.unitCost || 0));

    if (
      item.physicalCountedQty === null ||
      item.physicalCountedQty === undefined ||
      !Number.isFinite(Number(item.physicalCountedQty))
    ) {
      return {
        ...item,
        expectedEndingQty,
        shrinkageQty: 0,
        shrinkageCost: 0,
        shrinkageRatePct: 0,
        status: 'uncounted',
      };
    }

    const physicalCountedQty = roundQty(Number(item.physicalCountedQty));
    const shrinkageQty = roundQty(expectedEndingQty - physicalCountedQty);
    const shrinkageCost = roundMoney(shrinkageQty * unitCost);
    const totalHandled = Math.max(
      0,
      Number(item.openingQty || 0) + Number(item.transferredInQty || 0) + Number(item.purchasedQty || 0),
    );
    const shrinkageRatePct =
      totalHandled > 0.0001 && shrinkageQty > 0 ? Number(((shrinkageQty / totalHandled) * 100).toFixed(2)) : 0;

    let status: DailyFlowReconciliationRow['status'] = 'matched';
    if (shrinkageQty > 0.0009) status = 'shortage';
    else if (shrinkageQty < -0.0009) status = 'surplus';

    return {
      ...item,
      physicalCountedQty,
      expectedEndingQty,
      shrinkageQty,
      shrinkageCost,
      shrinkageRatePct,
      status,
    };
  });
}

/**
 * Aggregates shrinkage events across damage, manual deductions, count shortages,
 * and transfer shortages into a ranked heatmap (highest financial loss first).
 */
export function buildShrinkageHeatmap(
  events: ShrinkageLossEvent[],
  limit = 10,
): {
  totalLossQty: number;
  totalLossCost: number;
  totalIncidents: number;
  byCause: Record<ShrinkageLossEvent['cause'], { qty: number; cost: number; count: number }>;
  topProducts: ShrinkageHeatmapEntry[];
} {
  const byCause: Record<ShrinkageLossEvent['cause'], { qty: number; cost: number; count: number }> = {
    damaged: { qty: 0, cost: 0, count: 0 },
    negative_adjustment: { qty: 0, cost: 0, count: 0 },
    count_shortage: { qty: 0, cost: 0, count: 0 },
    transfer_shortage: { qty: 0, cost: 0, count: 0 },
  };

  const productMap = new Map<
    string,
    {
      productId: string;
      productName: string;
      totalQtyLost: number;
      totalCostLost: number;
      incidentsCount: number;
      locationCostMap: Map<string, number>;
      causesBreakdown: ShrinkageHeatmapEntry['causesBreakdown'];
    }
  >();

  let totalLossQty = 0;
  let totalLossCost = 0;
  let totalIncidents = 0;

  for (const event of events) {
    const qty = Math.max(0, Number(event.qty || 0));
    const cost = Math.max(0, Number(event.cost || 0));
    if (qty <= 0 && cost <= 0) continue;

    totalLossQty += qty;
    totalLossCost += cost;
    totalIncidents += 1;

    const causeBucket = byCause[event.cause];
    if (causeBucket) {
      causeBucket.qty = roundQty(causeBucket.qty + qty);
      causeBucket.cost = roundMoney(causeBucket.cost + cost);
      causeBucket.count += 1;
    }

    const key = String(event.productId);
    let entry = productMap.get(key);
    if (!entry) {
      entry = {
        productId: key,
        productName: String(event.productName || `#${key}`),
        totalQtyLost: 0,
        totalCostLost: 0,
        incidentsCount: 0,
        locationCostMap: new Map<string, number>(),
        causesBreakdown: {
          damaged: 0,
          negative_adjustment: 0,
          count_shortage: 0,
          transfer_shortage: 0,
        },
      };
      productMap.set(key, entry);
    }

    entry.totalQtyLost = roundQty(entry.totalQtyLost + qty);
    entry.totalCostLost = roundMoney(entry.totalCostLost + cost);
    entry.incidentsCount += 1;
    entry.causesBreakdown[event.cause] = roundMoney(entry.causesBreakdown[event.cause] + cost);

    const locName = String(event.locationName || 'غير محدد');
    entry.locationCostMap.set(locName, roundMoney((entry.locationCostMap.get(locName) || 0) + cost));
  }

  const topProducts: ShrinkageHeatmapEntry[] = Array.from(productMap.values())
    .sort((a, b) => b.totalCostLost - a.totalCostLost || b.totalQtyLost - a.totalQtyLost)
    .slice(0, Math.max(1, limit))
    .map((item) => {
      let topLocationName = 'غير محدد';
      let maxLocCost = -1;
      for (const [loc, locCost] of item.locationCostMap.entries()) {
        if (locCost > maxLocCost) {
          maxLocCost = locCost;
          topLocationName = loc;
        }
      }
      return {
        productId: item.productId,
        productName: item.productName,
        totalQtyLost: item.totalQtyLost,
        totalCostLost: item.totalCostLost,
        incidentsCount: item.incidentsCount,
        topLocationName,
        causesBreakdown: item.causesBreakdown,
      };
    });

  return {
    totalLossQty: roundQty(totalLossQty),
    totalLossCost: roundMoney(totalLossCost),
    totalIncidents,
    byCause,
    topProducts,
  };
}

/**
 * Evaluates in-transit transfer aging against the configured threshold.
 */
export function evaluateTransferAging(input: TransferAgingInput): TransferAgingResult {
  const createdMs = new Date(input.createdAt).getTime();
  const nowMs = (input.now ?? new Date()).getTime();
  const threshold = Math.max(1, Number(input.alertHours || 4));
  const rawHours = Number.isFinite(createdMs) ? Math.max(0, (nowMs - createdMs) / 3_600_000) : 0;
  const ageHours = Number(rawHours.toFixed(1));
  const isOverdue = ageHours >= threshold;
  const overdueByHours = isOverdue ? Number((ageHours - threshold).toFixed(1)) : 0;

  return {
    transferId: input.transferId,
    docNo: input.docNo,
    ageHours,
    isOverdue,
    overdueByHours,
  };
}
