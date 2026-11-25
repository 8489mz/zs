import { BadRequestException } from '@nestjs/common';

// =============================================================================
// Guarantee Gateway & Financial Interlocking Engine (MRICS / FIDIC Compliant)
// Single Source of Truth for Gateway G1 & Advance Payment Protection
// =============================================================================

export type GuaranteeType = 'advance_payment' | 'performance' | 'retention' | 'maintenance' | 'bid_bond';

export type GuaranteeStatus = 'active' | 'expired' | 'released' | 'confiscated_invoked' | 'cancelled';

export interface BankGuarantee {
  id: string;
  tenant_id: string;
  project_id: string;
  subcontract_id?: string | null;
  subcontractor_id?: string | null;
  guarantee_number: string;
  guarantee_type: GuaranteeType;
  issuing_bank: string;
  amount: number;
  currency: string;
  issue_date: string; // YYYY-MM-DD
  expiry_date: string; // YYYY-MM-DD
  claim_expiry_date?: string | null;
  // NOTE & TODO (Phase 2): reduction_schedule JSONB stores the contractual gradual reduction milestones.
  // In Phase 2, as advance recovery IPC deductions are processed, the effective ceiling of the guarantee will be dynamically reduced in accordance with reduction_schedule.
  // Currently in Phase 1, the nominal amount acts as the fixed ceiling until dynamic step-down is activated in Phase 2.
  reduction_schedule?: any;
  status: GuaranteeStatus;
}

export interface AdvancePaymentGateInput {
  subcontractId?: string | null;
  projectId: string;
  requestedDisbursementAmount: number;
  disbursementDate: string; // YYYY-MM-DD
  priorAdvanceDisbursedAgainstGuarantee?: number; // Total prior advance disbursements against this guarantee / subcontract (Invariant G1-C)
  activeGuarantees: BankGuarantee[];
}

export interface AdvancePaymentGateResult {
  approved: boolean;
  coveringGuarantee: BankGuarantee;
  coverageExcess: number;
}

/**
 * Gateway G1: Prevents disbursement of any advance payment without a valid, active,
 * unexpired Advance Payment Bank Guarantee covering the full disbursement amount.
 * Invariant G1-C: Cumulative prior disbursements + requested disbursement <= guarantee amount.
 */
