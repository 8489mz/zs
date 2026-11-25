/*
 * supplier-advance-overdraft.spec.ts — INV-SUPPLIER-ADVANCE-OVERDRAFT-LIMIT.
 *
 * THE GAP: supplier advances (INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT, account
 * 1185) already exist, but three holes remain. (a) NO CAP: an advance is
 * allowed at any size for any supplier, so a freelancer withdrawing on
 * overdraft has no owner-set ceiling. (b) INVISIBLE: an advance deliberately
 * writes no supplier_ledger row, so the supplier statement — the one place
 * the owner reviews "everything brought, everything withdrawn, remaining" —
 * never shows the withdrawal at all. (c) NO AUTO-APPLY: when a later bill
 * arrives, the outstanding advance sits untouched until someone applies it
 * by hand, so the payable stays overstated in between.
 *
 * WHAT THIS PINS, driving the REAL PurchasesWriteService /
 * SupplierBillsService / PartnersService / ReportsSummaryService on PGlite
 * (fresh database per case):
 * - a supplier with NO overdraft limit (NULL) stays uncapped (legacy
 *   behaviour): a 10,000 advance on a zero balance posts Dr 1185 / Cr 1110
 *   and leaves the payable at 0;
 * - a freelancer with limit 5,000 takes advances 1,000 then 500, a further
 *   4,000 is rejected SUPPLIER_ADVANCE_OVER_LIMIT, and exactly 3,500 more
 *   (outstanding 5,000 total) is accepted — the cap is cumulative, not
 *   per-withdrawal;
 * - every advance also writes a zero-amount supplier_ledger marker row
 *   (entry_type 'supplier_advance', balance_after = current payable, so
 *   sum(amount) over the ledger still equals the balance) and the statement
 *   (GET supplier ledger) exposes that row with its advance amount;
 * - a month-end bill of 5,000 auto-applies the 1,500 outstanding advance
 *   (Dr 2110 / Cr 1185, applied_amount 1,500, ledger
 *   'supplier_advance_application' -1,500) leaving payable 3,500, and a
 *   settlement of 3,500 brings it to 0;
 * - direct payment without a schedule still works, and supplier-level
 *   scheduling (createForSupplier, purchase_id null) still works;
 * - updateSupplier accepts supplier_type 'freelancer' + overdraft_limit,
 *   rejects an unknown type and a negative limit, and still forbids
 *   editing the balance;
 * - listSuppliers returns supplierType + overdraftLimit on every row
 *   (INV-SUPPLIER-TYPE-LIMIT-LISTED): the supplier page card and the
 *   edit form reset read them from the list — a missing mapping silently
 *   reverts the form to 'supplier'/null on every reopen.
 * - the new INV id appears exactly once in ARCHITECTURE_INVARIANTS.md.
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
import { SupplierBillsService } from '../../src/modules/purchases/services/supplier-bills.service';
import { SupplierPaymentSchedulesService } from '../../src/modules/purchases/services/supplier-payment-schedules.service';
import { PartnersService } from '../../src/modules/partners/partners.service';
import { ReportsSummaryService } from '../../src/modules/reports/services/reports-summary.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

const ADMIN = {
  userId: 1,
  sessionId: 'spec',
  username: 'admin',
  role: 'admin',
  permissions: ['accounts', 'purchases'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

// YYYY-MM-DD N days from today, built from LOCAL calendar parts (never
// from UTC toISOString after a local-midnight setHours — in UTC+2 that
// yields the previous day). The schedule first-due window is
// [today-7, today+5y] on the tenant day, so a hardcoded past date expires.
function dateStr(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, normal_balance text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, notes text, metadata jsonb, is_active boolean DEFAULT true, updated_at timestamptz, supplier_type text, overdraft_limit numeric);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint, amount numeric, is_advance boolean DEFAULT false, applied_amount numeric DEFAULT 0, payment_channel text, instapay_address text, note text, branch_id bigint, location_id bigint, payment_date timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE supplier_payment_schedules (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, purchase_id bigint, installment_no int, due_date text, amount numeric, paid_amount numeric DEFAULT 0, status text, note text, paid_at timestamptz, created_by bigint, updated_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE supplier_payment_schedule_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, schedule_id bigint, supplier_id bigint, amount numeric, payment_channel text, instapay_address text, note text, created_by bigint, created_by_name text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE supplier_bills (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, doc_no text, bill_date date, total numeric, note text, status text, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE supplier_bill_lines (id bigserial PRIMARY KEY, tenant_id text, account_id text, bill_id bigint, description text, chart_account_id bigint, amount numeric, sort_order int);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint, payment_type text, subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric, total numeric, paid_amount numeric DEFAULT 0, branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01', grn_id bigint, po_id bigint, lifecycle_status text, three_way_match_status text, status text DEFAULT 'posted', prices_include_tax boolean DEFAULT false, tax_rate numeric DEFAULT 0);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock numeric DEFAULT 0, is_active boolean DEFAULT true);
    CREATE TABLE product_location_stock (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, quantity numeric DEFAULT 0);
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
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true })
    .execute();
  for (const [id, code, accountType] of [
    [1110, '1110', 'asset'],
    [1120, '1120', 'asset'],
    [1130, '1130', 'asset'],
    [1185, '1185', 'asset'],
    [2110, '2110', 'liability'],
    [6600, '6600', 'expense'],
    [6700, '6700', 'expense'],
    [6900, '6900', 'expense'],
  ] as Array<[number, string, string]>) {
    await anyDb
      .insertInto('accounting_accounts')
      .values({
        id,
        tenant_id: TENANT,
        code,
        name_ar: code,
        account_type: accountType,
        normal_balance: 'debit',
        is_active: true,
      })
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
    .values({ id: 1, tenant_id: TENANT, name: 'الفرع الرئيسي', default_stock_location_id: 10 })
    .execute();
  await anyDb
    .insertInto('stock_locations')
    .values({
      id: 10,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      branch_id: 1,
      name: 'المخزن الرئيسي',
      location_type: 'internal_warehouse',
      is_active: true,
    })
    .execute();
}

function buildServices(db: Kysely<Database>): {
  bills: SupplierBillsService;
  write: PurchasesWriteService;
  schedules: SupplierPaymentSchedulesService;
  partners: PartnersService;
  reports: ReportsSummaryService;
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
    bills: new SupplierBillsService(db, tx, audit, finance, posting, idempotency),
    write: new PurchasesWriteService(db, tx, audit, finance, query, posting, idempotency),
    schedules: new SupplierPaymentSchedulesService(db, tx, finance, posting, idempotency),
    partners: new PartnersService(db, audit, posting),
    reports: new ReportsSummaryService(db),
  };
}

/* Journal lines of one posted entry, keyed by account code. */
async function journalLinesByCode(
  db: Kysely<Database>,
  sourceType: string,
  sourceId: number,
): Promise<Array<{ code: string; debit: number; credit: number }>> {
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
  const row = await anyDb
    .selectFrom('suppliers')
    .select('balance')
    .where('id', '=', supplierId)
    .executeTakeFirstOrThrow();
  return Number(row.balance);
}

