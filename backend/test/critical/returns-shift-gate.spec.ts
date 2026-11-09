/*
New file: backend/test/critical/returns-shift-gate.spec.ts

WHAT THIS PINS (INV-REST-RETURN-SHIFT-GATE, R7-E, I23 returns half):
returns.service.ts:72 used to throw its own OPEN_SHIFT_REQUIRED for any
cash refund without an own open shift, ignoring
requireCashierShiftForSales. A tenant that runs WITHOUT shifts
(setting explicitly false — wholesale/van/contracting/maritime-style)
could never refund cash except through an admin. After the fix the
cash-refund gate in addTreasuryTransaction honours the setting
through the pure resolveRequireCashierShiftForSales resolver, read
on the transaction handle: setting false lets the refund through,
setting true / missing fails closed to the old behaviour, and the
admin/super_admin exemption stays.

WHAT IS DRIVEN: the real ReturnsService.createReturn (sale and
purchase returns) and the real settleExchangeReturn (exchange net
cash-out) over PGlite, plus the pure resolver. All three cash-refund
callers pass through the ONE helper, so pinning the helper through
each caller pins the whole gate.

CASES:
0. The pure resolver: only an explicit false / 'false' / 0 / '0'
   disables the requirement; missing / true / unrecognised fails
   closed to requiring a shift.
1. Sale return, setting false, cashier, no shift -> succeeds; the
   treasury row exists with reference_type 'return_document'.
2. Sale return, setting true, cashier, no shift -> 400
   OPEN_SHIFT_REQUIRED; no return document, no treasury row.
3. Sale return, setting missing, cashier, no shift -> same as 2.
4. Sale return, setting true, cashier WITH an own open shift on the
   invoice branch -> succeeds; the treasury row references the shift
   and expected_cash falls by the refund.
5. Sale return, setting false, admin, no shift -> succeeds (the
   role exemption is preserved, not replaced by the setting).
6. Sale return, setting true, CARD refund, cashier, no shift ->
   succeeds with no treasury row (non-cash refunds were never
   gated and must not start being gated).
7. Exchange net cash-out, setting false, cashier, no shift ->
   succeeds; the treasury row exists.
8. Exchange net cash-out, setting true, cashier, no shift -> 400
   OPEN_SHIFT_REQUIRED; no treasury row.
9. Purchase return, setting false, cashier, no shift -> succeeds;
   the treasury row exists (same helper, third caller).

HONEST LIMITS, NOT PINNED HERE: the accounting posting is stubbed
(postSalesReturn / postPurchaseReturn return a journal id) — the
gate runs BEFORE the posting call, so the stub cannot mask it, and
the posting itself is already pinned by sale-money-truth.spec.ts
Part F. Live-Postgres acceptance remains deferred by written
decision (no live Postgres on this VM). The van-sales gates stay
deferred and are untouched.
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
import { ReturnsService } from '../../src/modules/returns/returns.service';
import { resolveRequireCashierShiftForSales } from '../../src/modules/sales/services/sales-authorization.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

const cashierAuth: AuthContext = {
  userId: 2, sessionId: 'spec', username: 'cashier', role: 'cashier',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, purchase_id bigint, purchase_item_id bigint, branch_id bigint, location_id bigint, updated_at timestamptz);
    CREATE TABLE purchases (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, note text, status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE purchase_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, purchase_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, unit_cost numeric, unit_multiplier numeric, line_total numeric, allocated_tax numeric, batch_number text, location_id bigint, branch_id bigint);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, balance numeric DEFAULT 0, store_credit_balance numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, tenant_id text, account_id text);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz, updated_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_document_id bigint, product_id bigint, product_name text, sale_item_id bigint, purchase_item_id bigint, qty numeric, unit_total numeric, line_total numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, username: 'cashier', role: 'cashier', is_active: true }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: ACCOUNT, name: 'Widget 101',
    stock_qty: 100, cost_price: 10, retail_price: 100,
    wholesale_price: 100, min_selling_price: 1,
    is_active: true, item_type: 'product', track_serials: false,
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 1, location_id: 10, qty: 100,
  }).execute();
}

async function setShiftSetting(db: Kysely<Database>, value: string): Promise<void> {
  await (db as any).insertInto('settings').values({ tenant_id: TENANT, key: 'requireCashierShiftForSales', value }).execute();
}

async function seedSale(db: Kysely<Database>, channel: 'cash' | 'card' = 'cash'): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('sales').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'S-1',
    customer_id: null, payment_type: 'cash', payment_channel: channel,
    subtotal: 100, discount: 0, tax_rate: 0, tax_amount: 0,
    prices_include_tax: false, total: 100, paid_amount: 100,
    store_credit_used: 0, status: 'posted', branch_id: 1, location_id: 10, created_by: 2,
  }).execute();
  await anyDb.insertInto('sale_items').values({
    id: 11, tenant_id: TENANT, account_id: ACCOUNT, sale_id: 1, product_id: 101,
    product_name: 'Widget 101', qty: 1, unit_price: 100, line_total: 100,
    net_unit_price: 100, net_line_total: 100, allocated_discount: 0,
    allocated_tax: 0, unit_multiplier: 1, cost_price: 10,
  }).execute();
  await anyDb.insertInto('sale_payments').values({
    tenant_id: TENANT, account_id: ACCOUNT, sale_id: 1, payment_channel: channel, amount: 100,
  }).execute();
}

async function seedPurchase(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('purchases').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'PUR-1',
    supplier_id: null, payment_type: 'cash', payment_channel: 'cash',
    subtotal: 100, discount: 0, tax_rate: 0, tax_amount: 0,
    prices_include_tax: false, total: 100, paid_amount: 100,
    status: 'posted', branch_id: 1, location_id: 10, created_by: 2,
  }).execute();
  await anyDb.insertInto('purchase_items').values({
    id: 21, tenant_id: TENANT, account_id: ACCOUNT, purchase_id: 1, product_id: 101,
    product_name: 'Widget 101', qty: 1, unit_price: 100, unit_cost: 10,
    unit_multiplier: 1, line_total: 100, allocated_tax: 0, location_id: 10, branch_id: 1,
  }).execute();
}

async function seedShift(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, doc_no: `SHIFT-${id}`,
    opened_by: openedBy, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0, created_at: '2026-01-01T00:00:00.000Z',
  }).execute();
}

async function seedExchange(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('customers').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Customer',
    balance: 0, store_credit_balance: 100, loyalty_points: 0, is_active: true,
  }).execute();
  await anyDb.insertInto('return_documents').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'ZR-1',
    return_type: 'sale', invoice_id: 1, settlement_mode: 'store_credit',
    refund_method: 'cash', total: 100, branch_id: 1, location_id: 10, created_by: 2,
  }).execute();
}

function buildReturnsService(db: Kysely<Database>): ReturnsService {
  const tx = new TransactionHelper();
  const audit = new AuditService(db);
  // The posting is stubbed: the shift gate runs BEFORE postSalesReturn /
  // postPurchaseReturn, so the stub cannot mask the gate; the posting
  // itself is pinned by sale-money-truth.spec.ts Part F.
  const postingStub = {
    postSalesReturn: async () => ({ journalEntryId: 1 }),
    postPurchaseReturn: async () => ({ journalEntryId: 1 }),
    // Merge-time mirror (R7-A F1): createSaleReturn calls
    // computeSalesReturnRelief before the posting call. Zero relief is
    // correct here — E's seeded sales carry no tip/courier fee; the
    // relief math itself is pinned by returns-payout-truth.spec.ts.
    computeSalesReturnRelief: async () => ({ tipRelief: 0, courierRelief: 0, totalRelief: 0 }),
  } as any;
  const idempotency = new IdempotencyService(db);
  return new ReturnsService(db, tx, audit, postingStub, idempotency);
}

function saleReturnPayload(refundMethod: 'cash' | 'card'): any {
  return {
    type: 'sale', invoiceId: 1,
    items: [{ productId: 101, productName: 'Widget 101', qty: 1, saleItemId: 11 }],
    settlementMode: 'refund', refundMethod, note: 'spec',
  };
}

function purchaseReturnPayload(): any {
  return {
    type: 'purchase', invoiceId: 1,
    items: [{ productId: 101, productName: 'Widget 101', qty: 1, purchaseItemId: 21 }],
    settlementMode: 'refund', refundMethod: 'cash', note: 'spec',
  };
}

async function treasuryRows(db: Kysely<Database>): Promise<any[]> {
  return (db as any).selectFrom('treasury_transactions').selectAll().execute();
}

async function countTable(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select(sql`count(*)`.as('n')).executeTakeFirst();
  return Number(row?.n || 0);
}

async function main(): Promise<void> {
  // 0. The pure resolver: only an explicit off disables the gate.
  assert.equal(resolveRequireCashierShiftForSales(undefined), true, 'missing setting fails closed');
  assert.equal(resolveRequireCashierShiftForSales(new Map()), true, 'empty map fails closed');
  assert.equal(resolveRequireCashierShiftForSales(new Map([['requireCashierShiftForSales', true]])), true);
  assert.equal(resolveRequireCashierShiftForSales(new Map([['requireCashierShiftForSales', 'true']])), true);
  assert.equal(resolveRequireCashierShiftForSales(new Map([['requireCashierShiftForSales', 'yes']])), true, 'unrecognised value fails closed');
  assert.equal(resolveRequireCashierShiftForSales(new Map([['requireCashierShiftForSales', false]])), false);
  assert.equal(resolveRequireCashierShiftForSales(new Map([['requireCashierShiftForSales', 'false']])), false);
  assert.equal(resolveRequireCashierShiftForSales(new Map([['requireCashierShiftForSales', 0]])), false);
  assert.equal(resolveRequireCashierShiftForSales(new Map([['requireCashierShiftForSales', '0']])), false);
  console.log('  0. resolver fail-closed pins passed');

  // 1. Sale return, setting false, cashier, no shift -> succeeds.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setShiftSetting(db, 'false');
      await seedSale(db);
      const service = buildReturnsService(db);
      const result: any = await service.createReturn(saleReturnPayload('cash'), cashierAuth);
      assert.ok(result?.returnDocumentId, 'the sale return is created');
      const rows = await treasuryRows(db);
      assert.equal(rows.length, 1, 'one treasury row is written');
      assert.equal(Number(rows[0].amount), -100, 'the cash refund leaves the treasury');
      assert.equal(rows[0].reference_type, 'return_document', 'no shift exists, so the row references the return');
      assert.equal(await countTable(db, 'return_documents'), 1, 'the return document exists');
    } finally {
      await db.destroy();
    }
    console.log('  1. sale return with the setting off and no shift succeeds passed');
  }

  // 2. Sale return, setting true, cashier, no shift -> OPEN_SHIFT_REQUIRED, nothing written.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setShiftSetting(db, 'true');
      await seedSale(db);
      const service = buildReturnsService(db);
      await assert.rejects(
        service.createReturn(saleReturnPayload('cash'), cashierAuth),
        (err: any) => err && err.code === 'OPEN_SHIFT_REQUIRED',
      );
      assert.equal(await countTable(db, 'return_documents'), 0, 'no return document is written');
      assert.equal((await treasuryRows(db)).length, 0, 'no treasury row is written');
    } finally {
      await db.destroy();
    }
    console.log('  2. sale return with the setting on and no shift is rejected passed');
  }

  // 3. Sale return, setting missing, cashier, no shift -> same rejection (fail-closed).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedSale(db);
      const service = buildReturnsService(db);
      await assert.rejects(
        service.createReturn(saleReturnPayload('cash'), cashierAuth),
        (err: any) => err && err.code === 'OPEN_SHIFT_REQUIRED',
      );
      assert.equal(await countTable(db, 'return_documents'), 0, 'no return document is written');
    } finally {
      await db.destroy();
    }
    console.log('  3. sale return with a missing setting and no shift is rejected passed');
  }

  // 4. Sale return, setting true, cashier WITH an own open shift -> succeeds, attributed to the shift.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setShiftSetting(db, 'true');
      await seedSale(db);
      await seedShift(db, 1, 2);
      const service = buildReturnsService(db);
      const result: any = await service.createReturn(saleReturnPayload('cash'), cashierAuth);
      assert.ok(result?.returnDocumentId, 'the sale return is created');
      const rows = await treasuryRows(db);
      assert.equal(rows.length, 1, 'one treasury row is written');
      assert.equal(Number(rows[0].amount), -100, 'the cash refund leaves the treasury');
      assert.equal(rows[0].reference_type, 'cashier_shift', 'the row references the open shift');
      assert.equal(Number(rows[0].reference_id), 1, 'the row references the cashier shift');
      const shift: any = await (db as any).selectFrom('cashier_shifts').selectAll().where('id', '=', 1).executeTakeFirst();
      assert.equal(Number(shift.expected_cash), -100, 'expected cash falls by the refund');
    } finally {
      await db.destroy();
    }
    console.log('  4. sale return with the setting on and an open shift attributes to the shift passed');
  }

  // 5. Sale return, setting false, admin, no shift -> succeeds (exemption preserved).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setShiftSetting(db, 'false');
      await seedSale(db);
      const service = buildReturnsService(db);
      const result: any = await service.createReturn(saleReturnPayload('cash'), adminAuth);
      assert.ok(result?.returnDocumentId, 'the admin sale return is created');
      assert.equal((await treasuryRows(db)).length, 1, 'the treasury row is written');
    } finally {
      await db.destroy();
    }
    console.log('  5. sale return with the setting off by an admin succeeds passed');
  }

  // 6. Sale return, setting true, CARD refund of a CARD-paid sale,
  // cashier, no shift -> succeeds, no treasury row. (A card refund
  // of a cash-paid sale still refunds cash by tender protection,
  // so the fixture sale is card-paid.)
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setShiftSetting(db, 'true');
      await seedSale(db, 'card');
      const service = buildReturnsService(db);
      const result: any = await service.createReturn(saleReturnPayload('card'), cashierAuth);
      assert.ok(result?.returnDocumentId, 'the card return is created');
      assert.equal((await treasuryRows(db)).length, 0, 'a card refund writes no treasury row');
    } finally {
      await db.destroy();
    }
    console.log('  6. card return with the setting on and no shift is never gated passed');
  }

  // 7. Exchange net cash-out, setting false, cashier, no shift -> succeeds.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setShiftSetting(db, 'false');
      await seedExchange(db);
      const service = buildReturnsService(db);
      const context = {
        returnId: 1, total: 100, customerId: 1, branchId: 1, locationId: 10,
        refundBase: {
          originalCashPaid: 100, originalNonCashPaid: 0, originalDebt: 0,
          previousCashRefunded: 0, previousNonCashRefunded: 0, previousDebtReversed: 0,
          hasCustomer: true,
        },
      };
      const settlement: any = await db.transaction().execute(async (trx) =>
        service.settleExchangeReturn(trx as any, context as any, 70, 'cash', cashierAuth));
      assert.equal(Number(settlement.refundAmount), 30, 'the exchange refunds the 30 net cash-out');
      const rows = await treasuryRows(db);
      assert.equal(rows.length, 1, 'one treasury row is written');
      assert.equal(Number(rows[0].amount), -30, 'the cash-out leaves the treasury');
      assert.equal(rows[0].reference_type, 'return_document', 'no shift exists, so the row references the return');
    } finally {
      await db.destroy();
    }
    console.log('  7. exchange cash-out with the setting off and no shift succeeds passed');
  }

  // 8. Exchange net cash-out, setting true, cashier, no shift -> OPEN_SHIFT_REQUIRED.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setShiftSetting(db, 'true');
      await seedExchange(db);
      const service = buildReturnsService(db);
      const context = {
        returnId: 1, total: 100, customerId: 1, branchId: 1, locationId: 10,
        refundBase: {
          originalCashPaid: 100, originalNonCashPaid: 0, originalDebt: 0,
          previousCashRefunded: 0, previousNonCashRefunded: 0, previousDebtReversed: 0,
          hasCustomer: true,
        },
      };
      await assert.rejects(
        db.transaction().execute(async (trx) =>
          service.settleExchangeReturn(trx as any, context as any, 70, 'cash', cashierAuth)),
        (err: any) => err && err.code === 'OPEN_SHIFT_REQUIRED',
      );
      assert.equal((await treasuryRows(db)).length, 0, 'no treasury row is written');
    } finally {
      await db.destroy();
    }
    console.log('  8. exchange cash-out with the setting on and no shift is rejected passed');
  }

  // 9. Purchase return, setting false, cashier, no shift -> succeeds.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setShiftSetting(db, 'false');
      await seedPurchase(db);
      const service = buildReturnsService(db);
      const result: any = await service.createReturn(purchaseReturnPayload(), cashierAuth);
      assert.ok(result?.returnDocumentId, 'the purchase return is created');
      const rows = await treasuryRows(db);
      assert.equal(rows.length, 1, 'one treasury row is written');
      assert.equal(Number(rows[0].amount), 100, 'the supplier cash refund enters the treasury');
      assert.equal(rows[0].txn_type, 'purchase_return_refund', 'the row is a purchase-return refund');
      assert.equal(rows[0].reference_type, 'return_document', 'no shift exists, so the row references the return');
    } finally {
      await db.destroy();
    }
    console.log('  9. purchase return with the setting off and no shift succeeds passed');
  }

  // 10. Source pin: the gate names the invariant and honours the setting.
  {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const here = __dirname;
    const serviceSource = readFileSync(resolve(here, '../../src/modules/returns/returns.service.ts'), 'utf8');
    assert.ok(serviceSource.includes('INV-REST-RETURN-SHIFT-GATE'), 'the gate names the invariant');
    assert.ok(serviceSource.includes('resolveRequireCashierShiftForSales'), 'the gate uses the I23 resolver');
    assert.ok(serviceSource.includes('requireCashierShiftForReturns'), 'the gate reads the setting on the transaction handle');
    const authzSource = readFileSync(resolve(here, '../../src/modules/sales/services/sales-authorization.service.ts'), 'utf8');
    assert.ok(authzSource.includes('INV-REST-RETURN-SHIFT-GATE'), 'the authorization note names the returns extension');
    assert.ok(!authzSource.includes('return-refund and\n   * van-remittance gates stay strict'), 'the stale stay-strict note for returns is gone');
    console.log('  10. source pins passed');
  }

  console.log('Returns shift gate tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
