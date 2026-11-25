import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { executeWipeTables } from '../../src/modules/settings/services/settings-demo-data-wipe-tables';

/*
 * Tenant factory reset must not die with a 500 (INV-TENANT-WIPE-FK-CLOSURE).
 *
 * THE GAP: POST /api/saas-admin/tenants/:id/wipe-data on test10k
 * (2026-11-15) answered 500 INTERNAL_ERROR although the super-admin
 * password was accepted (a wrong password answers 401). The wipe runs
 * one transaction of deletes in settings-demo-data-wipe-tables.ts
 * (executeWipeTables, extracted from SettingsDemoDataService so the
 * service file stays under its file-size baseline), but the list was
 * written when the store had only
 * the core modules: every table added since that holds a foreign key
 * WITHOUT a delete rule (NO ACTION) or with RESTRICT to a wiped table
 * was missing from the list. The first such row stops the whole wipe
 * with a Postgres FK violation (23503), the transaction rolls back,
 * and the generic error mask hides the real cause from the screen.
 *
 * Blocking tables proven from the migrations at live HEAD (FOUR FK
 * styles checked: inline REFERENCES, Kysely .references(), table-constraint
 * FOREIGN KEY arrays / ALTER ... ADD CONSTRAINT, and alterTable().addColumn()
 * with .references() — the fourth style is how the 409 case below was missed
 * in the first audit):
 * - van_field_returns -> sales / customers / delivery_representatives
 * - van_load_requisitions -> delivery_representatives / van_sales_trips
 * - van_stock_transfers -> delivery_representatives
 * - van_stock_transfer_items -> products
 * - van_damaged_swaps -> products
 * - accounting_installment_interest -> customer_installment_plans /
 *   customer_installments / journal_entries
 * - accounting_supplier_links -> suppliers
 * - accounting_marketplace_settlements -> journal_entries
 * - treasury_transfers -> journal_entries (RESTRICT)
 * - import_approval_requests -> users (RESTRICT, requested_by)
 * - import_container_preorders -> customers / products (RESTRICT)
 * - import_inventory_lots -> products (RESTRICT)
 * - import_inventory_receipts -> import_shipments (RESTRICT)
 * - import_late_expense_events -> import_shipments (RESTRICT)
 * - import_partner_project_payouts -> import_partners /
 *   import_projects / treasury_transactions (RESTRICT)
 * - import_proforma_invoices -> suppliers (RESTRICT)
 * - import_sale_allocations -> import_inventory_lots / products (RESTRICT)
 * - stock_movements -> import_inventory_receipts (RESTRICT): receipts
 *   must be wiped AFTER stock_movements, which the wipe already does
 *   (stock_movements is deleted in section 1, receipts in the import
 *   block) — the spec pins that order with a seeded movement.
 * audit_logs -> users is the one handled exception: the wipe nulls
 * created_by for deleted users before deleting them.
 *
 * SECOND FAILURE (live, 2026-11-15 ~15:03, after the first fix was
 * deployed): the wipe answered 409 Conflict, not 500 — the mapper
 * (postgres-error.mapper.ts) names the referencing table from the
 * Postgres detail: import_shipments. Cause: import_shipments.supplier_id
 * references suppliers.id ON DELETE RESTRICT (migration 2036,
 * alterTable().addColumn().references()), but the wipe deleted suppliers
 * BEFORE import_shipments, so the suppliers delete died with 23503.
 * Fix: the whole supplier block (schedules, payments, ledger,
 * suppliers) moved to AFTER import_shipments. A mechanical audit over
 * all 513 FK edges from the migrations now proves zero order
 * violations in the wipe list (the only latent edges are audit_logs /
 * tenant_subscription_payments -> users, handled by nulling, and
 * returns -> users, whose table was dropped by migration
 * 1710000004000 and replaced by return_documents, which IS wiped).
 *
 * THE RULE: executeWipeTables deletes every operational table that
 * references a wiped table — blockers first, in child-before-parent
 * order — so a tenant that used the van, import, instalment-interest
 * or treasury-transfer modules wipes clean in one transaction. The
 * same-module CASCADE / SET NULL children are wiped too, so the store
 * is white afterwards instead of keeping stale van visits, fleet logs
 * and import projects. Preserved by design and NOT wiped: branches,
 * stock_locations, settings, the oldest user, audit_logs rows (only
 * unlinked), tenant_subscription_payments rows (only unlinked).
 * Nothing here rewrites a posted journal or a stored value; it only
 * completes the delete list of the factory reset. Prospective only.
 *
 * WHAT THIS PINS, driving the REAL service on PGlite:
 * - The wipe succeeds (no throw) on a tenant seeded with one row in
 *   every blocking table above, linked to real parents.
 * - After the wipe every operational table is empty for the tenant,
 *   including the blocking tables and the CASCADE / SET NULL
 *   same-module children.
 * - The oldest user survives, extra users are gone, audit_logs and
 *   tenant_subscription_payments rows survive with created_by NULL.
 * - Another tenant's rows survive untouched (tenant scoping).
 * This is not an end-to-end run on live Postgres.
 */

