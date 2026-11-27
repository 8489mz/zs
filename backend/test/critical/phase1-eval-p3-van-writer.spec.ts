import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { moveVanStock, type MoveVanStockParams } from '../../src/modules/delivery-reps/services/van-common.util';

/*
 * Phase 1 evaluation follow-up P3 — moveVanStock through the unified
 * writer (INV-PHASE1-EVAL-P3-VAN-WRITER).
 *
 * Both evaluations found the same residue: moveVanStock in
 * van-common.util.ts still inserts into stock_movements DIRECTLY with
 * total_cost spelled Number((|delta| * unitCost).toFixed(4)) — the one
 * business write site outside the unified writer, and the last
 * toFixed(4) total_cost spelling in the codebase (the other toFixed(4)
 * hits are quantity roundings and an AI similarity score, out of
 * scope). Phase 1 A10 deliberately left it as a template, not a
 * migration target; this package completes that migration.
 *
 * THE FIX: reimplement moveVanStock as a thin delegate to
 * recordStockMovement in stock-movement-writer.ts (the same two
 * halves: applyStockDelta, then one row from the returned
 * before/after). moneyDigits is resolved inside moveVanStock with the
 * P2 pattern the van slices already use:
 * currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId)).
 * Signature unchanged, no caller changes; the return stays
 * { scopeBefore, scopeAfter }. The stored van totals change from 4dp
 * to book digits (2/3dp) — that IS the package: 3 x 0.3333 books 1.00
 * at 2dp and 1.000 at 3dp, not 0.9999. The INSUFFICIENT_VAN_STOCK
 * error path is unchanged (same errorCode/errorMessage passthrough).
 *
 * DELIBERATE RE-PINS (not pure moves — the boundary header records
 * them, following the van-transfer-loaded-amount-3dp precedent):
 * - delivery-reps->accounting 107 -> 109: moveVanStock newly imports
 *   tenantBaseCurrency + currencyMoneyDigits from accounting — the
 *   same two statements the van slices already state for the same
 *   P2-pattern lookup. No new edge, no new pair.
 * - Backend cross-module total 738 -> 740 (= the edge delta, no
 *   other growth).
 * - Direct-write inventory 6 -> 5: the van row leaves
 *   docs/STOCK_MOVEMENTS_WRITES.md (delivery-reps 1 -> 0); every
 *   business caller now routes through the writer.
 * The A9-routing and A10-rounding specs re-point their moveVanStock
 * deferral pins (1 direct insert -> 0, 1 writer call) in this package.
 *
 * WHAT THIS PINS, driving the REAL moveVanStock on PGlite (fresh
 * database per case, no mocks — the A0 harness shape):
 * - 2dp tenant (EGP): delta -3 x 0.3333 books total_cost 1 (not
 *   0.9999), one row with the ledger's before/after (50 -> 47), the
 *   frozen unit cost, reason/note/reference/branch/location/createdBy
 *   exactly as passed, and the return { scopeBefore 50, scopeAfter
 *   47 }; balances moved (global 100 -> 97, location 50 -> 47).
 * - 3dp tenant (KWD): delta +3 x 0.3333 books total_cost 1 (not
 *   0.9999), before/after 50 -> 53.
 * - Insufficient stock still throws INSUFFICIENT_VAN_STOCK with zero
 *   rows and unchanged balances.
 * - Source pins: the moveVanStock body holds no
 *   insertInto('stock_movements') and no toFixed(4); it delegates to
 *   recordStockMovement with the P2-pattern digits lookup; the file
 *   no longer imports applyStockDelta directly.
 *
 * Wiring: both critical lists carry 405 specs in identical order,
 * this spec last.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const B1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b1-reports-sales.spec.ts');
const B2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b2-sales-settings.spec.ts');
const B3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b3-sales-storefront.spec.ts');
const B4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b4-accounting-hr.spec.ts');
const B5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b5-accounting-manufacturing.spec.ts');
const B6_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b6-accounting-purchases.spec.ts');
const B7_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b7-returns-sales.spec.ts');
const B8_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b8-delivery-reps-sales.spec.ts');
const F2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f2-feature-public-indices.spec.ts');
const F3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f3-feature-boundary-legs.spec.ts');
const F4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f4-settings-access-door.spec.ts');
const F5A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5a-audit-settings.spec.ts');
const F5B_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5b-products-settings.spec.ts');
const F5C_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5c-accounts-purchases.spec.ts');
const F5D_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5d-maintenance-products.spec.ts');
const F5E_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5e-accounting-treasury.spec.ts');
const F5F_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5f-cash-drawer-pos.spec.ts');
const F5G_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5g-customers-sales.spec.ts');
const F5H_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-pos-sales.spec.ts');
const F5I_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5i-pos-settings.spec.ts');
const F5H_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-sales-envelope-check.spec.ts');
const F5J_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-inventory-products.spec.ts');
const F5H_REPAIR_2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-2-dialog-spec-mock.spec.ts');
const F5K_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5k-pos-products.spec.ts');
const F5J_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-repair-expiry-spec-import.spec.ts');
const F5L_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5l-pos-storefront.spec.ts');
const F5L_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5l-repair-bundle-budget.spec.ts');
const D_M1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m1-job-fields.spec.ts');
const D_M3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m3-mail-nested.spec.ts');
const D_D10A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-d10a-serials-payload.spec.ts');
const DISCOUNT_FIX_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-discount-fix-line-amount.spec.ts');
const CLEANUP_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-cleanup-as-any-reduction.spec.ts');
const P1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p1-frontend-lint.spec.ts');
const P2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p2-dev-passcode.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const VAN_COMMON = path.join(BACKEND, 'src', 'modules', 'delivery-reps', 'services', 'van-common.util.ts');
const WRITES_SPEC = path.join(BACKEND, 'test', 'critical', 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');
const A9_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-a9-routing.spec.ts');
const A10_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-a10-rounding.spec.ts');

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE products (id bigint PRIMARY KEY, name text, stock_qty numeric, reserved_qty numeric, tenant_id text, account_id text, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, tenant_id text, account_id text, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, serial_tracking jsonb, batch_tracking jsonb, created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
  `);
  return { pg, db };
}

async function seedTenant(db: Kysely<Database>, tenantId: string, currency: string, quoted: boolean): Promise<void> {
  await db
    .insertInto('settings' as never)
    .values({ tenant_id: tenantId, key: 'currency', value: quoted ? `"${currency}"` : currency } as never)
    .execute();
  await db
    .insertInto('currency_exchange_rates' as never)
    .values({ tenant_id: tenantId, currency_code: currency, exchange_rate: 1, is_base: true } as never)
    .execute();
}

async function seedStock(
  db: Kysely<Database>,
  productId: number,
  tenantId: string,
  globalQty: number,
  locationQty: number,
): Promise<void> {
  // NOTE: globalQty MUST equal locationQty here. applyStockDelta
  // reconciles any global-vs-locations discrepancy into the
  // unassigned balance and drains it into the location before the
  // move, so a split seed would re-base the scope before the delta.
  // (Same harness shape as stock-movement-writer.spec.ts.)
  await db
    .insertInto('products' as never)
    .values({
      id: productId,
      name: 'Widget',
      stock_qty: globalQty,
      reserved_qty: 0,
      tenant_id: tenantId,
      account_id: 'a1',
      updated_at: new Date(),
    } as never)
    .execute();
  await db
    .insertInto('product_location_stock' as never)
    .values({
      product_id: productId,
      branch_id: 1,
      location_id: 5,
      qty: locationQty,
      reserved_qty: 0,
      tenant_id: tenantId,
      account_id: 'a1',
      updated_at: new Date(),
    } as never)
    .execute();
}

async function readRow(db: Kysely<Database>): Promise<Record<string, unknown>> {
  const rows = (await db.selectFrom('stock_movements').selectAll().execute()) as unknown as Array<
    Record<string, unknown>
  >;
  assert.equal(rows.length, 1, 'moveVanStock must write exactly one row');
  return rows[0];
}

async function readBalances(
  db: Kysely<Database>,
  productId: number,
): Promise<{ globalQty: number; locationQty: number }> {
  const product = await db
    .selectFrom('products')
    .select('stock_qty')
    .where('id', '=', productId)
    .executeTakeFirstOrThrow();
  const location = await db
    .selectFrom('product_location_stock')
    .select('qty')
    .where('product_id', '=', productId)
    .where('location_id', '=', 5)
    .executeTakeFirstOrThrow();
  return { globalQty: Number(product.stock_qty), locationQty: Number(location.qty) };
}

function vanParams(overrides: Partial<MoveVanStockParams> = {}): MoveVanStockParams {
  return {
    productId: 1,
    delta: -3,
    locationId: 5,
    branchId: 1,
    tenantId: 't1',
    accountId: 'a1',
    userId: 9,
    movementType: 'van_load_out',
    note: 'load-out probe',
    referenceType: 'van_sales_trip',
    referenceId: 7,
    skipGlobalUpdate: false,
    unitCost: 0.3333,
    ...overrides,
  };
}

async function main(): Promise<void> {
  // 1. The live behaviour: book-digit totals at 2dp and 3dp, exact row
  // shape, balances moved, insufficient stock still refused.
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db, 't1', 'EGP', false);
      await seedStock(db, 1, 't1', 50, 50);
      const ret = await moveVanStock(db, vanParams({}));
      assert.deepEqual(ret, { scopeBefore: 50, scopeAfter: 47 }, 'return stays { scopeBefore, scopeAfter }');
      const row = await readRow(db);
      assert.equal(Number(row.total_cost), 1, '2dp total must book 1.00, not the 4dp 0.9999');
      assert.equal(Number(row.qty), -3, 'row qty stays the signed delta');
      assert.equal(Number(row.before_qty), 50);
      assert.equal(Number(row.after_qty), 47);
      assert.equal(Number(row.unit_cost), 0.3333, 'unit_cost stays as given');
      assert.equal(row.movement_type, 'van_load_out');
      assert.equal(row.reason, 'van_load_out', 'reason defaults to movementType');
      assert.equal(row.note, 'load-out probe');
      assert.equal(row.reference_type, 'van_sales_trip');
      assert.equal(Number(row.reference_id), 7);
      assert.equal(Number(row.branch_id), 1);
      assert.equal(Number(row.location_id), 5);
      assert.equal(Number(row.created_by), 9);
      const balances = await readBalances(db, 1);
      assert.deepEqual(balances, { globalQty: 47, locationQty: 47 }, 'ledger balances must move');
    } finally {
      await pg.close();
    }
  }
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db, 't2', 'KWD', true);
      await seedStock(db, 1, 't2', 50, 50);
      const ret = await moveVanStock(
        db,
        vanParams({ tenantId: 't2', delta: 3, movementType: 'van_return', note: 'return probe' }),
      );
      assert.deepEqual(ret, { scopeBefore: 50, scopeAfter: 53 });
      const row = await readRow(db);
      assert.equal(Number(row.total_cost), 1, '3dp total must book 1.000, not the 4dp 0.9999');
      assert.equal(Number(row.qty), 3);
      assert.equal(Number(row.before_qty), 50);
      assert.equal(Number(row.after_qty), 53);
    } finally {
      await pg.close();
    }
  }
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db, 't1', 'EGP', false);
      await seedStock(db, 1, 't1', 2, 2);
      await assert.rejects(
        () => moveVanStock(db, vanParams({ delta: -5 })),
        (error: unknown) => (error as { code?: string }).code === 'INSUFFICIENT_VAN_STOCK',
      );
      const rows = await db.selectFrom('stock_movements').selectAll().execute();
      assert.equal(rows.length, 0, 'a refused move writes zero rows');
      const balances = await readBalances(db, 1);
      assert.deepEqual(balances, { globalQty: 2, locationQty: 2 }, 'a refused move leaves balances unchanged');
    } finally {
      await pg.close();
    }
  }

  // 2. Source pins: the moveVanStock body holds no direct insert and
  // no toFixed(4); it delegates to the writer with the P2-pattern
  // digits lookup; the file no longer imports applyStockDelta.
  const src = fs.readFileSync(VAN_COMMON, 'utf8');
  const bodyStart = src.indexOf('export async function moveVanStock(');
  assert.ok(bodyStart >= 0, 'moveVanStock must exist');
  const bodyEnd = src.indexOf('\n}\n', bodyStart);
  assert.ok(bodyEnd > bodyStart, 'moveVanStock body must close');
  const body = src.slice(bodyStart, bodyEnd);
  assert.ok(!body.includes("insertInto('stock_movements')"), 'moveVanStock must not insert directly');
  assert.ok(!body.includes('toFixed(4)'), 'moveVanStock must not use the toFixed(4) total spelling');
  assert.ok(!src.includes('toFixed(4)'), 'van-common.util.ts must hold no toFixed(4) at all');
  assert.ok(body.includes('recordStockMovement'), 'moveVanStock must delegate to recordStockMovement');
  assert.ok(body.includes('tenantBaseCurrency'), 'moveVanStock must resolve the tenant base currency');
  assert.ok(body.includes('currencyMoneyDigits'), 'moveVanStock must resolve book digits from the currency');
  assert.ok(
    src.includes("from '../../../common/utils/stock-movement-writer'"),
    'van-common must import the unified writer',
  );
  assert.ok(
    !src.includes("from '../../../common/utils/location-stock-ledger'"),
    'van-common must no longer import applyStockDelta directly',
  );

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-EVAL-P3-VAN-WRITER/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the P3 INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-EVAL-REPAIR-TYPE-IMPORTS/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the P3 INV exactly once');

  // 4. Wiring: both critical lists carry 405 specs in identical order, this spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 406);
  assert.equal(chain.length, 406);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 405 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-eval-repair-type-imports.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-eval-repair-type-imports.spec.ts');
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
    ['B7', B7_SPEC],
    ['B8', B8_SPEC],
    ['F2', F2_SPEC],
    ['F3', F3_SPEC],
    ['F4', F4_SPEC],
    ['F5a', F5A_SPEC],
    ['F5b', F5B_SPEC],
    ['F5c', F5C_SPEC],
    ['F5d', F5D_SPEC],
    ['F5e', F5E_SPEC],
    ['F5f', F5F_SPEC],
    ['F5g', F5G_SPEC],
    ['F5h', F5H_SPEC],
    ['F5i', F5I_SPEC],
    ['F5h-REPAIR', F5H_REPAIR_SPEC],
    ['F5j', F5J_SPEC],
    ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
    ['F5k', F5K_SPEC],
    ['F5j-REPAIR', F5J_REPAIR_SPEC],
    ['F5l', F5L_SPEC],
    ['F5l-REPAIR', F5L_REPAIR_SPEC],
    ['D-M1', D_M1_SPEC],
    ['D-M3', D_M3_SPEC],
    ['D-D10a', D_D10A_SPEC],
    ['discount-fix', DISCOUNT_FIX_SPEC],
    ['cleanup', CLEANUP_SPEC],
    ['P1', P1_SPEC],
    ['P2', P2_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 406);') && src.includes('assert.equal(chain.length, 406);'),
      `${label} spec wiring must re-pin to 405`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-eval-repair-type-imports.spec.ts'"),
      `${label} spec last-entry must re-pin to the P3 spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the P2 spec, pin the
  // old guard INV, pin the old frontend pins, pin the old baseline
  // size, pin the old write inventory, pin the old boundary total or
  // edge, or pin the old A9/A10 moveVanStock deferral. (Same shape as
  // the P2 spec's §5; the patterns below are built by concatenation
  // so this block's own source never contains the patterns it scans
  // for.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const staleGuard: string[] = [];
  const staleFePins: string[] = [];
  const staleBaseline: string[] = [];
  const staleWrite: string[] = [];
  const staleBoundary: string[] = [];
  const staleA9A10: string[] = [];
  const prevName = 'phase1-eval-p2-dev-' + 'passcode.spec.ts';
  const prevInv = 'INV-PHASE1-EVAL-P2-DEV-' + 'PASSCODE';
  const staleSpecs = 'specs.length, 40' + '4';
  const staleChain = 'chain.length, 40' + '4';
  const staleList = 'list.length, 40' + '4';
  const staleFeTotal = "'const PINNED_FRONTEND_TOTAL = 11" + "1;'";
  const staleFeTotalAfter = "'module-boundary must pin the frontend total 11" + '1 after ';
  const staleFeTotalStill = "'module-boundary must still pin the frontend total 11" + "1'";
  const staleFeEdges = "'Object.keys(PINNED_FRONTEND_EDGES).length, 4" + "5,'";
  const staleFeEdgesAfter = "'module-boundary must pin 4" + '5 frontend edges after ';
  const staleFeEdgesStill = "'module-boundary must still pin 4" + "5 frontend edges'";
  const staleBaselineA = 'baseline.length, 6' + '0';
  const staleBaselineB = 'featureBaseline.length, 6' + '0';
  const staleWriteCount = 'PINNED_WRITE_COUNT = ' + '6';
  const staleWriteTotal = 'Total business writes: **' + '6**';
  const staleWriteRow = '| backend/src/modules/delivery-reps/services/van-common.util.ts:5' + '7 |';
  const staleWriteModule = '`delivery-reps`: ' + '1';
  const staleBoundaryTotal = 'const PINNED_BACKEND_TOTAL = 73' + '8;';
  const staleBoundaryEdge = "'delivery-reps->accounting': 10" + '7';
  const staleA10Insert = 'moveVanStock keeps its ' + '1 insert';
  const staleA9Remaining = 'exactly 1 direct insert remains (moveVanStock ' + 'only)';
  const staleA9Van = "van-common.util.ts')), " + '1);';
  const staleA10Calls = 'countWriterCalls(van), ' + '0';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
    if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
    if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    if (
      src.includes(staleFeTotal) ||
      src.includes(staleFeTotalAfter) ||
      src.includes(staleFeTotalStill) ||
      src.includes(staleFeEdges) ||
      src.includes(staleFeEdgesAfter) ||
      src.includes(staleFeEdgesStill)
    ) {
      staleFePins.push(file);
    }
    for (const line of src.split('\n')) {
      if (line.includes(staleBaselineA) || line.includes(staleBaselineB)) {
        staleBaseline.push(`${file}: ${line.trim().slice(0, 100)}`);
      }
    }
    if (src.includes(staleWriteCount)) staleWrite.push(`${file}: stale write count 6`);
    if (src.includes(staleBoundaryTotal)) staleBoundary.push(`${file}: stale backend total 738`);
    if (src.includes(staleBoundaryEdge)) staleBoundary.push(`${file}: stale delivery-reps->accounting edge 107`);
    if (src.includes(staleA10Insert) || src.includes(staleA9Remaining) || src.includes(staleA9Van)) {
      staleA9A10.push(file);
    }
    if (file === 'phase1-a10-rounding.spec.ts' && src.includes(staleA10Calls)) {
      staleA9A10.push(`${file}: van writer calls still 0`);
    }
  }
  const writesDoc = fs.readFileSync(WRITES_DOC, 'utf8');
  if (writesDoc.includes(staleWriteTotal)) staleWrite.push('STOCK_MOVEMENTS_WRITES.md: stale total 6');
  if (writesDoc.includes(staleWriteRow)) staleWrite.push('STOCK_MOVEMENTS_WRITES.md: stale van-common row');
  if (writesDoc.includes(staleWriteModule)) staleWrite.push('STOCK_MOVEMENTS_WRITES.md: stale delivery-reps 1');
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (404)');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the P2 spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (P2)');
  assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
  assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');
  assert.deepEqual(staleWrite, [], 'no spec or doc may still pin the old write inventory (6)');
  assert.deepEqual(staleBoundary, [], 'no critical spec may still pin the old boundary total (738) or edge (107)');
  assert.deepEqual(staleA9A10, [], 'no critical spec may still pin the old A9/A10 moveVanStock deferral');

  // 6. The guard tail holds ONLY the newest id, so this package re-pins
  // the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/
  // F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/F5l/F5l-REPAIR/D-M1/D-M3/
  // D-D10a/discount-fix/cleanup/P1/P2 specs' guard assertions to the P3
  // INV; their invariants-file assertions still pin their own id
  // (each line stays in ARCHITECTURE_INVARIANTS.md exactly once).
  for (const [label, specPath] of [
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
    ['B7', B7_SPEC],
    ['B8', B8_SPEC],
    ['F2', F2_SPEC],
    ['F3', F3_SPEC],
    ['F4', F4_SPEC],
    ['F5a', F5A_SPEC],
    ['F5b', F5B_SPEC],
    ['F5c', F5C_SPEC],
    ['F5d', F5D_SPEC],
    ['F5e', F5E_SPEC],
    ['F5f', F5F_SPEC],
    ['F5g', F5G_SPEC],
    ['F5h', F5H_SPEC],
    ['F5i', F5I_SPEC],
    ['F5h-REPAIR', F5H_REPAIR_SPEC],
    ['F5j', F5J_SPEC],
    ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
    ['F5k', F5K_SPEC],
    ['F5j-REPAIR', F5J_REPAIR_SPEC],
    ['F5l', F5L_SPEC],
    ['F5l-REPAIR', F5L_REPAIR_SPEC],
    ['D-M1', D_M1_SPEC],
    ['D-M3', D_M3_SPEC],
    ['D-D10a', D_D10A_SPEC],
    ['discount-fix', DISCOUNT_FIX_SPEC],
    ['cleanup', CLEANUP_SPEC],
    ['P1', P1_SPEC],
    ['P2', P2_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-EVAL-REPAIR-TYPE-IMPORTS/g)'),
      `${label} spec guard assertion must re-pin to the P3 INV`,
    );
  }

  // 7. The module-boundary pins move deliberately in this package
  // (backend total 738 -> 740, delivery-reps->accounting 107 -> 109 —
  // the two new P2-pattern statements); the frontend pins, the edge
  // counts and the baselines do not move. The write inventory pins
  // 5 (spec + doc), and the A9/A10 deferral pins re-point to the
  // migrated state (van 0 inserts, 1 writer call).
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
    'module-boundary must pin the backend total 740 after the P3 re-pin',
  );
  assert.ok(
    boundary.includes("'delivery-reps->accounting': 109,"),
    'module-boundary must pin delivery-reps->accounting 109 after the P3 re-pin',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must still pin the frontend total 105',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must still pin 44 frontend edges',
  );
  assert.ok(
    boundary.includes('const FRONTEND_EDGE_FLOOR = 44;'),
    'module-boundary must still pin the frontend edge floor 44',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_BIDIRECTIONAL_PAIRS: string[] = [];'),
    'the frontend bidirectional pair list must stay empty',
  );
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57');
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152');
  const writesSpec = fs.readFileSync(WRITES_SPEC, 'utf8');
  assert.ok(writesSpec.includes('const PINNED_WRITE_COUNT = 5;'), 'stock-movements-writes must pin the write count 5');
  assert.ok(writesDoc.includes('Total business writes: **5**'), 'the writes doc must state the total 5');
  assert.ok(
    !writesDoc.includes('| backend/src/modules/delivery-reps/services/van-common.util.ts:57 |'),
    'the writes doc must no longer list the van-common row',
  );
  assert.ok(writesDoc.includes('`delivery-reps`: 0'), 'the writes doc must pin delivery-reps 0');
  const a9 = fs.readFileSync(A9_SPEC, 'utf8');
  assert.ok(
    a9.includes("assert.equal(countDirectInserts(read('modules/delivery-reps/services/van-common.util.ts')), 0);"),
    'A9-routing must pin the van file at zero direct inserts',
  );
  const a10 = fs.readFileSync(A10_SPEC, 'utf8');
  assert.ok(
    a10.includes('assert.equal(countDirectInserts(van), 0,'),
    'A10-rounding must pin moveVanStock at zero direct inserts',
  );
  assert.ok(
    a10.includes('assert.equal(countWriterCalls(van), 1,'),
    'A10-rounding must pin moveVanStock at one writer call',
  );

  console.log('phase1 eval P3 van-writer checks passed (moveVanStock books at book digits, 405 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
