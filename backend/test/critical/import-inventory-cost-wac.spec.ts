/*
New file: backend/test/critical/import-inventory-cost-wac.spec.ts
Pins the W2 unification (INV-IMPORT-RECEIPT-BOOK-DIGITS): the
import receipt groups its money ONCE at the tenant's book digits
through the canonical roundMoney, and the live receipt caller
passes those digits — so the WAC blend, the stock-movement total
and the receipt journal all share one rounded group value.

WHAT WAS WRONG: groupImportReceipts accumulated raw float
products (receivedQty * landedCost) while postShipmentToInventory
cut only the journal totals to a hardcoded 2dp. On a 3dp (KWD)
tenant the journal said 42.88 for a receipt the pool blended at
42.875, the shortage expense was cut to 2dp in the expenses row,
and the overhead allocator only knew cents — a one-fils share
rounded to a whole cent. The blend itself was already canonical
(importWeightedAverageCost delegates to weightedReceiptCost,
INV-WAC-UNIFIED-BLEND); the money around it was not.

WHAT THIS PINS, driving the real service end to end on PGlite:
- Pure engine: group values and shortage expense round once at
  the passed digits — 3dp values stay 3dp on KWD and round to 2dp
  on EGP; float dust (0.1 x 3) is gone; any digits but 2 or 3
  fail closed.
- The allocator's largest-remainder split sums exactly at 3dp
  (a 0.005 overhead share splits 0.003/0.002, not 0.01/0).
- KWD end to end (Arrived): the receipt blends through the
  canonical WAC (100 @ 5 + 7 @ 6.125 -> 5.073598), the journal
  keeps the third decimal (inventory 98, shortage 6.125, goods
  credit 104.125, balanced), and the expenses row keeps 6.125.
- EGP end to end, same fixture: the same 3dp receipt rounds to
  book digits first (42.88 / 55.13 / 6.13), the WAC follows the
  ROUNDED value (5.073645, so cost_price x qty reconciles with
  the 1140 leg), and the dust correction keeps the journal
  balanced (debits 104.14, credits 104.14).
- Fail-closed wiring: a settings/rates currency mismatch throws
  at addShipmentItem, fail-fast (the landed-cost recalculation
  reads the tenant base currency), before any stock or journal
  write (no receipt, no journal).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import {
  groupImportReceipts,
  importWeightedAverageCost,
} from '../../src/modules/import-sales/import-inventory-cost.engine';
import { apportionByBucketShares } from '../../src/modules/import-sales/import-sales.service';
import { weightedReceiptCost } from '../../src/modules/accounting/engines/inventory-valuation.engine';

type MoneyDigits = 2 | 3;

const RECEIPT_LINES = [
  {
    id: 'a', productId: 5, quantity: 7, receivedQuantity: 7,
    factoryUnitPriceUsd: 1.225, shortageHandlingMethod: 'capitalize', landedCost: 6.125,
  },
  {
    id: 'b', productId: 6, quantity: 10, receivedQuantity: 9,
    factoryUnitPriceUsd: 1.225, shortageHandlingMethod: 'expense', landedCost: 6.125,
  },
];

async function makeDb(currency: 'EGP' | 'KWD'): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, account_group text, is_active boolean, is_cash_bank boolean, is_inventory boolean, is_payable boolean, is_receivable boolean, is_tax boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, feasibility_data text, status text);
    CREATE TABLE import_shipments (id text PRIMARY KEY DEFAULT ('sh-' || md5(random()::text)), tenant_id text, supplier_id bigint, project_id text, container_number text, status text, bill_of_lading text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days numeric, demurrage_start_date text, demurrage_rate_per_day numeric, customs_declaration_no text, vat_refundable_egp numeric, customs_duty_rate_percent numeric, vat_rate_percent numeric, insurance_cost_usd numeric, funding_type text, is_consolidated boolean, cost_allocation_method text, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, actual_demurrage_fees numeric, shipped_date text, eta_date text, clearance_date text, arrival_date text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY DEFAULT ('item-' || md5(random()::text)), tenant_id text, shipment_id text, product_id bigint, quantity numeric, received_quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, shortage_handling_method text, gross_weight_kg_unit numeric, cbm_unit numeric, target_retail_margin numeric, target_wholesale_margin numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, reserved_quantity numeric, status text);
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text, review_reason text, posted_at timestamptz, created_by bigint, journal_entry_id bigint);
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, updated_at timestamptz);
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text NOT NULL, broker_expense_id text NOT NULL, shipment_id text NOT NULL, cost_bucket text, amount_egp numeric(19, 4) NOT NULL, state text NOT NULL CHECK (state IN ('folded', 'consumed', 'revalued')), late_expense_event_id bigint, created_by bigint, created_at timestamptz NOT NULL DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, created_by bigint, journal_entry_id bigint);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint);
    INSERT INTO settings VALUES ('t1', 'currency', '"${currency}"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', '${currency}', 1, true);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false);
    INSERT INTO branches VALUES (2, 't1', 'Main Branch');
    INSERT INTO stock_locations VALUES (10, 't1', 2, 'Main Warehouse');
    INSERT INTO suppliers VALUES (9, 't1', 'Shipment Supplier', '', '', 0, true, NOW());
    INSERT INTO products VALUES (5, 't1', 't1', 'Widget', 100, 0, 5, NOW());
    INSERT INTO products VALUES (6, 't1', 't1', 'Gadget', 0, 0, 0, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 't1', 5, 2, 10, 100, 0);
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function product(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any).selectFrom('products').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function journalLines(db: Kysely<Database>): Promise<Array<{ account_id: number; debit: number; credit: number }>> {
  const rows: any[] = await (db as any)
    .selectFrom('journal_entry_lines')
    .select(['account_id', 'debit', 'credit'])
    .orderBy('id')
    .execute();
  return rows.map((r) => ({ account_id: Number(r.account_id), debit: Number(r.debit), credit: Number(r.credit) }));
}

async function postReceipt(db: Kysely<Database>, service: any): Promise<void> {
  const shipment = await service.createShipment('t1', {
    containerNumber: 'MSCU-W2', supplierId: '9', exchangeRateAtArrival: 5,
  });
  await service.addShipmentItem('t1', shipment.id, { productId: 5, quantity: 7, factoryUnitPriceUsd: 1.225 });
  // addShipmentItem has no received-quantity input: the short
  // item is seeded directly, and the Arrived recalculation reads
  // its received quantity from the row.
  await (db as any).insertInto('import_shipment_items').values({
    tenant_id: 't1', shipment_id: shipment.id, product_id: 6, quantity: 10,
    received_quantity: 9, factory_unit_price_usd: 1.225, landed_cost_egp: 0,
    shortage_handling_method: 'expense',
  } as never).execute();
  await service.updateShipmentCosts('t1', 1, shipment.id, { status: 'Arrived', receiptLocationId: 10 });
}

async function main(): Promise<void> {
  // Case 1: pure engine — one rounding at the passed digits.
  {
    const egp = groupImportReceipts(RECEIPT_LINES as any, 2);
    assert.equal(egp.length, 2, 'two product groups');
    assert.equal(egp[0].value, 42.88, '7 x 6.125 rounds to 2dp on EGP');
    assert.equal(egp[0].shortageExpense, 0, 'no shortage on the full receipt');
    assert.equal(egp[1].value, 55.13, '9 x 6.125 rounds to 2dp on EGP');
    assert.equal(egp[1].shortageExpense, 6.13, '1 x 6.125 shortage rounds to 2dp on EGP');

    const kwd = groupImportReceipts(RECEIPT_LINES as any, 3);
    assert.equal(kwd[0].value, 42.875, '7 x 6.125 stays 3dp on KWD');
    assert.equal(kwd[1].value, 55.125, '9 x 6.125 stays 3dp on KWD');
    assert.equal(kwd[1].shortageExpense, 6.125, 'shortage keeps its third decimal on KWD');

    // Float dust is gone: 0.1 x 3 used to accumulate as
    // 0.30000000000000004 and ride into the WAC and the journal.
    const dust = groupImportReceipts([{
      id: 'd', productId: 7, quantity: 3, receivedQuantity: 3,
      factoryUnitPriceUsd: 0.1, shortageHandlingMethod: 'capitalize', landedCost: 0.1,
    }] as any, 2);
    assert.equal(dust[0].value, 0.3, 'raw float dust is rounded away');

    // A 3dp group total rounds half-up at 2dp through roundMoney.
    const half = groupImportReceipts([{
      id: 'h', productId: 8, quantity: 3, receivedQuantity: 3,
      factoryUnitPriceUsd: 10.125, shortageHandlingMethod: 'capitalize', landedCost: 10.125,
    }] as any, 2);
    assert.equal(half[0].value, 30.38, '30.375 rounds to 30.38 at 2dp');

    // Digits are explicit and fail closed: no silent default.
    assert.throws(
      () => groupImportReceipts(RECEIPT_LINES as any, 4 as unknown as MoneyDigits),
      /دقة العملة غير صالحة/,
      'digits other than 2 or 3 must fail closed',
    );

    // The blend still IS the canonical blend, now fed the rounded
    // group value: on EGP the WAC follows 42.88, not the raw 42.875.
    assert.equal(importWeightedAverageCost(100, 5, 7, 42.88), 5.073645);
    assert.equal(
      importWeightedAverageCost(100, 5, 7, 42.88),
      weightedReceiptCost(100, 5, 7, 42.88),
      'import blend equals the canonical blend on the rounded value',
    );
    assert.equal(importWeightedAverageCost(100, 5, 7, 42.875), 5.073598);
  }

  // Case 2: the allocator's remainder is largest-remainder at
  // the passed minor unit — a one-fils share is no longer forced
  // into a whole cent.
  {
    const shares = apportionByBucketShares(0.005, [1, 1], 3);
    assert.deepEqual(shares, [0.003, 0.002], '0.005 splits 0.003/0.002 at 3dp');
    assert.equal(shares.reduce((s, v) => s + v, 0), 0.005, 'shares sum exactly to the total');
    const cents = apportionByBucketShares(0.01, [1, 1, 1], 2);
    assert.deepEqual(cents, [0.01, 0, 0], 'one cent goes to the first bucket at 2dp');
    assert.equal(cents.reduce((s, v) => s + v, 0), 0.01, 'shares sum exactly at 2dp too');
    const legacy = apportionByBucketShares(10, [1, 3]);
    assert.deepEqual(legacy, [2.5, 7.5], 'the old two-arg call keeps its cents behaviour');
  }

  // Case 3: KWD end to end — the third decimal survives the
  // receipt, the WAC and the journal.
  {
    const db = await makeDb('KWD');
    try {
      const service = makeService(db);
      await postReceipt(db, service);
      assert.equal(await countRows(db, 'import_inventory_receipts'), 1, 'the receipt posts');
      assert.equal(await countRows(db, 'journal_entries'), 1, 'one receipt journal posts');
      const p5 = await product(db, 5);
      assert.equal(Number(p5.stock_qty), 107, 'prior 100 + received 7');
      assert.equal(Number(p5.cost_price), 5.073598, 'WAC blends the 3dp receipt value (100x5 + 42.875) / 107');
      const p6 = await product(db, 6);
      assert.equal(Number(p6.stock_qty), 9, 'short item stocks only the received 9');
      assert.equal(Number(p6.cost_price), 6.125, 'short item WAC is its 3dp landed cost');
      const lines = await journalLines(db);
      const debit = lines.reduce((s, l) => s + l.debit, 0);
      const credit = lines.reduce((s, l) => s + l.credit, 0);
      assert.equal(debit, 104.125, 'journal debits keep the third decimal');
      assert.equal(credit, 104.125, 'journal credits keep the third decimal');
      assert.equal(debit, credit, 'the KWD journal balances');
      const inventory = lines.find((l) => l.account_id === 21);
      const shortage = lines.find((l) => l.account_id === 23);
      const payable = lines.find((l) => l.account_id === 22);
      assert.equal(inventory?.debit, 98, 'inventory leg is the exact 3dp sum 42.875 + 55.125');
      assert.equal(shortage?.debit, 6.125, 'shortage leg is 6.125, not the old 2dp cut 6.13');
      assert.equal(payable?.credit, 104.125, 'goods credit is 104.125, not the old 104.13');
      const expense: any = await (db as any).selectFrom('expenses').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(expense.amount), 6.125, 'the shortage expense row keeps 6.125');
      const movement: any = await (db as any).selectFrom('stock_movements').selectAll()
        .where('product_id', '=', 5).executeTakeFirstOrThrow();
      assert.equal(Number(movement.total_cost), 42.875, 'movement total is the rounded group value');
      assert.equal(Number(movement.unit_cost), 6.125, 'movement unit cost is the landed cost');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: EGP end to end, same fixture — the 3dp receipt is
  // rounded to book digits FIRST, and the WAC follows the rounded
  // value so cost_price x qty reconciles with the 1140 leg.
  {
    const db = await makeDb('EGP');
    try {
      const service = makeService(db);
      await postReceipt(db, service);
      assert.equal(await countRows(db, 'import_inventory_receipts'), 1, 'the receipt posts');
      const p5 = await product(db, 5);
      assert.equal(Number(p5.cost_price), 5.073645, 'WAC blends the ROUNDED 42.88: (100x5 + 42.88) / 107');
      const p6 = await product(db, 6);
      assert.equal(Number(p6.cost_price), 6.125556, 'short item WAC blends the rounded 55.13');
      const lines = await journalLines(db);
      const debit = lines.reduce((s, l) => s + l.debit, 0);
      const credit = lines.reduce((s, l) => s + l.credit, 0);
      assert.equal(debit, 104.14, 'EGP debits are the rounded totals 98.01 + 6.13');
      assert.equal(credit, 104.14, 'EGP credits match after the dust correction');
      assert.equal(debit, credit, 'the EGP journal balances despite the rounding');
      const inventory = lines.find((l) => l.account_id === 21);
      const payable = lines.find((l) => l.account_id === 22);
      assert.equal(inventory?.debit, 98.01, 'inventory leg is 42.88 + 55.13');
      assert.equal(payable?.credit, 104.14, 'goods credit absorbs the rounding dust');
      const expense: any = await (db as any).selectFrom('expenses').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(expense.amount), 6.13, 'the shortage expense row rounds to 6.13');
      const movement: any = await (db as any).selectFrom('stock_movements').selectAll()
        .where('product_id', '=', 5).executeTakeFirstOrThrow();
      assert.equal(Number(movement.total_cost), 42.88, 'movement total is the rounded group value');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: fail-closed wiring — a settings/rates currency
  // mismatch throws at addShipmentItem, fail-fast, before any
  // stock or journal write. The check lives in
  // calculateLandedCostInTransaction (tenantBaseCurrency), which
  // addShipmentItem calls after inserting the item row, so the
  // throw also rolls that insert back. The currency is tenant
  // config read from settings + currency_exchange_rates, both
  // known before any item exists, so no receipt-time check is
  // needed; the receipt re-checks the same invariant. Placement
  // is by recorded parent decision: keep the fail-fast throw at
  // addShipmentItem, pin it here.
  {
    const db = await makeDb('KWD');
    try {
      // The settings say KWD but the base rate row says EGP.
      await (db as any).updateTable('currency_exchange_rates')
        .set({ currency_code: 'EGP' } as never)
        .where('tenant_id', '=', 't1').execute();
      const service = makeService(db);
      const shipment = await service.createShipment('t1', {
        containerNumber: 'MSCU-W2X', supplierId: '9', exchangeRateAtArrival: 5,
      });
      await assert.rejects(
        async () => service.addShipmentItem('t1', shipment.id, { productId: 5, quantity: 7, factoryUnitPriceUsd: 1.225 }),
        /إعداد عملة الأساس/,
        'a currency mismatch must fail closed at addShipmentItem, before any item is costed',
      );
      assert.equal(await countRows(db, 'import_shipment_items'), 0, 'the failed add rolls its item row back');
      assert.equal(await countRows(db, 'import_inventory_receipts'), 0, 'no receipt may be posted');
      assert.equal(await countRows(db, 'journal_entries'), 0, 'no journal may be posted');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import inventory-cost WAC tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
