/*
 * supplier-bill.spec.ts — INV-SUPPLIER-NONSTOCK-BILL.
 *
 * THE GAP: a supplier can be owed money without any goods purchase invoice —
 * a program sold to the owner, a carton of paper, cables, a service — and the
 * system had no way to record that debt. Purchase lines REQUIRE a productId,
 * so the debt could not go through a purchase invoice without corrupting
 * stock; the supplier opening balance exists only at supplier creation and
 * posts Dr 3200 / Cr 2110 (pre-system debt, one journal per supplier); and
 * createSupplierPayment refuses a zero-balance supplier outright
 * (SUPPLIER_NO_BALANCE). The payable therefore had no origin, so neither
 * payment nor supplier-level scheduling could ever run for these suppliers.
 *
 * WHAT THIS PINS, driving the REAL SupplierBillsService /
 * PurchasesWriteService on PGlite (fresh database per case):
 * - one bill with 3 free-text lines (program 6000, carton of paper 2500,
 *   cables 1500) totals exactly 10,000, raises suppliers.balance 0 -> 10,000,
 *   posts a balanced journal (Dr each line account / Cr 2110 10,000), writes
 *   one supplier-ledger row (entry_type 'supplier_bill', balance_after 10,000),
 *   numbers the bill SPB-YYMMDD-0001 on the tenant day, and leaves every
 *   product / location-stock row untouched (zero stock movement);
 * - a line on a blocked account (cash 1110) rejects before anything is written;
 * - a line amount beyond book precision rejects at 2dp (EGP) and is accepted
 *   at 3dp (KWD tenant) — digits are required, never defaulted;
 * - a missing supplier and an empty line list both reject;
 * - an ordinary payment of 2,000 against the bill-created payable settles it
 *   10,000 -> 8,000 (the existing payment flow works on this payable);
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
import { buildBillTotal } from '../../src/modules/purchases/engines/supplier-bill.engine';
import { invalidateTenantTimezoneCache } from '../../src/common/utils/tenant-timezone.util';
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
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, normal_balance text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, notes text, metadata jsonb, is_active boolean DEFAULT true, updated_at timestamptz, supplier_type text, overdraft_limit numeric);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint, amount numeric, is_advance boolean DEFAULT false, applied_amount numeric DEFAULT 0, payment_channel text, instapay_address text, note text, branch_id bigint, location_id bigint, payment_date timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE supplier_payment_schedules (id bigint PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, purchase_id bigint, installment_no int, due_date text, amount numeric, paid_amount numeric DEFAULT 0, status text, note text, paid_at timestamptz, created_by bigint, updated_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
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

async function seedFoundation(db: Kysely<Database>, currency = 'EGP'): Promise<void> {
  const anyDb = db as any;
  invalidateTenantTimezoneCache(TENANT);
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb
    .insertInto('settings')
    .values([
      { tenant_id: TENANT, key: 'currency', value: currency },
      { tenant_id: TENANT, key: 'timezone', value: 'Africa/Cairo' },
    ])
    .execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: currency, exchange_rate: 1, is_base: true })
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
  await anyDb
    .insertInto('products')
    .values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'صنف للبيع', stock: 50, is_active: true })
    .execute();
  await anyDb
    .insertInto('product_location_stock')
    .values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, product_id: 1, location_id: 10, quantity: 50 })
    .execute();
}

function buildServices(db: Kysely<Database>): { bills: SupplierBillsService; write: PurchasesWriteService } {
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

function tenantTodayKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()).split('-');
  return `${parts[0].slice(-2)}${parts[1]}${parts[2]}`;
}

const THREE_LINES = [
  { description: 'برنامج محاسبة', accountId: 6600, amount: 6000 },
  { description: 'كرتونة ورق', accountId: 6700, amount: 2500 },
  { description: 'كابلات', accountId: 6900, amount: 1500 },
];

async function main(): Promise<void> {
  // 0. The pure engine: exact minor-unit total, no rounding leak.
  {
    assert.equal(buildBillTotal([{ amount: 6000 }, { amount: 2500 }, { amount: 1500 }], 2), 10000);
    assert.equal(buildBillTotal([{ amount: 333.33 }, { amount: 333.33 }, { amount: 333.34 }], 2), 1000);
    assert.equal(buildBillTotal([{ amount: 333.336 }, { amount: 333.336 }, { amount: 333.336 }], 3), 1000.008);
    assert.throws(() => buildBillTotal([{ amount: 333.336 }], 2), /minor-unit/);
    console.log('  engine: exact minor-unit totals, over-precision rejected at 2dp passed');
  }

  // 1. THE CASE: one bill, 3 lines, 10,000 — balance, journal, ledger, doc no, zero stock.
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
        })
        .execute();
      const { bills } = buildServices(db);
      const result = await bills.createSupplierBill({ supplierId: 1, lines: THREE_LINES } as any, ADMIN);
      assert.equal((result as any).ok, true);
      const bill = (result as any).bill;
      assert.equal(Number(bill.total), 10000);
      assert.ok(/^SPB-\d{6}-0001$/.test(String(bill.docNo)), `doc no ${bill.docNo} must be SPB-YYMMDD-0001`);
      assert.ok(
        String(bill.docNo).startsWith(`SPB-${tenantTodayKey()}-`),
        `doc no day must be the tenant day, got ${bill.docNo}`,
      );
      assert.equal(await supplierBalance(db, 1), 10000);
      const lines = await journalLinesByCode(db, 'supplier_bill', Number(bill.id));
      assert.deepEqual(lines, [
        { code: '2110', debit: 0, credit: 10000 },
        { code: '6600', debit: 6000, credit: 0 },
        { code: '6700', debit: 2500, credit: 0 },
        { code: '6900', debit: 1500, credit: 0 },
      ]);
      const ledger = await anyDb
        .selectFrom('supplier_ledger')
        .select(['entry_type', 'amount', 'balance_after'])
        .execute();
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].entry_type, 'supplier_bill');
      assert.equal(Number(ledger[0].amount), 10000);
      assert.equal(Number(ledger[0].balance_after), 10000);
      const storedLines = await anyDb
        .selectFrom('supplier_bill_lines')
        .select(['description', 'chart_account_id', 'amount'])
        .orderBy('sort_order', 'asc')
        .execute();
      assert.equal(storedLines.length, 3);
      assert.equal(storedLines[0].description, 'برنامج محاسبة');
      assert.equal(Number(storedLines[0].chart_account_id), 6600);
      assert.equal(Number(storedLines[2].amount), 1500);
      const product = await anyDb.selectFrom('products').select('stock').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(product.stock), 50, 'a non-stock bill must not touch product stock');
      const locStock = await anyDb
        .selectFrom('product_location_stock')
        .select('quantity')
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      assert.equal(Number(locStock.quantity), 50, 'a non-stock bill must not touch location stock');
    } finally {
      await db.destroy();
    }
    console.log('  bill 3 lines = 10,000: balance, journal, ledger, doc no, zero stock movement passed');
  }

  // 2. A line on a blocked account (cash 1110) rejects and writes nothing.
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
          name: 'مورد',
          phone: '020',
          balance: 0,
          is_active: true,
        })
        .execute();
      const { bills } = buildServices(db);
      await expectReject(
        bills.createSupplierBill(
          { supplierId: 1, lines: [{ description: 'نقدية', accountId: 1110, amount: 100 }] } as any,
          ADMIN,
        ),
        'SUPPLIER_BILL_INVALID_ACCOUNT',
      );
      assert.equal(await supplierBalance(db, 1), 0);
      assert.equal((await anyDb.selectFrom('supplier_bills').select('id').execute()).length, 0);
      assert.equal((await anyDb.selectFrom('journal_entries').select('id').execute()).length, 0);
    } finally {
      await db.destroy();
    }
    console.log('  blocked account line rejects with nothing written passed');
  }

  // 3. Over-precision rejects at 2dp (EGP); a 3dp (KWD) tenant accepts it.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      const anyDb = db as any;
      await anyDb
        .insertInto('suppliers')
        .values({
          id: 1,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          name: 'مورد',
          phone: '020',
          balance: 0,
          is_active: true,
        })
        .execute();
      const { bills } = buildServices(db);
      await expectReject(
        bills.createSupplierBill(
          { supplierId: 1, lines: [{ description: 'بند', accountId: 6900, amount: 333.336 }] } as any,
          ADMIN,
        ),
        'SUPPLIER_BILL_INVALID_AMOUNT',
      );
      assert.equal(await supplierBalance(db, 1), 0);
    } finally {
      await db.destroy();
    }
    const { pg: pg2, db: db2 } = await makeDb();
    try {
      await seedFoundation(db2, 'KWD');
      const anyDb = db2 as any;
      await anyDb
        .insertInto('suppliers')
        .values({
          id: 1,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          name: 'مورد',
          phone: '020',
          balance: 0,
          is_active: true,
        })
        .execute();
      const { bills } = buildServices(db2);
      const result = await bills.createSupplierBill(
        {
          supplierId: 1,
          lines: [
            { description: 'بند 1', accountId: 6900, amount: 333.336 },
            { description: 'بند 2', accountId: 6900, amount: 333.336 },
            { description: 'بند 3', accountId: 6900, amount: 333.336 },
          ],
        } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      assert.equal(Number((result as any).bill.total), 1000.008);
      assert.equal(await supplierBalance(db2, 1), 1000.008);
    } finally {
      await db2.destroy();
    }
    console.log('  over-precision rejects at 2dp, accepted at 3dp passed');
  }

  // 4. Missing supplier and empty lines both reject.
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
          name: 'مورد',
          phone: '020',
          balance: 0,
          is_active: true,
        })
        .execute();
      const { bills } = buildServices(db);
      await expectReject(
        bills.createSupplierBill({ supplierId: 999, lines: THREE_LINES } as any, ADMIN),
        'SUPPLIER_NOT_FOUND',
      );
      await expectReject(
        bills.createSupplierBill({ supplierId: 1, lines: [] } as any, ADMIN),
        'SUPPLIER_BILL_NO_LINES',
      );
      assert.equal(await supplierBalance(db, 1), 0);
    } finally {
      await db.destroy();
    }
    console.log('  missing supplier and empty lines reject passed');
  }

  // 5. The existing payment flow settles the bill-created payable: pay 2,000 -> 8,000.
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
        })
        .execute();
      const { bills, write } = buildServices(db);
      await bills.createSupplierBill({ supplierId: 1, lines: THREE_LINES } as any, ADMIN);
      const result = await write.createSupplierPayment(
        { supplierId: 1, amount: 2000, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      assert.equal(await supplierBalance(db, 1), 8000);
      const payment = await anyDb
        .selectFrom('supplier_payments')
        .select(['is_advance', 'amount'])
        .executeTakeFirstOrThrow();
      assert.equal(
        (payment as any).is_advance,
        false,
        'a payment against a real payable is a settlement, not an advance',
      );
      const lines = await journalLinesByCode(db, 'supplier_payment', 1);
      assert.deepEqual(lines, [
        { code: '1110', debit: 0, credit: 2000 },
        { code: '2110', debit: 2000, credit: 0 },
      ]);
    } finally {
      await db.destroy();
    }
    console.log('  payment 2,000 settles the bill payable 10,000 -> 8,000 passed');
  }

  // 6. INV id must appear exactly once in ARCHITECTURE_INVARIANTS.md.
  {
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    const hits = invariants.split('\n').filter((line) => line.includes('INV-SUPPLIER-NONSTOCK-BILL'));
    assert.equal(hits.length, 1, 'exactly one INV-SUPPLIER-NONSTOCK-BILL line in ARCHITECTURE_INVARIANTS.md');
    console.log('  INV-SUPPLIER-NONSTOCK-BILL appears exactly once passed');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
