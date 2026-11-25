/*
 * INV-SETTLEMENT-ALLOCATIONS-DELETE-ORDER:
 *
 * THE BUG (proven in ci-full #76 on van-sales-field-flow.e2e.ts):
 * Migration 0331 created `settlement_allocations` with:
 *   settlement_id -> van_rep_financial_settlements(id) ON DELETE CASCADE
 *   sale_id -> sales(id) ON DELETE SET NULL
 *   customer_payment_id -> customer_payments(id) ON DELETE SET NULL
 *   CONSTRAINT settlement_allocations_one_source_chk CHECK (
 *     (sale_id IS NOT NULL AND customer_payment_id IS NULL) OR
 *     (sale_id IS NULL AND customer_payment_id IS NOT NULL)
 *   )
 * Any tenant cleanup or wipe that deletes `sales` or `customer_payments`
 * while `settlement_allocations` rows still reference them triggers
 * PostgreSQL's `ON DELETE SET NULL`, setting the sole source FK to NULL
 * (`(NULL, NULL)`), which aborts with SQLSTATE 23514 on
 * `settlement_allocations_one_source_chk`.
 *
 * THE FIX:
 * 1) Delete `settlement_allocations` (and `van_rep_financial_settlements`
 *    where cleared) BEFORE `customer_payments`, `sales`, and
 *    `van_sales_trips` across all shared deletion paths:
 *    - `executeWipeTables` (`settings-demo-data-wipe-tables.ts`)
 *    - `SettingsDemoDataService.resetStockBalances`, `wipeCatalogAndStock`,
 *      and `clearDemoData` (`settings-demo-data.service.ts`)
 *    - `SaasAdminService.deleteTenant` (`saas-admin.service.ts` orders
 *      `settlement_allocations` first instead of relying on 23503 retry,
 *      which does not catch 23514 check violations)
 * 2) Add `settlement_allocations` + `van_rep_financial_settlements` before
 *    `customer_payments` / `sales` / `van_sales_trips` in all van E2E
 *    cleanups (`van-sales-field-flow.e2e.ts`,
 *    `van-distribution-comprehensive.e2e.ts`,
 *    `van-sales-rogue-rep-and-multi-rep.e2e.ts`,
 *    `fleet-vehicle-reassignment.e2e.ts`,
 *    `van-field-returns.e2e.ts`,
 *    `simulations/van-sales-distribution-master-simulation.ts`).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { AuditService } from '../../src/core/audit/audit.service';
import { AuthCacheService } from '../../src/core/auth/services/auth-cache.service';
import { SessionService } from '../../src/core/auth/services/session.service';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import type { Database } from '../../src/database/database.types';
import { SaasAdminService } from '../../src/modules/saas-admin/saas-admin.service';
import { TrialTenantProvisioningService } from '../../src/modules/saas-admin/trial-tenant-provisioning.service';
import { SettingsDemoDataService } from '../../src/modules/settings/services/settings-demo-data.service';
import { executeWipeTables } from '../../src/modules/settings/services/settings-demo-data-wipe-tables';
import { SettingsService } from '../../src/modules/settings/settings.service';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PASS = 'TestPass#2026!';

async function createDb() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  // Create `sales` and `customer_payments` BEFORE `settlement_allocations` so PGlite
  // information_schema returns parents earlier unless deleteTenant explicitly orders children first.
  await pg.exec(`
    CREATE TABLE tenants (
      id text PRIMARY KEY,
      slug text,
      business_name text,
      status text,
      plan_id text,
      extra_features text,
      activity_type text,
      created_at timestamptz DEFAULT NOW(),
      updated_at timestamptz DEFAULT NOW()
    );
    CREATE TABLE settings (key text NOT NULL, value text, tenant_id text NOT NULL, account_id text NOT NULL);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, account_id text, name text);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, name text);
    CREATE TABLE users (id bigserial PRIMARY KEY, tenant_id text, account_id text, username text, role text, password_hash text, password_salt text, is_active boolean DEFAULT true, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint REFERENCES users(id), impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE tenant_subscription_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint REFERENCES users(id));
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, metadata text, updated_at timestamptz);
    CREATE TABLE product_categories (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE product_offers (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE product_units (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE product_customer_prices (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE product_pricing_profiles (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE pricing_rules (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, qty numeric DEFAULT 0);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, metadata text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, metadata text);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE van_sales_trips (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, sale_id bigint, product_id bigint);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, sale_id bigint);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, product_id bigint);
    CREATE TABLE held_sales (id bigint PRIMARY KEY, tenant_id text, note text);
    CREATE TABLE held_sale_items (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE purchase_items (id bigint PRIMARY KEY, tenant_id text, purchase_id bigint, product_id bigint);
    CREATE TABLE purchase_attachments (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE return_items (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE cashier_shifts (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE treasury_transactions (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE customer_payments (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE customer_ledger (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE supplier_payment_schedule_logs (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE supplier_payment_schedules (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE supplier_payments (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE supplier_ledger (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE stock_transfer_items (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE stock_transfers (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE stock_count_items (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE stock_count_sessions (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE damaged_stock_records (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE stock_movements (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE manufacturing_work_orders (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE manufacturing_wo_consumptions (id bigint PRIMARY KEY, tenant_id text, work_order_id bigint);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint);
    CREATE TABLE online_orders (id bigint PRIMARY KEY, tenant_id text, order_number text);
    CREATE TABLE trade_in_transactions (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE maintenance_ticket_parts (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE maintenance_tickets (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE pharmacy_clinical_services (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE pharmacy_shortages (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE pharmacy_prescriptions (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE price_change_items (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE price_change_runs (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_payroll_item_adjustments (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_employee_loan_installments (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_employee_loans (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_employee_ledger (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_employee_assets (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_attendance_exceptions (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_attendance_records (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_leave_requests (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_leave_types (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_compensation_packages (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_employment_contracts (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_employee_documents (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_employee_contacts (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_positions (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_job_titles (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_departments (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE journal_entries (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE journal_entry_lines (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE services (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE van_rep_financial_settlements (
      id integer PRIMARY KEY,
      tenant_id text NOT NULL,
      rep_id bigint REFERENCES delivery_representatives(id) ON DELETE CASCADE,
      trip_id bigint REFERENCES van_sales_trips(id) ON DELETE SET NULL
    );
    CREATE TABLE settlement_allocations (
      id serial PRIMARY KEY,
      tenant_id varchar NOT NULL,
      settlement_id integer NOT NULL REFERENCES van_rep_financial_settlements(id) ON DELETE CASCADE,
      sale_id integer REFERENCES sales(id) ON DELETE SET NULL,
      customer_payment_id integer REFERENCES customer_payments(id) ON DELETE SET NULL,
      amount numeric(14, 3) NOT NULL,
      business_day date NOT NULL DEFAULT '2026-11-17',
      created_at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT settlement_allocations_one_source_chk CHECK (
        (sale_id IS NOT NULL AND customer_payment_id IS NULL) OR
        (sale_id IS NULL AND customer_payment_id IS NOT NULL)
      )
    );
  `);
  const optionalWipedTables = [
    'accounting_installment_interest',
    'accounting_supplier_links',
    'accounting_marketplace_settlements',
    'import_partner_project_payouts',
    'import_preorder_refund_events',
    'import_container_preorders',
    'import_proforma_invoices',
    'van_field_returns',
    'customer_installments',
    'customer_installment_plans',
    'quotation_items',
    'quotations',
    'van_load_requisitions',
    'van_stock_transfer_items',
    'van_stock_transfers',
    'van_damaged_swaps',
    'van_field_visits',
    'delivery_rep_targets',
    'fleet_vehicle_drivers',
    'fleet_oil_changes',
    'fleet_fuel_logs',
    'fleet_vehicles',
    'van_trip_expenses',
    'van_trip_packaging_movements',
    'van_store_visits',
    'van_trade_marketing_surveys',
    'van_rep_live_breadcrumbs',
    'import_sale_allocations',
    'import_inventory_lots',
    'import_inventory_receipts',
    'import_inventory_receipt_reversals',
    'import_late_expense_events',
    'import_container_refund_events',
    'import_container_deposits',
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
    'import_project_partners',
    'import_sourcing_trips',
    'import_projects',
    'import_customs_brokers',
    'import_customs_tariffs',
    'import_fx_acquisitions',
    'import_partner_ledger',
    'import_approval_requests',
    'import_sale_partner_shares',
    'import_sales_and_profit',
    'import_shipment_items',
    'import_shipments',
    'import_partners',
    'accounting_posting_failures',
    'hr_holidays',
    'hr_payroll_loan_deduction_allocations',
    'hr_employee_adjustments',
    'treasury_transfers',
  ];
  for (const table of optionalWipedTables) {
    await pg.exec(`CREATE TABLE IF NOT EXISTS ${table} (id bigint PRIMARY KEY, tenant_id text)`);
  }
  return { pg, db };
}

async function seedTenantWithAllocations(
  db: any,
  tenantId: string,
  userId: number,
  options: { demoProduct?: boolean; baseId: number },
): Promise<void> {
  const { baseId } = options;
  const pass = await createPasswordRecord(PASS);
  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      slug: tenantId,
      business_name: tenantId,
      status: 'active',
      plan_id: 'plan_ultimate',
      activity_type: 'wholesale_van',
    })
    .execute();
  await db
    .insertInto('users')
    .values({
      id: userId,
      tenant_id: tenantId,
      account_id: tenantId,
      username: `admin_${tenantId}`,
      role: 'admin',
      password_hash: pass.hash,
      password_salt: pass.salt,
      is_active: true,
    })
    .execute();
  await db
    .insertInto('products')
    .values({
      id: baseId,
      tenant_id: tenantId,
      account_id: tenantId,
      name: 'Test Van SKU',
      stock_qty: 10,
      metadata: options.demoProduct ? JSON.stringify({ is_demo: true }) : null,
    })
    .execute();
  await db
    .insertInto('product_location_stock')
    .values({
      tenant_id: tenantId,
      product_id: baseId,
      qty: 10,
    })
    .execute();
  await db.insertInto('delivery_representatives').values({ id: baseId, tenant_id: tenantId }).execute();
  await db.insertInto('van_sales_trips').values({ id: baseId, tenant_id: tenantId }).execute();
  await db.insertInto('sales').values({ id: baseId, tenant_id: tenantId }).execute();
  await db
    .insertInto('sale_items')
    .values({ id: baseId, tenant_id: tenantId, sale_id: baseId, product_id: baseId })
    .execute();
  await db.insertInto('customer_payments').values({ id: baseId, tenant_id: tenantId }).execute();
  await db
    .insertInto('van_rep_financial_settlements')
    .values({
      id: baseId,
      tenant_id: tenantId,
      rep_id: baseId,
      trip_id: baseId,
    })
    .execute();
  await db
    .insertInto('settlement_allocations')
    .values([
      {
        tenant_id: tenantId,
        settlement_id: baseId,
        sale_id: baseId,
        customer_payment_id: null,
        amount: 75,
      },
      {
        tenant_id: tenantId,
        settlement_id: baseId,
        sale_id: null,
        customer_payment_id: baseId,
        amount: 10,
      },
    ])
    .execute();
}

function adminAuth(tenantId: string, userId: number): AuthContext {
  return {
    userId,
    sessionId: `sess-${tenantId}`,
    username: `admin_${tenantId}`,
    role: 'admin',
    permissions: ['*'],
    tenantId,
    accountId: tenantId,
  } as unknown as AuthContext;
}

async function main(): Promise<void> {
  const { pg, db } = await createDb();
  const anyDb = db as any;
  const oldEnv = process.env.PLATFORM_TENANT_ID;
  process.env.PLATFORM_TENANT_ID = 'zs';

  try {
    const audit = new AuditService(db);
    const demoService = new SettingsDemoDataService(db, audit, { savePreMutationBackup: async () => {} } as never);

    // 1) Factory wipe (executeWipeTables) must delete settlement_allocations before sales & customer_payments
    await seedTenantWithAllocations(anyDb, 't-wipe', 101, { baseId: 101 });
    await seedTenantWithAllocations(anyDb, 't-keep', 102, { baseId: 102 });
    await db.transaction().execute(async (trx) => {
      await executeWipeTables(trx, 't-wipe', 101);
    });
    const wipeAllocLeft = await anyDb
      .selectFrom('settlement_allocations')
      .select('id')
      .where('tenant_id', '=', 't-wipe')
      .execute();
    assert.equal(wipeAllocLeft.length, 0, 'executeWipeTables must empty settlement_allocations');
    const keepAlloc = await anyDb
      .selectFrom('settlement_allocations')
      .select('id')
      .where('tenant_id', '=', 't-keep')
      .execute();
    assert.equal(keepAlloc.length, 2, 'other tenant settlement_allocations must remain intact');
    console.log('  1) executeWipeTables settlement_allocations check constraint closure: OK');

    // 2) SettingsDemoDataService.resetStockBalances must clear settlement_allocations before deleting sales
    await seedTenantWithAllocations(anyDb, 't-reset-stock', 201, { baseId: 201 });
    const resetRes = await demoService.resetStockBalances(PASS, adminAuth('t-reset-stock', 201));
    assert.equal(resetRes.ok, true);
    assert.equal(
      (await anyDb.selectFrom('settlement_allocations').select('id').where('tenant_id', '=', 't-reset-stock').execute())
        .length,
      0,
    );
    assert.equal(
      (await anyDb.selectFrom('sales').select('id').where('tenant_id', '=', 't-reset-stock').execute()).length,
      0,
    );
    console.log('  2) SettingsDemoDataService.resetStockBalances: OK');

    // Guardrail check: the CHECK constraint itself stays strict on (NULL, NULL) inserts
    await anyDb
      .insertInto('van_rep_financial_settlements')
      .values({ id: 999, tenant_id: 't-check', rep_id: null, trip_id: null })
      .execute();
    await assert.rejects(
      () =>
        anyDb
          .insertInto('settlement_allocations')
          .values({
            tenant_id: 't-check',
            settlement_id: 999,
            sale_id: null,
            customer_payment_id: null,
            amount: 1,
          })
          .execute(),
      /settlement_allocations_one_source_chk/,
      'both-null allocation insert must remain refused by settlement_allocations_one_source_chk',
    );
    await anyDb.deleteFrom('van_rep_financial_settlements').where('tenant_id', '=', 't-check').execute();

    // 3) SettingsDemoDataService.wipeCatalogAndStock must clear settlement_allocations before deleting sales
    await seedTenantWithAllocations(anyDb, 't-wipe-cat', 301, { baseId: 301 });
    const catRes = await demoService.wipeCatalogAndStock(PASS, adminAuth('t-wipe-cat', 301));
    assert.equal(catRes.ok, true);
    assert.equal(
      (await anyDb.selectFrom('settlement_allocations').select('id').where('tenant_id', '=', 't-wipe-cat').execute())
        .length,
      0,
    );
    assert.equal(
      (await anyDb.selectFrom('sales').select('id').where('tenant_id', '=', 't-wipe-cat').execute()).length,
      0,
    );
    console.log('  3) SettingsDemoDataService.wipeCatalogAndStock: OK');

    // 4) SettingsDemoDataService.clearDemoData must clear settlement_allocations referencing demoSaleIds before sales
    await seedTenantWithAllocations(anyDb, 't-clear-demo', 401, { baseId: 401, demoProduct: true });
    const clearRes = await demoService.clearDemoData('', adminAuth('t-clear-demo', 401));
    assert.equal(clearRes.ok, true);
    assert.equal(clearRes.deletedProductsCount, 1);
    assert.equal(
      (
        await anyDb
          .selectFrom('settlement_allocations')
          .select('id')
          .where('tenant_id', '=', 't-clear-demo')
          .where('sale_id', '=', 401)
          .execute()
      ).length,
      0,
    );
    assert.equal((await anyDb.selectFrom('sales').select('id').where('id', '=', 401).execute()).length, 0);
    console.log('  4) SettingsDemoDataService.clearDemoData: OK');

    // 5) SaasAdminService.deleteTenant must delete settlement_allocations before sales/customer_payments (even when information_schema lists parents first)
    const rootPass = await createPasswordRecord(PASS);
    await anyDb
      .insertInto('tenants')
      .values({ id: 'zs', slug: 'zs', business_name: 'Platform', status: 'active' })
      .execute();
    await anyDb
      .insertInto('users')
      .values({
        id: 1,
        tenant_id: 'zs',
        account_id: 'zs',
        username: 'zs',
        role: 'super_admin',
        password_hash: rootPass.hash,
        password_salt: rootPass.salt,
        is_active: true,
      })
      .execute();
    await seedTenantWithAllocations(anyDb, 't-delete-tenant', 501, { baseId: 501 });

    const saasAdmin = new SaasAdminService(
      db,
      audit,
      new TrialTenantProvisioningService(db),
      { get: () => '' } as unknown as ConfigService,
      { invalidateTenant: () => {} } as unknown as SessionService,
      demoService,
      {} as SettingsService,
      new AuthCacheService(),
    );
    const delRes = await saasAdmin.deleteTenant('t-delete-tenant', PASS, {
      userId: 1,
      sessionId: 'sess-root',
      username: 'zs',
      role: 'super_admin',
      permissions: ['*'],
      tenantId: 'zs',
      accountId: 'zs',
    } as unknown as AuthContext);
    assert.equal(delRes.ok, true);
    assert.equal(
      (
        await anyDb
          .selectFrom('settlement_allocations')
          .select('id')
          .where('tenant_id', '=', 't-delete-tenant')
          .execute()
      ).length,
      0,
    );
    assert.equal(
      (await anyDb.selectFrom('tenants').select('id').where('id', '=', 't-delete-tenant').execute()).length,
      0,
    );
    console.log('  5) SaasAdminService.deleteTenant ordering: OK');

    // 6) Source pins: every van E2E cleanup deletes settlement_allocations + van_rep_financial_settlements before customer_payments/sales/van_sales_trips
    const vanE2eCleanupFiles = [
      'backend/test/e2e/van-sales-field-flow.e2e.ts',
      'backend/test/e2e/van-distribution-comprehensive.e2e.ts',
      'backend/test/e2e/van-sales-rogue-rep-and-multi-rep.e2e.ts',
      'backend/test/e2e/fleet-vehicle-reassignment.e2e.ts',
      'backend/test/e2e/van-field-returns.e2e.ts',
      'backend/test/e2e/simulations/van-sales-distribution-master-simulation.ts',
    ];
    for (const relPath of vanE2eCleanupFiles) {
      const fullSrc = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      const start = fullSrc.includes('async function cleanup(')
        ? fullSrc.indexOf('async function cleanup(')
        : fullSrc.lastIndexOf('finally {');
      const nextFn = fullSrc.indexOf('\nasync function ', start + 1);
      const src = nextFn > start ? fullSrc.slice(start, nextFn) : fullSrc.slice(start);
      const allocIdx = src.indexOf('settlement_allocations');
      const settleIdx = src.indexOf('van_rep_financial_settlements');
      assert.ok(allocIdx >= 0, `${relPath} cleanup must delete settlement_allocations`);
      assert.ok(settleIdx >= 0, `${relPath} cleanup must delete van_rep_financial_settlements`);
      assert.ok(
        allocIdx < settleIdx,
        `${relPath} cleanup must delete settlement_allocations before van_rep_financial_settlements`,
      );
      for (const parent of ['customer_payments', 'sales', 'van_sales_trips']) {
        const match = src.match(new RegExp(`(?:'|"|DELETE FROM )${parent}(?=['"\\s,;)])`));
        if (!match || match.index === undefined) continue;
        const parentIdx = match.index;
        assert.ok(
          allocIdx < parentIdx,
          `${relPath} cleanup must delete settlement_allocations (${allocIdx}) before ${parent} (${parentIdx}: ${match[0]})`,
        );
      }
    }
    console.log('  6) All 6 van E2E cleanups delete settlement_allocations before parents: OK');

    console.log('settlement-allocations-delete-order.spec: ALL PASSED');
  } finally {
    if (oldEnv === undefined) delete process.env.PLATFORM_TENANT_ID;
    else process.env.PLATFORM_TENANT_ID = oldEnv;
    await pg.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
