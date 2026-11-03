import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { roundMoney } from '../../src/modules/accounting/engines/money-minor-units.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * COGS remainder absorption on the sold-unit basis
 * (INV-COGS-REMAINDER-SOLD-UNIT-BASIS, clarifying
 * INV-COGS-REMAINDER-ABSORPTION for multi-unit and modifier sales).
 *
 * THE GAP: saleCogsResidual grouped sale lines by product and frozen
 * cost_price and read the remaining quantity from
 * product_location_stock. cost_price is stored PER SOLD UNIT (frozen
 * WAC x unit_multiplier plus restaurant modifier costs) while the
 * stock quantity is in BASE units, so the residual anchor mixed
 * units: a carton sale re-opened the exact one-minor-unit GL-vs-
 * physical split the remainder absorption had closed. Worked
 * illustration (2dp): WAC 15.3125/piece, carton multiplier 2,
 * frozen cost 30.625/carton, 7 pieces on hand, sell 1 carton,
 * 5 pieces remain — as coded the residual was 30.62 and the
 * remaining GL 76.57 against physical 76.56.
 *
 * THE RULE: the remaining quantity is converted to each group's
 * sold-unit basis before the residual — remaining VALUE at the
 * frozen per-base-unit costs divided by the per-sold-unit frozen
 * cost (with no modifiers this is remaining / unit_multiplier).
 * Restaurant modifier components are anchored at most once per
 * sale at their own frozen WAC (costPrice / consumptionQty from
 * the stored modifiers JSON, plain array or { mods, offer }
 * wrapper), never re-read at current WAC; a component that is
 * itself a sold line is anchored by its own line group only, and
 * a component identical to the parent shares the parent pool.
 * Each product-and-cost group anchors the full remaining
 * quantity, as before: a product sold at two frozen costs in
 * one sale carries one minor unit of anchor rounding per group.
 * The conversion happens in the shared saleCogsResidual read, so
 * postSale and postSaleEdit share it with no forked posting.
 * Prospective only: already-posted journals keep their COGS
 * legs; the sales-return residual mirror is a separate deferred
 * follow-up and must not assume the old base-unit basis.
 *
 * WHAT THIS PINS, driving the REAL postSale (and postSaleEdit)
 * through the REAL posting boundary on PGlite (fresh database
 * per case; the tenant foundation service is stubbed to a no-op
 * because foundation seeding is a separate setup path):
 * - The worked illustration: 1 carton sold, 5 pieces remain,
 *   COGS 30.63 and the remaining GL equals physical 76.56.
 * - The pinned multiplier-1 case unchanged: 10 sold / 6 remain
 *   at 15.3125 posts COGS 153.12.
 * - A restaurant modifier sale: parent WAC 10.3125, component
 *   WAC 2.3125 at 0.25 units per sold unit, COGS 10.90 (the
 *   old base-unit anchor posted 10.89), in both stored modifier
 *   shapes (plain array and the { mods, offer } wrapper).
 * - A 3-decimal (KWD) multi-unit case: COGS 20.001 and the
 *   remaining GL equals physical 50.001.
 * - Multi-group apportionment: the same product sold as a
 *   carton and as pieces anchors its remaining stock in EACH
 *   product-and-cost group, as before (one minor unit of anchor
 *   rounding per group), posting 45.95 against the single-pool
 *   value 45.94; the remaining GL equals physical exactly for
 *   the single-group-per-product cases above.
 * - postSaleEdit re-posts the same sold-unit residual through
 *   the shared read.
 * - A sold-out multi-unit sale equals the old total rounding.
 * This is not an end-to-end post on live Postgres; the
 * live-Postgres acceptance run remains the end-to-end proof.
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, allow_manual_entries boolean, is_control_account boolean, is_receivable boolean, is_payable boolean, is_inventory boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text, customer_id bigint, subtotal numeric, discount numeric, tax_amount numeric, total numeric, paid_amount numeric, store_credit_used numeric, exchange_return_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz, delivery_fee numeric, delivery_fee_mode text, service_charge numeric, tip_amount numeric, prices_include_tax boolean, sale_origin text, payment_type text, collection_status text);
    CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, tenant_id text, product_id bigint, qty numeric, cost_price numeric, unit_multiplier numeric, modifiers jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, tenant_id text, payment_channel text, amount numeric);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 40, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (10, 't1', '1110', 'نقد', 'Cash', 'asset', true, false, NULL, true, false, false, false, false),
      (20, 't1', '1120', 'بنك', 'Bank', 'asset', true, false, NULL, true, false, false, false, false),
      (30, 't1', '1130', 'عملاء', 'Receivables', 'asset', true, false, NULL, true, false, true, false, false),
      (40, 't1', '1140', 'مخزون', 'Inventory', 'asset', true, false, NULL, true, false, false, false, true),
      (50, 't1', '2120', 'ضريبة', 'Tax', 'liability', true, false, NULL, true, false, false, true, false),
      (60, 't1', '4100', 'إيراد', 'Revenue', 'revenue', true, false, NULL, true, false, false, false, false),
      (70, 't1', '4300', 'خصم', 'Discount', 'revenue', true, false, NULL, true, false, false, false, false),
      (80, 't1', '5100', 'تكلفة', 'COGS', 'expense', true, false, NULL, true, false, false, false, false);
  `);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: `"${code}"` } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never).execute();
}

function makePosting(db: Kysely<Database>): AccountingPostingService {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  return new AccountingPostingService(fakeFoundation);
}

type SeedItem = {
  productId: number;
  qty: number;
  costPrice: number;
  unitMultiplier?: number;
  modifiers?: unknown;
};

async function seedSale(
  db: Kysely<Database>,
  saleId: number,
  total: number,
  items: SeedItem[],
  remaining: Array<{ productId: number; qty: number }>,
): Promise<void> {
  await db.insertInto('sales' as never).values({
    id: saleId, tenant_id: 't1', doc_no: `S-${saleId}`, customer_id: null, subtotal: total, discount: 0,
    tax_amount: 0, total, paid_amount: total, store_credit_used: 0, exchange_return_id: null,
    branch_id: null, location_id: null, created_by: 1, created_at: new Date(), delivery_fee: 0,
    delivery_fee_mode: null, service_charge: 0, tip_amount: 0, prices_include_tax: false,
    sale_origin: 'pos', payment_type: 'cash', collection_status: 'paid',
  } as never).execute();
  for (const [index, item] of items.entries()) {
    await db.insertInto('sale_items' as never).values({
      id: saleId * 10 + index, sale_id: saleId, tenant_id: 't1', product_id: item.productId,
      qty: item.qty, cost_price: item.costPrice,
      unit_multiplier: item.unitMultiplier ?? 1,
      modifiers: JSON.stringify(item.modifiers ?? []),
    } as never).execute();
  }
  await db.insertInto('sale_payments' as never).values({
    sale_id: saleId, tenant_id: 't1', payment_channel: 'cash', amount: total,
  } as never).execute();
  for (const stock of remaining) {
    await db.insertInto('product_location_stock' as never).values({
      tenant_id: 't1', account_id: 'a1', product_id: stock.productId, branch_id: null,
      location_id: null, qty: stock.qty, reserved_qty: 0,
    } as never).execute();
  }
}

async function cogsAndInventoryFor(
  db: Kysely<Database>,
  saleId: number,
  sourceType = 'sale',
): Promise<{ cogs: number; inventory: number; totalDebit: number; totalCredit: number }> {
  const entries = await (db as any).selectFrom('journal_entries').select(['id'])
    .where('source_type', '=', sourceType).where('source_id', '=', saleId).execute() as Array<{ id: number }>;
  assert.equal(entries.length, 1, `expected exactly one ${sourceType} journal for sale ${saleId}`);
  const rows = await (db as any).selectFrom('journal_entry_lines')
    .innerJoin('accounting_accounts', 'accounting_accounts.id', 'journal_entry_lines.account_id')
    .select(['accounting_accounts.code as code', 'journal_entry_lines.debit as debit', 'journal_entry_lines.credit as credit'])
    .where('journal_entry_id', '=', entries[0].id)
    .execute() as Array<{ code: string; debit: string; credit: string }>;
  const byCode = new Map(rows.map((row) => [row.code, { debit: Number(row.debit), credit: Number(row.credit) }]));
  return {
    cogs: Number(byCode.get('5100')?.debit || 0),
    inventory: Number(byCode.get('1140')?.credit || 0),
    totalDebit: rows.reduce((sum, row) => sum + Number(row.debit), 0),
    totalCredit: rows.reduce((sum, row) => sum + Number(row.credit), 0),
  };
}

async function postSaleOn(db: Kysely<Database>, saleId: number): Promise<void> {
  const posting = makePosting(db);
  await db.transaction().execute(async (trx) => {
    await posting.postSale(trx as any, saleId, auth);
  });
}

async function postSaleEditOn(db: Kysely<Database>, saleId: number): Promise<void> {
  const posting = makePosting(db);
  await db.transaction().execute(async (trx) => {
    await posting.postSaleEdit(trx as any, saleId, auth);
  });
}

async function main(): Promise<void> {
  // Case 1: the worked illustration — 1 carton sold, 5 pieces remain.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 100,
        [{ productId: 100, qty: 1, costPrice: 30.625, unitMultiplier: 2 }],
        [{ productId: 100, qty: 5 }]);
      await postSaleOn(db, 1);
      const posted = await cogsAndInventoryFor(db, 1);
      assert.equal(posted.cogs, 30.63);
      assert.equal(posted.inventory, 30.63);
      assert.equal(posted.totalDebit, posted.totalCredit);
      // Remaining GL equals the physical value: 107.19 - 30.63 = 76.56.
      assert.equal(roundMoney(107.19 - posted.cogs, 2), roundMoney(5 * 15.3125, 2));
    } finally {
      await db.destroy();
    }
  }

  // Case 2: the pinned multiplier-1 case is unchanged.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 200,
        [{ productId: 100, qty: 10, costPrice: 15.3125, unitMultiplier: 1 }],
        [{ productId: 100, qty: 6 }]);
      await postSaleOn(db, 1);
      const posted = await cogsAndInventoryFor(db, 1);
      assert.equal(posted.cogs, 153.12);
      assert.equal(posted.inventory, 153.12);
      assert.equal(posted.totalDebit, posted.totalCredit);
      assert.equal(roundMoney(245 - posted.cogs, 2), roundMoney(6 * 15.3125, 2));
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a restaurant modifier sale, plain-array modifiers JSON.
  // Parent WAC 10.3125, component WAC 2.3125 at 0.25 units per sold
  // unit: modifier costPrice 0.578125, frozen line cost 10.890625.
  // Sell 1: parent remains 1, component remains 3.75 (of 4).
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 100,
        [{
          productId: 100, qty: 1, costPrice: 10.890625, unitMultiplier: 1,
          modifiers: [{ productId: 200, qty: 1, consumptionQty: 0.25, costPrice: 0.578125, name: 'cheese' }],
        }],
        [{ productId: 100, qty: 1 }, { productId: 200, qty: 3.75 }]);
      await postSaleOn(db, 1);
      const posted = await cogsAndInventoryFor(db, 1);
      assert.equal(posted.cogs, 10.9);
      assert.equal(posted.inventory, 10.9);
      assert.equal(posted.totalDebit, posted.totalCredit);
      // Pre-sale pool 29.88, remaining physical 18.98.
      assert.equal(roundMoney(29.88 - posted.cogs, 2), roundMoney(1 * 10.3125 + 3.75 * 2.3125, 2));
    } finally {
      await db.destroy();
    }
  }

  // Case 4: the same modifier sale, stored in the { mods, offer }
  // wrapper shape the sale writer uses when an offer is present.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 100,
        [{
          productId: 100, qty: 1, costPrice: 10.890625, unitMultiplier: 1,
          modifiers: {
            mods: [{ productId: 200, qty: 1, consumptionQty: 0.25, costPrice: 0.578125, name: 'cheese' }],
            offer: { originalPrice: 20, offerDiscount: 0, offerName: 'deal' },
          },
        }],
        [{ productId: 100, qty: 1 }, { productId: 200, qty: 3.75 }]);
      await postSaleOn(db, 1);
      const posted = await cogsAndInventoryFor(db, 1);
      assert.equal(posted.cogs, 10.9);
      assert.equal(posted.inventory, 10.9);
      assert.equal(posted.totalDebit, posted.totalCredit);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: 3-decimal (KWD) multi-unit sale.
  // WAC 10.00025/piece, carton multiplier 2, frozen cost 20.0005,
  // 7 pieces on hand, sell 1 carton, 5 pieces remain.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await seedSale(db, 1, 100,
        [{ productId: 100, qty: 1, costPrice: 20.0005, unitMultiplier: 2 }],
        [{ productId: 100, qty: 5 }]);
      await postSaleOn(db, 1);
      const posted = await cogsAndInventoryFor(db, 1);
      assert.equal(posted.cogs, 20.001);
      assert.equal(posted.inventory, 20.001);
      assert.equal(posted.totalDebit, posted.totalCredit);
      assert.equal(roundMoney(70.002 - posted.cogs, 3), roundMoney(5 * 10.00025, 3));
    } finally {
      await db.destroy();
    }
  }

  // Case 6: multi-group apportionment — each product-and-cost
  // group anchors the full remaining stock, as before: the carton
  // group posts 30.63 and the piece group posts 15.32, totalling
  // 45.95 against the single-pool value 45.94 (one minor unit of
  // anchor rounding for the second group).
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 200,
        [
          { productId: 100, qty: 1, costPrice: 30.625, unitMultiplier: 2 },
          { productId: 100, qty: 1, costPrice: 15.3125, unitMultiplier: 1 },
        ],
        [{ productId: 100, qty: 5 }]);
      await postSaleOn(db, 1);
      const posted = await cogsAndInventoryFor(db, 1);
      assert.equal(posted.cogs, 45.95);
      assert.equal(posted.inventory, 45.95);
      assert.equal(posted.totalDebit, posted.totalCredit);
      assert.ok(Math.abs(Math.round(posted.cogs * 100) - 4594) <= 1);
    } finally {
      await db.destroy();
    }
  }

  // Case 7: postSaleEdit re-posts the same sold-unit residual
  // through the shared read.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 100,
        [{ productId: 100, qty: 1, costPrice: 30.625, unitMultiplier: 2 }],
        [{ productId: 100, qty: 5 }]);
      await postSaleOn(db, 1);
      await postSaleEditOn(db, 1);
      const edited = await cogsAndInventoryFor(db, 1, 'sale_edit');
      assert.equal(edited.cogs, 30.63);
      assert.equal(edited.inventory, 30.63);
      assert.equal(edited.totalDebit, edited.totalCredit);
    } finally {
      await db.destroy();
    }
  }

  // Case 8: a sold-out multi-unit sale equals the old total rounding.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 100,
        [{ productId: 100, qty: 2, costPrice: 30.625, unitMultiplier: 2 }],
        []);
      await postSaleOn(db, 1);
      const posted = await cogsAndInventoryFor(db, 1);
      assert.equal(posted.cogs, 61.25);
      assert.equal(posted.inventory, 61.25);
      assert.equal(posted.totalDebit, posted.totalCredit);
    } finally {
      await db.destroy();
    }
  }

  console.log('sale-cogs-residual-sold-unit-basis: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
