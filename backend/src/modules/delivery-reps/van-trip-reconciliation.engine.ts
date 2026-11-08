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

import { type MoneyDigits, roundMoney as roundBookMoney } from '../accounting/engines/money-minor-units.engine';

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
  varianceQty: number;
  costPrice: number;
  retailPrice: number;
  shortageCost: number;
  overageCost: number;
  status: 'balanced' | 'shortage' | 'overage';
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
  const expectedCash = roundBookMoney(cashSales + fieldCollections - cashRefunds - totalTripExpenses, input.moneyDigits);
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

/**
 * Reconciles physical stock audit of items in the van against system stock balances.
 */
export function reconcileVanStockAudit(items: VanStockAuditItem[], digits: MoneyDigits): VanStockAuditResult {
  const toQty = (val: number) => Number((Number(val) || 0).toFixed(4));

  let totalStockShortageCost = 0;
  let totalStockOverageCost = 0;
  const itemVariances: VanStockItemVariance[] = [];

  for (const item of items) {
    const systemQty = toQty(item.systemQty);
    const countedQty = item.countedQty !== undefined ? toQty(item.countedQty) : systemQty;
    const varianceQty = toQty(countedQty - systemQty);
    const costPrice = Number(item.costPrice || 0);
    const retailPrice = Number(item.retailPrice || 0);

    let status: 'balanced' | 'shortage' | 'overage' = 'balanced';
    let shortageCost = 0;
    let overageCost = 0;

    if (varianceQty < -0.0001) {
      status = 'shortage';
      shortageCost = roundBookMoney(Math.abs(varianceQty) * costPrice, digits);
      totalStockShortageCost += shortageCost;
    } else if (varianceQty > 0.0001) {
      status = 'overage';
      overageCost = roundBookMoney(varianceQty * costPrice, digits);
      totalStockOverageCost += overageCost;
    }

    itemVariances.push({
      productId: item.productId,
      productName: item.productName,
      systemQty,
      countedQty,
      varianceQty,
      costPrice,
      retailPrice,
      shortageCost,
      overageCost,
      status,
    });
  }

  totalStockShortageCost = roundBookMoney(totalStockShortageCost, digits);
  totalStockOverageCost = roundBookMoney(totalStockOverageCost, digits);
  const netStockVarianceCost = roundBookMoney(totalStockOverageCost - totalStockShortageCost, digits);
  const varianceItemsCount = itemVariances.filter((iv) => iv.status !== 'balanced').length;

  return {
    totalSystemItems: items.length,
    auditedItemsCount: items.filter((i) => i.countedQty !== undefined).length,
    varianceItemsCount,
    hasStockDiscrepancy: varianceItemsCount > 0,
    totalStockShortageCost,
    totalStockOverageCost,
    netStockVarianceCost,
    itemVariances,
  };
}

/**
 * Evaluates whether a field credit or split sale is allowed for a customer.
 */
