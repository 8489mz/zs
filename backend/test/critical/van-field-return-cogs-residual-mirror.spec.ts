import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { VanReturnsService } from '../../src/modules/delivery-reps/services/van-returns.service';
import { roundMoney } from '../../src/modules/accounting/engines/money-minor-units.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Van field-return COGS residual mirror (INV-VAN-FIELD-RETURN-COGS-RESIDUAL-MIRROR).
 *
 * THE GAP: postSale posts COGS through saleCogsResidual (remaining value
 * rounded first, COGS is the residual, per product-and-cost group,
 * sold-unit basis), and linked-sale returns reverse through the same
 * grouping since INV-SALES-RETURN-COGS-RESIDUAL-MIRROR — but
 * postVanFieldReturn reversed COGS as one aggregated qty x CURRENT
 * products.cost_price sum rounded once, with no sale link at all.
 * Two divergences, not one: the unit cost is the product's current
 * cost instead of the frozen sale-line cost (unbounded when the cost
 * moved since the sale), and the rounding basis ignores the anchor
 * remainder the sale's COGS carries (one minor unit stranded in 1140
 * per affected return). Worked case (2dp, WAC 15.3125): stock 16 =
 * 245.00; sell 10, remaining 6 x 15.3125 = 91.875 -> 91.88, posted
 * COGS 153.12; field-return 6 -> the plain product reverses 91.88
 * and GL inventory lands at 183.76 against physical 12 x 15.3125 =
 * 183.75. (The grounding note calls this a 3dp case, but at 3dp a
 * 4dp cost does not strand — 91.875 stays 91.875. The 3dp case
 * below therefore uses a 6dp frozen cost, as the P2 mirror's KWD
 * case does, where the plain product strands 0.001.)
 *
 * THE RULE: a LINKED field return (sale_id present, every item
 * resolving to exactly one sale line) reverses COGS through the SAME
 * shared residual grouping at the FROZEN sale-line costs, with the
 * post-sale remaining quantity reconstructed from the post-restock
 * stock read, exactly as the sales-return mirror does. Sequential
 * field returns telescope to the posted COGS, and a full return nets
 * COGS to zero. The legacy plain computation stays for: unlinked
 * returns, damaged-location restock, unresolvable or ambiguous lines
 * (including several sale lines at differing frozen costs with no
 * saleItemId to disambiguate), and a missing sale. A resolved line
 * whose frozen cost is missing or invalid fails closed with
 * VAN_FIELD_RETURN_FROZEN_COST_INVALID instead of silently falling
 * back to the current product cost. A zero frozen cost (prepared
 * composite) contributes nothing. Revenue/tax legs, refund tenders,
 * the customer ledger, trip cash updates, restock, idempotency,
 * entry dating, and branch/location handling are unchanged.
 *
 * WHAT THIS PINS, driving the REAL approveFieldReturn (which opens
 * its own transaction on the injected handle, so the PGlite
 * single-connection hang does not apply) and the REAL
 * postVanFieldReturn through the REAL posting boundary on PGlite
 * (fresh database per case; the tenant foundation service is stubbed
 * to a no-op because foundation seeding is a separate setup path;
 * stock is seeded directly at its post-movement state, as the
 * residual spec does, because the writer moves stock before
 * posting):
 * - The worked case: reversal 91.87, GL inventory 183.75.
 * - Sequential partial returns telescope to the posted COGS.
 * - A full return nets COGS to zero.
 * - An unlinked return keeps the plain computation.
 * - A damaged-location return keeps the plain computation.
 * - An ambiguous differing-cost line keeps the plain computation.
 * - A moved current cost does not move the reversal: the frozen
 *   cost wins.
 * - A zero frozen cost reverses nothing.
 * - A missing frozen cost fails closed with the named error and
 *   rolls the whole approval back.
 * - A 3-decimal (KWD) case with a 6dp frozen cost.
 * This is not an end-to-end post on live Postgres; the live-Postgres
 * acceptance run remains the end-to-end proof, as does the live
 * van-field-returns e2e (which needs a real Postgres connection).
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, allow_manual_entries boolean, is_control_account boolean, is_receivable boolean, is_payable boolean, is_inventory boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text, customer_id bigint, subtotal numeric, discount numeric, tax_amount numeric, total numeric, paid_amount numeric, store_credit_used numeric, exchange_return_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz, delivery_fee numeric, delivery_fee_mode text, service_charge numeric, tip_amount numeric, prices_include_tax boolean, sale_origin text, payment_type text, collection_status text, status text, delivery_rep_id bigint, van_trip_id bigint);
    CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, tenant_id text, product_id bigint, product_name text, qty numeric, line_total numeric, cost_price numeric, unit_multiplier numeric, modifiers jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, tenant_id text, payment_channel text, amount numeric);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, balance numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, branch_id bigint, location_type text, is_active boolean);
    CREATE TABLE van_sales_trips (id bigint PRIMARY KEY, tenant_id text, account_id text, status text, van_location_id bigint, source_warehouse_id bigint, rep_id bigint, cash_collected numeric, cash_refunds numeric, returns_amount numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_field_returns (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, trip_id bigint, rep_id bigint, customer_id bigint, sale_id bigint, status text, return_reason text, refund_method text, total_amount numeric, items_json text, notes text, rejection_reason text, approved_by bigint, approved_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    INSERT INTO accounting_settings (id, tenant_id, cash_account_id, bank_account_id, customer_receivable_account_id, inventory_account_id, sales_revenue_account_id, sales_tax_account_id, cogs_account_id, updated_at) VALUES (1, 't1', 10, 20, 30, 40, 60, 50, 80, NOW());
    INSERT INTO accounting_accounts VALUES
      (10, 't1', '1110', 'نقد', 'Cash', 'asset', true, false, NULL, true, false, false, false, false),
      (20, 't1', '1120', 'بنك', 'Bank', 'asset', true, false, NULL, true, false, false, false, false),
      (30, 't1', '1130', 'عملاء', 'Receivables', 'asset', true, false, NULL, true, false, true, false, false),
      (40, 't1', '1140', 'مخزون', 'Inventory', 'asset', true, false, NULL, true, false, false, false, true),
      (45, 't1', '4400', 'مردودات', 'Sales returns', 'revenue', true, false, NULL, true, false, false, false, false),
      (50, 't1', '2120', 'ضريبة', 'Tax', 'liability', true, false, NULL, true, false, false, true, false),
      (60, 't1', '4100', 'إيراد', 'Revenue', 'revenue', true, false, NULL, true, false, false, false, false),
      (70, 't1', '4300', 'خصم', 'Discount', 'revenue', true, false, NULL, true, false, false, false, false),
      (80, 't1', '5100', 'تكلفة', 'COGS', 'expense', true, false, NULL, true, false, false, false, false),
      (90, 't1', '7290', 'فروق تقريب', 'Rounding', 'expense', true, false, NULL, true, false, false, false, false);
  `);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: `"${code}"` } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never).execute();
}

function makeServices(db: Kysely<Database>): { posting: AccountingPostingService; returns: VanReturnsService } {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  const returns = new VanReturnsService(db as any, posting);
  return { posting, returns };
}

type SaleLineSeed = {
  id: number;
  productId: number;
  qty: number;
  lineTotal: number;
  costPrice: number | null;
  unitMultiplier?: number;
};

async function seedWorld(
  db: Kysely<Database>,
  opts: {
    currency: string;
    currentCost: number;
    saleTotal: number;
    saleLines: SaleLineSeed[];
    postSaleStock: number;
    saleId?: number | null;
  },
): Promise<void> {
  await seedCurrency(db, opts.currency);
  await db.insertInto('stock_locations' as never).values([
    { id: 900, tenant_id: 't1', account_id: 'a1', name: 'Van', branch_id: null, location_type: 'van_stock', is_active: true },
    { id: 901, tenant_id: 't1', account_id: 'a1', name: 'Damaged', branch_id: null, location_type: 'damaged', is_active: true },
  ] as never).execute();
  await db.insertInto('products' as never).values({
    id: 100, tenant_id: 't1', account_id: 'a1', name: 'Widget', stock_qty: opts.postSaleStock, reserved_qty: 0, cost_price: opts.currentCost,
  } as never).execute();
  await db.insertInto('product_location_stock' as never).values({
    tenant_id: 't1', account_id: 'a1', product_id: 100, branch_id: null, location_id: 900, qty: opts.postSaleStock, reserved_qty: 0,
  } as never).execute();
  await db.insertInto('customers' as never).values({
    // INV-VAN-RETURN-METHOD-MATCH: the fixture models the balance a
    // posted credit sale of saleTotal leaves in production (the sale
    // writer raises customers.balance by the credit leg), so the
    // approval-time balance floor sees the real world, not a 0.
    id: 5, tenant_id: 't1', account_id: 'a1', name: 'Shop', balance: opts.saleTotal,
  } as never).execute();
  await db.insertInto('van_sales_trips' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', status: 'open', van_location_id: 900,
    source_warehouse_id: null, rep_id: 7, cash_collected: 1000, cash_refunds: 0, returns_amount: 0,
  } as never).execute();
  const saleId = opts.saleId === undefined ? 1 : opts.saleId;
  if (saleId != null) {
    await db.insertInto('sales' as never).values({
      id: saleId, tenant_id: 't1', doc_no: `S-${saleId}`, customer_id: 5, subtotal: opts.saleTotal,
      // INV-VAN-RETURN-METHOD-MATCH: an unpaid credit sale carries
      // paid_amount 0 and no sale_payments row — the sale writer sets
      // paid_amount only for card/InstaPay, and postSale (like the
      // refund-leg resolution) reads the receivable as
      // total - paid_amount - store_credit_used. The old seed set
      // paid_amount to the full total plus a cash settlement row,
      // which described a fully-paid sale (receivable 0) and made
      // every credit refund look like a refund of money nobody owes.
      discount: 0, tax_amount: 0, total: opts.saleTotal, paid_amount: 0, store_credit_used: 0,
      exchange_return_id: null, branch_id: null, location_id: null, created_by: 1, created_at: new Date(),
      delivery_fee: 0, delivery_fee_mode: null, service_charge: 0, tip_amount: 0, prices_include_tax: false,
      sale_origin: 'van', payment_type: 'credit', collection_status: 'paid', status: 'posted',
      delivery_rep_id: null, van_trip_id: 1,
    } as never).execute();
    for (const line of opts.saleLines) {
      await db.insertInto('sale_items' as never).values({
        id: line.id, sale_id: saleId, tenant_id: 't1', product_id: line.productId, product_name: 'Widget', qty: line.qty,
        line_total: line.lineTotal, cost_price: line.costPrice,
        unit_multiplier: line.unitMultiplier ?? 1, modifiers: JSON.stringify([]),
      } as never).execute();
    }
  }
}

async function seedReturn(
  db: Kysely<Database>,
  returnId: number,
  opts: {
    saleId: number | null;
    reason: string;
    totalAmount: number;
    items: Array<{ productId: number; qty: number; unitPrice: number; saleItemId?: number }>;
  },
): Promise<void> {
  await db.insertInto('van_field_returns' as never).values({
    id: returnId, tenant_id: 't1', account_id: 'a1', doc_no: `FR-${returnId}`, trip_id: 1, rep_id: 7,
    customer_id: 5, sale_id: opts.saleId, status: 'pending_approval', return_reason: opts.reason,
    refund_method: 'credit', total_amount: opts.totalAmount, items_json: JSON.stringify(opts.items),
    notes: null, rejection_reason: null, approved_by: null, approved_at: null,
  } as never).execute();
}

async function postSaleOn(db: Kysely<Database>, posting: AccountingPostingService, saleId: number): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await posting.postSale(trx as any, saleId, auth);
  });
}

async function journalByCode(
  db: Kysely<Database>,
  sourceType: string,
  sourceId: number,
): Promise<Map<string, { debit: number; credit: number }>> {
  const entries = await (db as any).selectFrom('journal_entries').select(['id'])
    .where('source_type', '=', sourceType).where('source_id', '=', sourceId).execute() as Array<{ id: number }>;
  assert.equal(entries.length, 1, `expected exactly one ${sourceType} journal for ${sourceId}`);
  const rows = await (db as any).selectFrom('journal_entry_lines')
    .innerJoin('accounting_accounts', 'accounting_accounts.id', 'journal_entry_lines.account_id')
    .select(['accounting_accounts.code as code', 'journal_entry_lines.debit as debit', 'journal_entry_lines.credit as credit'])
    .where('journal_entry_id', '=', entries[0].id)
    .execute() as Array<{ code: string; debit: string; credit: string }>;
  const byCode = new Map<string, { debit: number; credit: number }>();
  for (const row of rows) {
    byCode.set(row.code, { debit: Number(row.debit), credit: Number(row.credit) });
  }
  const totalDebit = rows.reduce((sum, row) => sum + Number(row.debit), 0);
  const totalCredit = rows.reduce((sum, row) => sum + Number(row.credit), 0);
  assert.equal(totalDebit, totalCredit, 'return journal must balance');
  return byCode;
}

async function locationQty(db: Kysely<Database>, locationId: number): Promise<number> {
  const rows = await (db as any).selectFrom('product_location_stock')
    .select(['qty']).where('tenant_id', '=', 't1').where('product_id', '=', 100)
    .where('location_id', '=', locationId).execute() as Array<{ qty: string }>;
  return rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
}

async function main(): Promise<void> {
  // Case 1: the grounding's worked case — sell 10, field-return 6.
  {
    const { pg, db } = await makeDb();
    try {
      const { posting, returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'EGP', currentCost: 15.3125, saleTotal: 200,
        saleLines: [{ id: 10, productId: 100, qty: 10, lineTotal: 200, costPrice: 15.3125 }],
        postSaleStock: 6,
      });
      await postSaleOn(db, posting, 1);
      const saleJournal = await journalByCode(db, 'sale', 1);
      assert.equal(saleJournal.get('5100')?.debit, 153.12);
      await seedReturn(db, 1, {
        saleId: 1, reason: 'customer_request', totalAmount: 120,
        items: [{ productId: 100, qty: 6, unitPrice: 20, saleItemId: 10 }],
      });
      const approved = await returns.approveFieldReturn('t1', 'a1', 1, 1);
      assert.equal(approved.status, 'approved');
      const ret = await journalByCode(db, 'van_field_return', 1);
      assert.equal(ret.get('4100')?.debit, 120);
      assert.equal(ret.get('1130')?.credit, 120);
      // The legacy plain product reverses 91.88 and strands the unit;
      // the mirror reverses 91.87.
      assert.equal(roundMoney(6 * 15.3125, 2), 91.88);
      assert.equal(ret.get('1140')?.debit, 91.87);
      assert.equal(ret.get('5100')?.credit, 91.87);
      assert.equal(await locationQty(db, 900), 12);
      // GL inventory equals physical: 245.00 - 153.12 + 91.87 = 183.75.
      assert.equal(roundMoney(245 - 153.12 + 91.87, 2), roundMoney(12 * 15.3125, 2));
    } finally {
      await db.destroy();
    }
  }

  // Case 2: sequential partial field returns telescope to the posted COGS.
  {
    const { pg, db } = await makeDb();
    try {
      const { posting, returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'EGP', currentCost: 15.3125, saleTotal: 200,
        saleLines: [{ id: 10, productId: 100, qty: 10, lineTotal: 200, costPrice: 15.3125 }],
        postSaleStock: 6,
      });
      await postSaleOn(db, posting, 1);
      await seedReturn(db, 1, {
        saleId: 1, reason: 'customer_request', totalAmount: 80,
        items: [{ productId: 100, qty: 4, unitPrice: 20, saleItemId: 10 }],
      });
      await returns.approveFieldReturn('t1', 'a1', 1, 1);
      const first = await journalByCode(db, 'van_field_return', 1);
      assert.equal(first.get('1140')?.debit, 61.25);
      assert.equal(await locationQty(db, 900), 10);
      await seedReturn(db, 2, {
        saleId: 1, reason: 'customer_request', totalAmount: 120,
        items: [{ productId: 100, qty: 6, unitPrice: 20, saleItemId: 10 }],
      });
      await returns.approveFieldReturn('t1', 'a1', 2, 1);
      const second = await journalByCode(db, 'van_field_return', 2);
      assert.equal(second.get('1140')?.debit, 91.87);
      assert.equal(roundMoney(61.25 + 91.87, 2), 153.12);
      assert.equal(await locationQty(db, 900), 16);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a full field return nets COGS to zero.
  {
    const { pg, db } = await makeDb();
    try {
      const { posting, returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'EGP', currentCost: 15.3125, saleTotal: 200,
        saleLines: [{ id: 10, productId: 100, qty: 10, lineTotal: 200, costPrice: 15.3125 }],
        postSaleStock: 6,
      });
      await postSaleOn(db, posting, 1);
      await seedReturn(db, 1, {
        saleId: 1, reason: 'customer_request', totalAmount: 200,
        items: [{ productId: 100, qty: 10, unitPrice: 20, saleItemId: 10 }],
      });
      await returns.approveFieldReturn('t1', 'a1', 1, 1);
      const ret = await journalByCode(db, 'van_field_return', 1);
      assert.equal(ret.get('1140')?.debit, 153.12);
      assert.equal(ret.get('5100')?.credit, 153.12);
      assert.equal(roundMoney(245 - 153.12 + 153.12, 2), 245);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: an unlinked return keeps the plain computation.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'EGP', currentCost: 16, saleTotal: 200,
        saleLines: [{ id: 10, productId: 100, qty: 10, lineTotal: 200, costPrice: 15.3125 }],
        postSaleStock: 6,
      });
      await seedReturn(db, 1, {
        saleId: null, reason: 'customer_request', totalAmount: 40,
        items: [{ productId: 100, qty: 2, unitPrice: 20 }],
      });
      await returns.approveFieldReturn('t1', 'a1', 1, 1);
      const ret = await journalByCode(db, 'van_field_return', 1);
      assert.equal(ret.get('1140')?.debit, 32);
      assert.equal(ret.get('5100')?.credit, 32);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: a damaged-location return keeps the plain computation and restocks damaged.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'EGP', currentCost: 16, saleTotal: 200,
        saleLines: [{ id: 10, productId: 100, qty: 10, lineTotal: 200, costPrice: 15.3125 }],
        postSaleStock: 6,
      });
      await seedReturn(db, 1, {
        saleId: 1, reason: 'damaged', totalAmount: 120,
        items: [{ productId: 100, qty: 6, unitPrice: 20, saleItemId: 10 }],
      });
      await returns.approveFieldReturn('t1', 'a1', 1, 1);
      const ret = await journalByCode(db, 'van_field_return', 1);
      assert.equal(ret.get('1140')?.debit, 96);
      assert.equal(ret.get('5100')?.credit, 96);
      assert.equal(await locationQty(db, 900), 6);
      assert.equal(await locationQty(db, 901), 6);
    } finally {
      await db.destroy();
    }
  }

  // Case 6: an ambiguous differing-cost line (no saleItemId, two frozen
  // costs) keeps the plain computation.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'EGP', currentCost: 15.3125, saleTotal: 200,
        saleLines: [
          { id: 10, productId: 100, qty: 5, lineTotal: 100, costPrice: 15.3125 },
          { id: 11, productId: 100, qty: 5, lineTotal: 100, costPrice: 15.5 },
        ],
        postSaleStock: 6,
      });
      await seedReturn(db, 1, {
        saleId: 1, reason: 'customer_request', totalAmount: 40,
        items: [{ productId: 100, qty: 2, unitPrice: 20 }],
      });
      await returns.approveFieldReturn('t1', 'a1', 1, 1);
      const ret = await journalByCode(db, 'van_field_return', 1);
      assert.equal(ret.get('1140')?.debit, 30.63);
      assert.equal(ret.get('5100')?.credit, 30.63);
    } finally {
      await db.destroy();
    }
  }

  // Case 7: a moved current cost does not move the reversal — the frozen cost wins.
  {
    const { pg, db } = await makeDb();
    try {
      const { posting, returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'EGP', currentCost: 16, saleTotal: 200,
        saleLines: [{ id: 10, productId: 100, qty: 10, lineTotal: 200, costPrice: 15.3125 }],
        postSaleStock: 6,
      });
      await postSaleOn(db, posting, 1);
      await seedReturn(db, 1, {
        saleId: 1, reason: 'customer_request', totalAmount: 120,
        items: [{ productId: 100, qty: 6, unitPrice: 20, saleItemId: 10 }],
      });
      await returns.approveFieldReturn('t1', 'a1', 1, 1);
      const ret = await journalByCode(db, 'van_field_return', 1);
      // The plain product at the moved current cost would reverse 96.00.
      assert.equal(roundMoney(6 * 16, 2), 96);
      assert.equal(ret.get('1140')?.debit, 91.87);
      assert.equal(ret.get('5100')?.credit, 91.87);
    } finally {
      await db.destroy();
    }
  }

  // Case 8: a zero frozen cost (prepared composite) reverses nothing.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'EGP', currentCost: 10, saleTotal: 200,
        saleLines: [{ id: 10, productId: 100, qty: 10, lineTotal: 200, costPrice: 0 }],
        postSaleStock: 6,
      });
      await seedReturn(db, 1, {
        saleId: 1, reason: 'customer_request', totalAmount: 40,
        items: [{ productId: 100, qty: 2, unitPrice: 20, saleItemId: 10 }],
      });
      await returns.approveFieldReturn('t1', 'a1', 1, 1);
      const ret = await journalByCode(db, 'van_field_return', 1);
      assert.equal(ret.get('4100')?.debit, 40);
      assert.equal(ret.get('1130')?.credit, 40);
      assert.equal(ret.get('1140'), undefined);
      assert.equal(ret.get('5100'), undefined);
    } finally {
      await db.destroy();
    }
  }

  // Case 9: a missing frozen cost fails closed with the named error and rolls back.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'EGP', currentCost: 10, saleTotal: 200,
        saleLines: [{ id: 10, productId: 100, qty: 10, lineTotal: 200, costPrice: null }],
        postSaleStock: 6,
      });
      await seedReturn(db, 1, {
        saleId: 1, reason: 'customer_request', totalAmount: 40,
        items: [{ productId: 100, qty: 2, unitPrice: 20, saleItemId: 10 }],
      });
      await assert.rejects(
        () => returns.approveFieldReturn('t1', 'a1', 1, 1),
        (err: any) => err.code === 'VAN_FIELD_RETURN_FROZEN_COST_INVALID',
        'a missing frozen cost must fail closed, never fall back to the current cost',
      );
      const pending = await (db as any).selectFrom('van_field_returns').select(['status'])
        .where('id', '=', 1).executeTakeFirst();
      assert.equal(pending.status, 'pending_approval');
      assert.equal(await locationQty(db, 900), 6);
      const entries = await (db as any).selectFrom('journal_entries').select(['id'])
        .where('source_type', '=', 'van_field_return').execute();
      assert.equal(entries.length, 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 10: 3-decimal (KWD) case with a 6dp frozen cost.
  {
    const { pg, db } = await makeDb();
    try {
      const { posting, returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'KWD', currentCost: 15.31255, saleTotal: 200,
        saleLines: [{ id: 10, productId: 100, qty: 10, lineTotal: 200, costPrice: 15.31255 }],
        postSaleStock: 6,
      });
      await postSaleOn(db, posting, 1);
      const saleJournal = await journalByCode(db, 'sale', 1);
      assert.equal(saleJournal.get('5100')?.debit, 153.126);
      await seedReturn(db, 1, {
        saleId: 1, reason: 'customer_request', totalAmount: 120,
        items: [{ productId: 100, qty: 6, unitPrice: 20, saleItemId: 10 }],
      });
      await returns.approveFieldReturn('t1', 'a1', 1, 1);
      const ret = await journalByCode(db, 'van_field_return', 1);
      assert.equal(ret.get('1140')?.debit, 91.876);
      assert.equal(ret.get('5100')?.credit, 91.876);
      // The legacy plain product would reverse 91.875 and strand 0.001.
      assert.equal(roundMoney(245.001 - 153.126 + 91.876, 3), roundMoney(12 * 15.31255, 3));
    } finally {
      await db.destroy();
    }
  }

  // Case 11: source + invariant pins.
  {
    const here = __dirname;
    const postingSource = readFileSync(resolve(here, '../../src/modules/accounting/accounting-posting.service.ts'), 'utf8');
    assert.ok(postingSource.includes('vanFieldReturnCogsAmount'), 'the van field-return mirror must exist');
    assert.ok(postingSource.includes('salesReturnCogsResidual'), 'the mirror must reuse the shared residual grouping');
    assert.ok(postingSource.includes('VAN_FIELD_RETURN_FROZEN_COST_INVALID'), 'the named fail-closed error must exist');
    const returnsSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-returns.service.ts'), 'utf8');
    assert.ok(returnsSource.includes('saleId:'), 'approval must pass the sale link to the posting method');
    assert.ok(returnsSource.includes('isDamaged'), 'approval must pass the damaged flag to the posting method');
    assert.ok(returnsSource.includes('saleItemId'), 'approval must pass the per-item sale-line link');
    const invariants = readFileSync(resolve(here, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-VAN-FIELD-RETURN-COGS-RESIDUAL-MIRROR').length - 1, 1, 'the invariant entry must exist exactly once');
  }

  console.log('Van field-return COGS residual mirror tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