async function outstandingAdvances(db: Kysely<Database>, supplierId: number): Promise<number> {
  const anyDb = db as any;
  const rows = await anyDb
    .selectFrom('supplier_payments')
    .select(['amount', 'applied_amount'])
    .where('supplier_id', '=', supplierId)
    .where('is_advance', '=', true)
    .execute();
  return rows.reduce((sum: number, row: any) => sum + (Number(row.amount || 0) - Number(row.applied_amount || 0)), 0);
}

async function expectReject(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: any = null;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, `expected rejection with ${code}, got success`);
  assert.equal(
    String((caught as any).code || ''),
    code,
    `expected ${code}, got ${(caught as any).code}: ${(caught as any).message}`,
  );
}

async function advance(db: Kysely<Database>, supplierId: number, amount: number): Promise<number> {
  const { write } = buildServices(db);
  const result = await write.createSupplierPayment(
    { supplierId, amount, isAdvance: true, paymentChannel: 'cash' } as any,
    ADMIN,
  );
  assert.equal((result as any).ok, true);
  const anyDb = db as any;
  const payment = await anyDb
    .selectFrom('supplier_payments')
    .select('id')
    .where('supplier_id', '=', supplierId)
    .orderBy('id', 'desc')
    .executeTakeFirstOrThrow();
  return Number(payment.id);
}