export function evaluateCreditLimitCheck(params: CreditLimitEvaluationParams): CreditLimitEvaluationResult {
  const currentBalance = roundBookMoney(Number(params.currentBalance) || 0, params.moneyDigits);
  const creditLimit = roundBookMoney(Number(params.creditLimit) || 0, params.moneyDigits);
  const requestedCreditAmount = roundBookMoney(Number(params.requestedCreditAmount) || 0, params.moneyDigits);
  const projectedBalance = roundBookMoney(currentBalance + requestedCreditAmount, params.moneyDigits);

  if (requestedCreditAmount <= 0) {
    return {
      allowed: false,
      reasonCode: 'ZERO_OR_NEGATIVE_REQUEST',
      errorMessageAr: 'مبلغ الائتمان المطلوب يجب أن يكون أكبر من الصفر',
      currentBalance,
      creditLimit,
      requestedCreditAmount,
      projectedBalance,
      exceededAmount: 0,
    };
  }

  if (params.isCreditBlocked) {
    if (params.supervisorOverride?.approved) {
      return {
        allowed: true,
        isOverridden: true,
        overrideReason: params.supervisorOverride.reason || 'اعتماد استثنائي من المشرف لتجاوز حظر العميل',
        reasonCode: 'SUPERVISOR_OVERRIDE',
        currentBalance,
        creditLimit,
        requestedCreditAmount,
        projectedBalance,
        exceededAmount: 0,
      };
    }
    const reasonDetail = params.creditBlockReason ? `: ${params.creditBlockReason}` : '';
    return {
      allowed: false,
      reasonCode: 'CUSTOMER_BLOCKED',
      errorMessageAr: `تم حظر البيع الآجل للعميل "${params.customerName}" بناءً على سياسة التحصيل والرقابة الائتمانية${reasonDetail}`,
      currentBalance,
      creditLimit,
      requestedCreditAmount,
      projectedBalance,
      exceededAmount: 0,
    };
  }

  if (params.hasOverdueInvoices && (Number(params.overdueAmount || 0) > 0 || Number(params.oldestOverdueDays || 0) > 0)) {
    if (params.supervisorOverride?.approved) {
      return {
        allowed: true,
        isOverridden: true,
        overrideReason: params.supervisorOverride.reason || 'اعتماد استثنائي من المشرف لتجاوز حظر الفواتير المتأخرة',
        reasonCode: 'SUPERVISOR_OVERRIDE',
        currentBalance,
        creditLimit,
        requestedCreditAmount,
        projectedBalance,
        exceededAmount: 0,
      };
    }
    const overdueDays = params.oldestOverdueDays || 0;
    const overdueAmt = Number(params.overdueAmount || 0).toFixed(2);
    return {
      allowed: false,
      reasonCode: 'CUSTOMER_HAS_OVERDUE_INVOICES',
      errorMessageAr: `يوجد على العميل "${params.customerName}" فواتير متأخرة مستحقة السداد منذ (${overdueDays}) يوماً بإجمالي (${overdueAmt} ج.م). يجب سداد الفواتير المتأخرة أو إدخال رمز اعتماد المشرف (Supervisor PIN)`,
      currentBalance,
      creditLimit,
      requestedCreditAmount,
      projectedBalance,
      exceededAmount: 0,
    };
  }

  const isCashOnlyOrFieldCustomer =
    (String(params.customerType || '').toLowerCase() === 'cash' || Boolean(params.isFieldCreatedCustomer)) &&
    creditLimit <= 0;

  if (isCashOnlyOrFieldCustomer) {
    if (params.supervisorOverride?.approved) {
      return {
        allowed: true,
        isOverridden: true,
        overrideReason:
          params.supervisorOverride.reason || 'اعتماد استثنائي من المشرف للبيع الآجل لعميل نقدي بدون سقف ائتماني',
        reasonCode: 'SUPERVISOR_OVERRIDE',
        currentBalance,
        creditLimit,
        requestedCreditAmount,
        projectedBalance,
        exceededAmount: requestedCreditAmount,
      };
    }
    return {
      allowed: false,
      reasonCode: 'CASH_ONLY_CUSTOMER',
      errorMessageAr: `العميل "${params.customerName}" مصنف كعميل نقدي (سقف الائتمان = 0.00)؛ لا يُسمح بالبيع الآجل أو الجزئي له إلا بعد تخصيص سقف ائتمان من الإدارة أو إدخال رمز اعتماد المشرف (Supervisor PIN)`,
      currentBalance,
      creditLimit,
      requestedCreditAmount,
      projectedBalance,
      exceededAmount: requestedCreditAmount,
    };
  }

  if (creditLimit > 0 && projectedBalance > creditLimit) {
    const exceededAmount = roundBookMoney(projectedBalance - creditLimit, params.moneyDigits);
    if (params.supervisorOverride?.approved) {
      return {
        allowed: true,
        isOverridden: true,
        overrideReason: params.supervisorOverride.reason || `اعتماد استثنائي لتجاوز سقف الائتمان بمقدار ${exceededAmount.toFixed(2)}`,
        reasonCode: 'SUPERVISOR_OVERRIDE',
        currentBalance,
        creditLimit,
        requestedCreditAmount,
        projectedBalance,
        exceededAmount,
      };
    }
    return {
      allowed: false,
      reasonCode: 'LIMIT_EXCEEDED',
      errorMessageAr: `تجاوز العميل "${params.customerName}" سقف الائتمان المسموح به (${creditLimit.toFixed(2)}). الرصيد الحالي: ${currentBalance.toFixed(2)}، والمطلوب: ${requestedCreditAmount.toFixed(2)}، الفائض عن السقف: ${exceededAmount.toFixed(2)}`,
      currentBalance,
      creditLimit,
      requestedCreditAmount,
      projectedBalance,
      exceededAmount,
    };
  }

  return {
    allowed: true,
    currentBalance,
    creditLimit,
    requestedCreditAmount,
    projectedBalance,
    exceededAmount: 0,
  };
}

/**
 * Validates start and end vehicle odometer readings.
 */
export function evaluateOdometerReadings(params: OdometerEvaluationParams): OdometerEvaluationResult {
  const start = params.startOdometer !== null && params.startOdometer !== undefined ? Number(params.startOdometer) : 0;
  const end = params.endOdometer !== null && params.endOdometer !== undefined ? Number(params.endOdometer) : 0;

  if (params.endOdometer !== null && params.endOdometer !== undefined && params.startOdometer !== null && params.startOdometer !== undefined) {
    if (end < start) {
      return {
        valid: false,
        errorMessageAr: `قراءة عداد نهاية الرحلة (${end}) لا يمكن أن تكون أقل من قراءة بداية الرحلة (${start})`,
        startOdometer: start,
        endOdometer: end,
        distanceKm: 0,
      };
    }
  }

  const distanceKm = Number((Math.max(0, end - start)).toFixed(2));

  return {
    valid: true,
    startOdometer: start,
    endOdometer: end,
    distanceKm,
  };
}

