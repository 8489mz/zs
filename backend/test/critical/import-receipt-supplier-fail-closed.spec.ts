/*
New file: backend/test/critical/import-receipt-supplier-fail-closed.spec.ts
Pins the receipt/late-expense supplier fail-closed rule
(INV-IMPORT-RECEIPT-SUPPLIER-FAIL-CLOSED).

WHAT WAS WRONG: when neither the shipment nor the linked project named
a supplier, the receipt and late-expense journals credited the
tenant's FIRST supplier by id, or auto-created a generic supplier
("import supplier / shipping agencies") and credited the full landed
value to them — while the real payees were the shipping line, customs
and transporter. The journal lines also carried no branch/location
attribution although the receipt location was known.

WHAT THIS PINS, driving the real postShipmentToInventory and
processLateShipmentExpense on PGlite through the real posting
boundary:
- A receipt with no shipment supplier and no project supplier fails
  closed with IMPORT_RECEIPT_SUPPLIER_REQUIRED before any write: no
  journal, no stock movement, no receipt row, no new supplier, and
  the product stock is untouched (the transaction rolls back).
- A receipt with a shipment supplier posts its payable line to THAT
  supplier, and every journal line carries the receipt branch and
  location; the supplier subledger balance follows the journal.
- A receipt with no shipment supplier but a project feasibility
  supplier posts to the feasibility supplier.
- A late expense with no supplier anywhere fails closed the same way,
  before any WAC revaluation or journal.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, account_group text, is_active boolean, is_cash_bank boolean, is_inventory boolean, is_payable boolean, is_receivable boolean, is_tax boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, feasibility_data text);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, supplier_id bigint, project_id text, container_number text, status text);
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, received_quantity numeric, factory_unit_price_usd numeric, landed_cost_egp numeric, shortage_handling_method text);
    CREATE TABLE import_container_preorders (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, reserved_quantity numeric, status text);
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text, review_reason text, posted_at timestamptz, created_by bigint, journal_entry_id bigint);
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, updated_at timestamptz);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, created_by bigint, journal_entry_id bigint);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint);
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false);
    INSERT INTO branches VALUES (2, 't1', 'Main Branch');
    INSERT INTO stock_locations VALUES (10, 't1', 2, 'Main Warehouse');
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function seedReceiptFixture(
  db: Kysely<Database>,
  opts: { shipmentSupplierId: number | null; projectId: string | null; feasibilitySupplierId: number | null },
): Promise<void> {
  await db.insertInto('products' as never).values({
    id: 5, tenant_id: 't1', account_id: 't1', name: 'Widget', stock_qty: 0,
    reserved_qty: 0, cost_price: 0, updated_at: new Date(),
  } as never).execute();
  await db.insertInto('suppliers' as never).values({
    id: 1, tenant_id: 't1', name: 'First Supplier', phone: '', address: '', balance: 0, is_active: true, updated_at: new Date(),
  } as never).execute();
  await db.insertInto('suppliers' as never).values({
    id: 7, tenant_id: 't1', name: 'Project Supplier', phone: '', address: '', balance: 0, is_active: true, updated_at: new Date(),
  } as never).execute();
  await db.insertInto('suppliers' as never).values({
    id: 9, tenant_id: 't1', name: 'Shipment Supplier', phone: '', address: '', balance: 0, is_active: true, updated_at: new Date(),
  } as never).execute();
  if (opts.projectId) {
    await db.insertInto('import_projects' as never).values({
      id: opts.projectId, tenant_id: 't1',
      feasibility_data: opts.feasibilitySupplierId
        ? JSON.stringify({ supplierId: opts.feasibilitySupplierId })
        : JSON.stringify({}),
    } as never).execute();
  }
  await db.insertInto('import_shipments' as never).values({
    id: 'sh-1', tenant_id: 't1', supplier_id: opts.shipmentSupplierId,
    project_id: opts.projectId, container_number: 'MSCU-1', status: 'Arrived',
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: 'item-1', tenant_id: 't1', shipment_id: 'sh-1', product_id: 5,
    quantity: 10, received_quantity: 10, factory_unit_price_usd: 10,
    landed_cost_egp: 500, shortage_handling_method: 'capitalize',
  } as never).execute();
}

async function postReceipt(db: Kysely<Database>, service: any): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await service.postShipmentToInventory(trx, 't1', 'sh-1', 1, 10);
  });
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function main(): Promise<void> {
  // Case 1: no supplier anywhere -> fail closed before any write.
  {
    const db = await makeDb();
    try {
      await seedReceiptFixture(db, { shipmentSupplierId: null, projectId: null, feasibilitySupplierId: null });
      const service = makeService(db);
      await assert.rejects(
        async () => postReceipt(db, service),
        /IMPORT_RECEIPT_SUPPLIER_REQUIRED/,
        'A receipt with no supplier must fail closed with a named error',
      );
      assert.equal(await countRows(db, 'journal_entries'), 0, 'No journal may be posted');
      assert.equal(await countRows(db, 'stock_movements'), 0, 'No stock movement may be written');
      assert.equal(await countRows(db, 'import_inventory_receipts'), 0, 'No receipt row may be written');
      assert.equal(await countRows(db, 'suppliers'), 3, 'No generic supplier may be auto-created');
      const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 5).executeTakeFirstOrThrow();
      assert.equal(Number(product.stock_qty), 0, 'Product stock must be untouched');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: shipment supplier -> AP to that supplier, lines carry branch/location.
  {
    const db = await makeDb();
    try {
      await seedReceiptFixture(db, { shipmentSupplierId: 9, projectId: null, feasibilitySupplierId: null });
      const service = makeService(db);
      await postReceipt(db, service);
      assert.equal(await countRows(db, 'journal_entries'), 1);
      const lines: any[] = await (db as any).selectFrom('journal_entry_lines').selectAll().execute();
      assert.equal(lines.length, 2, 'Inventory debit + payable credit');
      const payable = lines.find((l) => Number(l.credit) > 0);
      assert.equal(payable.partner_type, 'supplier');
      assert.equal(Number(payable.partner_id), 9, 'Payable must credit the shipment supplier, not the first supplier');
      assert.equal(Number(payable.credit), 5000, 'Credit is the full landed value 10 x 500');
      for (const line of lines) {
        assert.equal(Number(line.location_id), 10, 'Every journal line carries the receipt location');
        assert.equal(Number(line.branch_id), 2, 'Every journal line carries the receipt branch');
      }
      const entry: any = await (db as any).selectFrom('journal_entries').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(entry.location_id), 10);
      assert.equal(Number(entry.branch_id), 2);
      const supplier: any = await (db as any).selectFrom('suppliers').selectAll().where('id', '=', 9).executeTakeFirstOrThrow();
      assert.equal(Number(supplier.balance), 5000, 'Supplier subledger balance follows the journal');
      const first: any = await (db as any).selectFrom('suppliers').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(first.balance), 0, 'The first supplier by id must stay untouched');
      const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 5).executeTakeFirstOrThrow();
      assert.equal(Number(product.stock_qty), 10);
      assert.equal(Number(product.cost_price), 500, 'WAC blends to the receipt landed cost');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: feasibility supplier -> AP to the project supplier.
  {
    const db = await makeDb();
    try {
      await seedReceiptFixture(db, { shipmentSupplierId: null, projectId: 'proj-1', feasibilitySupplierId: 7 });
      const service = makeService(db);
      await postReceipt(db, service);
      const lines: any[] = await (db as any).selectFrom('journal_entry_lines').selectAll().execute();
      const payable = lines.find((l) => Number(l.credit) > 0);
      assert.equal(Number(payable.partner_id), 7, 'Payable must credit the feasibility supplier');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: late expense with no supplier anywhere -> fail closed before any revaluation.
  {
    const db = await makeDb();
    try {
      await seedReceiptFixture(db, { shipmentSupplierId: null, projectId: null, feasibilitySupplierId: null });
      await db.insertInto('import_inventory_receipts' as never).values({
        tenant_id: 't1', shipment_id: 'sh-1', state: 'posted', review_reason: null,
        posted_at: new Date(), created_by: 1, journal_entry_id: null,
      } as never).execute();
      await db.insertInto('import_inventory_lots' as never).values({
        tenant_id: 't1', lot_number: 'LOT-MSCU1-5-item-1', project_id: null, shipment_id: 'sh-1',
        shipment_item_id: 'item-1', product_id: 5, location_id: 10, initial_quantity: 10,
        remaining_quantity: 10, unit_landed_cost_egp: 500, status: 'active', receipt_date: '2026-11-02',
        updated_at: new Date(),
      } as never).execute();
      await (db as any).updateTable('products').set({ cost_price: 500, stock_qty: 10 }).where('id', '=', 5).execute();
      const service = makeService(db);
      await assert.rejects(
        async () => service.processLateShipmentExpense('t1', 1, 'sh-1', { lateExpenseAmount: 1000, title: 'Demurrage' }),
        /IMPORT_RECEIPT_SUPPLIER_REQUIRED/,
        'A late expense with no supplier must fail closed with the same named error',
      );
      assert.equal(await countRows(db, 'journal_entries'), 0, 'No late-expense journal may be posted');
      assert.equal(await countRows(db, 'import_late_expense_events'), 0, 'No late-expense event may be recorded');
      const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 5).executeTakeFirstOrThrow();
      assert.equal(Number(product.cost_price), 500, 'WAC must be untouched by a rejected late expense');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import receipt supplier fail-closed tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
