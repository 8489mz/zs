/*
 * F9 — POS stock pool for wholesale_van tenants (trial problems 12 +
 * 14, 2026-11-21, test10k): POS capped "صنف اختبار جمله ا" at 4
 * pieces per sale — a full carton (12 pcs = 144.00) could not be
 * sold, only 4 pcs = 48.00 (Z-261121-16626) — and after the sale the
 * item showed "نفد" although the warehouse held 19; the item list
 * showed stock 42 while POS showed "نفد" because POS (branch
 * warehouse) had 0 and the stock sat in other warehouses.
 *
 * ROOT CAUSE (proven by the numbers, not a guess): there is NO
 * hardcoded 4 anywhere in the POS path. The frontend cap is
 * getResolvedStockLimit = floor(product.stock / unit.multiplier),
 * and product.stock is the BACKEND's branch-scoped net figure: the
 * branch row said sales_stock_mode = 'single_location' (the
 * provisioning default), so listPosProducts pooled ONLY the branch
 * default location, which held 4 net pieces. floor(4 / 1) = 4
 * pieces — that is the "4-piece cap". A carton-unit artefact is
 * refuted by the trial arithmetic: floor(42 / 12) = 3 cartons, not
 * 4, and 4 cartons would be 48 pcs = 576.00, not the recorded
 * 4 pcs = 48.00. The FE cap faithfully enforces the scoped stock it
 * was sent; the fix is the BACKEND pool, not the FE cap.
 *
 * THE FIX (one canonical rule, posSellsFromAllOperationalLocations
 * in branch-sellable-locations.engine.ts, consulted at all three
 * POS pool sites — catalog display, create-sale checkout, sale-edit
 * checkout): a wholesale_van tenant's POS pool is
 * all_operational_locations even when the branch row still says
 * single_location, because a van tenant has no single shop counter
 * — its stock lives in the main warehouse and the other branch /
 * internal warehouses. Retail tenants keep exactly the branch
 * setting. Van stock itself (location_type 'van_stock') stays OUT
 * of the pool by design: it is the rep's loaded custody, sold only
 * via field sales and reconciled at trip settlement — the
 * eligibility filter already excludes it everywhere (the warehouse
 * catalog and the requisitions both exclude van_stock), and this
 * fix does not change that filter. "نفد" now fires only when the
 * widened pool is truly 0.
 *
 * THE CASES, WORKED ONCE (branch 1, single_location, default
 * location 10 = branch warehouse qty 4; location 20 = main
 * warehouse, internal_warehouse, qty 42; location 30 = rep van,
 * van_stock, qty 100; location 21 = other branch's warehouse,
 * qty 50; global stock_qty 196; price 12.00/pc):
 * (a) The helper itself: single_location + wholesale_van -> true;
 *     single_location + retail -> false; single_location + no
 *     activity -> false; all_operational + retail -> true.
 * (b) Van display, single_location branch: 46 (4 + 42). The van's
 *     100 and the other branch's 50 never enter the sum. Pre-fix
 *     this read 4 — the trial's cap.
 * (c) Retail display, same branch: 4 — unchanged behaviour.
 * (c2) Retail display, all_operational branch: 46 — the existing
 *     mode path still works.
 * (d) Van display, truly-0 pool (product 102, no stock anywhere):
 *     0 — "نفد" only when the pool is truly 0.
 * (e1) Van checkout boundary on the real createSale: a full carton
 *     (12 pcs @ 12.00 = 144.00) posts; the deduction spills across
 *     locations in priority order (branch 4 -> 0, main 42 -> 34)
 *     and never touches the van (100) or the other branch (50).
 * (e2) Van checkout: 47 pcs on a 46 pool is refused with
 *     INSUFFICIENT_STOCK.
 * (f) Retail checkout: 5 pcs is refused (pool 4), then 4 pcs post
 *     (48.00) and only the branch location moves.
 * (g) Wiring: this spec is in both critical lists (308 specs,
 *     identical order).
 *
 * HOW THIS IS DRIVEN: the real CatalogProductService (real
 * InventoryScopeService, real Kysely/PGlite) for the display
 * figures, the real SalesWriteService for the checkout boundary,
 * and the real posSellsFromAllOperationalLocations helper for the
 * rule table. DDL is the F7 POS-sale harness (proven to post a POS
 * sale on this HEAD) plus the catalog columns the display path
 * selects (products.sku/item_kind/color/size/min_stock_qty/
 * category_id/metadata + product_units + account_id on branches,
 * manufacturing_boms/lines, product_offers). PGlite teardown is
 * db.destroy() only.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';
import { InventoryScopeService } from '../../src/modules/inventory/services/inventory-scope.service';
import { posSellsFromAllOperationalLocations } from '../../src/common/engines/branch-sellable-locations.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

const vanCashierAuth: AuthContext = {
  userId: 2, sessionId: 'spec-cashier-van', username: 'cashier', role: 'cashier',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
  activityType: 'wholesale_van',
} as unknown as AuthContext;

const retailCashierAuth: AuthContext = {
  userId: 2, sessionId: 'spec-cashier-retail', username: 'cashier', role: 'cashier',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
  activityType: 'retail_general',
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  SalesWriteService.invalidateSettingsCache(TENANT);
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE cost_centers (id bigint PRIMARY KEY, tenant_id text, code text, name text);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, sku text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, half_wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, min_stock_qty numeric DEFAULT 0, category_id bigint, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, item_kind text, color text, size text, metadata text, updated_at timestamptz);
    CREATE TABLE product_units (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text, multiplier numeric DEFAULT 1, barcode text, is_base_unit boolean DEFAULT false, is_sale_unit_default boolean DEFAULT false, is_purchase_unit_default boolean DEFAULT false);
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT false, reason text, auto_restore_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE price_lists (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text DEFAULT 'EGP', type text DEFAULT 'percentage', default_discount_percent numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE inventory_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number text, expiry_date text, quantity numeric DEFAULT 0, unit_cost numeric DEFAULT 0, location_id integer, supplier_name text, status text DEFAULT 'active', notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_inventory_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric DEFAULT 0, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text, created_by bigint);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, system_cash_discount_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, received_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, account_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, account_id text, bom_id bigint, component_product_id bigint, quantity numeric DEFAULT 1);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, rep_type text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, is_active boolean DEFAULT true, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text);
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>, mode: string): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, username: 'cashier', role: 'cashier', is_active: true }).execute();
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
  // Branch 1 sells from location 10 and says single_location — the
  // provisioning default the trial tenant carries. Branch 2 owns
  // location 21; its 50 pieces must never enter branch 1's pool.
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Main', default_stock_location_id: 10, sales_stock_mode: mode }).execute();
  await anyDb.insertInto('branches').values({ id: 2, tenant_id: TENANT, account_id: ACCOUNT, name: 'Other', default_stock_location_id: 21, sales_stock_mode: null }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Branch warehouse', location_type: 'branch_stock', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 20, tenant_id: TENANT, account_id: ACCOUNT, branch_id: null, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  // Location 30: the rep's van (van_stock, qty 100) — seeded on
  // BRANCH 1 on purpose, the real creation shape (van-common ensures
  // a rep's van_stock location on the tenant's default branch). It
  // must NEVER enter the POS pool: van stock is loaded custody, sold
  // only via field sales and reconciled at trip settlement.
  await anyDb.insertInto('stock_locations').values({ id: 30, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Van 1', location_type: 'van_stock', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 21, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 2, name: 'Other warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  // Trial item: 12.00/pc, one carton = 12 pcs = 144.00. Global
  // stock_qty 196 = 4 + 42 + 100 + 50, so the global figure alone
  // proves nothing — only the scoped pool matters.
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: ACCOUNT, name: 'صنف اختبار جمله ا',
    barcode: '200001', stock_qty: 196, reserved_qty: 0, cost_price: 10, retail_price: 12,
    wholesale_price: 12, half_wholesale_price: 12, credit_price: 12, min_selling_price: 0,
    is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('products').values({
    id: 102, tenant_id: TENANT, account_id: ACCOUNT, name: 'صنف بلا رصيد',
    barcode: '200002', stock_qty: 0, reserved_qty: 0, cost_price: 10, retail_price: 12,
    wholesale_price: 12, min_selling_price: 0,
    is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('product_units').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, name: 'قطعة',
    multiplier: 1, barcode: '200001', is_base_unit: true, is_sale_unit_default: true, is_purchase_unit_default: true,
  }).execute();
  await anyDb.insertInto('product_units').values({
    id: 2, tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, name: 'كرتونة',
    multiplier: 12, barcode: '200012', is_base_unit: false, is_sale_unit_default: false, is_purchase_unit_default: false,
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 1, location_id: 10, qty: 4, reserved_qty: 0,
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: null, location_id: 20, qty: 42, reserved_qty: 0,
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: null, location_id: 30, qty: 100, reserved_qty: 0,
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 2, location_id: 21, qty: 50, reserved_qty: 0,
  }).execute();
}

async function seedShift(db: Kysely<Database>): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'SHIFT-1',
    opened_by: 2, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0,
  }).execute();
}

function buildCatalogService(db: Kysely<Database>): CatalogProductService {
  return new CatalogProductService(db, new AuditService(db), new InventoryScopeService(db));
}

function buildSalesService(db: Kysely<Database>): SalesWriteService {
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
  // The POS feature gate must pass (the F7 stub shape): only 'pos'
  // is granted; every other feature stays refused.
  const planFeatures = { hasFeature: (_planId: any, _extra: any, feature: string) => feature === 'pos' };
  const returnsStub = {};
  return new SalesWriteService(
    db, tx, audit, authz, finance, query, posting, idempotency,
    planFeatures as never, returnsStub as never,
  );
}

async function displayedStock(service: CatalogProductService, auth: AuthContext, productId: number): Promise<number> {
  const result: any = await service.listPosProducts({ branchId: 1 }, auth);
  const row = (result.products as any[]).find((p: any) => Number(p.id) === productId);
  assert.ok(row, `expected product ${productId} in the POS list, got ${JSON.stringify(result.products)?.slice(0, 200)}`);
  return Number(row.stock);
}

async function locationQty(db: Kysely<Database>, productId: number, locationId: number): Promise<number> {
  const row = await (db as any).selectFrom('product_location_stock').select(['qty'])
    .where('tenant_id', '=', TENANT).where('product_id', '=', productId).where('location_id', '=', locationId)
    .executeTakeFirstOrThrow() as any;
  return Number(row.qty);
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error: any) {
    assert.equal(error?.code, code, `expected AppError ${code}, got ${error?.code}: ${error?.message}`);
    return;
  }
  assert.fail(`expected AppError ${code} but the call succeeded`);
}

function posPayload(qty: number): any {
  const price = 12;
  return {
    items: [{ productId: 101, qty, price, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: price * qty }],
    tenderedAmount: price * qty, branchId: 1, locationId: 10, source: 'pos',
  };
}

async function createAndGetId(service: SalesWriteService, payload: any, auth: AuthContext): Promise<number> {
  const created: any = await service.createSale(payload, auth);
  const id = Number((created?.sale?.id ?? created?.saleId) ?? created?.id);
  assert.ok(Number.isInteger(id) && id > 0, `createSale must return a sale id, got ${JSON.stringify(created)?.slice(0, 120)}`);
  return id;
}

async function readSaleTotal(db: Kysely<Database>, saleId: number): Promise<number> {
  const row = await (db as any).selectFrom('sales').select(['total'])
    .where('id', '=', saleId).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow() as any;
  return Number(row.total);
}

async function main(): Promise<void> {
  // (a) The helper itself: the tenant activity widens the pool,
  // the branch setting alone does not.
  {
    assert.equal(posSellsFromAllOperationalLocations({ sales_stock_mode: 'single_location' }, 'wholesale_van'), true);
    assert.equal(posSellsFromAllOperationalLocations({ sales_stock_mode: 'single_location' }, 'retail_general'), false);
    assert.equal(posSellsFromAllOperationalLocations({ sales_stock_mode: 'single_location' }, undefined), false);
    assert.equal(posSellsFromAllOperationalLocations({ sales_stock_mode: 'single_location' }, null), false);
    assert.equal(posSellsFromAllOperationalLocations({ sales_stock_mode: 'all_operational_locations' }, 'retail_general'), true);
    assert.equal(posSellsFromAllOperationalLocations(null, 'wholesale_van'), true);
    console.log('  (a) helper table passed');
  }

  // (b) Van display, single_location branch: 4 + 42 = 46. The
  // van's 100 and the other branch's 50 never enter the sum.
  // Pre-fix this read 4 — the trial's "4-piece cap".
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'single_location');
      const catalog = buildCatalogService(db);
      assert.equal(await displayedStock(catalog, vanCashierAuth, 101), 46);
      console.log('  (b) van display 46 passed');
    } finally {
      await db.destroy();
    }
  }

  // (c) Retail display, same branch: 4 — unchanged behaviour.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'single_location');
      const catalog = buildCatalogService(db);
      assert.equal(await displayedStock(catalog, retailCashierAuth, 101), 4);
      console.log('  (c) retail display 4 passed');
    } finally {
      await db.destroy();
    }
  }

  // (c2) Retail display, all_operational branch: 46 — the existing
  // mode path still works exactly as before.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'all_operational_locations');
      const catalog = buildCatalogService(db);
      assert.equal(await displayedStock(catalog, retailCashierAuth, 101), 46);
      console.log('  (c2) retail all-operational display 46 passed');
    } finally {
      await db.destroy();
    }
  }

  // (d) Van display, truly-0 pool: 0 — "نفد" only when the pool is
  // truly 0.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'single_location');
      const catalog = buildCatalogService(db);
      assert.equal(await displayedStock(catalog, vanCashierAuth, 102), 0);
      console.log('  (d) van truly-0 display 0 passed');
    } finally {
      await db.destroy();
    }
  }

  // (e1) Van checkout: the full carton the trial could not sell
  // (12 pcs @ 12.00 = 144.00) posts. The deduction spills across
  // locations in priority order — branch 4 -> 0, main 42 -> 34 —
  // and never touches the van (100) or the other branch (50).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'single_location');
      await seedShift(db);
      const catalog = buildCatalogService(db);
      const sales = buildSalesService(db);
      assert.equal(await displayedStock(catalog, vanCashierAuth, 101), 46);
      const saleId = await createAndGetId(sales, posPayload(12), vanCashierAuth);
      assert.equal(await readSaleTotal(db, saleId), 144);
      assert.equal(await locationQty(db, 101, 10), 0);
      assert.equal(await locationQty(db, 101, 20), 34);
      assert.equal(await locationQty(db, 101, 30), 100);
      assert.equal(await locationQty(db, 101, 21), 50);
      console.log('  (e1) van checkout 12 pcs posts, spills 4 + 8 passed');
    } finally {
      await db.destroy();
    }
  }

  // (e2) Van checkout: 47 pcs on a 46 pool is refused.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'single_location');
      await seedShift(db);
      const sales = buildSalesService(db);
      await expectAppError(sales.createSale(posPayload(47) as any, vanCashierAuth), 'INSUFFICIENT_STOCK');
      assert.equal(await locationQty(db, 101, 10), 4);
      assert.equal(await locationQty(db, 101, 20), 42);
      console.log('  (e2) van checkout 47 refused passed');
    } finally {
      await db.destroy();
    }
  }

  // (f) Retail checkout: 5 pcs is refused (pool 4), then 4 pcs
  // post (48.00) and only the branch location moves.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'single_location');
      await seedShift(db);
      const sales = buildSalesService(db);
      await expectAppError(sales.createSale(posPayload(5) as any, retailCashierAuth), 'INSUFFICIENT_STOCK');
      const saleId = await createAndGetId(sales, posPayload(4), retailCashierAuth);
      assert.equal(await readSaleTotal(db, saleId), 48);
      assert.equal(await locationQty(db, 101, 10), 0);
      assert.equal(await locationQty(db, 101, 20), 42);
      console.log('  (f) retail checkout 5 refused, 4 posts passed');
    } finally {
      await db.destroy();
    }
  }

  // (g) Wiring: this spec is in both critical lists (308 specs,
  // identical order) — the suite count moves 300 -> 303 with this batch (F4 + F9 + F10).
  {
    const specs = JSON.parse(readFileSync(join(__dirname, '../../scripts/critical-specs.json'), 'utf8')).specs as string[];
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 308);
    assert.equal(chain.length, 308);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/pos-van-stock-pool.spec.ts'));
    assert.equal(
      specs[specs.indexOf('test/critical/pos-van-stock-pool.spec.ts') - 1],
      'test/critical/customer-phone-validation.spec.ts',
    );
    console.log('  (g) wiring (308 specs, identical order) passed');
  }

  console.log('pos-van-stock-pool: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
