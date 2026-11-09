/**
 * Import Feasibility Engine (محرك دراسة الجدوى الاستيرادية المتقدم والتدقيق المحاسبي)
 * Pure functional calculation engine imported identically by production and test suites.
 *
 * Money outputs are EGP-denominated by design (every *Egp field), so the
 * default book digits are EGP's via currencyMoneyDigits('EGP'); a caller
 * pricing the study in another currency passes moneyDigits explicitly.
 * The commercial exchange rate has NO fallback: a missing/invalid rate
 * fails closed here instead of silently pricing at the old hardcoded 50
 * (F1). The live caller must resolve the rate through resolveFxRate
 * (supplied-rate path for a contractual rate) before calling.
 */
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export interface FeasibilityItemInput {
  name: string;
  /** I6-A: link to the real inventory item. Carried through to the
   * output natively so the PI/PO pull no longer depends on input
   * order; the frontend index-based re-attach is removed. */
  productId?: number;
  hsCode?: string;
  qty: number;
  factoryPriceUsd: number;
  unitWeightKg?: number;
  unitCbm?: number;
  expectedLocalMarketPriceEgp?: number;
  partNumber?: string;
  oemNumber?: string;
  brand?: string;
  model?: string;
}

export interface FeasibilityCalculationInput {
  items: FeasibilityItemInput[];
  exchangeRateCommercial: number;
  /** Book digits for the money outputs; defaults to EGP's (2). */
  moneyDigits?: MoneyDigits;
  exchangeRateCustoms?: number;
  travelAndSourcingCostEgp?: number;
  internationalShippingUsd?: number;
  insuranceUsd?: number;
  customsDutyRatePercent?: number;
  vatRatePercent?: number;
  clearanceAndPortFeesEgp?: number;
  internalTransportEgp?: number;
  bankCommissionAndFinancingEgp?: number;
  targetMarkupPercent?: number;
  vatIsRefundable?: boolean;
}

export interface FeasibilityItemOutput {
  name: string;
  /** I6-A: the linked inventory item id, carried from the input
   * item of the same line — never re-derived by index. Undefined
   * when the line was never linked to a real item. */
  productId?: number;
  hsCode?: string;
  qty: number;
  factoryPriceUsd: number;
  totalFactoryUsd: number;
  factoryCostEgp: number;
  allocatedOverheadEgp: number;
  unitLandedCostEgp: number;
  suggestedWholesalePriceEgp: number;
  suggestedRetailPriceEgp: number;
  totalItemLandedEgp: number;
  unitWeightKg?: number;
  unitCbm?: number;
  expectedLocalMarketPriceEgp?: number;
  unitNetProfitVsMarketEgp?: number;
  marginVsMarketPercent?: number;
  totalProfitVsMarketEgp?: number;
  partNumber?: string;
  oemNumber?: string;
  brand?: string;
  model?: string;
}

export interface ContainerLoadMetrics {
  totalGrossWeightKg: number;
  totalGrossWeightTons: number;
  totalVolumeCbm: number;
  recommendedContainerType: '20ft' | '40ft' | '40hc' | 'multiple';
  containerCountNeeded: number;
  weightCapacityUtilizationPercent: number;
  volumeCapacityUtilizationPercent: number;
  isHeavyCargo: boolean;
  isBulkyCargo: boolean;
  isBalancedCargo: boolean;
  isOverweightRisk: boolean;
  loadSummaryAr: string;
}

export interface FeasibilityScenarioOutput {
  scenarioName: 'base' | 'best' | 'worst';
  totalInvestmentEgp: number;
  expectedRevenueEgp: number;
  expectedNetProfitEgp: number;
  roiPercentage: number;
  grossMarginPercentage: number;
  breakEvenUnits: number;
  breakEvenRevenueEgp: number;
  /**
   * Worst-case demurrage (detention) reserve held in the worst scenario
   * only; 0 on base/best. I2-P9: derived from the shipment itself (see
   * the worst-scenario computation), never a fixed lump sum.
   */
  demurrageReserveEgp?: number;
}

