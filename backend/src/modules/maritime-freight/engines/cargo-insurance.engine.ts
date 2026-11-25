/**
 * بوابات رقابية نقية لمطالبات تأمين البضائع.
 *
 * استُخرجت في محرك نقي (AGENTS.md Rule 13) لأن الفحصين الماليين هنا كانا غائبين
 * تماماً: `insured_value` كان يُخزَّن في الوثيقة **ولا يُقرأ في أي منطق** فتمر
 * مطالبة تتجاوز قيمة التأمين بلا اعتراض (F10)، ولم يكن هناك ما يمنع تسجيل
 * مطالبة ثانية تستبدل الأولى بصمت.
 */

export const INSURANCE_CLAIM_CODES = {
  EXCEEDS_INSURED_VALUE: 'MARITIME_CLAIM_EXCEEDS_INSURED_VALUE',
  ALREADY_CLAIMED: 'MARITIME_CLAIM_ALREADY_RECORDED',
  INVALID_AMOUNT: 'MARITIME_CLAIM_INVALID_AMOUNT',
} as const;

export type InsuranceClaimCode = (typeof INSURANCE_CLAIM_CODES)[keyof typeof INSURANCE_CLAIM_CODES];

export type InsuranceClaimCheck = {
  ok: boolean;
  code?: InsuranceClaimCode;
  message?: string;
};

export type InsurancePolicyState = {
  insuredValue: number | string | null | undefined;
  status: string | null | undefined;
  claimAmount?: number | string | null;
};

/**
 * يقرر ما إذا كانت المطالبة مقبولة على هذه الوثيقة.
 * لا يرمي — يعيد النتيجة ليقرر المستدعي نوع الاستثناء.
 */
export function checkInsuranceClaim(
  policy: InsurancePolicyState,
  requestedClaimAmount: number | string | null | undefined,
): InsuranceClaimCheck {
  const claimAmount = Number(requestedClaimAmount ?? 0);
  const insuredValue = Number(policy.insuredValue ?? 0);

  if (!Number.isFinite(claimAmount) || claimAmount <= 0) {
    return {
      ok: false,
      code: INSURANCE_CLAIM_CODES.INVALID_AMOUNT,
      message: 'قيمة المطالبة يجب أن تكون أكبر من الصفر',
    };
  }

  if (String(policy.status || '').trim() === 'claimed') {
    const previous = Number(policy.claimAmount ?? 0);
    return {
      ok: false,
      code: INSURANCE_CLAIM_CODES.ALREADY_CLAIMED,
      message: `سبق تسجيل مطالبة على هذه الوثيقة بمبلغ ${previous.toLocaleString()}. لتعديلها استخدم مسار تحديث المطالبة`,
    };
  }

  if (claimAmount > insuredValue) {
    return {
      ok: false,
      code: INSURANCE_CLAIM_CODES.EXCEEDS_INSURED_VALUE,
      message: `قيمة المطالبة (${claimAmount.toLocaleString()}) تتجاوز القيمة المؤمَّن عليها في الوثيقة (${insuredValue.toLocaleString()})`,
    };
  }

  return { ok: true };
}
