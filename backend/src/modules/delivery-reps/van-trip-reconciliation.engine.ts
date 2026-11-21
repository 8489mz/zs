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
} from './van-trip-reconciliation/van-trip-reconciliation.types';
export { reconcileTripFinancials } from './van-trip-reconciliation/reconcile-trip-financials.slice';
export { reconcileVanStockAudit } from './van-trip-reconciliation/reconcile-van-stock-audit.slice';
export {
  evaluateCreditLimitCheck,
} from './van-trip-reconciliation/evaluate-credit-limit-check.slice';
export {
  evaluateOdometerReadings,
} from './van-trip-reconciliation/evaluate-odometer-readings.slice';
export {
  evaluateMakerCheckerSettlement,
  evaluateNightStockRetention,
  evaluateFieldCardPayment,
} from './van-trip-reconciliation/evaluate-settlement-governance.slice';
export {
  evaluateTripExpenseGovernance,
} from './van-trip-reconciliation/evaluate-trip-expense-governance.slice';
export {
  FieldReturnEvaluationItem,
  FieldReturnOriginalSaleItem,
  FieldReturnOriginalSale,
  RepCustomerSalesHistoryProduct,
  FieldReturnEvaluationParams,
  FieldReturnEvaluationResult,
  evaluateFieldReturnGovernance,
} from './van-trip-reconciliation/evaluate-field-return-governance.slice';
export {
  VALID_NEGATIVE_VISIT_REASONS,
  NegativeVisitReason,
  ItineraryVisitEvaluationParams,
  ItineraryVisitEvaluationResult,
  evaluateItineraryVisitRules,
} from './van-trip-reconciliation/evaluate-itinerary-visit-rules.slice';
export {
  RequisitionItemInput,
  RequisitionSplitGroup,
  splitRequisitionByWarehouse,
} from './van-trip-reconciliation/split-requisition-by-warehouse.slice';
export {
  formatVanSettlementSummaryText,
} from './van-trip-reconciliation/format-van-settlement-summary-text.slice';
export {
  DamagedSwapParams,
  DamagedSwapResult,
  evaluateDamagedSwap,
} from './van-trip-reconciliation/evaluate-damaged-swap.slice';
