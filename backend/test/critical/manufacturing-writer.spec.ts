/*
New file: backend/test/critical/manufacturing-writer.spec.ts
Pins INV-PHASE1-A8-PURCHASES-MANUFACTURING-WRITER (manufacturing half):
the 5 manufacturing stock-movements sites now route through the single
writer (recordStockMovement) instead of hand-writing their rows.

WHAT THE MIGRATION MUST NOT CHANGE: every row keeps its exact fields.
The writer computes total_cost = roundMoney(|delta| * unitCost) from the
same inputs the old code used, so the totals are identical by
construction:
- consumption: roundMoney(requiredQty * actualUnitCost) — same expression.
- production: total == finishedValue (already at book digits, so the
  writer's recomputation cannot cross a rounding boundary); the GL
  posting slice reads total_cost off the production/byproduct rows, so
  the spec pins total == finishedValue exactly.
- byproduct: roundMoney(bpQty * cost) — same expression.
- unbuild: fgTotalCost = roundMoney(qtyToUnbuild * fgUnitCost) — same.
- recovery: lineCost = roundMoney(returnQty * compUnitCost) — same.

WHAT THIS PINS, driving the REAL completeWorkOrder / createUnbuildOrder
on PGlite:
0. The routing itself: manufacturing.service.ts holds ZERO direct
   insertInto('stock_movements') and exactly 5 recordStockMovement calls.
   (Pre-migration this fails: 5 direct inserts, 0 writer calls.)
1. completeWorkOrder (no byproducts): exactly 2 rows with the exact
   fields, balances moved, 1 journal entry.
2. completeWorkOrder with a byproduct: 3 rows; the production total is
   exactly finishedValue (totalCost - byProductValue); the byproduct row
   carries its own cost.
3. createUnbuildOrder (balanced): 2 rows (unbuild + recovery) with the
   exact totals, balances restored, the balanced journal legs.
4. Rollback: a work order whose second component is short throws
   INSUFFICIENT_RAW_MATERIAL and leaves ZERO movement rows and
   untouched balances — the writer runs inside the same transaction,
   so a failed run rolls back both the balances and the rows.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { ManufacturingService } from '../../src/modules/manufacturing/services/manufacturing.service';

const AUTH = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: [],
} as unknown as AuthContext;

const SERVICE_PATH = path.resolve(__dirname, '../../src/modules/manufacturing/services/manufacturing.service.ts');

async function seedProduct(db: Kysely<Database>, id: number, qty: number, cost: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials, default_location_id) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${qty}, 0, ${cost}, true, false, 1)`.execute(
    db,
  );
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${qty}, 0)`.execute(
    db,
  );
}

async function seedBom(
  db: Kysely<Database>,
  bomId: number,
  fgId: number,
  lines: Array<{ compId: number; qty: number }>,
  overhead = 0,
): Promise<void> {
  await sql`INSERT INTO manufacturing_boms (id, product_id, quantity, overhead_cost, expected_cost, is_active, tenant_id, account_id) VALUES (${bomId}, ${fgId}, 1, ${overhead}, 0, true, 't1', 'a1')`.execute(
    db,
  );
  for (const line of lines) {
    await sql`INSERT INTO manufacturing_bom_lines (bom_id, component_product_id, quantity, unit_name, unit_multiplier, waste_percentage, expected_cost) VALUES (${bomId}, ${line.compId}, ${line.qty}, 'unit', 1, 0, 0)`.execute(
      db,
    );
  }
}

async function seedWorkOrder(db: Kysely<Database>, id: number, bomId: number, qty: number): Promise<void> {
  await sql`INSERT INTO manufacturing_work_orders (id, bom_id, status, quantity_to_produce, produced_quantity, source_location_id, destination_location_id, total_cost, note, created_by, tenant_id, account_id) VALUES (${id}, ${bomId}, 'draft', ${qty}, 0, 1, 1, 0, '', 1, 't1', 'a1')`.execute(
    db,
  );
}

type MovementRow = {
  product_id: number;
  movement_type: string;
  qty: string;
  before_qty: string;
  after_qty: string;
  unit_cost: string | null;
  total_cost: string | null;
  reason: string;
  note: string;
  reference_type: string;
  reference_id: number;
  location_id: number | null;
};

async function movements(
  db: Kysely<Database>,
  referenceType: string,
  referenceId: number,
): Promise<
  Array<{
    productId: number;
    type: string;
    qty: number;
    before: number;
    after: number;
    unit: number | null;
    total: number | null;
    reason: string;
    note: string;
    location: number | null;
  }>
> {
  const rows =
    await sql<MovementRow>`SELECT product_id, movement_type, qty, before_qty, after_qty, unit_cost, total_cost, reason, note, reference_type, reference_id, location_id FROM stock_movements WHERE reference_type = ${referenceType} AND reference_id = ${referenceId} ORDER BY id`.execute(
      db,
    );
  return rows.rows.map((r) => ({
    productId: Number(r.product_id),
    type: r.movement_type,
    qty: Number(r.qty),
    before: Number(r.before_qty),
    after: Number(r.after_qty),
    unit: r.unit_cost === null ? null : Number(r.unit_cost),
    total: r.total_cost === null ? null : Number(r.total_cost),
    reason: r.reason,
    note: r.note,
    location: r.location_id === null ? null : Number(r.location_id),
  }));
}

async function scopedQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{
    qty: string;
  }>`SELECT qty FROM product_location_stock WHERE product_id = ${productId} AND location_id = 1`.execute(db);
  return row.rows.length ? Number(row.rows[0].qty) : 0;
}

async function globalQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ stock_qty: string }>`SELECT stock_qty FROM products WHERE id = ${productId}`.execute(db);
  return row.rows.length ? Number(row.rows[0].stock_qty) : 0;
}

async function journalCount(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<number> {
  const rows = await sql<{
    n: string;
  }>`SELECT COUNT(*) AS n FROM journal_entries WHERE source_type = ${sourceType} AND source_id = ${sourceId}`.execute(
    db,
  );
  return Number(rows.rows[0].n);
}

async function journalLines(
  db: Kysely<Database>,
  sourceType: string,
  sourceId: number,
): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{
    code: string;
    debit: string;
    credit: string;
  }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = ${sourceType} AND e.source_id = ${sourceId} ORDER BY a.code, l.id`.execute(
    db,
  );
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
}

async function main(): Promise<void> {
  // §0 — the routing pin: no direct stock_movements insert survives in
  // manufacturing.service.ts; exactly 5 writer calls replace them.
  {
    const src = fs.readFileSync(SERVICE_PATH, 'utf8');
    assert.equal(
      (src.match(/insertInto\('stock_movements'\)/g) || []).length,
      0,
      'manufacturing.service.ts must hold zero direct stock_movements inserts (A8 migrates all 5)',
    );
    assert.equal(
      (src.match(/await recordStockMovement\(trx, \{/g) || []).length,
      5,
      'manufacturing.service.ts must call recordStockMovement exactly 5 times (consumption, production, byproduct, unbuild, recovery)',
    );
  }

  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const service = new ManufacturingService(
    db as never,
    new TransactionHelper(),
    new AuditService(db as never),
    posting,
  );

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
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, product_id bigint, quantity numeric, overhead_cost numeric, expected_cost numeric, is_active boolean, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE manufacturing_bom_lines (id bigserial PRIMARY KEY, bom_id bigint, component_product_id bigint, quantity numeric, unit_name text, unit_multiplier numeric, waste_percentage numeric, expected_cost numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE manufacturing_work_orders (id bigint PRIMARY KEY, doc_no text, bom_id bigint, status text, quantity_to_produce numeric, produced_quantity numeric, source_location_id bigint, destination_location_id bigint, start_date timestamptz, end_date timestamptz, total_cost numeric, completed_at timestamptz, note text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, tenant_id text, account_id text);
      CREATE TABLE manufacturing_wo_consumptions (id bigserial PRIMARY KEY, tenant_id text, account_id text, work_order_id bigint, component_product_id bigint, quantity_consumed numeric, unit_cost numeric, line_total numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE manufacturing_wo_operations (id bigserial PRIMARY KEY, tenant_id text, account_id text, work_order_id bigint, work_center_id bigint, operation_name text, sequence int, duration_hours numeric, hourly_cost numeric, total_cost numeric, status text, notes text);
      CREATE TABLE manufacturing_unbuild_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, unbuild_number text, product_id bigint, product_name text, bom_id bigint, quantity numeric, warehouse_id bigint, status text, total_cost numeric, notes text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    `);

    // §1 — completeWorkOrder, no byproducts: FG 1 from comp 2 @ 5, WO qty 2.
    // Consumption 2 @ 5 = 10; production finishedValue = 10, unit 5.
    await seedProduct(db, 1, 0, 0);
    await seedProduct(db, 2, 10, 5);
    await seedBom(db, 1, 1, [{ compId: 2, qty: 1 }]);
    await seedWorkOrder(db, 1, 1, 2);
    await service.completeWorkOrder(1, {} as never, AUTH);
    const rows1 = await movements(db, 'manufacturing_work_order', 1);
    assert.equal(rows1.length, 2, 'exactly 2 rows: consumption + production');
    assert.deepEqual(rows1[0], {
      productId: 2,
      type: 'manufacturing_consumption',
      qty: -2,
      before: 10,
      after: 8,
      unit: 5,
      total: 10,
      reason: 'استهلاك تصنيع',
      note: 'أمر إنتاج #1',
      location: 1,
    });
    assert.deepEqual(rows1[1], {
      productId: 1,
      type: 'manufacturing_production',
      qty: 2,
      before: 0,
      after: 2,
      unit: 5,
      total: 10,
      reason: 'إنتاج تام',
      note: 'أمر إنتاج #1',
      location: 1,
    });
    assert.equal(rows1[1].total, 10, 'production total is exactly finishedValue (totalCost 10 - byProductValue 0)');
    assert.equal(await scopedQty(db, 2), 8, 'component scoped stock falls 10 -> 8');
    assert.equal(await globalQty(db, 2), 8, 'component global stock falls 10 -> 8');
    assert.equal(await scopedQty(db, 1), 2, 'finished scoped stock rises 0 -> 2');
    assert.equal(await globalQty(db, 1), 2, 'finished global stock rises 0 -> 2');
    assert.equal(await journalCount(db, 'manufacturing_work_order', 1), 1, 'one journal entry is posted');

    // §2 — completeWorkOrder with a byproduct: FG 11 from comp 12 @ 4,
    // byproduct 13 @ 3, WO qty 2. Consumption 2 @ 4 = 8; byProductValue 3;
    // finishedValue = 8 - 3 = 5; production unit 2.5, total 5.
    await seedProduct(db, 11, 0, 0);
    await seedProduct(db, 12, 10, 4);
    await seedProduct(db, 13, 0, 3);
    await seedBom(db, 11, 11, [{ compId: 12, qty: 1 }]);
    await seedWorkOrder(db, 11, 11, 2);
    await service.completeWorkOrder(11, { byProducts: [{ productId: 13, quantity: 1, locationId: 1 }] } as never, AUTH);
    const rows2 = await movements(db, 'manufacturing_work_order', 11);
    assert.equal(rows2.length, 3, 'exactly 3 rows: consumption + production + byproduct');
    assert.deepEqual(rows2[0], {
      productId: 12,
      type: 'manufacturing_consumption',
      qty: -2,
      before: 10,
      after: 8,
      unit: 4,
      total: 8,
      reason: 'استهلاك تصنيع',
      note: 'أمر إنتاج #11',
      location: 1,
    });
    assert.deepEqual(rows2[1], {
      productId: 11,
      type: 'manufacturing_production',
      qty: 2,
      before: 0,
      after: 2,
      unit: 2.5,
      total: 5,
      reason: 'إنتاج تام',
      note: 'أمر إنتاج #11',
      location: 1,
    });
    assert.equal(rows2[1].total, 5, 'production total is exactly finishedValue (8 - 3)');
    assert.deepEqual(rows2[2], {
      productId: 13,
      type: 'manufacturing_byproduct',
      qty: 1,
      before: 0,
      after: 1,
      unit: 3,
      total: 3,
      reason: 'منتج ثانوي ناتج عن التصنيع',
      note: 'أمر إنتاج #11 - منتج ثانوي',
      location: 1,
    });
    assert.equal(await scopedQty(db, 13), 1, 'byproduct scoped stock rises 0 -> 1');
    assert.equal(await journalCount(db, 'manufacturing_work_order', 11), 1, 'one journal entry is posted');

    // §3 — createUnbuildOrder, balanced: FG 21 @ 10, comp 22 @ 10, qty 2.
    // Unbuild 2 @ 10 = 20; recovery 2 @ 10 = 20; journal Dr 1140 20 / Cr 1140 20.
    await seedProduct(db, 21, 10, 10);
    await seedProduct(db, 22, 0, 10);
    await seedBom(db, 21, 21, [{ compId: 22, qty: 1 }]);
    const res3 = (await service.createUnbuildOrder(
      { productId: 21, bomId: 21, quantity: 2, warehouseId: 1 } as never,
      AUTH,
    )) as unknown as { unbuildId: number };
    const rows3 = await movements(db, 'manufacturing_unbuild_order', Number(res3.unbuildId));
    assert.equal(rows3.length, 2, 'exactly 2 rows: unbuild + recovery');
    assert.equal(rows3[0].type, 'manufacturing_unbuild');
    assert.equal(rows3[0].qty, -2);
    assert.equal(rows3[0].unit, 10);
    assert.equal(rows3[0].total, 20);
    assert.equal(rows3[0].before, 10);
    assert.equal(rows3[0].after, 8);
    assert.equal(rows3[0].reason, 'تفكيك منتج تام');
    assert.equal(rows3[1].type, 'manufacturing_unbuild_recovery');
    assert.equal(rows3[1].qty, 2);
    assert.equal(rows3[1].unit, 10);
    assert.equal(rows3[1].total, 20);
    assert.equal(rows3[1].before, 0);
    assert.equal(rows3[1].after, 2);
    assert.equal(rows3[1].reason, 'استرجاع مواد خام من تفكيك');
    assert.equal(await scopedQty(db, 21), 8, 'finished scoped stock falls 10 -> 8');
    assert.equal(await scopedQty(db, 22), 2, 'component scoped stock rises 0 -> 2');
    assert.deepEqual(await journalLines(db, 'manufacturing_unbuild_order', Number(res3.unbuildId)), [
      { code: '1140', debit: 20, credit: 0 },
      { code: '1140', debit: 0, credit: 20 },
    ]);

    // §4 — rollback: comp 32 is sufficient, comp 33 is short (needs 2, has 1).
    // The order throws INSUFFICIENT_RAW_MATERIAL; no movement row survives
    // and no balance moves — the writer shares the order's transaction.
    await seedProduct(db, 31, 0, 0);
    await seedProduct(db, 32, 10, 5);
    await seedProduct(db, 33, 1, 5);
    await seedBom(db, 31, 31, [
      { compId: 32, qty: 1 },
      { compId: 33, qty: 1 },
    ]);
    await seedWorkOrder(db, 31, 31, 2);
    await assert.rejects(
      service.completeWorkOrder(31, {} as never, AUTH),
      (err: unknown) => (err as { code?: string }).code === 'INSUFFICIENT_RAW_MATERIAL',
      'a short second component must fail the whole order',
    );
    assert.equal(
      (await movements(db, 'manufacturing_work_order', 31)).length,
      0,
      'no movement row survives the rollback',
    );
    assert.equal(await scopedQty(db, 32), 10, 'the sufficient component is untouched');
    assert.equal(await scopedQty(db, 33), 1, 'the short component is untouched');
    assert.equal(await scopedQty(db, 31), 0, 'no finished product is produced');
    assert.equal(await journalCount(db, 'manufacturing_work_order', 31), 0, 'no journal is posted');

    // §5 — wiring: both critical lists carry 363 specs in identical
    // order, with the two A8 specs last.
    {
      const specs = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
        .specs as string[];
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 382);
      assert.equal(chain.length, 382);
      assert.deepEqual(chain, specs);
      assert.equal(specs[358], 'test/critical/sales-writer-create.spec.ts');
      assert.equal(specs[359], 'test/critical/sales-writer-cancel-edit.spec.ts');
      assert.equal(specs[360], 'test/critical/sales-writer-food-waste.spec.ts');
      assert.equal(specs[361], 'test/critical/manufacturing-writer.spec.ts');
      assert.equal(specs[362], 'test/critical/purchases-writer.spec.ts');
      assert.equal(specs[363], 'test/critical/phase1-a9-routing.spec.ts');
      assert.equal(specs[364], 'test/critical/phase1-a9-inventory-writer.spec.ts');
      assert.equal(specs[365], 'test/critical/phase1-a9-services-writer.spec.ts');
      assert.equal(specs[366], 'test/critical/phase1-a10-rounding.spec.ts');
      assert.equal(specs[367], 'test/critical/phase1-a10-purchases-writer.spec.ts');
      assert.equal(specs[368], 'test/critical/phase1-a10-import-writer.spec.ts');
      console.log('  evidence specs wired into both critical lists (373 = 373, identical order), passed');
    }
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => {
    console.log('manufacturing-writer.spec: PASS');
    process.exit(0);
  })
  .catch((err) => {
    console.error('manufacturing-writer.spec: FAIL');
    console.error(err);
    process.exit(1);
  });
