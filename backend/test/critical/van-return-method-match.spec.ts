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
 * Van field-return refund-method match (INV-VAN-RETURN-METHOD-MATCH).
 *
 * THE GAP: the refund method was never matched to the original sale's
 * payment method — submitFieldReturn and approveFieldReturn never read
 * sales.payment_type at all (zero occurrences in the returns service).
 * (a) Credit sale + cash refund: the customer kept the full debt AND
 * took cash; the posting credited the 1130 'none' pool that never held
 * the credit amount, so the pool could go negative. (b) Cash sale +
 * credit refund: customers.balance -= amount with no floor — a phantom
 * negative customer balance.
 *
 * THE RULE: the refund method must match the original sale's payment
 * legs, derived the way postSale splits the receivable — cash sales
 * hold the whole total in rep custody (1130 'none'), credit sales hold
 * it all as receivable (1130 customer), card/InstaPay/Vodafone Cash
 * settled straight to the bank (no leg at all: a field return cannot
 * reverse a bank settlement), and a split sale's credit leg is its
 * customer_ledger sale_credit row with the remainder in cash. Each leg
 * refunds only up to what that leg paid, net of prior approved +
 * pending returns on the same sale. The check runs at submit (fail
 * fast, after the existing trip-cash custody check — so a cash refund
 * that also exceeds the rep's held cash keeps its existing
 * INSUFFICIENT_REP_CASH_FOR_REFUND refusal) and again at approval
 * inside the transaction, after the provenance re-validation, so a
 * sale edited between submit and approval cannot smuggle a wrong-leg
 * refund through. postVanFieldReturn re-derives the sale's payment
 * type at the money boundary as defense in depth. A credit refund
 * must never drive customers.balance below zero — the customer row is
 * locked FOR UPDATE before any stock work and the request stays
 * pending_approval for a human to settle the remainder; never silently
 * clamped. Anything underivable (unknown payment_type, or a split sale
 * with no customer and no ledger credit row) fails closed with
 * REFUND_SALE_LEGS_UNVERIFIABLE.
 *
 * WHAT THIS PINS, driving the REAL submitFieldReturn + approveFieldReturn
 * and the REAL postVanFieldReturn through the REAL posting boundary on
 * PGlite (fresh database per case; the tenant foundation service is
 * stubbed to a no-op because foundation seeding is a separate setup
 * path; stock is seeded directly at its post-sale state, as the
 * residual-mirror spec does, because the writer moves stock before
 * posting):
 * - Credit sale + cash refund is refused at submit (REFUND_METHOD_MISMATCH).
 * - Credit sale + cash refund is refused at approval too (seeded pending
 *   row, so the approval check is pinned even if submit is bypassed):
 *   the customer keeps the debt, no cash moves, no journal.
 * - Cash sale + credit refund is refused at submit and at approval, and
 *   the customer balance never goes negative.
 * - Cash sale + cash refund posts: the 1130 line carries partner_type
 *   'none', the customer balance is unchanged, trip cash falls.
 * - Credit sale + credit refund posts: the 1130 line carries partner_type
 *   'customer', the balance falls by the amount, no trip cash moves.
 * - Split sale (120 = 80 cash + 40 credit): a 100 cash refund and a 60
 *   credit refund are refused; an 80 cash refund then a 40 credit
 *   refund both post (legs are independent); a second cash refund after
 *   the cash leg is spent is refused (priors consume their leg).
 * - Card sale: cash and credit refunds are both refused, at submit and
 *   at the posting boundary (postVanFieldReturn called directly).
 * - Balance floor: a credit refund larger than the customer's balance
 *   (lowered by a prior collection) is refused with
 *   REFUND_EXCEEDS_CUSTOMER_BALANCE, and the balance is untouched.
 * - Unlinked returns: a credit refund past the balance is refused by
 *   the floor; a cash refund within the trip's cash still posts
 *   (existing behaviour preserved — there is no sale to match).
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
    CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, trip_id bigint, rep_id bigint, customer_id bigint, sale_id bigint, status text, return_reason text, refund_method text, total_amount numeric, items_json text, notes text, rejection_reason text, approved_by bigint, approved_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
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

