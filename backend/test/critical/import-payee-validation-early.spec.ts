/*
New file: backend/test/critical/import-payee-validation-early.spec.ts
Pins early payee validation for import cost components
(INV-IMPORT-PAYEE-VALIDATION-EARLY, I1-P5).

WHAT WAS WRONG (seen live 2026-11-09, trial problem 5): costs saved
fine with "غير محدد" payees; the failure
(IMPORT_COMPONENT_PAYEE_REQUIRED) appeared only AFTER confirming
the irreversible arrival modal, so the user had to go back, assign
payees, and re-run the confirmation. The arrival path already
resolved payees, but nothing validated them on the cost-save path.

WHAT THIS PINS, driving the real updateShipmentCosts on PGlite
through the real posting boundary:
- Saving a nonzero cost component with no payee and no recorded
  unallocable reason fails immediately with
  IMPORT_COMPONENT_PAYEE_REQUIRED naming the component (freight
  first), and the stored costs are left untouched: no journal, no
  receipt, no expense row.
- Saving with all payees set succeeds and stores the costs and
  the payees.
- An arrival confirm with a missing payee (legacy stored costs,
  null payees) rejects BEFORE any write: no receipt, no journal,
  no stock movement, stock stays zero, status stays Pending.
- Zero-amount components need no payee: a save that triggers
  validation with all costs zero succeeds, and the arrival then
  posts a goods-only receipt.
- A recorded unallocable reason covers a nonzero component at
  save time, and the arrival then posts that component to
  clearing, labelled with the reason.
- A broker-folded component needs no payee at save time (its net
  weight is zero, exactly as the arrival split treats it), and
  lowering a bucket below its folded sum still fails on the
  broker floor, not on the payee.
- The arrival rate keeps precedence: an Arrived call with no rate
  fails on IMPORT_ARRIVAL_RATE_REQUIRED even when payees are
  also missing.
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
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, status text, feasibility_data text);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, freight_supplier_id bigint, customs_supplier_id bigint, transport_supplier_id bigint, demurrage_supplier_id bigint, unallocable_cost_reason text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE import_inventory_receipt_reversals (id bigserial PRIMARY KEY, tenant_id text, receipt_id bigint, shipment_id text, approval_request_id text, journal_entry_id bigint, reason text, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, receipt_id));
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, payment_method text, form4_number text);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id text PRIMARY KEY DEFAULT ('alloc-' || md5(random()::text)), tenant_id text, sale_id bigint, sale_item_id bigint, lot_id text, project_id text, shipment_id text, product_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, gross_margin_egp numeric, allocation_type text, reversal_of_allocation_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text, supplier_id bigint, unallocable_reason text);
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
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
      (2, 't1', 't1', 'Carrier', '', '', 0, true, NOW()),
      (3, 't1', 't1', 'Customs Broker', '', '', 0, true, NOW()),
      (4, 't1', 't1', 'Transporter', '', '', 0, true, NOW());
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

async function seedShipment(
  db: Kysely<Database>,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db.insertInto('import_shipments' as never).values({
    id: 'sh-1', tenant_id: 't1', container_number: 'C1', supplier_id: 1, status: 'Pending',
    exchange_rate_at_arrival: 50, cost_allocation_method: 'value', project_id: 'proj-1',
    shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
    ...overrides,
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: 'sh-1-item', tenant_id: 't1', shipment_id: 'sh-1', product_id: 1,
    quantity: 10, factory_unit_price_usd: 50, shortage_handling_method: 'capitalize',
  } as never).execute();
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select(sql`count(*)`.as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function readShipment(db: Kysely<Database>): Promise<any> {
  return (db as any).selectFrom('import_shipments').selectAll().where('id', '=', 'sh-1').executeTakeFirstOrThrow();
}

function rejectsWithPayeeFor(label: string): (err: any) => boolean {
  return (err: any) => {
    assert.match(String(err?.message || err), /IMPORT_COMPONENT_PAYEE_REQUIRED/);
    assert.match(String(err?.message || err), new RegExp(label));
    return true;
  };
}

async function main(): Promise<void> {
  // Case A: saving nonzero costs with no payee fails immediately,
  // naming the first unattributed component, and stores nothing.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      await assert.rejects(
        service.updateShipmentCosts('t1', 1, 'sh-1', {
          shippingCostUsd: 100, customsCostEgp: 2000, internalTransportCostEgp: 1000,
        }),
        rejectsWithPayeeFor('شحن بحري'),
        'The trial defect: costs saved fine with "غير محدد" payees',
      );
      const stored = await readShipment(db);
      assert.equal(Number(stored.shipping_cost_usd), 0, 'The rejected save leaves the freight cost untouched');
      assert.equal(Number(stored.customs_cost_egp), 0, 'The rejected save leaves the customs cost untouched');
      assert.equal(Number(stored.internal_transport_cost_egp), 0, 'The rejected save leaves the transport cost untouched');
      assert.equal(await countRows(db, 'journal_entries'), 0, 'No journal may exist after a refused save');
      assert.equal(await countRows(db, 'import_inventory_receipts'), 0, 'No receipt may exist after a refused save');
      // A payee id that is not a tenant supplier fails the same way.
      await assert.rejects(
        service.updateShipmentCosts('t1', 1, 'sh-1', {
          shippingCostUsd: 100, freightSupplierId: 999,
        }),
        /IMPORT_COMPONENT_PAYEE_REQUIRED/,
        'A nonexistent payee is not a payee',
      );
      // Clearing the payee of a nonzero component is blocked too.
      await service.updateShipmentCosts('t1', 1, 'sh-1', {
        shippingCostUsd: 100, customsCostEgp: 2000, internalTransportCostEgp: 1000,
        freightSupplierId: 2, customsSupplierId: 3, transportSupplierId: 4,
      });
      await assert.rejects(
        service.updateShipmentCosts('t1', 1, 'sh-1', { freightSupplierId: null as any }),
        /IMPORT_COMPONENT_PAYEE_REQUIRED/,
        'Removing the freight payee while freight is nonzero must fail at save time',
      );
      const kept = await readShipment(db);
      assert.equal(Number(kept.freight_supplier_id), 2, 'The rejected clear leaves the stored payee untouched');
      console.log('Case A passed: missing-payee cost save fails immediately, naming the component');
    } finally {
      await db.destroy();
    }
  }

  // Case B: saving with all payees set succeeds and stores them.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const updated = await service.updateShipmentCosts('t1', 1, 'sh-1', {
        shippingCostUsd: 100, customsCostEgp: 2000, internalTransportCostEgp: 1000,
        freightSupplierId: 2, customsSupplierId: 3, transportSupplierId: 4,
      });
      assert.equal(Number(updated.shipping_cost_usd), 100, 'Freight cost stored');
      assert.equal(Number(updated.customs_cost_egp), 2000, 'Customs cost stored');
      assert.equal(Number(updated.internal_transport_cost_egp), 1000, 'Transport cost stored');
      assert.equal(Number(updated.freight_supplier_id), 2, 'Freight payee stored');
      assert.equal(Number(updated.customs_supplier_id), 3, 'Customs payee stored');
      assert.equal(Number(updated.transport_supplier_id), 4, 'Transport payee stored');
      console.log('Case B passed: fully attributed cost save succeeds');
    } finally {
      await db.destroy();
    }
  }

  // Case C: the arrival confirm with a missing payee (legacy stored
  // costs, null payees) rejects BEFORE any write.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, {
        shipping_cost_usd: 100, customs_cost_egp: 2000, internal_transport_cost_egp: 1000,
      });
      await assert.rejects(
        service.updateShipmentCosts('t1', 1, 'sh-1', {
          status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10,
          freightSupplierId: 2, transportSupplierId: 4,
        }),
        rejectsWithPayeeFor('جمارك وتخليص'),
        'The confirm must name the missing customs payee before posting anything',
      );
      assert.equal(await countRows(db, 'import_inventory_receipts'), 0, 'No receipt may exist after a refused confirm');
      assert.equal(await countRows(db, 'journal_entries'), 0, 'No journal may exist after a refused confirm');
      assert.equal(await countRows(db, 'stock_movements'), 0, 'No stock movement may exist after a refused confirm');
      const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(product.stock_qty), 0, 'Stock stays zero after a refused confirm');
      const stored = await readShipment(db);
      assert.equal(stored.status, 'Pending', 'The refused confirm leaves the status unchanged');
      console.log('Case C passed: arrival confirm with a missing payee rejects before any write');
    } finally {
      await db.destroy();
    }
  }

  // Case D: zero-amount components need no payee; the arrival then
  // posts a goods-only receipt.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      // A rate change triggers validation while every cost is zero.
      const updated = await service.updateShipmentCosts('t1', 1, 'sh-1', { exchangeRateAtArrival: 51 });
      assert.equal(Number(updated.exchange_rate_at_arrival), 51, 'The rate save succeeds with zero costs and no payees');
      await service.updateShipmentCosts('t1', 1, 'sh-1', {
        status: 'Arrived', exchangeRateAtArrival: 51, receiptLocationId: 10,
      });
      const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('shipment_id', '=', 'sh-1').executeTakeFirstOrThrow();
      assert.equal(receipt.state, 'posted', 'Goods-only receipt posts with no payees to attribute');
      const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(product.stock_qty), 10, 'Stock increases on the posted receipt');
      console.log('Case D passed: zero-amount components save and post without payees');
    } finally {
      await db.destroy();
    }
  }

  // Case E: a recorded unallocable reason covers a nonzero component
  // at save time, and the arrival posts it to clearing, labelled.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const updated = await service.updateShipmentCosts('t1', 1, 'sh-1', {
        shippingCostUsd: 100, customsCostEgp: 2000, internalTransportCostEgp: 1000,
        freightSupplierId: 2, transportSupplierId: 4,
        unallocableCostReason: 'رسوم ميناء بلا فاتورة مورد محدد',
      });
      assert.equal(Number(updated.customs_cost_egp), 2000, 'The customs cost saves under the recorded reason');
      assert.equal(updated.unallocable_cost_reason, 'رسوم ميناء بلا فاتورة مورد محدد', 'The reason is stored');
      await service.updateShipmentCosts('t1', 1, 'sh-1', {
        status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10,
      });
      const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('shipment_id', '=', 'sh-1').executeTakeFirstOrThrow();
      assert.equal(receipt.state, 'posted');
      const entry: any = await (db as any).selectFrom('journal_entries').selectAll()
        .where('source_type', '=', 'import_inventory_receipt').executeTakeFirstOrThrow();
      const lines: any[] = await (db as any).selectFrom('journal_entry_lines').selectAll()
        .where('journal_entry_id', '=', entry.id).execute();
      const clearingLines = lines.filter((l) => Number(l.account_id) === 27);
      assert.equal(clearingLines.length, 1, 'Exactly one clearing line');
      assert.equal(Number(clearingLines[0].credit), 2000, 'Clearing carries the customs amount');
      assert.match(String(clearingLines[0].description), /رسوم ميناء بلا فاتورة مورد محدد/, 'Clearing line is labelled with the recorded reason');
      console.log('Case E passed: unallocable reason covers the save and routes the arrival to clearing');
    } finally {
      await db.destroy();
    }
  }

  // Case F: a broker-folded component needs no payee at save time,
  // and lowering its bucket below the folded sum still fails on
  // the broker floor, not on the payee.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, { customs_cost_egp: 4000 });
      await db.insertInto('import_broker_capitalizations' as never).values({
        tenant_id: 't1', broker_expense_id: 'br-exp-1', shipment_id: 'sh-1',
        cost_bucket: 'customs_cost_egp', amount_egp: 5000, state: 'folded',
      } as never).execute();
      const updated = await service.updateShipmentCosts('t1', 1, 'sh-1', { customsCostEgp: 5000 });
      assert.equal(Number(updated.customs_cost_egp), 5000, 'Raising the bucket to the folded sum saves with no payee');
      await assert.rejects(
        service.updateShipmentCosts('t1', 1, 'sh-1', { customsCostEgp: 4000 }),
        /IMPORT_BROKER_CAPITALIZATION_FLOOR/,
        'Lowering below the folded sum must still fail on the floor, not the payee',
      );
      assert.equal(Number((await readShipment(db)).customs_cost_egp), 5000, 'The rejected floor write leaves the bucket untouched');
      console.log('Case F passed: broker-folded component needs no payee; floor keeps precedence');
    } finally {
      await db.destroy();
    }
  }

  // Case G: the arrival rate keeps precedence over the payee check.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, {
        exchange_rate_at_arrival: null,
        shipping_cost_usd: 100, customs_cost_egp: 2000, internal_transport_cost_egp: 1000,
      });
      await assert.rejects(
        service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'Arrived', receiptLocationId: 10 }),
        /IMPORT_ARRIVAL_RATE_REQUIRED/,
        'An Arrived call without a rate must fail on the rate even when payees are also missing',
      );
      assert.equal(await countRows(db, 'import_inventory_receipts'), 0, 'No receipt may exist after the refused confirm');
      console.log('Case G passed: arrival rate error keeps precedence over the payee check');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import payee validation early tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
