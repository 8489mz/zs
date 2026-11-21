import { type MoneyDigits, roundMoney as roundBookMoney } from '../../accounting/engines/money-minor-units.engine';

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
