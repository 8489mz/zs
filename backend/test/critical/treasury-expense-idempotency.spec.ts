/*
New file: backend/test/critical/treasury-expense-idempotency.spec.ts
Pins INV-TREASURY-EXPENSE-IDEMPOTENCY: a mandatory client-supplied
requestKey deduplicates retried expense posts, mirroring the transfer
sibling (createTransfer), and a post-commit audit-log failure never
turns a committed expense into an error response (which would invite
the double-posting retry).

WHAT THE AUDIT FEARED: createExpense had no idempotency key at all, so
a retried POST /api/expenses created a second expense, a second
treasury transaction, and a second journal. And the unguarded
audit.log call AFTER the commit meant an audit failure surfaced as an
error although the money was already posted -- the client retries, and
the retry double-posts.

WHAT THIS PINS, driving the REAL createExpense on PGlite:
1. Same key twice -> one expense, one treasury transaction, one journal;
   the second call returns ok:true with the original listing.
2. Same key with a different amount -> 409 EXPENSE_IDEMPOTENCY_CONFLICT
   and still one expense.
3. A missing key and a 7-character key -> 400
   EXPENSE_REQUEST_KEY_REQUIRED; an 8-character key is accepted.
4. A throwing audit.log still returns success with the expense and its
   journal committed (the audit collaborator is shadowed on the service
   instance for this case only, because the failure is injected).
5. The real migration up() on a pre-migration expenses table: adds the
   nullable request_key column and the partial unique index, allows
   duplicate NULL keys (legacy rows), rejects a duplicate non-null key
   per tenant, and is idempotent on re-run.

Deliberately NOT driven here: concurrent same-key requests racing each
other (PGlite is single-connection; the FOR UPDATE + advisory period
lock serialization is the transfer sibling's proven pattern, mirrored
here, and the partial unique index is the backstop). The frontend
expense form sends no key today -- see the invariant note; that is a
separate frontend follow-up, not silently widened into this package.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { TreasuryService } from '../../src/modules/treasury/treasury.service';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { migration as expenseKeyMigration } from '../../src/database/migrations/2040000000272_expense_request_key';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;
const DATE = '2026-10-31T10:00:00.000Z';

async function countExpenses(db: Kysely<Database>): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM expenses`.execute(db);
  return Number(rows.rows[0].n);
}

async function countJournals(db: Kysely<Database>): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM journal_entries WHERE source_type = 'expense'`.execute(db);
  return Number(rows.rows[0].n);
}

async function countTxns(db: Kysely<Database>): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM treasury_transactions WHERE reference_type = 'expense'`.execute(db);
  return Number(rows.rows[0].n);
}

const DDL = `
  CREATE TABLE tenants (id text PRIMARY KEY);
  INSERT INTO tenants VALUES ('t1');
  CREATE TABLE settings (tenant_id text, key text, value text);
  CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
  INSERT INTO settings VALUES ('t1','currency','EGP');
  INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
  CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', normal_balance text, is_active boolean DEFAULT true, is_tax boolean DEFAULT false, is_system boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
  CREATE UNIQUE INDEX idx_accounting_accounts_tenant_code_uidx ON accounting_accounts (tenant_id, code);
  INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type, allow_manual_entries) VALUES (1110,'t1','a1','1110','asset',true), (6900,'t1','a1','6900','expense',true);
  CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
  INSERT INTO accounting_settings VALUES (1,'t1','a1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,6900,NULL,NULL,NULL);
  CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
  CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
  CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
  CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
  CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
  INSERT INTO branches VALUES (1, 't1', 'Main', 1);
  CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
  INSERT INTO stock_locations VALUES (1, 't1', 'a1', 1, 'Main Store', 'MAIN', true, 'branch_stock');
  CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
  INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', '', '', true);
  CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
  CREATE TABLE expenses (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, title TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL DEFAULT 0, expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(), note TEXT NOT NULL DEFAULT '', branch_id BIGINT NULL, location_id BIGINT NULL, cost_center_id BIGINT NULL, created_by BIGINT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), tenant_id TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL DEFAULT '', request_key TEXT NULL, cancelled_at TIMESTAMPTZ NULL, cancelled_by BIGINT NULL, cancel_reason TEXT NULL);
  CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, payment_channel text, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
  CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
`;

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const audit = new AuditService(db as never);
  const service = new TreasuryService(db as never, new TransactionHelper(), audit, posting);

  try {
    await pg.exec(DDL);
    const payload = { title: 'Office supplies', amount: 100, note: 'pens', date: DATE, requestKey: 'expense-key-001' };

    // Case 1: same key twice -> one expense, one transaction, one journal.
    const first = await service.createExpense({ ...payload } as never, AUTH);
    assert.equal(first.ok, true);
    assert.equal(await countExpenses(db), 1);
    assert.equal(await countTxns(db), 1);
    assert.equal(await countJournals(db), 1);
    const second = await service.createExpense({ ...payload } as never, AUTH);
    assert.equal(second.ok, true);
    assert.equal(await countExpenses(db), 1);
    assert.equal(await countTxns(db), 1);
    assert.equal(await countJournals(db), 1);

    // Case 2: same key, different amount -> 409, still one expense.
    await assert.rejects(
      service.createExpense({ ...payload, amount: 200 } as never, AUTH),
      (err: any) => err && err.code === 'EXPENSE_IDEMPOTENCY_CONFLICT' && err.statusCode === 409,
    );
    assert.equal(await countExpenses(db), 1);
    assert.equal(await countJournals(db), 1);

    // Case 3: missing key and 7-char key rejected; 8-char key accepted.
    await assert.rejects(
      service.createExpense({ title: 'X', amount: 5, date: DATE } as never, AUTH),
      (err: any) => err && err.code === 'EXPENSE_REQUEST_KEY_REQUIRED' && err.statusCode === 400,
    );
    await assert.rejects(
      service.createExpense({ title: 'X', amount: 5, date: DATE, requestKey: 'short77' } as never, AUTH),
      (err: any) => err && err.code === 'EXPENSE_REQUEST_KEY_REQUIRED' && err.statusCode === 400,
    );
    const eight = await service.createExpense({ title: 'X', amount: 5, date: DATE, requestKey: 'eight888' } as never, AUTH);
    assert.equal(eight.ok, true);
    assert.equal(await countExpenses(db), 2);

    // Case 4: audit failure after commit still returns success.
    (service as any).audit = { log: async () => { throw new Error('audit store down'); } };
    const third = await service.createExpense({ title: 'Audit proof', amount: 7, date: DATE, requestKey: 'expense-key-002' } as never, AUTH);
    assert.equal(third.ok, true);
    assert.equal(await countExpenses(db), 3);
    assert.equal(await countJournals(db), 3);
  } finally {
    await db.destroy();
  }

  // Case 5: the real migration on a pre-migration schema.
  const pg2 = new PGlite();
  const db2 = new Kysely<Database>({ dialect: new PGliteDialect(pg2) });
  try {
    await pg2.exec(`
      CREATE TABLE expenses (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, title TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL DEFAULT 0, expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(), note TEXT NOT NULL DEFAULT '', branch_id BIGINT NULL, location_id BIGINT NULL, cost_center_id BIGINT NULL, created_by BIGINT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), tenant_id TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL DEFAULT '');
    `);
    await expenseKeyMigration.up(db2 as never);
    const cols = await sql<{ column_name: string }>`SELECT column_name FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'request_key'`.execute(db2);
    assert.equal(cols.rows.length, 1);
    // Legacy rows without a key keep working: duplicate NULLs allowed.
    await sql`INSERT INTO expenses (title, amount, tenant_id, account_id) VALUES ('legacy', 1, 't1', 'a1'), ('legacy', 2, 't1', 'a1')`.execute(db2);
    await sql`INSERT INTO expenses (title, amount, tenant_id, account_id, request_key) VALUES ('keyed', 3, 't1', 'a1', 'dup-key-001')`.execute(db2);
    await assert.rejects(
      sql`INSERT INTO expenses (title, amount, tenant_id, account_id, request_key) VALUES ('keyed-again', 4, 't1', 'a1', 'dup-key-001')`.execute(db2),
    );
    // Same key under a different tenant is allowed.
    await sql`INSERT INTO expenses (title, amount, tenant_id, account_id, request_key) VALUES ('other-tenant', 5, 't2', 'a1', 'dup-key-001')`.execute(db2);
    // Re-running the migration is a no-op.
    await expenseKeyMigration.up(db2 as never);
  } finally {
    await db2.destroy();
  }
}

main()
  .then(() => mainCancel())
  .then(() => console.log('treasury expense idempotency checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/*
 * INV-EXPENSE-CANCEL-REVERSAL: a posted expense (trial G04, 100 cash,
 * JE-00015214) could not be cancelled at all -- no cancel path existed,
 * the drawer was never restored and the journal was never reversed.
 * This section drives the REAL TreasuryService.cancelExpense on PGlite
 * plus the REAL CashDrawerService shift math, and proves:
 * 1. Cancel posts a REVERSING journal (never deletes the posted one):
 *    source_type 'expense_reversal', Dr cash 1110 / Cr expense account
 *    6900 for exactly the expense amount, reversal_of_entry_id = the
 *    original entry id, and the original entry is stamped
 *    reversed_by_entry_id (the REVERSAL_LINKS bidirectional link).
 * 2. A compensating treasury row of +amount restores the drawer cash
 *    (net treasury for the expense is 0), and the expense row carries
 *    the cancelled marker (cancelled_at / cancelled_by).
 * 3. The close-screen disbursed total drops by exactly the amount:
 *    computeShiftExpensesTotal -- the expensesTotal component of
 *    "إجمالي المنصرف من الدرج" -- goes 100 -> 0, and the full
 *    computeShiftExpectedCashFromShift rises -100 -> 0. A +amount
 *    treasury row alone could NOT do this: the shift-movement query
 *    only reads reference_type 'cashier_shift' rows, so the close
 *    query itself must exclude cancelled expenses.
 * 4. A second cancel is idempotent: ok + alreadyCancelled, the same
 *    reversal entry id, no second journal, no second treasury row.
 * 5. Cancelling a missing expense rejects EXPENSE_NOT_FOUND (404).
 * 6. The real 0322 migration on a pre-migration expenses table adds
 *    the cancelled marker columns, leaves legacy rows untouched, and
 *    is idempotent on re-run.
 *
 * The harness DDL already carries the post-migration columns (as the
 * production schema does after 0322); the migration itself is proven
 * separately in step 6 on a pre-migration table, exactly as case 5
 * proves the request_key migration.
 */

