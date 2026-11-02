import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ReorderingRulesService } from '../../src/modules/inventory/services/reordering-rules.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Reorder evaluation pipeline (INV-REORDER-EVALUATION-PIPELINE).
 *
 * THE DEFECT, from the Slice 4 grounding (retail-slice4-inventory-
 * grounding.md, P1): `listRules` computed incoming stock from
 * purchase_orders status IN ('draft', 'pending', 'approved',
 * 'ordered'), while the real pipeline vocabulary is draft /
 * pending_approval / confirmed / partially_received / received /
 * cancelled, and 'approved' / 'ordered' have no writers anywhere in
 * the backend — so a confirmed, unreceived order contributed zero
 * incoming and the engine suggested ordering the same stock again.
 * `runEvaluation` ignored action_mode (a manual_review rule still
 * generated a draft order), ran with no transaction and no lock, and
 * minted order numbers with COUNT(*) + 1, unattended every 6 hours.
 *
 * THE SETTLED RULE — FLAGGED LOUDLY, it differs from the grounding
 * recommendation: the grounding recommended counting
 * pending_approval + confirmed + partially_received with drafts
 * excluded. Applied naively that duplicates: a generated order
 * carries status 'draft' until a human confirms it (confirmOrder is
 * the only draft-to-pipeline transition; drafts are editable and
 * deletable, and last_generated_po_id has no reader anywhere in the
 * backend), so a second run would see the same breach, find no
 * incoming, and generate another draft — every 6 hours, unbounded.
 * The settled rule therefore has TWO halves, and neither alone is
 * correct: (a) incoming counts ONLY the committed statuses
 * (pending_approval + confirmed + partially_received, quantity
 * minus received_quantity, trusted now that the Slice 3 P5 advance
 * writes received_quantity on receipt); (b) generation is quenched
 * while a LIVE draft order holding the same product at the same
 * warehouse (a warehouse-null draft quenches any warehouse for
 * that product) is still open. Cancelling or deleting the draft
 * lifts the suppression, and confirming it moves the order into
 * the committed statuses, where its remainder counts as incoming.
 * The trade-off is recorded plainly: a draft whose quantities a
 * user edits down still suppresses generation until the human
 * confirms, cancels, or deletes it — uncommitted intent is never
 * treated as stock, and no duplicate draft is ever generated.
 *
 * THE FIX: evaluation runs in one transaction under the per-tenant
 * reorder-evaluation advisory lock (the storefront/hr
 * pg_advisory_xact_lock pattern) plus FOR UPDATE locks on the
 * tenant active rule rows in id order, so scheduler and manual
 * runs serialise; manual_review rules are evaluated and reported
 * but generate nothing; generated order numbers derive from the
 * inserted row id via formatDailyDocumentNumber, as createOrder
 * does. breachedRulesCount now counts every breached rule
 * evaluated (including manual_review and draft-suppressed rules);
 * generatedOrdersCount counts only orders actually generated.
 *
 * DELIBERATELY UNCHANGED: PO line totals stay with the reorder
 * grouping engine (not the purchase-order-totals engine); order
 * -number days stay host-local as in createOrder; the scheduler
 * cadence and in-process flag are untouched (the lock, not the
 * scheduler, serialises runs); historical orders and rules keep
 * their numbers and statuses. Prospective only: no backfill, no
 * journal rewrite. This is not an end-to-end post on live
 * Postgres: the DDL here is a minimal fixture for the tables the
 * service reads and writes, and true two-process concurrency is
 * not proven on PGlite — the lock is pinned by source, and the
 * quench is proven by sequential re-evaluation.
 *
 * WHAT THIS PINS, driving the REAL ReorderingRulesService on
 * PGlite (fresh database per case; the audit log is a stubbed
 * no-op — no pinned assertion reads it):
 * - Case 1, confirmed order counts: on hand 10 + confirmed 60
 *   covers a min of 20, so nothing is generated.
 * - Case 2, partial receipt counts only the remainder: on hand 0
 *   + partially_received 60 with 20 received leaves incoming 40
 *   against a min of 50, so the generated item is 60, not 100.
 * - Case 3, pending_approval counts: on hand 10 + pending 30
 *   covers a min of 20, so nothing is generated.
 * - Case 4, draft quench: the first run generates one draft; a
 *   second run generates nothing; cancelling the draft lifts the
 *   suppression and the third run generates a second, differently
 *   numbered order.
 * - Case 5, manual_review generates nothing but is still counted
 *   as breached and still reported by listRules.
 * - Case 6, a draft at a different warehouse does not quench a
 *   rule scoped to another warehouse.
 * - Case 7, autoCreateOrders false evaluates without generating.
 * - Case 8, source pin + invariant pin.
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'tester', permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE reordering_rules (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, warehouse_id bigint, branch_id bigint, min_qty numeric, max_qty numeric, qty_multiple numeric, preferred_supplier_id bigint, action_mode text, is_active boolean, last_run_at timestamptz, last_trigger_status text, last_generated_po_id bigint, notes text, created_by bigint, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, barcode text, cost_price numeric, stock_qty numeric, reserved_qty numeric);
    CREATE TABLE suppliers (id bigserial PRIMARY KEY, tenant_id text, name text, phone text);
    CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, name text);
    CREATE TABLE branches (id bigserial PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, location_id bigint, qty numeric, reserved_qty numeric);
    CREATE TABLE purchase_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, supplier_id bigint, supplier_name text, supplier_phone text, warehouse_id bigint, warehouse_name text, subtotal numeric, tax_amount numeric, discount_amount numeric, total_amount numeric, status text, notes text, created_by bigint, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE purchase_order_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, purchase_order_id bigint, product_id bigint, product_name text, quantity numeric, received_quantity numeric, unit_cost numeric, tax_rate numeric, discount numeric, total numeric, notes text);
  `);
  return { pg, db };
}

function makeService(db: Kysely<Database>): ReorderingRulesService {
  const auditStub = { log: async () => undefined };
  return new ReorderingRulesService(db as any, auditStub as any);
}

// Explicit fixture ids leave the bigserial sequences behind; a
// generated insert would otherwise collide with a seeded row.
// Advance every sequence past the seeded maximum before evaluating.
async function advanceSequences(pg: PGlite): Promise<void> {
  await pg.exec(`
    SELECT setval(pg_get_serial_sequence('reordering_rules', 'id'), (SELECT MAX(id) FROM reordering_rules));
    SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT MAX(id) FROM products));
    SELECT setval(pg_get_serial_sequence('suppliers', 'id'), (SELECT MAX(id) FROM suppliers));
    SELECT setval(pg_get_serial_sequence('stock_locations', 'id'), (SELECT MAX(id) FROM stock_locations));
    SELECT setval(pg_get_serial_sequence('branches', 'id'), (SELECT MAX(id) FROM branches));
    SELECT setval(pg_get_serial_sequence('purchase_orders', 'id'), (SELECT MAX(id) FROM purchase_orders));
    SELECT setval(pg_get_serial_sequence('purchase_order_items', 'id'), (SELECT MAX(id) FROM purchase_order_items));
  `);
}

async function seedBase(db: Kysely<Database>): Promise<void> {
  await db.insertInto('stock_locations' as never).values({ id: 1, tenant_id: 't1', branch_id: null, name: 'Main' } as never).execute();
  await db.insertInto('stock_locations' as never).values({ id: 2, tenant_id: 't1', branch_id: null, name: 'Second' } as never).execute();
  await db.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', name: 'Supplier', phone: null } as never).execute();
  await db.insertInto('products' as never).values({ id: 10, tenant_id: 't1', account_id: 'a1', name: 'Widget', barcode: null, cost_price: 10, stock_qty: 0, reserved_qty: 0 } as never).execute();
}

async function seedRule(
  db: Kysely<Database>,
  opts: { id: number; warehouseId?: number | null; min: number; max: number; actionMode?: string; stockQty?: number },
): Promise<void> {
  await db
    .insertInto('reordering_rules' as never)
    .values({
      id: opts.id,
      tenant_id: 't1',
      account_id: 'a1',
      product_id: 10,
      warehouse_id: opts.warehouseId ?? null,
      branch_id: null,
      min_qty: opts.min,
      max_qty: opts.max,
      qty_multiple: 1,
      preferred_supplier_id: 9,
      action_mode: opts.actionMode ?? 'auto_draft_po',
      is_active: true,
      last_run_at: null,
      last_trigger_status: 'normal',
      last_generated_po_id: null,
      notes: null,
      created_by: 1,
    } as never)
    .execute();
  if (opts.stockQty !== undefined) {
    await db
      .updateTable('products' as never)
      .set({ stock_qty: opts.stockQty } as never)
      .where('id' as never, '=', 10 as never)
      .execute();
  }
}

async function seedPo(
  db: Kysely<Database>,
  opts: { id: number; status: string; warehouseId?: number | null; items: Array<{ id: number; quantity: number; received: number }> },
): Promise<void> {
  await db
    .insertInto('purchase_orders' as never)
    .values({
      id: opts.id,
      tenant_id: 't1',
      account_id: 'a1',
      order_number: `PO-SEED-${opts.id}`,
      supplier_id: 9,
      supplier_name: 'Supplier',
      supplier_phone: null,
      warehouse_id: opts.warehouseId ?? null,
      warehouse_name: null,
      subtotal: 0,
      tax_amount: 0,
      discount_amount: 0,
      total_amount: 0,
      status: opts.status,
      notes: null,
      created_by: 1,
    } as never)
    .execute();
  for (const item of opts.items) {
    await db
      .insertInto('purchase_order_items' as never)
      .values({
        id: item.id,
        tenant_id: 't1',
        account_id: 'a1',
        purchase_order_id: opts.id,
        product_id: 10,
        product_name: 'Widget',
        quantity: item.quantity,
        received_quantity: item.received,
        unit_cost: 10,
        tax_rate: 0,
        discount: 0,
        total: item.quantity * 10,
        notes: null,
      } as never)
      .execute();
  }
}

async function readPos(db: Kysely<Database>): Promise<any[]> {
  const orders = (await db.selectFrom('purchase_orders' as never).selectAll().execute()) as any[];
  orders.sort((a, b) => Number(a.id) - Number(b.id));
  for (const order of orders) {
    order.items = (await db
      .selectFrom('purchase_order_items' as never)
      .selectAll()
      .where('purchase_order_id' as never, '=', order.id)
      .execute()) as any[];
  }
  return orders;
}

async function main(): Promise<void> {
  // Case 1: a confirmed, unreceived order counts in full.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedRule(db, { id: 1, min: 20, max: 100, stockQty: 10 });
      await seedPo(db, { id: 1, status: 'confirmed', items: [{ id: 1, quantity: 60, received: 0 }] });
      await advanceSequences(pg);
      const service = makeService(db);
      const listed = await service.listRules({}, auth);
      assert.equal(listed.rules[0].incomingQty, 60);
      assert.equal(listed.rules[0].isBreached, false);
      const result = await service.runEvaluation({}, auth);
      assert.equal(result.breachedRulesCount, 0);
      assert.equal(result.generatedOrdersCount, 0);
      const orders = await readPos(db);
      assert.equal(orders.length, 1);
      assert.equal(orders[0].status, 'confirmed');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: a partially received order contributes quantity minus
  // received_quantity only.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedRule(db, { id: 1, min: 50, max: 100, stockQty: 0 });
      await seedPo(db, { id: 1, status: 'partially_received', items: [{ id: 1, quantity: 60, received: 20 }] });
      await advanceSequences(pg);
      const service = makeService(db);
      const listed = await service.listRules({}, auth);
      assert.equal(listed.rules[0].incomingQty, 40);
      assert.equal(listed.rules[0].isBreached, true);
      assert.equal(listed.rules[0].suggestedOrderQty, 60);
      const result = await service.runEvaluation({}, auth);
      assert.equal(result.generatedOrdersCount, 1);
      const orders = await readPos(db);
      assert.equal(orders.length, 2);
      assert.equal(orders[1].status, 'draft');
      assert.equal(Number(orders[1].items[0].quantity), 60);
      assert.match(orders[1].order_number, /^PO-\d{6}-\d{4,}$/);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a pending_approval order counts in full.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedRule(db, { id: 1, min: 20, max: 100, stockQty: 10 });
      await seedPo(db, { id: 1, status: 'pending_approval', items: [{ id: 1, quantity: 30, received: 0 }] });
      await advanceSequences(pg);
      const service = makeService(db);
      const listed = await service.listRules({}, auth);
      assert.equal(listed.rules[0].incomingQty, 30);
      assert.equal(listed.rules[0].isBreached, false);
      const result = await service.runEvaluation({}, auth);
      assert.equal(result.generatedOrdersCount, 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: draft quench — generate once, suppress the second run,
  // and regenerate after the draft is cancelled, with a new number.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedRule(db, { id: 1, min: 20, max: 100, stockQty: 0 });
      await advanceSequences(pg);
      const service = makeService(db);
      const first = await service.runEvaluation({}, auth);
      assert.equal(first.generatedOrdersCount, 1);
      const firstNumber = first.generatedOrders[0].order_number;
      assert.match(firstNumber, /^PO-\d{6}-\d{4,}$/);
      const second = await service.runEvaluation({}, auth);
      assert.equal(second.breachedRulesCount, 1);
      assert.equal(second.generatedOrdersCount, 0);
      assert.equal((await readPos(db)).length, 1);
      await db
        .updateTable('purchase_orders' as never)
        .set({ status: 'cancelled' } as never)
        .where('id' as never, '=', Number(first.generatedOrders[0].id) as never)
        .execute();
      const third = await service.runEvaluation({}, auth);
      assert.equal(third.generatedOrdersCount, 1);
      assert.notEqual(third.generatedOrders[0].order_number, firstNumber);
      assert.equal((await readPos(db)).length, 2);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: manual_review is evaluated and reported, never generated.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedRule(db, { id: 1, min: 20, max: 100, stockQty: 0, actionMode: 'manual_review' });
      await advanceSequences(pg);
      const service = makeService(db);
      const listed = await service.listRules({}, auth);
      assert.equal(listed.rules[0].isBreached, true);
      const result = await service.runEvaluation({}, auth);
      assert.equal(result.breachedRulesCount, 1);
      assert.equal(result.generatedOrdersCount, 0);
      assert.equal((await readPos(db)).length, 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 6: a draft at a different warehouse does not quench.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await db
        .insertInto('product_location_stock' as never)
        .values({ tenant_id: 't1', product_id: 10, location_id: 1, qty: 0, reserved_qty: 0 } as never)
        .execute();
      await seedRule(db, { id: 1, warehouseId: 1, min: 20, max: 100, stockQty: 0 });
      await seedPo(db, { id: 1, status: 'draft', warehouseId: 2, items: [{ id: 1, quantity: 100, received: 0 }] });
      await advanceSequences(pg);
      const service = makeService(db);
      const result = await service.runEvaluation({}, auth);
      assert.equal(result.generatedOrdersCount, 1);
      assert.equal(result.generatedOrders[0].warehouse_id, 1);
    } finally {
      await db.destroy();
    }
  }

  // Case 7: autoCreateOrders false evaluates without generating.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedRule(db, { id: 1, min: 20, max: 100, stockQty: 0 });
      await advanceSequences(pg);
      const service = makeService(db);
      const result = await service.runEvaluation({ autoCreateOrders: false }, auth);
      assert.equal(result.breachedRulesCount, 1);
      assert.equal(result.generatedOrdersCount, 0);
      assert.equal((await readPos(db)).length, 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 8: source pin + invariant pin.
  {
    const source = readFileSync(
      resolve(__dirname, '../../src/modules/inventory/services/reordering-rules.service.ts'),
      'utf8',
    );
    const evalStart = source.indexOf('async evaluateRules(');
    assert.ok(evalStart > 0, 'evaluateRules exists');
    const evalBody = source.slice(evalStart, source.indexOf('async listRules(', evalStart + 1));
    assert.ok(evalBody.includes('REORDER_INCOMING_STATUSES'), 'the incoming query must use the committed-status list');
    assert.ok(
      source.includes("const REORDER_INCOMING_STATUSES: string[] = ['pending_approval', 'confirmed', 'partially_received'];"),
      'the committed-status list must be exact',
    );
    const runStart = source.indexOf('async runEvaluation(');
    assert.ok(runStart > 0, 'runEvaluation exists');
    const runBody = source.slice(runStart);
    assert.ok(runBody.includes('pg_advisory_xact_lock'), 'evaluation must take the per-tenant advisory lock');
    assert.ok(runBody.includes('reorder-evaluation:'), 'the advisory lock key must name reorder evaluation');
    assert.ok(runBody.includes('.forUpdate()'), 'evaluation must lock the rule rows');
    assert.ok(runBody.includes("formatDailyDocumentNumber('PO'"), 'numbers must derive from the inserted row id');
    assert.ok(runBody.includes('randomUUID'), 'the temporary number must be a random placeholder, as in createOrder');
    assert.ok(runBody.includes('manual_review'), 'manual_review rules must be honoured in the evaluation body');
    assert.ok(runBody.includes('hasOpenDraft'), 'the draft quench must live in the evaluation body');
    assert.ok(!runBody.includes('count('), 'no row-count numbering may remain in the evaluation path');
    assert.ok(!runBody.includes('getDailyDocumentPrefix'), 'the daily-count prefix helper must be gone from the service');
    assert.ok(!source.includes("['draft', 'pending', 'approved', 'ordered']"), 'the dead status list must be gone');
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-REORDER-EVALUATION-PIPELINE').length - 1, 1, 'the invariant entry must exist exactly once');
  }

  console.log('reorder-evaluation-pipeline: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
