/*
 * INV-MANUFACTURING-OVERHEAD-UNIFICATION: the scaled BOM overhead --
 * BOM overhead_cost expanded by produced quantity over BOM quantity,
 * rounded once at tenant book digits -- is computed by exactly ONE
 * pure function, scaledBomOverhead, called by work-order
 * completion, the work-order poster, and the restaurant
 * auto-produce path. No inline copy of the formula remains.
 *
 * GROUNDING NOTE: the unification re-inventory listed TWO copies
 * (completion and poster). Live code held a THIRD with the same
 * arithmetic in the restaurant auto-produce path (sales-write),
 * scaling by its shortfall quantity. Its BOM-quantity guard above
 * the formula fails closed on a non-finite or non-positive BOM
 * quantity, so the shared function's `|| 1` fallback can never
 * fire there; all three are unified, with each caller keeping its
 * own quantity coercion (the poster passes quantity_to_produce
 * || 0). Digits are a REQUIRED parameter of the shared function;
 * it never silently defaults to two decimals. The sign of the
 * overhead is preserved (no clamping); negative-component guards
 * stay at the callers that own them.
 *
 * THE RULE, driving the REAL poster on PGlite plus the pure
 * function imported from production code:
 * - scaledBomOverhead(100, 2, 3, 2) is 66.67 (rounding, not
 *   truncation); scaling above the BOM quantity, zero overhead,
 *   zero quantity, the bomQuantity || 1 fallback, 3dp books, and
 *   negative passthrough are pinned.
 * - A poster journal for bomQuantity 3, overhead 100, qty 2
 *   credits 5400 exactly 66.67 (ops 0), proving the poster
 *   computes through the shared function, not a residual.
 * - Source pin: no inline overhead multiplication remains in any
 *   of the three call-site files.
 *
 * Deliberately NOT covered here: driving completeWorkOrder end to
 * end (pinned by manufacturing-zero-cost-work-order.spec.ts, run
 * as a regression for this package) and the restaurant
 * auto-produce path end to end (its guard and arithmetic are
 * unchanged in shape; only the call target moved). The stored
 * wo.total_cost cross-check in the poster is unchanged.
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
import { scaledBomOverhead } from '../../src/modules/manufacturing/engines/manufacturing-overhead.engine';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;

async function journalLines(db: Kysely<Database>, workOrderId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{ code: string; debit: string; credit: string }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'manufacturing_work_order' AND e.source_id = ${workOrderId} ORDER BY l.id`.execute(db);
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
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
  // Pure-function cases, driving the production engine directly.
  assert.equal(scaledBomOverhead(100, 2, 3, 2), 66.67);
  assert.equal(scaledBomOverhead(10, 2, 2, 2), 10);
  assert.equal(scaledBomOverhead(20, 2, 1, 2), 40);
  assert.equal(scaledBomOverhead(0, 5, 2, 2), 0);
  assert.equal(scaledBomOverhead(100, 0, 2, 2), 0);
  assert.equal(scaledBomOverhead(100, 2, 0, 2), 200);
  assert.equal(scaledBomOverhead(100, 2, null as unknown as number, 2), 200);
  assert.equal(scaledBomOverhead(null as unknown as number, 2, 2, 2), 0);
  assert.equal(scaledBomOverhead(100, 1, 3, 3), 33.333);
  assert.equal(scaledBomOverhead(-10, 2, 2, 2), -10);

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

    // Real poster case: bomQuantity 3, overhead 100, qty 2, no ops.
    // Scaled overhead is 66.67; RM 33.33; FG movement 100. The 5400
    // credit must be exactly the scaled overhead (66.67), proving
    // the poster computes through the shared function.
    await seedOrder(db, 11, { bomQuantity: 3, overhead: 100, qty: 2, storedTotal: 100, rm: 33.33, ops: 0, fgMovement: 100, byMovement: 0 });
    const res = await posting.postManufacturingWorkOrder(db as never, 11, AUTH);
    assert.equal(res.posted, true);
    assert.deepEqual(await journalLines(db, 11), [
      { code: '1140', debit: 100, credit: 0 },
      { code: '1140', debit: 0, credit: 33.33 },
      { code: '5400', debit: 0, credit: 66.67 },
    ]);

    // Source pin: all three call sites call the shared function and
    // no inline overhead multiplication remains in any of them.
    const readSrc = (rel: string): string => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
    const completion = readSrc('../../src/modules/manufacturing/services/manufacturing.service.ts');
    assert.ok(completion.includes('scaledBomOverhead('), 'completion must call scaledBomOverhead');
    assert.ok(!completion.includes('overheadCost * (qtyToProduce / bomQuantity)'), 'inline formula must be gone from completion');
    const posterSource = readSrc('../../src/modules/accounting/services/inventory-manufacturing-cash-posting.service.ts');
    const posterStart = posterSource.indexOf('async postManufacturingWorkOrder(');
    const posterEnd = posterSource.indexOf('async postManufacturingUnbuildOrder(');
    assert.ok(posterStart > -1 && posterEnd > posterStart);
    const posterBody = posterSource.slice(posterStart, posterEnd);
    assert.ok(posterBody.includes('scaledBomOverhead('), 'poster must call scaledBomOverhead');
    assert.ok(!posterBody.includes('overhead_cost || 0) * ('), 'inline formula must be gone from poster');
    const salesWrite = readSrc('../../src/modules/sales/services/sales-write.service.ts');
    assert.ok(salesWrite.includes('scaledBomOverhead('), 'auto-produce path must call scaledBomOverhead');
    assert.ok(!salesWrite.includes('overhead_cost || 0) * (baseShortfall'), 'inline formula must be gone from auto-produce path');
    const engine = readSrc('../../src/modules/manufacturing/engines/manufacturing-overhead.engine.ts');
    assert.ok(engine.includes('export function scaledBomOverhead'), 'shared function must exist');
    const invariants = readSrc('../../../ARCHITECTURE_INVARIANTS.md');
    assert.ok(invariants.includes('INV-MANUFACTURING-OVERHEAD-UNIFICATION'), 'invariant must be recorded');

    console.log('manufacturing overhead unification checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
