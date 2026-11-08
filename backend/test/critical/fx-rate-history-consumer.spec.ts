/*
New file: backend/test/critical/fx-rate-history-consumer.spec.ts
Pins the first production consumer of the append-only rate
history (INV-FX-RATE-HISTORY-CONSUMER).

THE GAP: the as-of reader (exchangeRateAsOf) and its wiring in
the single resolver (resolveFxRate with asOf) existed, but no
production path ever passed a moment — every conversion read
the live rate row, so a historical amount was silently
converted at today's rate. The ideal historical consumers
(maritime close-time conversions) live in
maritime-freight.service.ts, owned by F2 in this batch, so the
smallest safe consumer outside other U3 packages' files is the
currency converter: AccountingService.convertCurrency accepts
an optional asOf moment and resolves both legs through the
single resolver.

THE RULE: with asOf, both legs resolve from the rate
registered at that moment (base leg stays 1, no history row
needed); without asOf the live rows are used, exactly as
before. When no rate was registered yet at the moment the
conversion fails closed — it never silently uses a later rate.
The returned rateAsOf names the basis used (null = live).

WHAT THIS PINS, driving the REAL convertCurrency on PGlite
(KWD base, USD live 48.5, USD history 45.0 from 2026-01-01
then 48.5 from 2026-06-01, EGP registered at 1):
- asOf 2026-03-01: USD -> KWD 100 -> 4500 at rate 45, NOT the
  live 48.5 (which would give 4850).
- asOf 2026-07-01: USD -> KWD 100 -> 4850 at the latest
  as-of row (48.5).
- no asOf: USD -> KWD 100 -> 4850, rateAsOf null (live
  behaviour unchanged).
- asOf 2025-12-01 (before any USD history row): fails closed,
  never a later rate.
- asOf 'not-a-date': fails closed with a named error.
- asOf 2026-03-01: KWD -> USD 100 -> 2.22 at rate 1/45 (the
  base leg needs no history row).
- the resolver itself: resolveFxRate asOf 2026-03-01 returns
  45 and fails closed before any history row.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingService } from '../../src/modules/accounting/accounting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { resolveFxRate } from '../../src/modules/accounting/fx-rate-resolution';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const accounting = new AccountingService(db, foundation, undefined);

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE currency_exchange_rate_history (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean, effective_from timestamptz, created_at timestamptz);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',48.5,false),('t1','EGP',1,false);
      INSERT INTO currency_exchange_rate_history (tenant_id, currency_code, exchange_rate, is_base, effective_from) VALUES
        ('t1','USD',45.0,false,'2026-01-01T00:00:00Z'),
        ('t1','USD',48.5,false,'2026-06-01T00:00:00Z'),
        ('t1','EGP',1,false,'2026-01-01T00:00:00Z');
    `);

    // 1. Historical rate, not the live rate: 100 USD at the
    // 2026-03-01 rate of 45 converts to 4500 KWD (live 48.5
    // would give 4850).
    const historical = await accounting.convertCurrency({ amount: 100, fromCurrency: 'USD', toCurrency: 'KWD', asOf: '2026-03-01' }, auth);
    assert.equal(historical.convertedAmount, 4500);
    assert.equal(historical.effectiveRate, 45);
    assert.equal(historical.rateAsOf, '2026-03-01T00:00:00.000Z');

    // 2. Latest as-of row wins: after the 2026-06-01 change the
    // historical rate is 48.5.
    const latestAsOf = await accounting.convertCurrency({ amount: 100, fromCurrency: 'USD', toCurrency: 'KWD', asOf: '2026-07-01' }, auth);
    assert.equal(latestAsOf.convertedAmount, 4850);
    assert.equal(latestAsOf.effectiveRate, 48.5);

    // 3. No asOf: live behaviour unchanged, rateAsOf null.
    const live = await accounting.convertCurrency({ amount: 100, fromCurrency: 'USD', toCurrency: 'KWD' }, auth);
    assert.equal(live.convertedAmount, 4850);
    assert.equal(live.effectiveRate, 48.5);
    assert.equal(live.rateAsOf, null);

    // 4. Before any history row: fails closed, never a later rate.
    await assert.rejects(
      accounting.convertCurrency({ amount: 100, fromCurrency: 'USD', toCurrency: 'KWD', asOf: '2025-12-01' }, auth),
      /No exchange rate was registered for USD at the requested moment/,
    );

    // 5. An unparseable asOf fails closed with a named error.
    await assert.rejects(
      accounting.convertCurrency({ amount: 100, fromCurrency: 'USD', toCurrency: 'KWD', asOf: 'not-a-date' }, auth),
      /تاريخ سعر الصرف غير صالح/,
    );

    // 6. Base leg needs no history row: 100 KWD at 1/45 is 2.22 USD.
    const baseLeg = await accounting.convertCurrency({ amount: 100, fromCurrency: 'KWD', toCurrency: 'USD', asOf: '2026-03-01' }, auth);
    assert.equal(baseLeg.convertedAmount, 2.22);
    assert.equal(baseLeg.effectiveRate, 0.022222);

    // 7. The resolver itself, wired to the reader: asOf returns
    // the historical rate and fails closed before any row.
    assert.equal(await resolveFxRate(db, 't1', 'USD', { asOf: '2026-03-01' }), 45);
    assert.equal(await resolveFxRate(db, 't1', 'USD', { asOf: new Date('2026-07-01') }), 48.5);
    await assert.rejects(
      resolveFxRate(db, 't1', 'USD', { asOf: '2025-12-01' }),
      /No exchange rate was registered for USD at the requested moment/,
    );

    console.log('fx rate history consumer checks passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