const TENANT = 'wipe-tenant';
const OTHER = 'other-tenant';
const PRESERVED_USER = 1;
const EXTRA_USER = 2;

/* Every table executeWipeTables deletes (88 at live HEAD) plus the
 * tables the fix adds, as minimal (id, tenant_id) tables. Special
 * tables with foreign keys or extra columns are defined below. */
const PLAIN_WIPED = [
  'customer_installments',
  'customer_installment_plans',
  'quotation_items',
  'quotations',
  'sale_items',
  'sale_payments',
  'held_sale_items',
  'held_sales',
  'sales',
  'purchase_items',
  'purchase_attachments',
  'purchases',
  'return_items',
  'return_documents',
  'cashier_shifts',
  'treasury_transactions',
  'expenses',
  'customer_payments',
  'customer_ledger',
  'customers',
  'supplier_payment_schedule_logs',
  'supplier_payment_schedules',
  'supplier_payments',
  'supplier_ledger',
  'suppliers',
  'van_sales_trips',
  'delivery_representatives',
  'stock_transfer_items',
  'stock_transfers',
  'stock_count_items',
  'stock_count_sessions',
  'damaged_stock_records',
  'product_location_stock',
  'manufacturing_work_orders',
  'manufacturing_boms',
  'import_sale_partner_shares',
  'import_sales_and_profit',
  'import_shipment_items',
  'import_shipments',
  'import_partners',
  'maintenance_ticket_parts',
  'maintenance_tickets',
  'trade_in_transactions',
  'online_orders',
  'pharmacy_clinical_services',
  'pharmacy_shortages',
  'pharmacy_prescriptions',
  'pharmacy_batches',
  'pharmacy_drugs',
  'sale_line_stock_allocations',
  'price_change_items',
  'price_change_runs',
  'product_offers',
  'product_units',
  'product_customer_prices',
  'product_pricing_profiles',
  'pricing_rules',
  'products',
  'product_categories',
  'hr_payroll_loan_deduction_allocations',
  'hr_payroll_item_adjustments',
  'hr_payroll_run_items',
  'hr_employee_adjustments',
  'hr_payroll_runs',
  'hr_employee_loan_installments',
  'hr_employee_loans',
  'hr_employee_ledger',
  'hr_employee_assets',
  'hr_attendance_exceptions',
  'hr_attendance_records',
  'hr_leave_requests',
  'hr_leave_types',
  'hr_compensation_packages',
  'hr_employment_contracts',
  'hr_employee_documents',
  'hr_employee_contacts',
  'hr_holidays',
  'hr_employees',
  'hr_positions',
  'hr_job_titles',
  'hr_departments',
  'journal_entry_lines',
  'journal_entries',
  'services',
  'users',
];

/* Tables the fix adds: operational rows that must be gone for the
 * store to be white. Their real foreign keys are CASCADE / SET NULL /
 * none, so they never block the wipe; they are listed here so the
 * spec proves they are emptied too. */
