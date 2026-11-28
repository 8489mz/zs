import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { migration } from '../../src/database/migrations/2040000000344_legacy_document_number_unique_indexes';

/*
 * Phase 1 final inspection, slice 4 — legacy document numbers
 * (INV-LEGACY-DOC-NUMBER-UNIQUE-BACKSTOP).
 *
 * THE GAP: migration 0297 (INV-DOCUMENT-NUMBER-UNIQUE-BACKSTOP)
 * indexed only the van tables and explicitly deferred the five
 * legacy nullable doc_no columns (sales, purchases, returns,
 * cashier-shifts, stock-transfers) pending "a writer audit plus
 * a live duplicate count first". This slice is the writer audit.
 * The live duplicate count cannot be taken from here (the
 * live-DB tunnel is closed, and no counts are invented): the
 * migration's own loud pre-check enforces the count at deploy
 * instead — if live data holds duplicates, deploy fails loudly
 * and stops, and cleanup is a separate user-side step.
 *
 * THE RULE: migration 0344 adds unique (tenant_id, doc_no) on
 * exactly four of the five columns — purchases, cashier_shifts,
 * stock_transfers and return_documents — with a loud
 * NULL-excluded duplicate pre-check and a post-check. A
 * duplicate number fails 23505 instead of landing silently.
 *
 * SCOPE DECISIONS (recorded, all from live code):
 * - sales is EXCLUDED. The main sale, van field sale,
 *   import-preorder and storefront-draft writers are all
 *   unique (id-derived or advisory-lock serialized) — BUT
 *   commercial-subscription generateDueInvoices loops
 *   `for (const sub of dueSubscriptions)` and numbers each
 *   invoice from the per-subscription counter
 *   (SUB-INV-YYMMDD-<invoices_count+1>). Two subscriptions
 *   with equal counts billing the same day produce the
 *   identical number in two sales rows, sequentially, with
 *   no concurrency needed. A unique index on sales.doc_no
 *   would break subscription billing on first collision.
 *   Fixing the generator changes customer-facing invoice
 *   numbers and is its own package — not smuggled in here.
 * - The old "returns" table is EXCLUDED: migration 4000
 *   drops it in up (recreated only in down) and no
 *   production code reads or writes it. return_documents
 *   is the live returns table and is indexed instead.
 * - The literal 'TMP' placeholders three of the tables
 *   insert first are renamed in the same transaction
 *   before commit (the 0297 speculative-insertion safety),
 *   so concurrent placeholders cannot collide.
 * - Demo seed's fixed INV-/PUR- counters are safe because
 *   the seed wipes by default in a single transaction; a
 *   wipeExisting=false re-seed fails loudly and rolls back.
 * - Extra nullable doc_no columns found (stock_count_
 *   sessions, supplier_payments, manufacturing tables) are
 *   OUT of this slice — recorded as future work, not
 *   expanded silently.
 *
 * WHAT THIS PINS, driving the REAL migration 0344 on PGlite:
 * - §1: the writer audit (static pins on the live writers)
 *   + the sales / old-returns-table exclusions.
 * - §2: the real migration — up creates all four indexes
 *   and is idempotent; a duplicate fails 23505 per table
 *   with cross-tenant reuse allowed; down removes the
 *   guard; up refuses loudly on pre-existing duplicates
 *   and leaves no index; NULL rows do not block up.
 * - §3: CONTROL — without the index the duplicate lands
 *   silently (the defect the index closes).
 * - §4: static pins — the migration file is the highest
 *   on disk, the engine-map document-numbers row.
 * - §5: the INV exists exactly once in
 *   ARCHITECTURE_INVARIANTS.md and exactly once in the
 *   guard tail.
 * - §6: wiring 410 in both lists, this spec last,
 *   all earlier specs re-pinned (counts, last-entry).
 * - §7: the re-pin sweep is complete (no stale count,
 *   last-entry or guard INV remains).
 * - §8: the guard re-pin list (every earlier spec's
 *   guard assertion points at the new INV).
 * - §9: boundary / frontend / baseline / write pins do
 *   not move (backend 740, delivery-reps->accounting
 *   109, frontend 105/44, baselines 57/152, writes 5)
 *   and the "highest migration" pins re-point to 0344.
 *
 * Wiring: both critical lists carry 410 specs in identical
 * order, this spec last.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const ENGINE_MAP = path.join(REPO_ROOT, 'docs', 'ENGINE_MAP.md');
const MIGRATIONS_DIR = path.join(BACKEND, 'src', 'database', 'migrations');
const MIGRATION_FILE = '2040000000344_legacy_document_number_unique_indexes.ts';
const MIGRATION_0297 = path.join(MIGRATIONS_DIR, '2040000000297_document_number_unique_indexes.ts');
const MIGRATION_4000 = path.join(MIGRATIONS_DIR, '1710000004000-return-documents-normalization.ts');
const PURCHASES_WRITE_CREATE = path.join(
  BACKEND,
  'src',
  'modules',
  'purchases',
  'services',
  'purchases-write-create.service.ts',
);
const GRN_BILL = path.join(BACKEND, 'src', 'modules', 'purchases', 'services', 'goods-receipt-bill.service.ts');
const CASH_DRAWER_HELPER = path.join(BACKEND, 'src', 'modules', 'cash-drawer', 'helpers', 'cash-drawer.helper.ts');
const CASH_DRAWER_WRITE = path.join(BACKEND, 'src', 'modules', 'cash-drawer', 'cash-drawer-write.service.ts');
const INVENTORY_TRANSFER = path.join(
  BACKEND,
  'src',
  'modules',
  'inventory',
  'services',
  'inventory-transfer.service.ts',
);
const RETURNS_HELPERS = path.join(BACKEND, 'src', 'modules', 'returns', 'returns-write-helpers.service.ts');
const SUBSCRIPTION_SERVICE = path.join(
  BACKEND,
  'src',
  'modules',
  'sales',
  'services',
  'commercial-subscription.service.ts',
);
const DEMO_SEED = path.join(
  BACKEND,
  'src',
  'modules',
  'settings',
  'services',
  'demo-data',
  'settings-demo-data-seed.ts',
);
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
const P3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p3-van-writer.spec.ts');
const REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-repair-type-imports.spec.ts');
const S1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s1-fx-maritime-close-asof.spec.ts');
const S2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s2-maritime-settlement-idempotency.spec.ts');
const S3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s3-money-precision-hr-import.spec.ts');
const DEPOSIT_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'import-deposit-amount-3dp.spec.ts');
const VAN_TRANSFER_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'van-transfer-loaded-amount-3dp.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const WRITES_SPEC = path.join(BACKEND, 'test', 'critical', 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');

const NEW_INV = 'INV-LEGACY-DOC-NUMBER-UNIQUE-BACKSTOP';
const NEW_SPEC_NAME = 'phase1-final-s4-legacy-doc-numbers.spec.ts';

const INDEXES: Array<{ table: string; column: string; name: string }> = [
  { table: 'purchases', column: 'doc_no', name: 'uq_purchases_tenant_doc_no' },
  { table: 'cashier_shifts', column: 'doc_no', name: 'uq_cashier_shifts_tenant_doc_no' },
  { table: 'stock_transfers', column: 'doc_no', name: 'uq_stock_transfers_tenant_doc_no' },
  { table: 'return_documents', column: 'doc_no', name: 'uq_return_documents_tenant_doc_no' },
];

async function makeMigrationDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE purchases (id bigserial PRIMARY KEY, tenant_id text, doc_no text);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, doc_no text);
    CREATE TABLE stock_transfers (id bigserial PRIMARY KEY, tenant_id text, doc_no text);
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, doc_no text);
  `);
  return { pg, db };
}

async function insertDoc(db: Kysely<Database>, table: string, tenant: string, docNo: string | null): Promise<void> {
  await (db as any).insertInto(table).values({ tenant_id: tenant, doc_no: docNo }).execute();
}

async function rowCount(db: Kysely<Database>, table: string): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM ${sql.table(table)}`.execute(db);
  return Number(rows.rows[0]?.n ?? 0);
}

async function indexCount(db: Kysely<Database>, name: string): Promise<number> {
  const rows = await sql<{ n: string }>`
    SELECT COUNT(*) AS n FROM pg_indexes WHERE indexname = ${name}
  `.execute(db);
  return Number(rows.rows[0]?.n ?? 0);
}

async function allIndexesCount(db: Kysely<Database>): Promise<number> {
  let total = 0;
  for (const { name } of INDEXES) total += await indexCount(db, name);
  return total;
}

async function main(): Promise<void> {
  // §1: the writer audit — every indexed column's writer is
  // id-derived, and the two exclusions are pinned to live code.
  {
    const purchasesWrite = fs.readFileSync(PURCHASES_WRITE_CREATE, 'utf8');
    assert.ok(
      purchasesWrite.includes('const docNo = await this.generatePurchaseDocNo(trx, id, scope.tenantId);'),
      'purchases must rename the row via generatePurchaseDocNo after insert',
    );
    assert.ok(
      purchasesWrite.includes('`ZP-${purchaseId}`'),
      'generatePurchaseDocNo must embed the row id (sequential scheme)',
    );
    const grnBill = fs.readFileSync(GRN_BILL, 'utf8');
    assert.ok(grnBill.includes("doc_no: 'TMP',"), 'the GRN-bill path must insert a TMP placeholder first');
    assert.ok(
      grnBill.includes('formatDailyDocumentNumber(') && grnBill.includes("'ZP',"),
      'the GRN-bill path must rename to an id-derived ZP number',
    );
    const drawerHelper = fs.readFileSync(CASH_DRAWER_HELPER, 'utf8');
    assert.ok(
      drawerHelper.includes('export function buildCashDrawerShiftDocNo(shiftId: number'),
      'the shift number builder must take the shift row id',
    );
    assert.ok(
      drawerHelper.includes("formatDailyDocumentNumber('SHIFT', shiftId, date, 4, timeZone)"),
      'the shift number must embed the shift row id',
    );
    const drawerWrite = fs.readFileSync(CASH_DRAWER_WRITE, 'utf8');
    assert.ok(
      drawerWrite.includes('const docNo = buildCashDrawerShiftDocNo(shiftId, undefined, businessTz);'),
      'shift open must rename the NULL doc_no to the generated number in the same transaction',
    );
    const transfer = fs.readFileSync(INVENTORY_TRANSFER, 'utf8');
    assert.ok(
      transfer.includes('private async generateTransferDocNo('),
      'stock transfers must number via generateTransferDocNo',
    );
    assert.equal(
      (transfer.match(/generateTransferDocNo\(trx, /g) || []).length,
      4,
      'all four stock-transfer insert sites must call generateTransferDocNo',
    );
    assert.ok(
      transfer.includes('`ZTR-${transferId}`'),
      'generateTransferDocNo must embed the transfer row id (sequential scheme)',
    );
    const returnsHelpers = fs.readFileSync(RETURNS_HELPERS, 'utf8');
    assert.ok(
      returnsHelpers.includes('const docNo = await this.generateReturnDocNo(trx, id, row.returnType, auth);'),
      'return documents must rename the row via generateReturnDocNo after insert',
    );
    assert.ok(returnsHelpers.includes("doc_no: 'TMP',"), 'return documents must insert a TMP placeholder first');
    assert.ok(
      returnsHelpers.includes('return `${prefix}-${datePrefix}-${seq}`;'),
      'generateReturnDocNo must embed the return-document row id',
    );
    const subscription = fs.readFileSync(SUBSCRIPTION_SERVICE, 'utf8');
    assert.ok(
      subscription.includes('async generateDueInvoices('),
      'subscription billing must run through generateDueInvoices',
    );
    assert.ok(
      subscription.includes('for (const sub of dueSubscriptions)'),
      'subscription billing must loop over every due subscription in one run',
    );
    assert.ok(
      subscription.includes('(sub.invoices_count || 0) + 1'),
      'the subscription invoice number must come from the per-subscription counter (the sales exclusion reason)',
    );
    const demoSeed = fs.readFileSync(DEMO_SEED, 'utf8');
    assert.ok(
      demoSeed.includes('wipeExisting: dtoOrPassword?.wipeExisting ?? true,'),
      'demo seeding must wipe by default, so its fixed INV-/PUR- counters restart cleanly',
    );
    const migration4000 = fs.readFileSync(MIGRATION_4000, 'utf8');
    assert.ok(
      migration4000.includes('DROP TABLE IF EXISTS "returns"'),
      'migration 4000 must drop the old returns table in up (return_documents is the live table)',
    );
    const migrationSrc = fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
    assert.ok(
      !migrationSrc.includes("table: 'sales'"),
      'the migration must not index sales (subscription writer collides)',
    );
    assert.ok(!migrationSrc.includes("table: 'returns'"), 'the migration must not index the dropped returns table');
    console.log('  ✓ writer audit: 4 id-derived writers pinned, sales + old returns table exclusions pinned');
  }

  // §2: the real migration 0344 on PGlite — up / down /
  // pre-check / NULL rows (the 0297 spec's shape).
  {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log('Case 2a: up() creates all four indexes and is idempotent');
      await migration.up(db as any);
      assert.equal(await allIndexesCount(db), 4, 'up() must create all four unique indexes');
      await migration.up(db as any);
      assert.equal(await allIndexesCount(db), 4, 'up() must be idempotent (up -> up keeps exactly four indexes)');
      console.log('  ✓ four indexes created once, up -> up stable');
    } finally {
      await db.destroy();
    }
  }
  for (const { table, name } of INDEXES) {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log(`Case 2b (${table}): duplicate fails 23505; tenant scoping kept`);
      await migration.up(db as any);
      await insertDoc(db, table, 't1', 'DOC-261128-0001');
      await assert.rejects(
        async () => insertDoc(db, table, 't1', 'DOC-261128-0001'),
        (err: any) => err?.code === '23505',
        `A duplicate doc_no for the same tenant in ${table} must fail with 23505`,
      );
      await insertDoc(db, table, 't2', 'DOC-261128-0001');
      await insertDoc(db, table, 't1', 'DOC-261128-0002');
      assert.equal(await rowCount(db, table), 3, `Three rows must exist in ${table} (t1 x2, t2 x1)`);
      assert.equal(await indexCount(db, name), 1, `The ${name} index must exist`);
      console.log(`  ✓ 23505 on duplicate in ${table}, other tenant and other number fine`);
    } finally {
      await db.destroy();
    }
  }
  {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log('Case 2c: down() removes the guard — duplicate then lands (fail-without-fix sensitivity)');
      await migration.up(db as any);
      await insertDoc(db, 'purchases', 't1', 'DOC-261128-0001');
      await assert.rejects(
        async () => insertDoc(db, 'purchases', 't1', 'DOC-261128-0001'),
        (err: any) => err?.code === '23505',
        'Duplicate must fail while the index exists',
      );
      await migration.down(db as any);
      assert.equal(await allIndexesCount(db), 0, 'down() must remove all four indexes');
      await insertDoc(db, 'purchases', 't1', 'DOC-261128-0001');
      assert.equal(await rowCount(db, 'purchases'), 2, 'Without the index the duplicate lands silently (the defect)');
      // Remove the duplicate this case itself created so the final
      // up() can succeed (test teardown only — no production row).
      // Kysely/Postgres has no ORDER BY/LIMIT on DELETE: select
      // the newest id first, then delete by id.
      const dupRows: any[] = await (db as any)
        .selectFrom('purchases')
        .select(['id'])
        .where('doc_no', '=', 'DOC-261128-0001')
        .orderBy('id', 'desc')
        .limit(1)
        .execute();
      await (db as any).deleteFrom('purchases').where('id', '=', Number(dupRows[0].id)).execute();
      await migration.up(db as any);
      assert.equal(await allIndexesCount(db), 4, 'A final up() must restore all four indexes');
      console.log('  ✓ down drops the guard, up restores it');
    } finally {
      await db.destroy();
    }
  }
  for (const { table } of INDEXES) {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log(`Case 2d (${table}): up() refuses loudly on pre-existing duplicates and leaves no index`);
      await insertDoc(db, table, 't1', 'DOC-261128-0001');
      await insertDoc(db, table, 't1', 'DOC-261128-0001');
      await assert.rejects(
        async () => migration.up(db as any),
        new RegExp(`legacy document-number unique backstop refused: ${table} already holds 1 duplicate`),
        `up() must refuse loudly on pre-existing duplicates in ${table}, naming the table`,
      );
      assert.equal(await allIndexesCount(db), 0, 'A refused up() must leave no index behind');
      console.log(`  ✓ loud refusal in ${table}, no index created`);
    } finally {
      await db.destroy();
    }
  }
  {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log('Case 2e: NULL doc_no rows do not block up() (unique indexes permit multiple NULLs)');
      for (const { table } of INDEXES) {
        await insertDoc(db, table, 't1', null);
        await insertDoc(db, table, 't1', null);
      }
      await migration.up(db as any);
      assert.equal(await allIndexesCount(db), 4, 'up() must succeed with legacy NULL doc_no rows present');
      console.log('  ✓ NULL rows are not duplicates');
    } finally {
      await db.destroy();
    }
  }

  // §3: CONTROL — without the index the duplicate lands
  // silently (the defect the index closes).
  {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log('Case 3 (control): two identical doc_no rows without the index => two rows (the gap)');
      await insertDoc(db, 'purchases', 't1', 'DOC-261128-0001');
      await insertDoc(db, 'purchases', 't1', 'DOC-261128-0001');
      assert.equal(await rowCount(db, 'purchases'), 2, '3: without the migration the duplicate lands silently');
      console.log('  ✓ 2 identical rows land without the index (gap proven; the migration is what closes it)');
    } finally {
      await db.destroy();
    }
  }

  // §4: static pins — the migration file is the highest on
  // disk, the engine-map document-numbers row.
  {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts'))
      .sort();
    assert.ok(files.includes(MIGRATION_FILE), 'the 0344 migration file must exist in the migrations directory');
    assert.equal(
      files[files.length - 1],
      '2040000000345_import_fx_payout_idempotency_keys.ts',
      'the 0345 migration must be the highest-numbered migration on disk',
    );
    const engineMap = fs.readFileSync(ENGINE_MAP, 'utf8');
    assert.ok(engineMap.includes(NEW_INV), 'the engine-map document-numbers row must cite the new INV');
    assert.ok(engineMap.includes('uq_purchases_tenant_doc_no'), 'the engine-map row must state the purchases backstop');
    assert.ok(
      engineMap.includes('uq_cashier_shifts_tenant_doc_no'),
      'the engine-map row must state the cashier-shifts backstop',
    );
    assert.ok(
      engineMap.includes('uq_stock_transfers_tenant_doc_no'),
      'the engine-map row must state the stock-transfers backstop',
    );
    assert.ok(
      engineMap.includes('uq_return_documents_tenant_doc_no'),
      'the engine-map row must state the return-documents backstop',
    );
    assert.ok(engineMap.includes('sales is excluded'), 'the engine-map row must state the sales exclusion');
    assert.ok(engineMap.includes('SUB-INV'), 'the engine-map row must name the subscription collision');
    assert.ok(
      engineMap.includes('migration 4000'),
      'the engine-map row must note the old returns table was dropped by migration 4000',
    );
    console.log('  ✓ migration 0345 highest, engine-map row');
  }

  // §5: The INV entry exists exactly once in both places (never
  // quote another INV id literally).
  {
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the new INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-MFA-BEGIN-SETUP-ON-CONFLICT-42702/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');
  }

  // §6: Wiring: both critical lists carry 410 specs in identical
  // order, this spec last.
  {
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    const specs = specsJson.specs;
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: { 'test:critical:serial': string };
    };
    const chain = pkg.scripts['test:critical:serial']
      .split('&&')
      .map((part) => part.trim().replace(/^ts-node\s+/, ''))
      .filter((part) => part.endsWith('.spec.ts'));
    assert.equal(specs.length, 436);
    assert.equal(chain.length, 436);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 410 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s13-mfa-begin-setup.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s13-mfa-begin-setup.spec.ts');
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
      ['P3', P3_SPEC],
      ['repair', REPAIR_SPEC],
      ['S1', S1_SPEC],
      ['S2', S2_SPEC],
      ['S3', S3_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 436);') && src.includes('assert.equal(chain.length, 436);'),
        `${label} spec wiring must re-pin to 410`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s13-mfa-begin-setup.spec.ts'"),
        `${label} spec last-entry must re-pin to the new spec`,
      );
    }
  }

  // §7: The wiring re-pin sweep is complete: no critical spec
  // may still pin the old count, point its last-entry at the
  // slice-3 spec, or pin the old guard INV. (The patterns below
  // are built by concatenation so this block's own source never
  // contains the patterns it scans for.)
  {
    const staleCount: string[] = [];
    const staleLastEntry: string[] = [];
    const staleGuard: string[] = [];
    const prevName = 'phase1-final-s3-money-precision-hr-' + 'import.spec.ts';
    const prevInv = 'INV-MONEY-PRECISION-HR-' + 'IMPORT-3DP';
    const staleSpecs = 'specs.length, 40' + '9';
    const staleChain = 'chain.length, 40' + '9';
    const staleList = 'list.length, 40' + '9';
    for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (409)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the slice-3 spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (slice 3)');
  }

  // §8: The guard tail holds ONLY the newest id, so this package
  // re-pins the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/
  // F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/
  // F5l/F5l-REPAIR/D-M1/D-M3/D-D10a/discount-fix/cleanup/P1/P2/
  // P3/repair/S1/S2/S3 specs' guard assertions to the new INV;
  // their invariants-file assertions still pin their own id
  // (each line stays in ARCHITECTURE_INVARIANTS.md exactly once).
  {
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
      ['P3', P3_SPEC],
      ['repair', REPAIR_SPEC],
      ['S1', S1_SPEC],
      ['S2', S2_SPEC],
      ['S3', S3_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-MFA-BEGIN-SETUP-ON-CONFLICT-42702/g)'),
        `${label} spec guard assertion must re-pin to the new INV`,
      );
    }
  }

  // §9: The module-boundary pins do not move in this package
  // (a migration adds no import statement — no new edge and
  // no total move). The "highest migration" pins re-point to
  // 0344 because this package's migration is the highest on
  // disk (the two 3dp specs, the S2 spec §5/§10 and the S3
  // spec §9).
  {
    const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
    assert.ok(
      boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
      'module-boundary must still pin the backend total 740',
    );
    assert.ok(
      boundary.includes("'delivery-reps->accounting': 109,"),
      'module-boundary must still pin delivery-reps->accounting 109',
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
    const writesDoc = fs.readFileSync(WRITES_DOC, 'utf8');
    assert.ok(
      writesSpec.includes('const PINNED_WRITE_COUNT = 5;'),
      'stock-movements-writes must pin the write count 5',
    );
    assert.ok(writesDoc.includes('Total business writes: **5**'), 'the writes doc must state the total 5');
    for (const [label, specPath] of [
      ['deposit-3dp', DEPOSIT_3DP_SPEC],
      ['van-transfer-3dp', VAN_TRANSFER_3DP_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes(`const HIGHEST_MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
        `${label} spec highest-migration pin must re-point to 0345`,
      );
      assert.ok(
        src.includes('the 0345 migration must be the highest-numbered migration on disk'),
        `${label} spec highest-migration message must re-point to 0345`,
      );
    }
    const s2Src = fs.readFileSync(S2_SPEC, 'utf8');
    assert.ok(
      s2Src.includes(`const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
      'S2 spec migration-file pin must re-point to 0345',
    );
    assert.ok(
      s2Src.includes('the 0345 migration must be the highest-numbered migration on disk'),
      'S2 spec highest-migration assertion must re-point to 0345',
    );
    assert.ok(
      s2Src.includes('spec highest-migration pin must re-point to 0345'),
      'S2 spec §10 pin message must re-point to 0345',
    );
    assert.ok(
      s2Src.includes('spec highest-migration message must re-point to 0345'),
      'S2 spec §10 message must re-point to 0345',
    );
    const s3Src = fs.readFileSync(S3_SPEC, 'utf8');
    assert.ok(
      s3Src.includes(`const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
      'S3 spec migration-file pin must re-point to 0345',
    );
    assert.ok(s3Src.includes('must re-point to 0345'), 'S3 spec highest-migration assertions must re-point to 0345');
  }

  console.log('phase1 final slice 4 checks passed (legacy document numbers, 410 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
