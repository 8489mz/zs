import { BadRequestException } from '@nestjs/common';
import { MoneyDigits, toMinorUnits, fromMinorUnits } from '../../accounting/engines/money-minor-units.engine';

/** Allocate the full amount in the source currency's integer minor units. */
export function allocateLandedCosts(totalAmount: number, weights: number[], digits: MoneyDigits = 2): number[] {
  let totalMinor: number;
  try {
    totalMinor = toMinorUnits(totalAmount, digits);
  } catch {
    throw new BadRequestException('قيمة التكاليف الإضافية تتجاوز دقة عملة الأساس.');
  }
  if (totalMinor < 0) {
    throw new BadRequestException('قيمة التكاليف الإضافية يجب أن تكون موجبة بدقة عملة الأساس.');
  }
  if (!weights.length || weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new BadRequestException('أوزان توزيع التكاليف غير صالحة.');
  }
  const sumWeights = weights.reduce((sum, value) => sum + value, 0);
  const shares = weights.map((weight, index) => {
    const exact = sumWeights > 0 ? (totalMinor * weight) / sumWeights : totalMinor / weights.length;
    const whole = Math.floor(exact);
    return { index, whole, fractional: exact - whole };
  });
  const remainder = totalMinor - shares.reduce((sum, s) => sum + s.whole, 0);
  if (remainder < 0 || remainder > shares.length) throw new BadRequestException('خطأ في تقريب توزيع التكاليف.');
  const ranked = [...shares].sort((a, b) => b.fractional - a.fractional || a.index - b.index);
  for (let i = 0; i < remainder; i++) ranked[i].whole += 1;
  return shares.map((share) => fromMinorUnits(share.whole, digits));
}
