import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';
import { stockMovementTotal } from '../../src/modules/catalog/engines/stock-movement-total.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Catalog stock-movement totals at book digits (INV-CATALOG-STOCK-TOTALS-BOOK-DIGITS).
 *
 * THE GAP: every catalog site that stored a stock_movements.total_cost
 * row rounded qty x unit cost with a hardcoded two-decimal helper
 * (Number(n.toFixed(2))), and postOpeningStock rounded its journal
 * amount the same way before posting through the boundary. The
 * boundary re-rounds journal lines at book digits and
 * postInventoryAdjustment reads the stored total verbatim
 * (re-rounded at book digits), so the two-decimal pre-round baked
 * the same 0.005 error into BOTH the stored row and the journal for
 * three-decimal tenants: 3 x 33.375 = 100.125 was stored and posted
 * as 100.13. The file contained zero currency/digits occurrences.
 *
 * THE RULE: one pure computation, stockMovementTotal(qty, unitCost,
 * bookDigits), feeds the stored movement total and the opening-stock
 * journal at book digits. Digits resolve on the caller's own
 * transaction handle via tenantBaseCurrency + currencyMoneyDigits
 * and fail closed on a base-currency/rate mismatch. Sub-minor
 * products round leniently at book digits (derived values, like
 * every other P0 package). Prospective only: already-posted rows
 * keep their stored amounts.
 *
 * DELIBERATELY UNCHANGED, as separate scope:
 * - comboOriginalPrice display shaping (RETURN-only).
 * (Variant-consolidation legs used to be excluded here pending a
 * valuation decision; since INV-VARIANT-CONSOLIDATION-BOOK-DIGITS
 * they use the single computation too — each leg keeps its own
 * unit cost, only the rounding granularity changed, and the
 * valuation question itself stays open.)
 * - The frontend archive-confirm dialog's display estimate.
 * - products.cost_price / stock_movements.unit_cost stay as
 *   supplied (raw cost); only the total is rounded.
 *
 * FLOAT ORDER: roundMoney rounds the binary float product, so the
 * cases below use exact-binary examples and pin identity with the
 * canonical engine, not decimal-half behavior.
 *
 * WHAT THIS PINS, driving the REAL helper, the REAL
 * CatalogProductService.postOpeningStock through the REAL posting
 * boundary, and the REAL postInventoryAdjustment on PGlite (fresh
 * database per case; the tenant foundation service is stubbed to a
 * no-op because foundation seeding is a separate setup path):
 * - Helper: 3dp worked example, 2dp identity, WAC-scale example,
 *   sub-minor leniency, zero, fail-closed digits/inputs.
 * - Opening journal (KWD): 3 x 33.375 posts Dr 1140 / Cr 3100 at
 *   exactly 100.125 with no 7290 plug line.
 * - Opening journal (EGP): the same inputs post at 100.13.
 * - Fail-closed digits: a base-currency/rate mismatch rejects the
 *   opening post with no stored journal entry.
 * - Verbatim adjustment: a movement row stored at the helper total
 *   posts through postInventoryAdjustment at exactly that amount.
 * - Source pin: the only remaining toFixed(2) line in the service
 *   is the combo display shaping; the consolidation legs use the
 *   single computation (their end-to-end saveFashionGroup drive
 *   still rests on the live-Postgres acceptance run, as before).
 * This is not an end-to-end post on live Postgres, and it does not
 * drive createProduct/saveFashionGroup/toggleProductArchive
 * end-to-end (their PGlite setup needs the full catalog write
 * surface); the paired opening-insert consistency rests on the
 * shared helper plus the source pin, and the live-Postgres
 * acceptance run remains the end-to-end proof.
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
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 40, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (40, 't1', '1140', 'مخزون', 'Inventory', 'asset', true, false, NULL, true, false, false, false, true),
      (60, 't1', '3100', 'رأس المال', 'Capital', 'equity', true, false, NULL, true, false, false, false, false),
      (70, 't1', '7100', 'أرباح تسوية', 'Gain', 'revenue', true, false, NULL, true, false, false, false, false),
      (80, 't1', '5200', 'خسائر تسوية', 'Loss', 'expense', true, false, NULL, true, false, false, false, false),
      (90, 't1', '7290', 'فروق تقريب', 'Rounding', 'expense', true, false, NULL, true, false, false, false, false);
  `);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: `"${code}"` } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never).execute();
}

function makeServices(db: Kysely<Database>): { posting: AccountingPostingService; catalog: CatalogProductService } {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  const catalog = new CatalogProductService(db as any, {} as any, {} as any, posting as any, fakeFoundation as any);
  return { posting, catalog };
}

async function journalLinesFor(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<Array<{ accountId: number; debit: number; credit: number }>> {
  const entries = await (db as any)
    .selectFrom('journal_entries')
    .select(['id'])
    .where('source_type', '=', sourceType)
    .where('source_id', '=', sourceId)
    .execute() as unknown as Array<{ id: number }>;
  assert.equal(entries.length, 1, `expected exactly one journal entry for ${sourceType} #${sourceId}`);
  const rows = await (db as any)
    .selectFrom('journal_entry_lines')
    .select(['account_id', 'debit', 'credit'])
    .where('journal_entry_id', '=', entries[0].id)
    .orderBy('id')
    .execute() as unknown as Array<{ account_id: number; debit: string; credit: string }>;
  return rows.map((row) => ({ accountId: Number(row.account_id), debit: Number(row.debit), credit: Number(row.credit) }));
}

