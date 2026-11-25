import { roundMoney as roundBookMoney } from '../../accounting/engines/money-minor-units.engine';
import type { CreditLimitEvaluationParams, CreditLimitEvaluationResult } from './van-trip-reconciliation.types';

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

  if (
    params.hasOverdueInvoices &&
    (Number(params.overdueAmount || 0) > 0 || Number(params.oldestOverdueDays || 0) > 0)
  ) {
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
        overrideReason:
          params.supervisorOverride.reason || `اعتماد استثنائي لتجاوز سقف الائتمان بمقدار ${exceededAmount.toFixed(2)}`,
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