export interface FeasibilityCalculationResult {
  totalFactoryCostUsd: number;
  totalFactoryCostEgp: number;
  internationalShippingUsd: number;
  internationalShippingEgp: number;
  insuranceUsd: number;
  insuranceEgp: number;
  cifValueUsd: number;
  cifValueEgp: number;
  customsDutyEgp: number;
  customsVatEgp: number;
  vatRefundableEgp: number;
  clearanceAndPortFeesEgp: number;
  internalTransportEgp: number;
  capitalizedOverheadEgp: number;
  operatingExpensesEgp: number;
  totalProjectInvestmentEgp: number;
  totalAccountingCostEgp: number;
  totalUnitsCount: number;
  items: FeasibilityItemOutput[];
  targetRevenueEgp: number;
  expectedNetProfitEgp: number;
  roiPercentage: number;
  markupPercentage: number;
  grossMarginPercentage: number;
  breakEvenRevenueEgp: number;
  breakEvenUnits: number;
  containerMetrics: ContainerLoadMetrics;
  totalProfitVsMarketEgp?: number;
  overallRoiVsMarketPercent?: number;
  scenarios: {
    base: FeasibilityScenarioOutput;
    best: FeasibilityScenarioOutput;
    worst: FeasibilityScenarioOutput;
  };
}

export function resolveNumber(val: unknown, fallback: number): number {
  if (val === null || val === undefined || val === '') return fallback;
  const num = Number(val);
  return Number.isFinite(num) ? num : fallback;
}