async function seedCurrency(db: Kysely<Database>): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: '"EGP"' } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: 'EGP', exchange_rate: 1, is_base: true } as never).execute();
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

type SaleSeed = {
  paymentMethod: 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';
  total: number;
  paidAmount?: number;
  qty?: number;
  unitPrice?: number;
  customerBalance?: number;
  /** Credit leg of a split sale, as the sale writer records it in customer_ledger. */
  ledgerCredit?: number | null;
};

async function seedWorld(
  db: Kysely<Database>,
  opts: {
    sale: SaleSeed;
    tripCash?: number;
    postSaleStock?: number;
  },
): Promise<void> {
  await seedCurrency(db);
  await db.insertInto('stock_locations' as never).values([
    { id: 900, tenant_id: 't1', account_id: 'a1', name: 'Van', branch_id: null, location_type: 'van_stock', is_active: true },
    { id: 901, tenant_id: 't1', account_id: 'a1', name: 'Damaged', branch_id: null, location_type: 'damaged', is_active: true },
  ] as never).execute();
  const postSaleStock = opts.postSaleStock ?? 94;
  await db.insertInto('products' as never).values({
    id: 100, tenant_id: 't1', account_id: 'a1', name: 'Widget', stock_qty: postSaleStock, reserved_qty: 0, cost_price: 6,
  } as never).execute();
  await db.insertInto('product_location_stock' as never).values({
    tenant_id: 't1', account_id: 'a1', product_id: 100, branch_id: null, location_id: 900, qty: postSaleStock, reserved_qty: 0,
  } as never).execute();
  await db.insertInto('customers' as never).values({
    id: 5, tenant_id: 't1', account_id: 'a1', name: 'Shop', balance: opts.sale.customerBalance ?? 0,
  } as never).execute();
  await db.insertInto('van_sales_trips' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', status: 'open', van_location_id: 900,
    source_warehouse_id: null, rep_id: 7, cash_collected: opts.tripCash ?? 1000, cash_refunds: 0, returns_amount: 0,
  } as never).execute();
  const sale = opts.sale;
  const qty = sale.qty ?? 10;
  const unitPrice = sale.unitPrice ?? 20;
  await db.insertInto('sales' as never).values({
    id: 1, tenant_id: 't1', doc_no: 'S-1', customer_id: 5, subtotal: sale.total,
    discount: 0, tax_amount: 0, total: sale.total, paid_amount: sale.paidAmount ?? 0, store_credit_used: 0,
    exchange_return_id: null, branch_id: null, location_id: null, created_by: 1, created_at: new Date(),
    delivery_fee: 0, delivery_fee_mode: null, service_charge: 0, tip_amount: 0, prices_include_tax: false,
    sale_origin: 'van', payment_type: sale.paymentMethod,
    collection_status: sale.paymentMethod === 'cash' || sale.paymentMethod === 'split' ? 'prepaid_by_rep' : (sale.paymentMethod === 'credit' ? null : 'settled_to_bank'),
    status: 'posted', delivery_rep_id: 7, van_trip_id: 1,
  } as never).execute();
  await db.insertInto('sale_items' as never).values({
    id: 10, sale_id: 1, tenant_id: 't1', product_id: 100, product_name: 'Widget', qty,
    line_total: qty * unitPrice, cost_price: 6,
    unit_multiplier: 1, modifiers: JSON.stringify([]),
  } as never).execute();
  if (sale.ledgerCredit != null) {
    await db.insertInto('customer_ledger' as never).values({
      customer_id: 5, entry_type: 'sale_credit', amount: sale.ledgerCredit, balance_after: sale.customerBalance ?? 0,
      note: 'split sale credit leg', reference_type: 'sale', reference_id: 1,
      van_trip_id: 1, tenant_id: 't1', account_id: 'a1', created_by: 1,
    } as never).execute();
  }
}

