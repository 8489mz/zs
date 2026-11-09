/*
New file: backend/test/critical/import-arrival-rate-fail-closed.spec.ts
Pins the arrival exchange-rate fail-closed rule
(INV-IMPORT-ARRIVAL-RATE-FAIL-CLOSED).

WHAT WAS WRONG: migration 2033 defined
import_shipments.exchange_rate_at_arrival with DEFAULT 1, so a
shipment created without a rate silently costed and posted at
rate 1; createShipment also dropped the DTO-supplied rates
entirely. The recalculation guard (requireImportNumber) could
never fire because the stored value was never NULL.

WHAT THIS PINS, driving the real createShipment,
addShipmentItem and updateShipmentCosts on PGlite through the
real posting boundary:
- Adding an item to a rateless shipment is rejected with
  IMPORT_ARRIVAL_RATE_REQUIRED and no item row persists.
- Marking a shipment Arrived without a rate is rejected with
  the same named error: no receipt, no journal.
- A rate set after item creation recalculates before posting:
  items costed at 50, re-rated to 51, then Arrived posts the
  receipt at the 51 landed cost.
- createShipment persists a supplied arrival rate, and a
  shipment created without one stores NULL, not 1.
- Migration 0281 itself is proven on a minimal table created
  WITH the old default: up() drops the default for new rows
  only (a pre-existing row keeps its stored 1), and re-running
  up() is a harmless skip.

RESIDUAL (recorded, not hidden): legacy rows already stored at
exactly 1 from the old default remain indistinguishable from a
genuinely entered 1; the code does not reject rate == 1.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { up as migrate0281Up } from '../../src/database/migrations/2040000000281_drop_arrival_rate_default';

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
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, feasibility_data text, status text);
    CREATE TABLE import_shipments (id text PRIMARY KEY DEFAULT ('sh-' || md5(random()::text)), tenant_id text, supplier_id bigint, project_id text, container_number text, status text, bill_of_lading text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days numeric, demurrage_start_date text, demurrage_rate_per_day numeric, customs_declaration_no text, vat_refundable_egp numeric, customs_duty_rate_percent numeric, vat_rate_percent numeric, insurance_cost_usd numeric, funding_type text, is_consolidated boolean, cost_allocation_method text, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, actual_demurrage_fees numeric, shipped_date text, eta_date text, clearance_date text, arrival_date text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY DEFAULT ('item-' || md5(random()::text)), tenant_id text, shipment_id text, product_id bigint, quantity numeric, received_quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, shortage_handling_method text, gross_weight_kg_unit numeric, cbm_unit numeric, target_retail_margin numeric, target_wholesale_margin numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, reserved_quantity numeric, status text);
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text, review_reason text, posted_at timestamptz, created_by bigint, journal_entry_id bigint);
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, updated_at timestamptz);
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text NOT NULL, broker_expense_id text NOT NULL, shipment_id text NOT NULL, cost_bucket text, amount_egp numeric(19, 4) NOT NULL, state text NOT NULL CHECK (state IN ('folded', 'consumed', 'revalued')), late_expense_event_id bigint, created_by bigint, created_at timestamptz NOT NULL DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE INDEX import_broker_capitalizations_shipment_idx ON import_broker_capitalizations (tenant_id, shipment_id, state);
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
    INSERT INTO suppliers VALUES (9, 't1', 'Shipment Supplier', '', '', 0, true, NOW());
    INSERT INTO products VALUES (5, 't1', 't1', 'Widget', 0, 0, 0, NOW());
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

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function main(): Promise<void> {
  // Case 1: item add without a rate is rejected; no item persists.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const shipment = await service.createShipment('t1', { containerNumber: 'MSCU-1', supplierId: '9' });
      assert.equal(shipment.exchange_rate_at_arrival, null, 'A shipment created without a rate stores NULL, not 1');
      await assert.rejects(
        async () => service.addShipmentItem('t1', shipment.id, { productId: 5, quantity: 10, factoryUnitPriceUsd: 10 }),
        /IMPORT_ARRIVAL_RATE_REQUIRED/,
        'Adding an item without an arrival rate must fail closed',
      );
      assert.equal(await countRows(db, 'import_shipment_items'), 0, 'The rejected item insert must roll back');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: Arrived without a rate is rejected; nothing posts.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const shipment = await service.createShipment('t1', { containerNumber: 'MSCU-2', supplierId: '9' });
      await db.insertInto('import_shipment_items' as never).values({
        tenant_id: 't1', shipment_id: shipment.id, product_id: 5, quantity: 10,
        received_quantity: 10, factory_unit_price_usd: 10, landed_cost_egp: 0,
        shortage_handling_method: 'capitalize',
      } as never).execute();
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, shipment.id, { status: 'Arrived', receiptLocationId: 10 }),
        /IMPORT_ARRIVAL_RATE_REQUIRED/,
        'Marking Arrived without a rate must fail closed',
      );
      assert.equal(await countRows(db, 'import_inventory_receipts'), 0, 'No receipt may be posted');
      assert.equal(await countRows(db, 'journal_entries'), 0, 'No journal may be posted');
    } finally {
      await db.destroy();
    }
  }

  // Case 2b: Arrived without a rate fails even with no items
  // (the recalculation guard alone would early-return on an
  // empty shipment, so the transition itself is guarded).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const shipment = await service.createShipment('t1', { containerNumber: 'MSCU-2b', supplierId: '9' });
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, shipment.id, { status: 'Arrived', receiptLocationId: 10 }),
        /IMPORT_ARRIVAL_RATE_REQUIRED/,
        'Marking an empty rateless shipment Arrived must fail on the rate, not on the missing items',
      );
      assert.equal(await countRows(db, 'import_inventory_receipts'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: rate set after item creation recalculates before posting.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const shipment = await service.createShipment('t1', { containerNumber: 'MSCU-3', supplierId: '9', exchangeRateAtArrival: 50 });
      assert.equal(Number(shipment.exchange_rate_at_arrival), 50, 'A supplied arrival rate is persisted at creation');
      await service.addShipmentItem('t1', shipment.id, { productId: 5, quantity: 10, factoryUnitPriceUsd: 10 });
      await service.updateShipmentCosts('t1', 1, shipment.id, { exchangeRateAtArrival: 51 });
      const item: any = await (db as any).selectFrom('import_shipment_items').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(item.landed_cost_egp), 510, 'The rate change recalculates landed cost before posting');
      await service.updateShipmentCosts('t1', 1, shipment.id, { status: 'Arrived', receiptLocationId: 10 });
      assert.equal(await countRows(db, 'import_inventory_receipts'), 1, 'The receipt posts on Arrived');
      const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 5).executeTakeFirstOrThrow();
      assert.equal(Number(product.cost_price), 510, 'WAC posts at the recalculated landed cost');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: migration 0281 drops the default for new rows only.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE import_shipments (
          id TEXT PRIMARY KEY, tenant_id TEXT,
          exchange_rate_at_arrival NUMERIC(10, 4) DEFAULT '1'
        );
        INSERT INTO import_shipments VALUES ('legacy-1', 't1', DEFAULT);
      `);
      await migrate0281Up(db as any);
      await migrate0281Up(db as any);
      await db.insertInto('import_shipments' as never).values({ id: 'new-1', tenant_id: 't1' } as never).execute();
      const legacy: any = await (db as any).selectFrom('import_shipments').selectAll().where('id', '=', 'legacy-1').executeTakeFirstOrThrow();
      const fresh: any = await (db as any).selectFrom('import_shipments').selectAll().where('id', '=', 'new-1').executeTakeFirstOrThrow();
      assert.equal(Number(legacy.exchange_rate_at_arrival), 1, 'A pre-existing row keeps its stored value');
      assert.equal(fresh.exchange_rate_at_arrival, null, 'A new row without a rate stores NULL after the migration');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import arrival rate fail-closed tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