export function calculateImportFeasibility(input: FeasibilityCalculationInput): FeasibilityCalculationResult {
  const digits = input.moneyDigits ?? currencyMoneyDigits('EGP');
  const suppliedCommercialRate = resolveNumber(input.exchangeRateCommercial, NaN);
  if (!Number.isFinite(suppliedCommercialRate) || suppliedCommercialRate <= 0) {
    throw new Error('Import feasibility requires a caller-resolved commercial exchange rate; a missing rate must never silently fall back to a hardcoded rate.');
  }
  const commRate = Math.max(0.0001, suppliedCommercialRate);
  const custRate = Math.max(0.0001, resolveNumber(input.exchangeRateCustoms, commRate));

  const shippingUsd = Math.max(0, resolveNumber(input.internationalShippingUsd, 0));
  const insuranceUsd = Math.max(0, resolveNumber(input.insuranceUsd, 0));

  // Explicit zero handling: 0 is 0% duty, not 5%! 0 is 0% VAT, not 14%!
  const dutyRate = Math.max(0, resolveNumber(input.customsDutyRatePercent, 5)) / 100;
  const vatRate = Math.max(0, resolveNumber(input.vatRatePercent, 14)) / 100;
  const clearanceEgp = Math.max(0, resolveNumber(input.clearanceAndPortFeesEgp, 0));
  const transportEgp = Math.max(0, resolveNumber(input.internalTransportEgp, 0));
  const travelEgp = Math.max(0, resolveNumber(input.travelAndSourcingCostEgp, 0));
  const bankCommEgp = Math.max(0, resolveNumber(input.bankCommissionAndFinancingEgp, 0));
  const markupPercent = Math.max(0, resolveNumber(input.targetMarkupPercent, 25));
  const vatRefundable = Boolean(input.vatIsRefundable);

  // 1. Factory Cost
  let totalFactoryCostUsd = 0;
  let totalUnitsCount = 0;
  for (const item of input.items || []) {
    const qty = Math.max(0, resolveNumber(item.qty, 0));
    const price = Math.max(0, resolveNumber(item.factoryPriceUsd, 0));
    totalFactoryCostUsd += qty * price;
    totalUnitsCount += qty;
  }

  const totalFactoryCostEgp = totalFactoryCostUsd * commRate;
  const internationalShippingEgp = shippingUsd * commRate;
  const insuranceEgp = insuranceUsd * commRate;

  // 2. Customs & CIF Valuation
  const cifValueUsd = totalFactoryCostUsd + shippingUsd + insuranceUsd;
  const cifValueEgp = cifValueUsd * custRate;
  const customsDutyEgp = cifValueEgp * dutyRate;
  const customsVatEgp = (cifValueEgp + customsDutyEgp) * vatRate;

  // 3. Capitalized Overhead (Freight + Insurance + Duty + Clearance + Inland Transport + Non-refundable VAT)
  // Refundable VAT is a Tax Asset (claimable back from ETA), NOT capitalized into inventory.
  const capitalizedOverheadEgp =
    internationalShippingEgp +
    insuranceEgp +
    customsDutyEgp +
    clearanceEgp +
    transportEgp +
    (vatRefundable ? 0 : customsVatEgp);

  // 4. Operating Expenses (Travel/Sourcing Trips, Bank Commissions, Financing costs)
  const operatingExpensesEgp = travelEgp + bankCommEgp;

  // 5. Total Accounting Cost vs Total Cash Outflow (Investment)
  // Accounting Cost = Inventory Cost (Factory + Capitalized Overhead) + Operating Expenses.
  const totalAccountingCostEgp = totalFactoryCostEgp + capitalizedOverheadEgp + operatingExpensesEgp;
  // Cash Outflow required from investor/treasury includes refundable VAT until reclaimed.
  const totalProjectInvestmentEgp = totalAccountingCostEgp + (vatRefundable ? customsVatEgp : 0);

  // 6. Landed Cost Allocations per Item
  const itemsOutput: FeasibilityItemOutput[] = (input.items || []).map((item) => {
    const qty = Math.max(1, resolveNumber(item.qty, 1));
    const unitPriceUsd = Math.max(0, resolveNumber(item.factoryPriceUsd, 0));
    const totalItemUsd = qty * unitPriceUsd;
    const valueRatio = totalFactoryCostUsd > 0 ? totalItemUsd / totalFactoryCostUsd : 1 / (input.items.length || 1);

    const itemCapitalizedOverhead = capitalizedOverheadEgp * valueRatio;
    const itemFactoryCostEgp = totalItemUsd * commRate;
    const totalItemLanded = itemFactoryCostEgp + itemCapitalizedOverhead;
    const unitLanded = totalItemLanded / qty;

    // Wholesale Price (Markup * 0.7) and Retail Price (Full Markup)
    const wholesaleMarkup = 1 + (markupPercent * 0.7) / 100;
    const retailMarkup = 1 + markupPercent / 100;

    const marketPrice = resolveNumber(item.expectedLocalMarketPriceEgp, 0);
    const unitNetProfitVsMarketEgp = marketPrice > 0 ? roundMoney(marketPrice - unitLanded, digits) : undefined;
    const marginVsMarketPercent =
      marketPrice > 0 ? Number((((marketPrice - unitLanded) / marketPrice) * 100).toFixed(1)) : undefined;
    const totalProfitVsMarketEgp = marketPrice > 0 ? roundMoney((marketPrice - unitLanded) * qty, digits) : undefined;

    return {
      name: item.name,
      // I6-A: carry the link natively. Only a finite number is a
      // link — a free-text '' (unlinked form line) must never be
      // stored as a product id.
      productId:
        typeof item.productId === 'number' && Number.isFinite(item.productId) ? item.productId : undefined,
      hsCode: item.hsCode,
      qty,
      factoryPriceUsd: unitPriceUsd,
      totalFactoryUsd: roundMoney(totalItemUsd, digits),
      factoryCostEgp: roundMoney(itemFactoryCostEgp, digits),
      allocatedOverheadEgp: roundMoney(itemCapitalizedOverhead, digits),
      unitLandedCostEgp: roundMoney(unitLanded, digits),
      suggestedWholesalePriceEgp: roundMoney(unitLanded * wholesaleMarkup, digits),
      suggestedRetailPriceEgp: roundMoney(unitLanded * retailMarkup, digits),
      totalItemLandedEgp: roundMoney(totalItemLanded, digits),
      unitWeightKg: item.unitWeightKg,
      unitCbm: item.unitCbm,
      expectedLocalMarketPriceEgp: marketPrice > 0 ? marketPrice : undefined,
      unitNetProfitVsMarketEgp,
      marginVsMarketPercent,
      totalProfitVsMarketEgp,
      partNumber: item.partNumber || item.oemNumber,
      oemNumber: item.oemNumber || item.partNumber,
      brand: item.brand,
      model: item.model,
    };
  });

  // Calculate Container Logistics Load & Weight vs Volume (Vital for Maritime Freight Partner)
  let totalGrossWeightKg = 0;
  let totalVolumeCbm = 0;

  for (const item of input.items || []) {
    const qty = Math.max(0, resolveNumber(item.qty, 0));
    const w = Math.max(0, resolveNumber(item.unitWeightKg, 0));
    const cbm = Math.max(0, resolveNumber(item.unitCbm, 0));
    totalGrossWeightKg += qty * w;
    totalVolumeCbm += qty * cbm;
  }

  const totalGrossWeightTons = Number((totalGrossWeightKg / 1000).toFixed(2));
  totalVolumeCbm = Number(totalVolumeCbm.toFixed(2));

  // Maritime Container Capacity Selection Rules:
  // 20ft: Max legal payload ~25,000 kg, Max volume ~33 CBM (Usable ~28-30 CBM)
  // 40ft: Max legal payload ~26,500 kg, Max volume ~67 CBM (Usable ~58-62 CBM)
  // 40HC: Max legal payload ~26,500 kg, Max volume ~76 CBM (Usable ~68-70 CBM)
  let recommendedContainerType: '20ft' | '40ft' | '40hc' | 'multiple' = '20ft';
  let containerCountNeeded = 1;
  let maxWeightPerCont = 25000;
  let maxCbmPerCont = 33;

  if (totalGrossWeightKg > 26500 || totalVolumeCbm > 68) {
    const byWeight = Math.ceil(totalGrossWeightKg / 26000);
    const byVolume = Math.ceil(totalVolumeCbm / 68);
    containerCountNeeded = Math.max(1, Math.max(byWeight, byVolume));
    recommendedContainerType = containerCountNeeded > 1 ? 'multiple' : '40hc';
    maxWeightPerCont = 26000 * containerCountNeeded;
    maxCbmPerCont = 76 * containerCountNeeded;
  } else if (totalVolumeCbm > 30 || (totalGrossWeightKg > 22000 && totalVolumeCbm > 24)) {
    recommendedContainerType = totalVolumeCbm > 58 ? '40hc' : '40ft';
    maxWeightPerCont = 26500;
    maxCbmPerCont = recommendedContainerType === '40hc' ? 76 : 67;
  } else {
    recommendedContainerType = '20ft';
    maxWeightPerCont = 25000;
    maxCbmPerCont = 33;
  }

  const weightCapacityUtilizationPercent =
    maxWeightPerCont > 0
      ? Number(Math.min(100, (totalGrossWeightKg / maxWeightPerCont) * 100).toFixed(1))
      : 0;

  const volumeCapacityUtilizationPercent =
    maxCbmPerCont > 0
      ? Number(Math.min(100, (totalVolumeCbm / maxCbmPerCont) * 100).toFixed(1))
      : 0;

  const isHeavyCargo = weightCapacityUtilizationPercent >= 75 && volumeCapacityUtilizationPercent <= 65;
  const isBulkyCargo = volumeCapacityUtilizationPercent >= 75 && weightCapacityUtilizationPercent <= 65;
  const isBalancedCargo = !isHeavyCargo && !isBulkyCargo;
  const isOverweightRisk = totalGrossWeightKg / containerCountNeeded > 26500;

  let loadSummaryAr = '';
  if (totalGrossWeightKg === 0 && totalVolumeCbm === 0) {
    loadSummaryAr = 'لم يتم إدخال أوزان أو أحجام الأصناف بعد. يمكنك إدخال وزن وحجم القطعة لحساب حمولة الحاوية آلياً.';
  } else if (isHeavyCargo) {
    loadSummaryAr = `شحنة بضائع ثقيلة (قطع غيار معدنية/حديد). استيعاب الحاوية مغلق بالوزن (${totalGrossWeightTons} طن بنسبة ${weightCapacityUtilizationPercent}%) قبل استنفاذ الحجم المكعب.`;
  } else if (isBulkyCargo) {
    loadSummaryAr = `شحنة بضائع حجمية خفيفة. استيعاب الحاوية مغلق بالحجم (${totalVolumeCbm} CBM بنسبة ${volumeCapacityUtilizationPercent}%) مع وفر كبير في الوزن.`;
  } else if (isOverweightRisk) {
    loadSummaryAr = `تحذير حمولة زائدة: الوزن يتجاوز 26.5 طن للحاوية الواحدة. يلزم تقسيم الشحنة لتجنب غرامات المحاور والموانئ المصرية.`;
  } else {
    loadSummaryAr = `حمولة متوازنة وزناً وحجماً (${totalGrossWeightTons} طن و ${totalVolumeCbm} CBM) ملائمة تماماً للحاوية ${recommendedContainerType.toUpperCase()}.`;
  }

  const containerMetrics: ContainerLoadMetrics = {
    totalGrossWeightKg,
    totalGrossWeightTons,
    totalVolumeCbm,
    recommendedContainerType,
    containerCountNeeded,
    weightCapacityUtilizationPercent,
    volumeCapacityUtilizationPercent,
    isHeavyCargo,
    isBulkyCargo,
    isBalancedCargo,
    isOverweightRisk,
    loadSummaryAr,
  };

  // Local Market Arbitrage & Total Profit vs Local Wholesale Market
  let totalProfitVsMarketEgp: number | undefined;
  let hasAnyMarketPrice = false;
  let aggregatedMarketProfit = 0;

  for (const it of itemsOutput) {
    if (it.totalProfitVsMarketEgp !== undefined) {
      hasAnyMarketPrice = true;
      aggregatedMarketProfit += it.totalProfitVsMarketEgp;
    }
  }

  if (hasAnyMarketPrice) {
    totalProfitVsMarketEgp = roundMoney(aggregatedMarketProfit, digits);
  }

  const overallRoiVsMarketPercent =
    totalProjectInvestmentEgp > 0 && totalProfitVsMarketEgp !== undefined && totalProfitVsMarketEgp > 0
      ? Number(((totalProfitVsMarketEgp / totalProjectInvestmentEgp) * 100).toFixed(1))
      : undefined;

  // 7. Base Scenario
  // Target Revenue based on retail markup over accounting cost
  const baseRevenue = totalAccountingCostEgp * (1 + markupPercent / 100);
  const baseProfit = baseRevenue - totalAccountingCostEgp;
  const baseRoi = totalProjectInvestmentEgp > 0 ? (baseProfit / totalProjectInvestmentEgp) * 100 : 0;
  const baseGrossMargin = baseRevenue > 0 ? (baseProfit / baseRevenue) * 100 : 0;

  // Mathematically correct Break-Even:
  // Units needed to sell at target selling price to recover the total investment:
  // BreakEvenUnits = TotalAccountingCost / AverageSellingPrice = TotalUnits / (1 + Markup)
  const avgSellingPriceBase = totalUnitsCount > 0 ? baseRevenue / totalUnitsCount : 0;
  const baseBreakEvenUnits =
    avgSellingPriceBase > 0 ? Math.min(totalUnitsCount, Math.ceil(totalAccountingCostEgp / avgSellingPriceBase)) : totalUnitsCount;

  // 8. Best Scenario (+10% Revenue, -5% Shipping)
  const bestAccountingCost = totalAccountingCostEgp - internationalShippingEgp * 0.05;
  const bestInvestment = totalProjectInvestmentEgp - internationalShippingEgp * 0.05;
  const bestRevenue = baseRevenue * 1.10;
  const bestProfit = bestRevenue - bestAccountingCost;
  const bestRoi = bestInvestment > 0 ? (bestProfit / bestInvestment) * 100 : 0;
  const bestGrossMargin = bestRevenue > 0 ? (bestProfit / bestRevenue) * 100 : 0;
  const avgSellingPriceBest = totalUnitsCount > 0 ? bestRevenue / totalUnitsCount : 0;
  const bestBreakEvenUnits =
    avgSellingPriceBest > 0 ? Math.min(totalUnitsCount, Math.ceil(bestAccountingCost / avgSellingPriceBest)) : totalUnitsCount;

  // 9. Worst Scenario (-10% Revenue, +15% Shipping/Overhead + demurrage reserve)
  // I2-P9: the demurrage reserve is derived from the shipment's own
  // values, not a fixed 15,000 EGP. Detention accrues per container per
  // day, so the reserve is containerCountNeeded x overdue days x the
  // daily rate, converted at this study's own commercial rate. The daily
  // rate ($50/day) is the same default calculateDemurrageRisk in
  // import-landed-cost.engine.ts assumes — one canonical rate, not a
  // second invented number. The 6 overdue days decode the old flat
  // 15,000 EGP at the trial's rate (15,000 / ($50/day x 50 EGP/USD) =
  // 6 days), so a one-container study at FX 50 still reserves exactly
  // 15,000, while a two-container study reserves twice that and a study
  // priced at FX 48.5 reserves 14,550. No cap: a cap would understate
  // real detention exposure for large shipments — the container count is
  // the correct physical bound.
  const WORST_CASE_DEMURRAGE_OVERDUE_DAYS = 6;
  const DEMURRAGE_DAILY_RATE_USD = 50;
  const worstDemurrageReserveEgp =
    containerCountNeeded * WORST_CASE_DEMURRAGE_OVERDUE_DAYS * DEMURRAGE_DAILY_RATE_USD * commRate;
  const worstAccountingCost = totalAccountingCostEgp + capitalizedOverheadEgp * 0.15 + worstDemurrageReserveEgp;
  const worstInvestment = totalProjectInvestmentEgp + capitalizedOverheadEgp * 0.15 + worstDemurrageReserveEgp;
  const worstRevenue = baseRevenue * 0.90;
  const worstProfit = worstRevenue - worstAccountingCost;
  const worstRoi = worstInvestment > 0 ? (worstProfit / worstInvestment) * 100 : 0;
  const worstGrossMargin = worstRevenue > 0 ? (worstProfit / worstRevenue) * 100 : 0;
  const avgSellingPriceWorst = totalUnitsCount > 0 ? worstRevenue / totalUnitsCount : 0;
  const worstBreakEvenUnits =
    avgSellingPriceWorst > 0 ? Math.ceil(worstAccountingCost / avgSellingPriceWorst) : totalUnitsCount;

  return {
    totalFactoryCostUsd: roundMoney(totalFactoryCostUsd, digits),
    totalFactoryCostEgp: roundMoney(totalFactoryCostEgp, digits),
    internationalShippingUsd: roundMoney(shippingUsd, digits),
    internationalShippingEgp: roundMoney(internationalShippingEgp, digits),
    insuranceUsd: roundMoney(insuranceUsd, digits),
    insuranceEgp: roundMoney(insuranceEgp, digits),
    cifValueUsd: roundMoney(cifValueUsd, digits),
    cifValueEgp: roundMoney(cifValueEgp, digits),
    customsDutyEgp: roundMoney(customsDutyEgp, digits),
    customsVatEgp: roundMoney(customsVatEgp, digits),
    vatRefundableEgp: roundMoney(vatRefundable ? customsVatEgp : 0, digits),
    clearanceAndPortFeesEgp: roundMoney(clearanceEgp, digits),
    internalTransportEgp: roundMoney(transportEgp, digits),
    capitalizedOverheadEgp: roundMoney(capitalizedOverheadEgp, digits),
    operatingExpensesEgp: roundMoney(operatingExpensesEgp, digits),
    totalAccountingCostEgp: roundMoney(totalAccountingCostEgp, digits),
    totalProjectInvestmentEgp: roundMoney(totalProjectInvestmentEgp, digits),
    totalUnitsCount,
    items: itemsOutput,
    targetRevenueEgp: roundMoney(baseRevenue, digits),
    expectedNetProfitEgp: roundMoney(baseProfit, digits),
    roiPercentage: Number(baseRoi.toFixed(2)),
    markupPercentage: Number(markupPercent.toFixed(2)),
    grossMarginPercentage: Number(baseGrossMargin.toFixed(2)),
    breakEvenRevenueEgp: roundMoney(totalAccountingCostEgp, digits),
    breakEvenUnits: baseBreakEvenUnits,
    containerMetrics,
    totalProfitVsMarketEgp,
    overallRoiVsMarketPercent,
    scenarios: {
      base: {
        scenarioName: 'base',
        totalInvestmentEgp: roundMoney(totalProjectInvestmentEgp, digits),
        expectedRevenueEgp: roundMoney(baseRevenue, digits),
        expectedNetProfitEgp: roundMoney(baseProfit, digits),
        roiPercentage: Number(baseRoi.toFixed(2)),
        grossMarginPercentage: Number(baseGrossMargin.toFixed(2)),
        breakEvenUnits: baseBreakEvenUnits,
        breakEvenRevenueEgp: roundMoney(totalAccountingCostEgp, digits),
        demurrageReserveEgp: 0,
      },
      best: {
        scenarioName: 'best',
        totalInvestmentEgp: roundMoney(bestInvestment, digits),
        expectedRevenueEgp: roundMoney(bestRevenue, digits),
        expectedNetProfitEgp: roundMoney(bestProfit, digits),
        roiPercentage: Number(bestRoi.toFixed(2)),
        grossMarginPercentage: Number(bestGrossMargin.toFixed(2)),
        breakEvenUnits: bestBreakEvenUnits,
        breakEvenRevenueEgp: roundMoney(bestAccountingCost, digits),
        demurrageReserveEgp: 0,
      },
      worst: {
        scenarioName: 'worst',
        totalInvestmentEgp: roundMoney(worstInvestment, digits),
        expectedRevenueEgp: roundMoney(worstRevenue, digits),
        expectedNetProfitEgp: roundMoney(worstProfit, digits),
        roiPercentage: Number(worstRoi.toFixed(2)),
        grossMarginPercentage: Number(worstGrossMargin.toFixed(2)),
        breakEvenUnits: worstBreakEvenUnits,
        breakEvenRevenueEgp: roundMoney(worstAccountingCost, digits),
        demurrageReserveEgp: roundMoney(worstDemurrageReserveEgp, digits),
      },
    },
  };
}
