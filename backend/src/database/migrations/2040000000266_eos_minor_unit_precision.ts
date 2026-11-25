import { sql, type Kysely } from 'kysely';

/**
 * EOS settlement P1 storage widening (INV-EOS-BOOK-PRECISION): without
 * this, Postgres silently rounds the EOS engine's 3-decimal settlement
 * values back to 2dp at insert time -- exactly the failure 0263 fixed
 * for GRNI, 0264 for treasury and 0265 for payroll. The EOS engine in
 * this package computes at tenant book precision; the columns below are
 * every money amount an end-of-service settlement stores. The GL posting
 * for EOS was already book-precision (posting package), so storage was
 * the remaining blocker, as it was for payroll.
 * Rollback deliberately NEVER truncates posted three-decimal balances.
 * Follows the 0263/0264/0265 information_schema pattern; integer
 * capacity preserved (precision grows by exactly the scale growth).
 *
 * Deliberately NOT widened here: service_years (a year fraction, not
 * money), remaining_leave_days (leave DAYS, not money),
 * gratuity_percentage (a percentage, not money).
 */
const columns: Array<[string, string, number]> = [
  ['hr_end_of_service_settlements', 'last_basic_salary', 3],
  ['hr_end_of_service_settlements', 'last_total_salary', 3],
  ['hr_end_of_service_settlements', 'gratuity_amount', 3],
  ['hr_end_of_service_settlements', 'leave_encashment_amount', 3],
  ['hr_end_of_service_settlements', 'pending_salary_amount', 3],
  ['hr_end_of_service_settlements', 'notice_period_amount', 3],
  ['hr_end_of_service_settlements', 'other_entitlements_amount', 3],
  ['hr_end_of_service_settlements', 'unpaid_loans_deduction', 3],
  ['hr_end_of_service_settlements', 'assets_deduction', 3],
  ['hr_end_of_service_settlements', 'other_deductions', 3],
  ['hr_end_of_service_settlements', 'net_settlement_amount', 3],
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const [table, column, requiredScale] of columns) {
    const { rows } = await sql<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>`
      SELECT data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}
    `.execute(db);
    if (!rows.length) continue; // Legacy optional schema tables are absent on some migrations.
    const info = rows[0];
    if (info.data_type !== 'numeric' || info.numeric_scale === null || info.numeric_precision === null) {
      throw new Error(`Currency precision migration requires a constrained numeric column: ${table}.${column}`);
    }
    if (Number(info.numeric_scale) >= requiredScale) continue;
    const widenedPrecision = Number(info.numeric_precision) - Number(info.numeric_scale) + requiredScale;
    // Names are a fixed internal allowlist; no tenant-controlled SQL identifiers.
    await sql
      .raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE numeric(${widenedPrecision}, ${requiredScale})`)
      .execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never destroy 0.001 posted data by narrowing numeric precision on rollback.
}

export const migration = { up, down };
