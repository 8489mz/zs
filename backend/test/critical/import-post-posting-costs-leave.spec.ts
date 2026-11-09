/*
New file: backend/test/critical/import-post-posting-costs-leave.spec.ts
Pins the post-posting cost LEAVE (INV-IMPORT-POST-POSTING-COSTS-LEAVE).

WHAT WAS DECIDED (Slice 3 P3 LEAVE, confirmed): a cost difference
that lands AFTER a receipt is posted never silently reprices the
posted stock. The approved revaluation (late expenses / broker
capitalisation, IAS 2) is the ONLY path that moves posted costs,
and it moves them openly: the sold share to COGS, the on-hand
share to inventory/WAC/lots, always with its balanced journal.
Every other cost edit is frozen once the receipt exists, and a
closed accounting period blocks every posting outright. Routing
late costs to a 5190 variance account instead would misstate
both inventory and COGS, so no variance path is introduced.

WHAT THIS PINS, driving the real service on PGlite through the
real posting boundary:
- After posting, every recalculation/edit entry fails closed and
  leaves the stored item landed cost, the lot unit cost and the
  WAC unchanged to the cent: calculateLandedCost, a cost edit
  through updateShipmentCosts, a received-quantity edit through
  updateShipmentItem, and addShipmentItem. No new journal is
  written by any of the four attempts.
- When every unit is sold, a late expense moves NOTHING in WAC
  or lots: the whole amount posts to COGS against the named
  payee with a balanced journal carrying no inventory leg, and
  the WAC and the lot unit cost stay exactly at the posted
  landed cost. (The shipment ITEM's stored landed cost is a
  historical record that the revaluation increments by design;
  no WAC or lot math reads it, so it is not pinned here.)
- A closed accounting period blocks a late-expense posting
  outright (ACCOUNTING_PERIOD_LOCKED) with zero writes: no
  journal, no event, WAC and lots untouched. Prospective only;
  nothing already posted is rewritten.
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
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, balance numeric);
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, customer_name text, customer_phone text, payment_type text, payment_channel text, subtotal numeric, discount numeric, tax_rate numeric, tax_amount numeric, total numeric, paid_amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, status text, note text, doc_no text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, cost_price numeric);
    CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, code text, name text, dimension text, budget_amount numeric, parent_id bigint, is_active boolean, description text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), CONSTRAINT uq_cost_centers_tenant_code UNIQUE (tenant_id, code));
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, project_no text, title text, allocated_capital numeric, status text, feasibility_data text);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, freight_supplier_id bigint, customs_supplier_id bigint, transport_supplier_id bigint, demurrage_supplier_id bigint, unallocable_cost_reason text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE import_inventory_receipt_reversals (id bigserial PRIMARY KEY, tenant_id text, receipt_id bigint, shipment_id text, approval_request_id text, journal_entry_id bigint, reason text, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, receipt_id));
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, payment_method text, form4_number text);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id text PRIMARY KEY DEFAULT ('alloc-' || md5(random()::text)), tenant_id text, sale_id bigint, sale_item_id bigint, lot_id text, project_id text, shipment_id text, product_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, gross_margin_egp numeric, allocation_type text, reversal_of_allocation_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, agreed_unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text, supplier_id bigint, unallocable_reason text);
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text, barcode text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings (id, tenant_id, customer_receivable_account_id, supplier_payable_account_id, inventory_account_id, sales_revenue_account_id, cogs_account_id, clearing_account_id, updated_at) VALUES (1, 't1', 25, 22, 21, 26, 23, 27, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
      (25, 't1', 't1', '1120', 'عملاء', 'Receivables', 'asset', 'assets', true, false, false, false, true, false),
      (26, 't1', 't1', '4100', 'إيراد مبيعات', 'Sales revenue', 'revenue', 'income', true, false, false, false, false, false),
      (27, 't1', 't1', '2190', 'حساب تسوية', 'Clearing', 'liability', 'liabilities', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES
      (1, 't1', 't1', 'Goods Supplier', '', '', 0, true, NOW()),
      (2, 't1', 't1', 'Carrier', '', '', 0, true, NOW());
    INSERT INTO customers VALUES (1, 't1', 'عميل الحجز', '01000000000', 0);
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO branches VALUES (1, 't1', 'Main Branch');
    INSERT INTO import_projects (id, tenant_id, project_no, title, allocated_capital, status, feasibility_data) VALUES ('proj-1', 't1', 'IMP-261109-0001', 'اختبار مشروع استيراد 001', 100, 'active', '{}');
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

async function postReceipt(db: Kysely<Database>, service: any): Promise<void> {
  await service.updateShipmentCosts('t1', 1, 'sh-1', {
    status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10,
    shippingCostUsd: 100, customsCostEgp: 2000, internalTransportCostEgp: 1000,
    freightSupplierId: 2, customsSupplierId: 2, transportSupplierId: 2,
  });
  const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('shipment_id', '=', 'sh-1').executeTakeFirstOrThrow();
  assert.equal(receipt.state, 'posted');
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select(sql`count(*)`.as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function snapshotCosts(db: Kysely<Database>): Promise<{ item: number; lot: number; wac: number; stock: number }> {
  const item: any = await (db as any).selectFrom('import_shipment_items').selectAll().where('id', '=', 'sh-1-item').executeTakeFirstOrThrow();
  const lot: any = await (db as any).selectFrom('import_inventory_lots').selectAll().where('shipment_id', '=', 'sh-1').executeTakeFirstOrThrow();
  const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
  return { item: Number(item.landed_cost_egp), lot: Number(lot.unit_landed_cost_egp), wac: Number(product.cost_price), stock: Number(product.stock_qty) };
}

async function main(): Promise<void> {
  // Case 1: every recalculation/edit entry fails closed after posting, costs unchanged to the cent.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      await postReceipt(db, service);
      const before = await snapshotCosts(db);
      assert.deepEqual(before, { item: 3300, lot: 3300, wac: 3300, stock: 10 }, 'Posted landed cost is the full landed value');
      await assert.rejects(service.calculateLandedCost('t1', 'sh-1'), /تم ترحيل الشحنة/);
      await assert.rejects(
        service.updateShipmentCosts('t1', 1, 'sh-1', { customsCostEgp: 3000 }),
        /تم ترحيل الشحنة/,
      );
      await assert.rejects(
        service.updateShipmentItem('t1', 'sh-1-item', { receivedQuantity: 9 }),
        /تم ترحيل الشحنة/,
      );
      await assert.rejects(
        service.addShipmentItem('t1', 'sh-1', { productId: '1', quantity: 1, factoryUnitPriceUsd: 50 }),
        /تم ترحيل الشحنة/,
      );
      assert.deepEqual(await snapshotCosts(db), before, 'No edit attempt may move a posted cost by a cent');
      assert.equal(await countRows(db, 'journal_entries'), 1, 'Only the receipt journal exists');
      console.log('Case 1 passed: post-posting recalculation and edits fail closed with costs frozen');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: with everything sold, a late expense touches neither WAC nor lots.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const preorder: any = await (db as any).insertInto('import_container_preorders').values({
        tenant_id: 't1', preorder_no: 'PO-1', shipment_id: 'sh-1', customer_id: 1,
        product_id: 1, reserved_quantity: 10, unit_price_egp: 3000,
        total_price_egp: 30000, deposit_amount_egp: 0, status: 'reserved',
      }).returning('id').executeTakeFirstOrThrow();
      await postReceipt(db, service);
      await service.convertPreorderToSale('t1', 1, String(preorder.id), {});
      const sold = await snapshotCosts(db);
      assert.equal(sold.stock, 0, 'All units sold before the late expense');
      const result = await service.processLateShipmentExpense('t1', 1, 'sh-1', {
        lateExpenseAmount: 1000, title: 'Demurrage', supplierId: 2, idempotencyKey: 'leave-sold-1',
      });
      assert.equal(result.success, true);
      assert.equal(result.allocation.lateCogsAdjustmentEgp, 1000, 'The whole late expense lands on COGS');
      assert.equal(result.allocation.lateInventoryAdjustmentEgp, 0, 'Nothing capitalises when nothing is on hand');
      const after = await snapshotCosts(db);
      assert.equal(after.wac, 3300, 'WAC unchanged to the cent when everything is sold');
      assert.equal(after.lot, 3300, 'Posted lot unit cost unchanged to the cent');
      const lines: any[] = await (db as any).selectFrom('journal_entry_lines').selectAll()
        .where('journal_entry_id', '=', (await (db as any).selectFrom('journal_entries').select('id').where('source_type', '=', 'import_late_expense').executeTakeFirstOrThrow()).id)
        .execute();
      const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      assert.equal(debit, credit, 'Late-expense journal balances');
      assert.equal(debit, 1000, 'COGS 1000 against the named payee, no inventory leg');
      assert.equal(lines.filter((l) => Number(l.account_id) === 21).length, 0, 'No inventory line when nothing is on hand');
      const payable = lines.find((l) => Number(l.credit) > 0);
      assert.equal(Number(payable.partner_id), 2, 'Credit carries the named payee');
      console.log('Case 2 passed: fully-sold late expense leaves WAC and lots untouched');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a closed accounting period blocks the revaluation outright, with zero writes.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      await postReceipt(db, service);
      const before = await snapshotCosts(db);
      await (db as any).updateTable('accounting_settings').set({ lock_date_all: '2999-12-31' }).where('id', '=', 1).execute();
      await assert.rejects(
        service.processLateShipmentExpense('t1', 1, 'sh-1', {
          lateExpenseAmount: 1000, title: 'Demurrage', supplierId: 2, idempotencyKey: 'leave-locked-1',
        }),
        (err: any) => err?.code === 'ACCOUNTING_PERIOD_LOCKED',
        'A posting into a locked period must carry the period-lock code',
      );
      assert.deepEqual(await snapshotCosts(db), before, 'A locked-period attempt moves no cost');
      assert.equal(await countRows(db, 'journal_entries'), 1, 'Only the receipt journal exists');
      assert.equal(await countRows(db, 'import_late_expense_events'), 0, 'No late-expense event may be recorded');
      console.log('Case 3 passed: closed period blocks post-posting cost differences with zero writes');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import post-posting costs leave tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
