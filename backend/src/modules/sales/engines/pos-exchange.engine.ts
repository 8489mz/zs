import { type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { AppError } from '../../../common/errors/app-error';

/** All exchange settlement is performed in whole minor currency units. */
export function settlePosExchange(
  returnTotal: number,
  saleTotal: number,
  digits: MoneyDigits = 2,
): {
  appliedCredit: number;
  refundAmount: number;
  collectibleAmount: number;
} {
  const scale = 10 ** digits;
  const minor = (amount: number) => {
    const value = Math.round(amount * scale);
    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      !Number.isSafeInteger(value) ||
      Math.abs(amount * scale - value) > 0.001
    ) {
      throw new AppError('قيمة الاستبدال غير صالحة', 'EXCHANGE_AMOUNT_INVALID', 422);
    }
    return value;
  };
  const returned = minor(returnTotal);
  const sold = minor(saleTotal);
  return {
    appliedCredit: Math.min(returned, sold) / scale,
    refundAmount: Math.max(0, returned - sold) / scale,
    collectibleAmount: Math.max(0, sold - returned) / scale,
  };
}
