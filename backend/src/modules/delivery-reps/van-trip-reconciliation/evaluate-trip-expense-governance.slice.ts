import { roundMoney as roundBookMoney } from '../../accounting/engines/money-minor-units.engine';
import type { TripExpenseGovernanceParams, TripExpenseGovernanceResult } from './van-trip-reconciliation.types';

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
  const normalizedType = String(params.expenseType || '')
    .trim()
    .toLowerCase();

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
