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
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Van field-return carton quantity (INV-VAN-FIELD-RETURN-CARTON-QTY).
 *
 * THE GAP: the sale and the return disagree on the unit of `qty`, and
 * the return approval never converts. A van sale stores
 * sale_items.qty in SALE units (2 cartons, unit_price 144, unit_name
 * 'كرتونة', unit_multiplier 12) and deducts stock in PIECES
 * (baseQty = qty x multiplier). The linked return of 1 CARTON
 * (VRET-261113-0001, live trial test10k 2026-11-13) approved with
 * the raw qty: van stock gained +1 PIECE instead of +12 — 11 pieces
 * of stock lost. Money was coincidentally right (1 x 144 = 12 x 12),
 * the quantity was wrong.
 *
 * THE RULE: carry the unit through — do NOT store pieces at submit.
 * The approval posts stock as delta = qty x unitMultiplier taken
 * from the matched DB sale line (never the client value) and
 * unitCost = price / multiplier (per-piece price), so the movement
 * value is unchanged (12 x 12 = 144) while the quantity is right.
 * itemsWithCost keeps SALE-unit qty: postVanFieldReturn's COGS
 * mirror expects sold units and converts to base units itself via
 * each line's own multiplier (residualCogsGroups) — passing pieces
 * there would 12x the COGS reversal. The provenance re-checks still
 * compare qty against soldQty in sale units, so a pieces-qty of 12
 * would (correctly) throw RETURN_QTY_EXCEEDS_SOLD against soldQty 2.
 * The eligible-sales items also carry unitMultiplier/unitName now,
 * so the form can show the unit it returns in.
 *
 * HARNESS: the real VanReturnsService + the real
 * AccountingPostingService on PGlite, same harness as
 * van-field-return-cogs-residual-mirror.spec.ts (tenant foundation
 * stubbed no-op; the approval opens its own transaction on the
 * injected handle, so the PGlite single-connection hang does not
 * apply). Stock is seeded directly at its post-sale state.
 *
 * WHAT THIS PINS, driving the REAL approveFieldReturn:
 * - Case 1: linked return of 1 carton (qty 1, unit 144, multiplier
 *   12) from a 2-carton sale -> van stock 46 -> 58 pieces,
 *   stock_movements.qty = +12, unit_cost 12, total_cost 144; the
 *   COGS mirror still reverses exactly 12 x 8 = 96 (sale units in,
 *   pieces out — the mirror is NOT 12x'd).
 * - Case 2: linked return of both cartons (qty 2) -> stock 70; a
 *   further return of qty 1 is rejected (RETURN_QTY_EXCEEDS_SOLD)
 *   — provenance still counts in sale units.
 * - Case 3: piece sale (multiplier 1) return is unchanged: return
 *   3 pieces -> stock +3, movement +3 at unit_cost 12.
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
    CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, tenant_id text, product_id bigint, product_name text, qty numeric, line_total numeric, cost_price numeric, unit_multiplier numeric, unit_name text, modifiers jsonb);
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
  unitName?: string;
};

