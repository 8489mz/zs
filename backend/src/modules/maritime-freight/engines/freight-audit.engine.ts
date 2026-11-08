import { convertFxAmount } from '../../accounting/engines/fx-conversion.engine';
import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

/**
 * Pure Calculation Engine: Freight Audit & Carrier Rate Reconciliation
 *
 * Implements Rule #13 (Financial & Operational Audit Protocol):
 * - Pure functions with zero external side effects or database calls.
 * - Single Source of Truth for rate reconciliation, variance calculation, and tolerance gates.
 * - Maker-Checker Governance (Rule #14) verifying separation of duties and substantive rationale.
 */

export interface FreightAuditInput {
  invoicedTotal: number;
  invoicedCurrency?: string;
  oceanFreight?: number;
  thcCharges?: number;
  bafCharges?: number;
  otherCharges?: number;
  rateCard?: {
    id: string | number;
    carrierName?: string;
    totalFreightCost: number;
    oceanFreight?: number;
    thcOrigin?: number;
    thcDestination?: number;
    bafCharges?: number;
    otherCharges?: number;
    currency?: string;
  } | null;
  containerCount?: number;
  exchangeRate?: number; // Rate to convert rateCard.currency into invoicedCurrency
  // Book digits the converted amounts round at. Default 3 = the
  // engine's historical cut; the live caller passes the tenant's
  // book digits. The rate itself stays a caller-supplied input: a
  // pure engine reads no database, and the live caller resolves it
  // through resolveFxRate.
  moneyDigits?: MoneyDigits;
}

export type FreightAuditStatus =
  | 'matched'
  | 'overcharge'
  | 'undercharge'
  | 'no_contract'
  | 'currency_mismatch'
  | 'approved_override'
  | 'disputed';

export interface FreightAuditResult {
  hasRateCard: boolean;
  rateCardId: string | number | null;
  contractedRatePerUnit: number;
  containerCount: number;
  contractedTotal: number;
  invoicedTotal: number;
  varianceAmount: number; // invoiced - contracted
  variancePct: number;    // ((invoiced - contracted) / contracted) * 100
  auditStatus: FreightAuditStatus;
  isOvercharged: boolean;
  isUndercharged: boolean;
  isMatched: boolean;
  currencyMismatch?: boolean;
  varianceBreakdown: {
    oceanFreightDiff: number;
    thcDiff: number;
    bafDiff: number;
    otherDiff: number;
  };
  recommendation: 'auto_approvable' | 'requires_override_or_dispute' | 'manual_review_no_contract';
  notes?: string;
}

