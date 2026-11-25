import { convertFxAmount } from './fx-conversion.engine';
import { roundMoney, type MoneyDigits } from './money-minor-units.engine';

export function calculateForexDifference(
  localBalance: number,
  foreignBalance: number,
  closingRate: number,
  digits: MoneyDigits,
) {
  if (![localBalance, foreignBalance, closingRate].every(Number.isFinite) || closingRate <= 0) {
    throw new Error('Invalid foreign exchange valuation inputs');
  }
  const revaluedLocal = convertFxAmount(foreignBalance, closingRate, digits);
  const difference = roundMoney(revaluedLocal - localBalance, digits);
  return { revaluedLocal, difference };
}

export function forexOffsetCode(netDifference: number): '7180' | '7280' {
  if (!Number.isFinite(netDifference)) throw new Error('Invalid foreign exchange difference');
  return netDifference >= 0 ? '7180' : '7280';
}
