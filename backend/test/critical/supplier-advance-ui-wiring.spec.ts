/*
 * supplier-advance-ui-wiring.spec.ts — INV-SUPPLIER-ADVANCE-UI-WIRING.
 *
 * THE BUG (proven live on test10k, re-trial 2026-11-14 08:35, shift 0028,
 * cashier "cash"): a supplier advance of 200 cash for supplier 0006
 * (0.00 due) failed with the generic 'تعذر تنفيذ العملية المطلوبة.'
 * on BOTH supplier payment forms — the upper "سند صرف / دفع لمورد" card
 * and the lower "تسجيل صرف وسداد مستحقات للمورد" panel. No movement
 * was recorded, the supplier stayed 0 entries / 0.00, no cash left the
 * drawer, and the 1185 booking could never be verified.
 *
 * ROOT CAUSE (code-proven at bae7fbb5, three layers, all in the UI):
 * - supplierPaymentSchema has no isAdvance field;
 * - SupplierPaymentForm has no advance toggle;
 * - buildSupplierPaymentPayload carries no isAdvance;
 * - the lower direct-payment panel sends no flag either.
 * So the backend (#7, correct) received isAdvance=undefined, applied
 * the ordinary-payment guards, and threw SUPPLIER_NO_BALANCE 400.
 * The error was then masked twice: the backend error-translations map
 * has no SUPPLIER_NO_BALANCE entry (and no _NO_BALANCE pattern), so
 * the mapper returned the generic fallback; the frontend
 * ARABIC_CODE_MESSAGES map lacks the code too. The apply-advance
 * endpoint existed but no UI called it, and listSupplierPayments had
 * no supplierId filter, so an advance was unreachable from the UI.
 *
 * WHAT THIS PINS, driving the REAL PurchasesWriteService /
 * PurchasesQueryService on PGlite (fresh database per case):
 * - a payment against a ZERO-balance supplier succeeds WITHOUT the
 *   isAdvance flag: the backend derives advance-ness from the data
 *   (a payment that settles nothing IS an advance — the same rule the
 *   customer payment flow already uses: currentBalance <= 0), posts
 *   Dr 1185 / Cr 1110, leaves the payable at 0, stores is_advance,
 *   writes no supplier-ledger entry, and moves the cash (-amount);
 * - the explicit isAdvance flag still works (zero balance and
 *   overpay-as-advance on a positive balance);
 * - ordinary payments are unchanged (balance 300, pay 200 -> 100,
 *   Dr 2110); overpaying WITHOUT the flag still rejects
 *   SUPPLIER_OVERPAYMENT;
 * - listSupplierPayments({ supplierId }) returns only that supplier's
 *   rows, so the advances card can list one supplier's open advances;
 * - the apply flow the UI drives end to end: a no-flag advance 200 on
 *   a zero-balance supplier, then a later 300 bill, apply 200 ->
 *   payable 100, applied 200, remaining 0, journal Dr 2110 / Cr 1185,
 *   no cash moves at apply time;
 * - the new INV id appears exactly once in ARCHITECTURE_INVARIANTS.md
 *   and the write service carries the zero-balance derivation.
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
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
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
  // 1. THE LIVE TRIAL CASE: zero-balance supplier, NO isAdvance flag —
  //    exactly what both UI forms sent. Must succeed as an advance:
  //    Dr 1185 / Cr 1110, payable stays 0, row stored as an advance.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد 0006', phone: '020', balance: 0, is_active: true }).execute();
      const { write } = buildServices(db);
      const result = await write.createSupplierPayment(
        { supplierId: 1, amount: 200, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      assert.equal(await supplierBalance(db, 1), 0);
      const payment = await anyDb.selectFrom('supplier_payments').select(['id', 'is_advance', 'applied_amount', 'amount']).executeTakeFirstOrThrow();
      assert.equal((payment as any).is_advance, true, 'a payment against a zero balance is stored as an advance');
      assert.equal(Number((payment as any).applied_amount), 0);
      assert.equal(Number((payment as any).amount), 200);
      const ledger = await anyDb.selectFrom('supplier_ledger').select(['entry_type', 'amount']).execute();
      assert.equal(ledger.length, 0, 'an advance writes no supplier-ledger entry');
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
    console.log('  zero-balance supplier, no flag: advance 200 posts Dr 1185 / Cr 1110, payable stays 0 passed');
  }

  // 2. The explicit flag still works on a zero-balance supplier.
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
      assert.equal((payment as any).is_advance, true);
      const lines = await journalLinesByCode(db, 'supplier_payment', Number((payment as any).id));
      assert.deepEqual(lines, [
        { code: '1110', debit: 0, credit: 100 },
        { code: '1185', debit: 100, credit: 0 },
      ]);
    } finally {
      await db.destroy();
    }
    console.log('  zero-balance supplier, flag set: advance 100 posts Dr 1185 / Cr 1110 passed');
  }

  // 3. Ordinary payments are unchanged: balance 300, pay 200 -> 100,
  //    journal Dr 2110 / Cr 1110, row is NOT an advance.
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

  // 4. Overpay-as-advance needs the flag: balance 300, amount 500
  //    with isAdvance posts Dr 1185 and leaves the payable at 300;
  //    without the flag the same amount still rejects overpayment.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار', phone: '020', balance: 300, is_active: true }).execute();
      const { write } = buildServices(db);
      const result = await write.createSupplierPayment(
        { supplierId: 1, amount: 500, paymentChannel: 'cash', isAdvance: true } as any,
        ADMIN,
      );
      assert.equal((result as any).ok, true);
      assert.equal(await supplierBalance(db, 1), 300);
      const payment = await anyDb.selectFrom('supplier_payments').select(['id', 'is_advance']).executeTakeFirstOrThrow();
      assert.equal((payment as any).is_advance, true);
      const lines = await journalLinesByCode(db, 'supplier_payment', Number((payment as any).id));
      assert.deepEqual(lines, [
        { code: '1110', debit: 0, credit: 500 },
        { code: '1185', debit: 500, credit: 0 },
      ]);
      await assert.rejects(
        write.createSupplierPayment({ supplierId: 1, amount: 500, paymentChannel: 'cash' } as any, ADMIN),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal((error as AppError).code, 'SUPPLIER_OVERPAYMENT');
          return true;
        },
      );
      assert.equal(await supplierBalance(db, 1), 300, 'the refused overpayment leaves the payable untouched');
    } finally {
      await db.destroy();
    }
    console.log('  overpay-as-advance 500 with flag posts Dr 1185, payable 300; without flag SUPPLIER_OVERPAYMENT passed');
  }

  // 5. The list read filters by supplier, so the advances card can
  //    show one supplier's open advances without the others'.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد أول', phone: '020', balance: 0, is_active: true }).execute();
      await anyDb.insertInto('suppliers').values({ id: 2, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد ثان', phone: '021', balance: 0, is_active: true }).execute();
      const { write, query } = buildServices(db);
      await write.createSupplierPayment({ supplierId: 1, amount: 200, paymentChannel: 'cash', isAdvance: true } as any, ADMIN);
      await write.createSupplierPayment({ supplierId: 2, amount: 50, paymentChannel: 'cash', isAdvance: true } as any, ADMIN);
      const filtered = await query.listSupplierPayments(ADMIN, { supplierId: '1' }) as any;
      assert.equal((filtered.supplierPayments as any[]).length, 1);
      assert.equal((filtered.supplierPayments as any[])[0].supplierId, '1');
      assert.equal((filtered.supplierPayments as any[])[0].amount, 200);
      assert.equal((filtered.supplierPayments as any[])[0].isAdvance, true);
      assert.equal((filtered.supplierPayments as any[])[0].remainingAdvance, 200);
      const unfiltered = await query.listSupplierPayments(ADMIN, {}) as any;
      assert.equal((unfiltered.supplierPayments as any[]).length, 2, 'no filter still lists every supplier');
    } finally {
      await db.destroy();
    }
    console.log('  listSupplierPayments({ supplierId }) returns only that supplier passed');
  }

  // 6. The apply flow the UI drives end to end: the trial's exact
  //    advance (200, zero-balance supplier, NO flag), then a later
  //    300 bill, apply the full 200 -> payable 100, applied 200,
  //    remaining 0, journal Dr 2110 / Cr 1185, no cash moves.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      await anyDb.insertInto('suppliers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد 0006', phone: '020', balance: 0, is_active: true }).execute();
      const { write } = buildServices(db);
      const created = await write.createSupplierPayment(
        { supplierId: 1, amount: 200, paymentChannel: 'cash' } as any,
        ADMIN,
      );
      assert.equal((created as any).ok, true);
      const payment = await anyDb.selectFrom('supplier_payments').select(['id']).executeTakeFirstOrThrow();
      const advanceId = Number((payment as any).id);
      // The later bill arrives: payable 300 (seeded the way the #7
      // apply case seeds it — the bill-creation path itself is not
      // under test here, only the apply the UI will call).
      await anyDb.updateTable('suppliers').set({ balance: 300 }).where('id', '=', 1).execute();
      await anyDb.insertInto('purchases').values({
        id: 11, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'ZB-261114-0001', supplier_id: 1,
        payment_type: 'credit', total: 300, status: 'posted',
      }).execute();
      const applied = await write.applySupplierAdvance(advanceId, { amount: 200, purchaseId: 11 } as any, ADMIN);
      assert.equal((applied as any).ok, true);
      assert.equal(Number((applied as any).appliedAmount), 200);
      assert.equal(Number((applied as any).remainingAdvance), 0);
      assert.equal(await supplierBalance(db, 1), 100);
      const after = await anyDb.selectFrom('supplier_payments').select(['applied_amount']).where('id', '=', advanceId).executeTakeFirstOrThrow();
      assert.equal(Number((after as any).applied_amount), 200);
      const lines = await journalLinesByCode(db, 'supplier_advance_application', advanceId);
      assert.deepEqual(lines, [
        { code: '1185', debit: 0, credit: 200 },
        { code: '2110', debit: 200, credit: 0 },
      ]);
      const treasury = await anyDb.selectFrom('treasury_transactions').select(['amount']).execute();
      assert.equal(treasury.length, 1, 'no cash moves at apply time');
      assert.equal(Number(treasury[0].amount), -200);
    } finally {
      await db.destroy();
    }
    console.log('  apply 200 of the no-flag advance against the 300 bill: payable 100, Dr 2110 / Cr 1185 passed');
  }

  // 7. Source + invariant pins: the write service must carry the
  //    zero-balance derivation (not just the caller flag), and the
  //    INV id must appear exactly once in ARCHITECTURE_INVARIANTS.md.
  {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const writeSrc = readFileSync(resolve(__dirname, '../../src/modules/purchases/services/purchases-write.service.ts'), 'utf8');
    const derivation = writeSrc.split('\n').find((line) => line.includes('const isAdvance') && line.includes('currentBalance <= 0'));
    assert.ok(derivation, 'createSupplierPayment must derive isAdvance from the zero balance (payload flag OR currentBalance <= 0)');
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    const hits = invariants.split('\n').filter((line) => line.includes('INV-SUPPLIER-ADVANCE-UI-WIRING'));
    assert.equal(hits.length, 1, 'exactly one INV-SUPPLIER-ADVANCE-UI-WIRING line in ARCHITECTURE_INVARIANTS.md');
    console.log('  source + invariant pins passed');
  }

  console.log('supplier-advance-ui-wiring checks passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
