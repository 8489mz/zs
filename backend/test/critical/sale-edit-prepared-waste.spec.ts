/*
New file: backend/test/critical/sale-edit-prepared-waste.spec.ts

WHAT THIS PINS (INV-SALE-EDIT-PREPARED-WASTE): a served
dine-in/takeaway/delivery sale is prepared waste, and editing it
must treat its consumed allocations exactly as cancelSale does:
the shared detection predicate (KDS stage, with the 14h age
heuristic), no resurrection of consumed stock, and no full-COGS
re-post for the consumed portion. Before this package, updateSale
had zero references to the waste detection: its restore loop
returned EVERY allocation to stock, including consumed
modifier/ingredient allocations, and postSaleEdit re-posted full
COGS — editing a served order resurrected cooked food as sellable
stock. Retail sales have no prepared waste and are unchanged.

THE GAP, WORKED ONCE: stock 100 meals (cost 10) + 100 cheese
(cost 4, one unit consumed per meal as a modifier). Sell 2 meals
with the cheese modifier: stock 98/98, COGS 28. The kitchen marks
the ticket served. Edit the sale down to 1 meal. Before the fix
the edit restored 1 meal + 1 cheese and re-deducted 1 + 1, ending
at 99/99 with COGS re-posted for 1 meal — one cooked meal and its
cheese came back as sellable stock and the waste cost left the
books. After the fix the edit restores only the new consumption
(1 + 1), ends at 98/98, and the journals net to COGS 28: the
reversal excludes the consumed meal's residual (14) and the
re-post covers the kept meal (14).

THE FIX: updateSale calls the same detectPreparedWasteSale helper
cancelSale calls (the predicate itself is unchanged), caps
restoration per product at the edited lines' new consumption
(parent quantities plus modifier component quantities, mirroring
the creation deduction formulas), skips the allocation-completeness
throw for waste sales (the remainder is waste, not a gap), and
passes the old lines plus the restored sold quantity per line to
postSaleEdit, which excludes the residual difference (old residual
minus restored residual, both read against the same post-movement
remaining stock) from the 1140/5100 reversal lines. The re-post is
unchanged, so net COGS retains the waste cost and GL inventory
equals physical stock. Kept lines restore fully and exclude zero;
removed lines restore nothing and exclude their full old residual.

HOW THIS IS DRIVEN: the real createSale + real updateSale + real
cancelSale on PGlite, with the real authorization, finance, query,
posting, idempotency and audit services and a plan-feature stub
with the restaurant feature ON (so modifier components are
deducted). The KDS runtime state is seeded in settings exactly as
the predicate reads it. No harness exists that runs a full
successful createSale on a live Postgres here, so live-Postgres
acceptance remains deferred by written decision; the PGlite drive
is the real service path on Postgres semantics. The live KDS
ticket flow (a real kitchen marking a ticket served) is not
driven; only the stored runtime state the predicate reads.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
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
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';
const MANAGER_PIN = '1234';

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['sales', 'canEditPrice'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

const cashierAuth: AuthContext = {
  userId: 2, sessionId: 'spec-cashier', username: 'cashier', role: 'cashier',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
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
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, opened_by bigint, status text, branch_id bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
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
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
}

async function seedRestaurant(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  const catalog: Array<{ id: number; name: string; cost: number; retail: number; qty: number }> = [
    { id: 101, name: 'Meal 101', cost: 10, retail: 100, qty: 100 },
    { id: 102, name: 'Cheese 102', cost: 4, retail: 4, qty: 100 },
    { id: 103, name: 'Drink 103', cost: 5, retail: 50, qty: 50 },
  ];
  for (const product of catalog) {
    await anyDb.insertInto('products').values({
      id: product.id, tenant_id: TENANT, account_id: ACCOUNT, name: product.name,
      stock_qty: product.qty, cost_price: product.cost, retail_price: product.retail,
      wholesale_price: product.retail, min_selling_price: 1,
      is_active: true, item_type: 'product',
    }).execute();
    await anyDb.insertInto('product_location_stock').values({
      tenant_id: TENANT, account_id: ACCOUNT, product_id: product.id, branch_id: 1, location_id: 10, qty: product.qty,
    }).execute();
  }
  // One cheese unit is consumed per meal, as a restaurant modifier.
  await anyDb.insertInto('pos_modifier_options').values({
    id: 1, tenant_id: TENANT, component_product_id: 102, consumption_qty: 1,
  }).execute();
}

async function seedKdsStage(db: Kysely<Database>, saleId: number, stage: string): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({
    tenant_id: TENANT, key: 'kds_tickets_runtime_state',
    value: JSON.stringify({ tickets: { [String(saleId)]: { status: stage } } }),
  }).execute();
}

function buildService(db: Kysely<Database>): SalesWriteService {
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
  const planFeatures = { hasFeature: (_planId: unknown, _extra: unknown, feature: string) => feature === 'restaurant' };
  const returnsStub = {};
  return new SalesWriteService(
    db, tx, audit, authz, finance, query, posting, idempotency,
    planFeatures as never, returnsStub as never,
  );
}


async function createAndGetId(service: SalesWriteService, payload: any, auth: AuthContext): Promise<number> {
  // P3 composition (test-only): createSale now requires an open
  // shift for every cash receipt regardless of role, so the
  // fixture opens one for the creator before creating. The waste
  // behaviour under test does not depend on shift linkage.
  const db: any = (service as any).db ?? (service as any).kysely ?? null;
  if (db && typeof db.insertInto === 'function') {
    await db.insertInto('cashier_shifts').values({ tenant_id: TENANT, account_id: '1', opened_by: auth.userId, status: 'open', branch_id: 1 }).execute();
  }
  const created: any = await service.createSale(payload, auth);
  const id = Number(created?.sale?.id ?? created?.saleId ?? created?.id);
  assert.ok(Number.isInteger(id) && id > 0, `createSale must return a sale id, got ${JSON.stringify(created)?.slice(0, 120)}`);
  return id;
}

function mealItem(qty: number): any {
  return { productId: 101, qty, price: 100, priceType: 'retail', unitMultiplier: 1, modifiers: [{ optionId: 1, qty: 1 }] };
}

function drinkItem(qty: number): any {
  return { productId: 103, qty, price: 50, priceType: 'retail', unitMultiplier: 1 };
}

function salePayload(items: any[], extra: Record<string, unknown> = {}): any {
  const total = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  return {
    items, discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: total }],
    tenderedAmount: total, branchId: 1, locationId: 10, source: 'dashboard',
    orderType: 'dine_in',
    ...extra,
  };
}

function editPayload(items: any[], extra: Record<string, unknown> = {}): any {
  return {
    ...salePayload(items),
    editReason: 'تصحيح الكمية بعد مراجعة العميل',
    ...extra,
  };
}

async function readSale(db: Kysely<Database>, saleId: number): Promise<any> {
  return (db as any).selectFrom('sales').selectAll()
    .where('id', '=', saleId).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow();
}

async function locationQtyFor(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await (db as any).selectFrom('product_location_stock').select('qty')
    .where('tenant_id', '=', TENANT).where('product_id', '=', productId).where('location_id', '=', 10)
    .executeTakeFirstOrThrow() as any;
  return Number(row.qty);
}

async function journalNets(db: Kysely<Database>, saleId: number): Promise<{ cogsNet: number; inventoryNet: number }> {
  const entries = await (db as any).selectFrom('journal_entries').select('id')
    .where('source_id', '=', saleId).where('tenant_id', '=', TENANT)
    .where('source_type', 'in', ['sale', 'sale_edit', 'sale_reversal'])
    .where('status', '=', 'posted').execute();
  const ids = entries.map((entry: any) => Number(entry.id));
  if (ids.length === 0) return { cogsNet: 0, inventoryNet: 0 };
  const lines = await (db as any).selectFrom('journal_entry_lines')
    .select(['account_id', 'debit', 'credit'])
    .where('journal_entry_id', 'in', ids).where('tenant_id', '=', TENANT).execute();
  let cogs = 0;
  let inventory = 0;
  for (const line of lines) {
    if (Number(line.account_id) === 5100) cogs += Number(line.debit || 0) - Number(line.credit || 0);
    if (Number(line.account_id) === 1140) inventory += Number(line.credit || 0) - Number(line.debit || 0);
  }
  return { cogsNet: Number(cogs.toFixed(2)), inventoryNet: Number(inventory.toFixed(2)) };
}

async function main(): Promise<void> {
  // 1. Served waste edit, reduced quantity: the consumed meal and its
  // cheese stay consumed (98/98), and the journals net to the full
  // old COGS (28) — the reversal excludes the removed meal's
  // residual (14) and the re-post covers the kept meal (14).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRestaurant(db);
      const service = buildService(db);
      const saleId = await createAndGetId(service, salePayload([mealItem(2)]), adminAuth);
      assert.equal(await locationQtyFor(db, 101), 98, 'creation deducts two meals');
      assert.equal(await locationQtyFor(db, 102), 98, 'creation deducts two cheese units');
      const createdNets = await journalNets(db, saleId);
      assert.deepEqual(createdNets, { cogsNet: 28, inventoryNet: 28 }, 'creation posts COGS 28');
      await seedKdsStage(db, saleId, 'served');
      await service.updateSale(saleId, editPayload([mealItem(1)]), adminAuth);
      const sale = await readSale(db, saleId);
      assert.equal(Number(sale.total), 100, 'edited total is one meal');
      assert.equal(await locationQtyFor(db, 101), 98, 'the consumed meal is not resurrected');
      assert.equal(await locationQtyFor(db, 102), 98, 'the consumed cheese is not resurrected');
      assert.deepEqual(await journalNets(db, saleId), { cogsNet: 28, inventoryNet: 28 }, 'waste COGS stays posted');
    } finally {
      await db.destroy();
    }
    console.log('  served waste edit, reduced quantity passed');
  }

  // 2. Served waste edit, kept quantity: identical lines restore
  // fully and exclude zero, so stock and journals end exactly where
  // the creation left them.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRestaurant(db);
      const service = buildService(db);
      const saleId = await createAndGetId(service, salePayload([mealItem(2)]), adminAuth);
      await seedKdsStage(db, saleId, 'ready');
      await service.updateSale(saleId, editPayload([mealItem(2)]), adminAuth);
      assert.equal(await locationQtyFor(db, 101), 98, 'kept meals net to zero stock change');
      assert.equal(await locationQtyFor(db, 102), 98, 'kept cheese nets to zero stock change');
      assert.deepEqual(await journalNets(db, saleId), { cogsNet: 28, inventoryNet: 28 }, 'kept lines re-post the same COGS');
    } finally {
      await db.destroy();
    }
    console.log('  served waste edit, kept quantity passed');
  }

  // 3. Served waste edit, removed line: the meal line is removed and
  // the drink line is kept. The meal and cheese stay consumed, the
  // drink restores and re-deducts normally, and net COGS is the old
  // meal COGS (28) plus the drink COGS (5).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRestaurant(db);
      const service = buildService(db);
      const saleId = await createAndGetId(service, salePayload([mealItem(2), drinkItem(1)]), adminAuth);
      assert.equal(await locationQtyFor(db, 103), 49, 'creation deducts the drink');
      await seedKdsStage(db, saleId, 'served');
      await service.updateSale(saleId, editPayload([drinkItem(1)]), adminAuth);
      assert.equal(await locationQtyFor(db, 101), 98, 'removed meals stay consumed');
      assert.equal(await locationQtyFor(db, 102), 98, 'removed cheese stays consumed');
      assert.equal(await locationQtyFor(db, 103), 49, 'kept drink restores and re-deducts');
      assert.deepEqual(await journalNets(db, saleId), { cogsNet: 33, inventoryNet: 33 }, 'waste meal COGS plus drink COGS');
    } finally {
      await db.destroy();
    }
    console.log('  served waste edit, removed line passed');
  }

  // 4. Pending KDS stage: the predicate is false, so the edit
  // restores fully exactly as before — stock 99/99, COGS for the
  // kept meal only (14).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRestaurant(db);
      const service = buildService(db);
      const saleId = await createAndGetId(service, salePayload([mealItem(2)]), adminAuth);
      await seedKdsStage(db, saleId, 'pending');
      await service.updateSale(saleId, editPayload([mealItem(1)]), adminAuth);
      assert.equal(await locationQtyFor(db, 101), 99, 'pending ticket restores fully');
      assert.equal(await locationQtyFor(db, 102), 99, 'pending ticket cheese restores fully');
      assert.deepEqual(await journalNets(db, saleId), { cogsNet: 14, inventoryNet: 14 }, 'pending ticket re-posts kept COGS only');
    } finally {
      await db.destroy();
    }
    console.log('  pending KDS stage restores fully passed');
  }

  // 5. The 14h age heuristic: a non-pending stage on a 15h-old sale
  // is prepared waste even though the stage is not cooking/ready/
  // served, so the consumed quantities stay consumed.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRestaurant(db);
      const service = buildService(db);
      const saleId = await createAndGetId(service, salePayload([mealItem(2)]), adminAuth);
      await seedKdsStage(db, saleId, 'confirmed');
      await (db as any).updateTable('sales')
        .set({ created_at: new Date(Date.now() - 15 * 60 * 60 * 1000) })
        .where('id', '=', saleId).execute();
      await service.updateSale(saleId, editPayload([mealItem(1)]), adminAuth);
      assert.equal(await locationQtyFor(db, 101), 98, 'old sale stays consumed');
      assert.equal(await locationQtyFor(db, 102), 98, 'old sale cheese stays consumed');
      assert.deepEqual(await journalNets(db, saleId), { cogsNet: 28, inventoryNet: 28 }, 'old sale waste COGS stays posted');
    } finally {
      await db.destroy();
    }
    console.log('  14h age heuristic passed');
  }

  // 6. Retail control: a sale with no consumed-ingredient allocation
  // and no recipe meal is not prepared waste, whether it is a
  // dine-in drink sale or a default retail sale — both edits restore
  // fully and re-post the kept COGS only.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRestaurant(db);
      const service = buildService(db);
      const dineInId = await createAndGetId(service, salePayload([drinkItem(2)]), adminAuth);
      await seedKdsStage(db, dineInId, 'served');
      await service.updateSale(dineInId, editPayload([drinkItem(1)]), adminAuth);
      assert.equal(await locationQtyFor(db, 103), 49, 'dine-in drink without modifiers restores fully');
      assert.deepEqual(await journalNets(db, dineInId), { cogsNet: 5, inventoryNet: 5 }, 'dine-in drink re-posts kept COGS only');
      const retailPayload = salePayload([drinkItem(2)], { orderType: null });
      const retailId = await createAndGetId(service, retailPayload, adminAuth);
      await service.updateSale(retailId, editPayload([drinkItem(1)], { orderType: null }), adminAuth);
      assert.equal(await locationQtyFor(db, 103), 48, 'retail drink restores fully');
      assert.deepEqual(await journalNets(db, retailId), { cogsNet: 5, inventoryNet: 5 }, 'retail drink re-posts kept COGS only');
    } finally {
      await db.destroy();
    }
    console.log('  retail control passed');
  }

  // 7. cancelSale's waste behaviour still holds through the real
  // cancel path: served sale, no restore, full 1140/5100 exclusion,
  // COGS 28 stays posted.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRestaurant(db);
      const service = buildService(db);
      const saleId = await createAndGetId(service, salePayload([mealItem(2)]), adminAuth);
      await seedKdsStage(db, saleId, 'served');
      await service.cancelSale(saleId, 'إلغاء بعد التقديم', MANAGER_PIN, adminAuth);
      const sale = await readSale(db, saleId);
      assert.equal(sale.status, 'cancelled', 'sale is cancelled');
      assert.equal(await locationQtyFor(db, 101), 98, 'cancel does not resurrect meals');
      assert.equal(await locationQtyFor(db, 102), 98, 'cancel does not resurrect cheese');
      assert.deepEqual(await journalNets(db, saleId), { cogsNet: 28, inventoryNet: 28 }, 'cancel keeps waste COGS posted');
    } finally {
      await db.destroy();
    }
    console.log('  cancelSale waste behaviour passed');
  }

  // 8. Source + invariant pins: one shared detection helper called
  // by both cancelSale and updateSale; the partial-exclusion
  // plumbing in the posting service; the invariant exactly once as
  // the last line, with the two previous sale-edit invariants still
  // exactly once each.
  {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const here = __dirname;
    const serviceSource = readFileSync(resolve(here, '../../src/modules/sales/services/sales-write.service.ts'), 'utf8');
    assert.equal(serviceSource.split('detectPreparedWasteSale').length - 1, 3, 'one helper definition plus two call sites');
    assert.ok(serviceSource.includes('preparedWasteCogsExclusion') === false, 'the write service never names the journal exclusion');
    const postingSource = readFileSync(resolve(here, '../../src/modules/accounting/accounting-posting.service.ts'), 'utf8');
    assert.ok(postingSource.includes('preparedWasteCogsExclusion'), 'posting service carries the partial exclusion');
    assert.ok(postingSource.includes('reverseSaleJournalById'), 'remediation reversal is untouched');
    const invariants = readFileSync(resolve(here, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-SALE-EDIT-PREPARED-WASTE').length - 1, 1, 'the invariant entry must exist exactly once');
    assert.equal(invariants.split('INV-SALES-RETURN-COGS-RESIDUAL-MIRROR').length - 1, 1, 'the P2 mirror invariant must still exist exactly once');
    assert.equal(invariants.split('INV-SALE-EDIT-COST-FLOOR').length - 1, 1, 'the P1 floor invariant must still exist exactly once');
    const lastLine = invariants.trimEnd().split('\n').pop() || '';
    assert.ok(lastLine.includes('INV-SALE-EDIT-PREPARED-WASTE'), 'the invariant entry must be the last line');
    console.log('  source + invariant pins passed');
  }

  console.log('Sale edit prepared waste tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
