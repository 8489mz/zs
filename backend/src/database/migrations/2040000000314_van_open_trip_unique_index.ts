import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0314 — one open van trip per rep (INV-VAN-TRIP-LOCKED-STATE-RECHECK).
 *
 * GROUNDING (verified at base 9d215075): openTripAndLoad checks for an
 * existing open trip on the pool handle before its transaction
 * (van-sales.service.ts ~:1306-1317), and the only index on
 * van_sales_trips is the plain (tenant_id, rep_id, status) index from
 * migration 2040000000045 — two concurrent opens both pass the
 * pre-check and both insert an 'open' row, leaving one rep with two
 * live trips (double load, double cash custody). The locked re-check
 * inside the open transaction serializes the common case, but a
 * FOR UPDATE read that finds zero rows locks nothing, so the index
 * below is the race backstop: the second insert fails on the unique
 * violation and openTripAndLoad translates it to TRIP_ALREADY_OPEN.
 *
 * WHAT THIS DOES: a partial unique index on (tenant_id, rep_id)
 * WHERE status = 'open'. Settled trips never conflict (a rep opens a
 * new trip every morning after settling yesterday's), and no other
 * trip status exists in code ('open' | 'settled' only). No backfill:
 * the index is the enforcement; pre-existing duplicate open trips
 * fail the migration loudly instead of being silently merged, so a
 * duplicate on a live tenant must be settled first.
 */

export async function up(db: any): Promise<void> {
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_van_trips_one_open_per_rep
      ON van_sales_trips (tenant_id, rep_id)
      WHERE status = 'open'
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_van_trips_one_open_per_rep`.execute(db);
}

export const migration: Migration = { up, down };
