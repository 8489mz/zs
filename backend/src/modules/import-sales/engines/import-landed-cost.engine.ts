/**
 * Import Landed Cost Engine (محرك احتساب التكلفة الفعلية الشاملة وتوزيع الأعباء)
 * Pure functional calculation engine imported identically by production and test suites.
 */

export interface LandedCostItemInput {
  id: string;
  productId: number | string;
  quantity: number;
  receivedQuantity?: number | null;
  factoryUnitPriceUsd: number;
  unitWeightKg?: number | null;
  unitCbm?: number | null;
  shortageHandlingMethod?: 'capitalize' | 'expense';
}

export interface LandedCostCalculationInput {
  items: LandedCostItemInput[];
  exchangeRate: number;
  shippingCostUsd: number;
  customsCostEgp: number;
  internalTransportCostEgp: number;
  demurrageFeesEgp?: number;
  portClearanceCostEgp?: number;
  vatRefundableEgp?: number;
  vatIsRefundable?: boolean;
  allocationMethod?: 'value' | 'weight' | 'cbm';
}

export interface LandedCostItemResult {
  id: string;
  productId: number | string;
  effectiveQuantity: number;
  factoryPriceUsd: number;
  baseCostEgp: number;
  allocatedOverheadEgp: number;
  unitOverheadEgp: number;
  landedCostEgp: number;
  totalItemLandedCostEgp: number;
  shortageLossEgp: number;
}

export interface LandedCostCalculationResult {
  totalUsdValue: number;
  totalWeightKg: number;
  totalCbm: number;
  totalOverheadEgp: number;
  vatRefundableEgp: number;
  allocationMethod: 'value' | 'weight' | 'cbm';
  items: LandedCostItemResult[];
}

