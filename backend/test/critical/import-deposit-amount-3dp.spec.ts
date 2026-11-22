/*
 * INV-IMPORT-DEPOSIT-AMOUNT-3DP: the five import container deposit
 * columns widen from NUMERIC(15,2) to NUMERIC(16,3).
 *
 * THE STORAGE BLOCK (residual-rounding-deposits-storage-audit.md):
 * the refund path rounds at tenant book digits (3dp on a 3dp
 * tenant), but the columns the rounded values land in were still
 * NUMERIC(15,2), so Postgres silently rounded every 3dp value back
 * to 2dp on write: a 100.125 deposit stored as 100.13, and a 50.125
 * refund stored as 50.13 while the journal credit (journal entry
 * lines, scale 3 since the 0256 widening) kept 50.125 — GL vs
 * subledger disagreeing by 0.005, the exact silent-divergence class
 * this chain exists to eliminate. The five columns were missed by
 * every widening sweep so far; only the 0238 and 0241 creations and
 * the 0306 serial and idempotency change ever touch these tables.
 *
 * WHAT THIS PINS, driving the REAL migration module on PGlite
 * against tables built at the OLD schema (NUMERIC(15,2), the exact
 * 0238 and 0241 definitions for the five money columns):
 * - Pre-migration pin: on the 15,2 schema a 100.125 deposit stores
 *   as 100.13 — the truncation this migration exists to remove.
 *   This assertion is the fail-first proof: it fails if the old
 *   schema ever stops truncating for another reason, and the
 *   post-migration assertions fail if the widening is removed.
 * - up() widens all five columns to NUMERIC(16,3): precision 16
 *   (15 minus 2 plus 3), so the 13 integer digits are preserved.
 * - up() is idempotent: a second run skips every column (the
 *   information_schema guard sees scale 3) and the columns stay
 *   NUMERIC(16,3).
 * - down() is a no-op: after down() the columns are still
 *   NUMERIC(16,3) — a rollback never truncates posted 3dp history.
 * - A 3dp value round-trips exactly after the migration: 100.125
 *   stored and read back as 100.125 on every one of the five
 *   columns. A pre-existing 2dp value is preserved by the widening:
 *   100.13 reads back as 100.130.
 * - The migration is wired: this spec file is listed in the
 *   critical list, and the invariant entry exists exactly once.
 *
 * Fail-first: with the migration's up() replaced by a no-op the
 * post-migration round-trip assertions fail (100.13, not 100.125);
 * with the migration file absent the import fails. Verified by
 * temporarily mutating the migration and watching this spec fail,
 * then restoring it byte-identical.
 *
 * Prospective only: widening changes no stored value (100.13
 * becomes 100.130) and rewrites no posted row. The refund-path
 * calculation package (3dp rounding at tenant book digits) is a
 * separate later package and must NOT land before this migration.
 * Honest limits: PGlite only — the live-DB scale check
 * (information_schema on the real tenant DB) is still owed from
 * the user's PC, because a live DB can drift from the migration
 * chain; no live trial applies to a storage widening beyond that
 * check plus the next refund on a 3dp tenant.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { up, down } from '../../src/database/migrations/2040000000337_import_container_deposit_amount_3dp';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'backend', 'src', 'database', 'migrations');
const MIGRATION_FILE = '2040000000337_import_container_deposit_amount_3dp.ts';
// Highest migration on disk at the time of this edit (0340 landed
// after 0338 and owns the top slot now — see the section-8 pin;
// 0340 is the F12 deliveryRepsAdmin backfill from the van-trial
// fix chain, and it touches neither deposit table).
const HIGHEST_MIGRATION_FILE = '2040000000340_delivery_reps_admin_backfill.ts';

const COLUMNS: Array<[string, string]> = [
  ['import_container_deposits', 'deposit_amount_egp'],
  ['import_container_deposits', 'refunded_amount_egp'],
  ['import_container_deposits', 'deductions_amount_egp'],
  ['import_container_refund_events', 'refunded_amount_egp'],
  ['import_container_refund_events', 'deductions_amount_egp'],
];

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<any> }> {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
  // Old schema exactly as born: 0238 deposits, 0241 refund events,
  // NUMERIC(15,2) on all five money columns. Only the columns the
  // migration touches are created; nothing else is needed to prove
  // the widening.
  await pg.exec(`
    CREATE TABLE import_container_deposits (
      id text PRIMARY KEY,
      tenant_id text NOT NULL,
      shipment_id text NOT NULL,
      container_no text NOT NULL,
      deposit_amount_egp NUMERIC(15, 2) NOT NULL,
      refunded_amount_egp NUMERIC(15, 2) DEFAULT 0,
      deductions_amount_egp NUMERIC(15, 2) DEFAULT 0
    );
    CREATE TABLE import_container_refund_events (
      id text PRIMARY KEY,
      tenant_id text NOT NULL,
      deposit_id text NOT NULL REFERENCES import_container_deposits(id) ON DELETE RESTRICT,
      refunded_amount_egp NUMERIC(15, 2) NOT NULL DEFAULT 0,
      deductions_amount_egp NUMERIC(15, 2) NOT NULL DEFAULT 0
    );
  `);
  return { pg, db };
}

async function columnScale(db: Kysely<any>, table: string, column: string): Promise<{ precision: number; scale: number }> {
  const { rows } = await sql<{ numeric_precision: number | null; numeric_scale: number | null }>`
    SELECT numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}
  `.execute(db);
  assert.equal(rows.length, 1, `column ${table}.${column} must exist in information_schema`);
  assert.notEqual(rows[0].numeric_precision, null, `${table}.${column} precision must be constrained`);
  assert.notEqual(rows[0].numeric_scale, null, `${table}.${column} scale must be constrained`);
  return { precision: Number(rows[0].numeric_precision), scale: Number(rows[0].numeric_scale) };
}

async function assertScales(db: Kysely<any>, precision: number, scale: number, label: string): Promise<void> {
  for (const [table, column] of COLUMNS) {
    const got = await columnScale(db, table, column);
    assert.equal(got.precision, precision, `${label}: ${table}.${column} precision must be ${precision}, got ${got.precision}`);
    assert.equal(got.scale, scale, `${label}: ${table}.${column} scale must be ${scale}, got ${got.scale}`);
  }
}

async function readAmount(db: Kysely<any>, table: string, column: string, id: string): Promise<string> {
  const { rows } = await sql<{ value: unknown }>`
    SELECT ${sql.raw(`"${column}"`)} AS value FROM ${sql.raw(`"${table}"`)} WHERE id = ${id}
  `.execute(db);
  assert.equal(rows.length, 1, `row ${id} must exist in ${table}`);
  return String(rows[0].value);
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    // 1. The old schema, before the migration: all five columns are
    // NUMERIC(15,2) exactly as 0238/0241 created them.
    await assertScales(db, 15, 2, 'pre-migration');

    // 2. Pre-migration pin — the truncation this migration removes:
    // 100.125 stores as 100.13 on the 15,2 schema.
    await sql`INSERT INTO "import_container_deposits" (id, tenant_id, shipment_id, container_no, deposit_amount_egp) VALUES ('dep-old', 't1', 'ship-1', 'MSCU-TEST-001', 100.125)`.execute(db);
    assert.equal(
      await readAmount(db, 'import_container_deposits', 'deposit_amount_egp', 'dep-old'),
      '100.13',
      'on the unpatched 15,2 schema a 100.125 deposit must store as 100.13 (the truncation)',
    );
    await sql`DELETE FROM "import_container_deposits" WHERE id = 'dep-old'`.execute(db);

    // 3. up() widens all five columns to NUMERIC(16,3): precision
    // 16 keeps the 13 integer digits (15 - 2 + 3).
    await up(db);
    await assertScales(db, 16, 3, 'after up()');

    // 4. up() is idempotent: a second run skips every column and
    // nothing changes.
    await up(db);
    await assertScales(db, 16, 3, 'after second up()');

    // 5. down() is a no-op: the columns stay NUMERIC(16,3) — a
    // rollback never truncates posted 3dp history.
    await down(db);
    await assertScales(db, 16, 3, 'after down()');

    // 6. A 3dp value round-trips exactly on every one of the five
    // columns after the migration (must FAIL on the unpatched
    // schema, where it stores as 100.13).
    await sql`INSERT INTO "import_container_deposits" (id, tenant_id, shipment_id, container_no, deposit_amount_egp, refunded_amount_egp, deductions_amount_egp) VALUES ('dep-1', 't1', 'ship-1', 'MSCU-TEST-001', 100.125, 50.125, 0.125)`.execute(db);
    await sql`INSERT INTO "import_container_refund_events" (id, tenant_id, deposit_id, refunded_amount_egp, deductions_amount_egp) VALUES ('evt-1', 't1', 'dep-1', 50.125, 0.125)`.execute(db);
    assert.equal(await readAmount(db, 'import_container_deposits', 'deposit_amount_egp', 'dep-1'), '100.125', 'deposit_amount_egp must round-trip 100.125 exactly');
    assert.equal(await readAmount(db, 'import_container_deposits', 'refunded_amount_egp', 'dep-1'), '50.125', 'deposits refunded_amount_egp must round-trip 50.125 exactly');
    assert.equal(await readAmount(db, 'import_container_deposits', 'deductions_amount_egp', 'dep-1'), '0.125', 'deposits deductions_amount_egp must round-trip 0.125 exactly');
    assert.equal(await readAmount(db, 'import_container_refund_events', 'refunded_amount_egp', 'evt-1'), '50.125', 'events refunded_amount_egp must round-trip 50.125 exactly');
    assert.equal(await readAmount(db, 'import_container_refund_events', 'deductions_amount_egp', 'evt-1'), '0.125', 'events deductions_amount_egp must round-trip 0.125 exactly');

    // 7. Value-preserving widening: a pre-existing 2dp value is
    // unchanged by the migration (100.13 reads back as 100.130).
    await sql`INSERT INTO "import_container_deposits" (id, tenant_id, shipment_id, container_no, deposit_amount_egp) VALUES ('dep-2', 't1', 'ship-1', 'MSCU-TEST-002', 100.13)`.execute(db);
    assert.equal(await readAmount(db, 'import_container_deposits', 'deposit_amount_egp', 'dep-2'), '100.130', 'a pre-existing 100.13 must read back as 100.130 after widening');
  } finally {
    await db.destroy();
  }

  // 8. Static pins: the migration file exists, the 0340 migration
  // is the highest on disk (0338 stopped being highest when 0340
  // landed), and no migration other than the two creators
  // (0238, 0241), the serial-id change (0306) and this one ever
  // touches either table.
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts')).sort();
  assert.ok(files.includes(MIGRATION_FILE), 'the 0337 migration file must exist in the migrations directory');
  assert.equal(files[files.length - 1], HIGHEST_MIGRATION_FILE, 'the 0340 migration must be the highest-numbered migration on disk');
  const touching: string[] = [];
  for (const file of files) {
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    if (src.includes('import_container_deposits') || src.includes('import_container_refund_events')) touching.push(file);
  }
  assert.deepEqual(
    touching.map((f) => f.slice(0, 13)),
    ['2040000000238', '2040000000241', '2040000000306', '2040000000337'],
    'only 0238, 0241, 0306 and 0337 may touch the two deposit tables',
  );

  // 9. Wiring + invariant: this spec is in the critical list and
  // the invariant entry exists exactly once.
  const specs = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'backend', 'scripts', 'critical-specs.json'), 'utf8')).specs as string[];
  assert.ok(specs.includes('test/critical/import-deposit-amount-3dp.spec.ts'), 'this spec must be wired into test:critical');
  const invariants = fs.readFileSync(path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md'), 'utf8');
  assert.equal(
    invariants.split('INV-IMPORT-DEPOSIT-AMOUNT-3DP').length - 1,
    1,
    'the invariant entry must exist exactly once',
  );

  console.log('import-deposit-amount-3dp: all cases passed (5 columns NUMERIC(16,3), 100.125 round-trips exactly)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
