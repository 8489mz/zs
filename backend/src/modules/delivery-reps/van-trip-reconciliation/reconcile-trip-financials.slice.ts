import { roundMoney as roundBookMoney } from '../../accounting/engines/money-minor-units.engine';
import type { TripFinancialSummaryInput, TripFinancialReconciliationResult } from './van-trip-reconciliation.types';

/**
 * Reconciles the daily van trip closing financial figures.
 * Equation: [قيمة البضاعة المحملة] = [المبيعات النقدية] + [المبيعات الآجلة] + [البضاعة المتبقية في السيارة] - [المرتجعات]
 */
export function reconcileTripFinancials(input: TripFinancialSummaryInput): TripFinancialReconciliationResult {
  const totalLoaded = roundBookMoney(input.loadedAmount, input.moneyDigits);
  const totalSales = roundBookMoney(input.salesAmount, input.moneyDigits);
  const cashSales = roundBookMoney(input.cashSales, input.moneyDigits);
  const creditSales = roundBookMoney(input.creditSales, input.moneyDigits);
  const fieldCollections = roundBookMoney(input.fieldCollections, input.moneyDigits);
  const returnsAmount = roundBookMoney(input.returnsAmount, input.moneyDigits);
  const cashRefunds = roundBookMoney(input.cashRefunds, input.moneyDigits);
  const totalTripExpenses = roundBookMoney(input.tripExpenses || 0, input.moneyDigits);
  const countedCash = roundBookMoney(input.countedCash, input.moneyDigits);
  const actualRemainingValue = roundBookMoney(input.remainingVanStockValue, input.moneyDigits);

  // Expected remaining van stock value based on loading, sales, and returns
  // Remaining = Loaded - Sales + Returns
  const expectedRemainingValue = roundBookMoney(totalLoaded - totalSales + returnsAmount, input.moneyDigits);

  // Verification of the canonical equation:
  // Accounted Goods Value = (Cash Sales + Credit Sales) + Remaining Van Stock - Customer Returns
  const accountedGoodsValue = roundBookMoney(totalSales + actualRemainingValue - returnsAmount, input.moneyDigits);
  const goodsEquationDiscrepancy = roundBookMoney(totalLoaded - accountedGoodsValue, input.moneyDigits);
  const isGoodsEquationBalanced = Math.abs(goodsEquationDiscrepancy) <= 0.05;

  // Expected Cash = Cash Sales + Collections - Cash Refunds for Returns - Approved Trip Expenses
  const expectedCash = roundBookMoney(
    cashSales + fieldCollections - cashRefunds - totalTripExpenses,
    input.moneyDigits,
  );
  const cashVariance = roundBookMoney(countedCash - expectedCash, input.moneyDigits);

  let cashVarianceStatus: 'balanced' | 'shortage' | 'overage' = 'balanced';
  let cashShortageAmount = 0;
  let cashOverageAmount = 0;

  if (cashVariance < -0.01) {
    cashVarianceStatus = 'shortage';
    cashShortageAmount = roundBookMoney(Math.abs(cashVariance), input.moneyDigits);
  } else if (cashVariance > 0.01) {
    cashVarianceStatus = 'overage';
    cashOverageAmount = roundBookMoney(cashVariance, input.moneyDigits);
  }

  const instapaySales = roundBookMoney(input.instapaySales || 0, input.moneyDigits);
  const instapayCollections = roundBookMoney(input.instapayCollections || 0, input.moneyDigits);
  const expectedBankTransfers = roundBookMoney(instapaySales + instapayCollections, input.moneyDigits);

  return {
    totalLoaded,
    totalSales,
    expectedRemainingValue,
    actualRemainingValue,
    isGoodsEquationBalanced,
    goodsEquationDiscrepancy,
    totalTripExpenses,
    expectedCash,
    countedCash,
    cashVariance,
    cashVarianceStatus,
    cashShortageAmount,
    cashOverageAmount,
    totalInstapaySales: instapaySales,
    totalInstapayCollections: instapayCollections,
    expectedBankTransfers,
  };
}
