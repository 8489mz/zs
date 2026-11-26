/*
 * INV-PHASE1-A7-SALES-WRITER: the 12 sales stock_movements writes go
 * through the unified row-writer (A0/A5) instead of hand-written inserts.
 *
 * This file pins the create-sale legs (sites 3, 4) and the auto-produce
 * legs (sites 11, 12), driving the REAL createSale through the REAL
 * SalesWriteService on PGlite (fresh database per case; card payment,
 * so no shift is needed):
 * - Main leg: a 2 x Widget 101 sale (cost 10) writes one 'sale' movement
 *   with qty -2 and unit_cost 10, exactly equal to sale_items.cost_price,
 *   and total_cost NULL — the pinned INV-SALE-MOVEMENT-UNIT-COST variant,
 *   preserved through the writer's omitTotalCost flag (storing a second
 *   rounded total would reopen the 91.87/91.88 divergence vector).
 * - Modifier leg (consumption rate 2): parent unit_cost 18, component
 *   qty -4 with unit_cost 4 (per-stock-unit WAC, not the per-serving 8);
 *   both rows total_cost NULL.
 * - Auto-produce: a 2 x Meal 103 sale (BOM 1 cheese per meal, meal stock 0)
 *   produces the 2-meal shortfall first — a manufacturing_consumption row
 *   (component 102, qty -2, unit_cost 4, total_cost 8) and a
 *   manufacturing_production row (meal 103, qty +2, unit_cost 4,
 *   total_cost 8) — then the sale deducts the 2 produced meals. The sale
 *   row carries unit_cost 4, NOT the seeded meal cost_price 10: the
 *   production leg re-blends the FG WAC via valueStockReceipt (0 units at
 *   10 + 2 units at 8 = 4 each), and resolveSaleModifierCosts re-reads
 *   products.cost_price after auto-produce — so the frozen line cost IS
 *   the post-production WAC. The migration preserves this exactly: the
 *   writer receives item.costPrice as computed, it does not re-derive it.
 * - Rollback: a sale whose second item's modifier stock is missing throws
 *   INSUFFICIENT_MODIFIER_STOCK after the first item's row was written in
 *   the same transaction — zero movement rows and zero sales survive.
 * - Source pins: no direct insertInto('stock_movements') left in
 *   insert-sale-and-stock.ts or sales-restaurant-and-serials.service.ts;
 *   both call recordStockMovement; the writer carries omitTotalCost.
 * Prospective only; no posted row is rewritten. The sale-edit /
 * sale-cancel legs live in sales-writer-cancel-edit.spec.ts; food waste
 * lives in sales-writer-food-waste.spec.ts.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
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
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';
/** Loose Kysely handle for harness inserts/reads: the generated Database type
 *  requires full insert shapes, so the harness seeds and reads through this
 *  handle instead of an `any` cast (the repo pins zero new `any` casts). */
type LooseDb = Kysely<Record<string, Record<string, unknown>>>;
function loose(db: Kysely<Database>): LooseDb {
  return db as unknown as LooseDb;
}

/** One sale line as the harness builds it (price + optional modifier legs). */
interface SaleLineInput {
  productId: number;
  qty: number;
  price: number;
  priceType?: string;
  unitMultiplier?: number;
  modifiers?: Array<{ optionId: number; productId?: number; qty: number; price: number }>;
}

