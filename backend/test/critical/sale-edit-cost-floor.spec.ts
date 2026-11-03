/*
New file: backend/test/critical/sale-edit-cost-floor.spec.ts

WHAT THIS PINS (INV-SALE-EDIT-COST-FLOOR): the selling cost floor
(max of frozen unit cost and min selling price, on the
discount-allocated net line, with the allowed-price pre-approved
override) is enforced by the shared findBelowFloorSaleItems helper
at sale creation AND on sale edit. Before this package, updateSale
re-ran only the deviation gate (allowed retail/offer price plus the
discount threshold, never cost), so an admin holding canEditPrice
could edit a line below its frozen cost with no PIN at all, and a
manager approving an edit never saw a below-cost computation or the
creation-style floor-approval note.

THE GAP, WORKED ONCE: allowed price 100, frozen cost 90,
min selling price 80. An edit to 85 passes the deviation gate (a
15% reduction, inside a 20% threshold) but sells 5 below cost on
every unit. At creation the same price needs a floor approval; on
edit it needed none.

THE FIX: updateSale runs the same shared helper after the
frozen-cost restore, so the floor is computed on the cost that will
actually be stored and posted. A below-floor edit requires a floor
approval via authorizeDiscountOverride and carries the
floor-approval note, exactly as at creation. The pre-approved
override on edit is the edit's own allowed (retail/offer) price,
because updateSale has no approved-terms channel; a system-approved
below-floor price therefore needs a floor approval on edit
(fail-closed). Services are exempt, as at creation.

HOW THIS IS DRIVEN: the real createSale + real updateSale on PGlite,
with the real authorization, finance, query, posting, idempotency
and audit services and a plan-feature stub (restaurant off). The
pure helper is additionally pinned directly, so the formula itself
is covered independently of the service path. No harness exists
that runs a full successful createSale on a live Postgres here, so
live-Postgres acceptance remains deferred by written decision; the
PGlite drive is the real service path on Postgres semantics.
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
import { findBelowFloorSaleItems } from '../../src/modules/sales/helpers/sales-write.helper';

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
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
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

async function seedProduct(db: Kysely<Database>, opts: { retail: number; wholesale?: number; cost: number; minSelling: number; qty?: number }): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: ACCOUNT, name: 'Product 101',
    stock_qty: opts.qty ?? 100, cost_price: opts.cost, retail_price: opts.retail,
    wholesale_price: opts.wholesale ?? opts.retail, min_selling_price: opts.minSelling,
    is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 1, location_id: 10, qty: opts.qty ?? 100,
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
  const planFeatures = { hasFeature: () => false };
  const returnsStub = {};
  return new SalesWriteService(
    db, tx, audit, authz, finance, query, posting, idempotency,
    planFeatures as never, returnsStub as never,
  );
}


async function createAndGetId(service: SalesWriteService, payload: any, auth: AuthContext): Promise<number> {
  const created: any = await service.createSale(payload, auth);
  const id = Number(created?.sale?.id ?? created?.saleId ?? created?.id);
  assert.ok(Number.isInteger(id) && id > 0, `createSale must return a sale id, got ${JSON.stringify(created)?.slice(0, 120)}`);
  return id;
}

function salePayload(price: number, extra: Record<string, unknown> = {}): any {
  return {
    items: [{ productId: 101, qty: 1, price, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: price }],
    tenderedAmount: price, branchId: 1, locationId: 10, source: 'dashboard',
    ...extra,
  };
}

function editPayload(price: number, extra: Record<string, unknown> = {}): any {
  return {
    ...salePayload(price),
    editReason: 'تصحيح سعر الصنف بعد مراجعة العميل',
    ...extra,
  };
}

async function readSale(db: Kysely<Database>, saleId: number): Promise<any> {
  return (db as any).selectFrom('sales').selectAll()
    .where('id', '=', saleId).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow();
}

async function readSaleItem(db: Kysely<Database>, saleId: number): Promise<any> {
  return (db as any).selectFrom('sale_items').selectAll()
    .where('sale_id', '=', saleId).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow();
}

async function locationQty(db: Kysely<Database>): Promise<number> {
  const row = await (db as any).selectFrom('product_location_stock').select('qty')
    .where('tenant_id', '=', TENANT).where('product_id', '=', 101).where('location_id', '=', 10)
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

async function main(): Promise<void> {
  // 0. Pure helper table: the formula itself, both sites' inputs.
  {
    const base = { productId: 101, costPrice: 90, unitMultiplier: 1, qty: 1, minSellingPrice: 80, effectiveAllowedUnitPrice: 100, netLineTotal: 85 };
    // Below the cost floor.
    assert.deepEqual(findBelowFloorSaleItems([base]), [101]);
    // At the floor: not below.
    assert.deepEqual(findBelowFloorSaleItems([{ ...base, netLineTotal: 90 }]), []);
    // Above the floor: not below.
    assert.deepEqual(findBelowFloorSaleItems([{ ...base, netLineTotal: 100 }]), []);
    // 0.001 of float hair is tolerated, exactly as at creation.
    assert.deepEqual(findBelowFloorSaleItems([{ ...base, netLineTotal: 89.999 }]), []);
    assert.deepEqual(findBelowFloorSaleItems([{ ...base, netLineTotal: 89.99 }]), [101]);
    // min_selling_price binds when it exceeds cost.
    assert.deepEqual(findBelowFloorSaleItems([{ ...base, costPrice: 50, minSellingPrice: 95, netLineTotal: 90 }]), [101]);
    assert.deepEqual(findBelowFloorSaleItems([{ ...base, costPrice: 50, minSellingPrice: 95, netLineTotal: 95 }]), []);
    // Unit multiplier scales both the cost and the min price. The
    // allowed price is per sold unit (a carton), so it scales too.
    assert.deepEqual(findBelowFloorSaleItems([{ ...base, unitMultiplier: 12, qty: 1, costPrice: 1080, minSellingPrice: 80, effectiveAllowedUnitPrice: 1200, netLineTotal: 1079 }]), [101]);
    assert.deepEqual(findBelowFloorSaleItems([{ ...base, unitMultiplier: 12, qty: 1, costPrice: 1080, minSellingPrice: 80, effectiveAllowedUnitPrice: 1200, netLineTotal: 1080 }]), []);
    // The allowed-price override lowers the floor: an offer/wholesale
    // price of 85 below the 90 cost is not below its own floor.
    assert.deepEqual(findBelowFloorSaleItems([{ ...base, effectiveAllowedUnitPrice: 85, netLineTotal: 85 }]), []);
    assert.deepEqual(findBelowFloorSaleItems([{ ...base, effectiveAllowedUnitPrice: 85, netLineTotal: 84 }]), [101]);
    // No override: the standard floor binds.
    assert.deepEqual(findBelowFloorSaleItems([{ ...base, effectiveAllowedUnitPrice: undefined, netLineTotal: 85 }]), [101]);
    // Services are exempt.
    assert.deepEqual(findBelowFloorSaleItems([{ ...base, isService: true, netLineTotal: 1 }]), []);
    console.log('  pure helper table passed');
  }

  // 1. Admin edit below the floor with no PIN is rejected and the
  // sale is unchanged: the gap this package closes. The gate passes
  // (canEditPrice, threshold disabled), so the rejection can only
  // come from the floor check.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, { retail: 100, cost: 90, minSelling: 80 });
      const service = buildService(db);
      const saleId = await createAndGetId(service, salePayload(100), adminAuth);
      const qtyAfterCreate = await locationQty(db);
      assert.equal(qtyAfterCreate, 99, 'creation deducts one unit');
      await expectAppError(service.updateSale(saleId, editPayload(85), adminAuth), 'MANAGER_AUTH_REQUIRED');
      const sale = await readSale(db, saleId);
      assert.equal(Number(sale.total), 100);
      assert.equal(Number(sale.paid_amount), 100);
      assert.equal(await locationQty(db), qtyAfterCreate, 'the rejected edit leaves stock untouched');
      const item = await readSaleItem(db, saleId);
      assert.equal(Number(item.cost_price), 90);
    } finally {
      await db.destroy();
    }
    console.log('  admin below-floor edit rejected passed');
  }

  // 2. The same admin edit at/above the floor posts without any PIN
  // and carries no floor-approval note.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, { retail: 100, cost: 90, minSelling: 80 });
      const service = buildService(db);
      const saleId = await createAndGetId(service, salePayload(100), adminAuth);
      await service.updateSale(saleId, editPayload(95), adminAuth);
      const sale = await readSale(db, saleId);
      assert.equal(Number(sale.total), 95);
      assert.ok(!String(sale.note || '').includes('اعتماد بيع تحت الحد'), 'no floor tag above the floor');
    } finally {
      await db.destroy();
    }
    console.log('  above-floor edit without PIN passed');
  }

  // 3. A below-floor edit WITH the floor PIN posts and carries the
  // floor-approval note, exactly as at creation. (A non-admin edit
  // always supplies the PIN for the edit itself, so the floor check
  // re-validates the same PIN and records the approval.)
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, { retail: 100, cost: 90, minSelling: 80 });
      const service = buildService(db);
      const saleId = await createAndGetId(service, salePayload(100), adminAuth);
      await service.updateSale(saleId, editPayload(85, { managerPin: MANAGER_PIN }), cashierAuth);
      const sale = await readSale(db, saleId);
      assert.equal(Number(sale.total), 85);
      assert.ok(String(sale.note || '').includes('اعتماد بيع تحت الحد'), 'floor tag present');
      assert.ok(String(sale.note || '').includes('101'), 'floor tag names the product');
    } finally {
      await db.destroy();
    }
    console.log('  below-floor edit with PIN + note passed');
  }

  // 4. The allowed-price override: a wholesale price of 85 below
  // the 90 cost is the edit's own allowed price, so it is not below
  // its own floor and posts without a PIN.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, { retail: 100, wholesale: 85, cost: 90, minSelling: 80 });
      const service = buildService(db);
      const created = salePayload(85);
      created.items[0].priceType = 'wholesale';
      const saleId = await createAndGetId(service, created, adminAuth);
      const edited = editPayload(85);
      edited.items[0].priceType = 'wholesale';
      await service.updateSale(saleId, edited, adminAuth);
      const sale = await readSale(db, saleId);
      assert.equal(Number(sale.total), 85);
      assert.ok(!String(sale.note || '').includes('اعتماد بيع تحت الحد'), 'no floor tag under the override');
    } finally {
      await db.destroy();
    }
    console.log('  allowed-price override passed');
  }

  // 5. The floor uses the FROZEN cost, not the current WAC. The WAC
  // falls 90 -> 70 after creation; an edit to 85 is still below the
  // frozen 90 and is rejected. The reverse: the WAC rises 90 -> 110
  // and an edit to 95 still posts, because the frozen cost is 90.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, { retail: 100, cost: 90, minSelling: 80 });
      const service = buildService(db);
      const saleId = await createAndGetId(service, salePayload(100), adminAuth);
      await (db as any).updateTable('products').set({ cost_price: 70 })
        .where('id', '=', 101).where('tenant_id', '=', TENANT).execute();
      await expectAppError(service.updateSale(saleId, editPayload(85), adminAuth), 'MANAGER_AUTH_REQUIRED');
      const item = await readSaleItem(db, saleId);
      assert.equal(Number(item.cost_price), 90);
    } finally {
      await db.destroy();
    }
    {
      const { pg: pg2, db: db2 } = await makeDb();
      try {
        await seedFoundation(db2);
        await seedProduct(db2, { retail: 100, cost: 90, minSelling: 80 });
        const service = buildService(db2);
        const saleId = await createAndGetId(service, salePayload(100), adminAuth);
        await (db2 as any).updateTable('products').set({ cost_price: 110 })
          .where('id', '=', 101).where('tenant_id', '=', TENANT).execute();
        await service.updateSale(saleId, editPayload(95), adminAuth);
        const item = await readSaleItem(db2, saleId);
        assert.equal(Number(item.cost_price), 90);
      } finally {
        await db2.destroy();
      }
    }
    console.log('  frozen-cost basis passed');
  }

  // 6. Creation is unchanged through the shared helper: a
  // below-floor creation without a PIN is rejected, and with the PIN
  // it posts with the floor-approval note.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, { retail: 100, cost: 90, minSelling: 80 });
      const service = buildService(db);
      await expectAppError(service.createSale(salePayload(85), adminAuth), 'MANAGER_AUTH_REQUIRED');
      const saleId = await createAndGetId(service, salePayload(85, { managerPin: MANAGER_PIN }), adminAuth);
      const sale = await readSale(db, saleId);
      assert.equal(Number(sale.total), 85);
      assert.ok(String(sale.note || '').includes('اعتماد بيع تحت الحد'), 'creation floor tag present');
    } finally {
      await db.destroy();
    }
    console.log('  creation unchanged passed');
  }

  // 7. Source + invariant pins.
  {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const serviceSource = readFileSync(resolve(__dirname, '../../src/modules/sales/services/sales-write.service.ts'), 'utf8');
    assert.ok(serviceSource.includes('findBelowFloorSaleItems'), 'both sites call the shared helper');
    assert.ok(serviceSource.includes('INV-SALE-EDIT-COST-FLOOR'), 'edit floor check is marked');
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-SALE-EDIT-COST-FLOOR').length - 1, 1, 'the invariant entry must exist exactly once');
    const lastLine = invariants.trimEnd().split('\n').pop() || '';
    assert.ok(lastLine.includes('INV-SALE-EDIT-COST-FLOOR'), 'the invariant entry must be the last line');
    console.log('  source + invariant pins passed');
  }

  console.log('Sale edit cost floor tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
