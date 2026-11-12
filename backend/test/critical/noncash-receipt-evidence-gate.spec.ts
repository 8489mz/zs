/*
 * INV-REP-NONCASH-EVIDENCE-GATE (PD1): a general customer receipt on a
 * non-cash channel debits bank 1120, so it must carry a real transfer
 * reference — a free-text note alone is NOT evidence.
 *
 * THE GAP (delivery-reps review B1, re-verified at b29f5f13): the
 * general-receipt path inserted customer_payments with channel
 * `payload.paymentChannel || 'cash'` and no transferReference field
 * anywhere in the DTO, while postCustomerPayment debited 1120 for
 * every non-cash channel unconditionally. A user could record a
 * bank / InstaPay / card receipt with no reference, no receipt and
 * no supervisor check, and the bank ledger grew with nothing to
 * reconcile against. The transfer_reference column already existed
 * on customer_payments (migration 0223) — it was simply never
 * written or read by this path.
 *
 * THE RULE (decision PD1, like the van card gate F2):
 * - A non-cash general receipt (bank / card / wallet / instapay)
 *   without a transfer reference of at least 3 characters is
 *   REFUSED, fail-closed, before any ledger write or Dr 1120
 *   posting. The error names the missing reference.
 * - A note alone is never evidence: the gate reads only the
 *   transfer reference field.
 * - Cash receipts (including an omitted channel, which defaults to
 *   cash) work unchanged and store NULL for the reference.
 * - A non-cash receipt WITH a reference stores it trimmed in
 *   customer_payments.transfer_reference and posts Dr 1120 as before.
 * - postCustomerPayment re-checks the stored reference itself, so
 *   any future caller reaching the posting without evidence is
 *   refused before any Dr 1120 is posted.
 *
 * WHAT THIS PINS, driving the REAL PurchasesWriteService and the
 * REAL AccountingPostingService on PGlite (fresh database per case):
 * - instapay receipt without a reference is refused with
 *   NONCASH_RECEIPT_REFERENCE_REQUIRED and nothing is posted.
 * - bank/card receipt without a reference is refused even when a
 *   note is supplied — the note is not evidence.
 * - cash receipt without a reference succeeds and posts Dr 1110.
 * - instapay receipt WITH a reference stores it trimmed and posts
 *   Dr 1120 / Cr 1130.
 * - postCustomerPayment called directly on a seeded non-cash row
 *   without a reference refuses before posting (defence in depth).
 * - the helpers: cash -> NULL, blank -> NULL, over-100 chars ->
 *   INVALID_TRANSFER_REFERENCE, short reference -> the gate error.
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
import {
  assertNonCashTransferReference,
  normalizeTransferReference,
} from '../../src/modules/purchases/helpers/purchases-write.helper';
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
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
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

function buildServices(db: Kysely<Database>): {
  write: PurchasesWriteService;
  posting: AccountingPostingService;
} {
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
  return {
    write: new PurchasesWriteService(db, tx, audit, finance, query, posting, idempotency),
    posting,
  };
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*)::text AS n FROM ${sql.raw(table)}`.execute(db);
  return Number(rows.rows[0]?.n || 0);
}

async function main(): Promise<void> {
  // 0. The helpers themselves: channel gate, blank handling, length guard.
  assert.equal(normalizeTransferReference('cash', 'TRX-1'), null);
  assert.equal(normalizeTransferReference(undefined, 'TRX-1'), null);
  assert.equal(normalizeTransferReference('instapay', '  TRX-987654  '), 'TRX-987654');
  assert.equal(normalizeTransferReference('bank', ''), null);
  assert.equal(normalizeTransferReference('bank', '   '), null);
  assert.throws(() => normalizeTransferReference('bank', 'x'.repeat(101)), { code: 'INVALID_TRANSFER_REFERENCE' });
  assert.doesNotThrow(() => assertNonCashTransferReference('cash', undefined));
  assert.doesNotThrow(() => assertNonCashTransferReference(undefined, undefined));
  assert.doesNotThrow(() => assertNonCashTransferReference('instapay', 'TRX-987654'));
  assert.throws(
    () => assertNonCashTransferReference('instapay', undefined),
    { code: 'NONCASH_RECEIPT_REFERENCE_REQUIRED' },
  );
  assert.throws(
    () => assertNonCashTransferReference('bank', 'ab'),
    { code: 'NONCASH_RECEIPT_REFERENCE_REQUIRED' },
  );
  console.log('  transfer reference helper checks passed');

  // 1. InstaPay receipt without a reference is refused with nothing posted.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      const { write } = buildServices(db);
      await assert.rejects(
        () => write.createCustomerPayment(
          { customerId: 1, amount: 150, paymentChannel: 'instapay', instapayAddress: 'sara@instapay' } as any,
          ADMIN,
        ),
        (err: any) => err.code === 'NONCASH_RECEIPT_REFERENCE_REQUIRED'
          && String(err.message || '').includes('transfer reference'),
      );
      assert.equal(await countRows(db, 'customer_payments'), 0);
      assert.equal(await countRows(db, 'journal_entries'), 0);
      assert.equal(await countRows(db, 'customer_ledger'), 0);
      const customer = await anyDb.selectFrom('customers').select('balance').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(customer.balance), 500);
    } finally {
      await db.destroy();
    }
    console.log('  instapay receipt without a reference is refused with nothing posted passed');
  }

  // 2. Bank/card receipt without a reference is refused even with a note.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      const { write } = buildServices(db);
      for (const channel of ['bank', 'card'] as const) {
        await assert.rejects(
          () => write.createCustomerPayment(
            { customerId: 1, amount: 100, paymentChannel: channel, note: 'paid by transfer, see WhatsApp' } as any,
            ADMIN,
          ),
          (err: any) => err.code === 'NONCASH_RECEIPT_REFERENCE_REQUIRED',
        );
      }
      assert.equal(await countRows(db, 'customer_payments'), 0);
      assert.equal(await countRows(db, 'journal_entries'), 0);
      const customer = await anyDb.selectFrom('customers').select('balance').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(customer.balance), 500);
    } finally {
      await db.destroy();
    }
    console.log('  bank/card receipt without a reference is refused even with a note passed');
  }

  // 3. Cash receipt without a reference succeeds and posts Dr 1110.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      const { write } = buildServices(db);
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 150, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      const row = await anyDb.selectFrom('customer_payments').select(['payment_channel', 'transfer_reference', 'amount']).executeTakeFirstOrThrow();
      assert.equal(row.payment_channel, 'cash');
      assert.equal(row.transfer_reference, null);
      assert.equal(Number(row.amount), 150);
      const customer = await anyDb.selectFrom('customers').select('balance').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(customer.balance), 350);
      const lines = await anyDb.selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit']).execute();
      assert.equal(lines.length, 2);
      const debit = lines.find((l: any) => Number(l.debit) > 0);
      const credit = lines.find((l: any) => Number(l.credit) > 0);
      assert.equal(Number(debit.account_id), 1110);
      assert.equal(Number(debit.debit), 150);
      assert.equal(Number(credit.account_id), 1130);
      assert.equal(Number(credit.credit), 150);
    } finally {
      await db.destroy();
    }
    console.log('  cash receipt without a reference succeeds and posts Dr 1110 passed');
  }

  // 4. Non-cash receipt WITH a reference stores it trimmed and posts Dr 1120.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      const { write } = buildServices(db);
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 200, paymentChannel: 'instapay', instapayAddress: 'sara@instapay', transferReference: '  TRX-987654  ' } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      const row = await anyDb.selectFrom('customer_payments').select(['payment_channel', 'transfer_reference', 'instapay_address', 'amount']).executeTakeFirstOrThrow();
      assert.equal(row.payment_channel, 'instapay');
      assert.equal(row.transfer_reference, 'TRX-987654');
      assert.equal(row.instapay_address, 'sara@instapay');
      assert.equal(Number(row.amount), 200);
      const customer = await anyDb.selectFrom('customers').select('balance').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(customer.balance), 300);
      const lines = await anyDb.selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit']).execute();
      assert.equal(lines.length, 2);
      const debit = lines.find((l: any) => Number(l.debit) > 0);
      const credit = lines.find((l: any) => Number(l.credit) > 0);
      assert.equal(Number(debit.account_id), 1120);
      assert.equal(Number(debit.debit), 200);
      assert.equal(Number(credit.account_id), 1130);
      assert.equal(Number(credit.credit), 200);
    } finally {
      await db.destroy();
    }
    console.log('  non-cash receipt with a reference stores it and posts Dr 1120 passed');
  }

  // 5. postCustomerPayment itself refuses a seeded non-cash row with no reference.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      const { posting } = buildServices(db);
      const inserted = await anyDb.insertInto('customer_payments').values({
        tenant_id: TENANT, account_id: ACCOUNT, customer_id: 1, amount: 120,
        payment_channel: 'bank', note: 'legacy row, no reference', created_by: 1,
      }).returning('id').executeTakeFirstOrThrow();
      await assert.rejects(
        () => posting.postCustomerPayment(db, Number(inserted.id), ADMIN),
        (err: any) => String(err.message || '').includes('transfer reference')
          && String(err.message || '').includes('1120'),
      );
      assert.equal(await countRows(db, 'journal_entries'), 0);
    } finally {
      await db.destroy();
    }
    console.log('  postCustomerPayment refuses a seeded non-cash row without a reference passed');
  }

  console.log('non-cash receipt evidence gate checks passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
