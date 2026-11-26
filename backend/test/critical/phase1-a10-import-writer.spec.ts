/*
 * Phase 1 A10 — import receipt sites through the writer (INV-PHASE1-A10-ROUNDING-UNIFICATION).
 *
 * The two A9-deferred receipt-posting sites (:339 posting, :701
 * reversal) now go through recordStockMovement on the unified rounding
 * (the writer-level proof is phase1-a10-rounding.spec.ts; this spec
 * drives the REAL ImportSalesService on PGlite):
 * - Posting stores the book-rounded group value as the movement total
 *   (25000 here) with the 6dp stored unit (2500), computed by the
 *   writer from the full-precision value / qty — not from the 6dp unit.
 * - Reversal reads the ORIGINAL rows' stored totals, so the reversal
 *   total equals the original total exactly (25000 == 25000), the
 *   balances return to their pre-receipt values, and exactly one row
 *   is written per leg.
 *
 * Harness: copied verbatim from import-receipt-reversal.spec.ts
 * (makeDb, makeService, seedShipment, postReceipt, insertApproval,
 * readers, REVERSAL_DTO) — that spec stays green in the regression
 * loop and pins the journal/WAC/lot/preorder halves of the same cycle.
 * The 42.88 EGP / 42.875 KWD receipt pins live in
 * import-inventory-cost-wac.spec.ts (also in the loop).
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
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, code text, name text, dimension text, budget_amount numeric, parent_id bigint, is_active boolean, description text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), CONSTRAINT uq_cost_centers_tenant_code UNIQUE (tenant_id, code));
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, project_no text, title text, allocated_capital numeric, status text, feasibility_data text);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE import_inventory_receipt_reversals (id bigserial PRIMARY KEY, tenant_id text, receipt_id bigint, shipment_id text, approval_request_id text, journal_entry_id bigint, reason text, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, receipt_id));
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, payment_method text, form4_number text);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text);
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO import_projects (id, tenant_id, project_no, title, allocated_capital, status, feasibility_data) VALUES ('proj-1', 't1', 'IMP-261109-0001', 'اختبار مشروع استيراد 001', 100, 'active', '{}');
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', 10, 0, 2000, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES
      ('t1', 't1', 1, NULL, 10, 10, 0),
      ('t1', 't1', 1, NULL, NULL, 0, 0);
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

async function seedShipment(db: Kysely<Database>, projectStatus: string): Promise<void> {
  await (db as any).updateTable('import_projects').set({ status: projectStatus }).where('id', '=', 'proj-1').execute();
  await db
    .insertInto('import_shipments' as never)
    .values({
      id: 'sh-1',
      tenant_id: 't1',
      container_number: 'C1',
      supplier_id: 1,
      status: 'Pending',
      exchange_rate_at_arrival: 50,
      cost_allocation_method: 'value',
      project_id: 'proj-1',
      shipping_cost_usd: 0,
      customs_cost_egp: 0,
      internal_transport_cost_egp: 0,
    } as never)
    .execute();
  await db
    .insertInto('import_shipment_items' as never)
    .values({
      id: 'sh-1-item',
      tenant_id: 't1',
      shipment_id: 'sh-1',
      product_id: 1,
      quantity: 10,
      factory_unit_price_usd: 50,
      shortage_handling_method: 'capitalize',
    } as never)
    .execute();
  await db
    .insertInto('import_container_preorders' as never)
    .values({
      tenant_id: 't1',
      preorder_no: 'PO-1',
      shipment_id: 'sh-1',
      customer_id: 1,
      product_id: 1,
      reserved_quantity: 4,
      status: 'reserved',
    } as never)
    .execute();
}

/** Posts the receipt through the real costs path; returns the receipt id. */
async function postReceipt(db: Kysely<Database>, service: any): Promise<number> {
  await service.updateShipmentCosts('t1', 1, 'sh-1', {
    status: 'Arrived',
    exchangeRateAtArrival: 50,
    receiptLocationId: 10,
  });
  const receipt: any = await (db as any)
    .selectFrom('import_inventory_receipts')
    .selectAll()
    .where('shipment_id', '=', 'sh-1')
    .executeTakeFirstOrThrow();
  return Number(receipt.id);
}

async function insertApproval(
  db: Kysely<Database>,
  id: string,
  actionType: string,
  shipmentId: string,
  receiptId: number,
): Promise<void> {
  await db
    .insertInto('import_approval_requests' as never)
    .values({
      id,
      tenant_id: 't1',
      module: 'import',
      action_type: actionType,
      reference_id: shipmentId,
      requested_by: 99,
      created_by: 99,
      status: 'approved',
      request_payload: JSON.stringify({ shipmentId, receiptId: String(receiptId) }),
    } as never)
    .execute();
}

