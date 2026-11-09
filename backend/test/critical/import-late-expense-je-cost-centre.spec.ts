/*
New file: backend/test/critical/import-late-expense-je-cost-centre.spec.ts
Pins the late-expense revaluation journal's project cost centre
(INV-IMPORT-LATE-EXPENSE-JE-COST-CENTRE).

WHAT WAS WRONG: applyImportCostRevaluation posted its journal with
no costCentreId on any line — the same missing-cost-centre class
P11 fixed for the receipt journal (INV-IMPORT-RECEIPT-JE-SUPPLIER-
SUBACCOUNT), in a different posting method. A late expense on a
project-linked shipment (demurrage, storage, broker top-up) left
the project attribution nowhere on the journal itself, so the JE
screen showed '-' on every line.

WHAT THIS PINS, driving the real processLateShipmentExpense on
PGlite through the real posting boundary:
- A late expense on a project-linked shipment carries the project
  cost centre on EVERY journal line (COGS debit, inventory debit
  and the supplier-payable credit): the CC is resolved-or-created
  by code CC-<project_no> (dimension 'project'), following the
  contracting canonical pattern — never a NULL cost centre on a
  project late-expense journal. The journal balances and the
  sold/on-hand split is exact (10 received, 6 on hand, 1000 EGP
  expense -> Dr COGS 400, Dr inventory 600, Cr payable 1000).
- A shipment with no project still posts, with an honest NULL cost
  centre on its lines (no invented centre).
- A shipment whose project_id points at a missing project row
  fails closed with IMPORT_RECEIPT_PROJECT_NOT_FOUND before any
  write: no journal, no late-expense event, no stock movement.
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
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, clearing_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, code text, name text, dimension text, budget_amount numeric, parent_id bigint, is_active boolean, description text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), CONSTRAINT uq_cost_centers_tenant_code UNIQUE (tenant_id, code));
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, project_no text, title text, allocated_capital numeric, status text, feasibility_data text);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, supplier_id bigint, project_id text, container_number text, status text, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric);
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, received_quantity numeric, factory_unit_price_usd numeric, landed_cost_egp numeric, shortage_handling_method text, gross_weight_kg_unit numeric, cbm_unit numeric);
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text, review_reason text, posted_at timestamptz, created_by bigint, journal_entry_id bigint);
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, updated_at timestamptz);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, created_by bigint, journal_entry_id bigint, idempotency_key text, broker_expense_id text, supplier_id bigint, unallocable_reason text, CONSTRAINT chk_import_late_amounts CHECK (total_amount_egp > 0 AND inventory_amount_egp >= 0 AND cogs_amount_egp >= 0 AND abs((inventory_amount_egp + cogs_amount_egp) - total_amount_egp) <= 0.02));
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint);
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true);
    INSERT INTO accounting_settings (id, tenant_id, customer_receivable_account_id, supplier_payable_account_id, inventory_account_id, sales_revenue_account_id, cogs_account_id, clearing_account_id, updated_at) VALUES (1, 't1', 25, 22, 21, 26, 23, 27, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false);
    INSERT INTO branches VALUES (2, 't1', 'Main Branch');
    INSERT INTO stock_locations VALUES (10, 't1', 2, 'Main Warehouse');
    INSERT INTO suppliers VALUES (9, 't1', 'Demurrage Supplier', '', '', 0, true, NOW());
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'IMP-261109-0001', 'اختبار مشروع استيراد 001', 100, 'active', '{}');
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

async function seedShipment(
  db: Kysely<Database>,
  shipmentId: string,
  projectId: string | null,
  onHand: number,
): Promise<void> {
  await db.insertInto('products' as never).values({
    id: 5, tenant_id: 't1', account_id: 't1', name: 'P5',
    stock_qty: 10, reserved_qty: 0, cost_price: 500, updated_at: new Date(),
  } as never).execute();
  await db.insertInto('product_location_stock' as never).values({
    tenant_id: 't1', account_id: 't1', product_id: 5, branch_id: 2,
    location_id: 10, qty: 10, reserved_qty: 0,
  } as never).execute();
  await db.insertInto('import_shipments' as never).values({
    id: shipmentId, tenant_id: 't1', supplier_id: 9, project_id: projectId,
    container_number: `MSCU-${shipmentId}`, status: 'Arrived',
    cost_allocation_method: 'value',
    late_expenses_total_egp: 0, late_cogs_adjustment_egp: 0, late_inventory_adjustment_egp: 0,
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: `${shipmentId}-item`, tenant_id: 't1', shipment_id: shipmentId, product_id: 5,
    quantity: 10, received_quantity: 10, factory_unit_price_usd: 10,
    landed_cost_egp: 500, shortage_handling_method: 'capitalize',
    gross_weight_kg_unit: 1, cbm_unit: 0.1,
  } as never).execute();
  await db.insertInto('import_inventory_lots' as never).values({
    tenant_id: 't1', lot_number: `LOT-${shipmentId}`, project_id: projectId, shipment_id: shipmentId,
    shipment_item_id: `${shipmentId}-item`, product_id: 5, location_id: 10,
    initial_quantity: 10, remaining_quantity: onHand, unit_landed_cost_egp: 500,
    status: 'active', receipt_date: '2026-11-02', updated_at: new Date(),
  } as never).execute();
  await db.insertInto('import_inventory_receipts' as never).values({
    tenant_id: 't1', shipment_id: shipmentId, state: 'posted', review_reason: null,
    posted_at: new Date(), created_by: 1, journal_entry_id: null,
  } as never).execute();
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select(sql`count(*)`.as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function lateExpenseJournalLines(db: Kysely<Database>): Promise<any[]> {
  const event: any = await (db as any).selectFrom('import_late_expense_events').selectAll().executeTakeFirstOrThrow();
  const entry: any = await (db as any).selectFrom('journal_entries').selectAll()
    .where('id', '=', Number(event.journal_entry_id)).executeTakeFirstOrThrow();
  return (db as any).selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', entry.id).orderBy('id').execute();
}

async function main(): Promise<void> {
  // Case A: project-linked shipment — every late-expense JE line
  // carries the project cost centre; sold/on-hand split is exact.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 'proj-1', 6);
      const result = await service.processLateShipmentExpense('t1', 1, 'sh-1', {
        lateExpenseAmount: 1000, title: 'Demurrage', supplierId: 9,
      });
      assert.equal(result.success, true);
      assert.equal(result.allocation.lateExpenseAmount, 1000);
      assert.equal(result.allocation.lateCogsAdjustmentEgp, 400, '4 of 10 units sold -> 400 to COGS');
      assert.equal(result.allocation.lateInventoryAdjustmentEgp, 600, '6 of 10 units on hand -> 600 to inventory');
      const lines = await lateExpenseJournalLines(db);
      assert.equal(lines.length, 3, 'COGS debit + inventory debit + payable credit');
      const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      assert.equal(debit, 1000, 'Journal balances at the expense total');
      assert.equal(credit, 1000);
      const cogsLine = lines.find((l) => Number(l.account_id) === 23);
      const inventoryLine = lines.find((l) => Number(l.account_id) === 21);
      const payableLine = lines.find((l) => Number(l.account_id) === 22);
      assert.equal(Number(cogsLine.debit), 400);
      assert.equal(Number(inventoryLine.debit), 600);
      assert.equal(Number(payableLine.credit), 1000);
      assert.equal(Number(payableLine.partner_id), 9, 'Payable credit stays on the named payee');
      const centres: any[] = await (db as any).selectFrom('cost_centers').selectAll().execute();
      assert.equal(centres.length, 1, 'Exactly one project cost centre is created');
      assert.equal(centres[0].code, 'CC-IMP-261109-0001', 'Cost centre code follows the contracting pattern');
      assert.equal(centres[0].dimension, 'project');
      for (const line of lines) {
        assert.equal(Number(line.cost_center_id), Number(centres[0].id), `Line ${line.id} carries the project cost centre`);
      }
      console.log('Case A passed: project-linked late-expense JE carries the cost centre on every line');
    } finally {
      await db.destroy();
    }
  }

  // Case B: a shipment with no project still posts, with an honest
  // NULL cost centre on its lines (no invented centre).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', null, 10);
      const result = await service.processLateShipmentExpense('t1', 1, 'sh-1', {
        lateExpenseAmount: 1000, title: 'Demurrage', supplierId: 9,
      });
      assert.equal(result.success, true);
      const lines = await lateExpenseJournalLines(db);
      const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      assert.equal(debit, 1000, 'Project-less late expense still balances');
      assert.equal(credit, 1000);
      for (const line of lines) {
        assert.equal(line.cost_center_id, null, `Line ${line.id} has no invented cost centre`);
      }
      assert.equal(await countRows(db, 'cost_centers'), 0, 'No cost centre is invented for a project-less shipment');
      console.log('Case B passed: project-less late expense posts with NULL cost centre');
    } finally {
      await db.destroy();
    }
  }

  // Case C: a shipment whose project_id points at a missing project
  // row fails closed before any write.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 'proj-missing', 10);
      await assert.rejects(
        service.processLateShipmentExpense('t1', 1, 'sh-1', {
          lateExpenseAmount: 1000, title: 'Demurrage', supplierId: 9,
        }),
        /IMPORT_RECEIPT_PROJECT_NOT_FOUND/,
      );
      assert.equal(await countRows(db, 'journal_entries'), 0, 'No journal may exist after a refused posting');
      assert.equal(await countRows(db, 'import_late_expense_events'), 0, 'No late-expense event may exist after a refused posting');
      assert.equal(await countRows(db, 'stock_movements'), 0, 'No stock movement may exist after a refused posting');
      assert.equal(await countRows(db, 'cost_centers'), 0, 'No cost centre may be created by a refused posting');
      const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 5).executeTakeFirstOrThrow();
      assert.equal(Number(product.cost_price), 500, 'WAC stays untouched after a refused posting');
      console.log('Case C passed: dangling project reference fails closed with zero writes');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import late expense JE cost centre tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
