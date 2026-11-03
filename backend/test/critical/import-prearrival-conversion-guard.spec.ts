/*
New file: backend/test/critical/import-prearrival-conversion-guard.spec.ts
Pins the pre-arrival conversion guard (INV-IMPORT-PREARRIVAL-CONVERSION-GUARD).

WHAT WAS WRONG: convertPreorderToSale accepted reserved and allocated
preorders with no receipt or arrival guard at all. With no lot it
deducted stock with allowNegative: true and defaulted branch/location
to 1, credited inventory GL through the COGS pair for goods that
were never debited, and costed the sale at lot landed cost or
current WAC for units that never arrived.

WHAT THIS PINS, driving the real convertPreorderToSale on PGlite
through the real posting boundary:
- No posted receipt -> conversion is refused with
  IMPORT_PREORDER_CONVERSION_NO_POSTED_RECEIPT and zero writes:
  no sale, no journal, no stock movement; the preorder stays
  reserved and stock stays 0.
- A legacy_review_required (frozen, unposted) receipt is refused
  the same way.
- A posted receipt whose active lots no longer cover the preorder
  quantity is refused with
  IMPORT_PREORDER_CONVERSION_NOT_ALLOCATED: after a first
  conversion consumes 6 of 10 units, a second 6-unit preorder on
  the same shipment is blocked with the lot and the stock
  untouched.
- The allowed state (posted receipt + covering lots) converts:
  the sale and its balanced journal post (COGS exactly the lot
  landed cost), the preorder becomes invoiced, the lot and the
  stock decrease by the converted quantity, and the stock
  movement carries the true scope before/after quantities.
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
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, balance numeric);
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, customer_name text, customer_phone text, payment_type text, payment_channel text, subtotal numeric, discount numeric, tax_rate numeric, tax_amount numeric, total numeric, paid_amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, status text, note text, doc_no text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, cost_price numeric);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, status text, feasibility_data text);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE import_inventory_receipt_reversals (id bigserial PRIMARY KEY, tenant_id text, receipt_id bigint, shipment_id text, approval_request_id text, journal_entry_id bigint, reason text, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, receipt_id));
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, payment_method text, form4_number text);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id text PRIMARY KEY DEFAULT ('alloc-' || md5(random()::text)), tenant_id text, sale_id bigint, sale_item_id bigint, lot_id text, project_id text, shipment_id text, product_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, gross_margin_egp numeric, allocation_type text, reversal_of_allocation_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, agreed_unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text);
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text, barcode text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 25, 22, 21, 26, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
      (25, 't1', 't1', '1120', 'عملاء', 'Receivables', 'asset', 'assets', true, false, false, false, true, false),
      (26, 't1', 't1', '4100', 'إيراد مبيعات', 'Sales revenue', 'revenue', 'income', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO customers VALUES (1, 't1', 'عميل الحجز', '01000000000', 0);
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO branches VALUES (1, 't1', 'Main Branch');
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'active', '{}');
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', 'W-1', NULL, 0, 0, 0, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES
      ('t1', 't1', 1, NULL, 10, 0, 0),
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

async function seedShipment(db: Kysely<Database>): Promise<void> {
  await db.insertInto('import_shipments' as never).values({
    id: 'sh-1', tenant_id: 't1', container_number: 'C1', supplier_id: 1, status: 'Pending',
    exchange_rate_at_arrival: 50, cost_allocation_method: 'value', project_id: 'proj-1',
    shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: 'sh-1-item', tenant_id: 't1', shipment_id: 'sh-1', product_id: 1,
    quantity: 10, factory_unit_price_usd: 50, shortage_handling_method: 'capitalize',
  } as never).execute();
}

async function seedPreorder(db: Kysely<Database>, preorderNo: string, qty: number): Promise<string> {
  const row: any = await (db as any).insertInto('import_container_preorders').values({
    tenant_id: 't1', preorder_no: preorderNo, shipment_id: 'sh-1', customer_id: 1,
    product_id: 1, reserved_quantity: qty, unit_price_egp: 3000,
    total_price_egp: qty * 3000, deposit_amount_egp: 0, status: 'reserved',
  }).returning('id').executeTakeFirstOrThrow();
  return String(row.id);
}

async function postReceipt(db: Kysely<Database>, service: any): Promise<void> {
  await service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10 });
  const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('shipment_id', '=', 'sh-1').executeTakeFirstOrThrow();
  assert.equal(receipt.state, 'posted');
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select(sql`count(*)`.as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function getPreorder(db: Kysely<Database>, id: string): Promise<any> {
  return (db as any).selectFrom('import_container_preorders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function getLot(db: Kysely<Database>): Promise<any> {
  return (db as any).selectFrom('import_inventory_lots').selectAll().where('shipment_id', '=', 'sh-1').executeTakeFirstOrThrow();
}

async function getProduct(db: Kysely<Database>): Promise<any> {
  return (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
}

async function main(): Promise<void> {
  // Case 1: no receipt at all -> refused, zero writes.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const preorderId = await seedPreorder(db, 'PO-1', 4);
      await assert.rejects(
        service.convertPreorderToSale('t1', 1, preorderId, {}),
        /IMPORT_PREORDER_CONVERSION_NO_POSTED_RECEIPT/,
      );
      assert.equal(await countRows(db, 'sales'), 0, 'No sale may be written by a refused conversion');
      assert.equal(await countRows(db, 'journal_entries'), 0, 'No journal may be written by a refused conversion');
      assert.equal(await countRows(db, 'stock_movements'), 0, 'No stock movement may be written by a refused conversion');
      assert.equal((await getPreorder(db, preorderId)).status, 'reserved');
      assert.equal(Number((await getProduct(db)).stock_qty), 0);
      console.log('Case 1 passed: no-receipt conversion refused with zero writes');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: frozen legacy receipt (unposted) -> refused the same way.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const preorderId = await seedPreorder(db, 'PO-1', 4);
      await (db as any).insertInto('import_inventory_receipts').values({
        tenant_id: 't1', shipment_id: 'sh-1', state: 'legacy_review_required',
        review_reason: 'legacy', posted_at: null, created_by: 1,
      }).execute();
      await assert.rejects(
        service.convertPreorderToSale('t1', 1, preorderId, {}),
        /IMPORT_PREORDER_CONVERSION_NO_POSTED_RECEIPT/,
      );
      assert.equal(await countRows(db, 'sales'), 0);
      assert.equal(await countRows(db, 'journal_entries'), 0);
      assert.equal((await getPreorder(db, preorderId)).status, 'reserved');
      console.log('Case 2 passed: legacy-review receipt does not satisfy the guard');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: posted receipt, lots exhausted by a first conversion -> second blocked.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const firstId = await seedPreorder(db, 'PO-1', 6);
      await postReceipt(db, service);
      assert.equal(Number((await getLot(db)).remaining_quantity), 10);
      const first = await service.convertPreorderToSale('t1', 1, firstId, {});
      assert.equal(Number((await getLot(db)).remaining_quantity), 4, 'First conversion consumes 6 of 10 lot units');
      // A preorder created after posting (still 'reserved', never flipped
      // to 'allocated') is governed by the same lot coverage, not by
      // its status: 6 requested against 4 remaining must be refused.
      const secondId = await seedPreorder(db, 'PO-2', 6);
      await assert.rejects(
        service.convertPreorderToSale('t1', 1, secondId, {}),
        /IMPORT_PREORDER_CONVERSION_NOT_ALLOCATED/,
      );
      assert.equal(await countRows(db, 'sales'), 1, 'Only the first conversion wrote a sale');
      assert.equal(Number((await getLot(db)).remaining_quantity), 4, 'Refused conversion leaves the lot untouched');
      assert.equal(Number((await getProduct(db)).stock_qty), 4, 'Refused conversion leaves stock untouched');
      assert.equal((await getPreorder(db, secondId)).status, 'reserved', 'Second preorder stays reserved, not invoiced');
      assert.equal(first.total, 18000);
      console.log('Case 3 passed: under-allocated conversion refused after partial consumption');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: posted receipt + covering lots -> converts with a balanced journal and true movement quantities.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const preorderId = await seedPreorder(db, 'PO-1', 4);
      await postReceipt(db, service);
      const result = await service.convertPreorderToSale('t1', 1, preorderId, {});
      assert.equal(result.total, 12000);
      assert.equal((await getPreorder(db, preorderId)).status, 'invoiced');
      assert.equal(Number((await getPreorder(db, preorderId)).sale_invoice_id), result.saleId);
      assert.equal(Number((await getLot(db)).remaining_quantity), 6);
      assert.equal(Number((await getProduct(db)).stock_qty), 6);
      const movement: any = await (db as any).selectFrom('stock_movements').selectAll()
        .where('reference_type', '=', 'sale').where('reference_id', '=', result.saleId).executeTakeFirstOrThrow();
      assert.equal(Number(movement.qty), -4);
      assert.equal(Number(movement.before_qty), 10, 'Movement stamps the true scope quantity before deduction');
      assert.equal(Number(movement.after_qty), 6, 'Movement stamps the true scope quantity after deduction');
      const lines: any[] = await (db as any).selectFrom('journal_entry_lines').selectAll()
        .where('journal_entry_id', '=', (await (db as any).selectFrom('journal_entries').select('id').where('source_type', '=', 'sale').where('source_id', '=', result.saleId).executeTakeFirstOrThrow()).id)
        .execute();
      const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      assert.equal(debit, credit, 'Conversion journal must balance');
      assert.equal(debit, 22000, 'Revenue 12000 + COGS 10000');
      const cogs = lines.find((l) => Number(l.account_id) === 23);
      assert.equal(Number(cogs.debit), 10000, 'COGS is exactly the lot landed cost: 4 x 2500');
      const inventory = lines.find((l) => Number(l.account_id) === 21);
      assert.equal(Number(inventory.credit), 10000, 'Inventory credit mirrors COGS');
      console.log('Case 4 passed: allowed conversion posts a balanced journal at lot cost with true movement quantities');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import pre-arrival conversion guard tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