async function readProduct(db: Kysely<Database>): Promise<any> {
  return (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
}

async function readLocationQty(db: Kysely<Database>): Promise<number> {
  const row: any = await (db as any)
    .selectFrom('product_location_stock')
    .select('qty')
    .where('product_id', '=', 1)
    .where('location_id', '=', 10)
    .executeTakeFirstOrThrow();
  return Number(row.qty);
}

async function approvalStatus(db: Kysely<Database>, id: string): Promise<string> {
  const row: any = await (db as any)
    .selectFrom('import_approval_requests')
    .select('status')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return row.status;
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any)
    .selectFrom(table)
    .select((eb: any) => eb.fn.countAll().as('c'))
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

const REVERSAL_DTO = (approvalRequestId: string) => ({
  approvalRequestId,
  reason: 'Wrong receiving location recorded',
});

async function readMovements(db: Kysely<Database>, receiptId: number): Promise<Array<Record<string, unknown>>> {
  return (await (db as any)
    .selectFrom('stock_movements')
    .select(['movement_type', 'qty', 'unit_cost', 'total_cost'])
    .where('reference_type', '=', 'import_inventory_receipt')
    .where('reference_id', '=', receiptId)
    .orderBy('id', 'asc')
    .execute()) as unknown as Array<Record<string, unknown>>;
}

async function main(): Promise<void> {
  // Case 1: post then reverse through the real service — the posting
  // row stores the book-rounded group value (25000) with the 6dp unit
  // (2500); the reversal row stores the same total; balances return.
  {
    const db = await makeDb();
    const service = makeService(db);
    await seedShipment(db, 'active');
    const receiptId = await postReceipt(db, service);
    const posted = await readMovements(db, receiptId);
    assert.equal(posted.length, 1, 'posting writes exactly one movement row');
    assert.equal(posted[0].movement_type, 'import_receipt');
    assert.equal(Number(posted[0].qty), 10);
    assert.equal(Number(posted[0].unit_cost), 2500, 'stored unit is the 6dp value/qty');
    assert.equal(Number(posted[0].total_cost), 25000, 'stored total is the book-rounded group value');
    assert.equal(Number((await readProduct(db)).stock_qty), 20, 'posting adds the receipt to stock');
    assert.equal(await readLocationQty(db), 20, 'location balance carries the receipt');

    await insertApproval(db, 'appr-1', 'import_receipt_reversal', 'sh-1', receiptId);
    await service.reversePostedReceipt('t1', 1, 'sh-1', REVERSAL_DTO('appr-1'));
    const after = await readMovements(db, receiptId);
    assert.equal(after.length, 2, 'reversal adds exactly one more row');
    assert.equal(after[1].movement_type, 'import_receipt_reversal');
    assert.equal(Number(after[1].qty), -10);
    assert.equal(Number(after[1].unit_cost), 2500, 'reversal unit mirrors the original row');
    assert.equal(
      Number(after[1].total_cost),
      Number(after[0].total_cost),
      'reversal total equals the original total exactly',
    );
    assert.equal(Number((await readProduct(db)).stock_qty), 10, 'stock returns to its pre-receipt value');
    assert.equal(Number((await readProduct(db)).cost_price), 2000, 'WAC returns to the pre-receipt cost');
    assert.equal(await readLocationQty(db), 10, 'location balance returns to its pre-receipt value');
    assert.equal(await approvalStatus(db, 'appr-1'), 'executed', 'the approval token is consumed (marked executed)');
  }

  // Case 2: the round-trip is total-identical at the row level — the
  // sum of the two rows' totals is the original total plus its exact
  // mirror, and no other movement rows exist for the receipt.
  {
    const db = await makeDb();
    const service = makeService(db);
    await seedShipment(db, 'active');
    const receiptId = await postReceipt(db, service);
    await insertApproval(db, 'appr-2', 'import_receipt_reversal', 'sh-1', receiptId);
    await service.reversePostedReceipt('t1', 1, 'sh-1', REVERSAL_DTO('appr-2'));
    const rows = await readMovements(db, receiptId);
    assert.equal(rows.length, 2, 'exactly the posting row and the reversal row');
    assert.equal(Number(rows[0].total_cost) + Number(rows[1].total_cost), 50000, '25000 posted + 25000 reversed');
    assert.equal(Number(rows[0].qty) + Number(rows[1].qty), 0, 'quantities net to zero');
    assert.equal(await countRows(db, 'stock_movements'), 2, 'no other movement rows exist');
  }
}

main()
  .then(() => {
    console.log('phase1-a10-import-writer.spec: PASS');
    process.exit(0);
  })
  .catch((err) => {
    console.error('phase1-a10-import-writer.spec: FAIL');
    console.error(err);
    process.exit(1);
  });