export function calculateLandedCostBreakdown(input: LandedCostCalculationInput): LandedCostCalculationResult {
  // INV-LANDED-COST-EXCHANGE-RATE-REQUIRED: a missing, zero,
  // negative, or non-finite rate fails closed instead of silently
  // costing at rate 1 (or clamping up to 0.0001). The service
  // caller already requires the arrival rate; this guard protects
  // every direct caller of the engine.
  const rate = Number(input.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Invalid exchange rate for landed cost calculation');
  }
  const method = input.allocationMethod || 'value';

  const shippingEgp = (Number(input.shippingCostUsd) || 0) * rate;
  const customsEgp = Number(input.customsCostEgp) || 0;
  const transportEgp = Number(input.internalTransportCostEgp) || 0;
  const demurrageEgp = Number(input.demurrageFeesEgp) || 0;
  const clearanceEgp = Number(input.portClearanceCostEgp) || 0;

  // Distinguish refundable VAT: If refundable, it is a Tax Asset (claimable), NOT capitalized to inventory cost!
  // If non-refundable, it is capitalized into overhead.
  const vatRefundableEgp = Number(input.vatRefundableEgp) || 0;
  const vatIsRefundable = input.vatIsRefundable ?? true;
  const nonRefundableVatEgp = vatIsRefundable ? 0 : vatRefundableEgp;

  const totalOverheadEgp = shippingEgp + customsEgp + transportEgp + demurrageEgp + clearanceEgp + nonRefundableVatEgp;

  // Aggregate bases
  let totalUsdValue = 0;
  let totalWeightKg = 0;
  let totalCbm = 0;

  for (const item of input.items || []) {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const unitPrice = Math.max(0, Number(item.factoryUnitPriceUsd) || 0);
    const weight = Math.max(0, Number(item.unitWeightKg) || 0);
    const cbm = Math.max(0, Number(item.unitCbm) || 0);

    totalUsdValue += qty * unitPrice;
    totalWeightKg += qty * weight;
    totalCbm += qty * cbm;
  }

  const itemsResult: LandedCostItemResult[] = (input.items || []).map((item) => {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const receivedQty = item.receivedQuantity !== null && item.receivedQuantity !== undefined
      ? Number(item.receivedQuantity)
      : qty;
    const handlingMethod = item.shortageHandlingMethod || 'capitalize';
    const effectiveQty = handlingMethod === 'capitalize' && receivedQty > 0 ? receivedQty : qty;

    const unitPriceUsd = Math.max(0, Number(item.factoryUnitPriceUsd) || 0);
    const itemTotalUsd = qty * unitPriceUsd;
    const itemWeight = qty * (Number(item.unitWeightKg) || 0);
    const itemCbm = qty * (Number(item.unitCbm) || 0);

    let ratio = 0;
    if (method === 'weight' && totalWeightKg > 0) {
      ratio = itemWeight / totalWeightKg;
    } else if (method === 'cbm' && totalCbm > 0) {
      ratio = itemCbm / totalCbm;
    } else {
      // Default to value allocation
      ratio = totalUsdValue > 0 ? itemTotalUsd / totalUsdValue : ((input.items?.length || 1) > 0 ? 1 / (input.items.length || 1) : 0);
    }

    const itemAllocatedOverheadEgp = totalOverheadEgp * ratio;
    const baseCostEgp = unitPriceUsd * rate;
    const totalItemLandedCostEgp = (qty * baseCostEgp) + itemAllocatedOverheadEgp;

    const unitLandedEgp = effectiveQty > 0 ? totalItemLandedCostEgp / effectiveQty : 0;
    const unitOverheadEgp = effectiveQty > 0 ? itemAllocatedOverheadEgp / effectiveQty : 0;

    let shortageLossEgp = 0;
    if (handlingMethod === 'expense' && receivedQty < qty) {
      const missingQty = qty - receivedQty;
      shortageLossEgp = missingQty * unitLandedEgp;
    }

    return {
      id: item.id,
      productId: item.productId,
      effectiveQuantity: effectiveQty,
      factoryPriceUsd: unitPriceUsd,
      baseCostEgp: Number(baseCostEgp.toFixed(4)),
      allocatedOverheadEgp: Number(itemAllocatedOverheadEgp.toFixed(4)),
      unitOverheadEgp: Number(unitOverheadEgp.toFixed(4)),
      landedCostEgp: Number(unitLandedEgp.toFixed(4)),
      totalItemLandedCostEgp: Number(totalItemLandedCostEgp.toFixed(4)),
      shortageLossEgp: Number(shortageLossEgp.toFixed(4)),
    };
  });

  return {
    totalUsdValue: Number(totalUsdValue.toFixed(2)),
    totalWeightKg: Number(totalWeightKg.toFixed(3)),
    totalCbm: Number(totalCbm.toFixed(3)),
    totalOverheadEgp: Number(totalOverheadEgp.toFixed(2)),
    vatRefundableEgp: Number(vatRefundableEgp.toFixed(2)),
    allocationMethod: method,
    items: itemsResult,
  };
}

export interface LateExpenseAllocationResult {
  totalLateExpenseEgp: number;
  receivedQuantity: number;
  onHandQuantity: number;
  soldQuantity: number;
  soldRatio: number;
  onHandRatio: number;
  lateCogsAdjustmentEgp: number;
  lateInventoryAdjustmentEgp: number;
  unitCostIncreaseEgp: number;
}

/**
 * Late Expense Allocation (معالجة المصروفات المتأخرة للشحنات بعد بيع جزء من البضاعة)
 * IFRS / GAAP IAS 2 compliant:
 * - Units already sold were expensed as COGS; their portion of late cost is charged to COGS / operational adjustment.
 * - Units still on-hand have their inventory cost and WAC adjusted by their portion of the late cost.
 */
export function calculateLateExpenseAllocation(
  totalLateExpenseEgp: number,
  receivedQuantity: number,
  onHandQuantity: number
): LateExpenseAllocationResult {
  const safeLateExpense = Math.max(0, Number(totalLateExpenseEgp) || 0);
  const safeReceived = Math.max(0, Number(receivedQuantity) || 0);
  const safeOnHand = Math.max(0, Math.min(safeReceived, Number(onHandQuantity) || 0));
  const soldQuantity = Math.max(0, safeReceived - safeOnHand);

  const soldRatio = safeReceived > 0 ? soldQuantity / safeReceived : 0;
  const onHandRatio = safeReceived > 0 ? safeOnHand / safeReceived : 1;

  const lateCogsAdjustmentEgp = Number((safeLateExpense * soldRatio).toFixed(2));
  const lateInventoryAdjustmentEgp = Number((safeLateExpense - lateCogsAdjustmentEgp).toFixed(2));
  const unitCostIncreaseEgp = safeOnHand > 0 ? Number((lateInventoryAdjustmentEgp / safeOnHand).toFixed(4)) : 0;

  return {
    totalLateExpenseEgp: safeLateExpense,
    receivedQuantity: safeReceived,
    onHandQuantity: safeOnHand,
    soldQuantity,
    soldRatio: Number(soldRatio.toFixed(4)),
    onHandRatio: Number(onHandRatio.toFixed(4)),
    lateCogsAdjustmentEgp,
    lateInventoryAdjustmentEgp,
    unitCostIncreaseEgp,
  };
}

