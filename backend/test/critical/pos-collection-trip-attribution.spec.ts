/*
 * F7c — POS-to-trip attribution for COLLECTIONS (remainder of F7 /
 * trial problem 9, 2026-11-21, test10k): F7 stamped POS SALES with
 * van_trip_id + delivery_rep_id, but POS COLLECTIONS (customer
 * payments) were not attributed: trip #7 showed collected 0.00
 * despite rep collections that day.
 *
 * THE GAP: the general-receipt path
 * (PurchasesWriteCustomerPaymentsService.createCustomerPayment)
 * inserted the customer_payments row with no trip/rep context and
 * moved no trip counter, so the trip's collected totals never saw
 * a POS collection. The physical columns already exist
 * (migration 2040000000268 added van_trip_id + rep_id to
 * customer_payments for the field-collection twin scope); only the
 * POS writer never filled them.
 *
 * THE RULE (F7c, INV-POS-SALE-TRIP-ATTRIBUTION applied to
 * collections):
 * - createCustomerPayment resolves, BEFORE the transaction opens,
 *   the acting user's linked delivery-representatives row (the same
 *   phone/username link the F7 resolver uses) and that rep's ACTIVE
 *   trip (van_sales_trips status 'open', latest id). The resolution
 *   is best-effort: any failure leaves the payment unattributed
 *   instead of failing it.
 * - At write time the trip row is locked and re-checked: only a
 *   still-OPEN trip accepts the stamp and its counters (a trip
 *   settled between resolution and insert receives neither; the
 *   payment still posts). The row then stores van_trip_id + rep_id.
 * - The counter moves EXACTLY ONCE, in the same transaction, by
 *   channel — mirroring the field-collection slice
 *   (record-field-collection.slice.ts), which is the only other
 *   writer of a customer_payments row's trip counters:
 *   cash -> cash_collected += amount; instapay / bank (the stored
 *   'bank' value IS the field path's bank_transfer, see
 *   resolveFieldCollectionChannel) -> total_instapay_collections
 *   += amount; card / wallet -> no counter moves (the money never
 *   sits with the rep — the same zero leg tripSaleContribution
 *   gives a card sale). The row is stamped in all three cases.
 * - EXACTLY-ONCE PROOF (read from the code, not assumed): no other
 *   path moves a POS collection's counters. createCustomerPayment
 *   is called only from the purchases controller/service/facade
 *   chain; the field path writes its own rows through
 *   record-field-collection.slice.ts; settle-trip
 *   (settle-trip.service.ts:335) and submit-settlement
 *   (submit-settlement.service.ts:104) only READ the counters, and
 *   computeTripDayBuckets (settlement-helpers.service.ts:54) only
 *   READS stamped payment rows for per-day buckets — it never
 *   writes van_sales_trips. The other van_sales_trips writers
 *   (execute-field-sale-internal.ts, approve-field-return.slice.ts,
 *   van-transfers.service.ts, applyTripCounterDelta) are all
 *   sale/return/transfer paths, unreachable from a payment row.
 * - Ordinary collections (no rep link) stay NULL and move nothing;
 *   the F2 balance gate and the maritime-job carve-out are
 *   unchanged (the gate runs before the stamp, so a refused
 *   collection stamps and moves nothing).
 *
 * WHAT THIS PINS, driving the REAL PurchasesWriteService on PGlite
 * (fresh database per case):
 * - (a) a POS cash collection by a rep with an active trip stores
 *   that trip's van_trip_id and the rep's rep_id, and the trip
 *   cash_collected moves by the collected amount exactly once;
 * - (a2) a POS instapay collection by the same rep stores the
 *   trip + rep and moves total_instapay_collections instead, with
 *   cash_collected untouched;
 * - (a3) a POS card collection by the same rep stores the trip +
 *   rep and moves NO counter (the money never sits with the rep);
 * - (b) a POS collection by an ordinary cashier (no rep link)
 *   stores NULL for both, and the trip counters do not move;
 * - (c) a collection above the customer balance is STILL refused
 *   by the F2 gate (REP_COLLECTION_EXCEEDS_TOTAL_BALANCE 422) and
 *   stamps and moves nothing;
 * - (d) a job-linked deposit still posts under the job carve-out
 *   (pre-invoice, zero customer balance);
 * - (e) a POS collection by a rep whose trip is already settled
 *   stores NULL for both — no attribution to a closed trip — and
 *   the payment still posts.
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
const REP_PHONE = '01000000001';
const REP_ID = 7;
const TRIP_ID = 70;

const ADMIN = {
  userId: 1,
  sessionId: 'spec',
  username: 'admin',
  role: 'admin',
  permissions: ['purchases'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

const CASHIER = {
  userId: 2,
  sessionId: 'spec-a',
  username: 'cashier-a',
  role: 'cashier',
  permissions: ['purchases'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

const REP = {
  userId: 4,
  sessionId: 'spec-rep',
  username: 'rep-user',
  role: 'cashier',
  permissions: ['purchases'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
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
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, rep_type text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, is_active boolean DEFAULT true, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
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
  await anyDb
    .insertInto('users')
    .values({ id: 2, tenant_id: TENANT, username: 'cashier-a', role: 'cashier', is_active: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 4, tenant_id: TENANT, username: 'rep-user', phone: REP_PHONE, role: 'cashier', is_active: true })
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

async function seedRepAndTrip(db: Kysely<Database>, tripStatus: string): Promise<void> {
  const anyDb = db as any;
  await anyDb
    .insertInto('delivery_representatives')
    .values({
      id: REP_ID,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Rep Seven',
      phone: REP_PHONE,
      rep_type: 'van',
      is_van_rep: true,
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('van_sales_trips')
    .values({
      id: TRIP_ID,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      rep_id: REP_ID,
      status: tripStatus,
      settlement_status: tripStatus === 'open' ? 'open' : 'settled',
      loaded_amount: 0,
      sales_amount: 0,
      cash_collected: 0,
      credit_sales: 0,
      total_instapay_sales: 0,
      total_instapay_collections: 0,
      returns_amount: 0,
      variance: 0,
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

async function readPayment(db: Kysely<Database>): Promise<any> {
  return (db as any)
    .selectFrom('customer_payments')
    .select(['van_trip_id', 'rep_id', 'amount'])
    .where('tenant_id', '=', TENANT)
    .executeTakeFirstOrThrow();
}

async function readTrip(db: Kysely<Database>): Promise<any> {
  return (db as any)
    .selectFrom('van_sales_trips')
    .select(['cash_collected', 'total_instapay_collections'])
    .where('id', '=', TRIP_ID)
    .where('tenant_id', '=', TENANT)
    .executeTakeFirstOrThrow();
}

function isBalanceCapRefusal(err: any): boolean {
  return err && err.code === 'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE' && err.statusCode === 422;
}

async function main(): Promise<void> {
  // (a) A POS cash collection by a rep with an active trip stores
  // that trip + the rep, and the trip cash_collected moves by the
  // collected amount exactly once.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db, 500);
      await seedRepAndTrip(db, 'open');
      const { write } = buildServices(db);
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 150, paymentChannel: 'cash' } as any,
        REP,
      );
      assert.equal((result as any).ok, true);
      assert.equal(await customerBalance(db), 350);
      const payment = await readPayment(db);
      assert.equal(Number(payment.van_trip_id), TRIP_ID, 'the rep cash collection stores the active trip id');
      assert.equal(Number(payment.rep_id), REP_ID, 'the rep cash collection stores the rep id');
      const trip = await readTrip(db);
      assert.equal(
        Number(trip.cash_collected),
        150,
        'the trip cash_collected moves by the collected amount exactly once',
      );
      assert.equal(Number(trip.total_instapay_collections), 0, 'no instapay leg on a cash collection');
    } finally {
      await db.destroy();
    }
    console.log('  (a) rep POS cash collection attributes trip + rep and moves cash_collected passed');
  }

  // (a2) A POS instapay collection by the same rep stores the trip
  // + rep and moves total_instapay_collections instead, with
  // cash_collected untouched.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db, 500);
      await seedRepAndTrip(db, 'open');
      const { write } = buildServices(db);
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 100, paymentChannel: 'instapay', transferReference: 'REF-INSTA-1' } as any,
        REP,
      );
      assert.equal((result as any).ok, true);
      const payment = await readPayment(db);
      assert.equal(Number(payment.van_trip_id), TRIP_ID, 'the rep instapay collection stores the active trip id');
      assert.equal(Number(payment.rep_id), REP_ID, 'the rep instapay collection stores the rep id');
      const trip = await readTrip(db);
      assert.equal(
        Number(trip.total_instapay_collections),
        100,
        'the trip instapay collections move by the collected amount',
      );
      assert.equal(Number(trip.cash_collected), 0, 'cash_collected stays 0 on an instapay collection');
    } finally {
      await db.destroy();
    }
    console.log('  (a2) rep POS instapay collection moves total_instapay_collections passed');
  }

  // (a3) A POS card collection by the same rep stores the trip +
  // rep and moves NO counter — the money never sits with the rep.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db, 500);
      await seedRepAndTrip(db, 'open');
      const { write } = buildServices(db);
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 100, paymentChannel: 'card', transferReference: 'REF-CARD-1' } as any,
        REP,
      );
      assert.equal((result as any).ok, true);
      const payment = await readPayment(db);
      assert.equal(Number(payment.van_trip_id), TRIP_ID, 'the rep card collection stores the active trip id');
      assert.equal(Number(payment.rep_id), REP_ID, 'the rep card collection stores the rep id');
      const trip = await readTrip(db);
      assert.equal(Number(trip.cash_collected), 0, 'no cash leg on a card collection');
      assert.equal(Number(trip.total_instapay_collections), 0, 'no instapay leg on a card collection');
    } finally {
      await db.destroy();
    }
    console.log('  (a3) rep POS card collection is stamped but moves no counter passed');
  }

  // (b) A POS collection by an ordinary cashier (no rep link)
  // stores NULL for both, and the trip counters do not move even
  // though an open trip exists for another rep.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db, 500);
      await seedRepAndTrip(db, 'open');
      const { write } = buildServices(db);
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 100, paymentChannel: 'cash' } as any,
        CASHIER,
      );
      assert.equal((result as any).ok, true);
      const payment = await readPayment(db);
      assert.equal(payment.van_trip_id, null, 'an ordinary cashier collection stores no trip');
      assert.equal(payment.rep_id, null, 'an ordinary cashier collection stores no rep');
      const trip = await readTrip(db);
      assert.equal(Number(trip.cash_collected), 0, 'the trip cash_collected stays 0');
      assert.equal(Number(trip.total_instapay_collections), 0, 'the trip instapay collections stay 0');
    } finally {
      await db.destroy();
    }
    console.log('  (b) ordinary cashier POS collection stores NULLs passed');
  }

  // (c) REGRESSION — the F2 gate survives: a collection above the
  // customer balance is refused with the total-cap 422, and stamps
  // and moves nothing.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db, 100);
      await seedRepAndTrip(db, 'open');
      const { write } = buildServices(db);
      await assert.rejects(
        () => write.createCustomerPayment({ customerId: 1, amount: 150, paymentChannel: 'cash' } as any, REP),
        (err: any) =>
          isBalanceCapRefusal(err) &&
          String(err.message || '').includes('150') &&
          String(err.message || '').includes('100'),
        'an over-collection by a rep must still be refused with the total-cap code naming both amounts',
      );
      assert.equal(await countRows(db, 'customer_payments'), 0, 'no receipt row was written');
      assert.equal(await countRows(db, 'journal_entries'), 0, 'no journal was posted');
      assert.equal(await customerBalance(db), 100, 'balance unchanged after the refusal');
      const trip = await readTrip(db);
      assert.equal(Number(trip.cash_collected), 0, 'the refused collection moves no trip counter');
    } finally {
      await db.destroy();
    }
    console.log('  (c) over-balance rep collection still refused by the F2 gate passed');
  }

  // (d) REGRESSION — the maritime-job carve-out survives: a
  // job-linked pre-invoice deposit posts while the customer balance
  // is 0, and the job's client_paid_total tracks it.
  {
    const { db } = await makeDb();
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
      const payment = await readPayment(db);
      assert.equal(payment.van_trip_id, null, 'the admin job deposit carries no trip (no rep link)');
      const job = await anyDb
        .selectFrom('maritime_jobs')
        .select(['client_paid_total', 'payment_status'])
        .executeTakeFirstOrThrow();
      assert.equal(Number(job.client_paid_total), 100);
      assert.equal(String(job.payment_status), 'partially_paid');
      assert.equal(await countRows(db, 'maritime_job_milestones'), 1, 'a PAYMENT milestone is recorded');
    } finally {
      await db.destroy();
    }
    console.log('  (d) job-linked pre-invoice deposit posts under the carve-out passed');
  }

  // (e) A POS collection by a rep whose trip is already settled
  // stores NULL for both — no attribution to a closed trip — and
  // the payment still posts.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db, 500);
      await seedRepAndTrip(db, 'settled');
      const { write } = buildServices(db);
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 100, paymentChannel: 'cash' } as any,
        REP,
      );
      assert.equal((result as any).ok, true);
      const payment = await readPayment(db);
      assert.equal(payment.van_trip_id, null, 'a settled trip receives no new collection');
      assert.equal(payment.rep_id, null, 'a settled trip receives no rep stamp');
      const trip = await readTrip(db);
      assert.equal(Number(trip.cash_collected), 0, 'the settled trip cash does not move');
    } finally {
      await db.destroy();
    }
    console.log('  (e) rep collection on a settled trip stores NULLs passed');
  }

  console.log('pos-collection-trip-attribution: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
