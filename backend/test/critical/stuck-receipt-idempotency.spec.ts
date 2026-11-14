/*
 * INV-REP-NONCASH-EVIDENCE-GATE (PD1) + STUCK-RECEIPT deadlock:
 * a non-cash customer receipt without a transfer reference was refused
 * BEFORE reserveOperation and OUTSIDE the try block, so no
 * operation_executions row ever existed. The frontend helper stores
 * its attempt in localStorage before the POST and only releases it
 * when the server status is 'failed'; a 'not_found' answer released
 * nothing, and the pre-flight body-diff check fired before the status
 * query at all. The same data re-failed the gate forever, and
 * corrected data hit the stuck warning forever (trial T24: a 200.00
 * InstaPay collection could never be recorded; T27/T28 never attempted).
 *
 * THE FIX (this package):
 * - the gate runs AFTER reserveOperation and INSIDE the try, so a 4xx
 *   rejection writes a 'failed' row via the existing catch and the
 *   frontend 'failed' branch releases the stored attempt;
 * - the frontend helper treats server status 'not_found' after a
 *   failed POST as "nothing was reserved — safe to release", and
 *   asks the server about a stored attempt BEFORE comparing bodies.
 *
 * WHAT THIS PINS, driving the REAL PurchasesWriteService on PGlite
 * (fresh database per case):
 * - an InstaPay receipt without a reference, sent with an idempotency
 *   key, is refused with NONCASH_RECEIPT_REFERENCE_REQUIRED AND
 *   leaves a 'failed' operation_executions row carrying that error
 *   code (RED on the unfixed code: no row exists at all);
 * - a retry with the SAME key and SAME payload is answered
 *   PAYMENT_IDEMPOTENCY_FAILED from the stored failed row — the
 *   server state the frontend 'failed' branch clears on;
 * - a corrected retry with a FRESH key and a reference succeeds and
 *   posts Dr 1120 / Cr 1130 (the failed row poisons nothing else);
 * - a cash receipt with a key still succeeds and commits its row.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { PurchasesFinanceService } from '../../src/modules/purchases/services/purchases-finance.service';
import { PurchasesQueryService } from '../../src/modules/purchases/services/purchases-query.service';
import { PurchasesWriteService } from '../../src/modules/purchases/services/purchases-write.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

const ADMIN = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['purchases'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric, payment_channel text, instapay_address text, transfer_reference text, transfer_receipt_url text, note text, branch_id bigint, location_id bigint, job_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, customer_id bigint, job_number text, client_invoiced_total numeric, client_paid_total numeric, payment_status text, status text);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, request_hash text, error_code text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), completed_at timestamptz);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  for (const [id, code] of [
    [1110, '1110'], [1120, '1120'], [1130, '1130'], [2110, '2110'],
  ] as Array<[number, string]>) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, is_active: true }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, supplier_payable_account_id: 2110,
  }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('customers').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'عميل اختبار', phone: '010',
    balance: 500, credit_limit: 0, is_credit_blocked: false, store_credit_balance: 0,
    loyalty_points: 0, is_active: true,
  }).execute();
}

function buildWriteService(db: Kysely<Database>): PurchasesWriteService {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const finance = new PurchasesFinanceService();
  const query = new PurchasesQueryService(db);
  const idempotency = new IdempotencyService(db);
  const tx = new TransactionHelper();
  const audit = new AuditService(db);
  return new PurchasesWriteService(db, tx, audit, finance, query, posting, idempotency);
}

async function findOperation(db: Kysely<Database>, key: string): Promise<any | undefined> {
  const anyDb = db as any;
  return anyDb.selectFrom('operation_executions')
    .select(['status', 'error_code', 'document_id'])
    .where('tenant_id', '=', TENANT)
    .where('account_id', '=', ACCOUNT)
    .where('idempotency_key', '=', key)
    .where('operation_type', '=', 'customer_payment_create')
    .executeTakeFirst();
}

async function main(): Promise<void> {
  // 1. A refused InstaPay receipt WITH an idempotency key leaves a
  // 'failed' operation row carrying the gate error code — the server
  // state the frontend 'failed' branch clears the stored attempt on.
  // RED on the unfixed code: the gate threw before reserveOperation,
  // so no row exists and findOperation returns undefined.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const write = buildWriteService(db);
      const key = 'stuck-receipt-key-1';
      await assert.rejects(
        () => write.createCustomerPayment(
          { customerId: 1, amount: 200, paymentChannel: 'instapay', instapayAddress: 'sara@instapay' } as any,
          ADMIN,
          key,
        ),
        (err: any) => err.code === 'NONCASH_RECEIPT_REFERENCE_REQUIRED',
      );
      const row = await findOperation(db, key);
      assert.ok(row, 'a refused non-cash receipt must leave an operation_executions row');
      assert.equal(row.status, 'failed');
      assert.equal(row.error_code, 'NONCASH_RECEIPT_REFERENCE_REQUIRED');
      assert.equal(row.document_id, null);
      // Nothing was posted: no receipt, no journal, balance untouched.
      const payments = await (db as any).selectFrom('customer_payments').select('id').execute();
      assert.equal(payments.length, 0);
      const customer = await (db as any).selectFrom('customers').select('balance').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(customer.balance), 500);
    } finally {
      await db.destroy();
    }
    console.log('  refused non-cash receipt with a key leaves a failed operation row passed');
  }

  // 2. A retry with the SAME key and SAME payload is answered from
  // the stored failed row (PAYMENT_IDEMPOTENCY_FAILED), not by
  // re-running the gate with no trace. RED on the unfixed code: no
  // row exists, so the retry re-throws the gate error instead.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const write = buildWriteService(db);
      const key = 'stuck-receipt-key-2';
      const payload = { customerId: 1, amount: 200, paymentChannel: 'instapay', instapayAddress: 'sara@instapay' } as any;
      await assert.rejects(
        () => write.createCustomerPayment(payload, ADMIN, key),
        (err: any) => err.code === 'NONCASH_RECEIPT_REFERENCE_REQUIRED',
      );
      await assert.rejects(
        () => write.createCustomerPayment(payload, ADMIN, key),
        (err: any) => err.code === 'PAYMENT_IDEMPOTENCY_FAILED',
      );
      const row = await findOperation(db, key);
      assert.equal(row.status, 'failed');
      assert.equal(row.error_code, 'NONCASH_RECEIPT_REFERENCE_REQUIRED');
    } finally {
      await db.destroy();
    }
    console.log('  same-key retry is answered from the stored failed row passed');
  }

  // 3. The corrected retry — a FRESH key with a reference — succeeds
  // and posts Dr 1120 / Cr 1130. The failed row poisons nothing else.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const write = buildWriteService(db);
      await assert.rejects(
        () => write.createCustomerPayment(
          { customerId: 1, amount: 200, paymentChannel: 'instapay', instapayAddress: 'sara@instapay' } as any,
          ADMIN,
          'stuck-receipt-key-3-bad',
        ),
        (err: any) => err.code === 'NONCASH_RECEIPT_REFERENCE_REQUIRED',
      );
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 200, paymentChannel: 'instapay', instapayAddress: 'sara@instapay', transferReference: 'TRX-987654' } as any,
        ADMIN,
        'stuck-receipt-key-3-good',
      );
      assert.equal((result as any).ok, true);
      const row = await findOperation(db, 'stuck-receipt-key-3-good');
      assert.equal(row.status, 'committed');
      const payment = await (db as any).selectFrom('customer_payments').select(['transfer_reference', 'amount']).executeTakeFirstOrThrow();
      assert.equal(payment.transfer_reference, 'TRX-987654');
      const lines = await (db as any).selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit']).execute();
      assert.equal(lines.length, 2);
      const debit = lines.find((l: any) => Number(l.debit) > 0);
      assert.equal(Number(debit.account_id), 1120);
      assert.equal(Number(debit.debit), 200);
      const customer = await (db as any).selectFrom('customers').select('balance').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(customer.balance), 300);
    } finally {
      await db.destroy();
    }
    console.log('  corrected retry with a fresh key succeeds and posts Dr 1120 passed');
  }

  // 4. A cash receipt with a key still succeeds and commits its row.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const write = buildWriteService(db);
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 150, paymentChannel: 'cash' } as any,
        ADMIN,
        'stuck-receipt-key-4',
      );
      assert.equal((result as any).ok, true);
      const row = await findOperation(db, 'stuck-receipt-key-4');
      assert.equal(row.status, 'committed');
      const customer = await (db as any).selectFrom('customers').select('balance').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(customer.balance), 350);
    } finally {
      await db.destroy();
    }
    console.log('  cash receipt with a key still succeeds and commits passed');
  }

  console.log('stuck receipt idempotency checks passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
