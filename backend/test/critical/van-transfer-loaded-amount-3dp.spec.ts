/*
 * INV-VAN-TRANSFER-LOADED-AMOUNT-3DP: an inter-van transfer accept
 * rounds the transfer retail value at the tenant base currency's
 * book digits (3dp on a 3dp tenant, 2dp otherwise), not at a
 * hardcoded 2dp — and the trips' loaded_amount column carries the
 * 3dp value instead of truncating it back to 2dp on write.
 *
 * WHAT WAS WRONG (two halves, both needed): the accept path cut
 * the transfer retail value with a hardcoded toFixed(2), so on a
 * 3dp tenant a 0.7 x 33.33 transfer (23.331) adjusted both trips by
 * 23.33, losing 0.001 per accept against the transfer's own retail
 * value; and even a correctly rounded 23.331 could not land,
 * because van_sales_trips.loaded_amount was still NUMERIC(15,2)
 * (born 0045) and Postgres silently rounded it back to 23.33 on
 * write. The 0338 migration widens the column to NUMERIC(16,3)
 * and this package routes the calculation through roundMoney at
 * tenant book digits; neither half alone fixes the drift.
 *
 * WHAT THIS PINS:
 * - Migration half, driving the REAL 0338 migration module on
 *   PGlite against a table built at the OLD schema (NUMERIC(15,2),
 *   the exact 0045 definition): pre-migration a 100.125 value
 *   stores as 100.13; up() widens loaded_amount to NUMERIC(16,3);
 *   a second up() is idempotent; down() is a no-op; 23.331
 *   round-trips exactly after the migration; a pre-existing 100.13
 *   reads back as 100.130.
 * - Accept half, driving the REAL acceptInterVanTransfer on PGlite
 *   through the real stock path (moveVanStock / applyStockDelta),
 *   trips at the migrated NUMERIC(16,3) schema:
 *   - KWD (3dp tenant): sender trip loaded 100.000, receiver
 *     0.000, one item 0.7 x 33.33 = 23.331 -> sender 76.669,
 *     receiver 23.331, transfer accepted, sender van stock 0,
 *     receiver van stock 0.7. At 2dp the same inputs give 23.33 /
 *     76.67 — so this case FAILS on unpatched code.
 *   - Egypt (2dp tenant, no behaviour change): same inputs ->
 *     sender 76.67, receiver 23.33 — identical before and after
 *     the fix.
 * - Static pins: the service file keeps zero hardcoded 2dp
 *   rounding sites; the migration is the highest on disk and only
 *   0045 and 0338 ever mention loaded_amount; the spec is wired
 *   into test:critical and the invariant entry exists exactly once.
 *
 * Fail-first: with the accept path restored to the hardcoded 2dp
 * rounding, the KWD trip assertions fail (23.33 / 76.67, not
 * 23.331 / 76.669); with the migration's up() replaced by a no-op
 * the post-migration round-trip assertions fail (100.13, not
 * 100.125). Verified by temporarily mutating each half and watching
 * this spec fail, then restoring it byte-identical.
 *
 * Prospective only: widening changes no stored value (100.13
 * becomes 100.130) and rewrites no posted row; accepts already
 * posted stay as posted. Honest limits: PGlite only — the live-DB
 * information_schema scale check is still owed from the user's PC;
 * no live trial applies beyond the next inter-van accept on a 3dp
 * tenant.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { VanTransfersService } from '../../src/modules/delivery-reps/services/van-transfers.service';
import { up, down } from '../../src/database/migrations/2040000000338_van_sales_trips_loaded_amount_3dp';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'backend', 'src', 'database', 'migrations');
const MIGRATION_FILE = '2040000000338_van_sales_trips_loaded_amount_3dp.ts';
// Highest migration on disk at the time of this edit (0342 is the HR
// biometric raw punches staging migration; the driven migration above
// stays 0338 — only the highest-on-disk pin moves).
const HIGHEST_MIGRATION_FILE = '2040000000346_loss_prevention_anti_theft_shield.ts';

const ACCEPT_SCHEMA = `
  CREATE TABLE settings (tenant_id text, key text, value text);
  CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
  CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric, reserved_qty numeric, retail_price numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
  CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
  CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
  CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, van_location_id bigint, source_warehouse_id bigint, status text, opened_at timestamptz DEFAULT NOW(), closed_at timestamptz, loaded_amount numeric(16,3) DEFAULT 0, sales_amount numeric, cash_collected numeric, credit_sales numeric, returns_amount numeric, variance numeric, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  CREATE TABLE van_stock_transfers (id bigserial PRIMARY KEY, tenant_id text, account_id text, transfer_no text, from_rep_id bigint, from_trip_id bigint, from_van_location_id bigint, to_rep_id bigint, to_trip_id bigint, to_van_location_id bigint, status text, total_items_count int, total_qty numeric, notes text, accepted_at timestamptz, rejected_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  CREATE TABLE van_stock_transfer_items (id bigserial PRIMARY KEY, transfer_id bigint, tenant_id text, product_id bigint, qty numeric, unit_cost numeric, unit_price numeric);
`;

async function makeAcceptDb(opts: { tenant: string; currency: 'KWD' | 'EGP' }): Promise<Kysely<Database>> {
  const { tenant, currency } = opts;
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(ACCEPT_SCHEMA);
  await sql`INSERT INTO settings VALUES (${tenant}, 'currency', ${'"' + currency + '"'})`.execute(db);
  await sql`INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES (${tenant}, ${currency}, 1, true), (${tenant}, 'USD', 50, false)`.execute(
    db,
  );
  // One product, retail 33.33, cost 10; 0.7 units sit in the sender
  // van location (11), none in the receiver van location (12).
  // Global stock equals the location sum (0.7) so the ledger's
  // unassigned-balance reconciliation inserts a zero row, not a
  // phantom quantity.
  await sql`INSERT INTO products VALUES (1, ${tenant}, ${tenant}, 'Item', 0.7, 0, 33.33, 10, NOW())`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES (${tenant}, ${tenant}, 1, NULL, 11, 0.7, 0), (${tenant}, ${tenant}, 1, NULL, 12, 0, 0)`.execute(
    db,
  );
  await sql`INSERT INTO van_sales_trips (id, tenant_id, account_id, rep_id, van_location_id, source_warehouse_id, status, loaded_amount) VALUES (1, ${tenant}, ${tenant}, 101, 11, 10, 'open', 100), (2, ${tenant}, ${tenant}, 102, 12, 10, 'open', 0)`.execute(
    db,
  );
  await sql`INSERT INTO van_stock_transfers (id, tenant_id, account_id, transfer_no, from_rep_id, from_trip_id, from_van_location_id, to_rep_id, to_trip_id, to_van_location_id, status, total_items_count, total_qty) VALUES (1, ${tenant}, ${tenant}, 'XFR-260918-0001', 101, 1, 11, 102, 2, 12, 'pending', 1, 0.7)`.execute(
    db,
  );
  await sql`INSERT INTO van_stock_transfer_items (transfer_id, tenant_id, product_id, qty, unit_cost, unit_price) VALUES (1, ${tenant}, 1, 0.7, 10, 33.33)`.execute(
    db,
  );
  return db;
}

async function tripLoaded(db: Kysely<Database>, tripId: number): Promise<number> {
  const row = await db
    .selectFrom('van_sales_trips' as any)
    .select(['loaded_amount' as any])
    .where('id', '=', tripId)
    .executeTakeFirst();
  return Number((row as any).loaded_amount);
}

async function locationQty(db: Kysely<Database>, locationId: number): Promise<number> {
  const row = await db
    .selectFrom('product_location_stock' as any)
    .select(['qty' as any])
    .where('product_id', '=', 1)
    .where('location_id', '=', locationId)
    .executeTakeFirst();
  return Number((row as any).qty);
}

async function columnScale(db: Kysely<any>): Promise<{ precision: number; scale: number }> {
  const { rows } = await sql<{ numeric_precision: number | null; numeric_scale: number | null }>`
    SELECT numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'van_sales_trips' AND column_name = 'loaded_amount'
  `.execute(db);
  assert.equal(rows.length, 1, 'van_sales_trips.loaded_amount must exist in information_schema');
  assert.notEqual(rows[0].numeric_precision, null, 'loaded_amount precision must be constrained');
  assert.notEqual(rows[0].numeric_scale, null, 'loaded_amount scale must be constrained');
  return { precision: Number(rows[0].numeric_precision), scale: Number(rows[0].numeric_scale) };
}

async function main(): Promise<void> {
  // Case 1: migration half — old schema, up(), idempotence, down().
  {
    const pg = new PGlite();
    const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
    try {
      // Old schema exactly as born: 0045, NUMERIC(15,2).
      await pg.exec(`
        CREATE TABLE van_sales_trips (
          id SERIAL PRIMARY KEY,
          tenant_id VARCHAR(50) NOT NULL,
          loaded_amount NUMERIC(15, 2) DEFAULT 0
        );
      `);
      const pre = await columnScale(db);
      assert.equal(pre.precision, 15, `pre-migration precision must be 15, got ${pre.precision}`);
      assert.equal(pre.scale, 2, `pre-migration scale must be 2, got ${pre.scale}`);
      // Pre-migration pin — the truncation this migration removes:
      // 100.125 stores as 100.13 on the 15,2 schema.
      await sql`INSERT INTO "van_sales_trips" (id, tenant_id, loaded_amount) VALUES (1, 't1', 100.125)`.execute(db);
      const { rows: oldRows } = await sql<{
        loaded_amount: unknown;
      }>`SELECT loaded_amount FROM "van_sales_trips" WHERE id = 1`.execute(db);
      assert.equal(
        String(oldRows[0].loaded_amount),
        '100.13',
        'on the unpatched 15,2 schema a 100.125 loaded_amount must store as 100.13 (the truncation)',
      );
      await sql`DELETE FROM "van_sales_trips" WHERE id = 1`.execute(db);
      // up() widens to NUMERIC(16,3): precision 16 keeps the 13
      // integer digits (15 - 2 + 3).
      await up(db);
      const post = await columnScale(db);
      assert.equal(post.precision, 16, `after up() precision must be 16, got ${post.precision}`);
      assert.equal(post.scale, 3, `after up() scale must be 3, got ${post.scale}`);
      // up() is idempotent: a second run skips the column.
      await up(db);
      const post2 = await columnScale(db);
      assert.equal(post2.precision, 16, 'after second up() precision must stay 16');
      assert.equal(post2.scale, 3, 'after second up() scale must stay 3');
      // down() is a no-op: the column stays NUMERIC(16,3).
      await down(db);
      const postDown = await columnScale(db);
      assert.equal(postDown.precision, 16, 'after down() precision must stay 16');
      assert.equal(postDown.scale, 3, 'after down() scale must stay 3');
      // A 3dp value round-trips exactly after the migration.
      await sql`INSERT INTO "van_sales_trips" (id, tenant_id, loaded_amount) VALUES (2, 't1', 23.331)`.execute(db);
      const { rows: newRows } = await sql<{
        loaded_amount: unknown;
      }>`SELECT loaded_amount FROM "van_sales_trips" WHERE id = 2`.execute(db);
      assert.equal(
        String(newRows[0].loaded_amount),
        '23.331',
        'loaded_amount must round-trip 23.331 exactly after the migration',
      );
      // A pre-existing 2dp value is preserved by the widening.
      await sql`INSERT INTO "van_sales_trips" (id, tenant_id, loaded_amount) VALUES (3, 't1', 100.13)`.execute(db);
      const { rows: keptRows } = await sql<{
        loaded_amount: unknown;
      }>`SELECT loaded_amount FROM "van_sales_trips" WHERE id = 3`.execute(db);
      assert.equal(
        String(keptRows[0].loaded_amount),
        '100.130',
        'a pre-existing 100.13 must read back as 100.130 after widening',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 2: KWD (3dp tenant) — 0.7 x 33.33 = 23.331: sender
  // 100.000 -> 76.669, receiver 0.000 -> 23.331. At 2dp the same
  // inputs give 23.33 / 76.67, so this case FAILS on unpatched code.
  {
    const db = await makeAcceptDb({ tenant: 't-kwd', currency: 'KWD' });
    try {
      const service = new VanTransfersService(db as any);
      const result = await service.acceptInterVanTransfer('t-kwd', 't-kwd', 102, 1);
      assert.equal(result.status, 'accepted', 'the transfer must be accepted');
      assert.equal(await tripLoaded(db, 1), 76.669, 'KWD sender trip must carry 76.669, not 76.67');
      assert.equal(await tripLoaded(db, 2), 23.331, 'KWD receiver trip must carry 23.331, not 23.33');
      assert.equal(await locationQty(db, 11), 0, 'KWD sender van stock must be 0 after the accept');
      assert.equal(await locationQty(db, 12), 0.7, 'KWD receiver van stock must be 0.7 after the accept');
      const movements = await db
        .selectFrom('stock_movements' as any)
        .select(['movement_type' as any])
        .execute();
      assert.deepEqual(
        (movements as any[]).map((m) => m.movement_type).sort(),
        ['van_transfer_in', 'van_transfer_out'],
        'the accept must write both custody movements',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 3: Egypt (2dp tenant, no behaviour change) — same inputs
  // -> sender 76.67, receiver 23.33, identical before and after.
  {
    const db = await makeAcceptDb({ tenant: 't-egp', currency: 'EGP' });
    try {
      const service = new VanTransfersService(db as any);
      const result = await service.acceptInterVanTransfer('t-egp', 't-egp', 102, 1);
      assert.equal(result.status, 'accepted', 'the transfer must be accepted');
      assert.equal(await tripLoaded(db, 1), 76.67, 'EGP sender trip must carry 76.67');
      assert.equal(await tripLoaded(db, 2), 23.33, 'EGP receiver trip must carry 23.33');
      assert.equal(await locationQty(db, 11), 0, 'EGP sender van stock must be 0 after the accept');
      assert.equal(await locationQty(db, 12), 0.7, 'EGP receiver van stock must be 0.7 after the accept');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: static pins — the service file keeps zero hardcoded 2dp
  // rounding sites and routes through roundMoney at tenant digits;
  // the driven 0338 migration is no longer the highest on disk
  // (0340 landed after it) and only 0045 and 0338
  // ever mention loaded_amount; the spec is wired into
  // test:critical and the invariant entry exists exactly once.
  {
    const serviceSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'backend', 'src', 'modules', 'delivery-reps', 'services', 'van-transfers.service.ts'),
      'utf8',
    );
    const stripped = serviceSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    const toFixed2 = (stripped.match(/\.toFixed\(\s*2\s*\)/g) || []).length;
    assert.equal(toFixed2, 0, `the service must keep zero hardcoded 2dp rounding sites, got ${toFixed2}`);
    assert.ok(
      stripped.includes('roundMoney(totalTransferRetailValue, digits)'),
      'the accept path must round through roundMoney at tenant digits',
    );
    assert.ok(
      stripped.includes('tenantBaseCurrency(trx as unknown as Kysely<Database>, tenantId)'),
      'the accept path must resolve digits from the tenant base currency on the transaction',
    );
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts'))
      .sort();
    assert.ok(files.includes(MIGRATION_FILE), 'the 0338 migration file must exist in the migrations directory');
    assert.equal(
      files[files.length - 1],
      HIGHEST_MIGRATION_FILE,
      'the 0346 migration must be the highest-numbered migration on disk',
    );
    const touching: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      if (src.includes('loaded_amount')) touching.push(file);
    }
    assert.deepEqual(
      touching.map((f) => f.slice(0, 13)),
      ['2040000000045', '2040000000338'],
      'only 0045 and 0338 may mention loaded_amount',
    );
    const specs = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'backend', 'scripts', 'critical-specs.json'), 'utf8'))
      .specs as string[];
    assert.ok(
      specs.includes('test/critical/van-transfer-loaded-amount-3dp.spec.ts'),
      'this spec must be wired into test:critical',
    );
    const invariants = fs.readFileSync(path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(
      invariants.split('INV-VAN-TRANSFER-LOADED-AMOUNT-3DP').length - 1,
      1,
      'the invariant entry must exist exactly once',
    );
  }

  console.log(
    'van-transfer-loaded-amount-3dp: all cases passed (migration NUMERIC(16,3), KWD 76.669/23.331, EGP 76.67/23.33 unchanged)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