async function main(): Promise<void> {
  // 1. No limit (NULL) stays uncapped — legacy behaviour for ordinary suppliers.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb
        .insertInto('suppliers')
        .values({
          id: 1,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          name: 'مورد عادي',
          phone: '020',
          balance: 0,
          is_active: true,
          supplier_type: 'supplier',
          overdraft_limit: null,
        })
        .execute();
      const { write } = buildServices(db);
      const result = await write.createSupplierPayment(
        { supplierId: 1, amount: 10000, isAdvance: true, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      assert.equal(await supplierBalance(db, 1), 0, 'an advance must not touch the payable');
      assert.equal(await outstandingAdvances(db, 1), 10000);
      const payment = await anyDb
        .selectFrom('supplier_payments')
        .select(['is_advance', 'amount'])
        .executeTakeFirstOrThrow();
      assert.equal((payment as any).is_advance, true);
      const lines = await journalLinesByCode(db, 'supplier_payment', 1);
      assert.deepEqual(lines, [
        { code: '1110', debit: 0, credit: 10000 },
        { code: '1185', debit: 10000, credit: 0 },
      ]);
      const ledger = await anyDb
        .selectFrom('supplier_ledger')
        .select(['entry_type', 'amount', 'balance_after'])
        .execute();
      assert.equal(ledger.length, 1, 'one zero-amount marker row, no settlement row');
      assert.equal(ledger[0].entry_type, 'supplier_advance');
      assert.equal(Number(ledger[0].amount), 0);
      assert.equal(Number(ledger[0].balance_after), 0);
    } finally {
      await db.destroy();
    }
    console.log('  no limit (NULL): 10,000 advance uncapped, Dr 1185, payable 0, marker row passed');
  }

  // 2. Limit 5,000 is cumulative: 1,000 + 500 OK, a further 4,000 rejected, exactly 3,500 more accepted.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb
        .insertInto('suppliers')
        .values({
          id: 1,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          name: 'فري لانس',
          phone: '020',
          balance: 0,
          is_active: true,
          supplier_type: 'freelancer',
          overdraft_limit: 5000,
        })
        .execute();
      const { write } = buildServices(db);
      await write.createSupplierPayment(
        { supplierId: 1, amount: 1000, isAdvance: true, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      await write.createSupplierPayment(
        { supplierId: 1, amount: 500, isAdvance: true, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal(await outstandingAdvances(db, 1), 1500);
      assert.equal(await supplierBalance(db, 1), 0);
      await expectReject(
        write.createSupplierPayment(
          { supplierId: 1, amount: 4000, isAdvance: true, paymentChannel: 'cash' } as any,
          ADMIN,
        ),
        'SUPPLIER_ADVANCE_OVER_LIMIT',
      );
      assert.equal(await outstandingAdvances(db, 1), 1500, 'a rejected advance writes nothing');
      await write.createSupplierPayment(
        { supplierId: 1, amount: 3500, isAdvance: true, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal(await outstandingAdvances(db, 1), 5000, 'advances up to exactly the limit are accepted');
      assert.equal(await supplierBalance(db, 1), 0);
    } finally {
      await db.destroy();
    }
    console.log('  limit 5,000 cumulative: 1,000 + 500 OK, 4,000 rejected, 3,500 to the limit OK passed');
  }

  // 3. The statement shows the advances: marker rows with their advance amounts, totals undistorted.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb
        .insertInto('suppliers')
        .values({
          id: 1,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          name: 'فري لانس',
          phone: '020',
          balance: 0,
          is_active: true,
          supplier_type: 'freelancer',
          overdraft_limit: 5000,
        })
        .execute();
      const { write, reports } = buildServices(db);
      await write.createSupplierPayment(
        { supplierId: 1, amount: 1000, isAdvance: true, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      await write.createSupplierPayment(
        { supplierId: 1, amount: 500, isAdvance: true, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      const statement: any = await reports.supplierLedger(1, {} as never, ADMIN);
      assert.equal(statement.supplier.balance, 0);
      const markers = (statement.entries as any[]).filter((entry) => entry.type === 'supplier_advance');
      assert.equal(markers.length, 2, 'both advances visible as statement rows');
      assert.deepEqual(
        markers.map((entry) => entry.advanceAmount),
        [1000, 500],
      );
      assert.deepEqual(
        markers.map((entry) => entry.amount),
        [0, 0],
        'marker rows carry amount 0 so ledger sums still equal the balance',
      );
      assert.deepEqual(
        markers.map((entry) => entry.balanceAfter),
        [0, 0],
      );
      assert.ok(
        markers.every((entry) => String(entry.createdAt || '').length > 0),
        'marker rows carry their date+time',
      );
      assert.equal(
        Number(statement.summary?.totalDebits ?? 0),
        0,
        'zero-amount markers must not inflate statement totals',
      );
      assert.equal(Number(statement.summary?.totalCredits ?? 0), 0);
      assert.equal(Number(statement.summary?.closingBalance ?? 0), 0);
      assert.equal(Number(statement.summary?.openAdvanceBalance ?? 0), 1500);
    } finally {
      await db.destroy();
    }
    console.log('  statement shows both advances with amounts, totals undistorted passed');
  }

  // 4. Month-end bill auto-applies the outstanding advance; settle the rest to 0.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb
        .insertInto('suppliers')
        .values({
          id: 1,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          name: 'فري لانس',
          phone: '020',
          balance: 0,
          is_active: true,
          supplier_type: 'freelancer',
          overdraft_limit: 5000,
        })
        .execute();
      const { bills, write } = buildServices(db);
      const advanceId1 = await advance(db, 1, 1000);
      const advanceId2 = await advance(db, 1, 500);
      const billResult: any = await bills.createSupplierBill(
        { supplierId: 1, lines: [{ description: 'أتعاب شهر نوفمبر', accountId: 6900, amount: 5000 }] } as any,
        ADMIN,
      );
      assert.equal(billResult.ok, true);
      assert.equal(Number(billResult.bill.total), 5000);
      assert.deepEqual(billResult.appliedAdvances, [
        { paymentId: advanceId1, amount: 1000 },
        { paymentId: advanceId2, amount: 500 },
      ]);
      assert.equal(await supplierBalance(db, 1), 3500, 'bill 5,000 minus auto-applied 1,500');
      assert.equal(await outstandingAdvances(db, 1), 0);
      const applyLines1 = await journalLinesByCode(db, 'supplier_advance_application', advanceId1);
      assert.deepEqual(applyLines1, [
        { code: '1185', debit: 0, credit: 1000 },
        { code: '2110', debit: 1000, credit: 0 },
      ]);
      const applyLines2 = await journalLinesByCode(db, 'supplier_advance_application', advanceId2);
      assert.deepEqual(applyLines2, [
        { code: '1185', debit: 0, credit: 500 },
        { code: '2110', debit: 500, credit: 0 },
      ]);
      const ledger = await anyDb
        .selectFrom('supplier_ledger')
        .select(['entry_type', 'amount', 'balance_after'])
        .orderBy('id', 'asc')
        .execute();
      assert.deepEqual(
        ledger.map((row: any) => [row.entry_type, Number(row.amount), Number(row.balance_after)]),
        [
          ['supplier_advance', 0, 0],
          ['supplier_advance', 0, 0],
          ['supplier_bill', 5000, 5000],
          ['supplier_advance_application', -1000, 4000],
          ['supplier_advance_application', -500, 3500],
        ],
      );
      const settle = await write.createSupplierPayment(
        { supplierId: 1, amount: 3500, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal((settle as any).ok, true);
      assert.equal(await supplierBalance(db, 1), 0);
      const payment = await anyDb
        .selectFrom('supplier_payments')
        .select(['is_advance'])
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow();
      assert.equal((payment as any).is_advance, false, 'the final 3,500 is a settlement, not an advance');
    } finally {
      await db.destroy();
    }
    console.log('  bill 5,000 auto-applies 1,500 -> payable 3,500; settle 3,500 -> 0 passed');
  }

  // 5. Direct payment without a schedule still works, and supplier-level scheduling still works.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb
        .insertInto('suppliers')
        .values({
          id: 1,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          name: 'مورد توريدات',
          phone: '020',
          balance: 0,
          is_active: true,
          supplier_type: 'supplier',
          overdraft_limit: null,
        })
        .execute();
      const { bills, write, schedules } = buildServices(db);
      await bills.createSupplierBill(
        {
          supplierId: 1,
          lines: [
            { description: 'برنامج محاسبة', accountId: 6600, amount: 6000 },
            { description: 'كرتونة ورق', accountId: 6700, amount: 2500 },
            { description: 'كابلات', accountId: 6900, amount: 1500 },
          ],
        } as any,
        ADMIN,
      );
      const direct = await write.createSupplierPayment(
        { supplierId: 1, amount: 2000, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal((direct as any).ok, true);
      assert.equal(await supplierBalance(db, 1), 8000, 'direct payment settles 10,000 -> 8,000 with no schedule');
      const created: any = await schedules.createForSupplier(
        1,
        {
          mode: 'count',
          scheduleAmount: 8000,
          installmentCount: 2,
          firstDueDate: dateStr(10),
          intervalDays: 30,
        } as any,
        ADMIN,
      );
      const rows = created.schedules as any[];
      assert.equal(rows.length, 2, 'two installments scheduled against the bill payable, purchase_id null');
      assert.ok(
        rows.every((row: any) => row.purchaseId === ''),
        'schedule rows carry no purchase',
      );
      const firstId = Number(rows[0].id);
      const paid: any = await schedules.payInstallment(firstId, { paymentChannel: 'cash' } as any, ADMIN);
      assert.equal(Number(paid.schedules[0].paidAmount), 4000, 'first installment fully paid');
      assert.equal(await supplierBalance(db, 1), 4000, 'first installment 4,000 settles 8,000 -> 4,000');
    } finally {
      await db.destroy();
    }
    console.log('  direct payment 2,000 + supplier-level schedule 2 x 4,000, first paid -> 4,000 passed');
  }

  // 6. updateSupplier accepts type + limit, rejects a bad type / negative limit, still forbids balance edits.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb
        .insertInto('suppliers')
        .values({
          id: 1,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          name: 'فري لانس',
          phone: '020',
          balance: 0,
          is_active: true,
          supplier_type: 'supplier',
          overdraft_limit: null,
        })
        .execute();
      const { partners } = buildServices(db);
      const listedDefault: any = await partners.listSuppliers({}, ADMIN);
      const defaultRow = (listedDefault.suppliers as any[]).find((s) => String(s.id) === '1');
      assert.equal(defaultRow.supplierType, 'supplier', 'a plain supplier lists as supplier');
      assert.equal(defaultRow.overdraftLimit, null, 'no limit lists as null (uncapped)');
      const updated: any = await partners.updateSupplier(
        1,
        { name: 'فري لانس', supplierType: 'freelancer', overdraftLimit: 5000 } as any,
        ADMIN,
      );
      assert.equal(updated.ok, true);
      const row = await anyDb
        .selectFrom('suppliers')
        .select(['supplier_type', 'overdraft_limit'])
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      assert.equal((row as any).supplier_type, 'freelancer');
      assert.equal(Number((row as any).overdraft_limit), 5000);
      const listedUpdated: any = await partners.listSuppliers({}, ADMIN);
      const updatedRow = (listedUpdated.suppliers as any[]).find((s) => String(s.id) === '1');
      assert.equal(
        updatedRow.supplierType,
        'freelancer',
        'listSuppliers must return the stored type (the edit form resets from the list)',
      );
      assert.equal(Number(updatedRow.overdraftLimit), 5000, 'listSuppliers must return the stored limit');
      await expectReject(
        partners.updateSupplier(1, { name: 'فري لانس', supplierType: 'employee' } as any, ADMIN),
        'SUPPLIER_TYPE_INVALID',
      );
      await expectReject(
        partners.updateSupplier(1, { name: 'فري لانس', overdraftLimit: -100 } as any, ADMIN),
        'SUPPLIER_OVERDRAFT_LIMIT_INVALID',
      );
      await expectReject(
        partners.updateSupplier(1, { name: 'فري لانس', balance: 999 } as any, ADMIN),
        'SUPPLIER_BALANCE_EDIT_FORBIDDEN',
      );
      const cleared: any = await partners.updateSupplier(1, { name: 'فري لانس', overdraftLimit: null } as any, ADMIN);
      assert.equal(cleared.ok, true);
      const clearedRow = await anyDb
        .selectFrom('suppliers')
        .select('overdraft_limit')
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      assert.equal((clearedRow as any).overdraft_limit, null, 'null clears the limit back to uncapped');
      const listedCleared: any = await partners.listSuppliers({}, ADMIN);
      const clearedListedRow = (listedCleared.suppliers as any[]).find((s) => String(s.id) === '1');
      assert.equal(clearedListedRow.supplierType, 'freelancer', 'clearing the limit keeps the stored type');
      assert.equal(clearedListedRow.overdraftLimit, null, 'a cleared limit lists as null, not 0');
    } finally {
      await db.destroy();
    }
    console.log(
      '  updateSupplier type + limit accepted, bad type / negative limit rejected, balance still forbidden passed',
    );
  }

  // 7. INV id must appear exactly once in ARCHITECTURE_INVARIANTS.md.
  {
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    const hits = invariants.split('\n').filter((line) => line.includes('INV-SUPPLIER-ADVANCE-OVERDRAFT-LIMIT'));
    assert.equal(hits.length, 1, 'exactly one INV-SUPPLIER-ADVANCE-OVERDRAFT-LIMIT line in ARCHITECTURE_INVARIANTS.md');
    console.log('  INV-SUPPLIER-ADVANCE-OVERDRAFT-LIMIT appears exactly once passed');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