/**
 * Evaluates Maker-Checker segregation of duties.
 * The delivery representative who executed the trip CANNOT be the supervisor approving the settlement.
 */
export function evaluateMakerCheckerSettlement(params: MakerCheckerParams): MakerCheckerResult {
  if (params.repUserId && params.repUserId === params.actorUserId) {
    return {
      allowed: false,
      reasonCode: 'MAKER_CHECKER_SELF_APPROVAL',
      errorMessageAr: 'لا يجوز لمندوب المبيعات اعتماد وإبراء تصفية رحلته بنفسه طبقاً لمبدأ فصل المهام الرقابي (Maker-Checker)',
    };
  }

  if (!params.isSupervisorOrAdmin) {
    return {
      allowed: false,
      reasonCode: 'UNAUTHORIZED_ROLE',
      errorMessageAr: 'اعتماد وتصفية رحلة التوزيع يتطلب صلاحية مشرف أو أمين خزينة معتمد',
    };
  }

  return {
    allowed: true,
  };
}

/**
 * Evaluates whether overnight van inventory retention (Night Stock) is permitted.
 */
export function evaluateNightStockRetention(params: NightStockEvaluationParams): NightStockEvaluationResult {
  if (params.unloadRemainingToWarehouse) {
    return {
      allowed: true,
      status: 'unloaded_to_warehouse',
    };
  }

  // Stock is requested to remain in van overnight
  if (params.remainingItemsCount > 0) {
    if (!params.nightStockApproved) {
      return {
        allowed: false,
        status: 'rejected_missing_approval',
        errorMessageAr: 'إبقاء بضاعة متبقية في سيارة التوزيع لليوم التالي (Night Stock) يتطلب اعتماداً رسمياً صريحاً من المشرف مع تدوين المبررات',
      };
    }

    return {
      allowed: true,
      status: 'night_stock_approved',
    };
  }

  return {
    allowed: true,
    status: 'unloaded_to_warehouse',
  };
}

/**
 * Evaluates field card/bank transfer payment governance.
 * Prevents a field rep from collecting cash from a customer while marking the invoice as "card"
 * without a verified POS receipt/bank transfer reference and Supervisor PIN authorization.
 */
export function evaluateFieldCardPayment(params: FieldCardPaymentEvaluationParams): FieldCardPaymentEvaluationResult {
  const reference = String(params.referenceReason || params.supervisorOverride?.reason || '').trim();

  if (!params.supervisorOverride?.approved) {
    return {
      allowed: false,
      reasonCode: 'CARD_PAYMENT_REQUIRES_SUPERVISOR_PIN',
      errorMessageAr: 'الدفع بالشبكة أو التحويل البنكي في الميدان يتطلب إدخال رمز اعتماد المشرف (Supervisor PIN) للتحقق من وصول الإشعار البنكي ومنع التلاعب بالنقدية المحصلة',
    };
  }

  if (reference.length < 3) {
    return {
      allowed: false,
      reasonCode: 'CARD_PAYMENT_REFERENCE_REQUIRED',
      errorMessageAr: 'يرجى تدوين رقم مرجع إيصال الشبكة أو الحوالة البنكية (3 أحرف/أرقام على الأقل) لاعتماد عملية الدفع بالبطاقة',
    };
  }

  return {
    allowed: true,
    reasonCode: 'SUPERVISOR_APPROVED',
    approvedReference: reference,
  };
}

/**
 * Evaluates field trip operational expense governance.
 * Enforces mandatory justification notes, routine petty ceilings (fuel & toll up to 250 single / 400 cumulative),
 * and requires Supervisor PIN for non-routine categories (maintenance, tips, meals, other) or amounts exceeding ceilings.
 */
