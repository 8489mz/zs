import type { MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export interface TripFinancialSummaryInput {
  loadedAmount: number;
  salesAmount: number;
  cashSales: number;
  creditSales: number;
  fieldCollections: number;
  returnsAmount: number;
  cashRefunds: number;
  tripExpenses?: number;
  countedCash: number;
  remainingVanStockValue: number;
  instapaySales?: number;
  instapayCollections?: number;
  // REQUIRED (INV-TRIP-RECONCILIATION-DIGITS): every amount in the
  // reconciliation rounds at the tenant's book digits. The 0.05 /
  // 0.01 status bands below are policy, not precision, and do not
  // take digits.
  moneyDigits: MoneyDigits;
}

export interface TripFinancialReconciliationResult {
  totalLoaded: number;
  totalSales: number;
  expectedRemainingValue: number;
  actualRemainingValue: number;
  isGoodsEquationBalanced: boolean;
  goodsEquationDiscrepancy: number;
  totalTripExpenses: number;
  expectedCash: number;
  countedCash: number;
  cashVariance: number;
  cashVarianceStatus: 'balanced' | 'shortage' | 'overage';
  cashShortageAmount: number;
  cashOverageAmount: number;
  totalInstapaySales?: number;
  totalInstapayCollections?: number;
  expectedBankTransfers?: number;
}

export interface VanStockAuditItem {
  productId: number;
  productName: string;
  systemQty: number;
  countedQty?: number;
  costPrice: number;
  retailPrice: number;
}

export interface VanStockItemVariance {
  productId: number;
  productName: string;
  systemQty: number;
  countedQty: number;
  /** True only when a physical count was supplied for this item. */
  counted: boolean;
  varianceQty: number;
  costPrice: number;
  retailPrice: number;
  shortageCost: number;
  overageCost: number;
  status: 'balanced' | 'shortage' | 'overage';
}

/** An item in the van that nobody counted during the audit. */
export interface VanStockUncountedItem {
  productId: number;
  productName: string;
  systemQty: number;
  costPrice: number;
}

export interface VanStockAuditResult {
  totalSystemItems: number;
  auditedItemsCount: number;
  varianceItemsCount: number;
  hasStockDiscrepancy: boolean;
  totalStockShortageCost: number;
  totalStockOverageCost: number;
  netStockVarianceCost: number;
  itemVariances: VanStockItemVariance[];
  /**
   * INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: an item nobody counted is
   * NOT certified balanced — it is listed here and the settle must
   * refuse to certify the audit while this list is non-empty. The
   * numeric variance of such an item stays 0 (status 'balanced',
   * countedQty shown as the system qty for display only); only
   * `counted` / this list say whether it was actually verified.
   * hasStockDiscrepancy stays a counted-variance signal only, so an
   * uncounted-only audit is "incomplete", not "discrepant".
   */
  hasUncountedItems: boolean;
  uncountedItemsCount: number;
  uncountedItems: VanStockUncountedItem[];
}

export interface CreditLimitEvaluationParams {
  // REQUIRED (D4, like reconcileTripFinancials): every amount in the
  // evaluation rounds at the tenant's book digits.
  moneyDigits: MoneyDigits;
  customerId: number;
  customerName: string;
  currentBalance: number;
  creditLimit: number;
  isCreditBlocked: boolean;
  creditBlockReason?: string | null;
  customerType?: string | null;
  isFieldCreatedCustomer?: boolean;
  requestedCreditAmount: number;
  hasOverdueInvoices?: boolean;
  oldestOverdueDays?: number;
  overdueAmount?: number;
  supervisorOverride?: {
    approved: boolean;
    supervisorId?: number;
    supervisorName?: string;
    reason?: string;
  };
}

export interface CreditLimitEvaluationResult {
  allowed: boolean;
  isOverridden?: boolean;
  overrideReason?: string;
  reasonCode?: 'CUSTOMER_BLOCKED' | 'CASH_ONLY_CUSTOMER' | 'LIMIT_EXCEEDED' | 'ZERO_OR_NEGATIVE_REQUEST' | 'SUPERVISOR_OVERRIDE' | 'CUSTOMER_HAS_OVERDUE_INVOICES';
  errorMessageAr?: string;
  currentBalance: number;
  creditLimit: number;
  requestedCreditAmount: number;
  projectedBalance: number;
  exceededAmount: number;
}

export interface FieldCardPaymentEvaluationParams {
  totalSaleAmount: number;
  referenceReason?: string | null;
  supervisorOverride?: {
    approved: boolean;
    supervisorId?: number;
    supervisorName?: string;
    reason?: string;
  };
}

export interface FieldCardPaymentEvaluationResult {
  allowed: boolean;
  reasonCode?: 'CARD_PAYMENT_REQUIRES_SUPERVISOR_PIN' | 'CARD_PAYMENT_REFERENCE_REQUIRED' | 'SUPERVISOR_APPROVED';
  errorMessageAr?: string;
  approvedReference?: string;
}

export interface TripExpenseGovernanceParams {
  // REQUIRED (D4): the expense amounts round at the tenant's book digits.
  moneyDigits: MoneyDigits;
  expenseType: string;
  amount: number;
  notes?: string | null;
  existingTripExpenses: number;
  maxSinglePettyExpense?: number;
  maxCumulativePettyExpenses?: number;
  supervisorOverride?: {
    approved: boolean;
    supervisorId?: number;
    supervisorName?: string;
  };
}

export interface TripExpenseGovernanceResult {
  allowed: boolean;
  requiresSupervisorPin: boolean;
  reasonCode?: 'INVALID_AMOUNT' | 'EXPENSE_NOTES_REQUIRED' | 'EXPENSE_REQUIRES_SUPERVISOR_PIN' | 'SUPERVISOR_APPROVED' | 'ROUTINE_PETTY_ALLOWED';
  errorMessageAr?: string;
  projectedTripExpenses: number;
}

export interface OdometerEvaluationParams {
  startOdometer?: number | null;
  endOdometer?: number | null;
}

export interface OdometerEvaluationResult {
  valid: boolean;
  errorMessageAr?: string;
  startOdometer: number;
  endOdometer: number;
  distanceKm: number;
}

export interface MakerCheckerParams {
  repUserId?: number | null;
  actorUserId: number;
  actorRole: string;
  isSupervisorOrAdmin: boolean;
}

export interface MakerCheckerResult {
  allowed: boolean;
  reasonCode?: 'MAKER_CHECKER_SELF_APPROVAL' | 'UNAUTHORIZED_ROLE';
  errorMessageAr?: string;
}

export interface NightStockEvaluationParams {
  unloadRemainingToWarehouse: boolean;
  remainingItemsCount: number;
  nightStockApproved: boolean;
  nightStockNotes?: string | null;
}

export interface NightStockEvaluationResult {
  allowed: boolean;
  status: 'unloaded_to_warehouse' | 'night_stock_approved' | 'rejected_missing_approval';
  errorMessageAr?: string;
}
