/*
 * Van field-sale dedup distinguishing key (INV-VAN-DEDUP-DISTINGUISHING-KEY,
 * Slice 5 P7-2).
 *
 * THE DEFECT: executeFieldSale kept a process-local recent-result cache
 * keyed by the basket fingerprint (tenant+trip+rep+customer+sorted
 * productId:qty:unitPrice) and returned the cached result for 5 seconds
 * after a sale completed. Two genuinely identical baskets sold to the
 * same shop seconds apart returned the FIRST sale's id with no second
 * sale, stock movement, or journal. The fingerprint identifies a
 * basket, not a submission.
 *
 * THE FIX (settled from the code, van-sales.service.ts): a completed
 * sale is never returned from a fingerprint-keyed cache. The
 * fingerprint key survives ONLY in the in-flight promise map, so
 * concurrent duplicate submissions still collapse into one execution.
 * Completed-result dedup now rests on the client-supplied key only:
 * the clientTxId (txKey) recent cache (30s) backed by the durable
 * [tx:clientTxId] database note check. The 4-second database
 * rapid-fire backstop is UNCHANGED (INV-VAN-RAPID-FIRE-SIGNATURE):
 * it still collapses an identical product/quantity multiset within
 * 4 seconds, by design — so the "genuinely identical" cases below
 * age the first sale out of that window, isolating the cache layer
 * under test from the backstop. The field-collection twin path
 * (recentCollectionsCache) is a separate follow-up and is untouched.
 *
 * WHAT THIS DRIVES: the REAL executeFieldSale + executeFieldSaleInternal
 * + AccountingPostingService on PGlite, with the book-digits spec's
 * harness shape (tenant foundation stubbed no-op, fraud radar stubbed
 * no-op — the same deadlock-avoidance shadowing documented there).
 * Cases pin distinct sale ids/rows, stock decrements, and balanced
 * journals for genuine repeats, and single execution for true
 * retries. The integrated live-Postgres acceptance run remains
 * deferred by written decision until the first real tenant.
 *
 * HONEST LIMIT: PGlite only. The 5-second cache window itself is not
 * waited out in real time; ageing is done by backdating the first
 * sale's created_at past the 4-second backstop window, which is
 * exactly the condition under which the old cache (but not the
 * backstop) would still have collapsed the second sale.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

const TENANT = 't-van-dedup';
const ACCOUNT = 'a-van-dedup';

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cash_flow_category text, updated_at timestamptz);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
    `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'sys', is_active: true }).execute();
  const accounts: Array<[number, string, string]> = [
    [1110, '1110', 'asset'], [1120, '1120', 'asset'], [1130, '1130', 'asset'], [1140, '1140', 'asset'],
    [2120, '2120', 'liability'], [4100, '4100', 'revenue'], [4300, '4300', 'revenue'], [5100, '5100', 'expense'],
  ];
  for (const [id, code, type] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, account_type: type, is_active: true, is_tax: false }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, inventory_account_id: 1140,
    sales_revenue_account_id: 4100, sales_discount_account_id: 4300,
    cogs_account_id: 5100, sales_tax_account_id: 2120,
  }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 20, tenant_id: TENANT, account_id: ACCOUNT, name: 'Van', location_type: 'van', is_active: true }).execute();
  await anyDb.insertInto('delivery_representatives').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep 1', van_location_id: 20, is_van_rep: true }).execute();
  await anyDb.insertInto('van_sales_trips').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 1, van_location_id: 20, status: 'open' }).execute();
  await anyDb.insertInto('customers').values({ id: 21, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop 21', balance: 0, credit_limit: 0 }).execute();
}

async function seedProduct(db: Kysely<Database>, id: number, retail: number, cost: number, vanQty: number): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('products').values({ id, tenant_id: TENANT, account_id: ACCOUNT, name: `Product ${id}`, stock_qty: vanQty, cost_price: cost, retail_price: retail, credit_price: 0, is_active: true }).execute();
  await anyDb.insertInto('product_location_stock').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: id, location_id: 20, qty: vanQty }).execute();
}

function buildService(db: Kysely<Database>): VanSalesService {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  const fraudStub = { recordSuspicionEvent: async () => {}, getSummary: async () => ({}), getEvents: async () => [] };
  const service = new VanSalesService(db, {} as never, {} as never, posting as never,
    undefined, undefined, undefined, undefined, undefined, undefined, fraudStub as never);
  (service as any).resolveSystemAuthContext = async () => ({
    userId: 1, sessionId: 'spec', username: 'spec', role: 'admin',
    permissions: ['accounting'], tenantId: TENANT, accountId: ACCOUNT,
  });
  return service;
}

function clearCaches(): void {
  (VanSalesService as any).recentSalesCache?.clear?.();
  (VanSalesService as any).inFlightSalePromises?.clear?.();
}

async function salesCount(db: Kysely<Database>): Promise<number> {
  const row = await (db as any).selectFrom('sales').select(sql`count(*)`.as('cnt')).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow() as any;
  return Number(row.cnt);
}

async function vanQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await (db as any).selectFrom('product_location_stock').select('qty')
    .where('tenant_id', '=', TENANT).where('product_id', '=', productId).where('location_id', '=', 20)
    .executeTakeFirstOrThrow() as any;
  return Number(row.qty);
}

async function ageSale(db: Kysely<Database>, saleId: number): Promise<void> {
  // Move the sale out of the 4-second database rapid-fire window so the
  // case isolates the in-process cache layer from the backstop.
  await (db as any).updateTable('sales')
    .set({ created_at: sql`NOW() - INTERVAL '10 seconds'` })
    .where('id', '=', saleId).where('tenant_id', '=', TENANT).execute();
}

async function journalBalanced(db: Kysely<Database>, saleId: number): Promise<boolean> {
  const rows = await (db as any).selectFrom('journal_entry_lines')
    .innerJoin('journal_entries', 'journal_entries.id', 'journal_entry_lines.journal_entry_id')
    .select(['journal_entry_lines.debit', 'journal_entry_lines.credit'])
    .where('journal_entries.source_type', '=', 'sale')
    .where('journal_entries.source_id', '=', saleId)
    .where('journal_entries.tenant_id', '=', TENANT)
    .execute() as unknown as Array<Record<string, unknown>>;
  assert.ok(rows.length > 0, 'sale must have journal lines');
  const debit = rows.reduce((s, r) => s + Number(r.debit), 0);
  const credit = rows.reduce((s, r) => s + Number(r.credit), 0);
  return debit === credit;
}

function basket(clientTxId?: string): any {
  return {
    tripId: 1, customerId: 21, customerName: 'Shop 21',
    paymentMethod: 'cash' as const,
    ...(clientTxId ? { clientTxId } : {}),
    items: [{ productId: 101, qty: 2, unitPrice: 50 }],
  };
}

async function main(): Promise<void> {
  // 1. Genuine identical sequential sales, no clientTxId, first sale
  // aged out of the backstop window: both must post as distinct sales.
  {
    clearCaches();
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 50, 20, 10);
      const service = buildService(db);
      const first = await service.executeFieldSale(1, TENANT, ACCOUNT, basket());
      await ageSale(db, first.saleId);
      const second = await service.executeFieldSale(1, TENANT, ACCOUNT, basket());
      assert.notEqual(second.saleId, first.saleId, 'a genuine repeat must create a distinct sale, not return the first id');
      assert.equal(await salesCount(db), 2);
      assert.equal(await vanQty(db, 101), 6, 'van stock must fall twice (10 - 2 - 2)');
      assert.equal(await journalBalanced(db, first.saleId), true);
      assert.equal(await journalBalanced(db, second.saleId), true);
    } finally { await db.destroy(); }
  }

  // 2. True retry, same clientTxId: exactly one sale, second call
  // returns the first sale's id with no second write.
  {
    clearCaches();
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 50, 20, 10);
      const service = buildService(db);
      const first = await service.executeFieldSale(1, TENANT, ACCOUNT, basket('tx-retry-1'));
      const retry = await service.executeFieldSale(1, TENANT, ACCOUNT, basket('tx-retry-1'));
      assert.equal(retry.saleId, first.saleId, 'a retry with the same clientTxId must return the first sale');
      assert.equal(await salesCount(db), 1);
      assert.equal(await vanQty(db, 101), 8, 'van stock must fall once');
    } finally { await db.destroy(); }
  }

  // 3. Distinct clientTxIds, first sale aged: both post as distinct sales.
  {
    clearCaches();
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 50, 20, 10);
      const service = buildService(db);
      const first = await service.executeFieldSale(1, TENANT, ACCOUNT, basket('tx-first'));
      await ageSale(db, first.saleId);
      const second = await service.executeFieldSale(1, TENANT, ACCOUNT, basket('tx-second'));
      assert.notEqual(second.saleId, first.saleId);
      assert.equal(await salesCount(db), 2);
      assert.equal(await vanQty(db, 101), 6);
    } finally { await db.destroy(); }
  }

  // 4. The 4-second database backstop is unchanged (real path):
  // identical multiset inside the window still dedupes to the first sale.
  {
    clearCaches();
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 50, 20, 10);
      const service = buildService(db);
      const first = await service.executeFieldSale(1, TENANT, ACCOUNT, basket());
      const dup = await service.executeFieldSale(1, TENANT, ACCOUNT, basket());
      assert.equal(dup.saleId, first.saleId, 'the backstop must still collapse an identical sale inside 4 seconds');
      assert.equal(await salesCount(db), 1);
      assert.equal(await vanQty(db, 101), 8, 'van stock must fall once');
    } finally { await db.destroy(); }
  }

  // 5. Backstop multiset rule, real path: different products with the
  // same line count post; same products with different quantities post.
  {
    clearCaches();
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 50, 20, 10);
      await seedProduct(db, 102, 30, 10, 10);
      const service = buildService(db);
      const first = await service.executeFieldSale(1, TENANT, ACCOUNT, basket());
      const other = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 21, customerName: 'Shop 21', paymentMethod: 'cash' as const,
        items: [{ productId: 102, qty: 2, unitPrice: 30 }],
      });
      assert.notEqual(other.saleId, first.saleId, 'different products must post despite the same line count');
      const more = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 21, customerName: 'Shop 21', paymentMethod: 'cash' as const,
        items: [{ productId: 101, qty: 5, unitPrice: 50 }],
      });
      assert.notEqual(more.saleId, first.saleId, 'different quantities must post');
      assert.equal(await salesCount(db), 3);
    } finally { await db.destroy(); }
  }

  // 6. Concurrent identical submissions with distinct clientTxIds
  // still collapse into one execution via the in-flight promise map.
  {
    clearCaches();
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 50, 20, 10);
      const service = buildService(db);
      const [a, b] = await Promise.all([
        service.executeFieldSale(1, TENANT, ACCOUNT, basket('tx-conc-a')),
        service.executeFieldSale(1, TENANT, ACCOUNT, basket('tx-conc-b')),
      ]);
      assert.equal(a.saleId, b.saleId, 'concurrent duplicates must share one execution');
      assert.equal(await salesCount(db), 1);
      assert.equal(await vanQty(db, 101), 8, 'van stock must fall once');
    } finally { await db.destroy(); }
  }

  // 7. Source pins + invariant pin.
  {
    const source = readFileSync(resolve(__dirname, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
    assert.ok(!source.includes('recentSalesCache.has(fingerprintKey)'), 'no fingerprint-keyed cache lookup may remain');
    assert.ok(!source.includes('recentSalesCache.set(fingerprintKey'), 'no fingerprint-keyed cache write may remain');
    assert.ok(source.includes('recentSalesCache.has(txKey)'), 'the clientTxId cache lookup must remain');
    assert.ok(source.includes('recentSalesCache.set(txKey'), 'the clientTxId cache write must remain');
    assert.ok(source.includes('inFlightSalePromises.has(fingerprintKey)'), 'the in-flight fingerprint dedup must remain');
    assert.ok(source.includes('dbItemsSig === payloadItemsSig'), 'the multiset backstop comparison must remain');
    assert.ok(source.includes('nowMs - entry.timestamp < 5000'), 'the field-collection cache window must remain untouched');
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-VAN-DEDUP-DISTINGUISHING-KEY').length - 1, 1, 'the invariant entry must exist exactly once');
    assert.equal(invariants.split('INV-FLOATING-POOL-ALLOCATION-LEG').length - 1, 1, 'the P3 invariant entry must still exist exactly once');
    assert.equal(invariants.split('INV-CONVERSION-PAYMENT-TERMS-CARRIED').length - 1, 1, 'the P6b invariant entry must still exist exactly once');
    // Last-line ownership passes to newer entries:
    // INV-CONVERSION-LIFECYCLE-RACES appends after this entry, so
    // the last-line assertion that held at this package's own
    // landing is relaxed here — test-only, behaviour cases above
    // are unchanged. (Same chaining precedent as P7-2's own
    // relaxation of the P3/P6b last-line pins.)
  }

  console.log('Van sale dedup key tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