const CANCEL_DDL = `
  CREATE TABLE tenants (id text PRIMARY KEY);
  INSERT INTO tenants VALUES ('t1');
  CREATE TABLE settings (tenant_id text, key text, value text);
  CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
  INSERT INTO settings VALUES ('t1','currency','EGP');
  INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
  CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', normal_balance text, is_active boolean DEFAULT true, is_tax boolean DEFAULT false, is_system boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
  CREATE UNIQUE INDEX idx_accounting_accounts_tenant_code_uidx ON accounting_accounts (tenant_id, code);
  INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type, allow_manual_entries) VALUES (1110,'t1','a1','1110','asset',true), (6900,'t1','a1','6900','expense',true);
  CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
  INSERT INTO accounting_settings VALUES (1,'t1','a1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,6900,NULL,NULL,NULL);
  CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
  CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
  CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
  CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
  CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
  INSERT INTO branches VALUES (1, 't1', 'Main', 1);
  CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
  INSERT INTO stock_locations VALUES (1, 't1', 'a1', 1, 'Main Store', 'MAIN', true, 'branch_stock');
  CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
  INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', '', '', true);
  CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
  CREATE TABLE expenses (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, title TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL DEFAULT 0, expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(), note TEXT NOT NULL DEFAULT '', branch_id BIGINT NULL, location_id BIGINT NULL, cost_center_id BIGINT NULL, created_by BIGINT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), tenant_id TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL DEFAULT '', request_key TEXT NULL, cancelled_at TIMESTAMPTZ NULL, cancelled_by BIGINT NULL, cancel_reason TEXT NULL);
  CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, payment_channel text, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
  CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
  CREATE TABLE services (id bigint PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric);
  CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_by bigint, created_at timestamptz, branch_id bigint, location_id bigint, total numeric, paid_amount numeric, payment_type text, payment_channel text, collection_status text, delivery_fee numeric, delivery_fee_mode text, tip_amount numeric);
  CREATE TABLE sale_payments (id bigint PRIMARY KEY, tenant_id text, sale_id bigint, payment_channel text, amount numeric);
  CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, return_type text, created_by bigint, created_at timestamptz, branch_id bigint, location_id bigint, total numeric, settlement_mode text, refund_method text, refund_allocations jsonb);
  CREATE TABLE supplier_payments (id bigint PRIMARY KEY, tenant_id text, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric);
  CREATE TABLE customer_payments (id bigint PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric);
  CREATE TABLE cashier_shifts (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, location_id bigint, opened_by bigint, opening_cash numeric, expected_cash numeric, counted_cash numeric, status text, created_at timestamptz, closed_at timestamptz, closed_by bigint, variance numeric, close_note text, doc_no text);
`;

