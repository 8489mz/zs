/*
 * INV-INSTAPAY-FIELD-MISSING: the InstaPay account number (IPA) of a
 * party payment was never saved anywhere.
 *
 * THE GAP (proven live on test10k, 2026-11-07): no IPA field exists in
 * any payment form or in supplier edit. Batch 8 P2 (INV-INSTAPAY-FIELD)
 * only fixed the store's own Z-Pay settings load-back; the payment
 * rows themselves had nowhere to store a counterparty IPA:
 * supplier_payments, customer_payments and
 * supplier_payment_schedule_logs all carry payment_channel (incl.
 * 'instapay') but no IPA column, and the global validation pipe is
 * whitelist + forbidNonWhitelisted, so a DTO without the field could
 * never even deliver the value to the service. On the supplier side
 * the edit form loaded metadata but both mutations dropped it, and
 * updateSupplier then nulled the stored metadata.
 *
 * THE RULE:
 * - An InstaPay payment stores its IPA, trimmed, in instapay_address
 *   (supplier payment, customer receipt, installment settlement).
 * - Any other channel stores NULL, even if an IPA was supplied, so a
 *   stray IPA can never be read as the destination of a cash/bank/
 *   card payment; a blank IPA stores NULL, never an empty string.
 * - Supplier edit persists metadata.instapayAddress on the supplier
 *   record (the jsonb metadata column; no new column needed).
 *
 * WHAT THIS PINS, driving the REAL PurchasesWriteService,
 * SupplierPaymentSchedulesService and PartnersService on PGlite
 * (fresh database per case):
 * - supplier payment 250.00 via instapay with IPA '  ahmed@instapay  '
 *   stores instapay_address 'ahmed@instapay' and posts its journal.
 * - supplier payment via cash with an IPA supplied stores NULL.
 * - customer receipt 150.00 via instapay stores its IPA.
 * - installment settlement 400.00 via instapay stores the IPA on the
 *   schedule log row and marks the installment paid.
 * - supplier edit with metadata.instapayAddress persists it, and the
 *   saved value reads back as an object on the supplier row.
 * - the normalizer itself: non-instapay -> NULL, blank -> NULL,
 *   over-100 chars -> INVALID_INSTAPAY_ADDRESS.
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
import { SupplierPaymentSchedulesService } from '../../src/modules/purchases/services/supplier-payment-schedules.service';
import { PartnersService } from '../../src/modules/partners/partners.service';
import { normalizeInstapayAddress } from '../../src/modules/purchases/helpers/purchases-write.helper';
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
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric, payment_channel text, instapay_address text, transfer_reference text, transfer_receipt_url text, note text, branch_id bigint, location_id bigint, job_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, customer_id bigint, job_number text, client_invoiced_total numeric, client_paid_total numeric, payment_status text, status text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, notes text, metadata jsonb, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint, amount numeric, is_advance boolean DEFAULT false, applied_amount numeric DEFAULT 0, payment_channel text, instapay_address text, note text, branch_id bigint, location_id bigint, payment_date timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE supplier_payment_schedules (id bigint PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, purchase_id bigint, installment_no int, due_date text, amount numeric, paid_amount numeric DEFAULT 0, status text, note text, paid_at timestamptz, created_by bigint, updated_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE supplier_payment_schedule_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, schedule_id bigint, supplier_id bigint, amount numeric, payment_channel text, instapay_address text, note text, created_by bigint, created_by_name text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint, payment_type text, subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric, total numeric, paid_amount numeric DEFAULT 0, branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01', grn_id bigint, po_id bigint, lifecycle_status text, three_way_match_status text, status text DEFAULT 'posted', prices_include_tax boolean DEFAULT false, tax_rate numeric DEFAULT 0);
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
}

function buildServices(db: Kysely<Database>): {
  write: PurchasesWriteService;
  schedules: SupplierPaymentSchedulesService;
  partners: PartnersService;
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
    schedules: new SupplierPaymentSchedulesService(db, tx, finance, posting, idempotency),
    partners: new PartnersService(db, audit, posting),
  };
}

async function main(): Promise<void> {
  // 0. The normalizer itself: channel gate, blank handling, length guard.
  assert.equal(normalizeInstapayAddress('instapay', '  ahmed@instapay  '), 'ahmed@instapay');
  assert.equal(normalizeInstapayAddress('instapay', ''), null);
  assert.equal(normalizeInstapayAddress('instapay', '   '), null);
  assert.equal(normalizeInstapayAddress('instapay', undefined), null);
  assert.equal(normalizeInstapayAddress('cash', 'ahmed@instapay'), null);
  assert.equal(normalizeInstapayAddress('bank', 'ahmed@instapay'), null);
  assert.equal(normalizeInstapayAddress(undefined, 'ahmed@instapay'), null);
  assert.throws(() => normalizeInstapayAddress('instapay', 'x'.repeat(101)), { code: 'INVALID_INSTAPAY_ADDRESS' });
  console.log('  instapay normalizer checks passed');

  // 1. Supplier payment via InstaPay stores the trimmed IPA and posts.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار', phone: '020', balance: 1000, is_active: true }).execute();
      const { write } = buildServices(db);
      const result = await write.createSupplierPayment(
        { supplierId: 1, amount: 250, paymentChannel: 'instapay', instapayAddress: '  ahmed@instapay  ' } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      const row = await anyDb.selectFrom('supplier_payments').select(['instapay_address', 'payment_channel', 'amount', 'doc_no']).executeTakeFirstOrThrow();
      assert.equal(row.instapay_address, 'ahmed@instapay');
      assert.equal(row.payment_channel, 'instapay');
      assert.equal(Number(row.amount), 250);
      assert.ok(String(row.doc_no || '').startsWith('ZPV-'), `doc_no assigned: ${row.doc_no}`);
      const supplier = await anyDb.selectFrom('suppliers').select('balance').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(supplier.balance), 750);
      const journal = await anyDb.selectFrom('journal_entries').select(['source_type', 'status']).where('source_type', '=', 'supplier_payment').execute();
      assert.equal(journal.length, 1);
      assert.equal(journal[0].status, 'posted');
    } finally {
      await db.destroy();
    }
    console.log('  supplier instapay payment stores the IPA passed');
  }

  // 2. Supplier payment via cash with an IPA supplied stores NULL.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار', phone: '020', balance: 1000, is_active: true }).execute();
      const { write } = buildServices(db);
      await write.createSupplierPayment(
        { supplierId: 1, amount: 100, paymentChannel: 'cash', instapayAddress: 'ahmed@instapay' } as any,
        ADMIN,
      );
      const row = await anyDb.selectFrom('supplier_payments').select(['instapay_address', 'payment_channel']).executeTakeFirstOrThrow();
      assert.equal(row.payment_channel, 'cash');
      assert.equal(row.instapay_address, null);
    } finally {
      await db.destroy();
    }
    console.log('  cash supplier payment with an IPA stores NULL passed');
  }

  // 3. Customer receipt via InstaPay stores the IPA.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('customers').values({
        id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'عميل اختبار', phone: '010',
        balance: 500, credit_limit: 0, is_credit_blocked: false, store_credit_balance: 0,
        loyalty_points: 0, is_active: true,
      }).execute();
      const { write } = buildServices(db);
      // INV-REP-NONCASH-EVIDENCE-GATE (PD1): a non-cash receipt needs
      // a transfer reference, so this IPA case now carries one too.
      const result = await write.createCustomerPayment(
        { customerId: 1, amount: 150, paymentChannel: 'instapay', instapayAddress: 'sara@instapay', transferReference: 'TRX-987654' } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      const row = await anyDb.selectFrom('customer_payments').select(['instapay_address', 'payment_channel', 'transfer_reference', 'amount']).executeTakeFirstOrThrow();
      assert.equal(row.instapay_address, 'sara@instapay');
      assert.equal(row.payment_channel, 'instapay');
      assert.equal(row.transfer_reference, 'TRX-987654');
      assert.equal(Number(row.amount), 150);
      const customer = await anyDb.selectFrom('customers').select('balance').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(customer.balance), 350);
    } finally {
      await db.destroy();
    }
    console.log('  customer instapay receipt stores the IPA passed');
  }

  // 4. Installment settlement via InstaPay stores the IPA on the log row.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار', phone: '020', balance: 1000, is_active: true }).execute();
      await anyDb.insertInto('supplier_payment_schedules').values({
        id: 1, tenant_id: TENANT, account_id: ACCOUNT, supplier_id: 1, purchase_id: null,
        installment_no: 1, due_date: '2026-11-07', amount: 400, paid_amount: 0, status: 'pending', note: 'قسط 1',
      }).execute();
      const { schedules } = buildServices(db);
      await schedules.payInstallment(
        1,
        { paymentChannel: 'instapay', instapayAddress: 'supplier@instapay', amount: 400 } as any,
        ADMIN,
      );
      const log = await anyDb.selectFrom('supplier_payment_schedule_logs').select(['instapay_address', 'payment_channel', 'amount']).executeTakeFirstOrThrow();
      assert.equal(log.instapay_address, 'supplier@instapay');
      assert.equal(log.payment_channel, 'instapay');
      assert.equal(Number(log.amount), 400);
      const schedule = await anyDb.selectFrom('supplier_payment_schedules').select(['status', 'paid_amount']).where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(schedule.status, 'paid');
      assert.equal(Number(schedule.paid_amount), 400);
    } finally {
      await db.destroy();
    }
    console.log('  installment instapay settlement stores the IPA passed');
  }

  // 5. Supplier edit persists metadata.instapayAddress on the record.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار', phone: '020', balance: 1000, is_active: true }).execute();
      const { partners } = buildServices(db);
      await partners.updateSupplier(1, {
        name: 'مورد اختبار', phone: '020', address: '', balance: 1000, notes: '',
        metadata: { currency: 'EGP', supplierType: 'factory', instapayAddress: 'vendor@instapay' },
      } as any, ADMIN);
      const row = await anyDb.selectFrom('suppliers').select('metadata').where('id', '=', 1).executeTakeFirstOrThrow();
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      assert.equal(meta.instapayAddress, 'vendor@instapay');
      assert.equal(meta.currency, 'EGP');
    } finally {
      await db.destroy();
    }
    console.log('  supplier edit persists metadata.instapayAddress passed');
  }

  console.log('party payment instapay address checks passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