export function evaluateTripExpenseGovernance(params: TripExpenseGovernanceParams): TripExpenseGovernanceResult {
  const amount = roundBookMoney(Number(params.amount) || 0, params.moneyDigits);
  const existing = roundBookMoney(Number(params.existingTripExpenses) || 0, params.moneyDigits);
  const projectedTripExpenses = roundBookMoney(existing + amount, params.moneyDigits);
  const maxSingle = params.maxSinglePettyExpense ?? 250;
  const maxCumulative = params.maxCumulativePettyExpenses ?? 400;
  const trimmedNotes = String(params.notes || '').trim();
  const normalizedType = String(params.expenseType || '').trim().toLowerCase();

  if (amount <= 0) {
    return {
      allowed: false,
      requiresSupervisorPin: false,
      reasonCode: 'INVALID_AMOUNT',
      errorMessageAr: 'مبلغ المصروف يجب أن يكون أكبر من الصفر',
      projectedTripExpenses,
    };
  }

  if (!trimmedNotes) {
    return {
      allowed: false,
      requiresSupervisorPin: false,
      reasonCode: 'EXPENSE_NOTES_REQUIRED',
      errorMessageAr: 'يجب تدوين البيان التفصيلي أو رقم الفاتورة/الإيصال لكل مصروف ميداني لضبط الرقابة المالية',
      projectedTripExpenses,
    };
  }

  const isRoutinePettyCategory = normalizedType === 'fuel' || normalizedType === 'toll';
  const exceedsSingleCeiling = amount > maxSingle;
  const exceedsCumulativeCeiling = projectedTripExpenses > maxCumulative;
  const requiresSupervisorPin = !isRoutinePettyCategory || exceedsSingleCeiling || exceedsCumulativeCeiling;

  if (requiresSupervisorPin && !params.supervisorOverride?.approved) {
    let reasonDetail = '';
    if (!isRoutinePettyCategory) {
      reasonDetail = `تصنيف المصروف (${normalizedType}) غير روتيني`;
    } else if (exceedsSingleCeiling) {
      reasonDetail = `المبلغ (${amount.toFixed(2)}) يتجاوز السقف المسموح للمصروف النثري المفرد (${maxSingle.toFixed(2)})`;
    } else {
      reasonDetail = `إجمالي مصروفات الرحلة (${projectedTripExpenses.toFixed(2)}) يتجاوز السقف التراكمي النثري للرحلة (${maxCumulative.toFixed(2)})`;
    }
    return {
      allowed: false,
      requiresSupervisorPin: true,
      reasonCode: 'EXPENSE_REQUIRES_SUPERVISOR_PIN',
      errorMessageAr: `تسجيل هذا المصروف يتطلب رمز اعتماد المشرف (Supervisor PIN) لأن ${reasonDetail}، وذلك لمنع اقتطاع مبالغ غير معتمدة من عهدة النقدية`,
      projectedTripExpenses,
    };
  }

  return {
    allowed: true,
    requiresSupervisorPin,
    reasonCode: params.supervisorOverride?.approved ? 'SUPERVISOR_APPROVED' : 'ROUTINE_PETTY_ALLOWED',
    projectedTripExpenses,
  };
}

// ============================================================================
// FIELD RETURNS GOVERNANCE ENGINE (محرك حوكمة وتدقيق المرتجعات الميدانية)
// ============================================================================

export interface FieldReturnEvaluationItem {
  productId: number;
  productName?: string;
  qty: number;
  unitPrice: number;
  saleItemId?: number;
}

export interface FieldReturnOriginalSaleItem {
  saleItemId: number;
  productId: number;
  productName?: string;
  soldQty: number;
  unitPrice: number;
  lineTotal: number;
  alreadyReturnedQty: number;
}

export interface FieldReturnOriginalSale {
  saleId: number;
  docNo?: string;
  customerId: number;
  repId?: number | null;
  items: FieldReturnOriginalSaleItem[];
}

export interface RepCustomerSalesHistoryProduct {
  productId: number;
  productName?: string;
  totalSoldQty: number;
  maxNetUnitPrice: number;
  alreadyReturnedQty: number;
}

export interface FieldReturnEvaluationParams {
  // REQUIRED (D4): the return total and net-unit caps round at the
  // tenant's book digits.
  moneyDigits: MoneyDigits;
  repId: number;
  customerId: number;
  items: FieldReturnEvaluationItem[];
  refundMethod?: 'credit' | 'cash';
  tripCashCollected?: number;
  // If linked return:
  linkedSale?: FieldReturnOriginalSale | null;
  // If unlinked return:
  repCustomerSalesHistory?: RepCustomerSalesHistoryProduct[];
}

export interface FieldReturnEvaluationResult {
  allowed: boolean;
  reasonCode?: string;
  errorMessageAr?: string;
  httpStatus?: number;
  totalAmount: number;
}

/**
 * Evaluates field customer return request under strict adversarial governance.
 * Blocks:
 * 1. Empty or non-positive quantities / negative prices.
 * 2. Cross-customer returns (sale customer !== return customer).
 * 3. Cross-rep returns (rep A attempting to return goods from rep B's invoice).
 * 4. Phantom items not present in original invoice.
 * 5. Price tampering: Unit return price higher than net discounted sale price.
 * 6. Over-quantity returns: Return quantity exceeding remaining returnable qty (sold - prior returns).
 * 7. Unlinked returns without rep historical sales to customer.
 * 8. Cash refund exceeding actual cash collected by rep in current trip.
 */
