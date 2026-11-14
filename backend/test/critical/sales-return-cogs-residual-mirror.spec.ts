import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { roundMoney } from '../../src/modules/accounting/engines/money-minor-units.engine';
import { calculateSalesReturnCost } from '../../src/modules/accounting/engines/sales-return-cost.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Sales-return COGS residual mirror (INV-SALES-RETURN-COGS-RESIDUAL-MIRROR).
 *
 * THE GAP: postSale/postSaleEdit post COGS through saleCogsResidual
 * (remaining value rounded first, COGS is the residual, per
 * product-and-cost group, sold-unit basis), but postSalesReturn
 * reversed COGS as a plain qty x frozen cost product. The sale's
 * posted COGS carries the anchor remainder while the return
 * reverses the un-anchored product, stranding one minor unit in
 * 1140 per affected return. Worked case (2dp, WAC 15.3125):
 * stock 16 = 245.00; sell 10, remaining 6 x 15.3125 = 91.875
 * -> 91.88, posted COGS 153.12; return 6 -> the plain product
 * reverses 91.88 and GL inventory lands at 183.76 against
 * physical 12 x 15.3125 = 183.75; a full return leaves COGS
 * -0.01 and inventory +0.01.
 *
 * THE RULE: the return reversal is computed through the SAME
 * shared residual grouping as the sale, with the returned
 * quantity per original sale line and the post-sale remaining
 * quantity reconstructed as the post-restock stock read minus
 * the restocked base quantity (returned sold units x each
 * line's multiplier), converted to the sold-unit basis exactly
 * as the sale does. Sequential returns telescope to the posted
 * COGS, and a full return nets COGS to zero. Restock
 * quantities, the WAC re-blend, revenue/tax legs, and refund
 * tenders are unchanged; only the journal reversal basis
 * changes. Prepared-composite lines (saved cost zero) contribute
 * nothing — their COGS stays expensed, as before. A return with
 * no linked sale, an unresolvable line, or a differing nonzero
 * saved cost keeps the legacy plain computation, preserving
 * every previously pinned override behaviour.
 *
 * BOUNDARY (modifiers): the mirror anchors modifier components
 * exactly as the sale does. In production a line whose
 * components were consumed is a prepared composite (saved cost
 * zero) and is skipped, so consumed-component value stays
 * expensed; the modifier case below therefore pins reversal
 * == the sale's posted residual, not GL == physical under
 * consumed components. The no-modifier cases pin GL ==
 * physical exactly.
 *
 * WHAT THIS PINS, driving the REAL postSale and the REAL
 * postSalesReturn through the REAL posting boundary on PGlite
 * (fresh database per case; the tenant foundation service is
 * stubbed to a no-op because foundation seeding is a separate
 * setup path; stock is seeded directly at its post-movement
 * state, as the residual spec does, because the writer moves
 * stock before posting):
 * - The worked case: reversal 91.87, GL inventory 183.75.
 * - A full return: reversal 153.12, COGS nets to zero.
 * - Sequential partial returns telescope to the posted COGS.
 * - A multi-unit (carton x2) sale + return.
 * - A 3-decimal (KWD) case with a 6dp frozen cost.
 * - Two frozen costs for one product: only the returned
 *   group's anchor reverses.
 * - A modifier sale: the return reverses exactly the posted
 *   residual, through the shared anchor.
 * - The legacy fallbacks stay plain: a differing saved cost,
 *   a zero saved cost (prepared), and an unlinked ambiguous
 *   line.
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
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text, customer_id bigint, subtotal numeric, discount numeric, tax_amount numeric, total numeric, paid_amount numeric, store_credit_used numeric, exchange_return_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz, delivery_fee numeric, delivery_fee_mode text, service_charge numeric, tip_amount numeric, prices_include_tax boolean, sale_origin text, payment_type text, collection_status text);
    CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, tenant_id text, product_id bigint, qty numeric, cost_price numeric, unit_multiplier numeric, modifiers jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, tenant_id text, payment_channel text, amount numeric);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz);
    CREATE TABLE return_items (id bigint PRIMARY KEY, return_document_id bigint, tenant_id text, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
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

async function setRemaining(db: Kysely<Database>, productId: number, qty: number): Promise<void> {
  await sql`UPDATE product_location_stock SET qty = ${qty} WHERE tenant_id = 't1' AND product_id = ${productId}`.execute(db);
}

type ReturnSeedLine = {
  productId: number;
  saleItemId: number | null;
  qty: number;
  costPrice: number | null;
};

async function seedReturn(
  db: Kysely<Database>,
  returnId: number,
  saleId: number,
  total: number,
  lines: ReturnSeedLine[],
): Promise<void> {
  await db.insertInto('return_documents' as never).values({
    id: returnId, tenant_id: 't1', doc_no: `ZR-${returnId}`, return_type: 'sale', invoice_id: saleId,
    settlement_mode: '', refund_method: 'cash', refund_allocations: null, total,
    branch_id: null, location_id: null, created_by: 1, created_at: new Date(),
  } as never).execute();
  for (const [index, line] of lines.entries()) {
    await db.insertInto('return_items' as never).values({
      id: returnId * 10 + index, return_document_id: returnId, tenant_id: 't1',
      product_id: line.productId, sale_item_id: line.saleItemId, qty: line.qty,
      cost_price: line.costPrice, allocated_tax: 0,
    } as never).execute();
  }
}

async function postOn(db: Kysely<Database>, run: (posting: AccountingPostingService, trx: any) => Promise<unknown>): Promise<void> {
  const posting = makePosting(db);
  await db.transaction().execute(async (trx) => {
    await run(posting, trx as any);
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

async function main(): Promise<void> {
  // Case 1: the grounding's worked case — sell 10, return 6.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 200,
        [{ productId: 100, qty: 10, costPrice: 15.3125 }],
        [{ productId: 100, qty: 6 }]);
      await postOn(db, (posting, trx) => posting.postSale(trx, 1, auth));
      const saleJournal = await journalByCode(db, 'sale', 1);
      assert.equal(saleJournal.get('5100')?.debit, 153.12);
      // The legacy plain product reverses 91.88 and strands the unit.
      assert.equal(calculateSalesReturnCost(
        [{ product_id: 100, sale_item_id: 10, qty: 6, cost_price: 15.3125 }],
        [{ id: 10, product_id: 100, cost_price: 15.3125 }],
      ), 91.875);
      // Restock: remaining 6 -> 12.
      await setRemaining(db, 100, 12);
      await seedReturn(db, 1, 1, 120,
        [{ productId: 100, saleItemId: 10, qty: 6, costPrice: 15.3125 }]);
      await postOn(db, (posting, trx) => posting.postSalesReturn(trx, 1, auth));
      const ret = await journalByCode(db, 'sales_return', 1);
      assert.equal(ret.get('1140')?.debit, 91.87);
      assert.equal(ret.get('5100')?.credit, 91.87);
      // GL inventory equals physical: 245.00 - 153.12 + 91.87 = 183.75.
      assert.equal(roundMoney(245 - 153.12 + 91.87, 2), roundMoney(12 * 15.3125, 2));
    } finally {
      await db.destroy();
    }
  }

  // Case 2: a full return nets COGS to zero.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 200,
        [{ productId: 100, qty: 10, costPrice: 15.3125 }],
        [{ productId: 100, qty: 6 }]);
      await postOn(db, (posting, trx) => posting.postSale(trx, 1, auth));
      await setRemaining(db, 100, 16);
      await seedReturn(db, 1, 1, 200,
        [{ productId: 100, saleItemId: 10, qty: 10, costPrice: 15.3125 }]);
      await postOn(db, (posting, trx) => posting.postSalesReturn(trx, 1, auth));
      const ret = await journalByCode(db, 'sales_return', 1);
      assert.equal(ret.get('1140')?.debit, 153.12);
      assert.equal(ret.get('5100')?.credit, 153.12);
      assert.equal(roundMoney(245 - 153.12 + 153.12, 2), 245);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: sequential partial returns telescope to the posted COGS.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 200,
        [{ productId: 100, qty: 10, costPrice: 15.3125 }],
        [{ productId: 100, qty: 6 }]);
      await postOn(db, (posting, trx) => posting.postSale(trx, 1, auth));
      await setRemaining(db, 100, 10);
      await seedReturn(db, 1, 1, 80,
        [{ productId: 100, saleItemId: 10, qty: 4, costPrice: 15.3125 }]);
      await postOn(db, (posting, trx) => posting.postSalesReturn(trx, 1, auth));
      const first = await journalByCode(db, 'sales_return', 1);
      assert.equal(first.get('1140')?.debit, 61.25);
      await setRemaining(db, 100, 16);
      await seedReturn(db, 2, 1, 120,
        [{ productId: 100, saleItemId: 10, qty: 6, costPrice: 15.3125 }]);
      await postOn(db, (posting, trx) => posting.postSalesReturn(trx, 2, auth));
      const second = await journalByCode(db, 'sales_return', 2);
      assert.equal(second.get('1140')?.debit, 91.87);
      assert.equal(roundMoney(61.25 + 91.87, 2), 153.12);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: multi-unit sale (carton x2) + return.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 100,
        [{ productId: 100, qty: 1, costPrice: 30.625, unitMultiplier: 2 }],
        [{ productId: 100, qty: 5 }]);
      await postOn(db, (posting, trx) => posting.postSale(trx, 1, auth));
      const saleJournal = await journalByCode(db, 'sale', 1);
      assert.equal(saleJournal.get('5100')?.debit, 30.63);
      await setRemaining(db, 100, 7);
      await seedReturn(db, 1, 1, 100,
        [{ productId: 100, saleItemId: 10, qty: 1, costPrice: 30.625 }]);
      await postOn(db, (posting, trx) => posting.postSalesReturn(trx, 1, auth));
      const ret = await journalByCode(db, 'sales_return', 1);
      assert.equal(ret.get('1140')?.debit, 30.63);
      assert.equal(roundMoney(107.19 - 30.63 + 30.63, 2), roundMoney(7 * 15.3125, 2));
    } finally {
      await db.destroy();
    }
  }

  // Case 5: 3-decimal (KWD) case with a 6dp frozen cost.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await seedSale(db, 1, 200,
        [{ productId: 100, qty: 10, costPrice: 15.31255 }],
        [{ productId: 100, qty: 6 }]);
      await postOn(db, (posting, trx) => posting.postSale(trx, 1, auth));
      const saleJournal = await journalByCode(db, 'sale', 1);
      assert.equal(saleJournal.get('5100')?.debit, 153.126);
      await setRemaining(db, 100, 12);
      await seedReturn(db, 1, 1, 120,
        [{ productId: 100, saleItemId: 10, qty: 6, costPrice: 15.31255 }]);
      await postOn(db, (posting, trx) => posting.postSalesReturn(trx, 1, auth));
      const ret = await journalByCode(db, 'sales_return', 1);
      assert.equal(ret.get('1140')?.debit, 91.876);
      assert.equal(ret.get('5100')?.credit, 91.876);
      // The legacy plain product would reverse 91.875 and strand 0.001.
      assert.equal(roundMoney(245.001 - 153.126 + 91.876, 3), roundMoney(12 * 15.31255, 3));
    } finally {
      await db.destroy();
    }
  }

  // Case 6: two frozen costs for one product — only the returned group's anchor reverses.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSale(db, 1, 300,
        [
          { productId: 100, qty: 6, costPrice: 15.3125 },
          { productId: 100, qty: 4, costPrice: 15.5 },
        ],
        [{ productId: 100, qty: 6 }]);
      await postOn(db, (posting, trx) => posting.postSale(trx, 1, auth));
      const saleJournal = await journalByCode(db, 'sale', 1);
      // Per-group semantics (Slice 5 P1): the FULL remaining stock is
      // assigned to the first occurrence of EACH group, so group A
      // posts 91.87 and group B posts round(10 x 15.50) - round(6 x
      // 15.50) = 62.00; GL equals physical only for single-group
      // sales, and the mirror telescopes per group instead.
      assert.equal(saleJournal.get('5100')?.debit, 153.87);
      await setRemaining(db, 100, 12);
      await seedReturn(db, 1, 1, 120,
        [{ productId: 100, saleItemId: 10, qty: 6, costPrice: 15.3125 }]);
      await postOn(db, (posting, trx) => posting.postSalesReturn(trx, 1, auth));
      const ret = await journalByCode(db, 'sales_return', 1);
      assert.equal(ret.get('1140')?.debit, 91.87);
      assert.equal(ret.get('5100')?.credit, 91.87);
    } finally {
      await db.destroy();
    }
  }

  // Case 7: a restaurant modifier sale — the return reverses exactly the posted residual.
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
      await postOn(db, (posting, trx) => posting.postSale(trx, 1, auth));
      const saleJournal = await journalByCode(db, 'sale', 1);
      assert.equal(saleJournal.get('5100')?.debit, 10.9);
      // Parent restocks; the consumed component does not.
      await setRemaining(db, 100, 2);
      await seedReturn(db, 1, 1, 100,
        [{ productId: 100, saleItemId: 10, qty: 1, costPrice: 10.890625 }]);
      await postOn(db, (posting, trx) => posting.postSalesReturn(trx, 1, auth));
      const ret = await journalByCode(db, 'sales_return', 1);
      assert.equal(ret.get('1140')?.debit, 10.9);
      assert.equal(ret.get('5100')?.credit, 10.9);
    } finally {
      await db.destroy();
    }
  }

  // Case 8: legacy fallbacks keep the plain computation.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      // 8a: a differing nonzero saved cost keeps the pinned override.
      await seedSale(db, 1, 200,
        [{ productId: 100, qty: 10, costPrice: 10 }],
        [{ productId: 100, qty: 5 }]);
      await postOn(db, (posting, trx) => posting.postSale(trx, 1, auth));
      await setRemaining(db, 100, 7);
      await seedReturn(db, 1, 1, 50,
        [{ productId: 100, saleItemId: 10, qty: 2, costPrice: 12.5 }]);
      await postOn(db, (posting, trx) => posting.postSalesReturn(trx, 1, auth));
      const overridden = await journalByCode(db, 'sales_return', 1);
      assert.equal(overridden.get('1140')?.debit, 25);

      // 8b: a zero saved cost (prepared composite) reverses nothing.
      await seedSale(db, 2, 200,
        [{ productId: 100, qty: 10, costPrice: 10 }],
        [{ productId: 100, qty: 5 }]);
      await postOn(db, (posting, trx) => posting.postSale(trx, 2, auth));
      await seedReturn(db, 2, 2, 50,
        [{ productId: 100, saleItemId: 20, qty: 2, costPrice: 0 }]);
      await postOn(db, (posting, trx) => posting.postSalesReturn(trx, 2, auth));
      const prepared = await journalByCode(db, 'sales_return', 2);
      assert.equal(prepared.get('1140'), undefined);
      assert.equal(prepared.get('5100'), undefined);

      // 8c: an unlinked line across two identical-cost lines keeps the plain product.
      await seedSale(db, 3, 300,
        [
          { productId: 100, qty: 5, costPrice: 15.3125 },
          { productId: 100, qty: 5, costPrice: 15.3125 },
        ],
        [{ productId: 100, qty: 3 }]);
      await postOn(db, (posting, trx) => posting.postSale(trx, 3, auth));
      await setRemaining(db, 100, 5);
      await seedReturn(db, 3, 3, 60,
        [{ productId: 100, saleItemId: null, qty: 2, costPrice: null }]);
      await postOn(db, (posting, trx) => posting.postSalesReturn(trx, 3, auth));
      const unlinked = await journalByCode(db, 'sales_return', 3);
      assert.equal(unlinked.get('1140')?.debit, 30.63);
    } finally {
      await db.destroy();
    }
  }

  // Case 9: source + invariant pins.
  {
    const here = __dirname;
    const postingSource = readFileSync(resolve(here, '../../src/modules/accounting/services/sales-returns-posting.service.ts'), 'utf8');
    assert.ok(postingSource.includes('salesReturnCogsResidual'), 'the return mirror must exist');
    assert.ok(postingSource.includes('residualCogsGroups'), 'the shared residual grouping must exist');
    assert.ok(postingSource.includes('resolveSalesReturnCostLines'), 'the return cost resolver must be shared');
    const invariants = readFileSync(resolve(here, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-SALES-RETURN-COGS-RESIDUAL-MIRROR').length - 1, 1, 'the invariant entry must exist exactly once');
  }

  console.log('Sales return COGS residual mirror tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
