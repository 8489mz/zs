/*
New file: backend/test/critical/maritime-forex-gain-loss-book-digits.spec.ts
Pins the stored forex gain/loss rounding (INV-MARITIME-FOREX-GAIN-LOSS-BOOK-DIGITS).

THE GAP: calculateJobForexGainLoss stored a rate-spread difference
rounded at hard-coded 2 decimals (Math.round(*100)/100) and picked
its base currency with an inline is_base read that silently fell
back to EGP — so a 3-decimal tenant's stored gain/loss was cut to
cents, and a settings/rate mismatch resolved silently instead of
failing closed.

THE RULE: the stored difference rounds through the canonical
roundMoney at the base currency's book digits, and the base
currency comes from tenantBaseCurrency (strict, fail-closed).
convertFxAmount is deliberately NOT used here: the spread can be
negative or zero, and convertFxAmount fails closed on a
non-positive rate — the value is a signed difference, rounded with
the same canonical step the engine uses.

WHAT THIS PINS, driving the REAL calculateJobForexGainLoss on
PGlite (KWD base, quote ROE 50):
- a positive spread stores at base digits ((50 - 48.5) * 100.125
  -> 150.188, not 150.19).
- a negative spread stores signed at base digits ((50 - 51) *
  100.125 -> -100.125).
- a base-currency invoice is excluded from the foreign total.
- a settings/base mismatch fails closed with nothing stored.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const service = new MaritimeFreightService(db, {} as never, {} as never, {} as never);

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, quote_roe numeric, actual_roe numeric, forex_gain_loss numeric, updated_at timestamptz);
      CREATE TABLE maritime_carrier_invoices (id bigserial PRIMARY KEY, tenant_id text, job_id text, currency text, total_invoiced_amount numeric, journal_entry_id bigint);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',48.5,false);
      INSERT INTO maritime_jobs VALUES (1,'t1',50,NULL,0,NULL);
      INSERT INTO maritime_carrier_invoices (tenant_id, job_id, currency, total_invoiced_amount, journal_entry_id) VALUES ('t1','1','USD',100.125,900),('t1','1','KWD',999,901),('t1','1','USD',50,NULL);
    `);

    const gained = await service.calculateJobForexGainLoss(auth, 1, 48.5);
    assert.equal(Number((gained as any).forex_gain_loss), 150.188);
    assert.equal(Number((gained as any).actual_roe), 48.5);

    const lost = await service.calculateJobForexGainLoss(auth, 1, 51);
    assert.equal(Number((lost as any).forex_gain_loss), -100.125);

    await pg.exec(`UPDATE settings SET value = 'EGP' WHERE tenant_id = 't1' AND key = 'currency'`);
    await assert.rejects(service.calculateJobForexGainLoss(auth, 1, 48.5), /لا يطابق/);
    const jobAfterFail = await db
      .selectFrom('maritime_jobs' as any)
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    assert.equal(Number((jobAfterFail as any).actual_roe), 51);

    console.log('maritime forex gain loss book digits checks passed');
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
