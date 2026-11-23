/*
 * POS retail feature gate (INV-POS-RETAIL-FEATURE-GATE):
 * the 2026-11-17 van gate (e16d043ce) made createSale refuse every POS
 * sale with 403 POS_FEATURE_NOT_AVAILABLE on a normal retail tenant,
 * because hasFeature('pos') is true only via a super-admin override,
 * an 'pos' extraFeature, an empty plan, omnichannel, or plan_ultimate
 * with zero plan_features rows — and no profile default, no migration
 * and no fallback ever grants the 'pos' code, while every real seeded
 * plan (0035 plan_ultimate: 21 rows, no 'pos') has plan_features rows.
 *
 * SINGLE SOURCE OF TRUTH (owner rule — "if POS shows in the sidebar,
 * the sale must work"): the three POS decisions must always agree for
 * every activity, because they all read the same source — the industry
 * profile in backend/src/core/tenant/industry-profiles.ts
 * (defaultFeatures + subVertical/pillar):
 *   1. the backend sale gate: PlanFeatureService.hasFeature('pos')
 *      (the exact call at load-sale-context.ts:166),
 *   2. the page decision: the real frontend getPosAvailability on the
 *      real SettingsService.getSettings output (what PosPage reads),
 *   3. the sidebar input: the real tenant.features from
 *      SessionService.buildMePayload (what app-shell reads) plus the
 *      real frontend resolveCurrentVertical on that tenant+settings.
 * The old services carve-out broke this: getSettings rewrote a
 * services tenant to retail_general whenever its plan contained
 * cashDrawer (every real plan does), so the page/sidebar showed POS
 * while the backend gate refused it. The rewrite is removed; a
 * services tenant stays services, and only a super-admin override
 * opens POS for it (override wins first on every layer).
 * Manufacturing is decided OFF, not on: its settings branch was DEAD
 * (it checked settings.pillar === 'manufacturing', but the profile's
 * pillar is 'commerce'), so the page said available while the gate,
 * the sidebar, the route suite and the settings UI all said off. The
 * branch now matches the profile subVertical, restoring its evident
 * intent; a factory-outlet counter is a separate product decision.
 * import_export stays OFF too: its route suite lists 'pos', but that
 * is route permission, not a till grant — wholesale_van's suite lists
 * 'pos' as well and van POS is definitively blocked; the settings
 * layer forces posModuleEnabled=false for import, the sidebar hides
 * it, and the page shows module-off, so adding 'pos' to its defaults
 * alone would create the same divergence in reverse (backend allows,
 * page refuses). The plan fallback lists never grant 'pos' either:
 * they only feed activities without a profile default and without an
 * early block (import_export, manufacturing), so a 'pos' there would
 * open POS for them on row-less plans. Retail's safety net is the
 * profile default itself.
 * 'core_pos' is NOT a gate code and is never cited as one here: it is
 * a descriptive feature-group key in pricing-catalog.generated.ts
 * ("الأساس التشغيلي") plus a comment in migration 0149. The gate
 * code is 'pos', and the defect was that nothing granted it.
 *
 * HOW THIS IS DRIVEN: the real services on PGlite — PlanFeatureService
 * (with refreshCache AFTER seeding plan_features, so the seeded rows,
 * not the empty-cache fallback, drive the decision), SessionService
 * (resolveAuthContext + buildMePayload), SettingsService (getSettings),
 * SaasAdminService (updateTenantPlan for the override cases) and
 * SalesWriteService.createSale for the real sale proof. The frontend
 * decisions are the real frontend modules (precedent: the fe1/fe2/fe3
 * specs import frontend utils the same way), loaded through a runtime
 * dynamic import because ts-node's CJS require cannot load the
 * frontend ESM .ts files (see the loader note at the imports). No stubs
 * for any decision.
 *
 * CACHE-LIVENESS PROOF: every seeded plan also carries a marker row
 * ('pos_agreement_probe') that no fallback list contains, and the spec
 * asserts hasFeature(marker) === true after refreshCache. Without the
 * refresh the cache is empty and plan_ultimate falls back to "true for
 * everything", which would make this spec pass on the broken tree —
 * the P10 spec's blind spot (it seeded zero plan_features rows).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { AuthCacheService } from '../../src/core/auth/services/auth-cache.service';
import { PlanFeatureService } from '../../src/core/auth/services/plan-feature.service';
import { SessionService } from '../../src/core/auth/services/session.service';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { SaasAdminService } from '../../src/modules/saas-admin/saas-admin.service';
import { TrialTenantProvisioningService } from '../../src/modules/saas-admin/trial-tenant-provisioning.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { INDUSTRY_PROFILES } from '../../src/core/tenant/industry-profiles';
import { getFallbackPlanFeatures } from '../../src/core/tenant/plan-tier.util';

/* The frontend decisions are the real frontend modules (precedent: the
 * fe1/fe2/fe3 specs import frontend utils the same way) — but a static
 * import cannot load them here: frontend/package.json is "type":
 * "module", so ts-node's CJS require throws ERR_REQUIRE_ESM (and it
 * compiles `import()` down to require() too). Load them through a real
 * runtime dynamic import instead: Node strips their erasable types
 * natively (both modules are dependency-free, no imports of their own).
 * Needs Node with default-on type stripping (CI: Node 22 latest;
 * this VM: Node 24). The specifier is an absolute file URL so the load
 * never depends on the process working directory. */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const loadFrontendModule = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
