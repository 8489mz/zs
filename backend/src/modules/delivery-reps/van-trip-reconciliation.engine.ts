/**
 * Van Trip Reconciliation Engine (Pure Calculation & Governance Engine)
 *
 * Implements mathematical trip balance equations, cash variance calculation,
 * physical stock audit reconciliation, customer credit limit evaluation,
 * odometer distance tracking, and Maker-Checker segregation of duties.
 *
 * Strict Constitutional Invariant:
 * This module is pure (0 database access, 0 I/O side effects).
 * It is identically imported by the production service and unit test suites.
 * The single permitted import is the canonical money engine
 * (INV-TRIP-RECONCILIATION-DIGITS): it is pure computation with no
 * I/O, and it is the only rounding the money functions here may use.
 * The 0.05 goods-equation tolerance and the 0.01 cash-variance status
 * band in reconcileTripFinancials are policy bands, not precision —
 * they are deliberately unchanged (see the invariant entry).
 */

export {
  TripFinancialSummaryInput,
  TripFinancialReconciliationResult,
  VanStockAuditItem,
  VanStockItemVariance,
  VanStockUncountedItem,
  VanStockAuditResult,
  CreditLimitEvaluationParams,
  CreditLimitEvaluationResult,
  FieldCardPaymentEvaluationParams,
  FieldCardPaymentEvaluationResult,
  TripExpenseGovernanceParams,
  TripExpenseGovernanceResult,
  OdometerEvaluationParams,
  OdometerEvaluationResult,
  MakerCheckerParams,
  MakerCheckerResult,
  NightStockEvaluationParams,
  NightStockEvaluationResult,
} from './van-trip-reconciliation.types.ts';
export { reconcileTripFinancials } from './reconcile-trip-financials.slice.ts';
export { reconcileVanStockAudit } from './reconcile-van-stock-audit.slice.ts';
export { evaluateCreditLimitCheck } from './evaluate-credit-limit-check.slice.ts';
export { evaluateOdometerReadings } from './evaluate-odometer-readings.slice.ts';
export {
  evaluateMakerCheckerSettlement,
  evaluateNightStockRetention,
  evaluateFieldCardPayment,
} from './evaluate-settlement-governance.slice.ts';
export { evaluateTripExpenseGovernance } from './evaluate-trip-expense-governance.slice.ts';
export {
  FieldReturnEvaluationItem,
  FieldReturnOriginalSaleItem,
  FieldReturnOriginalSale,
  RepCustomerSalesHistoryProduct,
  FieldReturnEvaluationParams,
  FieldReturnEvaluationResult,
  evaluateFieldReturnGovernance,
} from './evaluate-field-return-governance.slice.ts';
export {
  VALID_NEGATIVE_VISIT_REASONS,
  NegativeVisitReason,
  ItineraryVisitEvaluationParams,
  ItineraryVisitEvaluationResult,
  evaluateItineraryVisitRules,
} from './evaluate-itinerary-visit-rules.slice.ts';
export {
  RequisitionItemInput,
  RequisitionSplitGroup,
  splitRequisitionByWarehouse,
} from './split-requisition-by-warehouse.slice.ts';
export { formatVanSettlementSummaryText } from './format-van-settlement-summary-text.slice.ts';
export {
  DamagedSwapParams,
  DamagedSwapResult,
  evaluateDamagedSwap,
} from './evaluate-damaged-swap.slice.ts';
