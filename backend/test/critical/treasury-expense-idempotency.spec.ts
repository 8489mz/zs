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
  CREATE TABLE expenses (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, title TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL DEFAULT 0, expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(), note TEXT NOT NULL DEFAULT '', branch_id BIGINT NULL, location_id BIGINT NULL, cost_center_id BIGINT NULL, created_by BIGINT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), tenant_id TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL DEFAULT '', request_key TEXT NULL);
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
  .then(() => console.log('treasury expense idempotency checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