const PLAIN_ADDED = [
  'van_field_visits',
  'delivery_rep_targets',
  'fleet_fuel_logs',
  'fleet_oil_changes',
  'fleet_vehicle_drivers',
  'fleet_vehicles',
  'van_rep_financial_settlements',
  'van_trip_expenses',
  'van_trip_packaging_movements',
  'van_store_visits',
  'van_trade_marketing_surveys',
  'van_rep_live_breadcrumbs',
  'import_broker_advances',
  'import_broker_expenses',
  'import_broker_capitalizations',
  'import_documents',
  'import_qc_inspections',
  'import_reconciliation_exceptions',
  'import_aci_compliance',
  'import_quotations',
  'import_sample_orders',
  'import_suppliers_meta',
  'import_customs_brokers',
  'import_customs_tariffs',
  'import_fx_acquisitions',
  'import_partner_ledger',
  'import_inventory_receipt_reversals',
  'import_sourcing_trips',
];

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<any> }> {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
  const ddl: string[] = [
    `CREATE TABLE users (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, created_at TIMESTAMPTZ, username TEXT)`,
    `CREATE TABLE stock_locations (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE audit_logs (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, created_by BIGINT REFERENCES users(id))`,
    `CREATE TABLE tenant_subscription_payments (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, created_by BIGINT REFERENCES users(id))`,
    // FK targets first (plain tables are created below, but these carry
    // the foreign keys the wipe order must respect, so define them here
    // with the exact actions from the migrations).
    `CREATE TABLE customers (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE suppliers (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE products (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE sales (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE delivery_representatives (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE van_sales_trips (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE treasury_transactions (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE journal_entries (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE customer_installment_plans (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE customer_installments (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE import_shipments (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, supplier_id BIGINT REFERENCES suppliers(id) ON DELETE RESTRICT)`,
    `CREATE TABLE import_partners (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE import_projects (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE import_inventory_lots (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT, shipment_id BIGINT REFERENCES import_shipments(id) ON DELETE CASCADE)`,
    `CREATE TABLE import_container_deposits (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, shipment_id BIGINT REFERENCES import_shipments(id) ON DELETE CASCADE)`,
    `CREATE TABLE import_container_preorders (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id BIGINT REFERENCES customers(id) ON DELETE RESTRICT, product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT, shipment_id BIGINT REFERENCES import_shipments(id) ON DELETE CASCADE)`,
    `CREATE TABLE import_inventory_receipts (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, shipment_id BIGINT REFERENCES import_shipments(id) ON DELETE RESTRICT)`,
    // Blocking tables (NO ACTION / RESTRICT to wiped parents).
    `CREATE TABLE van_field_returns (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, trip_id BIGINT REFERENCES van_sales_trips(id) ON DELETE CASCADE, rep_id BIGINT NOT NULL REFERENCES delivery_representatives(id), customer_id BIGINT NOT NULL REFERENCES customers(id), sale_id BIGINT REFERENCES sales(id))`,
    `CREATE TABLE van_load_requisitions (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, rep_id BIGINT NOT NULL REFERENCES delivery_representatives(id), trip_id BIGINT REFERENCES van_sales_trips(id), source_warehouse_id BIGINT NOT NULL REFERENCES stock_locations(id))`,
    `CREATE TABLE van_stock_transfers (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, from_rep_id BIGINT NOT NULL REFERENCES delivery_representatives(id), to_rep_id BIGINT NOT NULL REFERENCES delivery_representatives(id), from_trip_id BIGINT REFERENCES van_sales_trips(id) ON DELETE SET NULL, to_trip_id BIGINT REFERENCES van_sales_trips(id) ON DELETE SET NULL, from_van_location_id BIGINT NOT NULL REFERENCES stock_locations(id), to_van_location_id BIGINT NOT NULL REFERENCES stock_locations(id))`,
    `CREATE TABLE van_stock_transfer_items (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, transfer_id BIGINT NOT NULL REFERENCES van_stock_transfers(id) ON DELETE CASCADE, product_id BIGINT NOT NULL REFERENCES products(id))`,
    `CREATE TABLE van_damaged_swaps (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, trip_id BIGINT REFERENCES van_sales_trips(id) ON DELETE CASCADE, customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE, damaged_product_id BIGINT NOT NULL REFERENCES products(id), replacement_product_id BIGINT NOT NULL REFERENCES products(id))`,
    `CREATE TABLE accounting_installment_interest (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, plan_id BIGINT REFERENCES customer_installment_plans(id), installment_id BIGINT REFERENCES customer_installments(id), journal_entry_id BIGINT REFERENCES journal_entries(id))`,
    `CREATE TABLE accounting_supplier_links (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, supplier_id BIGINT REFERENCES suppliers(id))`,
    `CREATE TABLE accounting_marketplace_settlements (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, journal_entry_id BIGINT REFERENCES journal_entries(id))`,
    `CREATE TABLE treasury_transfers (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, journal_entry_id BIGINT REFERENCES journal_entries(id) ON DELETE RESTRICT)`,
    `CREATE TABLE import_approval_requests (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, requested_by BIGINT REFERENCES users(id) ON DELETE RESTRICT, approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL)`,
    `CREATE TABLE import_late_expense_events (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, shipment_id BIGINT REFERENCES import_shipments(id) ON DELETE RESTRICT)`,
    `CREATE TABLE import_partner_project_payouts (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, partner_id BIGINT REFERENCES import_partners(id) ON DELETE RESTRICT, project_id BIGINT REFERENCES import_projects(id) ON DELETE RESTRICT, treasury_transaction_id BIGINT REFERENCES treasury_transactions(id) ON DELETE RESTRICT)`,
    `CREATE TABLE import_proforma_invoices (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, supplier_id BIGINT REFERENCES suppliers(id) ON DELETE RESTRICT)`,
    `CREATE TABLE import_sale_allocations (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, lot_id BIGINT REFERENCES import_inventory_lots(id) ON DELETE RESTRICT, product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT, shipment_id BIGINT REFERENCES import_shipments(id) ON DELETE SET NULL)`,
    `CREATE TABLE import_container_refund_events (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, deposit_id BIGINT REFERENCES import_container_deposits(id) ON DELETE RESTRICT)`,
    `CREATE TABLE import_preorder_refund_events (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, preorder_id BIGINT REFERENCES import_container_preorders(id) ON DELETE RESTRICT)`,
    `CREATE TABLE import_project_partners (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id BIGINT REFERENCES import_projects(id) ON DELETE CASCADE, partner_id BIGINT REFERENCES import_partners(id) ON DELETE CASCADE)`,
    `CREATE TABLE import_sourcing_trips (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id BIGINT REFERENCES import_projects(id) ON DELETE SET NULL)`,
    // Same-module CASCADE / SET NULL children (emptied, never blocking).
    `CREATE TABLE van_field_visits (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, trip_id BIGINT REFERENCES van_sales_trips(id) ON DELETE CASCADE, rep_id BIGINT REFERENCES delivery_representatives(id) ON DELETE CASCADE, customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE, sale_id BIGINT REFERENCES sales(id) ON DELETE SET NULL)`,
    `CREATE TABLE delivery_rep_targets (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, rep_id BIGINT REFERENCES delivery_representatives(id) ON DELETE CASCADE)`,
    `CREATE TABLE fleet_vehicles (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, assigned_rep_id BIGINT REFERENCES delivery_representatives(id) ON DELETE SET NULL)`,
    `CREATE TABLE fleet_vehicle_drivers (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, vehicle_id BIGINT REFERENCES fleet_vehicles(id) ON DELETE CASCADE, rep_id BIGINT REFERENCES delivery_representatives(id) ON DELETE CASCADE)`,
    `CREATE TABLE fleet_oil_changes (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, vehicle_id BIGINT REFERENCES fleet_vehicles(id) ON DELETE CASCADE, rep_id BIGINT REFERENCES delivery_representatives(id) ON DELETE SET NULL)`,
    `CREATE TABLE fleet_fuel_logs (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, vehicle_id BIGINT REFERENCES fleet_vehicles(id) ON DELETE CASCADE, trip_id BIGINT REFERENCES van_sales_trips(id) ON DELETE SET NULL, rep_id BIGINT REFERENCES delivery_representatives(id) ON DELETE SET NULL)`,
    `CREATE TABLE van_rep_financial_settlements (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, rep_id BIGINT REFERENCES delivery_representatives(id) ON DELETE CASCADE, trip_id BIGINT REFERENCES van_sales_trips(id) ON DELETE SET NULL)`,
    `CREATE TABLE customer_payments (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`,
    `CREATE TABLE settlement_allocations (id SERIAL PRIMARY KEY, tenant_id VARCHAR NOT NULL, settlement_id BIGINT NOT NULL REFERENCES van_rep_financial_settlements(id) ON DELETE CASCADE, sale_id BIGINT REFERENCES sales(id) ON DELETE SET NULL, customer_payment_id BIGINT REFERENCES customer_payments(id) ON DELETE SET NULL, amount NUMERIC(14, 3) NOT NULL DEFAULT 0, business_day DATE NOT NULL DEFAULT '2026-11-17', CONSTRAINT settlement_allocations_one_source_chk CHECK ((sale_id IS NOT NULL AND customer_payment_id IS NULL) OR (sale_id IS NULL AND customer_payment_id IS NOT NULL)))`,
    `CREATE TABLE van_trip_expenses (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, trip_id BIGINT REFERENCES van_sales_trips(id) ON DELETE CASCADE)`,
    `CREATE TABLE van_trip_packaging_movements (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, trip_id BIGINT REFERENCES van_sales_trips(id) ON DELETE CASCADE, customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL)`,
    // stock_movements references the receipt (RESTRICT): the wipe must
    // delete movements (section 1) before receipts (import block).
    `CREATE TABLE stock_movements (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, product_id BIGINT REFERENCES products(id), import_receipt_id BIGINT REFERENCES import_inventory_receipts(id) ON DELETE RESTRICT)`,
    `CREATE TABLE manufacturing_wo_consumptions (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, work_order_id BIGINT)`,
    `CREATE TABLE manufacturing_bom_lines (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, bom_id BIGINT)`,
  ];
  for (const statement of ddl) await pg.exec(statement);
  const created = new Set(ddl.map((s) => s.match(/CREATE TABLE (\w+)/)?.[1]).filter(Boolean));
  for (const table of [...PLAIN_WIPED, ...PLAIN_ADDED]) {
    if (created.has(table)) continue;
    await pg.exec(`CREATE TABLE ${table} (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL)`);
    created.add(table);
  }
  return { pg, db };
}

