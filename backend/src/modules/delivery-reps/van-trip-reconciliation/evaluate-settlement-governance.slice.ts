import type {
  MakerCheckerParams,
  MakerCheckerResult,
  NightStockEvaluationParams,
  NightStockEvaluationResult,
  FieldCardPaymentEvaluationParams,
  FieldCardPaymentEvaluationResult,
} from './van-trip-reconciliation.types';

/**
 * Evaluates Maker-Checker segregation of duties.
 * The delivery representative who executed the trip CANNOT be the supervisor approving the settlement.
 */
export function evaluateMakerCheckerSettlement(params: MakerCheckerParams): MakerCheckerResult {
  if (params.repUserId && params.repUserId === params.actorUserId) {
    return {
      allowed: false,
      reasonCode: 'MAKER_CHECKER_SELF_APPROVAL',
      errorMessageAr:
        'لا يجوز لمندوب المبيعات اعتماد وإبراء تصفية رحلته بنفسه طبقاً لمبدأ فصل المهام الرقابي (Maker-Checker)',
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
        errorMessageAr:
          'إبقاء بضاعة متبقية في سيارة التوزيع لليوم التالي (Night Stock) يتطلب اعتماداً رسمياً صريحاً من المشرف مع تدوين المبررات',
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
      errorMessageAr:
        'الدفع بالشبكة أو التحويل البنكي في الميدان يتطلب إدخال رمز اعتماد المشرف (Supervisor PIN) للتحقق من وصول الإشعار البنكي ومنع التلاعب بالنقدية المحصلة',
    };
  }

  if (reference.length < 3) {
    return {
      allowed: false,
      reasonCode: 'CARD_PAYMENT_REFERENCE_REQUIRED',
      errorMessageAr:
        'يرجى تدوين رقم مرجع إيصال الشبكة أو الحوالة البنكية (3 أحرف/أرقام على الأقل) لاعتماد عملية الدفع بالبطاقة',
    };
  }

  return {
    allowed: true,
    reasonCode: 'SUPERVISOR_APPROVED',
    approvedReference: reference,
  };
}
