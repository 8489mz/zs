/*
 * Imported opening stock posts to GL inventory (INV-GL-INVENTORY-VALUE):
 * an imported product's initial stock, and an opening-stock import that
 * re-sets a scoped quantity, are real inventory value — they must post
 * the same opening-stock journal the single-product create path posts
 * (Dr inventory 1140 / Cr opening capital 3100, at book digits), in
 * the import's own transaction. Before the fix both import entry
 * points wrote stock with no journal at all, so the stock value on
 * hand (sum stock_qty x cost_price) grew while the GL inventory
 * balance only moved on purchases and sales — the live test10k gap
 * (GL 232.71 against 24,050.00 in the main warehouse).
 *
 * WHAT THIS PINS, driving the REAL SettingsImportService on PGlite:
 * 1. importProducts with 10 units at cost 50.00 posts exactly one
 *    balanced journal: Dr 1140 500.00 / Cr 3100 500.00, with an
 *    opening_balance stock movement (qty 10, total 500.00).
 * 2. The INVENTORY_GL_VALUATION reconciliation holds after the import:
 *    sum(stock_qty x cost_price) == GL 1140 balance (500.00).
 * 3. importOpeningStock raising the same product to 14 posts Dr 1140
 *    200.00 / Cr 3100 200.00 (GL 700.00 == stock value 700.00), and
 *    lowering it to 6 posts the mirror entry Dr 3100 400.00 /
 *    Cr 1140 400.00 (GL 300.00 == stock value 300.00), with the
 *    movement carrying the SIGNED delta (-8).
 * 4. A zero-cost import posts no journal; an existing product updated
 *    with a stockQty still ignores it (no stock change, no journal);
 *    a no-change opening-stock import posts no journal.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { SettingsImportService } from '../../src/modules/settings/services/settings-import.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'super_admin', userId: 1, username: 'admin', permissions: ['settings'] } as unknown as AuthContext;

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const service = new SettingsImportService(
    db as any,
    { log: async () => {} } as any,
    posting,
  );

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE settings (tenant_id text, key text, value text);
      INSERT INTO settings VALUES ('t1','currency','EGP');
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
      CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', normal_balance text, is_active boolean DEFAULT true, is_tax boolean DEFAULT false, is_system boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE UNIQUE INDEX idx_accounting_accounts_tenant_code_uidx ON accounting_accounts (tenant_id, code);
      INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type, normal_balance, is_active) VALUES
        (1140,'t1','a1','1140','asset','debit',true),
        (3100,'t1','a1','3100','equity','credit',true);
      CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      INSERT INTO accounting_settings VALUES (1,'t1','a1',NULL,NULL,NULL,NULL,1140,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE branches (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint);
      INSERT INTO branches (id, tenant_id, account_id, name, is_active, default_stock_location_id) VALUES (1,'t1','a1','الفرع الرئيسي',true,1);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, branch_id bigint, is_active boolean DEFAULT true, location_type text);
      INSERT INTO stock_locations (id, tenant_id, account_id, name, branch_id, is_active, location_type) VALUES (1,'t1','a1','المخزن الرئيسي',1,true,'branch_stock');
      CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text);
      CREATE TABLE product_categories (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean DEFAULT true);
      CREATE TABLE suppliers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, notes text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, sku text, category_id bigint, supplier_id bigint, item_type text, item_kind text, style_code text, color text, size text, bin_location text, track_serials boolean DEFAULT false, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric, consumer_price numeric, min_selling_price numeric, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, min_stock_qty numeric DEFAULT 0, default_location_id bigint, notes text, metadata text, is_active boolean DEFAULT true, catalog_updated_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, product_id bigint, tenant_id text, account_id text, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_units (id bigserial PRIMARY KEY, product_id bigint, tenant_id text, account_id text, name text, multiplier numeric, barcode text, is_base_unit boolean, is_sale_unit_default boolean, is_purchase_unit_default boolean);
    `);

    const journalCount = async (): Promise<number> => {
      const row = await db.selectFrom('journal_entries').select(({ fn }) => fn.count<number>('id').as('n')).executeTakeFirstOrThrow();
      return Number(row.n);
    };
    const glInventoryBalance = async (): Promise<number> => {
      const rows = await db.selectFrom('journal_entry_lines')
        .innerJoin('journal_entries', 'journal_entries.id', 'journal_entry_lines.journal_entry_id')
        .innerJoin('accounting_accounts', 'accounting_accounts.id', 'journal_entry_lines.account_id')
        .select(({ fn }) => fn.sum<number>(sql`journal_entry_lines.debit - journal_entry_lines.credit`).as('balance'))
        .where('accounting_accounts.code', '=', '1140')
        .where('journal_entries.status', '=', 'posted')
        .executeTakeFirst();
      return Number((rows as any)?.balance || 0);
    };
    const stockValue = async (): Promise<number> => {
      const row = await db.selectFrom('products')
        .select(({ fn }) => fn.sum<number>(sql`coalesce(stock_qty, 0) * coalesce(cost_price, 0)`).as('v'))
        .where('tenant_id', '=', 't1')
        .executeTakeFirst();
      return Number((row as any)?.v || 0);
    };
    const linesOf = async (entryId: number): Promise<Array<{ code: string; debit: number; credit: number }>> => {
      const rows = await db.selectFrom('journal_entry_lines')
        .innerJoin('accounting_accounts', 'accounting_accounts.id', 'journal_entry_lines.account_id')
        .select(['accounting_accounts.code as code', 'journal_entry_lines.debit as debit', 'journal_entry_lines.credit as credit'])
        .where('journal_entry_id', '=', entryId)
        .execute();
      return rows.map((r: any) => ({ code: String(r.code), debit: Number(r.debit), credit: Number(r.credit) }));
    };
    const lastJournal = async (): Promise<{ id: number; sourceType: string; sourceId: number }> => {
      const row = await db.selectFrom('journal_entries').select(['id', 'source_type', 'source_id'])
        .orderBy('id', 'desc').executeTakeFirstOrThrow();
      return { id: Number(row.id), sourceType: String(row.source_type), sourceId: Number(row.source_id) };
    };

    // 1. The live case, shrunk: 10 units at cost 50.00 imported.
    const imported = await service.importProducts([
      { name: 'صنف اختبار', barcode: '1001', costPrice: 50, retailPrice: 80, stockQty: 10, warehouseName: 'المخزن الرئيسي' },
    ], AUTH);
    assert.equal(imported.ok, true, 'import must succeed');
    assert.equal(imported.inserted, 1, 'one product inserted');
    assert.equal(await journalCount(), 1, 'one opening-stock journal must be posted');
    const first = await lastJournal();
    assert.equal(first.sourceType, 'catalog_opening_stock', 'journal source is the product opening stock');
    const firstLines = await linesOf(first.id);
    assert.equal(firstLines.length, 2, 'journal has exactly two lines');
    assert.deepEqual(
      firstLines.map((l) => [l.code, l.debit, l.credit]).sort(),
      [['1140', 500, 0], ['3100', 0, 500]],
      'imported opening stock debits 1140 500.00 and credits 3100 500.00',
    );
    const movements = await db.selectFrom('stock_movements').select(['movement_type', 'qty', 'before_qty', 'after_qty', 'total_cost']).execute();
    assert.equal(movements.length, 1, 'one stock movement recorded');
    assert.equal(String(movements[0].movement_type), 'opening_balance', 'movement is an opening balance');
    assert.equal(Number(movements[0].qty), 10, 'movement qty is 10');
    assert.equal(Number(movements[0].before_qty), 0, 'movement starts at 0');
    assert.equal(Number(movements[0].after_qty), 10, 'movement ends at 10');
    assert.equal(Number(movements[0].total_cost), 500, 'movement total is 500.00');
    assert.equal(await stockValue(), 500, 'stock value is 500.00');
    assert.equal(await glInventoryBalance(), 500, 'GL 1140 equals the stock value after import');

    // 2. Zero-cost stock posts no journal (no financial impact).
    await service.importProducts([
      { name: 'صنف بلا تكلفة', barcode: '1002', costPrice: 0, retailPrice: 10, stockQty: 5, warehouseName: 'المخزن الرئيسي' },
    ], AUTH);
    assert.equal(await journalCount(), 1, 'zero-cost import posts no journal');
    assert.equal(await stockValue(), 500, 'zero-cost stock adds no value');

    // 3. Updating an existing product still ignores its stockQty.
    // (The cost stays 50.00 here so the valuation basis does not move
    // mid-spec; a cost edit is a revaluation question, not this fix.)
    const updated = await service.importProducts([
      { name: 'صنف اختبار', barcode: '1001', costPrice: 50, stockQty: 99, warehouseName: 'المخزن الرئيسي' },
    ], AUTH);
    assert.equal(updated.updated, 1, 'existing product updated');
    const product = await db.selectFrom('products').select(['stock_qty', 'cost_price']).where('barcode', '=', '1001').executeTakeFirstOrThrow();
    assert.equal(Number(product.stock_qty), 10, 'existing stockQty is still ignored');
    assert.equal(await journalCount(), 1, 'update with stockQty posts no journal');

    // 4. Opening-stock import: raise to 14, then lower to 6.
    const productId = Number((await db.selectFrom('products').select('id').where('barcode', '=', '1001').executeTakeFirstOrThrow()).id);
    const raised = await service.importOpeningStock([
      { productId, qty: 14, warehouseName: 'المخزن الرئيسي' },
    ], AUTH);
    assert.equal(raised.updated, 1, 'opening stock raise applied');
    assert.equal(await journalCount(), 2, 'raise posts one journal');
    const raiseJournal = await lastJournal();
    assert.equal(raiseJournal.sourceType, 'import_opening_stock', 'raise journal source is the opening-stock import');
    assert.deepEqual(
      (await linesOf(raiseJournal.id)).map((l) => [l.code, l.debit, l.credit]).sort(),
      [['1140', 200, 0], ['3100', 0, 200]],
      'raise of 4 units at 50.00 debits 1140 200.00',
    );
    assert.equal(await glInventoryBalance(), 700, 'GL 1140 is 700.00 after the raise');
    assert.equal(await stockValue(), 700, 'stock value is 700.00 after the raise');

    const lowered = await service.importOpeningStock([
      { productId, qty: 6, warehouseName: 'المخزن الرئيسي' },
    ], AUTH);
    assert.equal(lowered.updated, 1, 'opening stock lowering applied');
    assert.equal(await journalCount(), 3, 'lowering posts one journal');
    const lowerJournal = await lastJournal();
    assert.deepEqual(
      (await linesOf(lowerJournal.id)).map((l) => [l.code, l.debit, l.credit]).sort(),
      [['1140', 0, 400], ['3100', 400, 0]],
      'lowering by 8 units at 50.00 credits 1140 400.00 against 3100',
    );
    assert.equal(await glInventoryBalance(), 300, 'GL 1140 is 300.00 after the lowering');
    assert.equal(await stockValue(), 300, 'stock value is 300.00 after the lowering');
    const openingMovements = await db.selectFrom('stock_movements').select(['movement_type', 'qty', 'total_cost'])
      .where('movement_type', '=', 'opening_stock').orderBy('id', 'asc').execute();
    assert.equal(openingMovements.length, 2, 'two opening-stock movements recorded');
    assert.equal(Number(openingMovements[0].qty), 4, 'raise movement is +4');
    assert.equal(Number(openingMovements[1].qty), -8, 'lowering movement carries the SIGNED delta -8');
    assert.equal(Number(openingMovements[1].total_cost), -400, 'lowering movement total is -400.00');

    // 5. A no-change opening-stock import posts no journal.
    await service.importOpeningStock([
      { productId, qty: 6, warehouseName: 'المخزن الرئيسي' },
    ], AUTH);
    assert.equal(await journalCount(), 3, 'no-change import posts no journal');

    console.log('import-opening-stock-gl: imported 10x50 posts Dr 1140 500 / Cr 3100 500; raise to 14 and lower to 6 track GL == stock value (700, 300); zero-cost and no-change post nothing');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => console.log('import-opening-stock-gl checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
