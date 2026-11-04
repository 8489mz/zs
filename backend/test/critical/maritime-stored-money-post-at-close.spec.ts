/*
 * Maritime stored money posts at close (INV-MARITIME-STORED-MONEY-POST-AT-CLOSE).
 *
 * THE GAP: forex gain/loss, trucking trip costs and insurance
 * premiums were stored only -- calculateJobForexGainLoss wrote a
 * number on the job, trips and policies kept cost/premium amounts
 * in their own rows, and none of it ever reached the general
 * ledger or the job P&L, while container demurrage amounts only
 * existed as a stored exposure figure.
 *
 * THE RULE: closing a job posts its stored money automatically,
 * to explicit accounts, with no extra staff work. The forex
 * spread adjusts the carrier payable (2110) against the chart's
 * shared offset account (7180 gain / 7280 loss, created on demand
 * exactly as forex revaluation creates it), only when a posted
 * carrier invoice exists to adjust. Completed trucking trips
 * (delivered / empty_returned) post cost only -- the sell side
 * stays in the charges/invoice flow and is never double-posted.
 * Active insurance policies post their premium. Every amount
 * converts through the shared resolver at book digits, every
 * slice is idempotent per source row (a posted close journal is
 * never posted twice, so reopen + re-close posts only new rows),
 * and trucking + insurance costs roll into other_costs_total /
 * net_profit by the same formula the other posting paths use.
 * Container demurrage_amount is deliberately NOT posted here: it
 * is billed as DEM charges through the normal invoice flow.
 * Missing expense/payable accounts fail closed. The supplier
 * subledger is not written (not decided).
 *
 * WHAT THIS PINS, driving the REAL postStoredMoneyAtClose on
 * PGlite (KWD base, USD live 56 as seeded data, a posting stub
 * that writes real journal rows so the idempotency checks read
 * them back):
 * - forex gain posts Dr 2110 / Cr 7180; forex loss posts
 *   Dr 7280 / Cr 2110; a second close posts nothing new;
 * - a spread with no posted carrier invoice posts nothing;
 * - a delivered trip posts its converted cost, an assigned trip
 *   does not, and a second close posts no duplicate;
 * - an active policy posts its converted premium, a non-active
 *   policy does not, and job totals roll up;
 * - a missing 7180 is auto-created under parent 7100 with the
 *   revaluation service's own names; a missing parent fails
 *   closed with no journal.
 *
 * HONEST LIMIT: the posting branch is stubbed exactly as in
 * maritime-job-journal-fx-conversion.spec.ts. The integrated
 * close paths (updateJob status -> completed, RETN milestone)
 * are pinned by source read only; the end-to-end close on live
 * Postgres is a rehearsal item, as is a close whose stored
 * amounts change after the first close posting (only genuinely
 * new source rows post on re-close).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  const postingStub = {
    postDomainJournal: async (trx: any, input: any) => {
      const [row] = await trx
        .insertInto('journal_entries')
        .values({
          tenant_id: input.tenantId,
          status: 'posted',
          entry_date: input.entryDate,
          entry_no: `JE-${input.sourceType}-${input.sourceId}`,
          source_type: input.sourceType,
          source_id: input.sourceId,
        })
        .returning('id')
        .execute();
      const id = Number(row.id);
      for (const line of input.lines) {
        await trx
          .insertInto('journal_entry_lines')
          .values({
            tenant_id: input.tenantId,
            journal_entry_id: id,
            account_id: line.accountId,
            debit: line.debit,
            credit: line.credit,
            description: line.description,
            partner_type: line.partnerType,
            partner_id: line.partnerId,
            cost_center_id: line.costCenterId ?? null,
          })
          .execute();
      }
      return id;
    },
  };
  const service = new MaritimeFreightService(db, {} as never, {} as never, postingStub as never);

  async function journalLines(sourceType: string, sourceId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
    const rows = await (db as any)
      .selectFrom('journal_entries as je')
      .innerJoin('journal_entry_lines as jl', (j: any) => j.onRef('jl.journal_entry_id', '=', 'je.id'))
      .innerJoin('accounting_accounts as a', (j: any) => j.onRef('a.id', '=', 'jl.account_id'))
      .select(['a.code', 'jl.debit', 'jl.credit'])
      .where('je.source_type', '=', sourceType)
      .where('je.source_id', '=', sourceId)
      .execute();
    return rows.map((r: any) => ({ code: String(r.code), debit: Number(r.debit), credit: Number(r.credit) }));
  }

  async function jobTotals(jobId: number): Promise<{ other: number; net: number }> {
    const row = await (db as any).selectFrom('maritime_jobs').select(['other_costs_total', 'net_profit']).where('id', '=', jobId).executeTakeFirstOrThrow();
    return { other: Number(row.other_costs_total), net: Number(row.net_profit) };
  }

  async function journalCount(): Promise<number> {
    const rows = await (db as any).selectFrom('journal_entries').selectAll().execute();
    return rows.length;
  }

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, normal_balance text, account_group text, parent_id bigint, is_active boolean, is_system boolean, allow_manual_entries boolean, is_control_account boolean, is_cash_bank boolean, is_receivable boolean, is_payable boolean, is_inventory boolean, is_tax boolean, description_ar text, sort_order int);
      CREATE UNIQUE INDEX idx_accounting_accounts_tenant_code_uidx ON accounting_accounts (tenant_id, code);
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, job_number text, cost_center_id text, client_invoiced_total numeric, carrier_cost_total numeric, other_costs_total numeric, net_profit numeric, forex_gain_loss numeric, status text, updated_at timestamptz);
      CREATE TABLE maritime_carrier_invoices (id bigserial PRIMARY KEY, tenant_id text, job_id bigint, journal_entry_id bigint);
      CREATE TABLE maritime_inland_trucking_trips (id bigserial PRIMARY KEY, tenant_id text, job_id bigint, trip_number text, trip_status text, cost_amount numeric, sell_amount numeric, currency text);
      CREATE TABLE maritime_cargo_insurances (id bigserial PRIMARY KEY, tenant_id text, job_id bigint, policy_number text, premium_amount numeric, currency text, status text);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, status text, entry_date timestamptz, entry_no text, source_type text, source_id bigint);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, debit numeric, credit numeric, description text, partner_type text, partner_id bigint, cost_center_id bigint);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',56,false);
      INSERT INTO accounting_accounts (id, tenant_id, account_id, code, name_en, account_type, is_active) VALUES
        (2110,'t1','a1','2110','Payables','liability',true),
        (6400,'t1','a1','6400','Freight Expense','expense',true),
        (7180,'t1','a1','7180','Unrealized FX Gains','revenue',true),
        (7280,'t1','a1','7280','Unrealized FX Losses','expense',true),
        (7100,'t1','a1','7100','Other Income','revenue',true),
        (7200,'t1','a1','7200','Other Expense','expense',true);
      INSERT INTO maritime_jobs VALUES
        (1,'t1','JOB-1',NULL,10000,2000,0,8000,10.005,'active',NULL),
        (2,'t1','JOB-2',NULL,1000,0,0,1000,-5.5,'active',NULL),
        (3,'t1','JOB-3',NULL,1000,0,0,1000,7,'active',NULL),
        (4,'t1','JOB-4',NULL,1000,0,0,1000,2,'active',NULL),
        (5,'t1','JOB-5',NULL,1000,0,0,1000,2,'active',NULL);
      INSERT INTO maritime_carrier_invoices (tenant_id, job_id, journal_entry_id) VALUES ('t1',1,99),('t1',2,98),('t1',4,97),('t1',5,96);
      INSERT INTO maritime_inland_trucking_trips (tenant_id, job_id, trip_number, trip_status, cost_amount, sell_amount, currency) VALUES
        ('t1',1,'TRIP-1','delivered',100,150,'USD'),
        ('t1',1,'TRIP-2','assigned',100,150,'USD'),
        ('t1',1,'TRIP-3','delivered',0,0,'USD');
      INSERT INTO maritime_cargo_insurances (tenant_id, job_id, policy_number, premium_amount, currency, status) VALUES
        ('t1',1,'POL-1',50,'USD','active'),
        ('t1',1,'POL-2',999,'USD','expired');
    `);

    // 1. Gain + trucking + insurance post together; re-close posts nothing new.
    const first = await service.postStoredMoneyAtClose(db as never, 't1', 1, auth);
    assert.equal(first.posted, true);
    assert.equal(first.journalEntryIds.length, 3);
    assert.deepEqual(first.forex, { posted: true, amount: 10.005, reason: null });
    assert.deepEqual(first.trucking, { postedCount: 1, amount: 5600 });
    assert.deepEqual(first.insurance, { postedCount: 1, amount: 2800 });
    assert.deepEqual(await journalLines('maritime_job_forex_close', 1), [
      { code: '2110', debit: 10.005, credit: 0 },
      { code: '7180', debit: 0, credit: 10.005 },
    ]);
    assert.deepEqual(await journalLines('maritime_trucking_close', 1), [
      { code: '6400', debit: 5600, credit: 0 },
      { code: '2110', debit: 0, credit: 5600 },
    ]);
    assert.deepEqual(await journalLines('maritime_insurance_close', 1), [
      { code: '6400', debit: 2800, credit: 0 },
      { code: '2110', debit: 0, credit: 2800 },
    ]);
    assert.deepEqual(await jobTotals(1), { other: 8400, net: -400 });
    const countAfterFirst = await journalCount();
    const second = await service.postStoredMoneyAtClose(db as never, 't1', 1, auth);
    assert.equal(second.posted, false);
    assert.equal(second.journalEntryIds.length, 0);
    assert.equal(await journalCount(), countAfterFirst);
    assert.deepEqual(await jobTotals(1), { other: 8400, net: -400 });

    // 2. Loss posts the mirror legs.
    const loss = await service.postStoredMoneyAtClose(db as never, 't1', 2, auth);
    assert.equal(loss.forex.posted, true);
    assert.deepEqual(await journalLines('maritime_job_forex_close', 2), [
      { code: '7280', debit: 5.5, credit: 0 },
      { code: '2110', debit: 0, credit: 5.5 },
    ]);

    // 3. Spread with no posted carrier invoice posts nothing.
    const noInvoice = await service.postStoredMoneyAtClose(db as never, 't1', 3, auth);
    assert.equal(noInvoice.posted, false);
    assert.equal(noInvoice.forex.posted, false);
    assert.ok(noInvoice.forex.reason);
    assert.equal((await journalLines('maritime_job_forex_close', 3)).length, 0);

    // 4. A missing 7180 is auto-created under 7100 with the
    // revaluation service's own names, then posted to.
    await pg.exec(`DELETE FROM accounting_accounts WHERE code = '7180'`);
    const recreated = await service.postStoredMoneyAtClose(db as never, 't1', 4, auth);
    assert.equal(recreated.forex.posted, true);
    const acc7180 = await (db as any).selectFrom('accounting_accounts').selectAll().where('code', '=', '7180').executeTakeFirstOrThrow();
    assert.equal(acc7180.name_en, 'Unrealized FX Gains');
    assert.equal(acc7180.is_system, true);
    assert.equal(Number(acc7180.parent_id), 7100);
    assert.deepEqual(await journalLines('maritime_job_forex_close', 4), [
      { code: '2110', debit: 2, credit: 0 },
      { code: '7180', debit: 0, credit: 2 },
    ]);

    // 5. A missing parent fails closed with no journal.
    await pg.exec(`DELETE FROM accounting_accounts WHERE code IN ('7180','7100')`);
    const beforeFail = await journalCount();
    await assert.rejects(
      service.postStoredMoneyAtClose(db as never, 't1', 5, auth),
      /الإيرادات أو المصروفات/,
    );
    assert.equal(await journalCount(), beforeFail);

    // 6. Source pins: both close paths call the posting, and the
    // helper never reads container rows (demurrage stays out).
    const source = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight.service.ts'), 'utf8');
    const helperStart = source.indexOf('async postStoredMoneyAtClose(');
    const consolidationStart = source.indexOf('2. Consolidation & Sub-Jobs');
    assert.ok(helperStart > 0 && consolidationStart > helperStart);
    const helperBody = source.slice(helperStart, consolidationStart);
    assert.ok(helperBody.includes('maritime_job_forex_close'));
    assert.ok(helperBody.includes('maritime_trucking_close'));
    assert.ok(helperBody.includes('maritime_insurance_close'));
    assert.ok(!helperBody.includes('maritime_containers'));
    assert.ok(!helperBody.includes('demurrage'));
    const updateJobStart = source.indexOf('async updateJob(');
    const milestoneStart = source.indexOf('async addJobMilestone(');
    assert.ok(source.slice(updateJobStart, milestoneStart).includes('postStoredMoneyAtClose'));
    assert.ok(source.slice(milestoneStart, source.indexOf('async releaseDeliveryOrder(')).includes('postStoredMoneyAtClose'));

    console.log('maritime stored money post at close checks passed');
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
