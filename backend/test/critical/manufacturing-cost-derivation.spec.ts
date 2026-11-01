/*
 * INV-MANUFACTURING-COST-DERIVATION: postManufacturingWorkOrder must
 * never derive overhead as a residual (stored total minus raw
 * materials). The old derivation debited the full stored total to
 * finished goods -- overstating Dr 1140 above the finished-goods
 * stock movement by exactly the by-product value -- left the
 * by-product stock increase with no journal leg at all, and
 * laundered any drift in wo.total_cost into "overhead" on 5400.
 *
 * THE RULE, driving the REAL poster on PGlite with seeded rows
 * stamped exactly as completeWorkOrder stamps them:
 * - The 5400 credit is ONLY work-centre operation costs plus the
 *   scaled BOM overhead, re-derived from their stored rows.
 * - Dr 1140 is the finished-goods value stamped on the
 *   manufacturing_production movement (finishedValue).
 * - By-products get their OWN Dr 1140 leg from the
 *   manufacturing_byproduct movements -- separate from the FG leg,
 *   never buried in 5400.
 * - The stored wo.total_cost feeds NO journal amount (only the
 *   zero-cost no-post gate): a wrong stored total cannot poison
 *   the journal when the components and movements agree.
 * - Components vs movements must reconcile: a difference of at
 *   most one minor unit (the codebase's maxAllowedDifference) is
 *   a rounding residue and posts to the 5190 variance account
 *   (unbuild convention); anything larger is data drift and fails
 *   closed with MANUFACTURING_COST_MISMATCH, posting nothing.
 * - A genuinely zero-cost order posts nothing and does not throw.
 * - Posting is idempotent per work order (existing journal returned).
 *
 * Deliberately NOT covered here: driving completeWorkOrder end to
 * end (pinned by manufacturing-zero-cost-work-order.spec.ts) and
 * the restaurant auto-produce caller (it stamps the same rows the
 * poster reads -- consumptions, one production movement, stored
 * total -- with no operations or by-products, so its journal is
 * unchanged by construction).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;

async function journalLines(db: Kysely<Database>, workOrderId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{ code: string; debit: string; credit: string }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'manufacturing_work_order' AND e.source_id = ${workOrderId} ORDER BY l.id`.execute(db);
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
}

async function journalCount(db: Kysely<Database>, workOrderId: number): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM journal_entries WHERE source_type = 'manufacturing_work_order' AND source_id = ${workOrderId}`.execute(db);
  return Number(rows.rows[0].n);
}

async function seedOrder(
  db: Kysely<Database>,
  id: number,
  opts: {
    bomQuantity: number; overhead: number; qty: number; storedTotal: number;
    rm: number; ops: number; fgMovement: number | null; byMovement: number;
  },
): Promise<void> {
  await sql`INSERT INTO manufacturing_boms (id, product_id, quantity, overhead_cost, expected_cost, is_active, tenant_id, account_id) VALUES (${id}, 1, ${opts.bomQuantity}, ${opts.overhead}, 0, true, 't1', 'a1')`.execute(db);
  await sql`INSERT INTO manufacturing_work_orders (id, bom_id, status, quantity_to_produce, produced_quantity, source_location_id, destination_location_id, total_cost, completed_at, created_by, tenant_id, account_id) VALUES (${id}, ${id}, 'done', ${opts.qty}, ${opts.qty}, 1, 1, ${opts.storedTotal}, NOW(), 1, 't1', 'a1')`.execute(db);
  if (opts.rm > 0) {
    await sql`INSERT INTO manufacturing_wo_consumptions (tenant_id, account_id, work_order_id, component_product_id, quantity_consumed, unit_cost, line_total) VALUES ('t1', 'a1', ${id}, 2, 1, ${opts.rm}, ${opts.rm})`.execute(db);
  }
  if (opts.ops > 0) {
    await sql`INSERT INTO manufacturing_wo_operations (tenant_id, account_id, work_order_id, work_center_id, operation_name, sequence, duration_hours, hourly_cost, total_cost, status) VALUES ('t1', 'a1', ${id}, 1, 'Cutting', 1, 1, ${opts.ops}, ${opts.ops}, 'completed')`.execute(db);
  }
  if (opts.fgMovement !== null) {
    await sql`INSERT INTO stock_movements (tenant_id, account_id, product_id, movement_type, qty, before_qty, after_qty, reference_type, reference_id, location_id, created_by, unit_cost, total_cost) VALUES ('t1', 'a1', 1, 'manufacturing_production', ${opts.qty}, 0, ${opts.qty}, 'manufacturing_work_order', ${id}, 1, 1, 0, ${opts.fgMovement})`.execute(db);
  }
  if (opts.byMovement > 0) {
    await sql`INSERT INTO stock_movements (tenant_id, account_id, product_id, movement_type, qty, before_qty, after_qty, reference_type, reference_id, location_id, created_by, unit_cost, total_cost) VALUES ('t1', 'a1', 3, 'manufacturing_byproduct', 1, 0, 1, 'manufacturing_work_order', ${id}, 1, 1, 0, ${opts.byMovement})`.execute(db);
  }
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
      CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', normal_balance text, is_active boolean DEFAULT true, is_tax boolean DEFAULT false, is_system boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE UNIQUE INDEX idx_accounting_accounts_tenant_code_uidx ON accounting_accounts (tenant_id, code);
      INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type) VALUES (1140,'t1','a1','1140','asset'), (5190,'t1','a1','5190','expense'), (5200,'t1','a1','5200','expense'), (5400,'t1','a1','5400','expense'), (7100,'t1','a1','7100','revenue');
      CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      INSERT INTO accounting_settings VALUES (1,'t1','a1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
      INSERT INTO branches VALUES (1, 't1', 'Main', 1);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      INSERT INTO stock_locations VALUES (1, 't1', 'a1', 1, 'Main Store', 'MAIN', true, 'branch_stock');
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', '', '', true);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, product_id bigint, quantity numeric, overhead_cost numeric, expected_cost numeric, is_active boolean, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE manufacturing_bom_lines (id bigserial PRIMARY KEY, bom_id bigint, component_product_id bigint, quantity numeric, unit_name text, unit_multiplier numeric, waste_percentage numeric, expected_cost numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE manufacturing_work_orders (id bigint PRIMARY KEY, doc_no text, bom_id bigint, status text, quantity_to_produce numeric, produced_quantity numeric, source_location_id bigint, destination_location_id bigint, start_date timestamptz, end_date timestamptz, total_cost numeric, completed_at timestamptz, note text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, tenant_id text, account_id text);
      CREATE TABLE manufacturing_wo_consumptions (id bigserial PRIMARY KEY, tenant_id text, account_id text, work_order_id bigint, component_product_id bigint, quantity_consumed numeric, unit_cost numeric, line_total numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE manufacturing_wo_operations (id bigserial PRIMARY KEY, tenant_id text, account_id text, work_order_id bigint, work_center_id bigint, operation_name text, sequence int, duration_hours numeric, hourly_cost numeric, total_cost numeric, status text, notes text);
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    `);

    // Case 1: full shape -- RM 60 + ops 30 + scaled overhead 10 = 100;
    // FG movement 80, by-product 20. Old code debited 100 to FG and
    // hid the by-product leg; new code debits 80 + 20 separately.
    await seedOrder(db, 1, { bomQuantity: 2, overhead: 10, qty: 2, storedTotal: 100, rm: 60, ops: 30, fgMovement: 80, byMovement: 20 });
    const res1 = await posting.postManufacturingWorkOrder(db as never, 1, AUTH);
    assert.equal(res1.posted, true);
    assert.deepEqual(await journalLines(db, 1), [
      { code: '1140', debit: 80, credit: 0 },
      { code: '1140', debit: 20, credit: 0 },
      { code: '1140', debit: 0, credit: 60 },
      { code: '5400', debit: 0, credit: 40 },
    ]);

    // Case 2: pure overhead shape (no ops, no by-products) -- unchanged.
    await seedOrder(db, 2, { bomQuantity: 1, overhead: 20, qty: 2, storedTotal: 90, rm: 50, ops: 0, fgMovement: 90, byMovement: 0 });
    await posting.postManufacturingWorkOrder(db as never, 2, AUTH);
    assert.deepEqual(await journalLines(db, 2), [
      { code: '1140', debit: 90, credit: 0 },
      { code: '1140', debit: 0, credit: 50 },
      { code: '5400', debit: 0, credit: 40 },
    ]);

    // Case 3: a wrong stored total cannot poison the journal when the
    // components and movements agree (stored 500, real economics 100).
    await seedOrder(db, 3, { bomQuantity: 2, overhead: 10, qty: 2, storedTotal: 500, rm: 60, ops: 30, fgMovement: 80, byMovement: 20 });
    await posting.postManufacturingWorkOrder(db as never, 3, AUTH);
    assert.deepEqual(await journalLines(db, 3), [
      { code: '1140', debit: 80, credit: 0 },
      { code: '1140', debit: 20, credit: 0 },
      { code: '1140', debit: 0, credit: 60 },
      { code: '5400', debit: 0, credit: 40 },
    ]);

    // Case 4a: one-minor-unit residue debits 5190 (components 100,
    // recorded output 99.99).
    await seedOrder(db, 4, { bomQuantity: 1, overhead: 10, qty: 1, storedTotal: 100, rm: 60, ops: 30, fgMovement: 99.99, byMovement: 0 });
    await posting.postManufacturingWorkOrder(db as never, 4, AUTH);
    assert.deepEqual(await journalLines(db, 4), [
      { code: '1140', debit: 99.99, credit: 0 },
      { code: '1140', debit: 0, credit: 60 },
      { code: '5400', debit: 0, credit: 40 },
      { code: '5190', debit: 0.01, credit: 0 },
    ]);

    // Case 4b: one-minor-unit residue the other way credits 5190.
    await seedOrder(db, 5, { bomQuantity: 1, overhead: 10, qty: 1, storedTotal: 100, rm: 60, ops: 30, fgMovement: 100.01, byMovement: 0 });
    await posting.postManufacturingWorkOrder(db as never, 5, AUTH);
    assert.deepEqual(await journalLines(db, 5), [
      { code: '1140', debit: 100.01, credit: 0 },
      { code: '1140', debit: 0, credit: 60 },
      { code: '5400', debit: 0, credit: 40 },
      { code: '5190', debit: 0, credit: 0.01 },
    ]);

    // Case 5: drift beyond one minor unit fails closed, posts nothing.
    await seedOrder(db, 6, { bomQuantity: 1, overhead: 10, qty: 1, storedTotal: 100, rm: 60, ops: 30, fgMovement: 90, byMovement: 0 });
    await assert.rejects(
      posting.postManufacturingWorkOrder(db as never, 6, AUTH),
      (err: any) => err && err.code === 'MANUFACTURING_COST_MISMATCH' && err.statusCode === 409,
    );
    assert.equal(await journalCount(db, 6), 0);

    // Case 6: genuinely zero-cost posts nothing and does not throw.
    await seedOrder(db, 7, { bomQuantity: 1, overhead: 0, qty: 1, storedTotal: 0, rm: 0, ops: 0, fgMovement: 0, byMovement: 0 });
    const res7 = await posting.postManufacturingWorkOrder(db as never, 7, AUTH);
    assert.equal(res7.posted, false);
    assert.equal(await journalCount(db, 7), 0);

    // Case 7: by-product value beyond the components fails closed.
    await seedOrder(db, 8, { bomQuantity: 1, overhead: 10, qty: 1, storedTotal: 100, rm: 60, ops: 30, fgMovement: 0, byMovement: 120 });
    await assert.rejects(
      posting.postManufacturingWorkOrder(db as never, 8, AUTH),
      (err: any) => err && err.code === 'MANUFACTURING_COST_MISMATCH' && err.statusCode === 409,
    );
    assert.equal(await journalCount(db, 8), 0);

    // Case 8: idempotency -- re-posting returns the existing journal.
    const again = await posting.postManufacturingWorkOrder(db as never, 1, AUTH);
    assert.equal(again.posted, false);
    assert.equal(again.journalEntryId, res1.journalEntryId);
    assert.equal(await journalCount(db, 1), 1);

    // Case 9: source pin -- no residual derivation, both new reads present.
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/accounting/accounting-posting.service.ts'),
      'utf8',
    );
    const start = source.indexOf('async postManufacturingWorkOrder(');
    const end = source.indexOf('async postManufacturingUnbuildOrder(');
    assert.ok(start > -1 && end > start);
    const body = source.slice(start, end);
    assert.ok(!body.includes('fgCost - rmCost'), 'residual derivation must be gone');
    assert.ok(body.includes('manufacturing_wo_operations'), 'operations must be read');
    assert.ok(body.includes('manufacturing_byproduct'), 'by-product movements must be read');
    assert.ok(!body.includes('manufacturing_consumption'), 'consumption movements are not a poster input');

    console.log('manufacturing cost derivation checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
