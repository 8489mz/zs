import { BadRequestException } from '@nestjs/common';
import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { tenantBaseCurrency } from './accounting-currency';
import { exchangeRateAsOf } from './exchange-rate-history';

export interface ResolveFxRateOptions {
  /** Read the rate registered at this moment from the append-only history. */
  asOf?: Date | string;
  /** A caller-supplied contractual rate, validated but never compared here. */
  suppliedRate?: number;
}

/**
 * The single FX rate resolver (INV-FX-RATE-RESOLUTION-SINGLE-RESOLVER):
 * one answer to "how much is one unit of this currency worth in base
 * currency" — the base currency resolves to 1 (even with a supplied
 * rate, and an omitted currency means the base currency); with an
 * as-of moment the rate comes from the append-only history, and a
 * supplied rate alongside a moment is a contradiction that fails
 * closed; with a supplied rate and no moment the supplied rate stands
 * after validation; otherwise the live registered rate is used,
 * failing closed when none exists. The base currency is derived
 * strictly through tenantBaseCurrency, so a settings/rate mismatch
 * fails closed instead of silently defaulting. The resolver returns
 * the raw registered rate — rounding belongs to the conversion
 * engine downstream. PDC cheques deliberately do NOT use this
 * resolver: pdcCurrencySnapshot adds PDC-only sanity/variance guards
 * around the same live read.
 */
export async function resolveFxRate(
  db: Kysely<Database>,
  tenantId: string,
  currency: string | undefined,
  options?: ResolveFxRateOptions,
): Promise<number> {
  const base = await tenantBaseCurrency(db, tenantId);
  const code =
    String(currency || '')
      .trim()
      .toUpperCase() || base;
  if (code === base) return 1;
  if (options?.asOf !== undefined && options?.suppliedRate !== undefined) {
    throw new BadRequestException(
      'A supplied exchange rate cannot be combined with an as-of moment; resolve one rate source.',
    );
  }
  if (options?.asOf !== undefined) {
    return exchangeRateAsOf(db, tenantId, code, options.asOf);
  }
  if (options?.suppliedRate !== undefined) {
    const supplied = Number(options.suppliedRate);
    if (!Number.isFinite(supplied) || supplied <= 0) {
      throw new BadRequestException('سعر الصرف يجب أن يكون موجباً وصالحاً');
    }
    return supplied;
  }
  const row = await db
    .selectFrom('currency_exchange_rates')
    .select('exchange_rate')
    .where('tenant_id', '=', tenantId)
    .where('currency_code', '=', code)
    .executeTakeFirst();
  const rate = Number(row?.exchange_rate);
  if (!row || !Number.isFinite(rate) || rate <= 0) {
    throw new BadRequestException(`سعر صرف ${code} غير متاح؛ لا يمكن ترحيل قيمة بعملة خاطئة`);
  }
  return rate;
}
