import { sql, type Kysely } from 'kysely';

/**
 * M10 (A9): van_rep_financial_settlements.amount is still
 * numeric(14,2) (migration 2040000000225) while settleTrip inserts
 * book-digit variances — on a 3dp tenant (KWD/OMR/...) a 10.125
 * settlement amount is stored as 10.13 (0.005 loss per item) and the
 * ledger/journal/trip variance disagree by that much. This widens the
 * column to numeric(14,3), the plan's shape (not the 0317
 * precision-preserving 15,3 shape). Prospective only: existing rows
 * are not rewritten. Rollback deliberately NEVER narrows: posted
 * three-decimal amounts must survive a down migration.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const { rows } = await sql<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>`
    SELECT data_type, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'van_rep_financial_settlements' AND column_name = 'amount'
  `.execute(db);
  if (!rows.length) return; // Table absent on legacy optional schemas.
  const info = rows[0];
  if (info.data_type !== 'numeric' || info.numeric_scale === null || info.numeric_precision === null) {
    throw new Error('Currency precision migration requires a constrained numeric column: van_rep_financial_settlements.amount');
  }
  if (Number(info.numeric_scale) >= 3) return;
  await sql`ALTER TABLE "van_rep_financial_settlements" ALTER COLUMN "amount" TYPE numeric(14, 3)`.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never destroy 0.001 posted data by narrowing numeric precision on rollback.
}

export const migration = { up, down };
