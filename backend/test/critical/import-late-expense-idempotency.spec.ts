/*
New file: backend/test/critical/import-late-expense-idempotency.spec.ts
Pins late-expense idempotency, allocation method and book-digit
rounding (INV-IMPORT-LATE-EXPENSE-IDEMPOTENCY).

WHAT WAS WRONG: processLateShipmentExpense had no idempotency key,
so a retried submission posted twice; it always allocated by
value share, ignoring the shipment's cost_allocation_method; and
per-item COGS/inventory adjustments were unrounded while the
header totals used toFixed(2), so the parts could drift from the
journal totals.

WHAT THIS PINS, driving the real processLateShipmentExpense on
PGlite through the real posting boundary:
- A second submit with the same idempotency key is rejected with
  a conflict and posts nothing more: exactly one journal, one
  event row, one WAC movement.
- A weight-method shipment allocates by weight: with equal
  quantities and prices but weights 1kg vs 3kg, the heavy item
  carries three quarters of the expense.
- Per-item adjustments at book digits sum exactly to the journal
  totals: debits equal credits, and the credit equals the rounded
  expense amount.
- The key is optional: a keyless call keeps the old behaviour
  (posts normally), and a duplicate key on a DIFFERENT shipment
  is allowed (the index is per shipment).
- Migration 0280 itself is proven on a minimal table: up() adds
  the column and the partial unique index.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { up as migrate0280Up } from '../../src/database/migrations/2040000000280_late_expense_idempotency_key';

async function makeDb(): Promise<Kysely<Database>> {
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
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, feasibility_data text);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, supplier_id bigint, project_id text, container_number text, status text, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric);
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, received_quantity numeric, factory_unit_price_usd numeric, landed_cost_egp numeric, shortage_handling_method text, gross_weight_kg_unit numeric, cbm_unit numeric);
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text, review_reason text, posted_at timestamptz, created_by bigint, journal_entry_id bigint);
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, updated_at timestamptz);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, created_by bigint, journal_entry_id bigint, idempotency_key text, CONSTRAINT chk_import_late_amounts CHECK (total_amount_egp > 0 AND inventory_amount_egp >= 0 AND cogs_amount_egp >= 0 AND abs((inventory_amount_egp + cogs_amount_egp) - total_amount_egp) <= 0.02));
    CREATE UNIQUE INDEX uq_late_expense_events_tenant_shipment_key ON import_late_expense_events (tenant_id, shipment_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint);
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false);
    INSERT INTO branches VALUES (2, 't1', 'Main Branch');
    INSERT INTO stock_locations VALUES (10, 't1', 2, 'Main Warehouse');
    INSERT INTO suppliers VALUES (9, 't1', 'Shipment Supplier', '', '', 0, true, NOW());
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

async function seedShipment(
  db: Kysely<Database>,
  opts: { shipmentId: string; method: string; items: Array<{ id: string; productId: number; qty: number; priceUsd: number; weight: number; cbm: number; onHand: number }> },
): Promise<void> {
  for (const it of opts.items) {
    await db.insertInto('products' as never).values({
      id: it.productId, tenant_id: 't1', account_id: 't1', name: `P${it.productId}`,
      stock_qty: it.qty, reserved_qty: 0, cost_price: 500, updated_at: new Date(),
    } as never).execute();
    await db.insertInto('product_location_stock' as never).values({
      tenant_id: 't1', account_id: 't1', product_id: it.productId, branch_id: 2,
      location_id: 10, qty: it.qty, reserved_qty: 0,
    } as never).execute();
  }
  await db.insertInto('import_shipments' as never).values({
    id: opts.shipmentId, tenant_id: 't1', supplier_id: 9, project_id: null,
    container_number: `MSCU-${opts.shipmentId}`, status: 'Arrived',
    cost_allocation_method: opts.method,
    late_expenses_total_egp: 0, late_cogs_adjustment_egp: 0, late_inventory_adjustment_egp: 0,
  } as never).execute();
  for (const it of opts.items) {
    await db.insertInto('import_shipment_items' as never).values({
      id: it.id, tenant_id: 't1', shipment_id: opts.shipmentId, product_id: it.productId,
      quantity: it.qty, received_quantity: it.qty, factory_unit_price_usd: it.priceUsd,
      landed_cost_egp: 500, shortage_handling_method: 'capitalize',
      gross_weight_kg_unit: it.weight, cbm_unit: it.cbm,
    } as never).execute();
    await db.insertInto('import_inventory_lots' as never).values({
      tenant_id: 't1', lot_number: `LOT-${it.id}`, project_id: null, shipment_id: opts.shipmentId,
      shipment_item_id: it.id, product_id: it.productId, location_id: 10,
      initial_quantity: it.qty, remaining_quantity: it.onHand, unit_landed_cost_egp: 500,
      status: 'active', receipt_date: '2026-11-02', updated_at: new Date(),
    } as never).execute();
  }
  await db.insertInto('import_inventory_receipts' as never).values({
    tenant_id: 't1', shipment_id: opts.shipmentId, state: 'posted', review_reason: null,
    posted_at: new Date(), created_by: 1, journal_entry_id: null,
  } as never).execute();
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function main(): Promise<void> {
  // Case 1: double submit with the same key posts once.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, {
        shipmentId: 'sh-1', method: 'value',
        items: [
          { id: 'item-1', productId: 5, qty: 10, priceUsd: 10, weight: 1, cbm: 0.1, onHand: 6 },
          { id: 'item-2', productId: 6, qty: 10, priceUsd: 10, weight: 1, cbm: 0.1, onHand: 10 },
        ],
      });
      const dto = { lateExpenseAmount: 1000, title: 'Demurrage', idempotencyKey: 'late-key-1' };
      const first = await service.processLateShipmentExpense('t1', 1, 'sh-1', dto);
      assert.equal(first.success, true);
      await assert.rejects(
        async () => service.processLateShipmentExpense('t1', 1, 'sh-1', dto),
        /عدم التكرار/,
        'A retry with the same key must be rejected as a duplicate',
      );
      assert.equal(await countRows(db, 'journal_entries'), 1, 'Exactly one journal may be posted');
      assert.equal(await countRows(db, 'import_late_expense_events'), 1, 'Exactly one event row may exist');
      const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 5).executeTakeFirstOrThrow();
      assert.equal(Number(product.cost_price), 530, 'WAC moves once: 500 + 300 inventory adj / 10 on hand');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: weight-method shipment allocates by weight.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, {
        shipmentId: 'sh-2', method: 'weight',
        items: [
          { id: 'item-a', productId: 7, qty: 10, priceUsd: 10, weight: 1, cbm: 0.1, onHand: 10 },
          { id: 'item-b', productId: 8, qty: 10, priceUsd: 10, weight: 3, cbm: 0.1, onHand: 10 },
        ],
      });
      await service.processLateShipmentExpense('t1', 1, 'sh-2', { lateExpenseAmount: 1000, title: 'Freight top-up' });
      // All on hand: the whole expense capitalises to inventory.
      // Weight shares: 10kg vs 30kg -> 250 vs 750.
      const light: any = await (db as any).selectFrom('import_shipment_items').selectAll().where('id', '=', 'item-a').executeTakeFirstOrThrow();
      const heavy: any = await (db as any).selectFrom('import_shipment_items').selectAll().where('id', '=', 'item-b').executeTakeFirstOrThrow();
      assert.equal(Number(light.landed_cost_egp), 525, 'Light item: 500 + 250/10');
      assert.equal(Number(heavy.landed_cost_egp), 575, 'Heavy item: 500 + 750/10');
      // A weight-method shipment with a missing unit weight fails closed.
      await seedShipment(db, {
        shipmentId: 'sh-2b', method: 'weight',
        items: [
          { id: 'item-c', productId: 11, qty: 10, priceUsd: 10, weight: 0, cbm: 0.1, onHand: 10 },
        ],
      });
      await assert.rejects(
        async () => service.processLateShipmentExpense('t1', 1, 'sh-2b', { lateExpenseAmount: 100, title: 'No weight' }),
        /وزن الوحدة/,
        'Weight allocation without a unit weight must fail closed',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 3: rounded parts sum exactly to the journal totals.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, {
        shipmentId: 'sh-3', method: 'value',
        items: [
          { id: 'item-x', productId: 12, qty: 3, priceUsd: 10, weight: 1, cbm: 0.1, onHand: 1 },
          { id: 'item-y', productId: 13, qty: 3, priceUsd: 10, weight: 1, cbm: 0.1, onHand: 2 },
          { id: 'item-z', productId: 14, qty: 3, priceUsd: 10, weight: 1, cbm: 0.1, onHand: 3 },
        ],
      });
      // 100.01 split three ways with mixed sold/on-hand: raw parts
      // carry repeating decimals; the rounded parts must still sum
      // exactly to the journal.
      const result = await service.processLateShipmentExpense('t1', 1, 'sh-3', { lateExpenseAmount: 100.01, title: 'Rounding probe' });
      assert.equal(result.allocation.lateExpenseAmount, 100.01);
      const lines: any[] = await (db as any).selectFrom('journal_entry_lines').selectAll().execute();
      const debits = lines.reduce((s, l) => s + Number(l.debit), 0);
      const credits = lines.reduce((s, l) => s + Number(l.credit), 0);
      assert.equal(debits, credits, 'Journal must balance');
      assert.equal(credits, 100.01, 'Credit equals the rounded expense total');
      const event: any = await (db as any).selectFrom('import_late_expense_events').selectAll().executeTakeFirstOrThrow();
      assert.equal(
        Number(event.inventory_amount_egp) + Number(event.cogs_amount_egp),
        100.01,
        'Event split sums exactly to the total',
      );
      const shipment: any = await (db as any).selectFrom('import_shipments').selectAll().where('id', '=', 'sh-3').executeTakeFirstOrThrow();
      assert.equal(Number(shipment.late_expenses_total_egp), 100.01, 'Shipment header total matches');
      // Per-item applied increments use the ROUNDED shares (the last
      // item absorbs the remainder): item-x 33.33/3, item-z 33.35/3.
      // Unrounded application would give 511.112222 for both.
      const itemX: any = await (db as any).selectFrom('import_shipment_items').selectAll().where('id', '=', 'item-x').executeTakeFirstOrThrow();
      const itemZ: any = await (db as any).selectFrom('import_shipment_items').selectAll().where('id', '=', 'item-z').executeTakeFirstOrThrow();
      assert.equal(Number(itemX.landed_cost_egp), 511.11, 'Item-x increment uses its rounded share');
      assert.equal(Number(itemZ.landed_cost_egp), 511.116667, 'Item-z increment uses its rounded share plus the remainder');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: keyless calls keep the old behaviour; the same key on a
  // different shipment is allowed.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, {
        shipmentId: 'sh-4', method: 'value',
        items: [{ id: 'item-k', productId: 15, qty: 10, priceUsd: 10, weight: 1, cbm: 0.1, onHand: 10 }],
      });
      await seedShipment(db, {
        shipmentId: 'sh-5', method: 'value',
        items: [{ id: 'item-m', productId: 16, qty: 10, priceUsd: 10, weight: 1, cbm: 0.1, onHand: 10 }],
      });
      await service.processLateShipmentExpense('t1', 1, 'sh-4', { lateExpenseAmount: 100, title: 'Keyless' });
      await service.processLateShipmentExpense('t1', 1, 'sh-4', { lateExpenseAmount: 50, title: 'Keyless again' });
      assert.equal(await countRows(db, 'journal_entries'), 2, 'Keyless calls post independently');
      await service.processLateShipmentExpense('t1', 1, 'sh-5', { lateExpenseAmount: 100, title: 'Shared key', idempotencyKey: 'shared-key' });
      const other = await service.processLateShipmentExpense('t1', 1, 'sh-4', { lateExpenseAmount: 100, title: 'Shared key', idempotencyKey: 'shared-key' });
      assert.equal(other.success, true, 'The same key on another shipment is a different dedup scope');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: migration 0280 itself adds the column + partial index.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE import_late_expense_events (
          id BIGSERIAL PRIMARY KEY, tenant_id TEXT, shipment_id TEXT, title TEXT,
          total_amount_egp NUMERIC(15, 2) NOT NULL, inventory_amount_egp NUMERIC(15, 2) NOT NULL,
          cogs_amount_egp NUMERIC(15, 2) NOT NULL, created_by BIGINT, journal_entry_id BIGINT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await migrate0280Up(db as any);
      const cols: any[] = await (db as any)
        .selectFrom('information_schema.columns' as never).selectAll()
        .where('table_name', '=', 'import_late_expense_events')
        .where('column_name', '=', 'idempotency_key')
        .execute();
      assert.equal(cols.length, 1, 'Migration up() must add the idempotency_key column');
      const indexes: any[] = await (db as any)
        .selectFrom('pg_indexes' as never).selectAll()
        .where('indexname', '=', 'uq_late_expense_events_tenant_shipment_key')
        .execute();
      assert.equal(indexes.length, 1, 'Migration up() must create the partial unique index');
      await db.insertInto('import_late_expense_events' as never).values({
        tenant_id: 't1', shipment_id: 'sh-9', title: 'A', total_amount_egp: 10,
        inventory_amount_egp: 10, cogs_amount_egp: 0, idempotency_key: 'k1',
      } as never).execute();
      await assert.rejects(
        async () => db.insertInto('import_late_expense_events' as never).values({
          tenant_id: 't1', shipment_id: 'sh-9', title: 'B', total_amount_egp: 10,
          inventory_amount_egp: 10, cogs_amount_egp: 0, idempotency_key: 'k1',
        } as never).execute(),
        (err: any) => err?.code === '23505',
        'The index must reject a duplicate key for the same shipment',
      );
    } finally {
      await db.destroy();
    }
  }

  console.log('Import late expense idempotency tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
