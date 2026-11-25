/*
 * F2 — POS double-collection guard (problem 2) + collection journal
 * narration (problem 28), INV-REP-COLLECTION-TOTAL-BALANCE-CAP
 * extended to the POS / general-receipt path.
 *
 * THE GAP (van trial 2026-11-21): credit sale Z-261121-16633 (50.00)
 * was collected in full (REC-261121-000018), then collected AGAIN
 * (REC-261121-000019) and booked as "دفعة مقدمة / عربون على الحساب".
 * Customer C-1057 now shows -50.00 credit. The portal/field path
 * refuses this (validateIsolatedRepCollection + the defence-in-depth
 * floor in record-field-collection.slice.ts, REP_COLLECTION_EXCEEDS_
 * TOTAL_BALANCE 422), but the general-receipt path
 * (PurchasesWriteCustomerPaymentsService.createCustomerPayment) never
 * refused anything: isAdvance / isOverpayment only chose a
 * description prefix (fullDesc), so a second full collection posted
 * as an "advance" and drove the balance negative.
 *
 * THE RULE (same code as the portal — the semantics match exactly:
 * the collected amount exceeds the customer's total outstanding
 * balance):
 * - A collection is refused with REP_COLLECTION_EXCEEDS_TOTAL_BALANCE
 *   422 when amount > the customer's current balance, inside the same
 *   transaction, so the whole receipt rolls back: no customer_payments
 *   row, no ledger entry, no treasury row, no journal, balance
 *   unchanged. That covers the double collection (balance already 0),
 *   the over-collection (amount > balance) and the zero/negative
 *   balance (any positive amount exceeds a 0 or negative balance).
 * - The refusal message names both amounts; on a zero/negative
 *   balance it says there is no outstanding debt and an advance needs
 *   the separate approved-advance flow — it is NOT silently booked.
 * - There is no advance concept on this path: CreateCustomerPaymentDto
 *   carries no advance flag (unlike the supplier side,
 *   INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT), so refusal is the behaviour;
 *   an explicitly-approved advance is a separate flow, out of scope.
 * - Defence in depth, mirroring the portal: after the ledger write
 *   the balance is re-read and a negative balance at book digits
 *   throws the same code and rolls the transaction back.
 * - JOB-LINKED CARVE-OUT (coordinator repair): a payment linked to a
 *   maritime job is governed by the job's own invoiced/paid totals,
 *   not by the customer balance — a pre-invoice job deposit posts
 *   while the customer balance is 0 (the job's client_paid_total
 *   tracks it and a milestone is recorded); when the job is invoiced
 *   the payment may not exceed invoiced − paid. The floor is skipped
 *   for job-linked payments for the same reason.
 * - Problem 28: the REC docNo is part of the narration everywhere the
 *   receipt is recorded — the customer-ledger note, the treasury note
 *   (fullDesc) and the posted journal-entry description — so a
 *   collection journal can be matched to its receipt by number, not
 *   by customer name only.
 *
 * WHAT THIS PINS, driving the REAL PurchasesWriteService and the REAL
 * AccountingPostingService on PGlite (fresh database per case):
 * - a first collection within the balance posts exactly as before
 *   (Dr 1110 / Cr 1130, balance drops by the amount) and every
 *   narration carries the returned REC docNo;
 * - a second full collection of an already-paid balance is refused
 *   with the named 422 and nothing is stored;
 * - an over-collection (amount > balance) is refused, balance
 *   unchanged;
 * - a collection on a zero balance and on a negative balance
 *   (C-1057's -50.00 shape) is refused, balances unchanged;
 * - collecting exactly the balance posts (the gate is >, not >=);
 * - a job-linked pre-invoice deposit posts while the customer balance
 *   is 0 (balance goes negative as an advance against the job; the
 *   job's client_paid_total tracks it and a milestone is recorded);
 * - a job-linked payment above the job's remaining invoiced amount is
 *   refused with the same 422, and a payment within the remainder
 *   posts and marks the job paid.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  userId: 1,
  sessionId: 'spec',
  username: 'admin',
  role: 'admin',
  permissions: ['purchases'],
  tenantId: TENANT,
  accountId: ACCOUNT,
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
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric, payment_channel text, instapay_address text, transfer_reference text, transfer_receipt_url text, note text, branch_id bigint, location_id bigint, job_id bigint, van_trip_id bigint, rep_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, customer_id bigint, job_number text, client_invoiced_total numeric, client_paid_total numeric, payment_status text, status text, paid_at timestamptz, updated_at timestamptz);
    CREATE TABLE maritime_job_milestones (id bigserial PRIMARY KEY, tenant_id text, job_id text, milestone_key text, milestone_title text, location text, notes text, recorded_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>, customerBalance: number): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true })
    .execute();
  for (const [id, code] of [
    [1110, '1110'],
    [1120, '1120'],
    [1130, '1130'],
    [2110, '2110'],
  ] as Array<[number, string]>) {
    await anyDb
      .insertInto('accounting_accounts')
      .values({ id, tenant_id: TENANT, code, name_ar: code, is_active: true })
      .execute();
  }
  await anyDb
    .insertInto('accounting_settings')
    .values({
      id: 1,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      cash_account_id: 1110,
      bank_account_id: 1120,
      customer_receivable_account_id: 1130,
      supplier_payable_account_id: 2110,
    })
    .execute();
  await anyDb
    .insertInto('branches')
    .values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 })
    .execute();
  await anyDb
    .insertInto('stock_locations')
    .values({
      id: 10,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      branch_id: 1,
      name: 'Main warehouse',
      location_type: 'internal_warehouse',
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('customers')
    .values({
      id: 1,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'عميل اختبار',
      phone: '010',
      balance: customerBalance,
      credit_limit: 0,
      is_credit_blocked: false,
      store_credit_balance: 0,
      loyalty_points: 0,
      is_active: true,
    })
    .execute();
}

function buildServices(db: Kysely<Database>): { write: PurchasesWriteService } {
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
  return { write: new PurchasesWriteService(db, tx, audit, finance, query, posting, idempotency) };
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*)::text AS n FROM ${sql.raw(table)}`.execute(db);
  return Number(rows.rows[0]?.n || 0);
}

async function customerBalance(db: Kysely<Database>): Promise<number> {
  const row = await (db as any).selectFrom('customers').select('balance').where('id', '=', 1).executeTakeFirstOrThrow();
  return Number(row.balance);
}

function isBalanceCapRefusal(err: any): boolean {
  return err && err.code === 'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE' && err.statusCode === 422;
}

async function main(): Promise<void> {
  // 1. A first collection within the balance posts exactly as before —
  // and every narration carries the returned REC docNo (problem 28).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 500);
      const anyDb = db as any;
      const { write } = buildServices(db);
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 150, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      const docNo = String((result as any).docNo || '');
      assert.match(docNo, /^REC-\d{6}-\d{6}$/, 'the receipt carries a REC-YYMMDD-###### docNo');
      assert.equal((result as any).balanceBefore, 500);
      assert.equal((result as any).balanceAfter, 350);
      assert.equal(await customerBalance(db), 350);
      const lines = await anyDb.selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit']).execute();
      assert.equal(lines.length, 2);
      const debit = lines.find((l: any) => Number(l.debit) > 0);
      const credit = lines.find((l: any) => Number(l.credit) > 0);
      assert.equal(Number(debit.account_id), 1110);
      assert.equal(Number(debit.debit), 150);
      assert.equal(Number(credit.account_id), 1130);
      assert.equal(Number(credit.credit), 150);
      const entry = await anyDb.selectFrom('journal_entries').select('description').executeTakeFirstOrThrow();
      assert.ok(
        String(entry.description).includes(docNo),
        `journal description must carry the REC docNo (got: ${entry.description})`,
      );
      const ledger = await anyDb.selectFrom('customer_ledger').select('note').executeTakeFirstOrThrow();
      assert.ok(
        String(ledger.note).includes(docNo),
        `customer ledger note must carry the REC docNo (got: ${ledger.note})`,
      );
      const treasury = await anyDb.selectFrom('treasury_transactions').select('note').executeTakeFirstOrThrow();
      assert.ok(
        String(treasury.note).includes(docNo),
        `treasury note must carry the REC docNo (got: ${treasury.note})`,
      );
    } finally {
      await db.destroy();
    }
    console.log('  within-balance collection posts as before, narrations carry the REC docNo passed');
  }

  // 2. The trial's exact shape: collect the full 50.00, then collect
  // it AGAIN — the second receipt is refused and nothing is stored.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 50);
      const { write } = buildServices(db);
      const first = await write.createCustomerPayment(
        { customerId: 1, amount: 50, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal((first as any).ok, true);
      assert.equal(await customerBalance(db), 0);
      await assert.rejects(
        () => write.createCustomerPayment({ customerId: 1, amount: 50, paymentChannel: 'cash' } as any, ADMIN),
        (err: any) => isBalanceCapRefusal(err) && String(err.message || '').includes('50'),
        'a second full collection must be refused with the total-cap code naming the amount',
      );
      assert.equal(await countRows(db, 'customer_payments'), 1, 'no second receipt row was written');
      assert.equal(await countRows(db, 'journal_entries'), 1, 'no second journal was posted');
      assert.equal(await countRows(db, 'customer_ledger'), 1, 'no second ledger entry was written');
      assert.equal(await countRows(db, 'treasury_transactions'), 1, 'no second treasury row was written');
      assert.equal(await customerBalance(db), 0, 'balance unchanged after the refusal');
    } finally {
      await db.destroy();
    }
    console.log('  second full collection of an already-paid balance refused, nothing stored passed');
  }

  // 3. Over-collection (amount > balance) is refused and nothing moves.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 100);
      const { write } = buildServices(db);
      await assert.rejects(
        () => write.createCustomerPayment({ customerId: 1, amount: 150, paymentChannel: 'cash' } as any, ADMIN),
        (err: any) =>
          isBalanceCapRefusal(err) &&
          String(err.message || '').includes('150') &&
          String(err.message || '').includes('100'),
        'an over-collection must be refused with the total-cap code naming both amounts',
      );
      assert.equal(await countRows(db, 'customer_payments'), 0);
      assert.equal(await countRows(db, 'journal_entries'), 0);
      assert.equal(await countRows(db, 'customer_ledger'), 0);
      assert.equal(await countRows(db, 'treasury_transactions'), 0);
      assert.equal(await customerBalance(db), 100, 'balance unchanged after the refusal');
    } finally {
      await db.destroy();
    }
    console.log('  over-collection refused, nothing stored passed');
  }

  // 4. A collection on a zero balance — and on a negative balance
  // (C-1057's -50.00 shape) — is refused; the balance is untouched.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 0);
      const { write } = buildServices(db);
      await assert.rejects(
        () => write.createCustomerPayment({ customerId: 1, amount: 10, paymentChannel: 'cash' } as any, ADMIN),
        (err: any) => isBalanceCapRefusal(err),
        'a collection on a zero balance must be refused',
      );
      assert.equal(await countRows(db, 'customer_payments'), 0);
      assert.equal(await customerBalance(db), 0);
    } finally {
      await db.destroy();
    }
    console.log('  collection on a zero balance refused passed');
  }
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, -50);
      const { write } = buildServices(db);
      await assert.rejects(
        () => write.createCustomerPayment({ customerId: 1, amount: 10, paymentChannel: 'cash' } as any, ADMIN),
        (err: any) => isBalanceCapRefusal(err),
        'a collection on a negative balance must be refused',
      );
      assert.equal(await countRows(db, 'customer_payments'), 0);
      assert.equal(await customerBalance(db), -50, 'the negative balance is untouched, never deepened');
    } finally {
      await db.destroy();
    }
    console.log('  collection on a negative balance refused passed');
  }

  // 5. Boundary: collecting exactly the balance posts (the gate is
  // amount > balance, not >=) and leaves the balance at exactly 0.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 100);
      const { write } = buildServices(db);
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 100, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      assert.equal(await customerBalance(db), 0);
      assert.equal(await countRows(db, 'journal_entries'), 1);
    } finally {
      await db.destroy();
    }
    console.log('  exact-balance collection posts, balance 0 passed');
  }

  // 6. Source pins: the POS path throws the portal's total-cap code
  // (same rule, same code), the floor guard sits after the ledger
  // write, and the journal posting names the receipt number.
  {
    const here = __dirname;
    const serviceSrc = readFileSync(
      resolve(here, '../../src/modules/purchases/services/purchases-write-customer-payments.service.ts'),
      'utf8',
    );
    assert.ok(
      serviceSrc.includes('REP_COLLECTION_EXCEEDS_TOTAL_BALANCE'),
      'the customer-payment service uses the total-cap error code',
    );
    assert.ok(serviceSrc.includes('INV-REP-COLLECTION-TOTAL-BALANCE-CAP'), 'the service names the invariant');
    assert.ok(!serviceSrc.includes('isAdvance'), 'no silent-advance branch remains on this path');
    const postingSrc = readFileSync(
      resolve(
        here,
        '../../src/modules/accounting/services/purchases-treasury-posting/post-customer-payment-expense.ts',
      ),
      'utf8',
    );
    assert.ok(postingSrc.includes('docNo'), 'the customer-payment posting names the receipt number');
    console.log('  source pins passed');
  }

  // 7. Job-linked carve-out: a pre-invoice maritime deposit posts
  // while the customer balance is 0. The balance goes negative as an
  // advance against the job; the job's client_paid_total tracks it
  // and a milestone is recorded. Without the carve-out the gate would
  // refuse a working maritime flow (deposit before any invoice).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 0);
      const anyDb = db as any;
      await anyDb
        .insertInto('maritime_jobs')
        .values({
          id: 1,
          tenant_id: TENANT,
          customer_id: 1,
          job_number: 'JOB-260101-0001',
          client_invoiced_total: 0,
          client_paid_total: 0,
          payment_status: 'unpaid',
          status: 'active',
        })
        .execute();
      const { write } = buildServices(db);
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 100, paymentChannel: 'cash', jobId: 1 } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      assert.equal(Number((result as any).jobId), 1);
      assert.equal(String((result as any).jobNumber), 'JOB-260101-0001');
      assert.equal(
        await customerBalance(db),
        -100,
        'the deposit takes the customer balance negative as an advance against the job',
      );
      const job = await anyDb
        .selectFrom('maritime_jobs')
        .select(['client_paid_total', 'payment_status'])
        .executeTakeFirstOrThrow();
      assert.equal(Number(job.client_paid_total), 100);
      assert.equal(String(job.payment_status), 'partially_paid');
      assert.equal(await countRows(db, 'maritime_job_milestones'), 1, 'a PAYMENT milestone is recorded');
      assert.equal(await countRows(db, 'journal_entries'), 1);
    } finally {
      await db.destroy();
    }
    console.log('  job-linked pre-invoice deposit posts on a zero balance passed');
  }

  // 8. Job-linked cap: when the job IS invoiced, the payment may not
  // exceed invoiced − paid (invoiced 100, paid 60, amount 50 refused;
  // amount 40 posts and marks the job paid).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 100);
      const anyDb = db as any;
      await anyDb
        .insertInto('maritime_jobs')
        .values({
          id: 1,
          tenant_id: TENANT,
          customer_id: 1,
          job_number: 'JOB-260101-0002',
          client_invoiced_total: 100,
          client_paid_total: 60,
          payment_status: 'partially_paid',
          status: 'active',
        })
        .execute();
      const { write } = buildServices(db);
      await assert.rejects(
        () =>
          write.createCustomerPayment({ customerId: 1, amount: 50, paymentChannel: 'cash', jobId: 1 } as any, ADMIN),
        (err: any) => isBalanceCapRefusal(err) && String(err.message || '').includes('JOB-260101-0002'),
        'a job payment above the remaining invoiced amount must be refused with the total-cap code naming the job',
      );
      assert.equal(await countRows(db, 'customer_payments'), 0, 'no receipt row was written');
      assert.equal(await countRows(db, 'journal_entries'), 0);
      const job = await anyDb.selectFrom('maritime_jobs').select('client_paid_total').executeTakeFirstOrThrow();
      assert.equal(Number(job.client_paid_total), 60, 'job paid total unchanged after the refusal');
      assert.equal(await customerBalance(db), 100, 'customer balance unchanged after the refusal');
    } finally {
      await db.destroy();
    }
    console.log('  job payment above the remaining invoiced amount refused passed');
  }
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 100);
      const anyDb = db as any;
      await anyDb
        .insertInto('maritime_jobs')
        .values({
          id: 1,
          tenant_id: TENANT,
          customer_id: 1,
          job_number: 'JOB-260101-0003',
          client_invoiced_total: 100,
          client_paid_total: 60,
          payment_status: 'partially_paid',
          status: 'active',
        })
        .execute();
      const { write } = buildServices(db);
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 40, paymentChannel: 'cash', jobId: 1 } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      const job = await anyDb
        .selectFrom('maritime_jobs')
        .select(['client_paid_total', 'payment_status'])
        .executeTakeFirstOrThrow();
      assert.equal(Number(job.client_paid_total), 100);
      assert.equal(String(job.payment_status), 'paid');
      assert.equal(await customerBalance(db), 60);
    } finally {
      await db.destroy();
    }
    console.log('  job payment within the remaining invoiced amount posts and marks the job paid passed');
  }

  console.log('pos-collection-balance-cap: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
