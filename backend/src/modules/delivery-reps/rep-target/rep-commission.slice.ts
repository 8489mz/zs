import { type MoneyDigits, roundMoney as roundBookMoney } from '../../accounting/engines/money-minor-units.engine';

export interface RepCommissionInput {
  actualSales: number;
  actualCollections: number;
  salesTarget?: number | null;
  collectionTarget?: number | null;
  salesCommissionRatePercent?: number | null;
  collectionCommissionRatePercent?: number | null;
  targetBonusRatePercent?: number | null;
  alreadyPaidAmount?: number | null;
  moneyDigits: MoneyDigits;
}

export interface RepCommissionMetricsResult {
  salesCommissionRatePercent: number;
  collectionCommissionRatePercent: number;
  targetBonusRatePercent: number;
  salesCommissionAmount: number;
  collectionCommissionAmount: number;
  isTargetBonusEligible: boolean;
  targetBonusAmount: number;
  totalEarnedCommission: number;
  alreadyPaidAmount: number;
  remainingPayableCommission: number;
}

/**
 * Pure calculation engine for Delivery & Van Sales Representative Commissions.
 * Calculates commission on net sales, commission on cash/credit collections,
 * and achievement tier bonus when monthly sales target is met (>= 100%).
 */
export function calculateRepCommissionMetrics(input: RepCommissionInput): RepCommissionMetricsResult {
  const actualSales = Math.max(0, Number(input.actualSales || 0));
  const actualCollections = Math.max(0, Number(input.actualCollections || 0));
  const salesTarget = Math.max(0, Number(input.salesTarget || 0));

  const salesRate = input.salesCommissionRatePercent !== undefined && input.salesCommissionRatePercent !== null
    ? Math.max(0, Number(input.salesCommissionRatePercent))
    : 1.0;
  const collectionRate = input.collectionCommissionRatePercent !== undefined && input.collectionCommissionRatePercent !== null
    ? Math.max(0, Number(input.collectionCommissionRatePercent))
    : 0.5;
  const bonusRate = input.targetBonusRatePercent !== undefined && input.targetBonusRatePercent !== null
    ? Math.max(0, Number(input.targetBonusRatePercent))
    : 0.5;

  const salesCommissionAmount = roundBookMoney((actualSales * salesRate) / 100, input.moneyDigits);
  const collectionCommissionAmount = roundBookMoney((actualCollections * collectionRate) / 100, input.moneyDigits);
  const isTargetBonusEligible = salesTarget > 0 && actualSales >= salesTarget;
  const targetBonusAmount = isTargetBonusEligible ? roundBookMoney((actualSales * bonusRate) / 100, input.moneyDigits) : 0;

  const totalEarnedCommission = roundBookMoney(
    salesCommissionAmount + collectionCommissionAmount + targetBonusAmount,
    input.moneyDigits,
  );
  const alreadyPaidAmount = roundBookMoney(Math.max(0, Number(input.alreadyPaidAmount || 0)), input.moneyDigits);
  const remainingPayableCommission = roundBookMoney(
    Math.max(0, totalEarnedCommission - alreadyPaidAmount),
    input.moneyDigits,
  );

  return {
    salesCommissionRatePercent: salesRate,
    collectionCommissionRatePercent: collectionRate,
    targetBonusRatePercent: bonusRate,
    salesCommissionAmount,
    collectionCommissionAmount,
    isTargetBonusEligible,
    targetBonusAmount,
    totalEarnedCommission,
    alreadyPaidAmount,
    remainingPayableCommission,
  };
}
