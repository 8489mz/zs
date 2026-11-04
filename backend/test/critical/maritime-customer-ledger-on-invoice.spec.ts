/*
 * Maritime customer ledger on invoice (INV-MARITIME-CUSTOMER-LEDGER-ON-INVOICE).
 *
 * THE GAP: issueJobSalesInvoice posted Dr 1130 with a customer
 * partner tag but never wrote customers.balance or customer_ledger
 * (zero references in the whole module). settleJobFromCustomerBalance
 * requires |GL partner sum - customers.balance| <= 0.01, so after
 * any maritime invoice the equality could never hold and the job
 * could never be marked paid from the customer balance.
 *
 * THE RULE: issuing a job sales invoice maintains the customer
 * subledger in the same transaction as its journal, on the sales
 * pattern: customers.balance grows by the posted base-currency
 * amount at book digits, plus one customer_ledger row
 * (entry_type 'sale_credit', reference_type 'maritime_job'). The
 * posted GL partner sum, the ledger sum and customers.balance stay
 * equal after every invoice. No credit-limit/block gating is added:
 * that is a further behavioural choice that was not decided, so
 * issuing never newly blocks on it. A job with no linked customer
 * writes nothing; a linked customer that does not exist fails
 * closed and rolls the journal back. Supplier-ledger writes are
 * NOT added (not decided): the expense-voucher path still writes
 * no customer ledger either.
 *
 * WHAT THIS PINS, driving the REAL issueJobSalesInvoice on PGlite
 * (KWD base, USD live 48.5, a posting stub that writes real journal
 * rows so the GL partner sum reads back):
 * - an invoice of 100.125 USD posts 4856.063, sets
 *   customers.balance to 4856.063, and writes one ledger row with
 *   the same amount and balance_after;
 * - a second invoice accumulates the balance and the ledger sum,
 *   and the GL partner sum still equals the balance exactly;
 * - a job with no customer writes no ledger row and still issues;
 * - a job whose linked customer does not exist is rejected, posts
 *   no journal, and leaves the job totals untouched;
 * - the expense-voucher source writes no customer ledger.
 *
 * HONEST LIMIT: the posting branch is stubbed exactly as in
 * maritime-job-journal-fx-conversion.spec.ts (the stub writes real
 * journal rows; the invoice-total aggregation reads them back).
 * The end-to-end invoice-to-settle run is rehearsal R1 on live
 * Postgres.
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

  async function customerBalance(): Promise<number> {
    const row = await (db as any).selectFrom('customers').select('balance').where('id', '=', 4).executeTakeFirstOrThrow() as any;
    return Number(row.balance);
  }

  async function ledgerRows(): Promise<Array<{ amount: number; balance_after: number; entry_type: string; reference_type: string }>> {
    const rows = await (db.selectFrom('customer_ledger' as never).selectAll() as any).execute() as any[];
    rows.sort((a, b) => Number(a.id) - Number(b.id));
    return rows.map((r) => ({
      amount: Number(r.amount),
      balance_after: Number(r.balance_after),
      entry_type: String(r.entry_type),
      reference_type: String(r.reference_type),
    }));
  }

  async function glPartnerSum(): Promise<number> {
    const rows = await (db as any)
      .selectFrom('journal_entry_lines')
      .selectAll()
      .where('partner_type', '=', 'customer')
      .where('partner_id', '=', 4)
      .execute() as any[];
    return rows.reduce((sum, r) => sum + Number(r.debit || 0) - Number(r.credit || 0), 0);
  }

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, is_active boolean);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, start_date date, end_date date);
      CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, code text, name text, dimension text, is_active boolean, description text);
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, job_number text, customer_name text, customer_id bigint, status text, cost_center_id text, client_invoiced_total numeric, carrier_cost_total numeric, other_costs_total numeric, net_profit numeric, updated_at timestamptz);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, status text, entry_date timestamptz, entry_no text, source_type text, source_id bigint);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, debit numeric, credit numeric, description text, partner_type text, partner_id bigint, cost_center_id bigint);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, balance numeric, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE maritime_containers (id bigserial PRIMARY KEY, tenant_id text, job_id text);
      CREATE TABLE maritime_job_milestones (id bigserial PRIMARY KEY, tenant_id text, job_id text, occurred_at timestamptz);
      CREATE TABLE maritime_cargo_insurances (id bigserial PRIMARY KEY, tenant_id text, job_id text);
      CREATE TABLE maritime_warehouse_receipts (id bigserial PRIMARY KEY, tenant_id text, job_id text);
      CREATE TABLE maritime_inland_trucking_trips (id bigserial PRIMARY KEY, tenant_id text, job_id text);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',48.5,false);
      INSERT INTO accounting_accounts VALUES (10,'t1','1130',true),(20,'t1','4200',true),(30,'t1','6400',true),(40,'t1','2110',true);
      INSERT INTO accounting_settings VALUES (1,'t1',NULL,NULL,NULL);
      INSERT INTO customers VALUES (4,'t1','a1','Acme',0,NULL);
      INSERT INTO maritime_jobs VALUES (1,'t1','JOB-1','Acme',4,'open',NULL,0,0,0,0,NULL);
      INSERT INTO maritime_jobs VALUES (2,'t1','JOB-2','Nobody',NULL,'open',NULL,0,0,0,0,NULL);
      INSERT INTO maritime_jobs VALUES (3,'t1','JOB-3','Ghost',999,'open',NULL,0,0,0,0,NULL);
    `);

    // 1. First invoice: journal, balance and ledger row agree at book digits.
    const first = await service.issueJobSalesInvoice(auth, '1', { amount: 100.125, currency: 'USD' });
    assert.equal(journalCalls.length, 1);
    assert.equal(Number(journalCalls[0].lines[0].debit), 4856.063);
    assert.equal(await customerBalance(), 4856.063);
    assert.deepEqual(await ledgerRows(), [
      { amount: 4856.063, balance_after: 4856.063, entry_type: 'sale_credit', reference_type: 'maritime_job' },
    ]);
    assert.equal(await glPartnerSum(), 4856.063);
    assert.equal(Number((first.job as { client_invoiced_total: number }).client_invoiced_total), 4856.063);

    // 2. Second invoice accumulates; GL, ledger and balance stay equal.
    await service.issueJobSalesInvoice(auth, '1', { amount: 100.125, currency: 'USD' });
    assert.equal(await customerBalance(), 9712.126);
    const rows2 = await ledgerRows();
    assert.equal(rows2.length, 2);
    assert.equal(rows2[1].balance_after, 9712.126);
    assert.equal(
      rows2.reduce((sum, r) => sum + r.amount, 0),
      await customerBalance(),
    );
    assert.equal(await glPartnerSum(), await customerBalance());

    // 3. No linked customer: still issues, writes nothing to the ledger.
    const noCustomer = await service.issueJobSalesInvoice(auth, '2', { amount: 50, currency: 'USD' });
    assert.equal(Number((noCustomer.job as { client_invoiced_total: number }).client_invoiced_total), 2425);
    assert.equal((await ledgerRows()).length, 2);
    assert.equal(await customerBalance(), 9712.126);

    // 4. Linked customer that does not exist: fails closed, no journal
    // row survives (the stub's in-memory push is not the database:
    // the transaction rolls the journal insert back), totals untouched.
    const entriesBefore = await db.selectFrom('journal_entries' as never).selectAll().execute();
    await assert.rejects(
      service.issueJobSalesInvoice(auth, '3', { amount: 50, currency: 'USD' }),
      /العميل المرتبط/,
    );
    const entriesAfter = await db.selectFrom('journal_entries' as never).selectAll().execute();
    assert.equal(entriesAfter.length, entriesBefore.length);
    const ghost = await (db as any).selectFrom('maritime_jobs').selectAll().where('id', '=', 3).executeTakeFirstOrThrow() as any;
    assert.equal(Number(ghost.client_invoiced_total), 0);
    assert.equal((await ledgerRows()).length, 2);

    // 5. Source pin: the invoice path maintains the ledger; the
    // expense-voucher path does not (supplier subledger undecided).
    const source = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight.service.ts'), 'utf8');
    const invoiceStart = source.indexOf('async issueJobSalesInvoice(');
    const expenseStart = source.indexOf('async recordJobExpenseVoucher(');
    const settleStart = source.indexOf('async settleJobFromCustomerBalance(');
    assert.ok(invoiceStart > 0 && expenseStart > invoiceStart && settleStart > expenseStart);
    const invoiceBody = source.slice(invoiceStart, expenseStart);
    assert.ok(invoiceBody.includes('maintainCustomerLedgerForInvoice'));
    assert.ok(invoiceBody.includes("insertInto('customer_ledger')") || source.slice(source.indexOf('async maintainCustomerLedgerForInvoice('), invoiceStart).includes("insertInto('customer_ledger')"));
    const expenseBody = source.slice(expenseStart, settleStart);
    assert.ok(!expenseBody.includes('customer_ledger'));
    assert.ok(!expenseBody.includes('maintainCustomerLedgerForInvoice'));

    console.log('maritime customer ledger on invoice checks passed');
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
