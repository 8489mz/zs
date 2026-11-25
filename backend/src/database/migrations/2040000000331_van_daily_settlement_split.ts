import { type Migration, sql } from 'kysely';

/*
 * 0331 — daily-split settlement (INV-VAN-DAILY-SPLIT-SETTLEMENT, P1).
 *
 * THE GAP: a rep who works several days without settling hands over
 * one lump sum: settleTrip writes ONE treasury row for the whole trip
 * (request_key 'rep-remittance:trip:{id}') and no table records which
 * day — or which invoices — the money belongs to. A Monday offline
 * sale synced Friday is indistinguishable from a Friday sale, and the
 * supervisor's "1000 for day X, invoices A + B" has no home.
 *
 * THE RULE: the trip is stamped with its tenant-local business_day at
 * open; the settlement is stamped per day; one treasury remittance
 * row + one van_rep_financial_settlements 'cash_remittance' row +
 * settlement_allocations rows are written PER DAY (per-day
 * request_key 'rep-remittance:trip:{id}:day:{YYYY-MM-DD}', covered by
 * the partial unique index on (tenant_id, request_key) for
 * reference_type='cashier_shift', migration 0274 — a retried day
 * collides instead of doubling). The trip-level journal stays one
 * per trip and is unchanged in shape.
 *
 * PROSPECTIVE ONLY: the backfill below stamps a business_day on
 * legacy rows (metadata only — no amounts, no posted dates, no
 * journals change). Already-settled trips keep their single lump-sum
 * remittance row untouched; no per-day split is invented for them.
 * The tenant timezone for the backfill comes from the settings table
 * (key 'timezone'); a value that is not a bare IANA zone name falls
 * back to Africa/Cairo, so a JSON-quoted or object-shaped stored
 * value can never fail the migration.
 */

export async function up(db: any): Promise<void> {
  await sql`
    ALTER TABLE van_sales_trips
      ADD COLUMN IF NOT EXISTS business_day DATE NULL;
    ALTER TABLE van_sales_trips
      ADD COLUMN IF NOT EXISTS submitted_per_day_cash JSONB NULL;
    ALTER TABLE van_rep_financial_settlements
      ADD COLUMN IF NOT EXISTS business_day DATE NULL;

    CREATE TABLE IF NOT EXISTS settlement_allocations (
      id SERIAL PRIMARY KEY,
      tenant_id VARCHAR NOT NULL,
      settlement_id INTEGER NOT NULL REFERENCES van_rep_financial_settlements(id) ON DELETE CASCADE,
      sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
      customer_payment_id INTEGER REFERENCES customer_payments(id) ON DELETE SET NULL,
      amount NUMERIC(14, 3) NOT NULL,
      business_day DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT settlement_allocations_one_source_chk CHECK (
        (sale_id IS NOT NULL AND customer_payment_id IS NULL) OR
        (sale_id IS NULL AND customer_payment_id IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS idx_settlement_allocations_settlement
      ON settlement_allocations (tenant_id, settlement_id);
    CREATE INDEX IF NOT EXISTS idx_settlement_allocations_day
      ON settlement_allocations (tenant_id, business_day);

    UPDATE van_sales_trips t
      SET business_day = DATE(t.opened_at AT TIME ZONE
        CASE
          WHEN TRIM(BOTH '"' FROM (SELECT s.value FROM settings s WHERE s.tenant_id = t.tenant_id AND s.key = 'timezone' LIMIT 1)) ~ '^[A-Za-z]+/[A-Za-z_+-]+$'
          THEN TRIM(BOTH '"' FROM (SELECT s.value FROM settings s WHERE s.tenant_id = t.tenant_id AND s.key = 'timezone' LIMIT 1))
          ELSE 'Africa/Cairo'
        END)
      WHERE t.business_day IS NULL AND t.opened_at IS NOT NULL;

    UPDATE van_rep_financial_settlements f
      SET business_day = DATE(f.created_at AT TIME ZONE
        CASE
          WHEN TRIM(BOTH '"' FROM (SELECT s.value FROM settings s WHERE s.tenant_id = f.tenant_id AND s.key = 'timezone' LIMIT 1)) ~ '^[A-Za-z]+/[A-Za-z_+-]+$'
          THEN TRIM(BOTH '"' FROM (SELECT s.value FROM settings s WHERE s.tenant_id = f.tenant_id AND s.key = 'timezone' LIMIT 1))
          ELSE 'Africa/Cairo'
        END)
      WHERE f.business_day IS NULL AND f.created_at IS NOT NULL;
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS settlement_allocations;
    ALTER TABLE van_sales_trips DROP COLUMN IF EXISTS business_day;
    ALTER TABLE van_sales_trips DROP COLUMN IF EXISTS submitted_per_day_cash;
    ALTER TABLE van_rep_financial_settlements DROP COLUMN IF EXISTS business_day;
  `.execute(db);
}

export const migration: Migration = { up, down };