export function assertAdvancePaymentGate(input: AdvancePaymentGateInput): AdvancePaymentGateResult {
  const {
    subcontractId,
    projectId,
    requestedDisbursementAmount,
    disbursementDate,
    priorAdvanceDisbursedAgainstGuarantee = 0,
    activeGuarantees,
  } = input;

  if (requestedDisbursementAmount <= 0) {
    throw new BadRequestException('بوابة الاعتماد G1: مبلغ الدفعة المقدمة المطلوب يجب أن يكون أكبر من الصفر');
  }

  const priorDisbursed = Math.max(0, priorAdvanceDisbursedAgainstGuarantee || 0);
  const totalCumulativeExposure = Math.round((priorDisbursed + requestedDisbursementAmount) * 100) / 100;

  // Filter for matching active advance payment guarantees
  const matchingGuarantees = activeGuarantees.filter((g) => {
    if (g.guarantee_type !== 'advance_payment') return false;
    if (g.status !== 'active') return false;
    if (subcontractId) {
      return String(g.subcontract_id) === String(subcontractId);
    }
    return String(g.project_id) === String(projectId);
  });

  if (matchingGuarantees.length === 0) {
    throw new BadRequestException(
      'بوابة الاعتماد الرقابية G1: محظور صرف الدفعة المقدمة قطيعاً لعدم وجود خطاب ضمان دفعة مقدمة سارٍ (Advance Payment Guarantee) مسجل للمقاول/المشروع',
    );
  }

  // Pick the guarantee with the furthest expiry date or highest amount
  const sorted = [...matchingGuarantees].sort((a, b) => {
    if (a.expiry_date !== b.expiry_date) {
      return a.expiry_date.localeCompare(b.expiry_date);
    }
    return Number(b.amount) - Number(a.amount);
  });

  // Find a guarantee that covers the requested date and cumulative exposure (Invariant G1-C)
  const validGuarantee = sorted.find((g) => {
    const isNotExpired = g.expiry_date >= disbursementDate;
    const coversAmount = Number(g.amount) >= totalCumulativeExposure;
    return isNotExpired && coversAmount;
  });

  if (!validGuarantee) {
    // Check specific failure reasons to give actionable error messages
    const anyCoveringAmount = sorted.find((g) => Number(g.amount) >= totalCumulativeExposure);
    if (!anyCoveringAmount) {
      const maxAvailable = Math.max(...sorted.map((g) => Number(g.amount)));
      if (priorDisbursed > 0) {
        throw new BadRequestException(
          `بوابة الاعتماد الرقابية G1 (المعيار التراكمي G1-C): قيمة خطاب الضمان المتوفر (${maxAvailable.toLocaleString('en-US')} ج.م) غير كافية لتغطية إجمالي الدفعات المقدمة التراكمية (${totalCumulativeExposure.toLocaleString('en-US')} ج.م: منصرف سابق ${priorDisbursed.toLocaleString('en-US')} ج.م + دفعة حالية مطلوبة ${requestedDisbursementAmount.toLocaleString('en-US')} ج.م)`,
        );
      } else {
        throw new BadRequestException(
          `بوابة الاعتماد الرقابية G1: قيمة خطاب الضمان المتوفر (${maxAvailable.toLocaleString('en-US')} ج.م) غير كافية لتغطية الدفعة المقدمة المطلوبة (${requestedDisbursementAmount.toLocaleString('en-US')} ج.م)`,
        );
      }
    }

    const anyUnexpired = sorted.find((g) => g.expiry_date >= disbursementDate);
    if (!anyUnexpired) {
      throw new BadRequestException(
        `بوابة الاعتماد الرقابية G1: خطاب ضمان الدفعة المقدمة رقم (${sorted[0].guarantee_number}) منتهي الصلاحية بتاريخ (${sorted[0].expiry_date}) قبل تاريخ الصرف (${disbursementDate})`,
      );
    }

    throw new BadRequestException(
      'بوابة الاعتماد الرقابية G1: لم يتم العثور على خطاب ضمان سارٍ يغطي كلاً من التاريخ والمبلغ المطلوب',
    );
  }

  const coverageExcess = Math.round((Number(validGuarantee.amount) - totalCumulativeExposure) * 100) / 100;

  return {
    approved: true,
    coveringGuarantee: validGuarantee,
    coverageExcess,
  };
}

export interface IpcInterlockingInput {
  subcontractId?: string | null;
  projectId: string;
  unrecoveredAdvanceBalance: number; // advanceTotal - previousAdvanceRecovered
  invoiceDate: string; // YYYY-MM-DD
  activeGuarantees: BankGuarantee[];
}

export interface IpcInterlockingResult {
  isBlocked: boolean;
  blockReason?: string;
  warningNotice?: string;
  coveringGuarantee?: BankGuarantee;
}

/**
 * IPC Interlocking: Checks whether an unrecovered advance payment is backed by a valid guarantee.
 * Blocks IPC certificate issuance or approval if the guarantee expired before full recovery.
 */
export function checkIpcGuaranteeInterlocking(input: IpcInterlockingInput): IpcInterlockingResult {
  const { subcontractId, projectId, unrecoveredAdvanceBalance, invoiceDate, activeGuarantees } = input;

  // If advance is 100% recovered, no interlocking constraint applies
  if (unrecoveredAdvanceBalance <= 0) {
    return { isBlocked: false };
  }

  // Find active advance payment guarantee
  const advanceGuarantees = activeGuarantees.filter((g) => {
    if (g.guarantee_type !== 'advance_payment') return false;
    if (subcontractId) {
      return String(g.subcontract_id) === String(subcontractId);
    }
    return String(g.project_id) === String(projectId);
  });

  if (advanceGuarantees.length === 0) {
    return {
      isBlocked: true,
      blockReason: `حجب صرف المستخلص: يوجد رصيد دفعة مقدمة غير مسترد قدره (${unrecoveredAdvanceBalance.toLocaleString()} ج.م) دون وجود أي خطاب ضمان دفعة مقدمة مسجل للمقاول.`,
    };
  }

  // Check if any guarantee is currently active and not expired
  const unexpired = advanceGuarantees.find((g) => g.status === 'active' && g.expiry_date >= invoiceDate);

  if (!unexpired) {
    const latest = advanceGuarantees[0];
    return {
      isBlocked: true,
      blockReason: `حجب صرف المستخلص: خطاب ضمان الدفعة المقدمة رقم (${latest.guarantee_number}) منتهي الصلاحية بتاريخ (${latest.expiry_date})، وما زال هناك رصيد غير مسترد بقيمة (${unrecoveredAdvanceBalance.toLocaleString()} ج.م). يجب تمديد الخطاب بنكياً أولاً.`,
    };
  }

  // Check if guarantee amount is less than remaining unrecovered advance
  let warningNotice: string | undefined;
  if (Number(unexpired.amount) < unrecoveredAdvanceBalance) {
    warningNotice = `تنبيه مالي: قيمة خطاب الضمان الحالي (${Number(unexpired.amount).toLocaleString()} ج.م) أقل من رصيد الدفعة المقدمة المتبقي دون استرداد (${unrecoveredAdvanceBalance.toLocaleString()} ج.م).`;
  }

  return {
    isBlocked: false,
    warningNotice,
    coveringGuarantee: unexpired,
  };
}