async function seedReturn(
  db: Kysely<Database>,
  returnId: number,
  opts: {
    saleId: number | null;
    refundMethod: 'credit' | 'cash';
    totalAmount: number;
    items: Array<{ productId: number; qty: number; unitPrice: number; saleItemId?: number }>;
  },
): Promise<void> {
  await db.insertInto('van_field_returns' as never).values({
    id: returnId, tenant_id: 't1', account_id: 'a1', doc_no: `FR-${returnId}`, trip_id: 1, rep_id: 7,
    customer_id: 5, sale_id: opts.saleId, status: 'pending_approval', return_reason: 'customer_request',
    refund_method: opts.refundMethod, total_amount: opts.totalAmount, items_json: JSON.stringify(opts.items),
    notes: null, rejection_reason: null, approved_by: null, approved_at: null,
  } as never).execute();
}

async function submitReturn(
  returns: VanReturnsService,
  opts: { saleId?: number | null; refundMethod?: 'credit' | 'cash'; items: Array<{ productId: number; qty: number; unitPrice: number; saleItemId?: number }> },
): Promise<{ ok: boolean; returnDocNo: string; returnId: number; status: string; totalAmount: number }> {
  return returns.submitFieldReturn(7, 't1', 'a1', {
    tripId: 1,
    customerId: 5,
    saleId: opts.saleId === undefined ? 1 : opts.saleId,
    returnReason: 'customer_request',
    refundMethod: opts.refundMethod,
    items: opts.items,
  });
}

async function customerBalance(db: Kysely<Database>): Promise<number> {
  const row = await (db as any).selectFrom('customers').select(['balance']).where('id', '=', 5).executeTakeFirst();
  return Number(row?.balance || 0);
}

async function tripRow(db: Kysely<Database>): Promise<{ cashCollected: number; cashRefunds: number; returnsAmount: number }> {
  const row = await (db as any).selectFrom('van_sales_trips').select(['cash_collected', 'cash_refunds', 'returns_amount']).where('id', '=', 1).executeTakeFirstOrThrow();
  return { cashCollected: Number(row.cash_collected || 0), cashRefunds: Number(row.cash_refunds || 0), returnsAmount: Number(row.returns_amount || 0) };
}

async function returnStatus(db: Kysely<Database>, returnId: number): Promise<string> {
  const row = await (db as any).selectFrom('van_field_returns').select(['status']).where('id', '=', returnId).executeTakeFirstOrThrow();
  return String(row.status);
}

async function returnCount(db: Kysely<Database>): Promise<number> {
  const rows = await (db as any).selectFrom('van_field_returns').select(['id']).execute();
  return rows.length;
}

async function journalByCode(
  db: Kysely<Database>,
  sourceType: string,
  sourceId: number,
): Promise<Map<string, { debit: number; credit: number; partnerType: string | null }>> {
  const entries = await (db as any).selectFrom('journal_entries').select(['id'])
    .where('source_type', '=', sourceType).where('source_id', '=', sourceId).execute() as Array<{ id: number }>;
  assert.equal(entries.length, 1, `expected exactly one ${sourceType} journal for ${sourceId}`);
  const rows = await (db as any).selectFrom('journal_entry_lines')
    .innerJoin('accounting_accounts', 'accounting_accounts.id', 'journal_entry_lines.account_id')
    .select(['accounting_accounts.code as code', 'journal_entry_lines.debit as debit', 'journal_entry_lines.credit as credit', 'journal_entry_lines.partner_type as partnerType'])
    .where('journal_entry_id', '=', entries[0].id)
    .execute() as Array<{ code: string; debit: string; credit: string; partnerType: string | null }>;
  const byCode = new Map<string, { debit: number; credit: number; partnerType: string | null }>();
  for (const row of rows) {
    byCode.set(row.code, { debit: Number(row.debit), credit: Number(row.credit), partnerType: row.partnerType });
  }
  const totalDebit = rows.reduce((sum, row) => sum + Number(row.debit), 0);
  const totalCredit = rows.reduce((sum, row) => sum + Number(row.credit), 0);
  assert.equal(totalDebit, totalCredit, 'return journal must balance');
  return byCode;
}

