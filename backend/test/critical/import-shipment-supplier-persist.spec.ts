/*
New file: backend/test/critical/import-shipment-supplier-persist.spec.ts
Pins the shipment supplier surviving create and being visible in the
list and detail reads (I1-P3, trial problem 3, 2026-11-09).

WHAT WAS WRONG: createShipment persisted supplier_id, but both read
paths returned a bare selectAll() on import_shipments with no supplier
join, so supplier_name was always undefined. The shipments list
(ShipmentsManager) and the container detail (ShipmentDetailsPage)
both render supplier_name, so every shipment showed "المورد: غير
محدد" even though the supplier was stored — and the cost-component
payee selects, whose stored payees start empty, also defaulted to
"غير محدد" instead of the shipment's supplier.

WHAT THIS PINS, driving the real createShipment / listShipments /
getShipmentById on PGlite:
- createShipment with a supplierId persists it (returned row and
  stored row carry supplier_id), and the list + detail read-back
  return that supplier's name (supplier_name), not "غير محدد".
- A create with an unknown supplier id fails loudly naming the
  supplier (المورد لا ينتمي لهذه المنشأة) and persists no row.
- A shipment created without a supplier stores NULL and reads back
  supplier_name NULL — no invented name.
- The supplier-name join is tenant-scoped: a same-id supplier in
  another tenant never leaks its name into this tenant's reads.
- Payee-default precondition: a fresh shipment's cost-component
  payee columns are NULL while supplier_id is set — exactly the
  inputs the detail page's default consumes (stored payee, when
  set, wins; otherwise each component payee defaults to the
  shipment supplier). The React default itself is UI state, not
  backend state, so it is pinned here by its contract, not by
  re-implementing the component.
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
    CREATE TABLE import_shipments (id text PRIMARY KEY DEFAULT ('sh-' || md5(random()::text)), tenant_id text, supplier_id bigint, project_id text, container_number text, status text, bill_of_lading text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days numeric, demurrage_start_date text, demurrage_rate_per_day numeric, customs_declaration_no text, vat_refundable_egp numeric, customs_duty_rate_percent numeric, vat_rate_percent numeric, insurance_cost_usd numeric, funding_type text, is_consolidated boolean, cost_allocation_method text, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, actual_demurrage_fees numeric, shipped_date text, eta_date text, clearance_date text, arrival_date text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, freight_supplier_id bigint, customs_supplier_id bigint, transport_supplier_id bigint, demurrage_supplier_id bigint, unallocable_cost_reason text, form4_number text, form4_date date, container_status text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY DEFAULT ('item-' || md5(random()::text)), tenant_id text, shipment_id text, product_id bigint, quantity numeric, received_quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, shortage_handling_method text, gross_weight_kg_unit numeric, cbm_unit numeric, target_retail_margin numeric, target_wholesale_margin numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text, review_reason text, posted_at timestamptz, created_by bigint, journal_entry_id bigint);
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 22, 21, NULL, 23, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false);
    INSERT INTO branches VALUES (2, 't1', 'Main Branch');
    INSERT INTO stock_locations VALUES (10, 't1', 2, 'Main Warehouse');
    INSERT INTO suppliers VALUES
      (9, 't1', 'Shipment Supplier', '', '', 0, true, NOW());
    INSERT INTO import_projects VALUES ('proj-1', 't1', '{}', 'active');
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
  // Case A: create persists the supplier and list + detail read it back by name.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const created: any = await service.createShipment('t1', {
        containerNumber: 'MSCU-TEST-001',
        projectId: 'proj-1',
        supplierId: '9',
        billOfLading: 'BL-001',
      });
      assert.equal(Number(created.supplier_id), 9, 'createShipment must persist the selected supplier id');
      const stored: any = await (db as any).selectFrom('import_shipments').selectAll()
        .where('tenant_id', '=', 't1').where('id', '=', created.id).executeTakeFirstOrThrow();
      assert.equal(Number(stored.supplier_id), 9, 'Stored row must carry supplier_id 9');

      const list: any = await service.listShipments('t1');
      assert.equal(list.rows.length, 1, 'List must contain the created shipment');
      assert.equal(Number(list.rows[0].supplier_id), 9, 'List row must carry supplier_id');
      assert.equal(list.rows[0].supplier_name, 'Shipment Supplier', 'List row must carry the supplier name, not undefined');

      const detail: any = await service.getShipmentById('t1', created.id);
      assert.equal(Number(detail.supplier_id), 9, 'Detail must carry supplier_id');
      assert.equal(detail.supplier_name, 'Shipment Supplier', 'Detail must carry the supplier name, not undefined');
      assert.equal(detail.freight_supplier_id, null, 'Fresh shipment has no stored freight payee yet');
      assert.equal(detail.customs_supplier_id, null, 'Fresh shipment has no stored customs payee yet');
      assert.equal(detail.transport_supplier_id, null, 'Fresh shipment has no stored transport payee yet');
      assert.equal(detail.demurrage_supplier_id, null, 'Fresh shipment has no stored demurrage payee yet');
      // Payee-default contract: with no stored payee and a shipment
      // supplier set, the detail page defaults each component payee
      // to the shipment supplier (9) — the only inputs the default
      // reads are pinned above (supplier_id 9, payees null).
      console.log('Case A passed: supplier persists and reads back by name in list + detail; payee-default inputs pinned');
    } finally {
      await db.destroy();
    }
  }

  // Case B: an unknown supplier id fails loudly and persists nothing.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await assert.rejects(
        service.createShipment('t1', { containerNumber: 'MSCU-TEST-002', supplierId: '999' }),
        /المورد لا ينتمي لهذه المنشأة/,
        'An unknown supplier must fail loudly naming the supplier',
      );
      assert.equal(await countRows(db, 'import_shipments'), 0, 'No shipment may persist after a refused create');
      console.log('Case B passed: unknown supplier fails loudly with zero writes');
    } finally {
      await db.destroy();
    }
  }

  // Case C: a shipment without a supplier reads back with no name — never invented.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const created: any = await service.createShipment('t1', { containerNumber: 'MSCU-TEST-003' });
      assert.equal(created.supplier_id, null, 'A shipment created without a supplier stores NULL');
      const list: any = await service.listShipments('t1');
      assert.equal(list.rows[0].supplier_name, null, 'List must not invent a supplier name');
      const detail: any = await service.getShipmentById('t1', created.id);
      assert.equal(detail.supplier_name, null, 'Detail must not invent a supplier name');
      console.log('Case C passed: supplier-less shipment reads back with no name');
    } finally {
      await db.destroy();
    }
  }

  // Case D: the supplier-name join is tenant-scoped. (The suppliers
  // PK is the bare id, so the same numeric id cannot exist in two
  // tenants at all; the leak to pin is a supplier that belongs only
  // to another tenant being joined into this tenant's reads.)
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await (db as any).insertInto('suppliers').values({
        id: 77, tenant_id: 't2', name: 'Foreign Only Supplier', phone: '', address: '', balance: 0, is_active: true,
      } as never).execute();
      // Seeded directly — createShipment would refuse a foreign
      // supplier (Case B) — so the row can only exist as legacy data.
      await (db as any).insertInto('import_shipments').values({
        id: 'sh-foreign', tenant_id: 't1', container_number: 'MSCU-TEST-005', supplier_id: 77, status: 'Pending',
      } as never).execute();
      const list: any = await service.listShipments('t1');
      const foreignRow = list.rows.find((r: any) => r.container_number === 'MSCU-TEST-005');
      assert.ok(foreignRow, 'Foreign-supplier shipment must be listed');
      assert.equal(Number(foreignRow.supplier_id), 77, 'List row keeps the stored supplier id');
      assert.equal(foreignRow.supplier_name, null, 'A supplier that belongs to another tenant must read back nameless');
      const detail: any = await service.getShipmentById('t1', 'sh-foreign');
      assert.equal(detail.supplier_name, null, 'Detail must not leak the other tenant supplier name');
      const otherTenantList: any = await service.listShipments('t2');
      assert.equal(otherTenantList.rows.length, 0, 'Another tenant sees none of this tenant shipments');
      console.log('Case D passed: supplier-name join is tenant-scoped');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import shipment supplier persist tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