async function seedWorld(
  db: Kysely<Database>,
  opts: {
    currency: string;
    currentCost: number;
    saleTotal: number;
    saleLines: SaleLineSeed[];
    postSaleStock: number;
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
    id: 5, tenant_id: 't1', account_id: 'a1', name: 'Shop', balance: opts.saleTotal,
  } as never).execute();
  await db.insertInto('van_sales_trips' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', status: 'open', van_location_id: 900,
    source_warehouse_id: null, rep_id: 7, cash_collected: 1000, cash_refunds: 0, returns_amount: 0,
  } as never).execute();
  await db.insertInto('sales' as never).values({
    id: 1, tenant_id: 't1', doc_no: 'S-1', customer_id: 5, subtotal: opts.saleTotal,
    discount: 0, tax_amount: 0, total: opts.saleTotal, paid_amount: 0, store_credit_used: 0,
    exchange_return_id: null, branch_id: null, location_id: null, created_by: 1, created_at: new Date(),
    delivery_fee: 0, delivery_fee_mode: null, service_charge: 0, tip_amount: 0, prices_include_tax: false,
    sale_origin: 'van', payment_type: 'credit', collection_status: 'paid', status: 'posted',
    delivery_rep_id: null, van_trip_id: 1,
  } as never).execute();
  for (const line of opts.saleLines) {
    await db.insertInto('sale_items' as never).values({
      id: line.id, sale_id: 1, tenant_id: 't1', product_id: line.productId, product_name: 'Widget', qty: line.qty,
      line_total: line.lineTotal, cost_price: line.costPrice,
      unit_multiplier: line.unitMultiplier ?? 1, unit_name: line.unitName ?? 'قطعة', modifiers: JSON.stringify([]),
    } as never).execute();
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

async function returnMovement(db: Kysely<Database>, returnId: number): Promise<{ qty: number; unitCost: number; totalCost: number }> {
  const rows = await (db as any).selectFrom('stock_movements')
    .select(['qty', 'unit_cost as unitCost', 'total_cost as totalCost'])
    .where('reference_type', '=', 'van_field_return').where('reference_id', '=', returnId)
    .where('movement_type', '=', 'van_sale_return')
    .orderBy('id', 'desc').limit(1).execute() as Array<{ qty: string; unitCost: string; totalCost: string }>;
  assert.equal(rows.length, 1, `expected exactly one van_sale_return movement for return ${returnId}`);
  return { qty: Number(rows[0].qty), unitCost: Number(rows[0].unitCost), totalCost: Number(rows[0].totalCost) };
}

async function main(): Promise<void> {
  // Case 1: linked return of 1 carton (qty 1, unit 144, multiplier 12)
  // from a 2-carton sale -> stock 46 -> 58 pieces, movement +12.
  {
    const { pg, db } = await makeDb();
    try {
      const { posting, returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'EGP', currentCost: 8, saleTotal: 288,
        // Frozen sale-line cost is PER SALE UNIT (the writer stores
        // prod.cost_price x multiplier): 8/piece x 12 = 96/carton.
        saleLines: [{ id: 10, productId: 100, qty: 2, lineTotal: 288, costPrice: 96, unitMultiplier: 12, unitName: 'كرتونة' }],
        postSaleStock: 46,
      });
      await postSaleOn(db, posting, 1);
      const saleJournal = await journalByCode(db, 'sale', 1);
      assert.equal(saleJournal.get('5100')?.debit, 192, 'sale COGS is 24 pieces x 8');
      await seedReturn(db, 1, {
        saleId: 1, reason: 'customer_request', totalAmount: 144,
        items: [{ productId: 100, qty: 1, unitPrice: 144, saleItemId: 10 }],
      });
      const approved = await returns.approveFieldReturn('t1', 'a1', 1, 1);
      assert.equal(approved.status, 'approved');
      assert.equal(await locationQty(db, 900), 58, 'van stock gains 12 pieces, not 1');
      const movement = await returnMovement(db, 1);
      assert.equal(movement.qty, 12, 'movement qty is pieces (1 carton x 12)');
      assert.equal(movement.unitCost, 12, 'movement unit cost is the per-piece price (144 / 12)');
      assert.equal(movement.totalCost, 144, 'movement value is unchanged (12 x 12)');
      const ret = await journalByCode(db, 'van_field_return', 1);
      assert.equal(ret.get('1140')?.debit, 96, 'COGS mirror reverses 12 pieces x 8 — not 12x');
      assert.equal(ret.get('5100')?.credit, 96);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: linked return of both cartons -> stock 70; a further
  // return of qty 1 is rejected — provenance still counts sale units.
  {
    const { pg, db } = await makeDb();
    try {
      const { posting, returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'EGP', currentCost: 8, saleTotal: 288,
        saleLines: [{ id: 10, productId: 100, qty: 2, lineTotal: 288, costPrice: 96, unitMultiplier: 12, unitName: 'كرتونة' }],
        postSaleStock: 46,
      });
      await postSaleOn(db, posting, 1);
      await seedReturn(db, 1, {
        saleId: 1, reason: 'customer_request', totalAmount: 288,
        items: [{ productId: 100, qty: 2, unitPrice: 144, saleItemId: 10 }],
      });
      const approved = await returns.approveFieldReturn('t1', 'a1', 1, 1);
      assert.equal(approved.status, 'approved');
      assert.equal(await locationQty(db, 900), 70, 'van stock gains 24 pieces for 2 cartons');
      await seedReturn(db, 2, {
        saleId: 1, reason: 'customer_request', totalAmount: 144,
        items: [{ productId: 100, qty: 1, unitPrice: 144, saleItemId: 10 }],
      });
      await assert.rejects(
        async () => returns.approveFieldReturn('t1', 'a1', 2, 1),
        /RETURN_QTY_EXCEEDS_SOLD/,
      );
      assert.equal(await locationQty(db, 900), 70, 'rejected return moves no stock');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: piece sale (multiplier 1) return is unchanged.
  {
    const { pg, db } = await makeDb();
    try {
      const { posting, returns } = makeServices(db);
      await seedWorld(db, {
        currency: 'EGP', currentCost: 8, saleTotal: 144,
        saleLines: [{ id: 10, productId: 100, qty: 12, lineTotal: 144, costPrice: 8, unitMultiplier: 1, unitName: 'قطعة' }],
        postSaleStock: 34,
      });
      await postSaleOn(db, posting, 1);
      await seedReturn(db, 1, {
        saleId: 1, reason: 'customer_request', totalAmount: 36,
        items: [{ productId: 100, qty: 3, unitPrice: 12, saleItemId: 10 }],
      });
      const approved = await returns.approveFieldReturn('t1', 'a1', 1, 1);
      assert.equal(approved.status, 'approved');
      assert.equal(await locationQty(db, 900), 37, 'piece return gains exactly 3 pieces');
      const movement = await returnMovement(db, 1);
      assert.equal(movement.qty, 3);
      assert.equal(movement.unitCost, 12);
      assert.equal(movement.totalCost, 36);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: source + invariant pins.
  {
    const here = __dirname;
    const returnsSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-returns.service.ts'), 'utf8');
    assert.ok(returnsSource.includes('unit_multiplier'), 'approval must read the sale-line multiplier');
    assert.ok(returnsSource.includes('unitMultiplier'), 'eligible-sales items must carry the multiplier');
    const apiSource = readFileSync(resolve(here, '../../../frontend/src/features/delivery-reps/api/van-sales.api.ts'), 'utf8');
    assert.ok(apiSource.includes('unitMultiplier'), 'CustomerEligibleSaleItem must carry unitMultiplier');
    const invariants = readFileSync(resolve(here, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-VAN-FIELD-RETURN-CARTON-QTY').length - 1, 1, 'the invariant entry must exist exactly once');
  }

  console.log('Van field-return carton quantity tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
