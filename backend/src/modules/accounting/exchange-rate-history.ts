import { BadRequestException } from '@nestjs/common';
import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';

/**
 * As-of exchange rate read (INV-EXCHANGE-RATE-HISTORY): the rate
 * that was registered at a point in time, from the append-only
 * history the trigger maintains. Fails closed when no rate was
 * registered yet at that moment — an as-of conversion must never
 * silently use a later rate. First production consumer (FX F4):
 * AccountingService.convertCurrency resolves both legs through
 * resolveFxRate with an optional asOf moment.
 */
export async function exchangeRateAsOf(
  db: Kysely<Database>,
  tenantId: string,
  currency: string,
  asOf: Date | string,
): Promise<number> {
  const code = String(currency || '').trim().toUpperCase();
  const at = asOf instanceof Date ? asOf : new Date(asOf);
  if (!/^[A-Z]{3}$/.test(code) || !Number.isFinite(at.getTime())) {
    throw new BadRequestException('A valid currency code and as-of moment are required.');
  }
  const row = await db
    .selectFrom('currency_exchange_rate_history')
    .select(['exchange_rate'])
    .where('tenant_id', '=', tenantId)
    .where('currency_code', '=', code)
    .where('effective_from', '<=', at)
    .orderBy('effective_from', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const rate = Number(row?.exchange_rate);
  if (!row || !Number.isFinite(rate) || rate <= 0) {
    throw new BadRequestException(`No exchange rate was registered for ${code} at the requested moment.`);
  }
  return rate;
}