export function evaluateFieldReturnGovernance(
  params: FieldReturnEvaluationParams,
): FieldReturnEvaluationResult {
  if (!params.items || !params.items.length) {
    return {
      allowed: false,
      reasonCode: 'EMPTY_RETURN_ITEMS',
      errorMessageAr: 'يجب تحديد صنف واحد على الأقل للمرتجع',
      httpStatus: 400,
      totalAmount: 0,
    };
  }

  let totalAmount = 0;
  for (const item of params.items) {
    const q = Number(item.qty || 0);
    const p = Number(item.unitPrice || 0);
    if (q <= 0) {
      return {
        allowed: false,
        reasonCode: 'INVALID_RETURN_QTY',
        errorMessageAr: 'كمية المرتجع يجب أن تكون أكبر من صفر',
        httpStatus: 400,
        totalAmount: 0,
      };
    }
    if (p < 0) {
      return {
        allowed: false,
        reasonCode: 'INVALID_RETURN_PRICE',
        errorMessageAr: 'سعر المرتجع غير صالح',
        httpStatus: 400,
        totalAmount: 0,
      };
    }
    totalAmount += q * p;
  }
  totalAmount = roundBookMoney(totalAmount, params.moneyDigits);

  // Linked Return Flow
  if (params.linkedSale) {
    const sale = params.linkedSale;
    if (Number(sale.customerId) !== Number(params.customerId)) {
      return {
        allowed: false,
        reasonCode: 'SALE_CUSTOMER_MISMATCH',
        errorMessageAr: 'الفاتورة المحددة لا تخص هذا العميل',
        httpStatus: 400,
        totalAmount,
      };
    }

    if (sale.repId != null && Number(sale.repId) !== Number(params.repId)) {
      return {
        allowed: false,
        reasonCode: 'SALE_REP_MISMATCH',
        errorMessageAr: 'لا يمكن عمل مرتجع على فاتورة تخص مندوباً آخر — عهد وحسابات كل مندوب معزولة تماماً',
        httpStatus: 403,
        totalAmount,
      };
    }

    for (const item of params.items) {
      const line = item.saleItemId
        ? sale.items.find((sl) => Number(sl.saleItemId) === Number(item.saleItemId))
        : sale.items.find((sl) => Number(sl.productId) === Number(item.productId));

      if (!line) {
        return {
          allowed: false,
          reasonCode: 'ITEM_NOT_IN_SALE',
          errorMessageAr: `الصنف #${item.productId} لم يتم العثور عليه في الفاتورة الأصلية`,
          httpStatus: 400,
          totalAmount,
        };
      }

      const soldQty = Number(line.soldQty || 0);
      const lineTotal = Number(line.lineTotal || 0);
      const netUnit = soldQty > 0 ? roundBookMoney(lineTotal / soldQty, params.moneyDigits) : 0;

      if (Number(item.unitPrice) > netUnit + 0.05) {
        return {
          allowed: false,
          reasonCode: 'RETURN_PRICE_EXCEEDS_NET',
          errorMessageAr: `سعر المرتجع (${item.unitPrice}) يتجاوز السعر الصافي بعد الخصم بالفاتورة الأصلية (${netUnit})`,
          httpStatus: 400,
          totalAmount,
        };
      }

      const alreadyReturned = Number(line.alreadyReturnedQty || 0);
      const remainingReturnableQty = Number((soldQty - alreadyReturned).toFixed(3));
      if (Number(item.qty) > remainingReturnableQty + 0.001) {
        return {
          allowed: false,
          reasonCode: 'RETURN_QTY_EXCEEDS_SOLD',
          errorMessageAr: `الكمية المطلوب ردها (${item.qty}) تتجاوز المتبقي القابل للرد من الفاتورة الأصلية (${Math.max(0, remainingReturnableQty)}) — بيع ${soldQty}، مرتجع سابقاً ${alreadyReturned}`,
          httpStatus: 400,
          totalAmount,
        };
      }
    }
  } else {
    // Unlinked Return Flow
    const history = params.repCustomerSalesHistory || [];
    if (!history.length) {
      return {
        allowed: false,
        reasonCode: 'NO_REP_SALES_HISTORY_FOR_RETURN',
        errorMessageAr: 'لا يمكن تسجيل مرتجع بدون فاتورة لعميل لم يسبق لهذا المندوب البيع له',
        httpStatus: 403,
        totalAmount,
      };
    }

    for (const item of params.items) {
      const pid = Number(item.productId);
      const hist = history.find((h) => Number(h.productId) === pid);

      if (!hist || hist.totalSoldQty <= 0) {
        return {
          allowed: false,
          reasonCode: 'RETURN_QTY_EXCEEDS_SOLD',
          errorMessageAr: `الكمية المطلوب ردها (${item.qty}) للصنف #${pid} تتجاوز إجمالي ما باعه هذا المندوب للعميل صافي المرتجعات السابقة (0)`,
          httpStatus: 400,
          totalAmount,
        };
      }

      const remainingQty = Number((hist.totalSoldQty - hist.alreadyReturnedQty).toFixed(3));
      if (Number(item.qty) > remainingQty + 0.001) {
        return {
          allowed: false,
          reasonCode: 'RETURN_QTY_EXCEEDS_SOLD',
          errorMessageAr: `الكمية المطلوب ردها (${item.qty}) للصنف #${pid} تتجاوز إجمالي ما باعه هذا المندوب للعميل صافي المرتجعات السابقة (${Math.max(0, remainingQty)})`,
          httpStatus: 400,
          totalAmount,
        };
      }

      if (Number(item.unitPrice) > Number(hist.maxNetUnitPrice) + 0.05) {
        return {
          allowed: false,
          reasonCode: 'RETURN_PRICE_EXCEEDS_NET',
          errorMessageAr: `سعر المرتجع (${item.unitPrice}) يتجاوز السعر الصافي الذي بيع به الصنف للعميل (${hist.maxNetUnitPrice})`,
          httpStatus: 400,
          totalAmount,
        };
      }
    }
  }

  // Cash Refund Protection
  if ((params.refundMethod || 'credit') === 'cash') {
    const currentTripCash = Number(params.tripCashCollected || 0);
    if (totalAmount > currentTripCash + 0.01) {
      return {
        allowed: false,
        reasonCode: 'INSUFFICIENT_REP_CASH_FOR_REFUND',
        errorMessageAr: `رصيد النقدية المحصلة بعهدة المندوب بالرحلة (${currentTripCash} ج.م) لا يكفي لصرف مرتجع نقدي فوري بقيمة (${totalAmount} ج.م)`,
        httpStatus: 400,
        totalAmount,
      };
    }
  }

  return {
    allowed: true,
    totalAmount,
  };
}

