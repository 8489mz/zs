/*
New file: backend/test/critical/maritime-job-journal-fx-conversion.spec.ts
Pins the maritime job-journal FX conversions
(INV-MARITIME-JOB-JOURNAL-FX-CONVERSION).

THE GAP: the sales-invoice and expense-voucher journals resolved
their rate through the shared resolver but converted the amount at
hard-coded 2 decimals (Math.round(*100)/100) — so a 3-decimal
tenant's invoice and expense journals were cut to cents at posting
time, and the job totals accumulated from those cut amounts.

THE RULE: both journals convert through convertFxAmount at the base
currency's book digits, on the rate the shared resolver already
returns. The job totals accumulate the converted amount, so they
stay at book digits too.

WHAT THIS PINS, driving the REAL issueJobSalesInvoice and
recordJobExpenseVoucher on PGlite (KWD base, USD live 48.5, a
posting stub that writes real journal rows so the invoice total
aggregation reads them back):
- an invoice of 100.125 USD posts 4856.063 and the job's invoiced
  total becomes 4856.063.
- an expense of 100.125 USD posts 4856.063 and the job's other-costs
  total becomes 4856.063.
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
  const journalCalls: Array<{ lines: Array<{ debit: number; credit: number }> }> = [];
  const postingStub = {
    postDomainJournal: async (trx: any, input: any) => {
      const [row] = await trx
        .insertInto('journal_entries')
        .values({
          tenant_id: input.tenantId,
          status: 'posted',
          entry_date: input.entryDate,
          entry_no: 'JE-TEST',
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
      journalCalls.push(input);
      return id;
    },
  };
  const service = new MaritimeFreightService(db, {} as never, {} as never, postingStub as never);

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE currency_exchange_rate_history (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean, effective_from timestamptz, created_at timestamptz);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, is_active boolean);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, start_date date, end_date date);
      CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, code text, name text, dimension text, is_active boolean, description text);
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, job_number text, customer_name text, customer_id text, status text, cost_center_id text, client_invoiced_total numeric, carrier_cost_total numeric, other_costs_total numeric, net_profit numeric, updated_at timestamptz);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, status text, entry_date timestamptz, entry_no text, source_type text, source_id bigint);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, debit numeric, credit numeric, description text, partner_type text, partner_id bigint, cost_center_id bigint);
      CREATE TABLE maritime_containers (id bigserial PRIMARY KEY, tenant_id text, job_id text);
      CREATE TABLE maritime_job_milestones (id bigserial PRIMARY KEY, tenant_id text, job_id text, occurred_at timestamptz);
      CREATE TABLE maritime_cargo_insurances (id bigserial PRIMARY KEY, tenant_id text, job_id text);
      CREATE TABLE maritime_warehouse_receipts (id bigserial PRIMARY KEY, tenant_id text, job_id text);
      CREATE TABLE maritime_inland_trucking_trips (id bigserial PRIMARY KEY, tenant_id text, job_id text);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',48.5,false);
      -- INV-FX-MARITIME-CLOSE-ASOF: the sales invoice / expense
      -- voucher resolve at their entry moment from the append-only
      -- history (migration 0270 backfill: one row per live rate).
      INSERT INTO currency_exchange_rate_history (tenant_id, currency_code, exchange_rate, is_base, effective_from) VALUES ('t1','USD',48.5,false,'2020-01-01 00:00:00+00');
      INSERT INTO accounting_accounts VALUES (10,'t1','1130',true),(20,'t1','4200',true),(30,'t1','6400',true),(40,'t1','2110',true);
      INSERT INTO accounting_settings VALUES (1,'t1',NULL,NULL,NULL);
      INSERT INTO maritime_jobs VALUES (1,'t1','JOB-1','Acme',NULL,'open',NULL,0,0,0,0,NULL);
    `);

    const invoice = await service.issueJobSalesInvoice(auth, '1', { amount: 100.125, currency: 'USD' });
    assert.equal(journalCalls.length, 1);
    assert.equal(Number(journalCalls[0].lines[0].debit), 4856.063);
    assert.equal(Number(journalCalls[0].lines[1].credit), 4856.063);
    assert.equal(Number((invoice.job as { client_invoiced_total: number }).client_invoiced_total), 4856.063);

    const expense = await service.recordJobExpenseVoucher(auth, '1', {
      amount: 100.125,
      currency: 'USD',
      expenseType: 'other',
    } as never);
    assert.equal(journalCalls.length, 2);
    assert.equal(Number(journalCalls[1].lines[0].debit), 4856.063);
    assert.equal(Number(journalCalls[1].lines[1].credit), 4856.063);
    assert.equal(Number((expense.job as { other_costs_total: number }).other_costs_total), 4856.063);

    console.log('maritime job journal fx conversion checks passed');
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
