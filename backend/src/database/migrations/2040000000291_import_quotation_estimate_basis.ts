import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0291 — Import quotation estimate basis (Batch 5, feasibility-estimates-honest).
 *
 * A quotation's estimated landed cost is computed from a commercial exchange
 * rate (default 50) and an assumed customs rate (default 5%) when the caller
 * supplies neither. Those assumed inputs were previously silent: the stored
 * row recorded the resulting estimate but not the basis it was computed from.
 * These additive, nullable columns record the basis at creation time so every
 * estimate output can be labelled with what was assumed. Pre-0291 rows keep
 * NULL (basis not recorded); new rows always set all three columns. No
 * backfill, no data rewrite, no existing column touched.
 */
export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE import_quotations ADD COLUMN IF NOT EXISTS exchange_rate_used NUMERIC(14, 4)`.execute(db);
  await sql`ALTER TABLE import_quotations ADD COLUMN IF NOT EXISTS exchange_rate_assumed BOOLEAN`.execute(db);
  await sql`ALTER TABLE import_quotations ADD COLUMN IF NOT EXISTS customs_rate_assumed BOOLEAN`.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`ALTER TABLE import_quotations DROP COLUMN IF EXISTS customs_rate_assumed`.execute(db);
  await sql`ALTER TABLE import_quotations DROP COLUMN IF EXISTS exchange_rate_assumed`.execute(db);
  await sql`ALTER TABLE import_quotations DROP COLUMN IF EXISTS exchange_rate_used`.execute(db);
}

export const migration: Migration = { up, down };