async function journalEntryCount(db: Kysely<Database>): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entries').select('id').execute() as unknown as Array<{ id: number }>;
  return rows.length;
}

async function main(): Promise<void> {
  // Case 1: pure helper — worked examples and fail-closed inputs.
  {
    assert.equal(stockMovementTotal(3, 33.375, 3), 100.125);
    assert.notEqual(stockMovementTotal(3, 33.375, 3), 100.13);
    assert.equal(stockMovementTotal(3, 33.375, 2), 100.13);
    assert.equal(stockMovementTotal(4, 25.125, 2), 100.5);
    assert.equal(stockMovementTotal(16, 15.3125, 3), 245);
    assert.equal(stockMovementTotal(1, 10.1234, 3), 10.123);
    assert.equal(stockMovementTotal(0, 33.375, 3), 0);
    assert.throws(() => stockMovementTotal(1, 1, 4 as never), /Invalid book digits/);
    assert.throws(() => stockMovementTotal(Number.NaN, 1, 3), /Non-finite/);
    assert.throws(() => stockMovementTotal(1, Number.POSITIVE_INFINITY, 3), /Non-finite/);
  }

  // Case 2: opening-stock journal at book digits (KWD, 3dp) through the real boundary.
  {
    const { db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      const { catalog } = makeServices(db);
      await db.transaction().execute(async (trx) => {
        await (catalog as any).postOpeningStock(trx, 7, 3, 33.375, null, auth);
      });
      const lines = await journalLinesFor(db, 'catalog_opening_stock', 7);
      assert.equal(lines.length, 2);
      assert.deepEqual(lines[0], { accountId: 40, debit: 100.125, credit: 0 });
      assert.deepEqual(lines[1], { accountId: 60, debit: 0, credit: 100.125 });
      assert.equal(lines[0].debit, stockMovementTotal(3, 33.375, 3));
    } finally {
      await db.destroy();
    }
  }

  // Case 3: opening-stock journal identity (EGP, 2dp).
  {
    const { db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      const { catalog } = makeServices(db);
      await db.transaction().execute(async (trx) => {
        await (catalog as any).postOpeningStock(trx, 7, 3, 33.375, null, auth);
      });
      const lines = await journalLinesFor(db, 'catalog_opening_stock', 7);
      assert.equal(lines.length, 2);
      assert.deepEqual(lines[0], { accountId: 40, debit: 100.13, credit: 0 });
      assert.deepEqual(lines[1], { accountId: 60, debit: 0, credit: 100.13 });
    } finally {
      await db.destroy();
    }
  }

  // Case 4: fail-closed digits — base-currency/rate mismatch rejects with no journal entry.
  {
    const { db } = await makeDb();
    try {
      await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: '"KWD"' } as never).execute();
      await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: 'EGP', exchange_rate: 1, is_base: true } as never).execute();
      const { catalog } = makeServices(db);
      await assert.rejects(
        db.transaction().execute(async (trx) => {
          await (catalog as any).postOpeningStock(trx, 7, 3, 33.375, null, auth);
        }),
      );
      assert.equal(await journalEntryCount(db), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: verbatim adjustment — a movement row stored at the helper
  // total posts through postInventoryAdjustment at exactly that amount.
  {
    const { db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      const { posting } = makeServices(db);
      const total = stockMovementTotal(3, 33.375, 3);
      const inserted = await (db as any).insertInto('stock_movements').values({
        tenant_id: 't1', account_id: 'a1', product_id: 7, movement_type: 'deduct',
        qty: -3, before_qty: 3, after_qty: 0, unit_cost: 33.375, total_cost: total,
        reason: 'archive_stock_zeroing', note: 'spec', reference_type: 'inventory_adjustment',
        reference_id: 7, branch_id: null, location_id: null, created_by: 1,
      }).returning('id').executeTakeFirst() as unknown as { id: number };
      const result = await posting.postInventoryAdjustment(db as never, Number(inserted.id), auth);
      assert.equal(result.posted, true);
      const lines = await journalLinesFor(db, 'inventory_adjustment', Number(inserted.id));
      assert.equal(lines.length, 2);
      assert.deepEqual(lines[0], { accountId: 80, debit: 100.125, credit: 0 });
      assert.deepEqual(lines[1], { accountId: 40, debit: 0, credit: 100.125 });
    } finally {
      await db.destroy();
    }
  }

  // Case 6: source pin — D6a removed the last toFixed(2) line in the
  // service (the combo display shaping now rounds at the book digits
  // via roundMoney); no 2-decimal cut remains anywhere in the file,
  // and both consolidation legs still use the single computation at
  // book digits.
  {
    const servicePath = resolve(__dirname, '../../src/modules/catalog/services/catalog-product.service.ts');
    const source = readFileSync(servicePath, 'utf8');
    const toFixedLines = source.split('\n').filter((line) => line.includes('toFixed(2)'));
    assert.equal(toFixedLines.length, 0, `unexpected toFixed(2) site: ${toFixedLines.map((line) => line.trim()).join(' | ')}`);
    const helperCalls = source.match(/stockMovementTotal\(/g) ?? [];
    assert.ok(helperCalls.length >= 9, `expected at least 9 stockMovementTotal call sites, found ${helperCalls.length}`);
    assert.ok(!source.includes('roundCurrency'), 'no roundCurrency helper may remain in the catalog service');
  }

  console.log('catalog-stock-totals-book-digits: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