async function loadPosAvailability(): Promise<any> {
  return loadFrontendModule(pathToFileURL(resolve(__dirname, '../../../frontend/src/features/pos/lib/pos-availability.ts')).href);
}
async function loadVerticalScope(): Promise<any> {
  return loadFrontendModule(pathToFileURL(resolve(__dirname, '../../../frontend/src/shared/verticals/vertical-scope.ts')).href);
}

const TENANT = 't1';
const ACCOUNT = 'a1';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';
const MARKER = 'pos_agreement_probe';

const configStub = { get: () => undefined } as never;

/* plan_features rows exactly as the real migrations seed them:
 * 0035 (after 0030/0034 merged): plan_ultimate 21 rows, no 'pos';
 * 0035 plan_basic 4 rows; 0149 tier_band1_L2 level-2 OPERATIONS rows. */
const PLAN_ULTIMATE_FEATURES = [
  'catalog', 'sales', 'sessions', 'cashDrawer', 'purchases', 'inventory',
  'reports', 'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing',
  'restaurant', 'accounting', 'fixed_assets', 'installments',
  'taxIntegration', 'vat_declaration', 'manufacturing', 'import', 'pharmacy',
];
const PLAN_BASIC_FEATURES = ['catalog', 'sales', 'sessions', 'cashDrawer'];
const TIER_BAND1_L2_FEATURES = [
  'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments',
];

const superAdminAuth: AuthContext = {
  userId: 1, sessionId: 'spec-root', username: 'root', role: 'super_admin',
  permissions: [], tenantId: 'zs', accountId: ACCOUNT,
} as unknown as AuthContext;

const tenantAdminAuth: AuthContext = {
  userId: 1, sessionId: 'spec-admin', username: 'admin', role: 'admin',
  permissions: ['sales', 'canEditPrice', 'canManageSettings'], tenantId: TENANT, accountId: ACCOUNT,
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
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE inventory_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30), quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_inventory_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, price_list_id bigint, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code text, system_cash_discount_amount numeric, gps_missing_reason text, received_at timestamptz);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigint PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE product_pos_modifiers (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, modifier_group_id bigint);
    CREATE TABLE pos_modifier_groups (id bigint PRIMARY KEY, tenant_id text, name text, selection_type text, is_mandatory boolean DEFAULT false, min_selections int DEFAULT 0, max_selections int DEFAULT 10, is_active boolean DEFAULT true);
    CREATE TABLE addons (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, price numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_active boolean DEFAULT true);
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

