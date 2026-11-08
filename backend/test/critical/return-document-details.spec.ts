/*
 * return-document-details.spec.ts — INV-STATEMENT-RETURN-ROW-DETAILS.
 *
 * THE BUG (proven live on test10k): in a supplier statement the details
 * button on a purchase-RETURN row failed with 'فاتورة الشراء غير موجودة.'
 * because the return row was classified 'purchase' (entry_type
 * 'purchase_return' contains 'purchase') and the return id was fed to
 * purchaseById. The frontend fix classifies the row 'purchase_return' and
 * calls the single-return read below instead. The same loader bug hit
 * sale-return rows in the customer statement ('sale_return' contains
 * 'sale', fed to saleById) -- one read serves both directions.
 *
 * WHAT THIS PINS, driving the REAL ReturnsService.getReturnById
 * on PGlite (fresh database per case):
 * - a purchase return returns its own data: ZPR number, supplier name,
 *   original purchase number, items with quantities and totals, total,
 *   and the journal number read from journal_entries.entry_no (never
 *   fabricated from the journal id -- gapless numbering,
 *   INV-JE-NUMBERING-GAP), looked up by source_type 'purchase_return';
 * - a sale return returns its own data: ZR number, customer name,
 *   original sale number, journal looked up by source_type
 *   'sales_return';
 * - a return with no posted journal yet still returns, with an empty
 *   journal number (legacy / unposted), instead of throwing;
 * - a missing return throws RETURN_NOT_FOUND -- never PURCHASE_NOT_FOUND,
 *   so a return id is never resolved through the purchase lookup;
 * - a return of another tenant is invisible (same RETURN_NOT_FOUND).
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AppError } from '../../src/common/errors/app-error';
import { ReturnsService } from '../../src/modules/returns/returns.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const OTHER_TENANT = 't2';
const ACCOUNT = 'a1';

const ADMIN = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['returns', 'accounts'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, total numeric, note text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_document_id bigint, product_id bigint, product_name text, qty numeric, unit_total numeric, line_total numeric, allocated_tax numeric, cost_price numeric, sale_item_id bigint, purchase_item_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false, is_active boolean DEFAULT true);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, location_type text, is_active boolean DEFAULT true);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, password_hash text, password_salt text, role text, is_active boolean DEFAULT true, permissions_json text, default_branch_id bigint, display_name text, must_change_password boolean DEFAULT false, failed_login_count int DEFAULT 0);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
  `);
  return { pg, db };
}

async function seed(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('suppliers').values({ id: 3, tenant_id: TENANT, account_id: ACCOUNT, name: 'مورد اختبار' }).execute();
  await anyDb.insertInto('customers').values({ id: 5, tenant_id: TENANT, account_id: ACCOUNT, name: 'عميل اختبار' }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'الفرع الرئيسي', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'المخزن الرئيسي', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  await anyDb.insertInto('purchases').values({ id: 1286, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'PUR-1286', supplier_id: 3 }).execute();
  await anyDb.insertInto('sales').values({ id: 16309, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'Z-261105-16309', customer_id: 5 }).execute();
  await anyDb.insertInto('return_documents').values({
    id: 42, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'ZPR-261105-0592', return_type: 'purchase',
    invoice_id: 1286, settlement_mode: 'payable', refund_method: 'cash', total: 100, note: 'مرتجع مشتريات اختبار',
    branch_id: 1, location_id: 10, created_by: 1, created_at: '2026-11-05T10:00:00.000Z',
  }).execute();
  await anyDb.insertInto('return_documents').values({
    id: 43, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'ZR-261105-0591', return_type: 'sale',
    invoice_id: 16309, settlement_mode: 'cash_refund', refund_method: 'cash', total: 150, note: 'مرتجع مبيعات اختبار',
    branch_id: 1, location_id: 10, created_by: 1, created_at: '2026-11-05T11:00:00.000Z',
  }).execute();
  await anyDb.insertInto('return_documents').values({
    id: 44, tenant_id: OTHER_TENANT, account_id: ACCOUNT, doc_no: 'ZPR-261105-0593', return_type: 'purchase',
    invoice_id: 1286, settlement_mode: 'payable', refund_method: 'cash', total: 50, note: 'مرتجع مستأجر آخر',
    branch_id: null, location_id: null, created_by: 1, created_at: '2026-11-05T12:00:00.000Z',
  }).execute();
  await anyDb.insertInto('return_items').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, return_document_id: 42, product_id: 10,
    product_name: 'صنف اختبار', qty: 2, unit_total: 50, line_total: 100, allocated_tax: 0,
  }).execute();
  await anyDb.insertInto('return_items').values({
    id: 2, tenant_id: TENANT, account_id: ACCOUNT, return_document_id: 43, product_id: 11,
    product_name: 'صنف مبيعات', qty: 1, unit_total: 150, line_total: 150, allocated_tax: 0,
  }).execute();
  await anyDb.insertInto('journal_entries').values({
    id: 15001, tenant_id: TENANT, account_id: ACCOUNT, entry_no: 'JE-00014983',
    entry_date: '2026-11-05', description: 'قيد مردودات مشتريات', source_type: 'purchase_return',
    source_id: 42, status: 'posted', branch_id: 1, location_id: 10, created_by: 1,
  }).execute();
}

async function main(): Promise<void> {
  const { db } = await makeDb();
  try {
    await seed(db);
    const service = new ReturnsService(db as never, undefined as never, undefined as never, undefined as never, undefined as never);

    {
      const result = await service.getReturnById(42, ADMIN) as any;
      const doc = result.returnDocument;
      assert.equal(doc.id, '42');
      assert.equal(doc.docNo, 'ZPR-261105-0592');
      assert.equal(doc.returnType, 'purchase');
      assert.equal(doc.invoiceId, '1286');
      assert.equal(doc.invoiceDocNo, 'PUR-1286');
      assert.equal(doc.partyName, 'مورد اختبار');
      assert.equal(doc.total, 100);
      assert.equal(doc.note, 'مرتجع مشتريات اختبار');
      assert.equal(doc.branchName, 'الفرع الرئيسي');
      assert.equal(doc.locationName, 'المخزن الرئيسي');
      assert.equal(doc.journalEntryId, '15001');
      assert.equal(doc.journalNo, 'JE-00014983');
      assert.equal(doc.items.length, 1);
      assert.equal(doc.items[0].productName, 'صنف اختبار');
      assert.equal(doc.items[0].qty, 2);
      assert.equal(doc.items[0].unitTotal, 50);
      assert.equal(doc.items[0].lineTotal, 100);
      console.log('  purchase return returns its own ZPR / supplier / items / JE data passed');
    }

    {
      const result = await service.getReturnById(43, ADMIN) as any;
      const doc = result.returnDocument;
      assert.equal(doc.docNo, 'ZR-261105-0591');
      assert.equal(doc.returnType, 'sale');
      assert.equal(doc.invoiceDocNo, 'Z-261105-16309');
      assert.equal(doc.partyName, 'عميل اختبار');
      assert.equal(doc.total, 150);
      assert.equal(doc.items.length, 1);
      assert.equal(doc.items[0].productName, 'صنف مبيعات');
      assert.equal(doc.journalEntryId, '');
      assert.equal(doc.journalNo, '');
      console.log('  sale return returns its own ZR / customer data, journal empty passed');
    }

    {
      await assert.rejects(
        service.getReturnById(999, ADMIN),
        (error: unknown) => {
          assert.ok(error instanceof AppError, 'missing return must throw AppError');
          assert.equal((error as AppError).code, 'RETURN_NOT_FOUND');
          assert.notEqual((error as AppError).code, 'PURCHASE_NOT_FOUND');
          assert.equal((error as AppError).statusCode, 404);
          return true;
        },
      );
      console.log('  missing return throws RETURN_NOT_FOUND, never PURCHASE_NOT_FOUND passed');
    }

    {
      await assert.rejects(
        service.getReturnById(44, ADMIN),
        (error: unknown) => {
          assert.ok(error instanceof AppError, 'other-tenant return must throw AppError');
          assert.equal((error as AppError).code, 'RETURN_NOT_FOUND');
          return true;
        },
      );
      console.log('  other-tenant return is invisible passed');
    }

    console.log('return-document-details checks passed');
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