export function calculateFreightAudit(input: FreightAuditInput): FreightAuditResult {
  const invoicedTotal = Number(input.invoicedTotal || 0);
  const containerCount = Math.max(1, Number(input.containerCount || 1));
  const rateCard = input.rateCard;

  if (!rateCard) {
    return {
      hasRateCard: false,
      rateCardId: null,
      contractedRatePerUnit: 0,
      containerCount,
      contractedTotal: 0,
      invoicedTotal,
      varianceAmount: invoicedTotal,
      variancePct: 0,
      auditStatus: 'no_contract',
      isOvercharged: false,
      isUndercharged: false,
      isMatched: false,
      varianceBreakdown: {
        oceanFreightDiff: Number(input.oceanFreight || 0),
        thcDiff: Number(input.thcCharges || 0),
        bafDiff: Number(input.bafCharges || 0),
        otherDiff: Number(input.otherCharges || 0),
      },
      recommendation: 'manual_review_no_contract',
      notes: 'لا توجد بطاقة أسعار متعاقد عليها لهذه الوجهة والخط الملاحي',
    };
  }

  // Currency mismatch check
  const cardCurrency = (rateCard.currency || 'USD').toUpperCase();
  const invCurrency = (input.invoicedCurrency || 'USD').toUpperCase();
  const fxRate = Number(input.exchangeRate || 0);

  if (cardCurrency !== invCurrency && (!Number.isFinite(fxRate) || fxRate <= 0)) {
    return {
      hasRateCard: true,
      rateCardId: rateCard.id,
      contractedRatePerUnit: 0,
      containerCount,
      contractedTotal: 0,
      invoicedTotal,
      varianceAmount: 0,
      variancePct: 0,
      auditStatus: 'currency_mismatch',
      isOvercharged: false,
      isUndercharged: false,
      isMatched: false,
      currencyMismatch: true,
      varianceBreakdown: {
        oceanFreightDiff: 0,
        thcDiff: 0,
        bafDiff: 0,
        otherDiff: 0,
      },
      recommendation: 'manual_review_no_contract',
      notes: `اختلاف العملة بين بطاقة الأسعار (${cardCurrency}) وفاتورة الناقل (${invCurrency}) دون تحديد سعر الصرف للتحويل`,
    };
  }

  // INV-FX-CONVERSION-SINGLE-ENGINE: every FX conversion in this
  // pure engine runs through the shared conversion primitive at the
  // caller's book digits, never through hand-rolled
  // Math.round(*1000)/1000 rate math. At the default 3 digits the
  // per-unit and total conversions are identical to the old cuts;
  // the breakdown now rounds each component per unit before scaling
  // by container count, so sub-minor-unit inputs can differ by one
  // minor unit (pinned in maritime-fx-resolver.spec.ts case 8).
  const digits: MoneyDigits = input.moneyDigits ?? 3;
  const fxMultiplier = (cardCurrency !== invCurrency && fxRate > 0) ? fxRate : 1;
  const ratePerUnit = convertFxAmount(Number(rateCard.totalFreightCost || 0), fxMultiplier, digits);
  const contractedTotal = roundMoney(ratePerUnit * containerCount, digits);
  const varianceAmount = roundMoney(invoicedTotal - contractedTotal, digits);
  const variancePct =
    contractedTotal > 0
      ? roundMoney((varianceAmount / contractedTotal) * 100, 2)
      : 0;

  // Breakdown diffs with FX applied: each contracted component
  // converts per unit through the shared engine, then scales by
  // the container count.
  const contractedOcean = convertFxAmount(Number(rateCard.oceanFreight || 0), fxMultiplier, digits) * containerCount;
  const contractedThc = convertFxAmount((Number(rateCard.thcOrigin || 0) + Number(rateCard.thcDestination || 0)), fxMultiplier, digits) * containerCount;
  const contractedBaf = convertFxAmount(Number(rateCard.bafCharges || 0), fxMultiplier, digits) * containerCount;
  const contractedOther = convertFxAmount(Number(rateCard.otherCharges || 0), fxMultiplier, digits) * containerCount;

  const oceanFreightDiff = roundMoney(Number(input.oceanFreight || 0) - contractedOcean, digits);
  const thcDiff = roundMoney(Number(input.thcCharges || 0) - contractedThc, digits);
  const bafDiff = roundMoney(Number(input.bafCharges || 0) - contractedBaf, digits);
  const otherDiff = roundMoney(Number(input.otherCharges || 0) - contractedOther, digits);

  // Tolerance of 0.01 for floating-point / rounding differences
  const TOLERANCE = 0.01;
  const isMatched = Math.abs(varianceAmount) <= TOLERANCE;
  const isOvercharged = varianceAmount > TOLERANCE;
  const isUndercharged = varianceAmount < -TOLERANCE;

  let auditStatus: FreightAuditStatus = 'matched';
  let recommendation: FreightAuditResult['recommendation'] = 'auto_approvable';

  if (isOvercharged) {
    auditStatus = 'overcharge';
    recommendation = 'requires_override_or_dispute';
  } else if (isUndercharged) {
    auditStatus = 'undercharge';
    recommendation = 'auto_approvable';
  } else {
    auditStatus = 'matched';
    recommendation = 'auto_approvable';
  }

  return {
    hasRateCard: true,
    rateCardId: rateCard.id,
    contractedRatePerUnit: ratePerUnit,
    containerCount,
    contractedTotal,
    invoicedTotal,
    varianceAmount,
    variancePct,
    auditStatus,
    isOvercharged,
    isUndercharged,
    isMatched,
    varianceBreakdown: {
      oceanFreightDiff,
      thcDiff,
      bafDiff,
      otherDiff,
    },
    recommendation,
  };
}

export interface MakerCheckerContext {
  userId: number | string;
  role: string;
  invoiceCreatedBy?: number | string | null;
  reason?: string;
}

export function validateMakerCheckerOverride(ctx: MakerCheckerContext): {
  valid: boolean;
  error?: string;
} {
  // 1. Separation of duties: Creator cannot approve their own override
  if (ctx.invoiceCreatedBy && String(ctx.userId) === String(ctx.invoiceCreatedBy)) {
    return {
      valid: false,
      error: 'حظر فصل المهام: لا يمكن للمستخدم الذي سجل الفاتورة اعتماد التجاوز المالي بنفسه (Maker-Checker Separation).',
    };
  }

  // 2. Role check: must be admin or super_admin or finance_manager
  const role = String(ctx.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'super_admin' && role !== 'finance_manager') {
    return {
      valid: false,
      error: 'صلاحيات غير كافية: اعتماد التجاوز المالي لفاتورة الناقل يتطلب رتبة مدير مالي أو مدير النظام.',
    };
  }

  // 3. A rationale is required (any non-empty reason); the role gate above stays.
  const reason = (ctx.reason || '').trim();
  if (!reason) {
    return {
      valid: false,
      error: 'يجب تقديم مبرر مالي لاعتماد التجاوز يوضح سبب قبول الزيادة عن التعرفة.',
    };
  }

  return { valid: true };
}