async function seedFoundation(db: Kysely<Database>, activity: string, planId: string, planFeatures: string[], seedMarker = true): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({
    id: TENANT, slug: 'spec-tenant', business_name: 'Spec Tenant', status: 'active',
    activity_type: activity, plan_id: planId, extra_features: '[]',
  }).execute();
  await anyDb.insertInto('tenant_subscriptions').values({
    tenant_id: TENANT, plan_id: 1, status: 'active', ends_at: '2099-01-01T00:00:00.000Z',
  }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, username: 'admin', display_name: 'Admin', role: 'admin', permissions_json: '["sales","canEditPrice","canManageSettings"]', password_hash: '', password_salt: '', must_change_password: false, is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, account_id: ACCOUNT, username: 'cashier', display_name: 'Cashier', role: 'cashier', permissions_json: '["sales","cashDrawer"]', password_hash: '', password_salt: '', must_change_password: false, is_active: true }).execute();
  await anyDb.insertInto('sessions').values({ id: 'sess-admin', user_id: 1, tenant_id: TENANT, account_id: ACCOUNT, expires_at: '2099-01-01T00:00:00.000Z' }).execute();
  await anyDb.insertInto('sessions').values({ id: 'sess-cashier', user_id: 2, tenant_id: TENANT, account_id: ACCOUNT, expires_at: '2099-01-01T00:00:00.000Z' }).execute();
  const accounts: Array<[number, string]> = [
    [1110, '1110'], [1120, '1120'], [1130, '1130'], [1140, '1140'],
    [2120, '2120'], [4100, '4100'], [4300, '4300'], [5100, '5100'],
  ];
  for (const [id, code] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, is_active: true, is_tax: false }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, inventory_account_id: 1140,
    sales_revenue_account_id: 4100, sales_discount_account_id: 4300,
    cogs_account_id: 5100, sales_tax_account_id: 2120,
  }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: ACCOUNT, name: 'Widget 101',
    stock_qty: 100, cost_price: 10, retail_price: 100,
    wholesale_price: 100, min_selling_price: 1,
    is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 1, location_id: 10, qty: 100,
  }).execute();
  // The seeded plan rows, exactly as the migrations seed them, plus the
  // marker that proves the PlanFeatureService cache (not the fallback)
  // drives the decision. tier_band1_L1 seeds ZERO rows by design
  // (migration 0149 level 1 adds nothing), so its cases pass
  // seedMarker=false and prove the zero-row/fallback path too.
  for (const feature of seedMarker ? [...planFeatures, MARKER] : planFeatures) {
    await anyDb.insertInto('plan_features').values({ plan_id: planId, feature_code: feature }).execute();
  }
}

async function seedShift(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, doc_no: `SHIFT-${id}`,
    opened_by: openedBy, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0, created_at: SHIFT_OPENED_AT,
  }).execute();
}

interface Services {
  sales: SalesWriteService;
  planFeatures: PlanFeatureService;
  session: SessionService;
  settings: SettingsService;
  saasAdmin: SaasAdminService;
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
    db, tx, audit, authz, finance, query, posting, idempotency,
    planFeatures as never, returnsStub as never,
  );
  const session = new SessionService(db, configStub, audit, authCache);
  const settings = new SettingsService(db, audit, authCache);
  const provisioning = new TrialTenantProvisioningService(db);
  const saasAdmin = new SaasAdminService(db, audit, provisioning, configStub, session, {} as never, settings, authCache);
  return { sales, planFeatures, session, settings, saasAdmin };
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

function posPayload(): any {
  return {
    items: [{ productId: 101, qty: 1, price: 100, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: 100 }], tenderedAmount: 100,
    branchId: 1, locationId: 10, source: 'pos',
  };
}

async function resolveAdminAuth(svc: Services): Promise<AuthContext> {
  const auth = await svc.session.resolveAuthContext('sess-admin');
  assert.ok(auth, 'resolveAuthContext must return the admin auth');
  return auth;
}

interface Agreement {
  frontendAvailable: boolean;
  backendAllowed: boolean;
  featuresIncludePos: boolean;
  vertical: string;
  tenantFeatures: string[];
}

/* The three POS decisions, each read from the real production path:
 * backend gate = the exact hasFeature call create-sale makes;
 * page = the real frontend getPosAvailability on the real getSettings;
 * sidebar input = the real tenant.features from buildMePayload plus the
 * real frontend resolveCurrentVertical on that tenant + settings. */
async function readAgreement(db: Kysely<Database>, svc: Services, auth: AuthContext): Promise<Agreement> {
  const backendAllowed = svc.planFeatures.hasFeature(
    auth.planId, auth.extraFeatures, 'pos', auth.pillar, auth.activityType, auth.featureOverrides,
  );
  const settings: any = await svc.settings.getSettings(tenantAdminAuth);
  const { getPosAvailability } = await loadPosAvailability();
  const frontendAvailable = getPosAvailability(settings).available;
  const me: any = await svc.session.buildMePayload(auth);
  const tenantFeatures = (me?.tenant?.features ?? []) as string[];
  const featuresIncludePos = tenantFeatures.includes('pos');
  const { resolveCurrentVertical } = await loadVerticalScope();
  const vertical = resolveCurrentVertical(me?.tenant, settings);
  return { frontendAvailable, backendAllowed, featuresIncludePos, vertical, tenantFeatures };
}

