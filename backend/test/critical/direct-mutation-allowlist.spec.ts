/*
 * INV-DIRECT-MUTATION-ALLOWLIST-LEDGER-ONLY: only the stock ledger
 * may write products.stock_qty directly.
 *
 * THE GAP: backend/scripts/check-architecture-guardrails.cjs kept a
 * directMutationAllowList of 5 files allowed to write
 * products.stock_qty outside the ledger. Four of those entries were
 * dead or misplaced:
 * - maintenance.service.ts (facade): no direct products update at all —
 *   its stock moves live in its slices (ticket-parts, delete-ticket),
 *   which call applyStockDelta (3 calls).
 * - tradein.service.ts: its only products update sets
 *   track_serials, and its stock_qty: 0 is a product-creation
 *   INSERT; the stock move goes through applyStockDelta.
 * - import-sales.service.ts (facade): no stock_qty write at all —
 *   the stock moves live in its slices (import-receipt-posting,
 *   import-container-preorders), which call applyStockDelta.
 * - settings-demo-data.service.ts: LIVE — resetStockBalances zeroed
 *   every product with one bulk update. That bulk zero is a tenant
 *   wipe (the movement trail is deleted by design, after an
 *   auto-backup, behind admin + password), so per-product
 *   applyStockDelta deltas would be ceremony with no trail to keep
 *   — and applyStockDelta does not touch reserved_qty, which the
 *   reset also zeroes. The zero therefore moved into the ledger
 *   itself as the named resetTenantStockToZero helper, and this
 *   file holds no direct stock_qty write anymore.
 *
 * THE RULE: the allowlist holds exactly one entry — the ledger
 * utility itself (src/common/utils/location-stock-ledger.ts).
 * Every other file that moves stock routes through applyStockDelta
 * (or, for the wipe, through the ledger-owned reset helper).
 *
 * WHAT THIS PINS:
 * - Static: the guard script's allowlist parses to exactly the
 *   ledger entry; the guard's own forbidden pattern
 *   (updateTable('products').set({ ... stock_qty ... })) matches
 *   NONE of the four removed files; resetStockBalances calls
 *   resetTenantStockToZero; maintenance / tradein call
 *   applyStockDelta; the import-sales slices call applyStockDelta.
 * - Behavioural (PGlite): resetTenantStockToZero zeroes stock_qty
 *   AND reserved_qty on every product of the tenant, returns the
 *   zeroed count, and leaves another tenant untouched.
 * Fail-first: on the unpatched code the allowlist still holds 5
 * entries and the helper does not exist, so the static assertions
 * fail before the behavioural part runs.
 * Prospective only; no posted row is rewritten. The demo
 * dataset-seeding INSERTs (insertInto('products') with a
 * stock_qty) are product creation, not mutation, and the guard
 * pattern does not cover them — unchanged.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { resetTenantStockToZero } from '../../src/common/utils/location-stock-ledger';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'backend', 'scripts', 'check-architecture-guardrails.cjs');
const LEDGER = path.join(REPO_ROOT, 'backend', 'src', 'common', 'utils', 'location-stock-ledger.ts');
const DEMO_DATA = path.join(
  REPO_ROOT,
  'backend',
  'src',
  'modules',
  'settings',
  'services',
  'settings-demo-data.service.ts',
);

const REMOVED_FILES = [
  'backend/src/modules/maintenance/maintenance.service.ts',
  'backend/src/modules/tradein/tradein.service.ts',
  'backend/src/modules/import-sales/import-sales.service.ts',
  'backend/src/modules/settings/services/settings-demo-data.service.ts',
];

// The guard's own forbidden pattern, copied verbatim from
// check-architecture-guardrails.cjs — this spec must fail if the
// guard's pattern ever changes without this spec changing too.
const FORBIDDEN_DIRECT_MUTATION = /updateTable\((['"])products\1\)\s*\.set\(\{[^}]*\bstock_qty\b[^}]*\}\)/m;

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function allowlistEntries(): string[] {
  const script = fs.readFileSync(GUARD_SCRIPT, 'utf8');
  const m = script.match(/directMutationAllowList = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'the guard script must still declare directMutationAllowList');
  return [...(m as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

async function main(): Promise<void> {
  // 1. The allowlist holds exactly the ledger — nothing else.
  const entries = allowlistEntries();
  assert.deepEqual(
    entries,
    ['src/common/utils/location-stock-ledger.ts'],
    `directMutationAllowList must hold exactly the ledger entry, got ${JSON.stringify(entries)}`,
  );
  const ledgerSrc = fs.readFileSync(LEDGER, 'utf8');
  assert.ok(
    ledgerSrc.includes('export async function resetTenantStockToZero'),
    'the ledger must export resetTenantStockToZero',
  );

  // 2. The guard's forbidden pattern matches none of the four
  //    removed files.
  for (const rel of REMOVED_FILES) {
    const src = read(rel);
    assert.ok(
      !FORBIDDEN_DIRECT_MUTATION.test(src),
      `${rel} must not contain a direct products.stock_qty mutation anymore`,
    );
  }

  // 3. The reset calls the ledger helper, and the three dead files
  //    keep their ledger path — maintenance and tradein now route
  //    through the row-writer (Phase 1 A9: recordStockMovement runs
  //    the delta through applyStockDelta internally), while the
  //    import-sales files keep the direct ledger call (receipt
  //    posting is A10-deferred; preorders keeps its ledger call at
  //    :591 with the row in row-only mode).
  const demoSrc = fs.readFileSync(DEMO_DATA, 'utf8');
  assert.ok(
    demoSrc.includes('resetTenantStockToZero(trx, tenantId)'),
    'resetStockBalances must call the ledger reset helper',
  );
  assert.ok(
    read('backend/src/modules/maintenance/maintenance/ticket-parts.slice.ts').includes('recordStockMovement(trx,'),
    'maintenance ticket parts must still route stock through the row-writer',
  );
  assert.ok(
    read('backend/src/modules/maintenance/maintenance/delete-ticket.slice.ts').includes('recordStockMovement(trx,'),
    'maintenance delete ticket must still route stock through the row-writer',
  );
  assert.ok(
    read('backend/src/modules/tradein/tradein.service.ts').includes('recordStockMovement(trx,'),
    'tradein must still route stock through the row-writer',
  );
  assert.ok(
    read('backend/src/modules/import-sales/services/import-receipt-posting.service.ts').includes(
      'applyStockDelta(trx,',
    ),
    'import receipt posting must still route stock through applyStockDelta',
  );
  assert.ok(
    read('backend/src/modules/import-sales/services/import-container-preorders.service.ts').includes(
      'applyStockDelta(trx as any,',
    ),
    'import container preorders must still route stock through applyStockDelta',
  );

  // 4. Behavioural: the helper zeroes one tenant only.
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    `);
    await (db as any)
      .insertInto('products')
      .values([
        { id: 1, tenant_id: 't1', account_id: 'a1', name: 'A', stock_qty: 10, reserved_qty: 2 },
        { id: 2, tenant_id: 't1', account_id: 'a1', name: 'B', stock_qty: 0, reserved_qty: 5 },
        { id: 3, tenant_id: 't1', account_id: 'a1', name: 'C', stock_qty: 7.5, reserved_qty: 0 },
        { id: 4, tenant_id: 't2', account_id: 'a2', name: 'Other tenant', stock_qty: 9, reserved_qty: 1 },
      ])
      .execute();
    const zeroed = await resetTenantStockToZero(db as any, 't1');
    assert.equal(zeroed, 3, 'the helper reports the 3 zeroed products of the tenant');
    const rows: any[] = await (db as any)
      .selectFrom('products')
      .select(['id', 'tenant_id', 'stock_qty', 'reserved_qty'])
      .orderBy('id', 'asc')
      .execute();
    for (const row of rows.filter((r: any) => r.tenant_id === 't1')) {
      assert.equal(Number(row.stock_qty), 0, `product ${row.id} stock_qty is zeroed`);
      assert.equal(Number(row.reserved_qty), 0, `product ${row.id} reserved_qty is zeroed`);
    }
    const other = rows.find((r: any) => r.tenant_id === 't2') as any;
    assert.equal(Number(other.stock_qty), 9, 'another tenant is untouched');
    assert.equal(Number(other.reserved_qty), 1, 'another tenant reservations are untouched');
  } finally {
    await db.destroy();
  }

  console.log('direct mutation allowlist checks passed (ledger-only allowlist, helper zeroes one tenant)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