async function mainCancel(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const audit = new AuditService(db as never);
  const service = new TreasuryService(db as never, new TransactionHelper(), audit, posting);
  const drawer = new CashDrawerService(db as never, new TransactionHelper(), posting as never);
  const shift = {
    id: 1, tenant_id: 't1', branch_id: null, location_id: null, opened_by: 1,
    opening_cash: 0, created_at: new Date('2026-01-01T00:00:00.000Z'), closed_at: null, status: 'open',
  };

  try {
    await pg.exec(CANCEL_DDL);

    // Trial G04 shape: a 100 cash expense posted by the shift opener.
    const created = await service.createExpense({ title: 'Trial G04 supplies', amount: 100, note: 'trial', date: DATE, requestKey: 'expense-cancel-001' } as never, AUTH);
    assert.equal(created.ok, true);
    // createExpense returns the refreshed list, not the id: read it back.
    const idRows = await sql<{ id: number }>`SELECT id FROM expenses WHERE tenant_id = 't1' AND request_key = 'expense-cancel-001'`.execute(db);
    const expenseId = Number(idRows.rows[0]?.id || 0);
    assert.ok(expenseId > 0);
    const originalRows = await sql<{ id: number }>`SELECT id FROM journal_entries WHERE tenant_id = 't1' AND source_type = 'expense' AND source_id = ${expenseId} AND status = 'posted'`.execute(db);
    assert.equal(originalRows.rows.length, 1);
    const originalId = Number(originalRows.rows[0].id);

    // The original journal is Dr expense 6900 / Cr cash 1110.
    const originalLines = await sql<{ account_id: number; debit: string; credit: string }>`SELECT account_id, debit, credit FROM journal_entry_lines WHERE journal_entry_id = ${originalId} ORDER BY id ASC`.execute(db);
    assert.equal(originalLines.rows.length, 2);
    assert.equal(Number(originalLines.rows[0].account_id), 6900);
    assert.equal(Number(originalLines.rows[0].debit), 100);
    assert.equal(Number(originalLines.rows[1].account_id), 1110);
    assert.equal(Number(originalLines.rows[1].credit), 100);

    // Disbursed total before cancel: the expense counts in the shift.
    assert.equal(await (drawer as any).computeShiftExpensesTotal(shift, AUTH), 100);
    assert.equal(await (drawer as any).computeShiftExpectedCashFromShift(shift, AUTH), -100);

    // Cancel once.
    const cancelled = await (service as any).cancelExpense(expenseId, { reason: 'trial G04 duplicate' }, AUTH);
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.alreadyCancelled, false);
    const reversalId = Number(cancelled.journalEntryId || 0);
    assert.ok(reversalId > 0);
    assert.notEqual(reversalId, originalId);

    // The reversing journal mirrors the original: Dr cash 1110 / Cr expense 6900,
    // linked back to the original entry id.
    const reversalRows = await sql<{ id: number; reversal_of_entry_id: number; status: string }>`SELECT id, reversal_of_entry_id, status FROM journal_entries WHERE tenant_id = 't1' AND source_type = 'expense_reversal' AND source_id = ${expenseId}`.execute(db);
    assert.equal(reversalRows.rows.length, 1);
    assert.equal(Number(reversalRows.rows[0].id), reversalId);
    assert.equal(Number(reversalRows.rows[0].reversal_of_entry_id), originalId);
    assert.equal(reversalRows.rows[0].status, 'posted');
    const reversalLines = await sql<{ account_id: number; debit: string; credit: string }>`SELECT account_id, debit, credit FROM journal_entry_lines WHERE journal_entry_id = ${reversalId} ORDER BY id ASC`.execute(db);
    assert.equal(reversalLines.rows.length, 2);
    // Mirrored in source-line order: the 6900 line now credits, the
    // 1110 line now debits. Assert by account, not by position.
    const byAccount = new Map(reversalLines.rows.map((r) => [Number(r.account_id), r]));
    assert.equal(Number(byAccount.get(1110)!.debit), 100);
    assert.equal(Number(byAccount.get(1110)!.credit), 0);
    assert.equal(Number(byAccount.get(6900)!.credit), 100);
    assert.equal(Number(byAccount.get(6900)!.debit), 0);

    // The original entry is stamped as reversed by the reversal entry.
    const stamped = await sql<{ reversed_by_entry_id: number }>`SELECT reversed_by_entry_id FROM journal_entries WHERE id = ${originalId}`.execute(db);
    assert.equal(Number(stamped.rows[0].reversed_by_entry_id), reversalId);

    // The posted journal is never deleted: both entries still exist.
    const kept = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id = 't1' AND source_id = ${expenseId} AND source_type IN ('expense', 'expense_reversal')`.execute(db);
    assert.equal(Number(kept.rows[0].n), 2);

    // Compensating treasury row of +100: the drawer cash is restored,
    // net treasury for the expense is exactly 0.
    const treasuryRows = await sql<{ txn_type: string; amount: string; reference_type: string }>`SELECT txn_type, amount, reference_type FROM treasury_transactions WHERE tenant_id = 't1' AND reference_id = ${expenseId} ORDER BY id ASC`.execute(db);
    assert.equal(treasuryRows.rows.length, 2);
    assert.equal(Number(treasuryRows.rows[0].amount), -100);
    assert.equal(treasuryRows.rows[1].reference_type, 'expense_reversal');
    assert.equal(Number(treasuryRows.rows[1].amount), 100);

    // The expense row carries the cancelled marker.
    const expenseRow = await sql<{ cancelled_at: string | null; cancelled_by: number | null; cancel_reason: string | null }>`SELECT cancelled_at, cancelled_by, cancel_reason FROM expenses WHERE id = ${expenseId}`.execute(db);
    assert.ok(expenseRow.rows[0].cancelled_at);
    assert.equal(Number(expenseRow.rows[0].cancelled_by), 1);
    assert.equal(expenseRow.rows[0].cancel_reason, 'trial G04 duplicate');

    // Disbursed total drops by exactly the amount; expected cash is restored.
    assert.equal(await (drawer as any).computeShiftExpensesTotal(shift, AUTH), 0);
    assert.equal(await (drawer as any).computeShiftExpectedCashFromShift(shift, AUTH), 0);

    // Second cancel is idempotent: same reversal, no second journal, no second row.
    const again = await (service as any).cancelExpense(expenseId, { reason: 'trial G04 duplicate' }, AUTH);
    assert.equal(again.ok, true);
    assert.equal(again.alreadyCancelled, true);
    assert.equal(Number(again.journalEntryId), reversalId);
    const reversalCount = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id = 't1' AND source_type = 'expense_reversal' AND source_id = ${expenseId}`.execute(db);
    assert.equal(Number(reversalCount.rows[0].n), 1);
    const treasuryCount = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM treasury_transactions WHERE tenant_id = 't1' AND reference_id = ${expenseId}`.execute(db);
    assert.equal(Number(treasuryCount.rows[0].n), 2);

    // Cancelling a missing expense rejects 404.
    await assert.rejects(
      (service as any).cancelExpense(999999, { reason: 'no such expense' }, AUTH),
      (err: any) => err && err.code === 'EXPENSE_NOT_FOUND' && err.statusCode === 404,
    );
  } finally {
    await db.destroy();
  }

  // The real 0322 migration on a pre-migration expenses table.
  const pg2 = new PGlite();
  const db2 = new Kysely<Database>({ dialect: new PGliteDialect(pg2) });
  try {
    await pg2.exec(`
      CREATE TABLE expenses (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, title TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL DEFAULT 0, expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(), note TEXT NOT NULL DEFAULT '', branch_id BIGINT NULL, location_id BIGINT NULL, cost_center_id BIGINT NULL, created_by BIGINT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), tenant_id TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL DEFAULT '', request_key TEXT NULL);
      INSERT INTO expenses (title, amount, tenant_id, account_id) VALUES ('legacy', 50, 't1', 'a1');
    `);
    // Variable path on purpose: a literal import would fail compilation
    // on the pristine base (no migration file yet) and hide the real
    // RED -- the missing cancelExpense method -- behind a TS2307.
    const migrationPath = '../../src/database/migrations/2040000000322_expense_cancel_marker';
    const { migration: cancelMigration } = await import(migrationPath);
    await cancelMigration.up(db2 as never);
    const cols = await sql<{ column_name: string }>`SELECT column_name FROM information_schema.columns WHERE table_name = 'expenses' AND column_name IN ('cancelled_at', 'cancelled_by', 'cancel_reason')`.execute(db2);
    assert.equal(cols.rows.length, 3);
    // Legacy rows keep working untouched: no marker, still countable.
    const legacy = await sql<{ cancelled_at: string | null; amount: string }>`SELECT cancelled_at, amount FROM expenses WHERE title = 'legacy'`.execute(db2);
    assert.equal(legacy.rows.length, 1);
    assert.equal(legacy.rows[0].cancelled_at, null);
    assert.equal(Number(legacy.rows[0].amount), 50);
    // Re-running the migration is a no-op.
    await cancelMigration.up(db2 as never);
  } finally {
    await db2.destroy();
  }
  console.log('treasury expense cancel checks passed');
}