// ============================================================================
// ROUTE ITINERARY & VISIT GOVERNANCE ENGINE (محرك خط السير والزيارات الميدانية)
// ============================================================================

export const VALID_NEGATIVE_VISIT_REASONS = [
  'no_cash',
  'shop_closed',
  'sufficient_stock',
  'item_unavailable',
  'postponed',
  'other',
] as const;

export type NegativeVisitReason = (typeof VALID_NEGATIVE_VISIT_REASONS)[number];

export interface ItineraryVisitEvaluationParams {
  customerId: number;
  visitType: 'positive' | 'negative';
  negativeReason?: string | null;
  postponedToDate?: string | null;
  customerVisitDays?: string[] | string | null;
  currentDayName?: string;
  currentEnglishDayName?: string;
  repGps?: { lat: number; lng: number } | null;
  customerGps?: { lat: number; lng: number } | null;
  maxAllowedGeofenceMeters?: number;
  recentCustomerVisits?: { visitType: 'positive' | 'negative' }[];
}

export interface ItineraryVisitEvaluationResult {
  isValid: boolean;
  reasonCode?: string;
  errorMessageAr?: string;
  isScheduledToday: boolean;
  isWithinGeofence: boolean;
  distanceMeters: number | null;
  hasConsecutiveNegativeAlert: boolean;
}

function calculateSimpleHaversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Evaluates field itinerary visit execution:
 * 1. Checks day matching (scheduled today vs ad-hoc).
 * 2. Validates negative visit reason against official operational catalog.
 * 3. Enforces postponement date validity when reason is 'postponed'.
 * 4. Audits GPS distance against customer storefront location (Ghost Visit detection).
 * 5. Identifies repeated negative visits (3 consecutive negatives) for supervisor intervention.
 */