async function count(db: Kysely<any>, table: string, tenantId: string): Promise<number> {
  const row = await db
    .selectFrom(table)
    .select(db.fn.count('id').as('cnt'))
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  return Number(row?.cnt || 0);
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    // Parents.
    await db
      .insertInto('users')
      .values([
        {
          id: PRESERVED_USER,
          tenant_id: TENANT,
          account_id: `${TENANT}:main`,
          created_at: new Date('2026-01-01T00:00:00Z'),
          username: 'owner',
        },
        {
          id: EXTRA_USER,
          tenant_id: TENANT,
          account_id: `${TENANT}:main`,
          created_at: new Date('2026-02-01T00:00:00Z'),
          username: 'cashier_test',
        },
      ])
      .execute();
    await db.insertInto('stock_locations').values({ id: 1, tenant_id: TENANT }).execute();
    await db.insertInto('customers').values({ id: 1, tenant_id: TENANT }).execute();
    await db.insertInto('suppliers').values({ id: 1, tenant_id: TENANT }).execute();
    await db
      .insertInto('products')
      .values([
        { id: 1, tenant_id: TENANT },
        { id: 2, tenant_id: TENANT },
      ])
      .execute();
    await db.insertInto('sales').values({ id: 1, tenant_id: TENANT }).execute();
    await db.insertInto('delivery_representatives').values({ id: 1, tenant_id: TENANT }).execute();
    await db.insertInto('van_sales_trips').values({ id: 1, tenant_id: TENANT }).execute();
    await db.insertInto('treasury_transactions').values({ id: 1, tenant_id: TENANT }).execute();
    await db.insertInto('journal_entries').values({ id: 1, tenant_id: TENANT }).execute();
    await db.insertInto('customer_installment_plans').values({ id: 1, tenant_id: TENANT }).execute();
    await db.insertInto('customer_installments').values({ id: 1, tenant_id: TENANT }).execute();
    await db.insertInto('import_shipments').values({ id: 1, tenant_id: TENANT, supplier_id: 1 }).execute();
    await db.insertInto('import_partners').values({ id: 1, tenant_id: TENANT }).execute();
    await db.insertInto('import_projects').values({ id: 1, tenant_id: TENANT }).execute();
    await db
      .insertInto('import_inventory_lots')
      .values({ id: 1, tenant_id: TENANT, product_id: 1, shipment_id: 1 })
      .execute();
    await db.insertInto('import_container_deposits').values({ id: 1, tenant_id: TENANT, shipment_id: 1 }).execute();
    await db
      .insertInto('import_container_preorders')
      .values({ id: 1, tenant_id: TENANT, customer_id: 1, product_id: 1, shipment_id: 1 })
      .execute();
    await db.insertInto('import_inventory_receipts').values({ id: 1, tenant_id: TENANT, shipment_id: 1 }).execute();

    // Blocking rows: each one stops the old wipe with an FK violation.
    await db
      .insertInto('van_field_returns')
      .values({ id: 1, tenant_id: TENANT, trip_id: 1, rep_id: 1, customer_id: 1, sale_id: 1 })
      .execute();
    await db
      .insertInto('van_load_requisitions')
      .values({ id: 1, tenant_id: TENANT, rep_id: 1, trip_id: 1, source_warehouse_id: 1 })
      .execute();
    await db
      .insertInto('van_stock_transfers')
      .values({
        id: 1,
        tenant_id: TENANT,
        from_rep_id: 1,
        to_rep_id: 1,
        from_trip_id: 1,
        to_trip_id: 1,
        from_van_location_id: 1,
        to_van_location_id: 1,
      })
      .execute();
    await db
      .insertInto('van_stock_transfer_items')
      .values({ id: 1, tenant_id: TENANT, transfer_id: 1, product_id: 1 })
      .execute();
    await db
      .insertInto('van_damaged_swaps')
      .values({
        id: 1,
        tenant_id: TENANT,
        trip_id: 1,
        customer_id: 1,
        damaged_product_id: 1,
        replacement_product_id: 2,
      })
      .execute();
    await db
      .insertInto('accounting_installment_interest')
      .values({ id: 1, tenant_id: TENANT, plan_id: 1, installment_id: 1, journal_entry_id: 1 })
      .execute();
    await db.insertInto('accounting_supplier_links').values({ id: 1, tenant_id: TENANT, supplier_id: 1 }).execute();
    await db
      .insertInto('accounting_marketplace_settlements')
      .values({ id: 1, tenant_id: TENANT, journal_entry_id: 1 })
      .execute();
    await db.insertInto('treasury_transfers').values({ id: 1, tenant_id: TENANT, journal_entry_id: 1 }).execute();
    await db
      .insertInto('import_approval_requests')
      .values({ id: 1, tenant_id: TENANT, requested_by: EXTRA_USER, approved_by: PRESERVED_USER })
      .execute();
    await db.insertInto('import_late_expense_events').values({ id: 1, tenant_id: TENANT, shipment_id: 1 }).execute();
    await db
      .insertInto('import_partner_project_payouts')
      .values({ id: 1, tenant_id: TENANT, partner_id: 1, project_id: 1, treasury_transaction_id: 1 })
      .execute();
    await db.insertInto('import_proforma_invoices').values({ id: 1, tenant_id: TENANT, supplier_id: 1 }).execute();
    await db
      .insertInto('import_sale_allocations')
      .values({ id: 1, tenant_id: TENANT, lot_id: 1, product_id: 1, shipment_id: 1 })
      .execute();
    await db.insertInto('import_container_refund_events').values({ id: 1, tenant_id: TENANT, deposit_id: 1 }).execute();
    await db.insertInto('import_preorder_refund_events').values({ id: 1, tenant_id: TENANT, preorder_id: 1 }).execute();
    await db
      .insertInto('import_project_partners')
      .values({ id: 1, tenant_id: TENANT, project_id: 1, partner_id: 1 })
      .execute();
    await db.insertInto('import_sourcing_trips').values({ id: 1, tenant_id: TENANT, project_id: 1 }).execute();
    await db
      .insertInto('stock_movements')
      .values({ id: 1, tenant_id: TENANT, product_id: 1, import_receipt_id: 1 })
      .execute();

    // Same-module children (CASCADE / SET NULL): stale if not wiped.
    await db
      .insertInto('van_field_visits')
      .values({ id: 1, tenant_id: TENANT, trip_id: 1, rep_id: 1, customer_id: 1, sale_id: 1 })
      .execute();
    await db.insertInto('delivery_rep_targets').values({ id: 1, tenant_id: TENANT, rep_id: 1 }).execute();
    await db.insertInto('fleet_vehicles').values({ id: 1, tenant_id: TENANT, assigned_rep_id: 1 }).execute();
    await db
      .insertInto('fleet_vehicle_drivers')
      .values({ id: 1, tenant_id: TENANT, vehicle_id: 1, rep_id: 1 })
      .execute();
    await db.insertInto('fleet_oil_changes').values({ id: 1, tenant_id: TENANT, vehicle_id: 1, rep_id: 1 }).execute();
    await db
      .insertInto('fleet_fuel_logs')
      .values({ id: 1, tenant_id: TENANT, vehicle_id: 1, trip_id: 1, rep_id: 1 })
      .execute();
    await db
      .insertInto('van_rep_financial_settlements')
      .values({ id: 1, tenant_id: TENANT, rep_id: 1, trip_id: 1 })
      .execute();
    await db.insertInto('van_trip_expenses').values({ id: 1, tenant_id: TENANT, trip_id: 1 }).execute();
    await db
      .insertInto('van_trip_packaging_movements')
      .values({ id: 1, tenant_id: TENANT, trip_id: 1, customer_id: 1 })
      .execute();

    // One row in every other wiped table, so the wipe must empty them all.
    const special = new Set([
      'users',
      'customers',
      'suppliers',
      'products',
      'sales',
      'delivery_representatives',
      'van_sales_trips',
      'treasury_transactions',
      'journal_entries',
      'customer_installment_plans',
      'customer_installments',
      'import_shipments',
      'import_partners',
      'stock_movements',
      'manufacturing_wo_consumptions',
      'manufacturing_bom_lines',
      'manufacturing_work_orders',
      'manufacturing_boms',
    ]);
    for (const table of PLAIN_WIPED) {
      if (special.has(table)) continue;
      await db.insertInto(table).values({ id: 1, tenant_id: TENANT }).execute();
    }
    for (const table of PLAIN_ADDED) {
      const row = await db.selectFrom(table).select('id').where('tenant_id', '=', TENANT).executeTakeFirst();
      if (!row) await db.insertInto(table).values({ id: 1, tenant_id: TENANT }).execute();
    }
    await db
      .insertInto('settlement_allocations')
      .values([
        { tenant_id: TENANT, settlement_id: 1, sale_id: 1, customer_payment_id: null, amount: 50 },
        { tenant_id: TENANT, settlement_id: 1, sale_id: null, customer_payment_id: 1, amount: 25 },
      ])
      .execute();
    await db.insertInto('manufacturing_work_orders').values({ id: 1, tenant_id: TENANT }).execute();
    await db
      .insertInto('manufacturing_wo_consumptions')
      .values({ id: 1, tenant_id: TENANT, work_order_id: 1 })
      .execute();
    await db.insertInto('manufacturing_boms').values({ id: 1, tenant_id: TENANT }).execute();
    await db.insertInto('manufacturing_bom_lines').values({ id: 1, tenant_id: TENANT, bom_id: 1 }).execute();
    await db.insertInto('audit_logs').values({ id: 1, tenant_id: TENANT, created_by: EXTRA_USER }).execute();
    await db
      .insertInto('tenant_subscription_payments')
      .values({ id: 1, tenant_id: TENANT, created_by: EXTRA_USER })
      .execute();

    // Another tenant's rows must survive untouched.
    await db.insertInto('products').values({ id: 9, tenant_id: OTHER }).execute();
    await db.insertInto('sales').values({ id: 9, tenant_id: OTHER }).execute();
    await db.insertInto('customers').values({ id: 9, tenant_id: OTHER }).execute();

    // Drive the REAL wipe. On the old code this throws a Postgres FK
    // violation (23503) and the transaction rolls back.
    await db.transaction().execute(async (trx) => {
      await executeWipeTables(trx, TENANT, PRESERVED_USER);
    });

    // Every operational table is empty for the wiped tenant.
    for (const table of [...PLAIN_WIPED, ...PLAIN_ADDED]) {
      if (table === 'users') continue;
      assert.equal(await count(db, table, TENANT), 0, `${table} must be empty after the wipe`);
    }
    assert.equal(
      await count(db, 'settlement_allocations', TENANT),
      0,
      'settlement_allocations must be empty after the wipe',
    );
    assert.equal(await count(db, 'audit_logs', TENANT), 1, 'audit_logs rows are kept, only unlinked');
    const audit = await db
      .selectFrom('audit_logs')
      .select('created_by')
      .where('tenant_id', '=', TENANT)
      .executeTakeFirst();
    assert.equal(audit?.created_by, null, 'audit_logs.created_by must be nulled for the deleted user');
    assert.equal(
      await count(db, 'tenant_subscription_payments', TENANT),
      1,
      'subscription payments are kept, only unlinked',
    );
    const sub = await db
      .selectFrom('tenant_subscription_payments')
      .select('created_by')
      .where('tenant_id', '=', TENANT)
      .executeTakeFirst();
    assert.equal(sub?.created_by, null, 'tenant_subscription_payments.created_by must be nulled for the deleted user');

    // Preserved user survives, extra user is gone.
    const users = await db.selectFrom('users').select('id').where('tenant_id', '=', TENANT).execute();
    assert.deepEqual(
      users.map((u: any) => Number(u.id)),
      [PRESERVED_USER],
      'only the preserved user survives the wipe',
    );

    // Other tenant untouched.
    assert.equal(await count(db, 'products', OTHER), 1, 'another tenant products must survive');
    assert.equal(await count(db, 'sales', OTHER), 1, 'another tenant sales must survive');
    assert.equal(await count(db, 'customers', OTHER), 1, 'another tenant customers must survive');

    // Source pin: the wipe list covers the blocking tables.
    const source = readFileSync(
      resolve(__dirname, '../../src/modules/settings/services/settings-demo-data-wipe-tables.ts'),
      'utf8',
    );
    // Order pin: shipments (RESTRICT child of suppliers) must be
    // deleted BEFORE suppliers, or the suppliers delete dies with 23503
    // and the API answers 409 naming import_shipments (live 2026-11-15).
    assert.ok(
      source.indexOf(`deleteFrom('import_shipments')`) < source.indexOf(`deleteFrom('suppliers')`),
      'import_shipments must be deleted before suppliers',
    );
    for (const table of [
      'van_field_returns',
      'settlement_allocations',
      'van_load_requisitions',
      'van_stock_transfers',
      'van_stock_transfer_items',
      'van_damaged_swaps',
      'accounting_installment_interest',
      'accounting_supplier_links',
      'accounting_marketplace_settlements',
      'treasury_transfers',
      'import_approval_requests',
      'import_container_preorders',
      'import_inventory_lots',
      'import_inventory_receipts',
      'import_late_expense_events',
      'import_partner_project_payouts',
      'import_proforma_invoices',
      'import_sale_allocations',
    ]) {
      assert.ok(source.includes(`deleteFrom('${table}')`), `executeWipeTables must delete ${table}`);
    }

    console.log('tenant-wipe-fk-closure: all cases passed');
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
