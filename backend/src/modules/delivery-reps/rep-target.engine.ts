/**
 * Pure Calculation Engine for Representative Monthly Sales Targets.
 *
 * Complies with Rule 13 (Strict Financial & Operational Audit Protocol:
 * Tests Must Import Production Code). Both the backend service and unit
 * tests must import this exact file.
 *
 * Book digits are REQUIRED for the money functions in this file
 * (INV-REP-COMMISSION-DIGITS): commissions and rep-isolated customer
 * balances are money owed to people, so rounding them at an assumed 2
 * decimals would silently cut a 3-decimal tenant's payouts. The old
 * file-private 2-decimal rounder (which also swallowed non-finite
 * values to 0) is gone; rounding goes through the canonical engine
 * at the caller's digits and fails closed on non-finite input.
 * calculateRepTargetMetrics normalizes its money INPUTS at the
 * caller's book digits (INV-REP-TARGET-METRICS-DIGITS): the old
 * toFixed(2) normalization misstated a 3-decimal tenant's target
 * and actuals by up to half a minor unit and could even flip the
 * achieved comparison for a rep 0.001 short of target. Its
 * remaining/required-daily OUTPUTS deliberately stay whole
 * currency units (Math.round / Math.ceil) — a display convention
 * the frontend duplicates when it renders them — so only the
 * three input normalizations take digits, never the outputs.
 */

export {
  type RepTargetCalculationInput,
  type RepTargetCalculationResult,
  calculateRepTargetMetrics,
} from './rep-target/rep-target-metrics.slice';
export {
  type RepCommissionInput,
  type RepCommissionMetricsResult,
  calculateRepCommissionMetrics,
} from './rep-target/rep-commission.slice';
export {
  isValidCoordinatePair,
  extractCoordinatesFromCustomerLocation,
  calculateHaversineDistanceMeters,
  type GeofenceEvaluationResult,
  evaluateGeofenceCompliance,
} from './rep-target/rep-geo.slice';
export { type BatchExpiryStatusResult, evaluateBatchExpiryStatus } from './rep-target/batch-expiry.slice';
export {
  type CustomerRepLedgerEntryInput,
  type CustomerRepBalanceItem,
  type CustomerRepBalanceBreakdown,
  extractAssignedRepIds,
} from './rep-target/rep-ids.slice';
export {
  type RepPermissionFlags,
  VAN_REP_DISCOUNT_CAP_DEFAULT_PERCENT,
  VAN_REP_DISCOUNT_CAP_SETTING_KEYS,
  getVanRepDiscountCapPercent,
  VAN_CASH_DISCOUNT_DEFAULT_PERCENT,
  VAN_CASH_DISCOUNT_SETTING_KEYS,
  getCashDiscountPercent,
  REP_PERMISSION_DEFAULTS,
  REP_PERMISSION_LEGACY,
  parseRepPermissions,
  loadRepPermissions,
} from '../../common/utils/rep-settings.slice';
export {
  hasGpsCoordinates,
  aggregateCustomerBalancesByRep,
  resolveIsolatedRepCustomerBalance,
  validateIsolatedRepCollection,
} from './rep-target/rep-balances.slice';