export interface ExpiryAlertItem {
  guaranteeId: string;
  guaranteeNumber: string;
  guaranteeType: GuaranteeType;
  issuingBank: string;
  amount: number;
  expiryDate: string;
  daysRemaining: number;
  alertTier: 'critical_t7' | 'warning_t30' | 'info_t60' | 'expired';
  alertMessageAr: string;
}

/**
 * Evaluates T-60, T-30, T-7 alerts for all active bank guarantees.
 */
export function evaluateGuaranteeExpiryAlerts(
  guarantees: BankGuarantee[],
  referenceDateStr: string,
): ExpiryAlertItem[] {
  const refDate = new Date(referenceDateStr);
  const alerts: ExpiryAlertItem[] = [];

  for (const g of guarantees) {
    if (g.status !== 'active') continue;

    const expDate = new Date(g.expiry_date);
    const diffMs = expDate.getTime() - refDate.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (daysRemaining < 0) {
      alerts.push({
        guaranteeId: g.id,
        guaranteeNumber: g.guarantee_number,
        guaranteeType: g.guarantee_type,
        issuingBank: g.issuing_bank,
        amount: Number(g.amount),
        expiryDate: g.expiry_date,
        daysRemaining,
        alertTier: 'expired',
        alertMessageAr: `خطاب الضمان رقم (${g.guarantee_number}) لدى بنك (${g.issuing_bank}) منتهي الصلاحية منذ ${Math.abs(daysRemaining)} يوم!`,
      });
    } else if (daysRemaining <= 7) {
      alerts.push({
        guaranteeId: g.id,
        guaranteeNumber: g.guarantee_number,
        guaranteeType: g.guarantee_type,
        issuingBank: g.issuing_bank,
        amount: Number(g.amount),
        expiryDate: g.expiry_date,
        daysRemaining,
        alertTier: 'critical_t7',
        alertMessageAr: `تحذير حرج T-7: خطاب الضمان رقم (${g.guarantee_number}) ينتهي خلال ${daysRemaining} أيام! يجب التمديد أو التسييل فوراً.`,
      });
    } else if (daysRemaining <= 30) {
      alerts.push({
        guaranteeId: g.id,
        guaranteeNumber: g.guarantee_number,
        guaranteeType: g.guarantee_type,
        issuingBank: g.issuing_bank,
        amount: Number(g.amount),
        expiryDate: g.expiry_date,
        daysRemaining,
        alertTier: 'warning_t30',
        alertMessageAr: `إنذار T-30: خطاب الضمان رقم (${g.guarantee_number}) ينتهي خلال ${daysRemaining} يوماً (${g.expiry_date}).`,
      });
    } else if (daysRemaining <= 60) {
      alerts.push({
        guaranteeId: g.id,
        guaranteeNumber: g.guarantee_number,
        guaranteeType: g.guarantee_type,
        issuingBank: g.issuing_bank,
        amount: Number(g.amount),
        expiryDate: g.expiry_date,
        daysRemaining,
        alertTier: 'info_t60',
        alertMessageAr: `إشعار استباقي T-60: موعد انتهاء خطاب الضمان رقم (${g.guarantee_number}) يحل خلال ${daysRemaining} يوماً.`,
      });
    }
  }

  // Sort critical first
  const tierWeight: Record<string, number> = {
    expired: 4,
    critical_t7: 3,
    warning_t30: 2,
    info_t60: 1,
  };

  return alerts.sort((a, b) => (tierWeight[b.alertTier] || 0) - (tierWeight[a.alertTier] || 0));
}
