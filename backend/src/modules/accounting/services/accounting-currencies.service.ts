import { tenantBaseCurrency } from '../accounting-currency';
import { resolveFxRate } from '../fx-rate-resolution';
import { currencyMoneyDigits, roundMoney } from '../engines/money-minor-units.engine';
import { Injectable, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { type Database } from '../../../database/database.types';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { lockAccountingPeriod } from '../accounting-period-lock';

/**
 * AccountingCurrenciesService — slice S8 of the accounting split.
 * Pure move of 3 methods from AccountingService (the multi-currency
 * engine: list, upsert, convert). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names
 * and signatures. Deps are kernel only — and the only bound dep is
 * db: the three methods scope via requireTenantScope(auth) directly
 * and never call a kernel helper (no assertAccountingAccess, no
 * toMoney). convertCurrency carries the file's only toFixed(6)
 * (effectiveRate, informational rate formatting — NOT money) and both
 * resolveFxRate call sites, which resolve through the single resolver
 * with { asOf } and fail closed when no rate was recorded yet; no FX
 * rate is ever hardcoded (the base-currency seed rate of 1 is
 * definitionally 1). upsertCurrency + convertCurrency have driving
 * specs (convert-currency-target-digits, fx-rate-history-consumer);
 * listCurrencies is controller-only. The guard FX pin
 * (architecture-guard.spec.ts) is merge-owned (repoint to a
 * multi-file read).
 */

export interface AccountingCurrenciesDeps {
  db: Kysely<Database>;
}

@Injectable()
export class AccountingCurrenciesService {
  private readonly db: Kysely<Database>;

  constructor(deps: AccountingCurrenciesDeps) {
    this.db = deps.db;
  }

  async listCurrencies(auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      let rows = await trx
        .selectFrom('currency_exchange_rates')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .orderBy('is_base', 'desc')
        .orderBy('currency_code', 'asc')
        .execute();

      const baseCurrency = await tenantBaseCurrency(trx, scope.tenantId);
      if (rows.length === 0) {
        // Never seed sample market rates into live financial conversion tables.
        const defaultCurrencies = [
          { code: baseCurrency, name: baseCurrency, rate: 1, isBase: true, symbol: baseCurrency },
        ];

        for (const c of defaultCurrencies) {
          await trx
            .insertInto('currency_exchange_rates')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              currency_code: c.code,
              currency_name: c.name,
              exchange_rate: c.rate,
              is_base: c.isBase,
              symbol: c.symbol,
            })
            .onConflict((oc) => oc.columns(['tenant_id', 'currency_code']).doNothing())
            .execute();
        }

        rows = await trx
          .selectFrom('currency_exchange_rates')
          .selectAll()
          .where('tenant_id', '=', scope.tenantId)
          .orderBy('is_base', 'desc')
          .orderBy('currency_code', 'asc')
          .execute();
      }

      return {
        currencies: rows.map((r) => ({
          id: String(r.id),
          code: r.currency_code,
          name: r.currency_name,
          exchangeRate: Number(r.exchange_rate),
          isBase: Boolean(r.is_base),
          symbol: r.symbol,
          updatedAt: r.updated_at,
        })),
      };
    });
  }

  async upsertCurrency(
    body: { currencyCode: string; currencyName: string; exchangeRate: number; isBase?: boolean; symbol?: string },
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const code = String(body.currencyCode || '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw new BadRequestException('رمز العملة مطلوب.');

    const name = String(body.currencyName || code).trim();
    const rate = Number(body.exchangeRate);
    if (!Number.isFinite(rate) || rate <= 0) throw new BadRequestException('سعر الصرف يجب أن يكون موجباً ومحدوداً.');
    const isBase = Boolean(body.isBase);
    const symbol = String(body.symbol || '').trim();

    if (isBase && rate !== 1) throw new BadRequestException('سعر عملة الأساس يجب أن يساوي واحداً.');
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      const baseCurrency = await tenantBaseCurrency(trx, scope.tenantId);
      if (isBase !== (code === baseCurrency))
        throw new BadRequestException('عملة الأساس تحدد من الإعدادات العامة قبل تسجيل أي عملة أو حركة مالية.');

      const row = await trx
        .insertInto('currency_exchange_rates')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          currency_code: code,
          currency_name: name,
          exchange_rate: rate,
          is_base: isBase,
          symbol,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'currency_code']).doUpdateSet({
            currency_name: name,
            exchange_rate: rate,
            is_base: isBase,
            symbol,
            updated_at: sql`NOW()`,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      return { ok: true, currency: row };
    });
  }

  async convertCurrency(
    body: { amount: number; fromCurrency: string; toCurrency: string; asOf?: string },
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const baseCurrency = await tenantBaseCurrency(this.db, scope.tenantId);
    const fromCode = String(body.fromCurrency || '')
      .trim()
      .toUpperCase();
    const toCode = String(body.toCurrency || '')
      .trim()
      .toUpperCase();
    const amount = Number(body.amount || 0);

    if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(fromCode) || !/^[A-Z]{3}$/.test(toCode))
      throw new BadRequestException('مبلغ أو رمز عملة غير صالح.');

    // INV-FX-RATE-HISTORY-CONSUMER: the first production consumer of
    // the append-only rate history. With an asOf moment both legs
    // resolve through the single resolver, which reads the rate
    // registered at that moment and fails closed when none was
    // recorded yet — a historical amount is never silently converted
    // at a later (live) rate. Without asOf the live rows are used,
    // exactly as before.
    const asOfRaw = typeof body.asOf === 'string' ? body.asOf.trim() : '';
    let asOf: Date | null = null;
    if (asOfRaw) {
      asOf = new Date(asOfRaw);
      if (!Number.isFinite(asOf.getTime())) throw new BadRequestException('تاريخ سعر الصرف غير صالح.');
    }

    let fromRate: number;
    let toRate: number;
    let fromIsBase: boolean;
    let toIsBase: boolean;
    if (asOf) {
      fromRate = await resolveFxRate(this.db, scope.tenantId, fromCode, { asOf });
      toRate = await resolveFxRate(this.db, scope.tenantId, toCode, { asOf });
      fromIsBase = fromCode === baseCurrency;
      toIsBase = toCode === baseCurrency;
    } else {
      const rates = await this.db
        .selectFrom('currency_exchange_rates')
        .select(['currency_code', 'exchange_rate', 'is_base'])
        .where('tenant_id', '=', scope.tenantId)
        .where('currency_code', 'in', [fromCode, toCode])
        .execute();

      const fromRow = rates.find((r) => r.currency_code === fromCode);
      const toRow = rates.find((r) => r.currency_code === toCode);

      if (!fromRow || !toRow) throw new BadRequestException('العملة غير مسجلة؛ لا يجوز افتراض سعر صرف.');
      fromRate = Number(fromRow.exchange_rate);
      toRate = Number(toRow.exchange_rate);
      if (![fromRate, toRate].every((rate) => Number.isFinite(rate) && rate > 0))
        throw new BadRequestException('سعر صرف مسجل غير صالح.');
      fromIsBase = Boolean(fromRow.is_base);
      toIsBase = Boolean(toRow.is_base);
    }

    const amountInBase = fromIsBase ? amount : amount * fromRate;
    const convertedAmount = toIsBase ? amountInBase : amountInBase / toRate;

    return {
      amount,
      fromCurrency: fromCode,
      toCurrency: toCode,
      // INV-CONVERT-CURRENCY-TARGET-DIGITS: round the displayed
      // amount once, from the unrounded conversion, at the target
      // currency's book digits. The rate read, the fail-closed
      // checks, the base-leg math, and the 6-decimal effective
      // rate are unchanged.
      convertedAmount: roundMoney(convertedAmount, currencyMoneyDigits(toCode)),
      effectiveRate: toRate > 0 ? Number((fromRate / toRate).toFixed(6)) : 1,
      rateAsOf: asOf ? asOf.toISOString() : null,
    };
  }
}