async function journalCount(db: Kysely<Database>, sourceType: string): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entries').select(['id']).where('source_type', '=', sourceType).execute();
  return rows.length;
}

async function main(): Promise<void> {
  // Case 1: credit sale + cash refund is refused at SUBMIT — the
  // trip holds enough cash (1000) that the custody guard would pass,
  // so only the method match refuses it.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, { sale: { paymentMethod: 'credit', total: 200, customerBalance: 200 } });
      await assert.rejects(
        () => submitReturn(returns, { refundMethod: 'cash', items: [{ productId: 100, qty: 2, unitPrice: 20, saleItemId: 10 }] }),
        (err: any) => err.code === 'REFUND_METHOD_MISMATCH',
        'a cash refund on a credit sale must be refused at submit',
      );
      assert.equal(await returnCount(db), 0, 'a refused submit must not insert a return row');
      assert.equal(await customerBalance(db), 200, 'no money moves on a refused submit');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: credit sale + cash refund is refused at APPROVAL too
  // (seeded pending row, so the approval check is pinned even if
  // submit is bypassed): the customer keeps the debt, no cash moves,
  // no journal posts.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, { sale: { paymentMethod: 'credit', total: 200, customerBalance: 200 } });
      await seedReturn(db, 1, { saleId: 1, refundMethod: 'cash', totalAmount: 40, items: [{ productId: 100, qty: 2, unitPrice: 20, saleItemId: 10 }] });
      await assert.rejects(
        () => returns.approveFieldReturn('t1', 'a1', 1, 1),
        (err: any) => err.code === 'REFUND_METHOD_MISMATCH',
        'a cash refund on a credit sale must be refused at approval',
      );
      assert.equal(await returnStatus(db, 1), 'pending_approval', 'a refused approval leaves the request pending');
      assert.equal(await journalCount(db, 'van_field_return'), 0, 'a refused approval posts no journal');
      assert.equal(await customerBalance(db), 200, 'the customer keeps the full debt');
      assert.equal((await tripRow(db)).cashCollected, 1000, 'no cash leaves the rep custody');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: cash sale + credit refund is refused at submit and at
  // approval, and the customer balance never goes negative.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, { sale: { paymentMethod: 'cash', total: 200, customerBalance: 0 } });
      await assert.rejects(
        () => submitReturn(returns, { refundMethod: 'credit', items: [{ productId: 100, qty: 2, unitPrice: 20, saleItemId: 10 }] }),
        (err: any) => err.code === 'REFUND_METHOD_MISMATCH',
        'a credit refund on a cash sale must be refused at submit',
      );
      await seedReturn(db, 1, { saleId: 1, refundMethod: 'credit', totalAmount: 40, items: [{ productId: 100, qty: 2, unitPrice: 20, saleItemId: 10 }] });
      await assert.rejects(
        () => returns.approveFieldReturn('t1', 'a1', 1, 1),
        (err: any) => err.code === 'REFUND_METHOD_MISMATCH',
        'a credit refund on a cash sale must be refused at approval',
      );
      assert.equal(await customerBalance(db), 0, 'the balance must never go negative from a refund');
      assert.equal(await journalCount(db, 'van_field_return'), 0, 'a refused approval posts no journal');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: cash sale + cash refund posts — the 1130 line carries
  // partner_type 'none' (rep custody), the customer balance is
  // unchanged, trip cash falls.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, { sale: { paymentMethod: 'cash', total: 200, customerBalance: 0 } });
      const submitted = await submitReturn(returns, { refundMethod: 'cash', items: [{ productId: 100, qty: 2, unitPrice: 20, saleItemId: 10 }] });
      assert.equal(submitted.status, 'pending_approval');
      assert.equal(submitted.totalAmount, 40);
      const approved = await returns.approveFieldReturn('t1', 'a1', submitted.returnId, 1);
      assert.equal(approved.status, 'approved');
      const ret = await journalByCode(db, 'van_field_return', submitted.returnId);
      assert.equal(ret.get('4100')?.debit, 40);
      assert.equal(ret.get('1130')?.credit, 40);
      assert.equal(ret.get('1130')?.partnerType, 'none', 'a cash refund reduces the rep-custody pool, not a customer');
      assert.equal(await customerBalance(db), 0, 'a cash refund must not touch the customer balance');
      const trip = await tripRow(db);
      assert.equal(trip.cashCollected, 960);
      assert.equal(trip.cashRefunds, 40);
      assert.equal(trip.returnsAmount, 40);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: credit sale + credit refund posts — the 1130 line carries
  // partner_type 'customer', the balance falls by the amount, no trip
  // cash moves.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, { sale: { paymentMethod: 'credit', total: 200, customerBalance: 200 } });
      const submitted = await submitReturn(returns, { refundMethod: 'credit', items: [{ productId: 100, qty: 2, unitPrice: 20, saleItemId: 10 }] });
      assert.equal(submitted.status, 'pending_approval');
      const approved = await returns.approveFieldReturn('t1', 'a1', submitted.returnId, 1);
      assert.equal(approved.status, 'approved');
      const ret = await journalByCode(db, 'van_field_return', submitted.returnId);
      assert.equal(ret.get('4100')?.debit, 40);
      assert.equal(ret.get('1130')?.credit, 40);
      assert.equal(ret.get('1130')?.partnerType, 'customer', 'a credit refund reduces the customer receivable');
      assert.equal(await customerBalance(db), 160, 'the receivable falls by the refunded amount');
      assert.equal((await tripRow(db)).cashCollected, 1000, 'a credit refund must not move trip cash');
      const ledger = await (db as any).selectFrom('customer_ledger').select(['amount', 'balance_after'])
        .where('reference_type', '=', 'van_field_return').where('reference_id', '=', submitted.returnId).executeTakeFirst();
      assert.equal(Number(ledger?.amount), -40);
      assert.equal(Number(ledger?.balance_after), 160);
    } finally {
      await db.destroy();
    }
  }

  // Case 6a: split sale (120 = 80 cash + 40 credit) — a cash refund
  // above the cash leg and a credit refund above the credit leg are
  // both refused at submit.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, { sale: { paymentMethod: 'split', total: 120, qty: 6, customerBalance: 40, ledgerCredit: 40 } });
      await assert.rejects(
        () => submitReturn(returns, { refundMethod: 'cash', items: [{ productId: 100, qty: 5, unitPrice: 20, saleItemId: 10 }] }),
        (err: any) => err.code === 'REFUND_METHOD_MISMATCH',
        'a 100 cash refund exceeds the 80 cash leg of the split sale',
      );
      await assert.rejects(
        () => submitReturn(returns, { refundMethod: 'credit', items: [{ productId: 100, qty: 3, unitPrice: 20, saleItemId: 10 }] }),
        (err: any) => err.code === 'REFUND_METHOD_MISMATCH',
        'a 60 credit refund exceeds the 40 credit leg of the split sale',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 6b: split sale — the 80 cash leg refunds in cash and the 40
  // credit leg refunds as credit, sequentially; the legs are
  // independent (the cash refund does not consume the credit leg).
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, { sale: { paymentMethod: 'split', total: 120, qty: 6, customerBalance: 40, ledgerCredit: 40 } });
      const cashSub = await submitReturn(returns, { refundMethod: 'cash', items: [{ productId: 100, qty: 4, unitPrice: 20, saleItemId: 10 }] });
      await returns.approveFieldReturn('t1', 'a1', cashSub.returnId, 1);
      const cashJournal = await journalByCode(db, 'van_field_return', cashSub.returnId);
      assert.equal(cashJournal.get('1130')?.partnerType, 'none');
      assert.equal(await customerBalance(db), 40, 'the cash leg must not touch the customer balance');
      assert.equal((await tripRow(db)).cashCollected, 920);
      const creditSub = await submitReturn(returns, { refundMethod: 'credit', items: [{ productId: 100, qty: 2, unitPrice: 20, saleItemId: 10 }] });
      await returns.approveFieldReturn('t1', 'a1', creditSub.returnId, 1);
      const creditJournal = await journalByCode(db, 'van_field_return', creditSub.returnId);
      assert.equal(creditJournal.get('1130')?.partnerType, 'customer');
      assert.equal(await customerBalance(db), 0, 'the credit leg falls by the refunded amount');
      assert.equal((await tripRow(db)).cashCollected, 920, 'the credit leg must not move trip cash');
    } finally {
      await db.destroy();
    }
  }

  // Case 6c: split sale — a second cash refund after the cash leg is
  // spent is refused at approval (priors consume their leg), even
  // though returnable quantity remains.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, { sale: { paymentMethod: 'split', total: 120, qty: 6, customerBalance: 40, ledgerCredit: 40 } });
      const first = await submitReturn(returns, { refundMethod: 'cash', items: [{ productId: 100, qty: 4, unitPrice: 20, saleItemId: 10 }] });
      await returns.approveFieldReturn('t1', 'a1', first.returnId, 1);
      await seedReturn(db, 99, { saleId: 1, refundMethod: 'cash', totalAmount: 20, items: [{ productId: 100, qty: 1, unitPrice: 20, saleItemId: 10 }] });
      await assert.rejects(
        () => returns.approveFieldReturn('t1', 'a1', 99, 1),
        (err: any) => err.code === 'REFUND_METHOD_MISMATCH',
        'a second cash refund must be refused once the cash leg is spent',
      );
      assert.equal(await returnStatus(db, 99), 'pending_approval');
    } finally {
      await db.destroy();
    }
  }

  // Case 7: card sale — cash and credit refunds are both refused at
  // submit, and the posting boundary refuses a mismatched refund
  // even when called directly.
  {
    const { pg, db } = await makeDb();
    try {
      const { posting, returns } = makeServices(db);
      await seedWorld(db, { sale: { paymentMethod: 'card', total: 200, paidAmount: 200, customerBalance: 0 } });
      await assert.rejects(
        () => submitReturn(returns, { refundMethod: 'cash', items: [{ productId: 100, qty: 2, unitPrice: 20, saleItemId: 10 }] }),
        (err: any) => err.code === 'REFUND_METHOD_MISMATCH',
        'a cash refund on a bank-settled card sale must be refused',
      );
      await assert.rejects(
        () => submitReturn(returns, { refundMethod: 'credit', items: [{ productId: 100, qty: 2, unitPrice: 20, saleItemId: 10 }] }),
        (err: any) => err.code === 'REFUND_METHOD_MISMATCH',
        'a credit refund on a bank-settled card sale must be refused',
      );
      await assert.rejects(
        () => db.transaction().execute(async (trx) => {
          await posting.postVanFieldReturn(trx as any, 99, {
            customerId: 5, totalAmount: 40, refundMethod: 'cash',
            items: [], branchId: null, locationId: 900, saleId: 1, isDamaged: false,
          }, auth);
        }),
        (err: any) => err.code === 'REFUND_METHOD_MISMATCH',
        'the posting boundary must refuse a cash refund on a card sale',
      );
      await assert.rejects(
        () => db.transaction().execute(async (trx) => {
          await posting.postVanFieldReturn(trx as any, 99, {
            customerId: 5, totalAmount: 40, refundMethod: 'credit',
            items: [], branchId: null, locationId: 900, saleId: 1, isDamaged: false,
          }, auth);
        }),
        (err: any) => err.code === 'REFUND_METHOD_MISMATCH',
        'the posting boundary must refuse a credit refund on a card sale',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 8: balance floor — the credit leg (200) covers the refund
  // (100), but a prior collection already lowered the customer's
  // balance to 30, so approval refuses and the balance is untouched.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, { sale: { paymentMethod: 'credit', total: 200, customerBalance: 30 } });
      await seedReturn(db, 1, { saleId: 1, refundMethod: 'credit', totalAmount: 100, items: [{ productId: 100, qty: 5, unitPrice: 20, saleItemId: 10 }] });
      await assert.rejects(
        () => returns.approveFieldReturn('t1', 'a1', 1, 1),
        (err: any) => err.code === 'REFUND_EXCEEDS_CUSTOMER_BALANCE',
        'a credit refund past the customer balance must fail closed, never clamp to zero',
      );
      assert.equal(await returnStatus(db, 1), 'pending_approval');
      assert.equal(await customerBalance(db), 30, 'the balance is untouched by a refused approval');
      assert.equal(await journalCount(db, 'van_field_return'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 9a: unlinked credit refund past the balance is refused by
  // the floor (there is no sale leg to match, so the floor is the
  // guard).
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, { sale: { paymentMethod: 'credit', total: 200, customerBalance: 10 } });
      await seedReturn(db, 1, { saleId: null, refundMethod: 'credit', totalAmount: 40, items: [{ productId: 100, qty: 2, unitPrice: 20 }] });
      await assert.rejects(
        () => returns.approveFieldReturn('t1', 'a1', 1, 1),
        (err: any) => err.code === 'REFUND_EXCEEDS_CUSTOMER_BALANCE',
        'an unlinked credit refund past the balance must be refused',
      );
      assert.equal(await customerBalance(db), 10);
    } finally {
      await db.destroy();
    }
  }

  // Case 9b: unlinked cash refund within the trip's cash still posts
  // (existing behaviour preserved — there is no sale to match, and
  // the trip-cash custody guard is the control).
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedWorld(db, { sale: { paymentMethod: 'credit', total: 200, customerBalance: 10 } });
      await seedReturn(db, 1, { saleId: null, refundMethod: 'cash', totalAmount: 40, items: [{ productId: 100, qty: 2, unitPrice: 20 }] });
      const approved = await returns.approveFieldReturn('t1', 'a1', 1, 1);
      assert.equal(approved.status, 'approved');
      assert.equal(await customerBalance(db), 10, 'an unlinked cash refund must not touch the customer balance');
      assert.equal((await tripRow(db)).cashCollected, 960);
    } finally {
      await db.destroy();
    }
  }

  // Case 10: source pins.
  {
    const here = __dirname;
    const returnsSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-returns.service.ts'), 'utf8');
    assert.ok(returnsSource.includes('resolveSaleRefundLegs'), 'the leg resolution must exist');
    assert.ok(returnsSource.includes('assertRefundMethodCoveredByLegs'), 'the leg assertion must exist');
    assert.ok(returnsSource.includes('REFUND_METHOD_MISMATCH'), 'the named mismatch refusal must exist');
    assert.ok(returnsSource.includes('REFUND_EXCEEDS_CUSTOMER_BALANCE'), 'the named balance-floor refusal must exist');
    assert.ok(returnsSource.includes('REFUND_SALE_LEGS_UNVERIFIABLE'), 'the fail-closed unverifiable-legs refusal must exist');
    const postingSource = readFileSync(resolve(here, '../../src/modules/accounting/accounting-posting.service.ts'), 'utf8');
    assert.ok(postingSource.includes('REFUND_METHOD_MISMATCH'), 'the posting boundary must refuse a mismatched refund');
    assert.ok(postingSource.includes('INV-VAN-RETURN-METHOD-MATCH'), 'the posting guard must be marked with the invariant id');
  }

  console.log('Van field-return refund-method match tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
