import { BadRequestException } from '@nestjs/common';
import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { tenantBaseCurrency } from './accounting-currency';
import { currencyMoneyDigits, toMinorUnits, roundMoney } from './engines/money-minor-units.engine';

export async function pdcCurrencySnapshot(
  db: Kysely<Database>,
  tenantId: string,
  currency: string,
  amount: number,
  suppliedRate?: number,
) {
  const rates = await db
    .selectFrom('currency_exchange_rates')
    .select(['currency_code', 'exchange_rate', 'is_base'])
    .where('tenant_id', '=', tenantId)
    .execute();
  const base = await tenantBaseCurrency(db, tenantId);
  const rawRate =
    currency === base
      ? 1
      : (suppliedRate ?? Number(rates.find((row) => row.currency_code === currency)?.exchange_rate));
  const rate = Number(Number(rawRate).toFixed(8));
  // INV-PDC-RATE-VARIANCE-FLAGGED: a supplied rate is a contractual
  // term, so it stands — but two guards apply to foreign-currency
  // cheques only (a base-currency supplied rate is ignored by
  // definition, rate 1). (1) Sanity guard: a supplied rate outside
  // half to double the registered rate is a catastrophic data-entry
  // error (a USD cheque booked at 1, or at 1000, against a
  // registered 48) and fails closed. (2) Variance flag: a supplied
  // rate deviating more than 5% from the registered rate is
  // accepted but flagged, with the registered rate stored
  // alongside, so review screens can audit it. With no registered
  // rate there is nothing to compare against, so the supplied rate
  // stands unflagged. Both creation and settlement pass through
  // this snapshot, so both guards cover both.
  let registeredRate: number | null = null;
  let flaggedRateVariance = false;
  if (currency !== base) {
    const registeredRaw = Number(rates.find((row) => row.currency_code === currency)?.exchange_rate);
    const registered = Number(Number(registeredRaw).toFixed(8));
    if (Number.isFinite(registered) && registered > 0) {
      registeredRate = registered;
      if (suppliedRate !== undefined) {
        const supplied = Number(Number(suppliedRate).toFixed(8));
        if (!Number.isFinite(supplied) || supplied <= 0) {
          throw new BadRequestException('A positive, finite cheque exchange rate is required.');
        }
        if (supplied < registered * 0.5 || supplied > registered * 2) {
          throw new BadRequestException(
            `Cheque exchange rate ${supplied} is outside the plausible range for ${currency} (registered rate ${registered}).`,
          );
        }
        flaggedRateVariance = Math.abs(supplied - registered) / registered > 0.05;
      }
    }
  }
  let baseAmount: number;
  try {
    if (toMinorUnits(amount, currencyMoneyDigits(currency)) <= 0) throw new Error('Invalid amount');
    baseAmount = roundMoney(amount * rate, currencyMoneyDigits(base));
  } catch {
    throw new BadRequestException('قيمة الشيك لا تطابق دقة عملته أو حدودها.');
  }
  if (
    !/^[A-Z]{3}$/.test(currency) ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !Number.isFinite(baseAmount) ||
    baseAmount <= 0
  ) {
    throw new BadRequestException('يلزم سعر صرف موجب وصحيح للشيك بعملة أجنبية.');
  }
  return {
    base_currency: base,
    exchange_rate: rate,
    base_amount: baseAmount,
    flagged_rate_variance: flaggedRateVariance,
    registered_exchange_rate: registeredRate,
  };
}