export function evaluateItineraryVisitRules(
  params: ItineraryVisitEvaluationParams,
): ItineraryVisitEvaluationResult {
  // 1. Negative Visit Reason Validation
  if (params.visitType === 'negative') {
    const reason = String(params.negativeReason || '').trim();
    if (!reason) {
      return {
        isValid: false,
        reasonCode: 'MISSING_NEGATIVE_REASON',
        errorMessageAr: 'يرجى تحديد سبب الزيارة السلبية',
        isScheduledToday: true,
        isWithinGeofence: true,
        distanceMeters: null,
        hasConsecutiveNegativeAlert: false,
      };
    }

    if (!VALID_NEGATIVE_VISIT_REASONS.includes(reason as NegativeVisitReason)) {
      return {
        isValid: false,
        reasonCode: 'INVALID_NEGATIVE_REASON',
        errorMessageAr: 'سبب الزيارة السلبية غير معتمد بالنظام',
        isScheduledToday: true,
        isWithinGeofence: true,
        distanceMeters: null,
        hasConsecutiveNegativeAlert: false,
      };
    }
  }

  // 2. Scheduled Day Check
  let isScheduledToday = true;
  if (params.customerVisitDays) {
    const rawDays = Array.isArray(params.customerVisitDays)
      ? params.customerVisitDays
      : String(params.customerVisitDays).split(/[,،]/);

    const cleanDays = rawDays.map((d) => String(d).trim().toLowerCase()).filter(Boolean);
    if (cleanDays.length > 0) {
      const curAr = (params.currentDayName || '').trim().toLowerCase();
      const curEn = (params.currentEnglishDayName || '').trim().toLowerCase();
      isScheduledToday = cleanDays.some(
        (d) => (curAr && (d === curAr || d.includes(curAr))) || (curEn && (d === curEn || d.includes(curEn))),
      );
    }
  }

  // 3. Geofence Audit
  let isWithinGeofence = true;
  let distanceMeters: number | null = null;
  if (params.repGps && params.customerGps) {
    distanceMeters = calculateSimpleHaversineMeters(
      params.repGps.lat,
      params.repGps.lng,
      params.customerGps.lat,
      params.customerGps.lng,
    );
    const maxMeters = params.maxAllowedGeofenceMeters ?? 300;
    isWithinGeofence = distanceMeters <= maxMeters;
  }

  // 4. Consecutive Negative Visits Tracking (3 in a row triggers alert)
  let hasConsecutiveNegativeAlert = false;
  if (params.visitType === 'negative' && params.recentCustomerVisits) {
    const recent = params.recentCustomerVisits;
    if (recent.length >= 2 && recent.slice(0, 2).every((v) => v.visitType === 'negative')) {
      hasConsecutiveNegativeAlert = true;
    }
  }

  return {
    isValid: true,
    isScheduledToday,
    isWithinGeofence,
    distanceMeters,
    hasConsecutiveNegativeAlert,
  };
}

// ============================================================================
// REQUISITION MULTI-WAREHOUSE SPLIT ENGINE (محرك فرز وتوزيع أذونات التحميل)
// ============================================================================

export interface RequisitionItemInput {
  productId: number;
  qty: number;
  sourceWarehouseId?: number;
  sourceWarehouseName?: string;
}

export interface RequisitionSplitGroup {
  warehouseId: number;
  warehouseName?: string;
  items: RequisitionItemInput[];
  totalQty: number;
}

/**
 * Pure engine to split load requisition items across their respective source warehouses.
 * When a delivery rep requests items located across different physical warehouses,
 * this engine automatically clusters them by warehouse so separate requisition vouchers can be issued.
 */
export function splitRequisitionByWarehouse(
  items: RequisitionItemInput[],
  defaultWarehouseId = 1,
): RequisitionSplitGroup[] {
  const groups = new Map<number, { name?: string; items: RequisitionItemInput[] }>();

  for (const item of items || []) {
    const qty = Number(item.qty || 0);
    if (qty <= 0) continue;
    const whId = item.sourceWarehouseId && Number(item.sourceWarehouseId) > 0
      ? Number(item.sourceWarehouseId)
      : defaultWarehouseId;

    const group = groups.get(whId) || { name: item.sourceWarehouseName, items: [] };
    group.items.push({ ...item, sourceWarehouseId: whId });
    if (!group.name && item.sourceWarehouseName) group.name = item.sourceWarehouseName;
    groups.set(whId, group);
  }

  const result: RequisitionSplitGroup[] = [];
  for (const [warehouseId, group] of groups.entries()) {
    const totalQty = group.items.reduce((sum, it) => sum + Number(it.qty || 0), 0);
    result.push({
      warehouseId,
      warehouseName: group.name,
      items: group.items,
      totalQty: Number(totalQty.toFixed(3)),
    });
  }

  return result.sort((a, b) => a.warehouseId - b.warehouseId);
}

/**
 * Formats official Cashier Handover Clearance text summary for SMS / WhatsApp dispatch.
 */
