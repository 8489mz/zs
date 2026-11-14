/*
 * supplier-payment-details.spec.ts — INV-STATEMENT-PAYMENT-DETAILS +
 * INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT.
 *
 * THE BUG (proven live on test10k): in a supplier statement the details
 * button on a supplier PAYMENT row failed with 'فاتورة الشراء غير موجودة.'
 * because the payment id was fed to purchaseById. The frontend fix
 * classifies the row 'supplier_payment' and calls the single-payment read
 * below instead.
 *
 * WHAT THIS PINS, driving the REAL PurchasesQueryService on PGlite
 * (fresh database per case):
 * - a payment returns its own data: ZPV voucher number, supplier name,
 *   amount, note, date, payment channel, IPA address for InstaPay, and the
 *   journal number read from journal_entries.entry_no (never fabricated
 *   from the journal id -- gapless numbering, INV-JE-NUMBERING-GAP);
 * - a payment with no posted journal yet still returns, with an empty
 *   journal number (legacy / unposted), instead of throwing;
 * - a missing payment throws PAYMENT_NOT_FOUND -- never PURCHASE_NOT_FOUND,
 *   so a payment id is never resolved through the purchase lookup;
 * - a payment of another tenant is invisible (same PAYMENT_NOT_FOUND);
 * - the list read carries paymentChannel / instapayAddress as well.
 *
 * THE ADVANCE BUG (spice trial D08, 2026-11-14): a 200 EGP supplier
 * advance was posted as an ordinary supplier payment — Dr 2110
 * Accounts Payable / Cr cash — netting the payable 300 -> 100,
 * although no bill had been settled; and a true advance (zero
 * outstanding balance) was rejected outright (SUPPLIER_NO_BALANCE).
 * The chart had no dedicated supplier-advance asset account.
 *
 * WHAT THE ADVANCE CASES PIN, driving the REAL PurchasesWriteService
 * on PGlite (fresh database per case):
 * - D08 replay: supplier balance 300, advance 200 cash with
 *   isAdvance -> payable balance stays 300 (NOT 100), no -200
 *   supplier-ledger entry, treasury -200 (cash left the drawer),
 *   journal Dr 1185 Supplier Advances 200 / Cr 1110 Cash 200, and
 *   the payment row is marked is_advance with applied_amount 0;
 * - a true advance on a zero-balance supplier is allowed (previously
 *   SUPPLIER_NO_BALANCE);
 * - an advance via bank posts Dr 1185 / Cr 1120;
 * - an ordinary payment is unchanged: balance 300, pay 200 -> 100,
 *   journal Dr 2110 / Cr 1110;
 * - applying the advance against a later bill, to the piastre:
 *   apply 150.55 of a 200 advance -> payable 149.45, applied 150.55,
 *   remaining 49.45, journal Dr 2110 150.55 / Cr 1185 150.55, ledger
 *   entry -150.55; applying the remaining 49.45 -> payable 100.00,
 *   applied 200, remaining 0;
 * - over-applying by 0.01 rejects SUPPLIER_ADVANCE_OVERAPPLY;
 * - applying more than the payable rejects
 *   SUPPLIER_ADVANCE_EXCEEDS_PAYABLE;
 * - applying an ordinary (non-advance) payment rejects
 *   SUPPLIER_ADVANCE_NOT_ADVANCE;
 * - the detail + list reads carry isAdvance / appliedAmount /
 *   remainingAdvance, so the statement can show an advance
 *   separately from a settlement.
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
import { AppError } from '../../src/common/errors/app-error';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { PurchasesFinanceService } from '../../src/modules/purchases/services/purchases-finance.service';
import { PurchasesQueryService } from '../../src/modules/purchases/services/purchases-query.service';
import { PurchasesWriteService } from '../../src/modules/purchases/services/purchases-write.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const OTHER_TENANT = 't2';
const ACCOUNT = 'a1';

const ADMIN = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['accounts', 'purchases'], tenantId: TENANT, accountId: ACCOUNT,
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
  for (const [id, code, accountType] of [
    [1110, '1110', 'asset'], [1120, '1120', 'asset'], [1130, '1130', 'asset'],
    [1185, '1185', 'asset'], [2110, '2110', 'liability'],
  ] as Array<[number, string, string]>) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, account_type: accountType, is_active: true }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, supplier_payable_account_id: 2110,
  }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'الفرع الرئيسي', default_stock_location_id: 10 }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'المخزن الرئيسي', location_type: 'internal_warehouse', is_active: true }).execute();
}

function buildServices(db: Kysely<Database>): { write: PurchasesWriteService; query: PurchasesQueryService } {
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
    query,
  };
}

async function seed(db: Kysely<Database>): Promise<void> {
  await seedFoundation(db);
  const anyDb = db as any;
  await anyDb.insertInto('suppliers').values({ id: 3, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار', phone: '020', balance: 880, is_active: true }).execute();
  await anyDb.insertInto('suppliers').values({ id: 4, tenant_id: OTHER_TENANT, account_id: ACCOUNT, name: 'مورد آخر', phone: '021', balance: 0, is_active: true }).execute();
  await anyDb.insertInto('supplier_payments').values({
    id: 7, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'ZPV-261107-000002', supplier_id: 3,
    amount: 120, payment_channel: 'instapay', instapay_address: 'test@instapay', note: 'دفعة اختبار',
    branch_id: 1, location_id: 10, payment_date: '2026-11-05T10:00:00.000Z', created_by: 1,
  }).execute();
  await anyDb.insertInto('supplier_payments').values({
    id: 8, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'ZPV-261107-000003', supplier_id: 3,
    amount: 1, payment_channel: 'cash', instapay_address: null, note: 'دفعة نقدية بلا قيد بعد',
    branch_id: 1, location_id: 10, payment_date: '2026-11-07T10:00:00.000Z', created_by: 1,
  }).execute();
  await anyDb.insertInto('supplier_payments').values({
    id: 9, tenant_id: OTHER_TENANT, account_id: ACCOUNT, doc_no: 'ZPV-261107-000001', supplier_id: 4,
    amount: 50, payment_channel: 'cash', instapay_address: null, note: 'دفعة مستأجر آخر',
    branch_id: null, location_id: null, payment_date: '2026-11-07T10:00:00.000Z', created_by: 1,
  }).execute();
  await anyDb.insertInto('journal_entries').values({
    id: 15002, tenant_id: TENANT, account_id: ACCOUNT, entry_no: 'JE-00015002',
    entry_date: '2026-11-05', description: 'دفع إلى مورد اختبار', source_type: 'supplier_payment',
    source_id: 7, status: 'posted', branch_id: 1, location_id: 10, created_by: 1,
  }).execute();
}

/* Journal lines of one posted entry, keyed by account code. */
async function journalLinesByCode(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const anyDb = db as any;
  const rows = await anyDb
    .selectFrom('journal_entry_lines as l')
    .innerJoin('journal_entries as j', 'j.id', 'l.journal_entry_id')
    .innerJoin('accounting_accounts as a', 'a.id', 'l.account_id')
    .select(['a.code', 'l.debit', 'l.credit'])
    .where('j.source_type', '=', sourceType)
    .where('j.source_id', '=', sourceId)
    .where('j.status', '=', 'posted')
    .orderBy('a.code', 'asc')
    .execute();
  return rows.map((row: any) => ({ code: String(row.code), debit: Number(row.debit), credit: Number(row.credit) }));
}

