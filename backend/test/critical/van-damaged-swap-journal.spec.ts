/*
New file: backend/test/critical/van-damaged-swap-journal.spec.ts

WHAT THIS PINS (INV-VAN-DAMAGED-SWAP-JOURNAL-QUARANTINE): the real
executeDamagedSwap posts a balanced GL journal in the SAME
transaction as the stock moves, quarantines the damaged qty in the
damaged location (never back into sellable van stock), mirrors the
price difference between the customer subledger and the GL, and
executes a retried clientTxId exactly once.

THE JOURNAL (one entry, source 'van_damaged_swap', source_id = the
swap id, all legs at tenant book digits — KWD, 3 decimals here):
  Dr 5300 damagedCost — damaged item written off at cost.
  Dr 5100 replacementCost — cost of the replacement given out.
  Cr 1140 damagedCost + replacementCost — inventory out.
  priceDiff > 0 with a customer: Dr 1130 / Cr 4100.
  priceDiff < 0 with a customer: Dr 4100 / Cr 1130.
The 1130 leg is the GL mirror of the customer_ledger
'swap_price_adjustment' row, so subledger and GL agree. With no
customer there is no receivable leg: the cost legs carry the
economics and the retail-value difference has no money movement.

THE CASES (one shared PGlite DB; each case uses its own products,
customer and trip rows so cases stay independent):
1. Positive priceDiff: damaged 2 x cost 4.000 / retail 10.000,
   replacement 2 x cost 5.000 / retail 12.000 — priceDiff +4.000.
   Journal Dr 5300 8.000, Dr 5100 10.000, Dr 1130 4.000,
   Cr 1140 18.000, Cr 4100 4.000, balanced at 22.000; customer
   balance 0 -> 4.000 with a 'swap_price_adjustment' ledger row
   keyed on the swap id; van replacement stock 10 -> 8; damaged
   qty 0 in the van, 2 in the damaged location.
2. Negative priceDiff: damaged 1 x cost 3.000 / retail 12.000,
   replacement 1 x cost 2.000 / retail 10.000 — priceDiff -2.000.
   Journal Dr 5300 3.000, Dr 5100 2.000, Dr 4100 2.000,
   Cr 1140 5.000, Cr 1130 2.000, balanced at 7.000; customer
   balance 50 -> 48 with a -2.000 ledger row.
3. Retry: the same clientTxId twice returns the same swapId with
   exactly one swap row, one journal and one balance move.
4. Swap on a settled trip is refused (INVALID_TRIP).
5. Zero damaged qty is refused (INVALID_QUANTITY).
6. Swap with no customer posts the cost legs only — no 1130/4100
   legs and no ledger row — and stores a null customer_id.
7. Swap with no damaged location is refused (SWAP_REJECTED) and
   writes no swap row. Runs last: it deletes the damaged location.

WHAT IS DRIVEN: the real executeDamagedSwap (real product locks,
real evaluateDamagedSwap, real moveVanStock, real
postVanDamagedSwap journal) on PGlite, reusing the
van-settle-journal-legs spec's proven harness shape. Journal legs
are summed from the posted journal rows, never re-implemented.

NOT DRIVEN: a live swap-to-settlement run on Postgres (deferred by
written decision); two-terminal concurrency (PGlite is
single-connection — the trip-row lock serializes retries on
Postgres, the spec proves the sequential retry); the migration
itself (0315) — the spec schema mirrors its post-migration shape.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';

const TENANT = 't1';
const ACCOUNT = 'a1';
const VAN_LOC = 10;
const DAMAGED_LOC = 11;
const REP = 4;
const TRIP_OPEN = 11;
const TRIP_SETTLED = 12;

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
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE accounting_fiscal_years (id bigint PRIMARY KEY, tenant_id text, status text, closing_entry_id bigint);
    CREATE TABLE cost_centers (id bigint PRIMARY KEY, tenant_id text, code text, name text);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE UNIQUE INDEX idx_journal_entries_van_sales_uniq ON journal_entries(tenant_id, source_type, source_id) WHERE source_type IN ('van_trip_settlement', 'van_field_collection', 'van_field_return', 'van_damaged_swap');
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, end_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric DEFAULT 0, stock_variance_amount numeric DEFAULT 0, stock_variance_details text, night_stock_approved boolean, night_stock_approved_by bigint, night_stock_notes text, distance_km numeric, notes text, opened_at timestamptz, submitted_at timestamptz, closed_at timestamptz, settled_by bigint, supervisor_id bigint, updated_at timestamptz);
    CREATE TABLE van_damaged_swaps (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, damaged_product_id bigint, damaged_qty numeric DEFAULT 0, damage_reason text, replacement_product_id bigint, replacement_qty numeric DEFAULT 0, price_difference numeric(18,3) DEFAULT 0, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seed(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'KWD' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'KWD', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  // account_type matters: resolveSystemAccountByCode rejects a
  // dedicated code (5300 must be 'expense') whose stored type does
  // not match — the same requirement postDamagedStock relies on.
  const accounts: Array<[number, string, string]> = [
    [1110, '1110', 'asset'], [1130, '1130', 'asset'], [1140, '1140', 'asset'],
    [4100, '4100', 'revenue'], [5100, '5100', 'expense'], [5300, '5300', 'expense'],
  ];
  for (const [id, code, accountType] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, account_type: accountType, is_active: true, is_tax: false }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, cash_account_id: 1110,
    customer_receivable_account_id: 1130, inventory_account_id: 1140,
    sales_revenue_account_id: 4100, cogs_account_id: 5100,
  }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: VAN_LOC }).execute();
  await anyDb.insertInto('stock_locations').values({ id: VAN_LOC, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Van', location_type: 'van', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: DAMAGED_LOC, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Damaged', location_type: 'damaged', is_active: true }).execute();
  await anyDb.insertInto('delivery_representatives').values({ id: REP, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep One', phone: null, van_location_id: VAN_LOC }).execute();
  await anyDb.insertInto('van_sales_trips').values({
    id: TRIP_OPEN, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP,
    van_location_id: VAN_LOC, source_warehouse_id: VAN_LOC, status: 'open', settlement_status: 'open',
  }).execute();
  await anyDb.insertInto('van_sales_trips').values({
    id: TRIP_SETTLED, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP,
    van_location_id: VAN_LOC, source_warehouse_id: VAN_LOC, status: 'settled', settlement_status: 'settled',
  }).execute();
  // Damaged products (odd ids) hold no van stock; replacements (even
  // ids) hold 10 units in the van. Costs carry a third decimal so a
  // 2-decimal rounding anywhere in the path fails the assertions.
  const products: Array<[number, string, number, number, number]> = [
    [101, 'Damaged A', 4.0, 10.0, 0],
    [102, 'Replacement B', 5.0, 12.0, 10],
    [103, 'Damaged C', 3.0, 12.0, 0],
    [104, 'Replacement D', 2.0, 10.0, 10],
    [105, 'Damaged E', 1.0, 5.0, 0],
    [106, 'Replacement F', 1.5, 6.0, 10],
    [107, 'Damaged G', 2.0, 8.0, 0],
    [108, 'Replacement H', 3.0, 9.0, 10],
  ];
  for (const [id, name, cost, retail, stock] of products) {
    await anyDb.insertInto('products').values({
      id, tenant_id: TENANT, account_id: ACCOUNT, name,
      cost_price: cost, retail_price: retail, stock_qty: stock, is_active: true,
    }).execute();
    if (stock > 0) {
      await anyDb.insertInto('product_location_stock').values({
        tenant_id: TENANT, account_id: ACCOUNT, product_id: id, branch_id: 1, location_id: VAN_LOC, qty: stock,
      }).execute();
    }
  }
  await anyDb.insertInto('customers').values({ id: 201, tenant_id: TENANT, account_id: ACCOUNT, name: 'Cust One', balance: 0 }).execute();
  await anyDb.insertInto('customers').values({ id: 202, tenant_id: TENANT, account_id: ACCOUNT, name: 'Cust Two', balance: 50 }).execute();
  await anyDb.insertInto('customers').values({ id: 203, tenant_id: TENANT, account_id: ACCOUNT, name: 'Cust Three', balance: 0 }).execute();
}

function buildServices(db: Kysely<Database>): { van: VanSalesService } {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const van = new VanSalesService(db, {} as never, {} as never, posting);
  return { van };
}

async function swapJournal(db: Kysely<Database>, swapId: number): Promise<Array<Record<string, any>>> {
  return (db as any).selectFrom('journal_entries').selectAll()
    .where('source_type', '=', 'van_damaged_swap').where('source_id', '=', swapId).execute();
}

async function journalLeg(db: Kysely<Database>, entryId: number, accountId: number, side: 'debit' | 'credit'): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entry_lines')
    .select([side]).where('journal_entry_id', '=', entryId).where('account_id', '=', accountId).execute();
  return rows.reduce((sum: number, row: any) => sum + Number(row[side] || 0), 0);
}

async function journalTotals(db: Kysely<Database>, entryId: number): Promise<{ debit: number; credit: number }> {
  const rows = await (db as any).selectFrom('journal_entry_lines').select(['debit', 'credit'])
    .where('journal_entry_id', '=', entryId).execute();
  const summed = rows.reduce((acc: { debit: number; credit: number }, row: any) => ({
    debit: acc.debit + Number(row.debit || 0),
    credit: acc.credit + Number(row.credit || 0),
  }), { debit: 0, credit: 0 });
  return { debit: Number(summed.debit.toFixed(3)), credit: Number(summed.credit.toFixed(3)) };
}

async function locationQty(db: Kysely<Database>, locationId: number, productId: number): Promise<number> {
  const row = await (db as any).selectFrom('product_location_stock').select(['qty'])
    .where('location_id', '=', locationId).where('product_id', '=', productId).executeTakeFirst();
  return Number(row?.qty || 0);
}

async function customerBalance(db: Kysely<Database>, customerId: number): Promise<number> {
  const row = await (db as any).selectFrom('customers').select(['balance']).where('id', '=', customerId).executeTakeFirst();
  return Number(row?.balance || 0);
}

async function ledgerRows(db: Kysely<Database>, swapId: number): Promise<Array<Record<string, any>>> {
  return (db as any).selectFrom('customer_ledger').selectAll()
    .where('reference_type', '=', 'van_swap').where('reference_id', '=', swapId).execute();
}

async function swapRows(db: Kysely<Database>): Promise<Array<Record<string, any>>> {
  return (db as any).selectFrom('van_damaged_swaps').selectAll().orderBy('id', 'asc').execute();
}

function swapPayload(overrides: Record<string, unknown>): any {
  return {
    tripId: TRIP_OPEN,
    damagedProductId: 101,
    damagedQty: 2,
    damageReason: 'كسر أثناء التوزيع',
    replacementProductId: 102,
    replacementQty: 2,
    ...overrides,
  };
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    await seed(db);
    const { van } = buildServices(db);

    // 1. Positive priceDiff: balanced journal, quarantine, ledger mirror.
    {
      const result = await van.executeDamagedSwap(REP, TENANT, ACCOUNT, swapPayload({ customerId: 201 }));
      assert.equal(result.ok, true);
      assert.equal(result.priceDifference, 4);
      assert.equal(result.swapId > 0, true);
      const entries = await swapJournal(db, result.swapId);
      assert.equal(entries.length, 1, 'exactly one swap journal');
      const entryId = Number(entries[0].id);
      assert.equal(await journalLeg(db, entryId, 5300, 'debit'), 8, 'damaged cost written off');
      assert.equal(await journalLeg(db, entryId, 5100, 'debit'), 10, 'replacement cost to COGS');
      assert.equal(await journalLeg(db, entryId, 1130, 'debit'), 4, 'extra value owed by the customer');
      assert.equal(await journalLeg(db, entryId, 1140, 'credit'), 18, 'inventory out: damaged + replacement cost');
      assert.equal(await journalLeg(db, entryId, 4100, 'credit'), 4, 'extra value recognised as revenue');
      const totals = await journalTotals(db, entryId);
      assert.equal(totals.debit, totals.credit, 'the swap journal balances');
      assert.equal(totals.debit, 22, 'both sides equal 22.000 at book digits');
      assert.equal(await customerBalance(db, 201), 4, 'customer balance moved by the price difference');
      const ledger = await ledgerRows(db, result.swapId);
      assert.equal(ledger.length, 1, 'exactly one ledger row for the swap');
      assert.equal(ledger[0].entry_type, 'swap_price_adjustment', 'the ledger row is not mislabelled as a sale');
      assert.equal(Number(ledger[0].amount), 4);
      assert.equal(Number(ledger[0].balance_after), 4);
      assert.equal(await locationQty(db, VAN_LOC, 102), 8, 'replacement left the van');
      assert.equal(await locationQty(db, VAN_LOC, 101), 0, 'damaged qty is NOT sellable van stock');
      assert.equal(await locationQty(db, DAMAGED_LOC, 101), 2, 'damaged qty sits quarantined in the damaged location');
      console.log('  positive priceDiff journal + quarantine passed');
    }

    // 2. Negative priceDiff: the customer is owed the difference.
    {
      const result = await van.executeDamagedSwap(REP, TENANT, ACCOUNT, swapPayload({
        customerId: 202, damagedProductId: 103, damagedQty: 1, replacementProductId: 104, replacementQty: 1,
      }));
      assert.equal(result.ok, true);
      assert.equal(result.priceDifference, -2);
      const entries = await swapJournal(db, result.swapId);
      assert.equal(entries.length, 1, 'exactly one swap journal');
      const entryId = Number(entries[0].id);
      assert.equal(await journalLeg(db, entryId, 5300, 'debit'), 3);
      assert.equal(await journalLeg(db, entryId, 5100, 'debit'), 2);
      assert.equal(await journalLeg(db, entryId, 4100, 'debit'), 2, 'revenue reversed for the value owed');
      assert.equal(await journalLeg(db, entryId, 1140, 'credit'), 5);
      assert.equal(await journalLeg(db, entryId, 1130, 'credit'), 2, 'receivable reduced for the value owed');
      const totals = await journalTotals(db, entryId);
      assert.equal(totals.debit, totals.credit, 'the swap journal balances');
      assert.equal(totals.debit, 7, 'both sides equal 7.000 at book digits');
      assert.equal(await customerBalance(db, 202), 48, 'customer balance reduced by the price difference');
      const ledger = await ledgerRows(db, result.swapId);
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].entry_type, 'swap_price_adjustment');
      assert.equal(Number(ledger[0].amount), -2);
      assert.equal(Number(ledger[0].balance_after), 48);
      assert.equal(await locationQty(db, VAN_LOC, 104), 9);
      assert.equal(await locationQty(db, VAN_LOC, 103), 0, 'damaged qty is NOT sellable van stock');
      assert.equal(await locationQty(db, DAMAGED_LOC, 103), 1, 'damaged qty sits quarantined');
      console.log('  negative priceDiff journal + ledger mirror passed');
    }

    // 3. Retry with the same clientTxId executes once.
    {
      const payload = swapPayload({
        customerId: 203, damagedProductId: 105, damagedQty: 1,
        replacementProductId: 106, replacementQty: 1, clientTxId: 'swap-retry-1',
      });
      const first = await van.executeDamagedSwap(REP, TENANT, ACCOUNT, payload);
      const second = await van.executeDamagedSwap(REP, TENANT, ACCOUNT, payload);
      assert.equal(second.swapId, first.swapId, 'the retry returns the original swap');
      assert.equal(second.priceDifference, first.priceDifference);
      assert.equal(second.damagedProductName, first.damagedProductName);
      assert.equal((await swapRows(db)).filter((row: any) => String(row.notes || '').includes('[tx:swap-retry-1]')).length, 1, 'one swap row for the retried tx');
      assert.equal((await swapJournal(db, first.swapId)).length, 1, 'one journal for the retried swap');
      assert.equal(await customerBalance(db, 203), 1, 'the balance moved once, not twice');
      assert.equal((await ledgerRows(db, first.swapId)).length, 1, 'one ledger row for the retried swap');
      assert.equal(await locationQty(db, VAN_LOC, 106), 9, 'the replacement left the van once');
      console.log('  clientTxId retry executes once passed');
    }

    // 4. Swap on a settled trip is refused.
    {
      await assert.rejects(
        van.executeDamagedSwap(REP, TENANT, ACCOUNT, swapPayload({ tripId: TRIP_SETTLED, customerId: 201 })),
        (err: any) => { assert.equal(err.code, 'INVALID_TRIP'); return true; },
      );
      console.log('  closed-trip refusal passed');
    }

    // 5. Zero damaged qty is refused.
    {
      await assert.rejects(
        van.executeDamagedSwap(REP, TENANT, ACCOUNT, swapPayload({ damagedQty: 0, customerId: 201 })),
        (err: any) => { assert.equal(err.code, 'INVALID_QUANTITY'); return true; },
      );
      console.log('  zero-qty refusal passed');
    }

    // 6. Swap with no customer: cost legs only, no receivable leg.
    {
      const before = (await swapRows(db)).length;
      const result = await van.executeDamagedSwap(REP, TENANT, ACCOUNT, swapPayload({
        damagedProductId: 107, damagedQty: 1, replacementProductId: 108, replacementQty: 1,
      }));
      assert.equal(result.ok, true);
      assert.equal(result.priceDifference, 1);
      const rows = await swapRows(db);
      assert.equal(rows.length, before + 1);
      assert.equal(rows[rows.length - 1].customer_id, null, 'the swap row stores a null customer');
      const entries = await swapJournal(db, result.swapId);
      assert.equal(entries.length, 1, 'exactly one swap journal');
      const entryId = Number(entries[0].id);
      assert.equal(await journalLeg(db, entryId, 5300, 'debit'), 2);
      assert.equal(await journalLeg(db, entryId, 5100, 'debit'), 3);
      assert.equal(await journalLeg(db, entryId, 1140, 'credit'), 5);
      assert.equal(await journalLeg(db, entryId, 1130, 'debit'), 0, 'no receivable leg without a customer');
      assert.equal(await journalLeg(db, entryId, 4100, 'credit'), 0, 'no revenue leg without a customer');
      const totals = await journalTotals(db, entryId);
      assert.equal(totals.debit, totals.credit, 'the swap journal balances');
      assert.equal((await ledgerRows(db, result.swapId)).length, 0, 'no ledger row without a customer');
      console.log('  no-customer swap posts cost legs only passed');
    }

    // 7. No damaged location: fail closed, nothing written. Last: it
    // deletes the damaged location.
    {
      const before = (await swapRows(db)).length;
      const vanBefore = await locationQty(db, VAN_LOC, 102);
      await (db as any).deleteFrom('stock_locations').where('id', '=', DAMAGED_LOC).execute();
      await assert.rejects(
        van.executeDamagedSwap(REP, TENANT, ACCOUNT, swapPayload({ customerId: 201 })),
        (err: any) => { assert.equal(err.code, 'SWAP_REJECTED'); return true; },
      );
      assert.equal((await swapRows(db)).length, before, 'no swap row was written');
      assert.equal(await locationQty(db, VAN_LOC, 102), vanBefore, 'no stock moved on the refused swap');
      assert.equal((await swapJournal(db, before + 1)).length, 0, 'no journal was posted');
      console.log('  missing damaged location fails closed passed');
    }

    // 8. Source pins (presence only; the INV line itself is added by
    // the merge, never by this package).
    {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const here = __dirname;
      const postingSource = readFileSync(resolve(here, '../../src/modules/accounting/accounting-posting.service.ts'), 'utf8');
      assert.ok(postingSource.includes('postVanDamagedSwap'), 'the swap journal is posted by postVanDamagedSwap');
      assert.ok(postingSource.includes("'van_damaged_swap'"), 'the journal source is van_damaged_swap');
      const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
      assert.ok(vanSource.includes('postVanDamagedSwap'), 'executeDamagedSwap posts through postVanDamagedSwap');
      assert.ok(vanSource.includes("'swap_price_adjustment'"), 'the ledger row uses swap_price_adjustment');
      assert.ok(vanSource.includes("location_type', '=', 'damaged'"), 'the damaged qty is routed to the damaged location');
      assert.ok(vanSource.includes('findSwapByClientTxId'), 'the swap checks clientTxId before executing');
      console.log('  source pins passed');
    }
  } finally {
    await db.destroy();
  }
  console.log('Van damaged swap journal tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