async function freshCase(
  activity: string,
  planId: string,
  planFeatures: string[],
  run: (db: Kysely<Database>, svc: Services) => Promise<void>,
  opts: { seedMarker?: boolean } = {},
): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    const seedMarker = opts.seedMarker !== false;
    await seedFoundation(db, activity, planId, planFeatures, seedMarker);
    const svc = buildServices(db);
    // Cache liveness: the seeded rows (not the empty-cache fallback)
    // must drive hasFeature — the marker is in no fallback list.
    await svc.planFeatures.refreshCache();
    if (seedMarker) {
      const probeAuth = await resolveAdminAuth(svc);
      assert.equal(
        svc.planFeatures.hasFeature(probeAuth.planId, probeAuth.extraFeatures, MARKER, probeAuth.pillar, probeAuth.activityType, probeAuth.featureOverrides),
        true,
        `plan_features cache must be loaded from seeded rows for ${activity}/${planId}`,
      );
    }
    await run(db, svc);
  } finally {
    await db.destroy();
  }
}

async function assertAgreement(
  db: Kysely<Database>,
  svc: Services,
  label: string,
  expectedAvailable: boolean,
  expectedVertical: string,
): Promise<void> {
  const auth = await resolveAdminAuth(svc);
  const agreement = await readAgreement(db, svc, auth);
  assert.equal(agreement.backendAllowed, expectedAvailable, `${label}: backend gate must be ${expectedAvailable}`);
  assert.equal(agreement.frontendAvailable, expectedAvailable, `${label}: page decision must be ${expectedAvailable}`);
  assert.equal(agreement.frontendAvailable, agreement.backendAllowed, `${label}: page and backend must agree`);
  assert.equal(agreement.featuresIncludePos, expectedAvailable, `${label}: tenant.features must ${expectedAvailable ? 'include' : 'exclude'} 'pos'`);
  assert.equal(agreement.vertical, expectedVertical, `${label}: sidebar vertical must be ${expectedVertical}`);
}

/* POS-selling profiles: 'pos' in defaultFeatures (the fix). Blocked:
 * wholesale_van / warehousing / services (subVertical early-return),
 * import_export + manufacturing (settings + sidebar force POS off),
 * contracting / maritime_freight (pillar rules). */
const MATRIX: Array<{ activity: string; planId: string; features: string[]; expected: boolean; vertical: string; seedMarker?: boolean }> = [
  { activity: 'clothing', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: true, vertical: 'retail_general' },
  { activity: 'retail_general', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: true, vertical: 'retail_general' },
  { activity: 'pharmacy', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: true, vertical: 'pharmacy' },
  { activity: 'restaurant', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: true, vertical: 'restaurant' },
  { activity: 'supermarket', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: true, vertical: 'retail_general' },
  { activity: 'spices', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: true, vertical: 'retail_general' },
  { activity: 'perfumes', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: true, vertical: 'retail_general' },
  { activity: 'auto_parts', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: true, vertical: 'retail_general' },
  { activity: 'appliances_installments', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: true, vertical: 'retail_general' },
  { activity: 'maintenance', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: true, vertical: 'maintenance' },
  { activity: 'ecommerce', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: true, vertical: 'retail_general' },
  { activity: 'clothing', planId: 'plan_basic', features: PLAN_BASIC_FEATURES, expected: true, vertical: 'retail_general' },
  { activity: 'clothing', planId: 'tier_band1_L2', features: TIER_BAND1_L2_FEATURES, expected: true, vertical: 'retail_general' },
  { activity: 'clothing', planId: 'tier_band1_L1', features: [], expected: true, vertical: 'retail_general', seedMarker: false },
  { activity: 'retail_general', planId: 'tier_band1_L1', features: [], expected: true, vertical: 'retail_general', seedMarker: false },
  { activity: 'wholesale_van', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: false, vertical: 'wholesale_van' },
  { activity: 'warehousing', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: false, vertical: 'warehousing' },
  { activity: 'services', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: false, vertical: 'services' },
  { activity: 'import_export', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: false, vertical: 'import_export' },
  { activity: 'contracting', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: false, vertical: 'contracting' },
  { activity: 'maritime_freight', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: false, vertical: 'maritime' },
  { activity: 'manufacturing', planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, expected: false, vertical: 'manufacturing' },
];