async function supplierBalance(db: Kysely<Database>, supplierId: number): Promise<number> {
  const anyDb = db as any;
  const row = await anyDb.selectFrom('suppliers').select('balance').where('id', '=', supplierId).executeTakeFirstOrThrow();
  return Number(row.balance);
}

async function main(): Promise<void> {
  const { db } = await makeDb();
  try {
    await seed(db);
    const service = new PurchasesQueryService(db as never);

    {
      const result = await service.getSupplierPaymentById(7, ADMIN) as any;
      const payment = result.supplierPayment;
      assert.equal(payment.id, '7');
      assert.equal(payment.docNo, 'ZPV-261107-000002');
      assert.equal(payment.supplierId, '3');
      assert.equal(payment.supplierName, 'مورد اختبار');
      assert.equal(payment.amount, 120);
      assert.equal(payment.note, 'دفعة اختبار');
      assert.equal(payment.paymentChannel, 'instapay');
      assert.equal(payment.instapayAddress, 'test@instapay');
      assert.equal(payment.branchName, 'الفرع الرئيسي');
      assert.equal(payment.locationName, 'المخزن الرئيسي');
      assert.equal(payment.journalEntryId, '15002');
      assert.equal(payment.journalNo, 'JE-00015002');
      console.log('  payment returns its own ZPV / JE / channel / IPA data passed');
    }

    {
      const result = await service.getSupplierPaymentById(8, ADMIN) as any;
      const payment = result.supplierPayment;
      assert.equal(payment.docNo, 'ZPV-261107-000003');
      assert.equal(payment.paymentChannel, 'cash');
      assert.equal(payment.journalEntryId, '');
      assert.equal(payment.journalNo, '');
      console.log('  payment without a posted journal still returns, journal empty passed');
    }

    {
      await assert.rejects(
        service.getSupplierPaymentById(999, ADMIN),
        (error: unknown) => {
          assert.ok(error instanceof AppError, 'missing payment must throw AppError');
          assert.equal((error as AppError).code, 'PAYMENT_NOT_FOUND');
          assert.notEqual((error as AppError).code, 'PURCHASE_NOT_FOUND');
          assert.equal((error as AppError).statusCode, 404);
          return true;
        },
      );
      console.log('  missing payment throws PAYMENT_NOT_FOUND, never PURCHASE_NOT_FOUND passed');
    }

    {
      await assert.rejects(
        service.getSupplierPaymentById(9, ADMIN),
        (error: unknown) => {
          assert.ok(error instanceof AppError, 'other-tenant payment must throw AppError');
          assert.equal((error as AppError).code, 'PAYMENT_NOT_FOUND');
          return true;
        },
      );
      console.log('  other-tenant payment is invisible passed');
    }

    {
      const result = await service.listSupplierPayments(ADMIN, {}) as any;
      const listed = (result.supplierPayments as any[]).find((row) => row.id === '7');
      assert.ok(listed, 'payment 7 must be in the list');
      assert.equal(listed.docNo, 'ZPV-261107-000002');
      assert.equal(listed.paymentChannel, 'instapay');
      assert.equal(listed.instapayAddress, 'test@instapay');
      console.log('  list read carries paymentChannel / instapayAddress passed');
    }
  } finally {
    await db.destroy();
  }

  // 6. D08 replay: supplier owes 300, advance 200 cash -> payable
  //    stays 300, journal Dr 1185 / Cr 1110.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار', phone: '020', balance: 300, is_active: true }).execute();
      const { write } = buildServices(db);
      const result = await write.createSupplierPayment(
        { supplierId: 1, amount: 200, paymentChannel: 'cash', isAdvance: true, note: 'دفعة مقدمة D08' } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      assert.equal(await supplierBalance(db, 1), 300);
      const payment = await anyDb.selectFrom('supplier_payments').select(['id', 'is_advance', 'applied_amount', 'amount']).executeTakeFirstOrThrow();
      assert.equal((payment as any).is_advance, true);
      assert.equal(Number((payment as any).applied_amount), 0);
      assert.equal(Number((payment as any).amount), 200);
      const ledger = await anyDb.selectFrom('supplier_ledger').select(['entry_type', 'amount']).execute();
      assert.equal(ledger.length, 0, 'an advance writes no supplier-ledger entry (D08 netted the payable through one)');
      const treasury = await anyDb.selectFrom('treasury_transactions').select(['txn_type', 'amount']).execute();
      assert.equal(treasury.length, 1);
      assert.equal(Number(treasury[0].amount), -200);
      const lines = await journalLinesByCode(db, 'supplier_payment', Number((payment as any).id));
      assert.deepEqual(lines, [
        { code: '1110', debit: 0, credit: 200 },
        { code: '1185', debit: 200, credit: 0 },
      ]);
    } finally {
      await db.destroy();
    }
    console.log('  D08 replay: advance 200 leaves payable 300 and posts Dr 1185 / Cr 1110 passed');
  }

  // 7. A true advance on a zero-balance supplier is allowed.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد جديد', phone: '020', balance: 0, is_active: true }).execute();
      const { write } = buildServices(db);
      const result = await write.createSupplierPayment(
        { supplierId: 1, amount: 100, paymentChannel: 'cash', isAdvance: true } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      assert.equal(await supplierBalance(db, 1), 0);
      const payment = await anyDb.selectFrom('supplier_payments').select(['id', 'is_advance']).executeTakeFirstOrThrow();
      const lines = await journalLinesByCode(db, 'supplier_payment', Number((payment as any).id));
      assert.deepEqual(lines, [
        { code: '1110', debit: 0, credit: 100 },
        { code: '1185', debit: 100, credit: 0 },
      ]);
    } finally {
      await db.destroy();
    }
    console.log('  zero-balance supplier advance 100 is allowed, Dr 1185 / Cr 1110 passed');
  }

  // 8. An advance via bank posts Dr 1185 / Cr 1120.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار', phone: '020', balance: 50, is_active: true }).execute();
      const { write } = buildServices(db);
      await write.createSupplierPayment(
        { supplierId: 1, amount: 75, paymentChannel: 'bank', isAdvance: true } as any,
        ADMIN,
      );
      assert.equal(await supplierBalance(db, 1), 50);
      const payment = await anyDb.selectFrom('supplier_payments').select(['id']).executeTakeFirstOrThrow();
      const lines = await journalLinesByCode(db, 'supplier_payment', Number((payment as any).id));
      assert.deepEqual(lines, [
        { code: '1120', debit: 0, credit: 75 },
        { code: '1185', debit: 75, credit: 0 },
      ]);
    } finally {
      await db.destroy();
    }
    console.log('  bank advance 75 posts Dr 1185 / Cr 1120, payable untouched passed');
  }

  // 9. Ordinary payment is unchanged: balance 300, pay 200 -> 100,
  //    journal Dr 2110 / Cr 1110.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار', phone: '020', balance: 300, is_active: true }).execute();
      const { write } = buildServices(db);
      const result = await write.createSupplierPayment(
        { supplierId: 1, amount: 200, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      assert.equal(await supplierBalance(db, 1), 100);
      const payment = await anyDb.selectFrom('supplier_payments').select(['id', 'is_advance']).executeTakeFirstOrThrow();
      assert.equal((payment as any).is_advance, false);
      const lines = await journalLinesByCode(db, 'supplier_payment', Number((payment as any).id));
      assert.deepEqual(lines, [
        { code: '1110', debit: 0, credit: 200 },
        { code: '2110', debit: 200, credit: 0 },
      ]);
    } finally {
      await db.destroy();
    }
    console.log('  ordinary payment 200 still settles the payable 300 -> 100, Dr 2110 / Cr 1110 passed');
  }

  // 10. Applying the advance against a later bill, to the piastre:
  //     advance 200, bill 300 -> apply 150.55, then the 49.45 rest.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار', phone: '020', balance: 300, is_active: true }).execute();
      await anyDb.insertInto('purchases').values({
        id: 11, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'ZB-261114-0001', supplier_id: 1,
        payment_type: 'credit', total: 300, status: 'posted',
      }).execute();
      const { write, query } = buildServices(db);
      await write.createSupplierPayment(
        { supplierId: 1, amount: 200, paymentChannel: 'cash', isAdvance: true } as any,
        ADMIN,
      );
      const payment = await anyDb.selectFrom('supplier_payments').select(['id', 'doc_no']).executeTakeFirstOrThrow();
      const advanceId = Number((payment as any).id);

      const first = await write.applySupplierAdvance(advanceId, { amount: 150.55, purchaseId: 11 } as any, ADMIN);
      assert.equal((first as any).ok, true);
      assert.equal(Number((first as any).appliedAmount), 150.55);
      assert.equal(Number((first as any).remainingAdvance), 49.45);
      assert.equal(await supplierBalance(db, 1), 149.45);
      const afterFirst = await anyDb.selectFrom('supplier_payments').select(['applied_amount']).where('id', '=', advanceId).executeTakeFirstOrThrow();
      assert.equal(Number((afterFirst as any).applied_amount), 150.55);
      const firstLines = await journalLinesByCode(db, 'supplier_advance_application', advanceId);
      assert.deepEqual(firstLines, [
        { code: '1185', debit: 0, credit: 150.55 },
        { code: '2110', debit: 150.55, credit: 0 },
      ]);
      const firstLedger = await anyDb.selectFrom('supplier_ledger').select(['entry_type', 'amount', 'balance_after']).where('entry_type', '=', 'supplier_advance_application').execute();
      assert.equal(firstLedger.length, 1);
      assert.equal(Number(firstLedger[0].amount), -150.55);
      assert.equal(Number(firstLedger[0].balance_after), 149.45);
      // No cash moves at apply time: the treasury still holds only
      // the original -200 advance row.
      const treasury = await anyDb.selectFrom('treasury_transactions').select(['amount']).execute();
      assert.equal(treasury.length, 1);
      assert.equal(Number(treasury[0].amount), -200);

      const second = await write.applySupplierAdvance(advanceId, { amount: 49.45 } as any, ADMIN);
      assert.equal((second as any).ok, true);
      assert.equal(Number((second as any).remainingAdvance), 0);
      assert.equal(await supplierBalance(db, 1), 100);
      const afterSecond = await anyDb.selectFrom('supplier_payments').select(['applied_amount']).where('id', '=', advanceId).executeTakeFirstOrThrow();
      assert.equal(Number((afterSecond as any).applied_amount), 200);

      // The detail + list reads show the advance split.
      const detail = await query.getSupplierPaymentById(advanceId, ADMIN) as any;
      assert.equal(detail.supplierPayment.isAdvance, true);
      assert.equal(detail.supplierPayment.appliedAmount, 200);
      assert.equal(detail.supplierPayment.remainingAdvance, 0);
      const listed = await query.listSupplierPayments(ADMIN, {}) as any;
      const listedRow = (listed.supplierPayments as any[]).find((row) => row.id === String(advanceId));
      assert.ok(listedRow, 'advance must be in the list');
      assert.equal(listedRow.isAdvance, true);
      assert.equal(listedRow.appliedAmount, 200);
      assert.equal(listedRow.remainingAdvance, 0);
    } finally {
      await db.destroy();
    }
    console.log('  apply 150.55 + 49.45 settles the advance to the piastre: payable 300 -> 100, Dr 2110 / Cr 1185 passed');
  }

  // 11. Over-applying, applying past the payable, and applying a
  //     non-advance all fail closed — and leave nothing half-written.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار', phone: '020', balance: 300, is_active: true }).execute();
      await anyDb.insertInto('suppliers').values({ id: 2, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد صغير', phone: '021', balance: 100, is_active: true }).execute();
      const { write } = buildServices(db);
      await write.createSupplierPayment(
        { supplierId: 1, amount: 200, paymentChannel: 'cash', isAdvance: true } as any,
        ADMIN,
      );
      const advance = await anyDb.selectFrom('supplier_payments').select(['id']).where('supplier_id', '=', 1).executeTakeFirstOrThrow();
      const advanceId = Number((advance as any).id);
      await write.createSupplierPayment(
        { supplierId: 1, amount: 50, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      const ordinary = await anyDb.selectFrom('supplier_payments').select(['id']).where('supplier_id', '=', 1).where('is_advance', '=', false).executeTakeFirstOrThrow();
      const ordinaryId = Number((ordinary as any).id);

      await assert.rejects(
        write.applySupplierAdvance(advanceId, { amount: 200.01 } as any, ADMIN),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal((error as AppError).code, 'SUPPLIER_ADVANCE_OVERAPPLY');
          return true;
        },
      );
      // 200.01 was refused: nothing applied, payable untouched.
      assert.equal(await supplierBalance(db, 1), 250);
      const untouched = await anyDb.selectFrom('supplier_payments').select(['applied_amount']).where('id', '=', advanceId).executeTakeFirstOrThrow();
      assert.equal(Number((untouched as any).applied_amount), 0);
      const applyJournals = await anyDb.selectFrom('journal_entries').select(['id']).where('source_type', '=', 'supplier_advance_application').execute();
      assert.equal(applyJournals.length, 0);

      await assert.rejects(
        write.applySupplierAdvance(ordinaryId, { amount: 10 } as any, ADMIN),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal((error as AppError).code, 'SUPPLIER_ADVANCE_NOT_ADVANCE');
          return true;
        },
      );

      await assert.rejects(
        write.applySupplierAdvance(999999, { amount: 10 } as any, ADMIN),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal((error as AppError).code, 'SUPPLIER_ADVANCE_NOT_FOUND');
          return true;
        },
      );

      // Advance 200 against a supplier who owes only 100: applying
      // 150 is past the payable even though the advance covers it.
      await write.createSupplierPayment(
        { supplierId: 2, amount: 200, paymentChannel: 'cash', isAdvance: true } as any,
        ADMIN,
      );
      const smallAdvance = await anyDb.selectFrom('supplier_payments').select(['id']).where('supplier_id', '=', 2).executeTakeFirstOrThrow();
      await assert.rejects(
        write.applySupplierAdvance(Number((smallAdvance as any).id), { amount: 150 } as any, ADMIN),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal((error as AppError).code, 'SUPPLIER_ADVANCE_EXCEEDS_PAYABLE');
          return true;
        },
      );
      assert.equal(await supplierBalance(db, 2), 100);
    } finally {
      await db.destroy();
    }
    console.log('  over-apply / non-advance / missing advance / past-payable all fail closed with nothing half-written passed');
  }

  console.log('supplier-payment-details checks passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
