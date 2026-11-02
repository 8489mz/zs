/*
New file: backend/test/critical/import-transfer-approval-binding.spec.ts
Pins the large-transfer approval binding
(INV-IMPORT-TRANSFER-APPROVAL-BINDING).

WHAT WAS WRONG: recordForeignTransfer consumed any approved
large_transfer token without passing expectedDetails, so an approval
for one supplier / proforma / amount ceiling authorized any other
transfer; the >=100,000 threshold compared raw foreign units (100,000
JPY counted as large, 99,999 USD did not); and when the caller
supplied no contract rate the rate was derived from the amounts
themselves (cleanEgp / cleanForeign), which made the realized forex
variance identically zero on every such transfer.

WHAT THIS PINS, driving the real recordForeignTransfer and
createApprovalRequest on PGlite through the real posting boundary:
- An approval bound to PI-A / 1,000 USD / supplier 1 / project 1
  must not authorize a transfer for PI-B, and must not authorize
  2,000 USD against PI-A (amount ceiling).
- A correctly bound approval plus the PI contract rate posts the
  real forex variance (1,000 USD at rate 50, 51,000 EGP paid ->
  1,000 EGP realized loss) instead of a zero variance.
- The threshold is normalised to the tenant base currency through
  resolveFxRate: 200,000 JPY at 0.32 (64,000 base) needs no
  approval, while 200,000 USD without approval is rejected.
- An unlinked transfer with neither a caller rate nor a PI rate
  fails closed with IMPORT_EXCHANGE_RATE_REQUIRED.
- createApprovalRequest validates large_transfer payloads: a
  positive amount ceiling and a 3-letter currency are required, and
  a supplied supplierId must match the reference id.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, account_group text, is_active boolean, is_cash_bank boolean, is_inventory boolean, is_payable boolean, is_receivable boolean, is_tax boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, amount numeric, amount_foreign numeric, note text, created_by bigint, payment_date text, currency text, exchange_rate numeric, forex_variance_egp numeric, proforma_invoice_id text, idempotency_key text, doc_no text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, pi_number text, supplier_id bigint, project_id text, currency text, total_amount_foreign numeric, paid_amount_foreign numeric, exchange_rate_contract numeric, payment_status text);
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES
      ('t1', 'EGP', 1, true),
      ('t1', 'USD', 50, false),
      ('t1', 'JPY', 0.32, false);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
      (25, 't1', 't1', '5190', 'خسائر فروق عملة', 'Forex Loss', 'expense', 'expenses', true, false, false, false, false, false),
      (26, 't1', 't1', '4201', 'أرباح فروق عملة', 'Forex Gain', 'revenue', 'revenues', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES
      (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW()),
      (2, 't1', 't1', 'Supplier B', '', '', 0, true, NOW());
    INSERT INTO import_proforma_invoices VALUES
      ('pi-a', 't1', 'PI-A', 1, 'proj-1', 'USD', 5000, 0, 50, 'open'),
      ('pi-b', 't1', 'PI-B', 1, 'proj-2', 'USD', 5000, 0, 50, 'open');
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function insertApproval(db: Kysely<Database>, id: string, payload: Record<string, unknown>): Promise<void> {
  await db.insertInto('import_approval_requests' as never).values({
    id, tenant_id: 't1', module: 'import', action_type: 'large_transfer',
    reference_id: '1', requested_by: 99, created_by: 99, status: 'approved',
    request_payload: JSON.stringify(payload),
  } as never).execute();
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

const BOUND_PAYLOAD = {
  amount: 1000, currency: 'USD', supplierId: '1',
  proformaInvoiceId: 'pi-a', projectId: 'proj-1',
};

async function transfer(db: Kysely<Database>, service: any, dto: Record<string, unknown>): Promise<any> {
  return service.recordForeignTransfer('t1', 1, {
    supplierId: 1,
    amountEgp: 50000,
    amountForeign: 1000,
    currency: 'USD',
    bankAccountId: 24,
    idempotencyKey: 'key-1',
    ...dto,
  });
}

async function main(): Promise<void> {
  // Case 1: approval for PI-A must not authorize PI-B.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await insertApproval(db, 'appr-1', BOUND_PAYLOAD);
      await assert.rejects(
        async () => transfer(db, service, { proformaInvoiceId: 'pi-b', projectId: 'proj-2', approvalRequestId: 'appr-1', idempotencyKey: 'key-pi-b' }),
        /الفاتورة المبدئية|المشروع/,
        'An approval bound to PI-A/project 1 must not authorize PI-B/project 2',
      );
      assert.equal(await countRows(db, 'supplier_payments'), 0, 'No payment may be written by a rejected transfer');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: approval for 1,000 must not authorize 2,000 (amount ceiling).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await insertApproval(db, 'appr-1', BOUND_PAYLOAD);
      await assert.rejects(
        async () => transfer(db, service, { proformaInvoiceId: 'pi-a', projectId: 'proj-1', amountForeign: 2000, amountEgp: 100000, approvalRequestId: 'appr-1', idempotencyKey: 'key-ceiling' }),
        /المعتمد/,
        'An approval with a 1,000 ceiling must not authorize 2,000',
      );
      assert.equal(await countRows(db, 'supplier_payments'), 0, 'No payment may be written by a rejected transfer');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: correctly bound approval + PI contract rate posts the real variance.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await insertApproval(db, 'appr-1', BOUND_PAYLOAD);
      await transfer(db, service, { proformaInvoiceId: 'pi-a', projectId: 'proj-1', amountForeign: 1000, amountEgp: 51000, approvalRequestId: 'appr-1', idempotencyKey: 'key-ok' });
      const payment: any = await (db as any).selectFrom('supplier_payments').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(payment.forex_variance_egp), 1000, 'Variance is real: 51,000 paid vs 50,000 at the PI contract rate 50');
      assert.equal(Number(payment.amount), -50000, 'Payable relief is at the contract rate');
      const lines: any[] = await (db as any).selectFrom('journal_entry_lines').selectAll().execute();
      const debits = lines.reduce((s, l) => s + Number(l.debit), 0);
      const credits = lines.reduce((s, l) => s + Number(l.credit), 0);
      assert.equal(debits, credits, 'Journal must balance');
      const loss = lines.find((l) => Number(l.account_id) === 25);
      assert.ok(loss, 'A forex loss line must exist');
      assert.equal(Number(loss.debit), 1000, 'Forex loss line is the real 1,000 variance');
      const pi: any = await (db as any).selectFrom('import_proforma_invoices').selectAll().where('id', '=', 'pi-a').executeTakeFirstOrThrow();
      assert.equal(Number(pi.paid_amount_foreign), 1000, 'PI paid amount advances');
      const approval: any = await (db as any).selectFrom('import_approval_requests').selectAll().where('id', '=', 'appr-1').executeTakeFirstOrThrow();
      assert.equal(approval.status, 'executed', 'The approval token is single-use');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: threshold normalised to base currency.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      // 200,000 JPY at 0.32 = 64,000 base: below the threshold, no approval needed.
      await transfer(db, service, { currency: 'JPY', amountForeign: 200000, amountEgp: 64000, exchangeRateContract: 0.32, idempotencyKey: 'key-jpy' });
      assert.equal(await countRows(db, 'supplier_payments'), 1, 'The sub-threshold JPY transfer must succeed without approval');
      // 200,000 USD = 10,000,000 base: approval required.
      await assert.rejects(
        async () => transfer(db, service, { amountForeign: 200000, amountEgp: 10000000, exchangeRateContract: 50, idempotencyKey: 'key-usd-big' }),
        /اعتماداً ثنائياً/,
        'A 200,000 USD transfer without approval must be rejected',
      );
      assert.equal(await countRows(db, 'supplier_payments'), 1, 'The rejected transfer must not write a payment');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: unlinked transfer with no rate anywhere fails closed.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await assert.rejects(
        async () => transfer(db, service, { amountForeign: 100, amountEgp: 5000, idempotencyKey: 'key-norate' }),
        /IMPORT_EXCHANGE_RATE_REQUIRED/,
        'No caller rate and no PI rate must fail closed instead of deriving a zero-variance rate',
      );
      assert.equal(await countRows(db, 'supplier_payments'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 6: createApprovalRequest validates large_transfer payloads.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await assert.rejects(
        async () => service.createApprovalRequest('t1', 1, { actionType: 'large_transfer', referenceId: '1', requestPayload: { amount: 1000 } }),
        /عملة صالحة/,
        'A large_transfer approval without a currency must be rejected at creation',
      );
      await assert.rejects(
        async () => service.createApprovalRequest('t1', 1, { actionType: 'large_transfer', referenceId: '1', requestPayload: { amount: 0, currency: 'USD' } }),
        /سقف مبلغ موجب/,
        'A large_transfer approval without a positive ceiling must be rejected at creation',
      );
      await assert.rejects(
        async () => service.createApprovalRequest('t1', 1, { actionType: 'large_transfer', referenceId: '1', requestPayload: { amount: 1000, currency: 'USD', supplierId: '2' } }),
        /مطابقة المورد/,
        'A large_transfer approval whose supplier does not match the reference must be rejected at creation',
      );
      const created = await service.createApprovalRequest('t1', 1, { actionType: 'large_transfer', referenceId: '1', requestPayload: BOUND_PAYLOAD });
      assert.equal(created.status, 'pending', 'A well-formed large_transfer approval is created pending');
      assert.equal(await countRows(db, 'import_approval_requests'), 1, 'Only the valid approval is stored');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import transfer approval binding tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
