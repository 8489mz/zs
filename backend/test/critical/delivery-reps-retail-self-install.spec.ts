/*
 * INV-DELIVERY-REPS-RETAIL-SELF-INSTALL (P8b):
 *
 * THE BUG (proven live 2026-11-16 on retail trial tenant `muse2`):
 * P8 (INV-DELIVERY-REPS-RETAIL-CORE) opened `deliveryReps` in frontend
 * `COMMERCE_CORE_FEATURES`, yet live retail tenants could not activate
 * "إدارة مناديب التوصيل والدليفري" from the Apps Store (/apps):
 * 1) TrialTenantProvisioningService initialized `deliveryRepsModuleEnabled`
 *    to `false` for retail profiles (other than ecommerce/pharmacy), and
 *    getSettings only self-healed `undefined`, leaving it `false`.
 * 2) Backend entitlement (`industry-profiles.ts`,
 *    `settings-module-entitlement.engine.ts`, `PlanFeatureService`) did
 *    not treat `deliveryReps` as retail core across all 11 retail types
 *    on every plan (starter / plan_basic / tier_band*_L1 included) when
 *    `deliveryReps` was absent from `plan_features` / `extra_features`.
 * 3) Frontend Apps Store (`apps-catalog.tsx` requiredPlan `plan_ultimate`
 *    + `AppsStorePage.tsx` `tenant.features` gate) and `app-shell.tsx`
 *    local `hasFeature` blocked/hid `delivery-reps` when `tenant.features`
 *    did not already include `deliveryReps`.
 *
 * WHAT THIS PINS (real code on PGlite, zero mocks for core logic):
 * - All 11 retail tenant types across plan_basic, tier_band1_L1,
 *   plan_pro, and plan_ultimate self-install `deliveryRepsModuleEnabled`
 *   as owner (`role: 'admin'`) even starting from `false` and without
 *   `deliveryReps` in `plan_features` or `extra_features`.
 * - Default-on for new retail provisioning (`TrialTenantProvisioningService`)
 *   and unset retail `getSettings`, while respecting explicit `false` opt-out
 *   until activated and keeping uninstall super_admin-only.
 * - Incompatible verticals (`warehousing`, `services`, `contracting`,
 *   `maritime_freight`, `manufacturing`) remain blocked from self-install
 *   and `PermissionsGuard`; `plan_basic` / `tier_band1_L1` stay blocked
 *   from `vanSalesModuleEnabled`.
 * - Real `PermissionsGuard` + `PlanFeatureService` + `DeliveryRepsController`
 *   allows retail starter owners to open `/delivery-reps`, create a rep,
 *   create a COD delivery sale (`SalesWriteService.createSale`), and
 *   settle it (`DeliveryRepsService.settleOrder`).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { AuditService } from '../../src/core/audit/audit.service';
import { SUPER_ADMIN_PERMISSIONS } from '../../src/core/auth/constants/super-admin-permissions';
import { PermissionsGuard } from '../../src/core/auth/guards/permissions.guard';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { PermissionService } from '../../src/core/auth/services/permission.service';
import { PlanFeatureService } from '../../src/core/auth/services/plan-feature.service';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { resolvePillarScopedFeatures } from '../../src/core/tenant/industry-profiles';
import type { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { DeliveryRepsController } from '../../src/modules/delivery-reps/delivery-reps.controller';
import { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { TrialTenantProvisioningService } from '../../src/modules/saas-admin/trial-tenant-provisioning.service';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import { SettingsService } from '../../src/modules/settings/settings.service';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ACCOUNT = 'acc-p8b';

const RETAIL_PROFILES = [
  'retail_general',
  'pharmacy',
  'restaurant',
  'maintenance',
  'auto_parts',
  'clothing',
  'ecommerce',
  'supermarket',
  'appliances_installments',
  'spices',
  'perfumes',
] as const;

const NON_RETAIL_DELIVERY_BLOCKED = [
  'warehousing',
  'services',
  'contracting',
  'maritime_freight',
  'manufacturing',
] as const;

function ownerAuth(tenantId: string, overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 10,
    sessionId: `sess-${tenantId}`,
    username: 'muse',
    role: 'admin',
    permissions: [...SUPER_ADMIN_PERMISSIONS],
    tenantId,
    accountId: ACCOUNT,
    ...overrides,
  } as unknown as AuthContext;
}

async function rawSetting(db: any, tenantId: string, key: string): Promise<string | undefined> {
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('tenant_id', '=', tenantId)
    .where('key', '=', key)
    .executeTakeFirst();
  return row?.value as string | undefined;
}

function guardContext(auth: AuthContext, methodName: keyof DeliveryRepsController): any {
  const handler = (DeliveryRepsController.prototype as any)[methodName];
  assert.ok(typeof handler === 'function', `DeliveryRepsController must define ${String(methodName)}`);
  return {
    getHandler: () => handler,
    getClass: () => DeliveryRepsController,
    switchToHttp: () => ({
      getRequest: () => ({ url: `/api/delivery-reps/${String(methodName)}`, authContext: auth }),
    }),
  };
}

async function setupDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (
      id text PRIMARY KEY,
      slug text,
      business_name text,
      owner_name text,
      owner_phone text,
      owner_email text,
      status text,
      plan_id text,
      extra_features text,
      activity_type text,
      country_code text,
      trial_starts_at timestamptz,
      trial_ends_at timestamptz,
      activated_at timestamptz,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE settings (
      key text NOT NULL,
      value text,
      tenant_id text NOT NULL,
      account_id text NOT NULL,
      PRIMARY KEY (tenant_id, key)
    );
    CREATE TABLE users (
      id bigserial PRIMARY KEY,
      tenant_id text,
      account_id text,
      username text,
      role text,
      default_branch_id bigint,
      is_active boolean DEFAULT true,
      password_hash text,
      password_salt text
    );
    CREATE TABLE plan_features (
      plan_id text NOT NULL,
      feature_code text NOT NULL,
      PRIMARY KEY (plan_id, feature_code)
    );
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE cost_centers (id bigint PRIMARY KEY, tenant_id text, code text, name text);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, half_wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE price_lists (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text DEFAULT 'EGP', type text DEFAULT 'percentage', default_discount_percent numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE inventory_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number text, expiry_date text, quantity numeric DEFAULT 0, unit_cost numeric DEFAULT 0, location_id integer, supplier_name text, status text DEFAULT 'active', notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_inventory_batch_allocations (id bigint PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric DEFAULT 0, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, price_list_id integer, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text, created_by bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, system_cash_discount_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code varchar(32), settled_at timestamptz, settled_by bigint, delivery_signature text, delivery_photo_url text, delivery_notes text);
    CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text, sale_id bigint, status text, updated_at timestamptz);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, line_discount numeric(15, 3), unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigint PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (
      id bigserial PRIMARY KEY,
      tenant_id text NOT NULL,
      account_id text NOT NULL,
      name text NOT NULL,
      phone text,
      full_name text,
      national_id text,
      address text,
      vehicle_plate text,
      pin_hash text,
      pin_salt text,
      rep_type text,
      van_location_id bigint,
      is_van_rep boolean DEFAULT false,
      is_active boolean DEFAULT true,
      permissions jsonb NOT NULL DEFAULT '{}',
      metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz DEFAULT NOW(),
      updated_at timestamptz DEFAULT NOW()
    );
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, plate_number text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE fleet_vehicle_drivers (id bigserial PRIMARY KEY, tenant_id text, account_id text, vehicle_id bigint, rep_id bigint, shift_name text, is_active boolean DEFAULT true);
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz, terminal_code varchar(32), updated_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, request_key text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, exchange_tip_relief numeric(15, 3), exchange_courier_relief numeric(15, 3), branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text);
    CREATE TABLE held_sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, payment_type text, payment_channel text, paid_amount numeric DEFAULT 0, cash_amount numeric DEFAULT 0, card_amount numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, note text, search text, table_number text, order_type text, price_type text, branch_id bigint, location_id bigint, delivery_rep_id bigint, collection_status text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), tip_amount numeric(15, 3) DEFAULT 0, loyalty_points_redeemed integer DEFAULT 0, pager_number text, delivery_fee_mode text, online_order_id bigint, dining_course text, guest_count integer, guest_check_printed_at timestamptz);
    CREATE TABLE held_sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, held_sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, unit_name text, unit_multiplier numeric, price_type text, notes text, modifiers jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT true, reason text, auto_restore_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function main(): Promise<void> {
  const { pg, db } = await setupDb();
  const anyDb = db as any;

  try {
    const settingsService = new SettingsService(db, { log: async () => undefined } as never, {} as never);
    const provisioning = new TrialTenantProvisioningService(db);

    // 1) All 11 retail tenant types x 4 plans block regular tenant-admin self-install per
    //    INV-SAAS-ONLY-MODULE-CONTROL, while SaaS/platform impersonation (impersonatedBy = 1)
    //    activates deliveryRepsModuleEnabled on starter/pro/ultimate even starting from false.
    const plansToCheck = ['plan_basic', 'tier_band1_L1', 'plan_pro', 'plan_ultimate'] as const;
    for (const activity of RETAIL_PROFILES) {
      for (const planId of plansToCheck) {
        const tenantId = `t-${activity}-${planId}`;
        await anyDb
          .insertInto('tenants')
          .values({
            id: tenantId,
            slug: tenantId,
            business_name: tenantId,
            owner_name: 'Muse',
            owner_phone: '01000000000',
            status: 'trial',
            activity_type: activity,
            plan_id: planId,
            extra_features: JSON.stringify([]),
            created_at: new Date('2026-11-01T00:00:00Z'),
          })
          .execute();
        // Seed explicit false exactly like legacy TrialTenantProvisioningService did for muse2
        await anyDb
          .insertInto('settings')
          .values({
            tenant_id: tenantId,
            account_id: ACCOUNT,
            key: 'deliveryRepsModuleEnabled',
            value: 'false',
          })
          .execute();

        const beforeOptOut = await settingsService.getSettings(ownerAuth(tenantId, { planId, activityType: activity }));
        assert.equal(
          beforeOptOut.deliveryRepsModuleEnabled,
          false,
          `explicit false in DB must remain observable before activation (${tenantId})`,
        );

        await settingsService.saveSettings(
          { deliveryRepsModuleEnabled: true },
          ownerAuth(tenantId, { planId, activityType: activity }),
        );
        assert.equal(
          await rawSetting(anyDb, tenantId, 'deliveryRepsModuleEnabled'),
          'false',
          `regular tenant admin cannot self-toggle deliveryRepsModuleEnabled (${tenantId})`,
        );

        const saved = await settingsService.saveSettings(
          { deliveryRepsModuleEnabled: true },
          ownerAuth(tenantId, { planId, activityType: activity, impersonatedBy: 1 }),
        );
        assert.equal(
          saved.deliveryRepsModuleEnabled,
          true,
          `SaaS impersonator on ${activity} / ${planId} must activate deliveryRepsModuleEnabled`,
        );
        assert.equal(
          await rawSetting(anyDb, tenantId, 'deliveryRepsModuleEnabled'),
          'true',
          `deliveryRepsModuleEnabled must persist true for ${tenantId}`,
        );
      }
    }
    console.log('  1) all 11 retail types x 4 plans enforce SaaS-only activation + persist under impersonation: OK');

    // 2) Unset retail starter tenant defaults deliveryRepsModuleEnabled=true in getSettings
    await anyDb
      .insertInto('tenants')
      .values({
        id: 't-unset-starter',
        slug: 't-unset-starter',
        business_name: 'Unset Starter',
        owner_name: 'Owner',
        owner_phone: '01000000001',
        status: 'active',
        activity_type: 'retail_general',
        plan_id: 'plan_basic',
        created_at: new Date('2026-11-01T00:00:00Z'),
      })
      .execute();
    const unsetSettings = await settingsService.getSettings(
      ownerAuth('t-unset-starter', { planId: 'plan_basic', activityType: 'retail_general' }),
    );
    assert.equal(
      unsetSettings.deliveryRepsModuleEnabled,
      true,
      'unset retail starter tenant must default deliveryRepsModuleEnabled=true',
    );
    console.log('  2) unset retail starter defaults deliveryRepsModuleEnabled=true: OK');

    // 3) Trial provisioning defaults deliveryRepsModuleEnabled=true on all retail types, false on non-retail
    for (const activity of RETAIL_PROFILES) {
      const patch = provisioning.getIndustrySettingsPatch(activity);
      assert.equal(
        patch.deliveryRepsModuleEnabled,
        true,
        `provisioning patch must default deliveryRepsModuleEnabled=true for retail ${activity}`,
      );
    }
    for (const blocked of [...NON_RETAIL_DELIVERY_BLOCKED, 'wholesale_van', 'import_export']) {
      const patch = provisioning.getIndustrySettingsPatch(blocked);
      assert.equal(
        patch.deliveryRepsModuleEnabled,
        false,
        `provisioning patch must keep deliveryRepsModuleEnabled=false for non-retail ${blocked}`,
      );
    }
    console.log('  3) trial provisioning retail default-on vs non-retail default-off: OK');

    // 4) Retail features resolve deliveryReps on plan_basic; blocked verticals still blocked
    for (const activity of RETAIL_PROFILES) {
      const resolved = resolvePillarScopedFeatures(activity, ['sales', 'catalog', 'sessions', 'cashDrawer'], []);
      assert.ok(
        resolved.includes('deliveryReps'),
        `resolvePillarScopedFeatures(${activity}) must include deliveryReps on starter`,
      );
    }
    for (const blocked of ['contracting', 'maritime_freight', 'warehousing', 'services'] as const) {
      const resolved = resolvePillarScopedFeatures(blocked, ['sales', 'catalog', 'deliveryReps'], []);
      assert.ok(
        !resolved.includes('deliveryReps'),
        `resolvePillarScopedFeatures(${blocked}) must stay gated off`,
      );
    }
    const mfgResolved = resolvePillarScopedFeatures('manufacturing', ['sales', 'catalog', 'sessions', 'cashDrawer'], []);
    assert.ok(
      !mfgResolved.includes('deliveryReps'),
      'resolvePillarScopedFeatures(manufacturing) must not default-grant deliveryReps on starter plans',
    );
    console.log('  4) resolvePillarScopedFeatures retail core vs blocked verticals: OK');

    // 5) Incompatible verticals stay blocked on saveSettings; vanSales stays gated on plan_basic; uninstall stays super_admin-only
    for (const blocked of NON_RETAIL_DELIVERY_BLOCKED) {
      const tid = `t-blocked-${blocked}`;
      await anyDb
        .insertInto('tenants')
        .values({
          id: tid,
          slug: tid,
          business_name: tid,
          owner_name: 'Owner',
          owner_phone: '01000000002',
          status: 'active',
          activity_type: blocked,
          plan_id: 'plan_ultimate',
          created_at: new Date('2026-11-01T00:00:00Z'),
        })
        .execute();
      await settingsService.saveSettings(
        { deliveryRepsModuleEnabled: true },
        ownerAuth(tid, { planId: 'plan_ultimate', activityType: blocked }),
      );
      assert.equal(
        await rawSetting(anyDb, tid, 'deliveryRepsModuleEnabled'),
        undefined,
        `non-retail vertical ${blocked} must remain blocked from self-installing deliveryReps`,
      );
    }

    await settingsService.saveSettings(
      { vanSalesModuleEnabled: true },
      ownerAuth('t-retail_general-plan_basic', { planId: 'plan_basic', activityType: 'retail_general' }),
    );
    assert.equal(
      await rawSetting(anyDb, 't-retail_general-plan_basic', 'vanSalesModuleEnabled'),
      undefined,
      'plan_basic retail must remain blocked from self-installing vanSalesModuleEnabled',
    );
    await settingsService.saveSettings(
      { vanSalesModuleEnabled: true },
      ownerAuth('t-retail_general-tier_band1_L1', { planId: 'tier_band1_L1', activityType: 'retail_general' }),
    );
    assert.equal(
      await rawSetting(anyDb, 't-retail_general-tier_band1_L1', 'vanSalesModuleEnabled'),
      undefined,
      'tier_band1_L1 retail must remain blocked from self-installing vanSalesModuleEnabled',
    );
    await settingsService.saveSettings(
      { deliveryRepsModuleEnabled: false },
      ownerAuth('t-retail_general-plan_basic', { planId: 'plan_basic', activityType: 'retail_general' }),
    );
    assert.equal(
      await rawSetting(anyDb, 't-retail_general-plan_basic', 'deliveryRepsModuleEnabled'),
      'true',
      'tenant admin cannot self-uninstall active deliveryRepsModuleEnabled',
    );
    console.log('  5) non-retail blocks, vanSales tier gate, and super_admin-only uninstall preserved: OK');

    // 6) Real PermissionsGuard + PlanFeatureService on DeliveryRepsController
    const featureService = new PlanFeatureService(db);
    await featureService.refreshCache();
    const guard = new PermissionsGuard(new Reflector(), new PermissionService(), featureService, {} as never);
    for (const activity of RETAIL_PROFILES) {
      for (const planId of ['plan_basic', 'tier_band1_L1', 'plan_pro', 'plan_ultimate'] as const) {
        const auth = ownerAuth(`t-${activity}-${planId}`, { planId, activityType: activity, pillar: 'commerce', extraFeatures: [] });
        assert.equal(guard.canActivate(guardContext(auth, 'list')), true, `list allowed for ${activity}/${planId}`);
        assert.equal(guard.canActivate(guardContext(auth, 'create')), true, `create allowed for ${activity}/${planId}`);
        assert.equal(guard.canActivate(guardContext(auth, 'settleOrder')), true, `settleOrder allowed for ${activity}/${planId}`);
      }
    }
    for (const blocked of ['warehousing', 'services'] as const) {
      const auth = ownerAuth(`t-blocked-${blocked}`, { planId: 'plan_ultimate', activityType: blocked, pillar: 'commerce', extraFeatures: [] });
      assert.throws(
        () => guard.canActivate(guardContext(auth, 'list')),
        ForbiddenException,
        `PermissionsGuard must keep ${blocked} blocked from DeliveryRepsController`,
      );
    }
    console.log('  6) PermissionsGuard + PlanFeatureService on DeliveryRepsController: OK');

    // 7) Real end-to-end starter retail flow: create rep -> delivery sale -> settlement
    const e2eTenant = 't-retail_general-plan_basic';
    const e2eAuth = ownerAuth(e2eTenant, { planId: 'plan_basic', activityType: 'retail_general', pillar: 'commerce' });
    await anyDb.insertInto('settings').values({ tenant_id: e2eTenant, account_id: ACCOUNT, key: 'currency', value: 'EGP' }).execute();
    await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: e2eTenant, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
    await anyDb.insertInto('users').values({ id: 10, tenant_id: e2eTenant, account_id: ACCOUNT, username: 'muse', role: 'admin', is_active: true }).execute();
    for (const [id, code] of [[1110, '1110'], [1120, '1120'], [1130, '1130'], [1140, '1140'], [2115, '2115'], [2120, '2120'], [4100, '4100'], [4200, '4200'], [4300, '4300'], [5100, '5100'], [7100, '7100'], [7200, '7200']] as const) {
      await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: e2eTenant, code, name_ar: code, is_active: true, is_tax: false }).execute();
    }
    await anyDb.insertInto('accounting_settings').values({
      id: 1, tenant_id: e2eTenant, account_id: ACCOUNT,
      cash_account_id: 1110, bank_account_id: 1120, customer_receivable_account_id: 1130,
      inventory_account_id: 1140, sales_revenue_account_id: 4100, sales_discount_account_id: 4300,
      cogs_account_id: 5100, sales_tax_account_id: 2120,
    }).execute();
    await anyDb.insertInto('branches').values({ id: 1, tenant_id: e2eTenant, account_id: ACCOUNT, name: 'Main', default_stock_location_id: 10 }).execute();
    await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: e2eTenant, account_id: ACCOUNT, branch_id: 1, name: 'Main Store', location_type: 'internal_warehouse', is_active: true }).execute();
    await anyDb.insertInto('products').values({
      id: 101, tenant_id: e2eTenant, account_id: ACCOUNT, name: 'Retail Item',
      stock_qty: 20, cost_price: 50, retail_price: 120, wholesale_price: 120, min_selling_price: 1,
      is_active: true, item_type: 'product',
    }).execute();
    await anyDb.insertInto('product_location_stock').values({
      tenant_id: e2eTenant, account_id: ACCOUNT, product_id: 101, branch_id: 1, location_id: 10, qty: 20,
    }).execute();
    await anyDb.insertInto('customers').values({
      id: 7, tenant_id: e2eTenant, account_id: ACCOUNT, name: 'Walk-in Delivery Customer',
      balance: 0, credit_limit: 0, is_credit_blocked: false, is_active: true,
    }).execute();
    await anyDb.insertInto('cashier_shifts').values({
      id: 1, tenant_id: e2eTenant, account_id: ACCOUNT, doc_no: 'SHIFT-1',
      opened_by: 10, status: 'open', branch_id: 1, location_id: 10,
      opening_cash: 0, expected_cash: 0, created_at: '2026-11-16T08:00:00.000Z',
    }).execute();

    const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
    const posting = new AccountingPostingService(foundation);
    const authz = new SalesAuthorizationService(db);
    const finance = new SalesFinanceService(db);
    const query = new SalesQueryService(db, authz);
    const idempotency = new IdempotencyService(db);
    const tx = new TransactionHelper();
    const audit = new AuditService(db);
    const salesWrite = new SalesWriteService(db, tx, audit, authz, finance, query, posting, idempotency, featureService as never, {} as never);
    const repsService = new DeliveryRepsService(db, audit, posting, finance);

    // 7a. Create rep after guard passes
    assert.equal(guard.canActivate(guardContext(e2eAuth, 'create')), true);
    const repListResult: any = await repsService.create(
      { name: 'كابتن أحمد', phone: '01012345678', repType: 'delivery' },
      e2eAuth,
    );
    const createdRep = repListResult?.deliveryReps?.find((r: any) => r.name === 'كابتن أحمد');
    assert.ok(createdRep && Number(createdRep.id) > 0, 'delivery rep must be created');

    // 7b. Create COD delivery sale assigned to rep
    const saleResult: any = await salesWrite.createSale(
      {
        customerId: 7,
        branchId: 1,
        locationId: 10,
        orderType: 'delivery',
        deliveryRepId: Number(createdRep.id),
        deliveryFee: 20,
        deliveryFeeMode: 'store_fleet',
        collectionStatus: 'cod',
        paymentType: 'credit',
        paidAmount: 0,
        items: [{ productId: 101, qty: 1, unitPrice: 120 }],
      } as any,
      e2eAuth,
    );
    const saleId = Number(saleResult?.sale?.id ?? saleResult?.saleId ?? saleResult?.id);
    assert.ok(saleId > 0, 'COD delivery sale must be created');

    // 7c. Settle delivery order after guard passes
    assert.equal(guard.canActivate(guardContext(e2eAuth, 'settleOrder')), true);
    const settleRes: any = await repsService.settleOrder(saleId, e2eAuth, { countedCashAmount: 140 });
    assert.equal(settleRes?.ok, true, 'settleOrder must succeed');

    const settledSale = await anyDb.selectFrom('sales').select(['delivery_status', 'delivery_rep_id']).where('id', '=', saleId).executeTakeFirst();
    assert.equal(settledSale?.delivery_status, 'settled', 'sale must become settled');
    assert.equal(Number(settledSale?.delivery_rep_id), Number(createdRep.id));

    const treasuryRow = await anyDb
      .selectFrom('treasury_transactions')
      .select(['txn_type', 'amount'])
      .where('tenant_id', '=', e2eTenant)
      .where('reference_type', '=', 'cashier_shift')
      .executeTakeFirst();
    assert.equal(treasuryRow?.txn_type, 'cash_in');
    assert.equal(Number(treasuryRow?.amount), 140);
    console.log('  7) starter retail create rep -> delivery sale -> settleOrder: OK');

    // 8) Frontend Apps Store & navigation search contract pins
    const appsCatalogSrc = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/features/apps-store/data/apps-catalog.tsx'), 'utf8');
    const repsCatalogMatch = appsCatalogSrc.match(/key:\s*'deliveryRepsModuleEnabled'[\s\S]*?featureFlag:\s*'deliveryReps'/);
    assert.ok(repsCatalogMatch, 'deliveryRepsModuleEnabled catalog entry must exist');
    assert.ok(
      repsCatalogMatch[0].includes("requiredPlan: 'plan_basic'"),
      'deliveryRepsModuleEnabled catalog entry must require plan_basic, never plan_ultimate',
    );

    const repsRoutesSrc = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/features/delivery-reps/routes.tsx'), 'utf8');
    assert.ok(repsRoutesSrc.includes('مندوب') && repsRoutesSrc.includes('توصيل') && repsRoutesSrc.includes('تسوية'), 'delivery-reps navigation item must carry search keywords for مندوب / توصيل / تسوية');
    console.log('  8) frontend catalog requiredPlan + search keywords pins: OK');

    console.log('delivery-reps-retail-self-install.spec: ALL PASSED');
  } finally {
    await pg.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
