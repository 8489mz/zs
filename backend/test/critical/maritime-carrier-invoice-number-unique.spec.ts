/*
New file: backend/test/critical/maritime-carrier-invoice-number-unique.spec.ts
Pins INV-MARITIME-CARRIER-INVOICE-NUMBER-UNIQUE.

THE GAP: maritime_carrier_invoices has NO unique constraint on
invoice_number, and the createCarrierInvoice comment claimed a
"duplicate invoice_number constraint violation" would roll the
transaction back -- no such constraint exists in migration 0125.
Entering the same carrier invoice number twice posted a second
journal and doubled the carrier cost on the job, with two invoice
rows to explain nothing.

THE RULE: createCarrierInvoice rejects a number already used for the
same effective shipping line (DTO line, else the job's line) before
any journal is posted, serialised by an advisory lock on
(tenant, normalised number). A different shipping line may
legitimately reuse a number; case and surrounding whitespace do not
make a number different.

WHAT THIS PINS, driving the REAL createCarrierInvoice on PGlite
(KWD base, USD live 48.5, stubbed posting service):
- the first invoice saves one invoice row with audit_status
  'overcharge' (invoiced 200 against a contracted 100) and posts no
  journal, exactly as the maker-checker rule requires;
- the same number for the same line is rejected, with zero extra
  invoice rows and the job totals untouched;
- the same number for a different line succeeds;
- the same number in different case/whitespace is rejected.

HONEST LIMIT: the cases run the overcharge (no-journal) branch on
purpose. postCarrierInvoiceJournal reads accounting_accounts and the
FX resolver through this.db from inside the service's own
transaction, and the PGlite dialect serialises all access to one
connection, so a db read inside an open transaction never returns on
PGlite (proven by repro: a db query inside db.transaction() hangs
and the process exits 0 silently). The guard is the FIRST statement
of the same transaction and precedes the posting branch, so the
posting branch cannot run before the guard on any path; the journal
internals themselves are pinned by
maritime-carrier-invoice-fx-conversion.spec.ts. The posting-branch
duplicate rejection is rehearsal R2 on live Postgres (see the
grounding note).
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
  const calls: Array<{ sourceType: string; lines: Array<{ debit: number; credit: number }> }> = [];
  const postingStub = {
    postDomainJournal: async (_trx: unknown, input: { sourceType: string; lines: Array<{ debit: number; credit: number }> }) => {
      calls.push({ sourceType: input.sourceType, lines: input.lines });
      return 900;
    },
  };
  const service = new MaritimeFreightService(db, {} as never, {} as never, postingStub as never);

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, is_active boolean);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, start_date date, end_date date);
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, job_number text, status text, shipping_line_id bigint, shipping_line_name text, pol_code text, pod_code text, customer_id bigint, cost_center_id bigint, carrier_cost_total numeric, client_invoiced_total numeric, other_costs_total numeric, net_profit numeric, updated_at timestamptz);
      CREATE TABLE maritime_containers (id bigint PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_job_milestones (id bigint PRIMARY KEY, tenant_id text, job_id bigint, occurred_at timestamptz);
      CREATE TABLE maritime_cargo_insurances (id bigint PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_warehouse_receipts (id bigint PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_inland_trucking_trips (id bigint PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_rate_cards (id bigint PRIMARY KEY, tenant_id text, pol_code text, pod_code text, status text, currency text, valid_from date, valid_until date, shipping_line_id bigint, container_type text, total_freight_cost numeric);
      CREATE TABLE maritime_carrier_invoices (id bigserial PRIMARY KEY, tenant_id text, job_id bigint, shipping_line_id bigint, carrier_name text, invoice_number text, invoice_date date, currency text, total_invoiced_amount numeric, ocean_freight numeric, thc_charges numeric, baf_charges numeric, detention_demurrage numeric, other_charges numeric, rate_card_id bigint, contracted_amount numeric, variance_amount numeric, variance_pct numeric, audit_status text, override_approved_by bigint, override_approved_at timestamptz, override_reason text, journal_entry_id bigint, payment_status text, notes text, created_by bigint);
      CREATE TABLE shipping_lines (id bigint PRIMARY KEY, tenant_id text);
      CREATE TABLE suppliers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, notes text, is_active boolean);
      CREATE TABLE accounting_supplier_links (tenant_id text, domain text, domain_id text, supplier_id bigint);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',48.5,false),('t1','EGP',1,false);
      INSERT INTO accounting_accounts VALUES (30,'t1','6400',true),(40,'t1','2110',true);
      INSERT INTO accounting_settings VALUES (1,'t1',NULL,NULL,NULL);
      INSERT INTO shipping_lines VALUES (9,'t1'),(10,'t1');
      INSERT INTO maritime_jobs VALUES (1,'t1','JOB-1','booked',9,'Line','AEDXB','EGALY',NULL,NULL,0,10000,0,10000,NULL);
      INSERT INTO maritime_rate_cards (id, tenant_id, pol_code, pod_code, status, currency, valid_from, valid_until, shipping_line_id, container_type, total_freight_cost) VALUES (1,'t1','AEDXB','EGALY','active','USD','2020-01-01','2099-01-01',9,'40HC',100),(2,'t1','AEDXB','EGALY','active','USD','2020-01-01','2099-01-01',10,'40HC',100);
    `);

    const dto = (invoiceNumber: string, shippingLineId?: number) => ({
      invoiceNumber,
      totalInvoicedAmount: 200,
      currency: 'USD',
      exchangeRate: 48.5,
      shippingLineId,
      carrierName: 'Line',
    });

    // 1. First invoice for line 9 saves as an overcharge and posts no journal.
    const first = await service.createCarrierInvoice(auth, '1', dto('MSCU-100', 9));
    assert.equal(first.success, true);
    assert.equal(first.invoice.audit_status, 'overcharge');
    assert.equal(calls.length, 0);

    // 2. Same number, same line: rejected, nothing saved, totals untouched.
    await assert.rejects(
      service.createCarrierInvoice(auth, '1', dto('MSCU-100', 9)),
      /مستخدم من قبل/,
    );
    assert.equal(calls.length, 0);
    const jobAfterDup = await db.selectFrom('maritime_jobs' as any).selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
    assert.equal(Number((jobAfterDup as any).carrier_cost_total), 0);
    const rowsAfterDup = await db.selectFrom('maritime_carrier_invoices' as any).selectAll().execute();
    assert.equal(rowsAfterDup.length, 1);

    // 3. Same number, different line: succeeds (per-line uniqueness).
    const otherLine = await service.createCarrierInvoice(auth, '1', dto('MSCU-100', 10));
    assert.equal(otherLine.success, true);
    assert.equal(otherLine.invoice.audit_status, 'overcharge');
    assert.equal(calls.length, 0);

    // 4. Same number, different case/whitespace, line inherited from the job: rejected.
    await assert.rejects(
      service.createCarrierInvoice(auth, '1', dto('  mscu-100  ')),
      /مستخدم من قبل/,
    );
    assert.equal(calls.length, 0);
    const rowsAfterCase = await db.selectFrom('maritime_carrier_invoices' as any).selectAll().execute();
    assert.equal(rowsAfterCase.length, 2);

    console.log('maritime carrier invoice number uniqueness checks passed');
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
