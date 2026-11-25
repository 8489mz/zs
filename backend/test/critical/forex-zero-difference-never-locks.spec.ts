/*
New file: backend/test/critical/forex-zero-difference-never-locks.spec.ts
Pins the revaluation locking rule
(INV-ZERO-DIFFERENCE-REVALUATION-NEVER-LOCKS).

THE GAP: executeRevaluation recorded EVERY run with status
'posted' — including a zero-difference run that posted no
journal. The duplicate guard matches status 'posted', so one
no-op run (rates unchanged, or a closing rate entered wrong)
permanently blocked any later real revaluation for the same
period and currency.

THE RULE: only a run that posted a journal locks the
period/currency. A zero-difference run is recorded as
'no_difference' for audit, and a later run with a corrected
closing rate still executes.

WHAT THIS PINS, driving the REAL executeRevaluation on PGlite
(EGP base, USD book rate 48, account holding 4800 local for
100 foreign, stubbed posting service):
- closing 48 (zero difference): run recorded 'no_difference',
  no journal posted.
- closing 50 next: succeeds, posts one journal, run 'posted'.
- closing 51 next: rejected as already revalued (the lock
  still works for runs that posted).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ForexRevaluationService } from '../../src/modules/accounting/services/forex-revaluation.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  let journalCalls = 0;
  const postingStub = {
    postDomainJournal: async () => {
      journalCalls += 1;
      return 900;
    },
  };
  const service = new ForexRevaluationService(db, postingStub as never);

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean, updated_at timestamptz);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, normal_balance text, is_active boolean, is_monetary boolean, revaluation_currency text, is_control_account boolean, is_receivable boolean, is_payable boolean, is_inventory boolean, parent_id bigint);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint);
      CREATE TABLE journal_entries (id bigint PRIMARY KEY, tenant_id text, status text, entry_date timestamptz, entry_no text, source_id bigint, updated_at timestamptz);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, debit numeric, credit numeric);
      CREATE TABLE forex_revaluation_runs (id bigserial PRIMARY KEY, tenant_id text, period_date date, currency_code text, book_exchange_rate numeric, closing_exchange_rate numeric, foreign_balance_total numeric, unrealized_gain_loss numeric, journal_entry_id bigint, journal_entry_no text, status text, notes text, created_by int);
      CREATE TABLE forex_revaluation_lines (id bigserial PRIMARY KEY, tenant_id text, run_id text, account_id text, account_code text, account_name text, foreign_balance numeric, book_local_value numeric, revalued_local_value numeric, unrealized_difference numeric);
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','EGP',1,true),('t1','USD',48,false);
      INSERT INTO accounting_accounts VALUES (10,'t1','1120','Bank USD','Bank USD','asset','debit',true,true,'USD',false,false,false,false,NULL);
      INSERT INTO accounting_accounts VALUES (20,'t1','7100','Other income','Other income','income','credit',true,false,NULL,false,false,false,false,NULL);
      INSERT INTO accounting_accounts VALUES (30,'t1','7180','Unrealized FX Gains','Unrealized FX Gains','revenue','credit',true,false,NULL,false,false,false,false,20);
      INSERT INTO accounting_settings VALUES (1,'t1',999,998,997);
      INSERT INTO journal_entries (id, tenant_id, status, entry_date) VALUES (1,'t1','posted','2026-10-15');
      INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, account_id, debit, credit) VALUES ('t1',1,10,4800,0);
    `);

    const dto = {
      periodDate: '2026-10-31',
      currencyCode: 'USD',
      closingRate: 48,
      items: [{ accountId: 10, foreignBalance: 100 }],
    };

    // 1. Zero difference: recorded, no journal, no lock.
    const noop = await service.executeRevaluation({ ...dto } as never, auth);
    assert.equal(noop.ok, true);
    assert.equal(noop.journalEntryNo, null);
    assert.equal(journalCalls, 0);
    const noopRow = await pg.query<{ status: string }>('SELECT status FROM forex_revaluation_runs ORDER BY id LIMIT 1');
    assert.equal(noopRow.rows[0].status, 'no_difference');

    // 2. Corrected closing rate: executes and posts.
    const real = await service.executeRevaluation({ ...dto, closingRate: 50 } as never, auth);
    assert.equal(real.ok, true);
    assert.equal(journalCalls, 1);
    assert.equal(real.netUnrealizedGainLoss, 200);
    const realRow = await pg.query<{ status: string }>(
      'SELECT status FROM forex_revaluation_runs ORDER BY id DESC LIMIT 1',
    );
    assert.equal(realRow.rows[0].status, 'posted');

    // 3. A posted run still locks the period/currency.
    await assert.rejects(service.executeRevaluation({ ...dto, closingRate: 51 } as never, auth), /مسبقاً/);

    console.log('Forex zero difference never locks tests passed.');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