export function calculateDemurrageRisk(input: {
  arrivalDate?: string | Date | null;
  demurrageStartDate?: string | Date | null;
  freeDays?: number | string | null;
  ratePerDayUsd?: number | string | null;
  exchangeRate?: number | string | null;
  status?: string;
}): {
  isOverdue: boolean;
  isUrgent: boolean;
  daysRemaining: number;
  overdueDays: number;
  totalEstimatedDemurrageFeesEgp: number;
  estimatedFeesEgp: number;
  // INV-IMPORT-ESTIMATES-HONEST: the estimate's basis. Every default the
  // caller left blank (14 free days, $50/day, rate 1) is named here so the
  // warning banner can show what was assumed instead of presenting an
  // invented rate as fact.
  assumptions: {
    freeDays: number;
    freeDaysAssumed: boolean;
    dailyRateUsd: number;
    dailyRateAssumed: boolean;
    exchangeRate: number;
    exchangeRateAssumed: boolean;
  };
} {
  const freeDaysAssumed = input.freeDays === undefined || input.freeDays === null;
  const dailyRateAssumed = input.ratePerDayUsd === undefined || input.ratePerDayUsd === null;
  const exchangeRateAssumed = input.exchangeRate === undefined || input.exchangeRate === null || Number(input.exchangeRate) <= 0;
  const freeDays = Math.max(0, Number(input.freeDays ?? 14));
  const rateUsd = Math.max(0, Number(input.ratePerDayUsd ?? 50));
  const exchangeRate = Math.max(0.0001, Number(input.exchangeRate) || 1);
  const assumptions = {
    freeDays,
    freeDaysAssumed,
    dailyRateUsd: rateUsd,
    dailyRateAssumed,
    exchangeRate,
    exchangeRateAssumed,
  };

  const status = (input.status || '').trim().toLowerCase();
  // Arrival does not end container detention; only the empty equipment return does.
  if (status === 'empty_returned' || status === 'container_returned') {
    return {
      isOverdue: false,
      isUrgent: false,
      daysRemaining: 0,
      overdueDays: 0,
      totalEstimatedDemurrageFeesEgp: 0,
      estimatedFeesEgp: 0,
      assumptions,
    };
  }

  if (!input.arrivalDate && !input.demurrageStartDate) {
    return {
      isOverdue: false,
      isUrgent: false,
      daysRemaining: freeDays,
      overdueDays: 0,
      totalEstimatedDemurrageFeesEgp: 0,
      estimatedFeesEgp: 0,
      assumptions,
    };
  }

  const baseDate = new Date(input.demurrageStartDate || input.arrivalDate!);
  const baseMidnight = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());

  const deadlineMidnight = new Date(baseMidnight.getTime() + freeDays * 24 * 60 * 60 * 1000);

  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffMs = deadlineMidnight.getTime() - todayMidnight.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays >= 0) {
    return {
      isOverdue: false,
      isUrgent: diffDays <= 3,
      daysRemaining: diffDays,
      overdueDays: 0,
      totalEstimatedDemurrageFeesEgp: 0,
      estimatedFeesEgp: 0,
      assumptions,
    };
  } else {
    const overdueDays = Math.abs(diffDays);
    const feesEgp = Number((overdueDays * rateUsd * exchangeRate).toFixed(2));
    return {
      isOverdue: true,
      isUrgent: true,
      daysRemaining: 0,
      overdueDays,
      totalEstimatedDemurrageFeesEgp: feesEgp,
      estimatedFeesEgp: feesEgp,
      assumptions,
    };
  }
}