const POS_PROFILES = [
  'retail_general', 'pharmacy', 'restaurant', 'maintenance', 'auto_parts',
  'clothing', 'ecommerce', 'supermarket', 'appliances_installments', 'spices', 'perfumes',
];
const BLOCKED_PROFILES = [
  'wholesale_van', 'warehousing', 'services', 'import_export',
  'contracting', 'maritime_freight', 'manufacturing',
];

async function main(): Promise<void> {
  // 0. The mechanism: 'pos' is in the defaultFeatures of exactly the
  // POS-selling profiles, and in none of the blocked ones. The plan
  // fallback lists must NEVER grant 'pos': they only feed activities
  // without a profile default and without an early block (import_export
  // and manufacturing), so a 'pos' there would open POS for them on
  // row-less plans while the settings layer still forces it off — the
  // same divergence in the other direction. Retail's safety net is the
  // profile default itself, which hasFeature checks before any fallback.
  {
    for (const key of POS_PROFILES) {
      assert.ok(
        (INDUSTRY_PROFILES as any)[key].defaultFeatures.includes('pos'),
        `defaultFeatures(${key}) must include 'pos'`,
      );
    }
    for (const key of BLOCKED_PROFILES) {
      assert.ok(
        !(INDUSTRY_PROFILES as any)[key].defaultFeatures.includes('pos'),
        `defaultFeatures(${key}) must NOT include 'pos'`,
      );
    }
    for (const planId of ['plan_basic', 'plan_pro', 'plan_ultimate', 'tier_band1_L1', 'tier_band1_L2']) {
      assert.ok(
        !getFallbackPlanFeatures(planId).includes('pos'),
        `getFallbackPlanFeatures(${planId}) must NOT include 'pos'`,
      );
    }
  }
  console.log('  0. defaultFeatures carries pos on exactly the 11 retail profiles; fallback never grants pos — passed');

  // 1. The agreement matrix: page, backend gate, tenant.features and
  // sidebar vertical agree on every activity, against seeded rows.
  for (const row of MATRIX) {
    await freshCase(row.activity, row.planId, row.features, async (db, svc) => {
      await assertAgreement(db, svc, `${row.activity}/${row.planId}`, row.expected, row.vertical);
    }, { seedMarker: row.seedMarker });
  }
  console.log('  1. agreement matrix (22 activities x page/gate/features/vertical) — passed');

  // 2. The real sales: a full POS sale posts for clothing AND
  // retail_general on real plans with plan_features seeded exactly as
  // the migrations seed them — tier_band1_L1 (ZERO rows by design,
  // migration 0149 level 1), plan_basic and plan_ultimate. Never
  // plan_id = null. The gate passes (OPEN_SHIFT_REQUIRED without a
  // shift), then the sale posts.
  for (const activity of ['clothing', 'retail_general']) {
    for (const plan of [
      { planId: 'tier_band1_L1', features: [] as string[], seedMarker: false },
      { planId: 'plan_basic', features: PLAN_BASIC_FEATURES, seedMarker: true },
      { planId: 'plan_ultimate', features: PLAN_ULTIMATE_FEATURES, seedMarker: true },
    ]) {
      await freshCase(activity, plan.planId, plan.features, async (db, svc) => {
        const auth = await resolveAdminAuth(svc);
        await expectCode(svc.sales.createSale(posPayload(), auth), 'OPEN_SHIFT_REQUIRED');
        await seedShift(db, 1, 1);
        const created: any = await svc.sales.createSale(posPayload(), auth);
        const saleId = Number(created?.sale?.id);
        assert.ok(saleId > 0, `${activity}/${plan.planId}: POS sale must post`);
        const sale = await (db as any).selectFrom('sales').select(['total', 'status']).where('id', '=', saleId).executeTakeFirstOrThrow();
        assert.equal(Number(sale.total), 100, `${activity}/${plan.planId}: sale total 100`);
        assert.equal(String(sale.status), 'posted', `${activity}/${plan.planId}: sale posted`);
        const stock = await (db as any).selectFrom('product_location_stock').select('qty').where('product_id', '=', 101).where('location_id', '=', 10).executeTakeFirstOrThrow();
        assert.equal(Number(stock.qty), 99, `${activity}/${plan.planId}: stock deducted by 1`);
      }, { seedMarker: plan.seedMarker });
    }
  }
  console.log('  2. full POS sales post for clothing + retail_general on tier_band1_L1 / plan_basic / plan_ultimate — passed');

  // 3. The real refusal, wholesale_van + seeded rows, no override:
  // 403 before any branch/stock validation, nothing written.
  await freshCase('wholesale_van', 'plan_ultimate', PLAN_ULTIMATE_FEATURES, async (db, svc) => {
    const auth = await resolveAdminAuth(svc);
    await expectCode(svc.sales.createSale(posPayload(), auth), 'POS_FEATURE_NOT_AVAILABLE');
    assert.equal((await (db as any).selectFrom('sales').select('id').execute()).length, 0, 'no sale row written');
    const stock = await (db as any).selectFrom('product_location_stock').select('qty').where('product_id', '=', 101).executeTakeFirstOrThrow();
    assert.equal(Number(stock.qty), 100, 'stock untouched');
  });
  console.log('  3. wholesale_van POS sale refused, nothing written — passed');

  // 4. The super-admin override still opens the van: every layer agrees
  // true, and the sale posts (sidebar nav still hides it by the P10
  // app-shell block — the dashboard/mobile paths carry it — so the
  // vertical stays wholesale_van here; only page/gate/features agree).
  await freshCase('wholesale_van', 'plan_ultimate', PLAN_ULTIMATE_FEATURES, async (db, svc) => {
    await svc.saasAdmin.updateTenantPlan(TENANT, {
      featureOverrides: [
        { featureCode: 'pos', granted: true, reason: 'wholesale client sells retail from warehouse' },
        { featureCode: 'cashDrawer', granted: true, reason: 'wholesale client sells retail from warehouse' },
      ],
    }, superAdminAuth);
    const auth = await resolveAdminAuth(svc);
    assert.deepEqual(auth.featureOverrides, { pos: true, cashDrawer: true }, 'resolved auth carries the overrides');
    const agreement = await readAgreement(db, svc, auth);
    assert.equal(agreement.backendAllowed, true, 'van+grant: backend gate true');
    assert.equal(agreement.frontendAvailable, true, 'van+grant: page true');
    assert.equal(agreement.featuresIncludePos, true, 'van+grant: tenant.features includes pos');
    assert.equal(agreement.vertical, 'wholesale_van', 'van+grant: vertical stays wholesale_van');
    await seedShift(db, 1, 1);
    const created: any = await svc.sales.createSale(posPayload(), auth);
    assert.ok(Number(created?.sale?.id) > 0, 'van+grant POS sale must post');
  });
  console.log('  4. super-admin override opens the van on every layer — passed');

  // 5. The super-admin hide still closes retail: every layer agrees
  // false, and the sale is refused.
  await freshCase('clothing', 'plan_ultimate', PLAN_ULTIMATE_FEATURES, async (db, svc) => {
    await svc.saasAdmin.updateTenantPlan(TENANT, {
      featureOverrides: [{ featureCode: 'pos', granted: false, reason: 'hide POS for this tenant' }],
    }, superAdminAuth);
    const auth = await resolveAdminAuth(svc);
    assert.deepEqual(auth.featureOverrides, { pos: false }, 'resolved auth carries the hide');
    const agreement = await readAgreement(db, svc, auth);
    assert.equal(agreement.backendAllowed, false, 'clothing+hide: backend gate false');
    assert.equal(agreement.frontendAvailable, false, 'clothing+hide: page false');
    assert.equal(agreement.featuresIncludePos, false, 'clothing+hide: tenant.features excludes pos');
    await expectCode(svc.sales.createSale(posPayload(), auth), 'POS_FEATURE_NOT_AVAILABLE');
  });
  console.log('  5. super-admin hide closes retail on every layer — passed');

  // 6. The route closes on hide too: isRouteAllowedInVertical refuses
  // 'pos' for a retail tenant whose explicit tenant.features list lacks
  // it, while the P10 grant escape still opens it and an empty/missing
  // list keeps the legacy retail default. The cash-drawer route follows
  // the same rule keyed on its own feature ('cashDrawer').
  {
    const { isRouteAllowedInVertical } = await loadVerticalScope();
    // (a) Hide: clothing + super-admin hide of 'pos' (case 5 setup).
    await freshCase('clothing', 'plan_ultimate', PLAN_ULTIMATE_FEATURES, async (db, svc) => {
      await svc.saasAdmin.updateTenantPlan(TENANT, {
        featureOverrides: [{ featureCode: 'pos', granted: false, reason: 'hide POS for this tenant' }],
      }, superAdminAuth);
      const auth = await resolveAdminAuth(svc);
      const agreement = await readAgreement(db, svc, auth);
      assert.equal(agreement.featuresIncludePos, false, 'clothing+hide: tenant.features excludes pos');
      assert.equal(isRouteAllowedInVertical('retail_general', 'pos', undefined, agreement.tenantFeatures), false, 'clothing+hide: /pos route refused');
      assert.equal(isRouteAllowedInVertical('retail_general', 'pos/new', undefined, agreement.tenantFeatures), false, 'clothing+hide: /pos subroute refused');
      // The drawer follows its own feature: 'cashDrawer' is still granted here, so its route stays open.
      assert.equal(isRouteAllowedInVertical('retail_general', 'cash-drawer', undefined, agreement.tenantFeatures), true, 'clothing+hide pos only: cash-drawer route stays open (cashDrawer still granted)');
      assert.equal(isRouteAllowedInVertical('retail_general', 'cash-drawer', undefined, ['sales', 'catalog']), false, 'cash-drawer route closes when the list lacks cashDrawer');
      assert.equal(isRouteAllowedInVertical('retail_general', 'pos', undefined, ['sales', 'catalog', 'cashDrawer']), false, 'pos route closes when the list lacks pos even with cashDrawer');
    });
    // (b) Grant: clothing with 'pos' in the list → route open (P10 escape intact).
    await freshCase('clothing', 'plan_ultimate', PLAN_ULTIMATE_FEATURES, async (db, svc) => {
      const auth = await resolveAdminAuth(svc);
      const agreement = await readAgreement(db, svc, auth);
      assert.equal(agreement.featuresIncludePos, true, 'clothing: tenant.features includes pos');
      assert.equal(isRouteAllowedInVertical('retail_general', 'pos', undefined, agreement.tenantFeatures), true, 'clothing: /pos route open');
      assert.equal(isRouteAllowedInVertical('retail_general', 'cash-drawer', undefined, agreement.tenantFeatures), true, 'clothing: cash-drawer route open');
    });
    // (c) Legacy: an empty or missing list keeps the retail default.
    assert.equal(isRouteAllowedInVertical('retail_general', 'pos', undefined, []), true, 'legacy empty list: /pos route open');
    assert.equal(isRouteAllowedInVertical('retail_general', 'pos'), true, 'legacy no list: /pos route open');
    assert.equal(isRouteAllowedInVertical('retail_general', 'cash-drawer', undefined, []), true, 'legacy empty list: cash-drawer route open');
  }
  console.log('  6. route closes on hide, opens on grant, legacy empty list unchanged — passed');

  // 7. Source + invariant pins.
  {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const serviceSource = readFileSync(resolve(__dirname, '../../src/modules/sales/services/create-sale/load-sale-context.ts'), 'utf8');
    assert.ok(serviceSource.includes('POS_FEATURE_NOT_AVAILABLE'), 'create-sale carries the POS feature gate');
    const settingsSource = readFileSync(resolve(__dirname, '../../src/modules/settings/settings.service.ts'), 'utf8');
    assert.ok(!settingsSource.includes("primaryActivity = 'retail_general';\n      } else if ((primaryActivity === 'services'"), 'no services->retail_general rewrite left in getSettings');
    assert.ok(settingsSource.includes("subVertical === 'manufacturing'"), 'manufacturing settings branch matches the profile subVertical (the pillar check was dead)');
    const verticalSource = readFileSync(resolve(__dirname, '../../../frontend/src/shared/verticals/vertical-scope/resolve-current-vertical.ts'), 'utf8');
    assert.ok(verticalSource.includes("tenant?.features?.includes('pos')"), 'sidebar vertical promotes services only on a real pos feature');
    assert.ok(!verticalSource.includes("tenant?.plan_id === 'plan_ultimate'"), 'no plan_ultimate promotion left in the sidebar vertical');
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('- INV-POS-RETAIL-FEATURE-GATE ').length - 1, 1, 'invariant entry exists exactly once');
  }
  console.log('  7. source + invariant pins passed');

  console.log('pos-retail-feature-gate: OK');
}

main().catch((err) => { console.error(err); process.exit(1); });
