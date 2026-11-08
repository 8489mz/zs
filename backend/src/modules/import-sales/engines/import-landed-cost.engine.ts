/**
 * Import Landed Cost Engine (محرك احتساب التكلفة الفعلية الشاملة وتوزيع الأعباء)
 * Pure functional calculation engine imported identically by production and test suites.
 *
 * Canonical-money note (U4 W1): every BOOK-money output (overhead
 * totals, per-item allocations, item totals, shortage losses, late-
 * expense splits, demurrage fees) rounds through roundMoney at the
 * tenant base currency's digits and the overhead split goes through
 * allocateLandedCosts, so the parts sum exactly to the posted total.
 * Per-UNIT costs (baseCostEgp, unitOverheadEgp, landedCostEgp) stay
 * at 4 decimals: migration 0271 stores them in NUMERIC(15, 4) and
 * the tiny-rate pin needs sub-cent unit precision. Quantities and
 * ratios are not money and keep their existing precision.
 */

import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { allocateLandedCosts } from '../../purchases/engines/landed-cost-allocation.engine';

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
  /** Book digits for the money outputs; defaults to EGP's (2), as in calculateImportFeasibility. */
  moneyDigits?: MoneyDigits;
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
  const digits = input.moneyDigits ?? currencyMoneyDigits('EGP');
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

  const totalOverheadEgp = roundMoney(shippingEgp + customsEgp + transportEgp + demurrageEgp + clearanceEgp + nonRefundableVatEgp, digits);

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

  // Canonical allocation: the rounded book total is split with
  // allocateLandedCosts so the parts sum exactly to the total
  // (remainder to the largest fractional share). Weight bases mirror
  // the old ratio chain: the chosen method's base, else the value
  // base, else an equal split when every base totals zero.
  const methodBases = (input.items || []).map((item) => {
    const qty = Math.max(0, Number(item.quantity) || 0);
    if (method === 'weight') return qty * Math.max(0, Number(item.unitWeightKg) || 0);
    if (method === 'cbm') return qty * Math.max(0, Number(item.unitCbm) || 0);
    return qty * Math.max(0, Number(item.factoryUnitPriceUsd) || 0);
  });
  const valueBases = (input.items || []).map((item) =>
    Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.factoryUnitPriceUsd) || 0));
  const sumBases = (bases: number[]): number => bases.reduce((sum, value) => sum + value, 0);
  const weights = sumBases(methodBases) > 0
    ? methodBases
    : sumBases(valueBases) > 0
      ? valueBases
      : (input.items || []).map(() => 1);
  const allocatedOverheads = (input.items || []).length
    ? allocateLandedCosts(totalOverheadEgp, weights, digits)
    : [];

  const itemsResult: LandedCostItemResult[] = (input.items || []).map((item, index) => {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const receivedQty = item.receivedQuantity !== null && item.receivedQuantity !== undefined
      ? Number(item.receivedQuantity)
      : qty;
    const handlingMethod = item.shortageHandlingMethod || 'capitalize';
    const effectiveQty = handlingMethod === 'capitalize' && receivedQty > 0 ? receivedQty : qty;

    const unitPriceUsd = Math.max(0, Number(item.factoryUnitPriceUsd) || 0);

    const itemAllocatedOverheadEgp = allocatedOverheads[index];
    // Unit base cost stays at 4 decimals (migration 0271 storage
    // precision); the book total below rounds at book digits.
    const baseCostEgp = Number((unitPriceUsd * rate).toFixed(4));
    const totalItemLandedCostEgp = roundMoney((qty * baseCostEgp) + itemAllocatedOverheadEgp, digits);

    const unitLandedEgp = effectiveQty > 0 ? totalItemLandedCostEgp / effectiveQty : 0;
    const unitOverheadEgp = effectiveQty > 0 ? itemAllocatedOverheadEgp / effectiveQty : 0;

    let shortageLossEgp = 0;
    if (handlingMethod === 'expense' && receivedQty < qty) {
      const missingQty = qty - receivedQty;
      shortageLossEgp = roundMoney(missingQty * unitLandedEgp, digits);
    }

    return {
      id: item.id,
      productId: item.productId,
      effectiveQuantity: effectiveQty,
      factoryPriceUsd: unitPriceUsd,
      baseCostEgp,
      allocatedOverheadEgp: itemAllocatedOverheadEgp,
      unitOverheadEgp: Number(unitOverheadEgp.toFixed(4)),
      landedCostEgp: Number(unitLandedEgp.toFixed(4)),
      totalItemLandedCostEgp,
      shortageLossEgp,
    };
  });

  return {
    totalUsdValue: Number(totalUsdValue.toFixed(2)),
    totalWeightKg: Number(totalWeightKg.toFixed(3)),
    totalCbm: Number(totalCbm.toFixed(3)),
    totalOverheadEgp,
    vatRefundableEgp: roundMoney(vatRefundableEgp, digits),
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
  onHandQuantity: number,
  moneyDigits?: MoneyDigits,
): LateExpenseAllocationResult {
  const digits = moneyDigits ?? currencyMoneyDigits('EGP');
  const safeLateExpense = Math.max(0, Number(totalLateExpenseEgp) || 0);
  const safeReceived = Math.max(0, Number(receivedQuantity) || 0);
  const safeOnHand = Math.max(0, Math.min(safeReceived, Number(onHandQuantity) || 0));
  const soldQuantity = Math.max(0, safeReceived - safeOnHand);

  const soldRatio = safeReceived > 0 ? soldQuantity / safeReceived : 0;
  const onHandRatio = safeReceived > 0 ? safeOnHand / safeReceived : 1;

  // Canonical split: the rounded total is divided with
  // allocateLandedCosts, so COGS + inventory sum exactly to the
  // total (no remainder drift). With nothing received the whole
  // amount stays in inventory, as before.
  const roundedTotal = roundMoney(safeLateExpense, digits);
  let lateCogsAdjustmentEgp: number;
  let lateInventoryAdjustmentEgp: number;
  if (safeReceived <= 0) {
    lateCogsAdjustmentEgp = 0;
    lateInventoryAdjustmentEgp = roundedTotal;
  } else {
    const [cogs, inventory] = allocateLandedCosts(roundedTotal, [soldQuantity, safeOnHand], digits);
    lateCogsAdjustmentEgp = cogs;
    lateInventoryAdjustmentEgp = inventory;
  }
  const unitCostIncreaseEgp = safeOnHand > 0 ? roundMoney(lateInventoryAdjustmentEgp / safeOnHand, digits) : 0;

  return {
    totalLateExpenseEgp: roundedTotal,
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
  /** Book digits for the estimated fee; defaults to EGP's (2). */
  moneyDigits?: MoneyDigits;
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
  const digits = input.moneyDigits ?? currencyMoneyDigits('EGP');
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
    const feesEgp = roundMoney(overdueDays * rateUsd * exchangeRate, digits);
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
