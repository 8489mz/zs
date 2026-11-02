import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { cogsResidualAmount } from '../../src/modules/accounting/engines/cogs-residual.engine';
import { roundMoney } from '../../src/modules/accounting/engines/money-minor-units.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * COGS remainder absorption (INV-COGS-REMAINDER-ABSORPTION).
 *
 * THE GAP: postSale rounded the TOTAL COGS once at book digits.
 * 16 units at 15.3125 = 245.00; selling 10 posted COGS 153.13
 * (153.125 rounded up) while the remaining 6 x 15.3125 = 91.875
 * reconciles to 91.88 — GL 91.87 vs physical 91.88, a one-minor-
 * unit split with both halves rounding up past the whole.
 *
 * THE RULE: the remaining stock value is derived at book digits
 * first, and COGS is the residual (pre-sale value minus
 * remaining value, both rounded at book digits, per product
 * and frozen unit cost), computed in minor units. postSaleEdit
 * re-posts through the same residual (source-shared private
 * method; its end-to-end drive stays with the live-Postgres
 * acceptance run). The remaining quantity is read AFTER the
 * sale's stock movement on the same transaction handle.
 * Digits follow the tenant's settings currency (KWD = 3,
 * EGP = 2) through tenantBaseCurrency, fail closed on a
 * settings/rate mismatch — the same gating as every other
 * book-digits site. Prospective only: already-posted journals
 * keep their COGS legs; no history is re-rounded.
 *
 * WHAT THIS PINS, driving the REAL helper and the REAL
 * postSale through the REAL posting boundary on PGlite
 * (fresh database per case; the tenant foundation service is
 * stubbed to a no-op because foundation seeding is a separate
 * setup path):
 * - Helper: EGP half-unit residual, sold-out identity, KWD
 *   half-unit residual, multi-group sum, fail-closed inputs.
 * - postSale (EGP): 10 sold / 6 remain at 15.3125 posts COGS
 *   153.12 and the remaining GL equals the physical value.
 * - postSale (KWD): 1 sold / 1 remain at 10.0005 posts COGS
 *   10.000 at 3 digits.
 * - postSale sold-out: COGS equals the old total rounding.
 * - postSale multi-line: residuals sum per product.
 * This is not an end-to-end post on live Postgres, and it does
 * not drive postSaleEdit or postSalesReturn end-to-end; the
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
    CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, tenant_id text, product_id bigint, qty numeric, cost_price numeric);
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

async function seedSale(
  db: Kysely<Database>,
  saleId: number,
  total: number,
  items: Array<{ productId: number; qty: number; costPrice: number }>,
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

async function cogsAndInventoryFor(db: Kysely<Database>, saleId: number): Promise<{ cogs: number; inventory: number; totalDebit: number; totalCredit: number }> {
  const entries = await (db as any).selectFrom('journal_entries').select(['id'])
    .where('source_type', '=', 'sale').where('source_id', '=', saleId).execute() as Array<{ id: number }>;
  assert.equal(entries.length, 1, `expected exactly one sale journal for sale ${saleId}`);
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

async function main(): Promise<void> {
  // Case 1: pure helper — residuals and fail-closed inputs.
  {
    assert.equal(cogsResidualAmount([{ qtySold: 10, unitCost: 15.3125, qtyRemaining: 6 }], 2), 153.12);
    assert.equal(cogsResidualAmount([{ qtySold: 10, unitCost: 15.3125, qtyRemaining: 0 }], 2), 153.13);
    assert.equal(cogsResidualAmount([{ qtySold: 1, unitCost: 10.0005, qtyRemaining: 1 }], 3), 10);
    assert.equal(
      cogsResidualAmount([
        { qtySold: 10, unitCost: 15.3125, qtyRemaining: 6 },
        { qtySold: 2, unitCost: 20, qtyRemaining: 3 },
      ], 2),
      193.12,
    );
    assert.throws(() => cogsResidualAmount([{ qtySold: 1, unitCost: Number.NaN, qtyRemaining: 1 }], 2), /Non-finite/);
    assert.throws(() => cogsResidualAmount([{ qtySold: 1, unitCost: 1, qtyRemaining: 1 }], 4 as never), /Invalid book digits/);
  }

  // Case 2: postSale (EGP) — the diagnosed half-unit split.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 200, [{ productId: 100, qty: 10, costPrice: 15.3125 }], [{ productId: 100, qty: 6 }]);
      await postSaleOn(db, 1);
      const posted = await cogsAndInventoryFor(db, 1);
      assert.equal(posted.cogs, 153.12);
      assert.equal(posted.inventory, 153.12);
      assert.equal(posted.totalDebit, posted.totalCredit);
      // Remaining GL equals the physical value exactly: 245.00 - 153.12 = 91.88.
      assert.equal(roundMoney(245 - posted.cogs, 2), roundMoney(6 * 15.3125, 2));
    } finally {
      await db.destroy();
    }
  }

  // Case 3: postSale (KWD) — the same class at 3 digits.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await seedSale(db, 1, 30, [{ productId: 100, qty: 1, costPrice: 10.0005 }], [{ productId: 100, qty: 1 }]);
      await postSaleOn(db, 1);
      const posted = await cogsAndInventoryFor(db, 1);
      assert.equal(posted.cogs, 10);
      assert.equal(posted.inventory, 10);
      assert.equal(posted.totalDebit, posted.totalCredit);
      assert.equal(roundMoney(20.001 - posted.cogs, 3), roundMoney(1 * 10.0005, 3));
    } finally {
      await db.destroy();
    }
  }

  // Case 4: postSale sold-out — residual equals the old total rounding.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 200, [{ productId: 100, qty: 10, costPrice: 15.3125 }], []);
      await postSaleOn(db, 1);
      const posted = await cogsAndInventoryFor(db, 1);
      assert.equal(posted.cogs, 153.13);
      assert.equal(posted.inventory, 153.13);
      assert.equal(posted.totalDebit, posted.totalCredit);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: postSale multi-line — residuals sum per product.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 400, [
        { productId: 100, qty: 10, costPrice: 15.3125 },
        { productId: 200, qty: 2, costPrice: 20 },
      ], [
        { productId: 100, qty: 6 },
        { productId: 200, qty: 3 },
      ]);
      await postSaleOn(db, 1);
      const posted = await cogsAndInventoryFor(db, 1);
      assert.equal(posted.cogs, 193.12);
      assert.equal(posted.inventory, 193.12);
      assert.equal(posted.totalDebit, posted.totalCredit);
    } finally {
      await db.destroy();
    }
  }

  console.log('cogs-remainder-absorption: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
