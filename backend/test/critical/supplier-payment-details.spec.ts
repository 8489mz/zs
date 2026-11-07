/*
 * supplier-payment-details.spec.ts — INV-STATEMENT-PAYMENT-DETAILS.
 *
 * THE BUG (proven live on test10k): in a supplier statement the details
 * button on a supplier PAYMENT row failed with 'فاتورة الشراء غير موجودة.'
 * because the payment id was fed to purchaseById. The frontend fix
 * classifies the row 'supplier_payment' and calls the single-payment read
 * below instead.
 *
 * WHAT THIS PINS, driving the REAL PurchasesQueryService.getSupplierPaymentById
 * on PGlite (fresh database per case):
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
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AppError } from '../../src/common/errors/app-error';
import { PurchasesQueryService } from '../../src/modules/purchases/services/purchases-query.service';
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
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, notes text, is_active boolean DEFAULT true, metadata text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false, is_active boolean DEFAULT true);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, location_type text, is_active boolean DEFAULT true);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, password_hash text, password_salt text, role text, is_active boolean DEFAULT true, permissions_json text, default_branch_id bigint, display_name text, must_change_password boolean DEFAULT false, failed_login_count int DEFAULT 0);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint, amount numeric, payment_channel text, note text, branch_id bigint, location_id bigint, payment_date timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), instapay_address text, currency text, exchange_rate numeric, forex_variance_egp numeric, proforma_invoice_id text, idempotency_key text, amount_foreign numeric, payment_method text, payment_reference text, bank_swift_code text, form4_number text, form4_date timestamptz, evidence_carrier_name text, evidence_travel_date timestamptz, evidence_handover_receipt text, evidence_lc_number text, evidence_lc_issuing_bank text, evidence_lc_expiry timestamptz, evidence_lc_documents text, evidence_cad_proof text, evidence_payment_terms text, evidence_payment_due_date timestamptz);
  `);
  return { pg, db };
}

async function seed(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('suppliers').values({ id: 3, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار', phone: '020', balance: 880, is_active: true }).execute();
  await anyDb.insertInto('suppliers').values({ id: 4, tenant_id: OTHER_TENANT, account_id: ACCOUNT, name: 'مورد آخر', phone: '021', balance: 0, is_active: true }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'الفرع الرئيسي', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'المخزن الرئيسي', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
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

    console.log('supplier-payment-details checks passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
