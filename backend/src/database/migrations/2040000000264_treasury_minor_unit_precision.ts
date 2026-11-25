import { sql, type Kysely } from 'kysely';

/**
 * Treasury P1 storage widening: without this, Postgres silently rounds the
 * package's 3-decimal values back to 2dp at insert/update time -- exactly
 * the failure 0263 fixed for GRNI (purchase_items.grni_amount). The code
 * fixes in this package are necessary but not sufficient without it.
 * Rollback deliberately NEVER truncates posted three-decimal balances.
 * Follows the 0263 information_schema pattern; integer capacity preserved.
 */
const columns: Array<[string, string, number]> = [
  // A KWD cheque face amount (10.123) and its bounce fee must be storable;
  // base_amount / settlement_base_amount were already widened by 0256.
  ['accounting_cheques', 'amount', 3],
  ['accounting_cheques', 'bounced_fee', 3],
  // Allocations are stored money: a 10.123 allocation rounded to 10.12 at
  // insert would silently under-allocate and strand 3 fils per line.
  ['payment_allocations', 'allocated_amount', 3],
  // Sales paid_amount was widened by 0258; the purchase side was missed
  // by every sweep so far, so supplier paid_amounts still rounded at 2dp.
  ['purchases', 'paid_amount', 3],
  // Statement balances and lines are imported bank data; a 3dp statement
  // must survive import or the workspace difference inherits 2dp rounding.
  ['bank_statements', 'starting_balance', 3],
  ['bank_statements', 'ending_balance', 3],
  ['bank_statement_lines', 'amount', 3],
  // Shift money: opening/expected/counted/variance at 3dp, matching the
  // variance computation the package moves to bookDigits.
  ['cashier_shifts', 'opening_cash', 3],
  ['cashier_shifts', 'expected_cash', 3],
  ['cashier_shifts', 'counted_cash', 3],
  ['cashier_shifts', 'variance', 3],
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
