/*
 * General feature overrides (INV-VAN-GENERAL-FEATURE-OVERRIDES, P10):
 * a super-admin can grant or hide ANY feature per tenant, over the
 * mode/profile defaults. First use: POS + cash drawer on wholesale_van
 * (the client sells retail from his warehouse on the same tenant).
 *
 * HOW THIS IS DRIVEN: the real services on PGlite — PlanFeatureService,
 * SessionService (resolveAuthContext + buildMePayload), SettingsService
 * (getSettings / saveSettings / setActivityProfile), SaasAdminService
 * (updateTenantPlan + the plan sync), PermissionsGuard (real Reflector +
 * real decorators), SalesWriteService.createSale, CashDrawerService
 * (close), and VanSalesService (openTripAndLoad / executeFieldSale).
 * No stubs for the override path: the auth objects used by the guard and
 * the POS sale come from resolveAuthContext after the override row lands.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Reflector } from '@nestjs/core';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { AuthCacheService } from '../../src/core/auth/services/auth-cache.service';
import { PlanFeatureService } from '../../src/core/auth/services/plan-feature.service';
import { SessionService } from '../../src/core/auth/services/session.service';
import { PermissionService } from '../../src/core/auth/services/permission.service';
import { PermissionsGuard } from '../../src/core/auth/guards/permissions.guard';
import { RequireFeature } from '../../src/core/auth/decorators/feature.decorator';
import { RequirePermissions } from '../../src/core/auth/decorators/permissions.decorator';
import { resolvePillarScopedFeatures } from '../../src/core/tenant/industry-profiles';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { SaasAdminService } from '../../src/modules/saas-admin/saas-admin.service';
import { TrialTenantProvisioningService } from '../../src/modules/saas-admin/trial-tenant-provisioning.service';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

const configStub = { get: () => undefined } as never;

const superAdminAuth: AuthContext = {
  userId: 1,
  sessionId: 'spec-root',
  username: 'root',
  role: 'super_admin',
  permissions: [],
  tenantId: 'zs',
  accountId: ACCOUNT,
} as unknown as AuthContext;

const tenantAdminAuth: AuthContext = {
  userId: 1,
  sessionId: 'spec-admin',
  username: 'admin',
  role: 'admin',
  permissions: ['sales', 'canEditPrice', 'canManageSettings'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

const cashierAuth: AuthContext = {
  userId: 2,
  sessionId: 'spec-cashier',
  username: 'cashier',
  role: 'cashier',
  permissions: ['sales', 'cashDrawer'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  SalesWriteService.invalidateSettingsCache(TENANT);
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY, slug text, business_name text, owner_name text, owner_phone text, owner_email text, activity_type text, plan_id text, extra_features text, status text, trial_starts_at timestamptz, trial_ends_at timestamptz, activated_at timestamptz, created_at timestamptz, updated_at timestamptz, country_code text);
    CREATE TABLE tenant_feature_overrides (id bigserial PRIMARY KEY, tenant_id text NOT NULL, feature_code varchar(100) NOT NULL, granted boolean NOT NULL, granted_by bigint, granted_at timestamptz NOT NULL DEFAULT NOW(), reason text, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(), UNIQUE (tenant_id, feature_code));
    CREATE TABLE plan_features (id bigserial PRIMARY KEY, plan_id text, feature_code text);
    CREATE TABLE saas_plans (id bigint PRIMARY KEY, code text, feature_plan_id text, max_users int, is_active boolean DEFAULT true);
    CREATE TABLE tenant_subscriptions (id bigserial PRIMARY KEY, tenant_id text, plan_id bigint, status text, ends_at timestamptz, grace_ends_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, account_id text, username text, display_name text, default_branch_id bigint, role text, permissions_json text, password_hash text, password_salt text, must_change_password boolean DEFAULT false, is_active boolean DEFAULT true, locked_until timestamptz, last_login_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sessions (id text PRIMARY KEY, user_id bigint, tenant_id text, account_id text, expires_at timestamptz, impersonated_by bigint, last_seen_at timestamptz);
    CREATE TABLE settings (tenant_id text, account_id text, key text, value text, UNIQUE (tenant_id, key));
    CREATE TABLE tenant_tax_settings (id bigserial PRIMARY KEY, tenant_id text, provider text, is_active boolean);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
    CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE cost_centers (id bigint PRIMARY KEY, tenant_id text, code text, name text);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, half_wholesale_price numeric, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, updated_at timestamptz);
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT false, reason text, auto_restore_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW(), import_receipt_id bigint);
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE inventory_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30), quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_inventory_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, price_list_id bigint, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code text, system_cash_discount_amount numeric, gps_missing_reason text, received_at timestamptz);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, business_day text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, terminal_code text, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE held_sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, table_number text, created_by bigint, branch_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE price_lists (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text, type text, default_discount_percent numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE price_list_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, price_list_id bigint, product_id bigint, product_name text, category_id bigint, min_quantity numeric DEFAULT 1, fixed_price numeric, discount_percent numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text, cancelled_at timestamptz);
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb
    .insertInto('tenants')
    .values({
      id: TENANT,
      slug: 'van-client',
      business_name: 'Van Client',
      status: 'active',
      activity_type: 'wholesale_van',
      plan_id: 'plan_basic',
      extra_features: '[]',
    })
    .execute();
  // resolveAuthContext refuses an 'active' tenant without an active
  // subscription row (assertTenantLoginAllowed), so seed one.
  await anyDb
    .insertInto('tenant_subscriptions')
    .values({
      tenant_id: TENANT,
      plan_id: 1,
      status: 'active',
      ends_at: '2099-01-01T00:00:00.000Z',
    })
    .execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({
      id: 1,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      username: 'admin',
      display_name: 'Admin',
      role: 'admin',
      permissions_json: '["sales","canEditPrice","canManageSettings"]',
      password_hash: '',
      password_salt: '',
      must_change_password: false,
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('users')
    .values({
      id: 2,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      username: 'cashier',
      display_name: 'Cashier',
      role: 'cashier',
      permissions_json: '["sales","cashDrawer"]',
      password_hash: '',
      password_salt: '',
      must_change_password: false,
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('users')
    .values({
      id: 11,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      username: 'rep-11',
      display_name: 'Rep 11',
      role: 'cashier',
      permissions_json: '[]',
      password_hash: '',
      password_salt: '',
      must_change_password: false,
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('sessions')
    .values({
      id: 'sess-admin',
      user_id: 1,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      expires_at: '2099-01-01T00:00:00.000Z',
    })
    .execute();
  await anyDb
    .insertInto('sessions')
    .values({
      id: 'sess-cashier',
      user_id: 2,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      expires_at: '2099-01-01T00:00:00.000Z',
    })
    .execute();
  const accounts: Array<[number, string]> = [
    [1110, '1110'],
    [1120, '1120'],
    [1130, '1130'],
    [1140, '1140'],
    [2120, '2120'],
    [4100, '4100'],
    [4300, '4300'],
    [5100, '5100'],
  ];
  for (const [id, code] of accounts) {
    await anyDb
      .insertInto('accounting_accounts')
      .values({ id, tenant_id: TENANT, code, name_ar: code, is_active: true, is_tax: false })
      .execute();
  }
  await anyDb
    .insertInto('accounting_settings')
    .values({
      id: 1,
      tenant_id: TENANT,
      cash_account_id: 1110,
      bank_account_id: 1120,
      customer_receivable_account_id: 1130,
      inventory_account_id: 1140,
      sales_revenue_account_id: 4100,
      sales_discount_account_id: 4300,
      cogs_account_id: 5100,
      sales_tax_account_id: 2120,
    })
    .execute();
  await anyDb
    .insertInto('branches')
    .values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 })
    .execute();
  await anyDb
    .insertInto('stock_locations')
    .values({
      id: 10,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      branch_id: 1,
      name: 'Main warehouse',
      location_type: 'internal_warehouse',
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('products')
    .values({
      id: 101,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Widget 101',
      stock_qty: 100,
      cost_price: 10,
      retail_price: 100,
      wholesale_price: 100,
      min_selling_price: 1,
      is_active: true,
      item_type: 'product',
    })
    .execute();
  await anyDb
    .insertInto('product_location_stock')
    .values({
      tenant_id: TENANT,
      account_id: ACCOUNT,
      product_id: 101,
      branch_id: 1,
      location_id: 10,
      qty: 100,
    })
    .execute();
}

async function seedShift(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any)
    .insertInto('cashier_shifts')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      doc_no: `SHIFT-${id}`,
      opened_by: openedBy,
      status: 'open',
      branch_id: 1,
      location_id: 10,
      opening_cash: 0,
      expected_cash: 0,
      created_at: SHIFT_OPENED_AT,
    })
    .execute();
}

interface Services {
  sales: SalesWriteService;
  drawer: CashDrawerService;
  posting: AccountingPostingService;
  planFeatures: PlanFeatureService;
  session: SessionService;
  settings: SettingsService;
  saasAdmin: SaasAdminService;
  guard: PermissionsGuard;
  van: VanSalesService;
}

function buildServices(db: Kysely<Database>): Services {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const authz = new SalesAuthorizationService(db);
  const finance = new SalesFinanceService(db);
  const query = new SalesQueryService(db, authz);
  const idempotency = new IdempotencyService(db);
  const tx = new TransactionHelper();
  const audit = new AuditService(db);
  const authCache = new AuthCacheService();
  const planFeatures = new PlanFeatureService(db);
  const returnsStub = {};
  const sales = new SalesWriteService(
    db,
    tx,
    audit,
    authz,
    finance,
    query,
    posting,
    idempotency,
    planFeatures as never,
    returnsStub as never,
  );
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  const session = new SessionService(db, configStub, audit, authCache);
  const settings = new SettingsService(db, audit, authCache);
  const provisioning = new TrialTenantProvisioningService(db);
  const saasAdmin = new SaasAdminService(
    db,
    audit,
    provisioning,
    configStub,
    session,
    {} as never,
    settings,
    authCache,
  );
  const guard = new PermissionsGuard(new Reflector(), new PermissionService(), planFeatures, configStub);
  const postingStub = {
    postSale: async () => undefined,
    clearPostingFailure: async () => undefined,
    postVanStockTransfer: async () => undefined,
  };
  const van = new VanSalesService(db, {} as never, {} as never, postingStub as never);
  (van as any).resolveSystemAuthContext = async () => ({ userId: 1, sessionId: 'spec', username: 'spec' });
  (van as any).tripLifecycle.resolveSystemAuthContext = async () => ({
    userId: 1,
    sessionId: 'spec',
    username: 'spec',
  });
  return { sales, drawer, posting, planFeatures, session, settings, saasAdmin, guard, van };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err: any) {
    assert.equal(err?.code, code, `expected ${code}, got ${err?.code}: ${err?.message}`);
    return;
  }
  assert.fail(`expected rejection with ${code}`);
}

async function expectForbidden(fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    const status = typeof err?.getStatus === 'function' ? err.getStatus() : err?.status;
    assert.equal(status, 403, `expected a 403 Forbidden, got status ${status}: ${err?.message}`);
    return;
  }
  assert.fail('expected a 403 Forbidden rejection');
}

function posPayload(): any {
  return {
    items: [{ productId: 101, qty: 1, price: 100, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0,
    taxRate: 0,
    paymentType: 'cash',
    paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: 100 }],
    tenderedAmount: 100,
    branchId: 1,
    locationId: 10,
    source: 'pos',
  };
}

async function settingValue(db: Kysely<Database>, key: string): Promise<string | null> {
  const row = await (db as any)
    .selectFrom('settings')
    .select('value')
    .where('tenant_id', '=', TENANT)
    .where('key', '=', key)
    .executeTakeFirst();
  return row ? String(row.value) : null;
}

async function settingBool(db: Kysely<Database>, key: string): Promise<boolean | null> {
  const raw = await settingValue(db, key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) === true;
  } catch {
    return raw === 'true';
  }
}

async function grantPos(db: Kysely<Database>, svc: Services): Promise<void> {
  await svc.saasAdmin.updateTenantPlan(
    TENANT,
    {
      featureOverrides: [
        { featureCode: 'pos', granted: true, reason: 'wholesale client sells retail from warehouse' },
        { featureCode: 'cashDrawer', granted: true, reason: 'wholesale client sells retail from warehouse' },
      ],
    },
    superAdminAuth,
  );
}

async function resolveAdminAuth(svc: Services): Promise<AuthContext> {
  const auth = await svc.session.resolveAuthContext('sess-admin');
  assert.ok(auth, 'resolveAuthContext must return the admin auth');
  return auth;
}

@RequireFeature('cashDrawer')
class DrawerEndpoint {
  @RequirePermissions('cashDrawer')
  list(): boolean {
    return true;
  }
}

function guardContext(auth: AuthContext): any {
  return {
    getHandler: () => DrawerEndpoint.prototype.list,
    getClass: () => DrawerEndpoint,
    switchToHttp: () => ({ getRequest: () => ({ authContext: auth, url: '/api/cashier-shifts' }) }),
  };
}

async function freshCase(run: (db: Kysely<Database>, svc: Services) => Promise<void>): Promise<void> {
  const { db } = await makeDb();
  try {
    await seedFoundation(db);
    const svc = buildServices(db);
    await run(db, svc);
  } finally {
    await db.destroy();
  }
}

async function main(): Promise<void> {
  // 1. Baseline (no override): wholesale_van blocks POS + drawer on every
  // layer, while the van features stay on.
  await freshCase(async (db, svc) => {
    assert.equal(svc.planFeatures.hasFeature('plan_basic', [], 'pos', 'commerce', 'wholesale_van'), false);
    assert.equal(svc.planFeatures.hasFeature('plan_basic', [], 'cashDrawer', 'commerce', 'wholesale_van'), false);
    assert.equal(svc.planFeatures.hasFeature('plan_basic', [], 'vanSales', 'commerce', 'wholesale_van'), true);
    assert.equal(svc.planFeatures.hasFeature('plan_basic', [], 'deliveryReps', 'commerce', 'wholesale_van'), true);
    const features = resolvePillarScopedFeatures('wholesale_van', [], []);
    assert.ok(
      !features.includes('pos') && !features.includes('cashDrawer'),
      'tenant.features must not contain pos/cashDrawer',
    );
    assert.ok(
      features.includes('vanSales') && features.includes('deliveryReps'),
      'tenant.features must keep the van suite',
    );
    const settings: any = await svc.settings.getSettings(tenantAdminAuth);
    assert.equal(settings.posModuleEnabled, false, 'POS off by default on wholesale_van');
    assert.equal(settings.requireCashierShiftForSales, false, 'shift gate off by default on wholesale_van');
    assert.equal(settings.posGrantedByOverride, false, 'no override flag by default');
    const adminAuth = await resolveAdminAuth(svc);
    assert.deepEqual(adminAuth.featureOverrides, {}, 'no overrides on the resolved auth');
    // The cashier HOLDS the cashDrawer permission, so a 403 here can only
    // come from the feature check — not the permission check.
    const cashier = await svc.session.resolveAuthContext('sess-cashier');
    assert.ok(cashier, 'cashier auth resolves');
    await expectForbidden(() => svc.guard.canActivate(guardContext(cashier!)));
  });
  console.log('  1. wholesale_van baseline blocks POS + drawer, van suite on — passed');

  // 2. Grant (via the real updateTenantPlan): every layer opens, the sync
  // writes the module switches, one audit event per feature.
  await freshCase(async (db, svc) => {
    await grantPos(db, svc);
    const rows = await (db as any)
      .selectFrom('tenant_feature_overrides')
      .selectAll()
      .where('tenant_id', '=', TENANT)
      .execute();
    assert.equal(rows.length, 2, 'two override rows stored');
    assert.deepEqual(rows.map((r: any) => [String(r.feature_code), Boolean(r.granted)]).sort(), [
      ['cashDrawer', true],
      ['pos', true],
    ]);
    const auditRows = await (db as any)
      .selectFrom('audit_logs')
      .select('event_code')
      .where('event_code', '=', 'SAAS_TENANT_FEATURE_OVERRIDE')
      .execute();
    assert.equal(auditRows.length, 2, 'one audit event per granted feature');
    assert.equal(await settingBool(db, 'posModuleEnabled'), true, 'sync wrote posModuleEnabled=true');
    assert.equal(
      await settingBool(db, 'requireCashierShiftForSales'),
      true,
      'sync wrote requireCashierShiftForSales=true',
    );
    const settings: any = await svc.settings.getSettings(tenantAdminAuth);
    assert.equal(settings.posModuleEnabled, true, 'getSettings reports POS on');
    assert.equal(settings.requireCashierShiftForSales, true, 'getSettings reports the shift gate on');
    assert.equal(settings.posGrantedByOverride, true, 'computed override flag is true');
    const adminAuth = await resolveAdminAuth(svc);
    assert.deepEqual(
      adminAuth.featureOverrides,
      { pos: true, cashDrawer: true },
      'resolved auth carries the overrides',
    );
    assert.equal(
      svc.planFeatures.hasFeature(
        'plan_basic',
        [],
        'pos',
        adminAuth.pillar,
        adminAuth.activityType,
        adminAuth.featureOverrides,
      ),
      true,
    );
    const me: any = await svc.session.buildMePayload(adminAuth);
    assert.ok((me.tenant.features as string[]).includes('pos'), 'tenant.features contains pos');
    assert.ok((me.tenant.features as string[]).includes('cashDrawer'), 'tenant.features contains cashDrawer');
    assert.ok((me.tenant.features as string[]).includes('vanSales'), 'tenant.features keeps vanSales');
    const cashier = await svc.session.resolveAuthContext('sess-cashier');
    assert.ok(cashier, 'cashier auth resolves');
    assert.deepEqual(
      cashier!.featureOverrides,
      { pos: true, cashDrawer: true },
      'cashier auth carries the overrides too',
    );
    assert.equal(svc.guard.canActivate(guardContext(cashier!)), true, 'guard allows the drawer when granted');
    const detail: any = await svc.saasAdmin.getTenantById(TENANT, superAdminAuth);
    assert.deepEqual(
      (detail.tenant.featureOverrides as Array<{ featureCode: string; granted: boolean }>)
        .map((o) => [o.featureCode, o.granted])
        .sort(),
      [
        ['cashDrawer', true],
        ['pos', true],
      ],
      'getTenantById returns the current overrides for the modal',
    );
  });
  console.log('  2. grant opens every layer + sync writes + audit per feature — passed');

  // 3. Hide is airtight: the guard refuses the drawer even for a cashier
  // holding the cashDrawer permission, and the POS sale is refused before
  // any branch/stock validation (no sale row, stock untouched).
  await freshCase(async (db, svc) => {
    await svc.saasAdmin.updateTenantPlan(
      TENANT,
      {
        featureOverrides: [{ featureCode: 'cashDrawer', granted: false, reason: 'hide the drawer' }],
      },
      superAdminAuth,
    );
    const cashier = await svc.session.resolveAuthContext('sess-cashier');
    assert.ok(cashier, 'cashier auth resolves');
    assert.equal(cashier!.permissions.includes('cashDrawer'), true, 'cashier holds the permission');
    await expectForbidden(() => svc.guard.canActivate(guardContext(cashier!)));
    const adminAuth = await resolveAdminAuth(svc);
    await expectCode(svc.sales.createSale(posPayload(), adminAuth), 'POS_FEATURE_NOT_AVAILABLE');
    assert.equal((await (db as any).selectFrom('sales').select('id').execute()).length, 0, 'no sale row written');
    const stock = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('product_id', '=', 101)
      .executeTakeFirstOrThrow();
    assert.equal(Number(stock.qty), 100, 'stock untouched');
  });
  console.log('  3. hide refuses guard + POS sale, nothing written — passed');

  // 4. Granted POS without an open shift: OPEN_SHIFT_REQUIRED — proves the
  // pos check passed AND the override flipped the shift setting on.
  await freshCase(async (db, svc) => {
    await grantPos(db, svc);
    const adminAuth = await resolveAdminAuth(svc);
    await expectCode(svc.sales.createSale(posPayload(), adminAuth), 'OPEN_SHIFT_REQUIRED');
  });
  console.log('  4. granted POS without shift refuses OPEN_SHIFT_REQUIRED — passed');

  // 5. Granted POS with an open shift: posts, deducts the WAREHOUSE branch
  // stock (never van stock), and carries no trip link.
  await freshCase(async (db, svc) => {
    await grantPos(db, svc);
    await seedShift(db, 1, 1);
    const adminAuth = await resolveAdminAuth(svc);
    const created: any = await svc.sales.createSale(posPayload(), adminAuth);
    const saleId = Number(created?.sale?.id);
    assert.ok(saleId > 0, 'POS sale must post');
    const sale = await (db as any)
      .selectFrom('sales')
      .select(['total', 'branch_id', 'location_id', 'van_trip_id', 'delivery_rep_id', 'status'])
      .where('id', '=', saleId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(sale.total), 100, 'sale total 100');
    assert.equal(Number(sale.branch_id), 1, 'sale on the warehouse branch');
    assert.equal(Number(sale.location_id), 10, 'sale from the warehouse location');
    assert.equal(sale.van_trip_id, null, 'POS sale carries no trip');
    assert.equal(sale.delivery_rep_id, null, 'POS sale carries no rep');
    assert.equal(String(sale.status), 'posted', 'sale posted');
    const stock = await (db as any)
      .selectFrom('product_location_stock')
      .select('qty')
      .where('product_id', '=', 101)
      .where('location_id', '=', 10)
      .executeTakeFirstOrThrow();
    assert.equal(Number(stock.qty), 99, 'warehouse stock deducted by 1');
    const legs = await (db as any)
      .selectFrom('sale_payments')
      .select(['payment_channel', 'amount'])
      .where('sale_id', '=', saleId)
      .execute();
    assert.equal(legs.length, 1, 'one payment leg');
    assert.equal(String(legs[0].payment_channel), 'cash', 'cash leg');
    assert.equal(Number(legs[0].amount), 100, 'leg amount 100');
  });
  console.log('  5. granted POS posts to warehouse branch stock — passed');

  // 6. The grant survives a tenant-admin settings save: the protected-keys
  // filter must not strip it, and the computed flag is never persisted.
  await freshCase(async (db, svc) => {
    await grantPos(db, svc);
    const before: any = await svc.settings.getSettings(tenantAdminAuth);
    assert.equal(before.posModuleEnabled, true, 'POS on before the save');
    const saved: any = await svc.settings.saveSettings({ ...before, posGrantedByOverride: true }, tenantAdminAuth);
    assert.equal(saved.posModuleEnabled, true, 'POS still on after the tenant-admin save');
    assert.equal(saved.requireCashierShiftForSales, true, 'shift gate still on after the save');
    const after: any = await svc.settings.getSettings(tenantAdminAuth);
    assert.equal(after.posModuleEnabled, true, 'POS on in a fresh read after the save');
    assert.equal(await settingValue(db, 'posGrantedByOverride'), null, 'computed flag never persisted');
  });
  console.log('  6. grant survives tenant-admin settings save — passed');

  // 7. The grant survives an activity change (the wholesale_van patch
  // forces POS off; the override flips it back).
  await freshCase(async (db, svc) => {
    await grantPos(db, svc);
    await svc.settings.setActivityProfile('wholesale_van', tenantAdminAuth);
    const settings: any = await svc.settings.getSettings(tenantAdminAuth);
    assert.equal(settings.posModuleEnabled, true, 'POS on after the activity change');
    assert.equal(settings.requireCashierShiftForSales, true, 'shift gate on after the activity change');
    assert.equal(await settingBool(db, 'posModuleEnabled'), true, 'raw row still true after the activity change');
    const tenant = await (db as any)
      .selectFrom('tenants')
      .select('activity_type')
      .where('id', '=', TENANT)
      .executeTakeFirstOrThrow();
    assert.equal(String(tenant.activity_type), 'wholesale_van', 'activity stayed wholesale_van');
  });
  console.log('  7. grant survives activity change — passed');

  // 8. Revoke restores the profile default: POS off everywhere again, and
  // the removal is audited.
  await freshCase(async (db, svc) => {
    await grantPos(db, svc);
    await svc.saasAdmin.updateTenantPlan(
      TENANT,
      {
        featureOverrides: [{ featureCode: 'pos', granted: null }],
      },
      superAdminAuth,
    );
    assert.equal(
      (
        await (db as any)
          .selectFrom('tenant_feature_overrides')
          .select('id')
          .where('feature_code', '=', 'pos')
          .execute()
      ).length,
      0,
      'override row removed',
    );
    const settings: any = await svc.settings.getSettings(tenantAdminAuth);
    assert.equal(settings.posModuleEnabled, false, 'POS off after revoke');
    assert.equal(settings.requireCashierShiftForSales, false, 'shift gate off after revoke');
    assert.equal(settings.posGrantedByOverride, false, 'override flag false after revoke');
    assert.equal(await settingBool(db, 'posModuleEnabled'), false, 'sync wrote posModuleEnabled=false on revoke');
    const adminAuth = await resolveAdminAuth(svc);
    await expectCode(svc.sales.createSale(posPayload(), adminAuth), 'POS_FEATURE_NOT_AVAILABLE');
    const removals = await (db as any)
      .selectFrom('audit_logs')
      .select('event_code')
      .where('event_code', '=', 'SAAS_TENANT_FEATURE_OVERRIDE')
      .execute();
    assert.equal(removals.length, 3, 'grant x2 + removal audited');
  });
  console.log('  8. revoke restores the wholesale_van default — passed');

  // 9. Van flows keep working on the overridden tenant, and drawer cash
  // and trip cash never mix: the van cash lands in the trip + customer
  // payments, the POS cash lands in the drawer, and the shift close
  // expects exactly the POS cash.
  await freshCase(async (db, svc) => {
    await grantPos(db, svc);
    await seedShift(db, 1, 1);
    await (db as any)
      .insertInto('delivery_representatives')
      .values({ id: 11, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep 11', is_van_rep: true })
      .execute();
    await (db as any)
      .insertInto('products')
      .values({
        id: 205,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'Product 205',
        stock_qty: 20,
        cost_price: 10,
        retail_price: 100,
        wholesale_price: 90,
        credit_price: 100,
        consumer_price: 100,
        is_active: true,
      })
      .execute();
    await (db as any)
      .insertInto('product_location_stock')
      .values({
        tenant_id: TENANT,
        account_id: ACCOUNT,
        product_id: 205,
        location_id: 10,
        qty: 20,
      })
      .execute();
    const trip = await svc.van.openTripAndLoad(11, TENANT, ACCOUNT, {
      sourceWarehouseId: 10,
      items: [{ productId: 205, qty: 12 }],
    });
    const vanSale = await svc.van.executeFieldSale(11, TENANT, ACCOUNT, {
      tripId: trip.tripId,
      paymentMethod: 'cash',
      items: [{ productId: 205, qty: 4, unitPrice: 100, unitName: 'قطعة', unitMultiplier: 1 }],
    });
    assert.ok(Number(vanSale.saleId) > 0, 'van field sale posts');
    const tripRow = await (db as any)
      .selectFrom('van_sales_trips')
      .select(['cash_collected', 'sales_amount'])
      .where('id', '=', trip.tripId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(tripRow.cash_collected), 400, 'trip collected the 400 van cash');
    assert.equal(Number(tripRow.sales_amount), 400, 'trip sales 400');
    const vanSaleRow = await (db as any)
      .selectFrom('sales')
      .select(['van_trip_id', 'delivery_rep_id'])
      .where('id', '=', vanSale.saleId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(vanSaleRow.van_trip_id), Number(trip.tripId), 'van sale linked to its trip');
    assert.equal(Number(vanSaleRow.delivery_rep_id), 11, 'van sale linked to its rep');
    // The van cash lives ONLY in the trip totals — a cash field sale
    // records total=400 but paid_amount=0 (the rep holds the cash against
    // the trip; it is not a shop-style paid sale), writes NO
    // sale_payments leg and NO customer_payments row, so neither the
    // shift's sales breakdown nor its customer-collections computation
    // can ever see it.
    const vanSaleRow2 = await (db as any)
      .selectFrom('sales')
      .select(['total', 'paid_amount'])
      .where('id', '=', vanSale.saleId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(vanSaleRow2.total), 400, 'van sale total 400');
    assert.equal(Number(vanSaleRow2.paid_amount), 0, 'van sale paid_amount 0 — cash is trip-held, not sale-paid');
    assert.equal(
      (await (db as any).selectFrom('sale_payments').select('id').where('sale_id', '=', vanSale.saleId).execute())
        .length,
      0,
      'no sale_payments leg from a cash field sale',
    );
    assert.equal(
      (await (db as any).selectFrom('customer_payments').select('id').execute()).length,
      0,
      'no customer_payments row from a cash field sale',
    );

    const adminAuth = await resolveAdminAuth(svc);
    const created: any = await svc.sales.createSale(posPayload(), adminAuth);
    assert.ok(Number(created?.sale?.id) > 0, 'POS sale posts on the same tenant');
    assert.equal(
      (await (db as any).selectFrom('cashier_shifts').select('id').execute()).length,
      1,
      'van flow created no drawer row',
    );
    assert.equal(
      (
        await (db as any)
          .selectFrom('treasury_transactions')
          .select('id')
          .where('reference_type', '=', 'van_trip')
          .execute()
      ).length,
      0,
      'no treasury row references a trip',
    );
    // The close itself needs the closer's password (drawer rule: money-out
    // is password-gated); the seeded manager PIN satisfies it via the
    // manager-PIN fallback in assertCurrentUserPassword.
    const closed: any = await svc.drawer.closeCashierShift(1, { countedCash: 100, managerPin: '1234' }, adminAuth);
    assert.equal(closed.ok, true, 'shift close succeeds');
    const shiftRow = await (db as any)
      .selectFrom('cashier_shifts')
      .select(['status', 'expected_cash', 'counted_cash', 'variance'])
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    assert.equal(String(shiftRow.status), 'closed', 'shift closed');
    assert.equal(Number(shiftRow.expected_cash), 100, 'shift expects exactly the 100 POS cash');
    assert.equal(Number(shiftRow.counted_cash), 100, 'counted 100');
    assert.equal(Number(shiftRow.variance), 0, 'zero variance: the 400 van cash never entered the drawer');
  });
  console.log('  9. van flows keep working, drawer cash and trip cash never mix — passed');

  // 10. Source + invariant pins.
  {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const serviceSource = readFileSync(
      resolve(__dirname, '../../src/modules/sales/services/create-sale/load-sale-context.ts'),
      'utf8',
    );
    assert.ok(serviceSource.includes('POS_FEATURE_NOT_AVAILABLE'), 'create-sale carries the POS feature gate');
    const guardSource = readFileSync(
      resolve(__dirname, '../../src/modules/cash-drawer/cash-drawer.controller.ts'),
      'utf8',
    );
    assert.ok(guardSource.includes("@RequireFeature('cashDrawer')"), 'drawer controller declares the feature gate');
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(
      invariants.split('- INV-VAN-GENERAL-FEATURE-OVERRIDES ').length - 1,
      1,
      'invariant entry exists exactly once',
    );
  }
  console.log('  10. source + invariant pins passed');

  console.log('van-general-feature-overrides: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
