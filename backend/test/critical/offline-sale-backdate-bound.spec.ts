/*
 * Clock P2 / single-server-clock rule (RC-6): the POS offline
 * `offlineCreatedAt` gate bounded the FUTURE (now+5min) but not the past —
 * anything back to 2000-01-01 passed, so a device clock set back booked
 * sales into any past day/month inside an open period. This spec pins:
 * (1) the past bound — an offline sale may not be older than 7 days
 * (the offline window for short outages; anything older is a tampered
 * clock or a stale queue and rejects with OFFLINE_TIMESTAMP_INVALID);
 * (2) the server receipt stamp — every offline sale carries both the
 * client's claimed business day (created_at) and the server receipt
 * instant (received_at), stamped from the server clock at insert time;
 * (3) the migration itself — 0325 adds sales.received_at (nullable
 * timestamptz, no default), run here against PGlite, not re-implemented.
 *
 * The gate is driven with the production caller payload: the exact ISO
 * string the POS offline queue sends (sale.savedAt, a device-clock
 * timestamp). The full createSale path is NOT driven here — the PGlite
 * single-connection trap (the service reads this.db inside its own open
 * transaction) would hang it, same as the shift-close spec records for
 * full createSale; the enforcement point (the gate, called from
 * loadSaleContext with the payload value) is driven directly, and the
 * insert spread is the one-line offlineSaleTimestamps call.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import {
  OFFLINE_CREATED_AT_MAX_AGE_MS,
  offlineSaleTimestamps,
  validateOfflineCreatedAt,
} from '../../src/modules/cash-drawer/helpers/cash-drawer.helper';
import { up as migration0325Up } from '../../src/database/migrations/2040000000325_sales_offline_received_at';

// --- Pure layer: the past bound (deterministic fixed "now"). ---
const NOW = new Date('2026-11-14T12:00:00.000Z');
const isoDaysAgo = (days: number, extraMs = 0): string =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000 - extraMs).toISOString();
const isoMinutesAhead = (minutes: number): string => new Date(NOW.getTime() + minutes * 60 * 1000).toISOString();

assert.equal(OFFLINE_CREATED_AT_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000, 'the offline past bound is 7 days in ms');

// A backdate inside the window is still accepted with its business day.
assert.ok(validateOfflineCreatedAt(isoDaysAgo(1), NOW) instanceof Date);
assert.ok(validateOfflineCreatedAt(isoDaysAgo(7), NOW) instanceof Date, 'exactly 7 days old is inside the window');

// A year-2000 backdate is REJECTED — the tampering hole this closes.
assert.throws(
  () => validateOfflineCreatedAt('2000-01-01T00:00:00.000Z', NOW),
  /OFFLINE_TIMESTAMP_INVALID/,
  'a year-2000 backdate must reject, never book into a past month',
);
assert.throws(() => validateOfflineCreatedAt('1970-01-01T00:00:00.000Z', NOW), /OFFLINE_TIMESTAMP_INVALID/);

// Anything older than the window rejects, even by one second.
assert.throws(
  () => validateOfflineCreatedAt(isoDaysAgo(7, 1000), NOW),
  /OFFLINE_TIMESTAMP_INVALID/,
  '7 days + 1 second old must reject',
);
assert.throws(
  () => validateOfflineCreatedAt(isoDaysAgo(8), NOW),
  /OFFLINE_TIMESTAMP_INVALID/,
  'an 8-day-old backdate must reject',
);

// The future bound is unchanged: +5min passes (skew allowance), +6min rejects.
assert.ok(validateOfflineCreatedAt(isoMinutesAhead(5), NOW) instanceof Date);
assert.throws(() => validateOfflineCreatedAt(isoMinutesAhead(6), NOW), /OFFLINE_TIMESTAMP_INVALID/);
assert.throws(
  () => validateOfflineCreatedAt(isoMinutesAhead(60), NOW),
  /OFFLINE_TIMESTAMP_INVALID/,
  'a timestamp an hour in the future must reject, never clamp to now',
);

// Unparseable still rejects; absent still means an online sale.
assert.throws(() => validateOfflineCreatedAt('not-a-date', NOW), /OFFLINE_TIMESTAMP_INVALID/);
assert.equal(validateOfflineCreatedAt(undefined, NOW), null);
assert.equal(validateOfflineCreatedAt('', NOW), null);

// --- Pure layer: the two stamps an offline sale carries. ---
const clientDay = new Date('2026-11-13T10:00:00.000Z');
const serverNow = new Date('2026-11-14T12:00:00.000Z');
assert.deepEqual(offlineSaleTimestamps(null), {}, 'an online sale carries neither stamp');
assert.deepEqual(
  offlineSaleTimestamps(clientDay, serverNow),
  {
    created_at: '2026-11-13T10:00:00.000Z',
    received_at: '2026-11-14T12:00:00.000Z',
  },
  'an offline sale keeps the claimed business day AND the server receipt instant',
);
const defaulted = offlineSaleTimestamps(clientDay);
assert.equal(defaulted.created_at, '2026-11-13T10:00:00.000Z');
assert.ok(
  Math.abs(new Date(defaulted.received_at as string).getTime() - Date.now()) < 60 * 1000,
  'without an explicit receipt instant the stamp defaults to the server clock now',
);
assert.notEqual(
  defaulted.received_at,
  defaulted.created_at,
  'received_at is the server instant, never a copy of the client date',
);

async function main() {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
  try {
    // Minimal sales table as it exists before the migration.
    await pg.exec(`
      CREATE TABLE sales (
        id bigint PRIMARY KEY,
        tenant_id text,
        created_at timestamptz DEFAULT now()
      );
    `);

    // The REAL migration, run twice: up is idempotent.
    await migration0325Up(db);
    await migration0325Up(db);

    const col = await pg.query<{
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_name = 'sales' AND column_name = 'received_at'`,
    );
    assert.equal(col.rows.length, 1, 'migration 0325 must add sales.received_at');
    assert.equal(col.rows[0].data_type, 'timestamp with time zone');
    assert.equal(col.rows[0].is_nullable, 'YES', 'historical rows have no receipt stamp — NULL, never backfilled');

    // An offline sale row: claimed day (client, 1 day ago) + receipt instant (server, now).
    const claimedDay = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const receiptInstant = new Date().toISOString();
    await pg.query(`INSERT INTO sales (id, tenant_id, created_at, received_at) VALUES (1, 't1', $1, $2)`, [
      claimedDay,
      receiptInstant,
    ]);
    const row = await pg.query<{ created_at: string; received_at: string }>(
      `SELECT created_at, received_at FROM sales WHERE id = 1`,
    );
    assert.ok(row.rows[0].created_at, 'the claimed business day must round-trip');
    assert.ok(row.rows[0].received_at, 'the server receipt instant must round-trip');
    assert.ok(
      new Date(row.rows[0].received_at).getTime() > new Date(row.rows[0].created_at).getTime(),
      'the receipt instant must be after the claimed day for a backdated offline sale',
    );

    // An online sale row: no stamps supplied — received_at stays NULL.
    await pg.query(`INSERT INTO sales (id, tenant_id) VALUES (2, 't1')`);
    const online = await pg.query<{ received_at: string | null }>(`SELECT received_at FROM sales WHERE id = 2`);
    assert.equal(online.rows[0].received_at, null, 'an online sale carries no received_at');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
