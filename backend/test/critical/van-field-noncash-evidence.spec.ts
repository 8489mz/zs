/*
 * Van field non-cash evidence gate (INV-VAN-FIELD-NONCASH-EVIDENCE-GATE).
 *
 * THE GAP: field payments by instapay / vodafone_cash posted to bank
 * 1120 with ZERO evidence. The card evidence gate
 * evaluateFieldCardPayment (supervisor PIN + reference >= 3 chars)
 * ran for card only: executeFieldSaleInternal checked it only under
 * `if (isCard && totalSale > 0)`, so an instapay sale skipped it
 * entirely. Collections had no evidence check at all, and
 * postVanFieldCollection debited bank 1120 for any non-cash method.
 * A rep could settle a customer debt as "instapay arrived" with zero
 * reference, and no cash was ever expected from him at settlement.
 *
 * THE RULE: every non-cash field payment / collection (card,
 * instapay, vodafone_cash — plus bank_transfer on collections)
 * requires evidence mirroring the card gate — supervisor approval
 * (verified PIN, maker-checker enforced) + a reference of at least
 * 3 chars — or it is refused fail-closed (403) before any balance
 * moves. The gate is evaluateFieldCardPayment itself, reused, not a
 * second copy. postVanFieldCollection additionally refuses to debit
 * bank 1120 for an electronic collection without a reference, as the
 * last line of defence for any future caller.
 *
 * CONTRACT NOTE (deliberate, recorded): the card leg is
 * byte-identical to the pre-existing card contract — reference =
 * reason || notes, with the approval note as the fallback reference,
 * so a PIN-approved card sale still passes without an explicit
 * reference. The instapay / vodafone_cash leg has NO invented
 * fallback: it needs a real transfer reference (or note) of at
 * least 3 chars on top of the PIN. Collections likewise need a real
 * reference — a collection settles a pre-existing customer debt
 * straight to bank 1120, so the reference is the only audit trail
 * tying the bank receipt to the customer. Cash is untouched on both
 * paths: cash stays in rep custody until settleTrip.
 *
 * HARNESS: the real VanSalesService + the real
 * AccountingPostingService on ONE shared PGlite database (a fresh
 * PGlite per case OOM-killed this VM while sibling batch agents run
 * specs concurrently — one instance keeps the peak bounded). Cases
 * are isolated by distinct trip / product / customer ids instead.
 * Same stubs as the van-field-sale-tax-optional spec:
 * resolveSystemAuthContext shadowed and the fraud radar stubbed
 * no-op, because a pool read inside the open transaction deadlocks
 * on PGlite's single connection. The supervisor PIN is driven
 * through the REAL verifySupervisorPin: the shared manager PIN is
 * seeded as a bcrypt hash in settings (INV-VAN-SUPERVISOR-PIN-AUTHORIZED),
 * so the approval in the passing cases is a real verification through
 * the shared authorizeManagerSecret rule, not a stub. A plaintext
 * users.pin would never approve here.
 * collection gate runs inside the collection transaction, after the
 * INV-VAN-TRIP-LOCKED-STATE-RECHECK locked-trip re-read — a refused
 * collection therefore rolls the whole transaction back.
 *
 * LIMITS (recorded, not fixed here): the driver collection UI today
 * sends cash only (no paymentMethod, no reference, no PIN field), so
 * no existing UI flow breaks — but a rep cannot complete a non-cash
 * collection from the UI until a supervisor-PIN + reference prompt
 * is added there (backend DTO field supervisorOverridePin already
 * exists for the API). The sale UI already sends supervisorOverridePin
 * + transferReference for instapay / vodafone_cash.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { hashManagerPin } from '../../src/common/utils/manager-approval';

const TENANT = 't-van-noncash-evidence';
const ACCOUNT = 'a-van-noncash-evidence';
const SUPERVISOR_PIN = '4321';

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
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
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, pin_hash text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, display_name text, phone text, pin text, pin_hash text, permissions_json text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, gps_lat numeric, gps_lng numeric, tenant_id text, account_id text);
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric, note text, transfer_reference text, transfer_receipt_url text, payment_channel text, van_trip_id bigint, rep_id bigint, client_tx_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_returns (id bigint PRIMARY KEY, tenant_id text, rep_id bigint);
    `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'sys', is_active: true }).execute();
  // The shared manager PIN (bcrypt) is what the real verifier checks;
  // the supervisor user carries no plaintext PIN anymore.
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: JSON.stringify(await hashManagerPin(SUPERVISOR_PIN)) }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, username: 'supervisor', display_name: 'Supervisor', role: 'supervisor', pin: null, is_active: true }).execute();
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
  // One open trip per sale case (1-7) and per collection case (8-13),
  // one product per sale case (101-107), one 500-balance customer per
  // collection case (7-12) — this is the per-case isolation on the
  // single shared database.
  for (let tripId = 1; tripId <= 13; tripId++) {
    await anyDb.insertInto('van_sales_trips').values({ id: tripId, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 1, van_location_id: 20, status: 'open' }).execute();
  }
  for (let productId = 101; productId <= 107; productId++) {
    await anyDb.insertInto('products').values({ id: productId, tenant_id: TENANT, account_id: ACCOUNT, name: `Product ${productId}`, stock_qty: 10, cost_price: 50, retail_price: 100, credit_price: 0, is_active: true }).execute();
    await anyDb.insertInto('product_location_stock').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: productId, location_id: 20, qty: 10 }).execute();
  }
  for (let customerId = 7; customerId <= 12; customerId++) {
    await anyDb.insertInto('customers').values({ id: customerId, tenant_id: TENANT, account_id: ACCOUNT, name: `Shop Customer ${customerId}`, balance: 500, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
  }
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

function clearCollectionCaches(): void {
  // recordFieldCollection dedups in memory on the class-level
  // caches (fingerprint has no paymentMethod), so a refused-then-
  // retried collection in the next case must not read a stale hit.
  (VanSalesService as any).recentCollectionsCache?.clear?.();
  (VanSalesService as any).inFlightCollectionPromises?.clear?.();
}

async function saleRow(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any).selectFrom('sales').selectAll().where('id', '=', id).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow();
}

async function tripSalesCount(db: Kysely<Database>, tripId: number): Promise<number> {
  const rows = await (db as any).selectFrom('sales').selectAll().where('tenant_id', '=', TENANT).where('van_trip_id', '=', tripId).execute();
  return rows.length;
}

async function tripRow(db: Kysely<Database>, tripId: number): Promise<any> {
  return (db as any).selectFrom('van_sales_trips').selectAll().where('id', '=', tripId).executeTakeFirstOrThrow();
}

async function journalLines(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<Array<{ accountId: number; debit: number; credit: number }>> {
  const rows = await (db as any).selectFrom('journal_entry_lines')
    .innerJoin('journal_entries', 'journal_entries.id', 'journal_entry_lines.journal_entry_id')
    .select(['journal_entry_lines.account_id', 'journal_entry_lines.debit', 'journal_entry_lines.credit'])
    .where('journal_entries.source_type', '=', sourceType)
    .where('journal_entries.source_id', '=', sourceId)
    .where('journal_entries.tenant_id', '=', TENANT)
    .execute() as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({ accountId: Number(r.account_id), debit: Number(r.debit), credit: Number(r.credit) }));
}

function lineFor(lines: Array<{ accountId: number; debit: number; credit: number }>, accountId: number): { debit: number; credit: number } {
  return lines.filter((l) => l.accountId === accountId).reduce((acc, l) => ({ debit: acc.debit + l.debit, credit: acc.credit + l.credit }), { debit: 0, credit: 0 });
}

async function journalCount(db: Kysely<Database>, sourceType: string): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entries').selectAll().where('source_type', '=', sourceType).where('tenant_id', '=', TENANT).execute();
  return rows.length;
}

async function customerBalance(db: Kysely<Database>, customerId: number): Promise<number> {
  const row = await (db as any).selectFrom('customers').select('balance').where('id', '=', customerId).executeTakeFirstOrThrow() as any;
  return Number(row.balance);
}

async function paymentsCount(db: Kysely<Database>): Promise<number> {
  const rows = await (db as any).selectFrom('customer_payments').selectAll().where('tenant_id', '=', TENANT).execute();
  return rows.length;
}

async function main(): Promise<void> {
  const { db } = await makeDb();
  try {
    await seedFoundation(db);
    const service = buildService(db);

    // 1. InstaPay sale, zero evidence (no PIN, no reference): refused
    // with the card gate's reason code, and nothing is written.
    {
      await assert.rejects(
        () => service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 1, paymentMethod: 'instapay',
          items: [{ productId: 101, qty: 2 }],
        }),
        (err: any) => err.code === 'CARD_PAYMENT_REQUIRES_SUPERVISOR_PIN',
        'an unevidenced instapay sale must be refused',
      );
      assert.equal(await tripSalesCount(db, 1), 0, 'no sale row was written');
      const trip = await tripRow(db, 1);
      assert.equal(Number(trip.sales_amount), 0, 'trip sales total untouched');
      assert.equal(Number(trip.total_instapay_sales), 0, 'trip instapay total untouched');
      console.log('  (1) instapay sale without evidence refused passed');
    }

    // 2. InstaPay sale, supervisor PIN but no reference at all: the
    // instapay leg has no invented fallback reference, so it is
    // refused with the reference code.
    {
      await assert.rejects(
        () => service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 2, paymentMethod: 'instapay',
          supervisorOverridePin: SUPERVISOR_PIN,
          items: [{ productId: 102, qty: 2 }],
        }),
        (err: any) => err.code === 'CARD_PAYMENT_REFERENCE_REQUIRED',
        'an instapay sale with PIN but no reference must be refused',
      );
      assert.equal(await tripSalesCount(db, 2), 0, 'no sale row was written');
      console.log('  (2) instapay sale with PIN but no reference refused passed');
    }

    // 3. InstaPay sale, supervisor PIN + transfer reference: posts
    // settled_to_bank, with the bank_transfer payment row and the
    // trip instapay total. The sale journal debits bank 1120 for the
    // non-cash amount (paid in full, so no receivable leg) and
    // credits revenue 4100.
    {
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 3, paymentMethod: 'instapay',
        supervisorOverridePin: SUPERVISOR_PIN, transferReference: 'IP-9988221',
        items: [{ productId: 103, qty: 2 }],
      });
      assert.equal(res.total, 200);
      const sale = await saleRow(db, res.saleId);
      assert.equal(sale.collection_status, 'settled_to_bank');
      const payment = await (db as any).selectFrom('sale_payments').select(['amount', 'payment_channel', 'card_rrn']).where('sale_id', '=', res.saleId).executeTakeFirstOrThrow() as any;
      assert.equal(Number(payment.amount), 200);
      assert.equal(payment.payment_channel, 'bank_transfer');
      assert.equal(payment.card_rrn, 'IP-9988221');
      const trip = await tripRow(db, 3);
      assert.equal(Number(trip.sales_amount), 200);
      assert.equal(Number(trip.total_instapay_sales), 200);
      const lines = await journalLines(db, 'sale', res.saleId);
      assert.equal(lineFor(lines, 1120).debit, 200, 'non-cash leg debits bank 1120');
      assert.equal(lineFor(lines, 4100).credit, 200, 'revenue leg credits 4100');
      assert.equal(lineFor(lines, 1130).debit, 0, 'paid in full, so no receivable leg');
      console.log('  (3) instapay sale with PIN + reference posts settled_to_bank passed');
    }

    // 4. Vodafone Cash sale, zero evidence: refused exactly like InstaPay.
    {
      await assert.rejects(
        () => service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 4, paymentMethod: 'vodafone_cash',
          items: [{ productId: 104, qty: 2 }],
        }),
        (err: any) => err.code === 'CARD_PAYMENT_REQUIRES_SUPERVISOR_PIN',
        'an unevidenced vodafone_cash sale must be refused',
      );
      assert.equal(await tripSalesCount(db, 4), 0, 'no sale row was written');
      console.log('  (4) vodafone_cash sale without evidence refused passed');
    }

    // 5. Card sale, zero evidence: the pre-existing gate still
    // refuses it (unchanged behaviour).
    {
      await assert.rejects(
        () => service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 5, paymentMethod: 'card',
          items: [{ productId: 105, qty: 2 }],
        }),
        (err: any) => err.code === 'CARD_PAYMENT_REQUIRES_SUPERVISOR_PIN',
        'an unevidenced card sale must still be refused',
      );
      assert.equal(await tripSalesCount(db, 5), 0, 'no sale row was written');
      console.log('  (5) card sale without evidence still refused passed');
    }

    // 6. Card sale, supervisor PIN + reason: still posts (unchanged
    // behaviour — the approval note remains the fallback reference
    // on the card leg).
    {
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 6, paymentMethod: 'card',
        supervisorOverridePin: SUPERVISOR_PIN, supervisorOverrideReason: 'RRN-123456',
        items: [{ productId: 106, qty: 2 }],
      });
      assert.equal(res.total, 200);
      const sale = await saleRow(db, res.saleId);
      assert.equal(sale.collection_status, 'settled_to_bank');
      const payment = await (db as any).selectFrom('sale_payments').select(['amount', 'payment_channel']).where('sale_id', '=', res.saleId).executeTakeFirstOrThrow() as any;
      assert.equal(Number(payment.amount), 200);
      assert.equal(payment.payment_channel, 'card');
      console.log('  (6) card sale with PIN + reason still posts passed');
    }

    // 7. Cash sale, no evidence at all: untouched by the gate.
    {
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 7, paymentMethod: 'cash',
        items: [{ productId: 107, qty: 2 }],
      });
      assert.equal(res.total, 200);
      const sale = await saleRow(db, res.saleId);
      assert.equal(sale.collection_status, 'prepaid_by_rep');
      console.log('  (7) cash sale without evidence still posts passed');
    }

    // 8. InstaPay collection, zero evidence: refused, and the
    // customer balance, the payments table and the journal are all
    // untouched — no bank 1120 debit for an unevidenced collection.
    {
      clearCollectionCaches();
      const journalsBefore = await journalCount(db, 'van_field_collection');
      const paymentsBefore = await paymentsCount(db);
      await assert.rejects(
        () => service.recordFieldCollection(1, TENANT, ACCOUNT, {
          tripId: 8, customerId: 7, amount: 150, paymentMethod: 'instapay',
        }),
        (err: any) => err.code === 'CARD_PAYMENT_REQUIRES_SUPERVISOR_PIN',
        'an unevidenced instapay collection must be refused',
      );
      assert.equal(await customerBalance(db, 7), 500, 'customer balance untouched');
      assert.equal(await paymentsCount(db), paymentsBefore, 'no customer_payments row was written');
      assert.equal(await journalCount(db, 'van_field_collection'), journalsBefore, 'no collection journal was posted');
      const trip = await tripRow(db, 8);
      assert.equal(Number(trip.total_instapay_collections), 0, 'trip instapay total untouched');
      assert.equal(Number(trip.cash_collected), 0, 'trip cash total untouched');
      console.log('  (8) instapay collection without evidence refused passed');
    }

    // 9. InstaPay collection, supervisor PIN but no reference:
    // refused with the reference code — the collection leg has no
    // invented fallback reference.
    {
      clearCollectionCaches();
      const paymentsBefore = await paymentsCount(db);
      await assert.rejects(
        () => service.recordFieldCollection(1, TENANT, ACCOUNT, {
          tripId: 9, customerId: 8, amount: 150, paymentMethod: 'instapay',
          supervisorOverridePin: SUPERVISOR_PIN,
        }),
        (err: any) => err.code === 'CARD_PAYMENT_REFERENCE_REQUIRED',
        'an instapay collection with PIN but no reference must be refused',
      );
      assert.equal(await customerBalance(db, 8), 500, 'customer balance untouched');
      assert.equal(await paymentsCount(db), paymentsBefore, 'no customer_payments row was written');
      console.log('  (9) instapay collection with PIN but no reference refused passed');
    }

    // 10. InstaPay collection, wrong supervisor PIN: the PIN
    // verification itself fails closed before the gate is reached.
    {
      clearCollectionCaches();
      await assert.rejects(
        () => service.recordFieldCollection(1, TENANT, ACCOUNT, {
          tripId: 10, customerId: 9, amount: 150, paymentMethod: 'instapay',
          supervisorOverridePin: '9999', transferReference: 'IP-7788',
        }),
        (err: any) => err.code === 'INVALID_SUPERVISOR_PIN',
        'a wrong supervisor PIN must fail closed',
      );
      assert.equal(await customerBalance(db, 9), 500, 'customer balance untouched');
      console.log('  (10) instapay collection with wrong PIN refused passed');
    }

    // 11. InstaPay collection, supervisor PIN + transfer reference:
    // posts — the customer balance drops, the payment row carries the
    // reference, the trip instapay total rises, and the journal debits
    // bank 1120 / credits receivable 1130.
    {
      clearCollectionCaches();
      const journalsBefore = await journalCount(db, 'van_field_collection');
      const res = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 11, customerId: 10, amount: 150, paymentMethod: 'instapay',
        supervisorOverridePin: SUPERVISOR_PIN, transferReference: 'IP-7788',
      });
      assert.equal(res.ok, true);
      assert.equal(res.amount, 150);
      assert.equal(await customerBalance(db, 10), 350, '150 collected off the 500 balance');
      const payment = await (db as any).selectFrom('customer_payments').select(['amount', 'transfer_reference', 'payment_channel']).where('customer_id', '=', 10).executeTakeFirstOrThrow() as any;
      assert.equal(Number(payment.amount), 150);
      assert.equal(payment.transfer_reference, 'IP-7788');
      assert.equal(payment.payment_channel, 'instapay');
      const trip = await tripRow(db, 11);
      assert.equal(Number(trip.total_instapay_collections), 150);
      assert.equal(Number(trip.cash_collected), 0, 'an electronic collection never lands in cash_collected');
      assert.equal(await journalCount(db, 'van_field_collection'), journalsBefore + 1, 'exactly one collection journal posted');
      // source_id on the collection journal is the payment id, not
      // the journal entry id — look the payment up first.
      const paymentRow = await (db as any).selectFrom('customer_payments').select(['id']).where('customer_id', '=', 10).executeTakeFirstOrThrow() as any;
      const lines = await journalLines(db, 'van_field_collection', Number(paymentRow.id));
      assert.equal(lineFor(lines, 1120).debit, 150, 'bank 1120 debited for the evidenced collection');
      assert.equal(lineFor(lines, 1130).credit, 150, 'receivable 1130 credited');
      console.log('  (11) instapay collection with PIN + reference posts to bank 1120 passed');
    }

    // 12. Vodafone Cash collection with evidence: posts the same way.
    {
      clearCollectionCaches();
      const journalsBefore = await journalCount(db, 'van_field_collection');
      const res = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 12, customerId: 11, amount: 100, paymentMethod: 'vodafone_cash',
        supervisorOverridePin: SUPERVISOR_PIN, transferReference: 'VF-12345',
      });
      assert.equal(res.ok, true);
      assert.equal(await customerBalance(db, 11), 400, '100 collected off the 500 balance');
      assert.equal(await journalCount(db, 'van_field_collection'), journalsBefore + 1, 'exactly one collection journal posted');
      const paymentRow = await (db as any).selectFrom('customer_payments').select(['id']).where('customer_id', '=', 11).executeTakeFirstOrThrow() as any;
      const lines = await journalLines(db, 'van_field_collection', Number(paymentRow.id));
      assert.equal(lineFor(lines, 1120).debit, 100, 'bank 1120 debited for the evidenced vodafone collection');
      assert.equal(lineFor(lines, 1130).credit, 100, 'receivable 1130 credited');
      console.log('  (12) vodafone_cash collection with PIN + reference posts passed');
    }

    // 13. Cash collection, no evidence at all: untouched by the gate
    // — and its journal never touches bank 1120.
    {
      clearCollectionCaches();
      const journalsBefore = await journalCount(db, 'van_field_collection');
      const res = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 13, customerId: 12, amount: 100,
      });
      assert.equal(res.ok, true);
      assert.equal(await customerBalance(db, 12), 400, '100 collected off the 500 balance');
      assert.equal(await journalCount(db, 'van_field_collection'), journalsBefore + 1, 'exactly one collection journal posted');
      const paymentRow = await (db as any).selectFrom('customer_payments').select(['id']).where('customer_id', '=', 12).executeTakeFirstOrThrow() as any;
      const lines = await journalLines(db, 'van_field_collection', Number(paymentRow.id));
      assert.equal(lineFor(lines, 1130).debit, 100, 'cash collection debits the pooled receivable, not the bank');
      assert.equal(lineFor(lines, 1130).credit, 100, 'receivable 1130 credited');
      assert.equal(lineFor(lines, 1120).debit, 0, 'no bank 1120 debit for a cash collection');
      console.log('  (13) cash collection without evidence still posts passed');
    }

    // 14. Source pins: the invariant name is present at every
    // enforcement point, the collection DTO carries the supervisor
    // PIN, and the posting call hands the reference over.
    {
      const here = __dirname;
      // Split 2 of 5 moved the sale gate to the field-sales service; split 3
      // of 5 moved the collection gate to the collections service. The facade
      // no longer names the invariant.
      const fieldSalesSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-field-sales.service.ts'), 'utf8');
      const collectionsSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-collections-and-swaps.service.ts'), 'utf8');
      assert.ok(collectionsSource.includes('INV-VAN-FIELD-NONCASH-EVIDENCE-GATE'), 'van-sales names the invariant');
      assert.ok(fieldSalesSource.includes('(isCard || isInstapay) && totalSale > 0'), 'the sale gate covers instapay');
      assert.ok(collectionsSource.includes('isNonCashCollection'), 'the collection gate exists');
      assert.ok(collectionsSource.includes('transferReference: payload.transferReference'), 'the posting call hands the reference over');
      const postingSource = readFileSync(resolve(here, '../../src/modules/accounting/services/van-and-delivery-posting.service.ts'), 'utf8');
      assert.ok(postingSource.includes('INV-VAN-FIELD-NONCASH-EVIDENCE-GATE'), 'the posting service names the invariant');
      assert.ok(postingSource.includes('transferReference?: string'), 'the posting takes a transfer reference');
      const controllerSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.controller.ts'), 'utf8');
      const collectionsAt = controllerSource.indexOf("@Post('collections')");
      assert.ok(collectionsAt > 0, 'the collections endpoint exists');
      assert.ok(controllerSource.slice(collectionsAt, collectionsAt + 900).includes('supervisorOverridePin?: string'), 'the collections DTO carries the supervisor PIN');
      console.log('  source pins passed');
    }

    console.log('van-field-noncash-evidence: all cases passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(async () => {
    console.log('van-field-noncash-evidence: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