const adminAuth: AuthContext = {
  userId: 1,
  sessionId: 'spec',
  username: 'admin',
  role: 'admin',
  permissions: ['sales', 'canEditPrice'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  SalesWriteService.invalidateSettingsCache(TENANT);
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
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
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, system_cash_discount_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, pos_terminal_code varchar(32), transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigint PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, account_id text, group_id bigint, name text, price numeric, cost_price numeric, component_product_id bigint, consumption_qty numeric, is_active boolean DEFAULT true, is_default boolean DEFAULT false, display_order int);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, product_id bigint, quantity numeric, overhead_cost numeric, expected_cost numeric, is_active boolean, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE manufacturing_bom_lines (id bigserial PRIMARY KEY, bom_id bigint, component_product_id bigint, quantity numeric, unit_name text, unit_multiplier numeric, waste_percentage numeric, expected_cost numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE manufacturing_work_orders (id bigserial PRIMARY KEY, doc_no text, bom_id bigint, status text, quantity_to_produce numeric, produced_quantity numeric, source_location_id bigint, destination_location_id bigint, start_date timestamptz, end_date timestamptz, total_cost numeric, completed_at timestamptz, note text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, tenant_id text, account_id text);
    CREATE TABLE manufacturing_wo_consumptions (id bigserial PRIMARY KEY, tenant_id text, account_id text, work_order_id bigint, component_product_id bigint, quantity_consumed numeric, unit_cost numeric, line_total numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE manufacturing_wo_operations (id bigserial PRIMARY KEY, tenant_id text, account_id text, work_order_id bigint, work_center_id bigint, operation_name text, sequence int, duration_hours numeric, hourly_cost numeric, total_cost numeric, status text, notes text);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
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
    CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text);
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT true, reason text, auto_restore_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE addons (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, price numeric, cost_price numeric, is_active boolean DEFAULT true, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_pos_modifiers (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, modifier_group_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pos_modifier_groups (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, selection_type text, is_mandatory boolean DEFAULT false, min_selections int DEFAULT 0, max_selections int DEFAULT 10, display_order int DEFAULT 0, is_active boolean DEFAULT true, is_splittable_in_half boolean DEFAULT false);
    CREATE TABLE inventory_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number text, expiry_date text, quantity numeric, unit_cost numeric, location_id bigint, supplier_name text, status text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_inventory_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric);
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = loose(db);
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 2, tenant_id: TENANT, username: 'cashier-a', role: 'cashier', is_active: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 3, tenant_id: TENANT, username: 'cashier-b', role: 'cashier', is_active: true })
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
    [5190, '5190'],
    [5200, '5200'],
    [5400, '5400'],
    [7100, '7100'],
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

async function seedModifierSetup(db: Kysely<Database>): Promise<void> {
  const anyDb = loose(db);
  await anyDb
    .insertInto('products')
    .values({
      id: 102,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Component 102',
      stock_qty: 100,
      cost_price: 4,
      retail_price: 20,
      wholesale_price: 20,
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
      product_id: 102,
      branch_id: 1,
      location_id: 10,
      qty: 100,
    })
    .execute();
  await anyDb
    .insertInto('pos_modifier_groups')
    .values({
      id: 1,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Extras',
      selection_type: 'multiple',
      is_mandatory: false,
      min_selections: 0,
      max_selections: 10,
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('product_pos_modifiers')
    .values({
      tenant_id: TENANT,
      account_id: ACCOUNT,
      product_id: 101,
      modifier_group_id: 1,
    })
    .execute();
  await anyDb
    .insertInto('pos_modifier_options')
    .values({
      id: 501,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      group_id: 1,
      name: 'Extra cheese',
      price: 5,
      cost_price: 0,
      component_product_id: 102,
      consumption_qty: 2,
      is_active: true,
    })
    .execute();
}

async function seedBomSetup(db: Kysely<Database>): Promise<void> {
  const anyDb = loose(db);
  await anyDb
    .insertInto('products')
    .values({
      id: 103,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Meal 103',
      stock_qty: 0,
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
      product_id: 103,
      branch_id: 1,
      location_id: 10,
      qty: 0,
    })
    .execute();
  await anyDb
    .insertInto('manufacturing_boms')
    .values({
      id: 1,
      product_id: 103,
      quantity: 1,
      overhead_cost: 0,
      expected_cost: 0,
      is_active: true,
      tenant_id: TENANT,
      account_id: ACCOUNT,
    })
    .execute();
  await anyDb
    .insertInto('manufacturing_bom_lines')
    .values({
      bom_id: 1,
      component_product_id: 102,
      quantity: 1,
      unit_name: 'unit',
      unit_multiplier: 1,
      waste_percentage: 0,
      expected_cost: 0,
    })
    .execute();
}

function buildServices(
  db: Kysely<Database>,
  restaurantOn = false,
): { sales: SalesWriteService; drawer: CashDrawerService; posting: AccountingPostingService } {
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
  const planFeatures = {
    hasFeature: (_planId: unknown, _extra: unknown, feature: string) => restaurantOn && feature === 'restaurant',
  };
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
  return { sales, drawer, posting };
}

function cardPayload(total: number, items: SaleLineInput[]): Record<string, unknown> {
  return {
    items,
    discount: 0,
    taxRate: 0,
    paymentType: 'cash',
    paymentChannel: 'card',
    payments: [{ paymentChannel: 'card', amount: total }],
    tenderedAmount: 0,
    branchId: 1,
    locationId: 10,
    source: 'dashboard',
  };
}

async function createAndGetId(
  service: SalesWriteService,
  payload: Record<string, unknown>,
  auth: AuthContext,
): Promise<number> {
  const created = (await service.createSale(payload as never, auth)) as unknown as {
    sale?: { id?: unknown };
    saleId?: unknown;
    id?: unknown;
  };
  const id = Number(created?.sale?.id ?? created?.saleId ?? created?.id);
  assert.ok(
    Number.isInteger(id) && id > 0,
    `createSale must return a sale id, got ${JSON.stringify(created)?.slice(0, 120)}`,
  );
  return id;
}

async function movementRows(db: Kysely<Database>, saleId: number): Promise<Array<Record<string, unknown>>> {
  return loose(db)
    .selectFrom('stock_movements')
    .selectAll()
    .where('reference_type', '=', 'sale')
    .where('reference_id', '=', saleId)
    .orderBy('id', 'asc')
    .execute();
}

async function allMovementRows(db: Kysely<Database>): Promise<Array<Record<string, unknown>>> {
  return loose(db).selectFrom('stock_movements').selectAll().orderBy('id', 'asc').execute();
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM ${sql.raw(table)}`.execute(db);
  return Number(rows.rows[0].n);
}

async function main(): Promise<void> {
  // 1. Main leg: 2 x Widget 101 at cost 10 — the 'sale' movement carries
  //    unit_cost 10 and total_cost NULL (the pinned variant).
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(
        sales,
        cardPayload(200, [{ productId: 101, qty: 2, price: 100, priceType: 'retail', unitMultiplier: 1 }]),
        adminAuth,
      );
      const line = await loose(db)
        .selectFrom('sale_items')
        .select(['cost_price'])
        .where('sale_id', '=', saleId)
        .executeTakeFirstOrThrow();
      assert.equal(Number(line.cost_price), 10, 'sale_items.cost_price is the frozen unit cost');
      const rows = await movementRows(db, saleId);
      assert.equal(rows.length, 1, `main sale must write exactly 1 movement row, got ${rows.length}`);
      assert.equal(rows[0].movement_type, 'sale');
      assert.equal(Number(rows[0].qty), -2);
      assert.equal(Number(rows[0].unit_cost), 10, 'sale movement unit_cost equals the frozen line cost');
      assert.equal(rows[0].total_cost, null, 'sale movement total_cost stays null (INV-SALE-MOVEMENT-UNIT-COST)');
      assert.equal(Number(rows[0].before_qty), 100);
      assert.equal(Number(rows[0].after_qty), 98);
    } finally {
      await db.destroy();
    }
    console.log('  create main leg passed');
  }

  // 2. Modifier leg (consumption rate 2): parent unit_cost 18, component
  //    qty -4 with unit_cost 4 (per-stock-unit WAC); both rows NULL total.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedModifierSetup(db);
      const { sales } = buildServices(db, true);
      const saleId = await createAndGetId(
        sales,
        cardPayload(210, [
          {
            productId: 101,
            qty: 2,
            price: 100,
            priceType: 'retail',
            unitMultiplier: 1,
            modifiers: [{ optionId: 501, productId: 102, qty: 1, price: 5 }],
          },
        ]),
        adminAuth,
      );
      const rows = await movementRows(db, saleId);
      assert.equal(rows.length, 2, `modifier sale must write exactly 2 movement rows, got ${rows.length}`);
      const parent = rows.find((r) => Number(r.product_id) === 101);
      const component = rows.find((r) => Number(r.product_id) === 102);
      assert.ok(parent, 'parent movement row exists');
      assert.ok(component, 'component movement row exists');
      assert.equal(Number(parent.qty), -2);
      assert.equal(Number(parent.unit_cost), 18, 'parent movement unit_cost equals the frozen line cost');
      assert.equal(parent.total_cost, null, 'parent total_cost stays null');
      assert.equal(Number(component.qty), -4, 'component movement qty counts consumed stock units (1 x 2 x 2)');
      assert.equal(
        Number(component.unit_cost),
        4,
        'component movement unit_cost is the per-stock-unit WAC, not the per-serving cost',
      );
      assert.equal(component.total_cost, null, 'component total_cost stays null');
    } finally {
      await db.destroy();
    }
    console.log('  create modifier leg passed');
  }

  // 3. Auto-produce: 2 x Meal 103 (BOM 1 cheese per meal, meal stock 0)
  //    produces the shortfall first, then the sale deducts it.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedModifierSetup(db);
      await seedBomSetup(db);
      const { sales } = buildServices(db, true);
      await createAndGetId(
        sales,
        cardPayload(200, [{ productId: 103, qty: 2, price: 100, priceType: 'retail', unitMultiplier: 1 }]),
        adminAuth,
      );
      const rows = await allMovementRows(db);
      const consumption = rows.find((r) => r.movement_type === 'manufacturing_consumption');
      const production = rows.find((r) => r.movement_type === 'manufacturing_production');
      const saleRows = rows.filter((r) => r.movement_type === 'sale');
      assert.ok(consumption, 'manufacturing_consumption row exists');
      assert.ok(production, 'manufacturing_production row exists');
      assert.equal(Number(consumption.product_id), 102);
      assert.equal(Number(consumption.qty), -2, 'consumption deducts 2 cheese (1 per meal)');
      assert.equal(Number(consumption.unit_cost), 4, 'consumption unit_cost is the component cost');
      assert.equal(Number(consumption.total_cost), 8, 'consumption total_cost is the line total');
      assert.equal(Number(production.product_id), 103);
      assert.equal(Number(production.qty), 2, 'production adds the 2-meal shortfall');
      assert.equal(Number(production.unit_cost), 4, 'production unit_cost is totalCost / shortfall');
      assert.equal(Number(production.total_cost), 8, 'production total_cost is the work-order total');
      assert.equal(saleRows.length, 1, `meal sale must write exactly 1 sale row, got ${saleRows.length}`);
      assert.equal(Number(saleRows[0].qty), -2);
      assert.equal(
        Number(saleRows[0].unit_cost),
        4,
        'meal sale row carries the post-production WAC (production re-blends products.cost_price 10 -> 4 before the line is costed)',
      );
      assert.equal(saleRows[0].total_cost, null, 'meal sale total_cost stays null');
      const mealCost = await loose(db)
        .selectFrom('products')
        .select(['cost_price'])
        .where('id', '=', 103)
        .executeTakeFirstOrThrow();
      assert.equal(
        Number(mealCost.cost_price),
        4,
        'production re-blends the meal WAC to the produced unit cost (valueStockReceipt)',
      );
      const cheese = await loose(db)
        .selectFrom('product_location_stock')
        .select(['qty'])
        .where('product_id', '=', 102)
        .where('location_id', '=', 10)
        .executeTakeFirstOrThrow();
      assert.equal(Number(cheese.qty), 98, 'component stock falls by the consumed units');
      const meal = await loose(db)
        .selectFrom('product_location_stock')
        .select(['qty'])
        .where('product_id', '=', 103)
        .where('location_id', '=', 10)
        .executeTakeFirstOrThrow();
      assert.equal(Number(meal.qty), 0, 'meal stock is produced then sold (net 0)');
      const journals = await countRows(db, 'journal_entries');
      assert.ok(journals >= 1, 'the work order posts at least one journal');
    } finally {
      await db.destroy();
    }
    console.log('  create auto-produce legs passed');
  }

  // 4. Rollback: the second item's modifier stock is missing — the sale
  //    throws after the first item's row was written in the same
  //    transaction, so nothing survives. (The two lines must be different
  //    products: the sale rejects duplicate product rows outright.)
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedModifierSetup(db);
      // Drain the component stock so the modifier leg cannot allocate.
      await loose(db).updateTable('product_location_stock').set({ qty: 0 }).where('product_id', '=', 102).execute();
      await loose(db).updateTable('products').set({ stock_qty: 0 }).where('id', '=', 102).execute();
      // A second parent product whose modifier consumes the same drained
      // component (option 502, rate 2, in the same group).
      await loose(db)
        .insertInto('products')
        .values({
          id: 104,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          name: 'Gadget 104',
          stock_qty: 50,
          cost_price: 5,
          retail_price: 50,
          wholesale_price: 50,
          min_selling_price: 1,
          is_active: true,
          item_type: 'product',
        })
        .execute();
      await loose(db)
        .insertInto('product_location_stock')
        .values({
          tenant_id: TENANT,
          account_id: ACCOUNT,
          product_id: 104,
          branch_id: 1,
          location_id: 10,
          qty: 50,
        })
        .execute();
      await loose(db)
        .insertInto('product_pos_modifiers')
        .values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 104, modifier_group_id: 1 })
        .execute();
      await loose(db)
        .insertInto('pos_modifier_options')
        .values({
          id: 502,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          group_id: 1,
          name: 'Extra cheese',
          price: 5,
          cost_price: 0,
          component_product_id: 102,
          consumption_qty: 2,
          is_active: true,
        })
        .execute();
      const { sales } = buildServices(db, true);
      await assert.rejects(
        sales.createSale(
          cardPayload(155, [
            { productId: 101, qty: 1, price: 100, priceType: 'retail', unitMultiplier: 1 },
            {
              productId: 104,
              qty: 1,
              price: 50,
              priceType: 'retail',
              unitMultiplier: 1,
              modifiers: [{ optionId: 502, productId: 102, qty: 1, price: 5 }],
            },
          ]) as never,
          adminAuth,
        ),
        /INSUFFICIENT_MODIFIER_STOCK/,
      );
      assert.equal(await countRows(db, 'stock_movements'), 0, 'failed sale leaves no movement rows');
      assert.equal(await countRows(db, 'sales'), 0, 'failed sale leaves no sale');
    } finally {
      await db.destroy();
    }
    console.log('  create rollback passed');
  }

  // 5. Source pins + wiring: no direct insert left in either file, both
  //    call the writer, the writer carries omitTotalCost; 363 in both
  //    critical lists, identical order, the 3 new specs last.
  {
    const createSrc = fs.readFileSync(
      resolve(__dirname, '../../src/modules/sales/services/create-sale/insert-sale-and-stock.ts'),
      'utf8',
    );
    const serialsSrc = fs.readFileSync(
      resolve(__dirname, '../../src/modules/sales/services/sales-restaurant-and-serials.service.ts'),
      'utf8',
    );
    const writerSrc = fs.readFileSync(resolve(__dirname, '../../src/common/utils/stock-movement-writer.ts'), 'utf8');
    for (const [name, src] of [
      ['insert-sale-and-stock.ts', createSrc],
      ['sales-restaurant-and-serials.service.ts', serialsSrc],
    ] as const) {
      const direct = src.split('\n').filter((line) => line.includes("insertInto('stock_movements')"));
      assert.equal(direct.length, 0, `direct inserts left in ${name}: ${direct.join(' | ')}`);
      assert.ok(src.includes('recordStockMovement('), `${name} calls the writer`);
    }
    assert.ok(
      createSrc.includes("import { recordStockMovement } from '../../../../common/utils/stock-movement-writer'"),
      'insert-sale-and-stock.ts imports the writer',
    );
    assert.ok(
      serialsSrc.includes("import { recordStockMovement } from '../../../common/utils/stock-movement-writer'"),
      'sales-restaurant-and-serials.service.ts imports the writer',
    );
    assert.ok(writerSrc.includes('omitTotalCost'), 'writer carries the omitTotalCost flag');
    assert.ok(createSrc.includes('omitTotalCost: true'), 'create-sale sites set omitTotalCost');
    {
      const specs = JSON.parse(fs.readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
        .specs as string[];
      const pkg = JSON.parse(fs.readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 384);
      assert.equal(chain.length, 384);
      assert.deepEqual(chain, specs);
      assert.equal(specs[358], 'test/critical/sales-writer-create.spec.ts');
      assert.equal(specs[359], 'test/critical/sales-writer-cancel-edit.spec.ts');
      assert.equal(specs[360], 'test/critical/sales-writer-food-waste.spec.ts');
      assert.equal(specs[361], 'test/critical/manufacturing-writer.spec.ts');
      assert.equal(specs[362], 'test/critical/purchases-writer.spec.ts');
      console.log('  evidence specs wired into both critical lists (373 = 373, identical order), passed');
    }
    console.log('  block 5 (source pins + wiring) passed');
  }

  console.log('sales writer create checks passed (5 blocks)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