export function formatVanSettlementSummaryText(params: {
  receiptNo: string;
  tripId: number;
  repName: string;
  cashierName: string;
  salesAmount: number;
  cashSales: number;
  creditSales: number;
  collectionsTotal: number;
  tripExpenses: number;
  expectedCash: number;
  countedCash: number;
  variance: number;
  stockVarianceCost?: number;
  instapayTotal?: number;
  currency?: string;
}): string {
  const currency = params.currency || 'ج.م';
  const isShortage = params.variance < -0.05;
  const isSurplus = params.variance > 0.05;
  const isMatched = !isShortage && !isSurplus;

  const statusText = isMatched
    ? 'مطابق 100% بدون أي عجز'
    : isShortage
    ? `يوجد عجز نقدي بقيمة ${Math.abs(params.variance).toFixed(2)} ${currency}`
    : `يوجد فائض نقدي بقيمة +${Number(params.variance).toFixed(2)} ${currency}`;

  return [
    '*سند توريد نقدية الخزينة وإخلاء طرف عهدة*',
    `رقم السند: #${params.receiptNo}`,
    `رقم الرحلة: #${params.tripId}`,
    `المندوب: ${params.repName}`,
    `أمين الخزينة: ${params.cashierName}`,
    '-------------------------',
    `مبيعات اليوم: ${Number(params.salesAmount).toFixed(2)} ${currency}`,
    `(كاش: ${Number(params.cashSales).toFixed(2)} | آجل: ${Number(params.creditSales).toFixed(2)})`,
    params.instapayTotal && params.instapayTotal > 0
      ? `تحويلات إنستاباي / المحافظ: ${Number(params.instapayTotal).toFixed(2)} ${currency} (تتطلب مطابقة بنكية)`
      : '',
    `التحصيلات: ${Number(params.collectionsTotal).toFixed(2)} ${currency}`,
    `مصروفات الرحلة: ${Number(params.tripExpenses).toFixed(2)} ${currency}`,
    '-------------------------',
    `صافي المطلوب توريده نقداً: ${Number(params.expectedCash).toFixed(2)} ${currency}`,
    `المبلغ المورَّد فعلياً: ${Number(params.countedCash).toFixed(2)} ${currency}`,
    `حالة المطابقة: ${statusText}`,
    params.stockVarianceCost && params.stockVarianceCost > 0
      ? `عجز بضاعة بالجرد: ${params.stockVarianceCost.toFixed(2)} ${currency}`
      : '',
    'تم الاعتماد والإبراء بنجاح عبر Z-Systems ERP.',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface DamagedSwapParams {
  // REQUIRED (D4): the swap values round at the tenant's book digits.
  moneyDigits: MoneyDigits;
  damagedProductId: number;
  damagedQty: number;
  damagedUnitPrice: number;
  damageReason: string;
  replacementProductId: number;
  replacementQty: number;
  replacementUnitPrice: number;
  availableVanStockQty: number;
}

export interface DamagedSwapResult {
  allowed: boolean;
  reasonCode?: 'STOCK_UNAVAILABLE' | 'INVALID_QUANTITY' | 'REASON_REQUIRED';
  errorMessageAr?: string;
  damagedValue: number;
  replacementValue: number;
  priceDifference: number;
  isEvenSwap: boolean;
}

/**
 * Pure calculation engine for Instant Field Damaged / Broken Goods Swaps.
 * Ensures stock availability, validates non-zero quantities and damage reasons,
 * and calculates any price variance between damaged return and fresh replacement.
 */
export function evaluateDamagedSwap(params: DamagedSwapParams): DamagedSwapResult {
  const dQty = Number((Number(params.damagedQty) || 0).toFixed(4));
  const rQty = Number((Number(params.replacementQty) || 0).toFixed(4));
  const availableStock = Number((Number(params.availableVanStockQty) || 0).toFixed(4));
  const reason = String(params.damageReason || '').trim();

  if (dQty <= 0 || rQty <= 0) {
    return {
      allowed: false,
      reasonCode: 'INVALID_QUANTITY',
      errorMessageAr: 'كمية التالف وكمية البديل يجب أن تكون أكبر من الصفر',
      damagedValue: 0,
      replacementValue: 0,
      priceDifference: 0,
      isEvenSwap: false,
    };
  }

  if (!reason) {
    return {
      allowed: false,
      reasonCode: 'REASON_REQUIRED',
      errorMessageAr: 'يرجى تحديد سبب تلف أو كسر البضاعة (مثل: تسريب، كسر، انتهاء صلاحية)',
      damagedValue: 0,
      replacementValue: 0,
      priceDifference: 0,
      isEvenSwap: false,
    };
  }

  if (rQty > availableStock) {
    return {
      allowed: false,
      reasonCode: 'STOCK_UNAVAILABLE',
      errorMessageAr: `رصيد السيارة الحالي (${availableStock}) غير كافٍ لصرف كمية الاستبدال المطلوبة (${rQty})`,
      damagedValue: 0,
      replacementValue: 0,
      priceDifference: 0,
      isEvenSwap: false,
    };
  }

  const dVal = roundBookMoney(dQty * Number(params.damagedUnitPrice || 0), params.moneyDigits);
  const rVal = roundBookMoney(rQty * Number(params.replacementUnitPrice || 0), params.moneyDigits);
  const diff = roundBookMoney(rVal - dVal, params.moneyDigits);

  return {
    allowed: true,
    damagedValue: dVal,
    replacementValue: rVal,
    priceDifference: diff,
    isEvenSwap: Math.abs(diff) < 0.01,
  };
}




