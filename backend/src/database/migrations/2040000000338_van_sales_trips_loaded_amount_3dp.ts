import { sql, type Kysely } from 'kysely';

/**
 * Van trip loaded_amount to 3dp (INV-VAN-TRANSFER-LOADED-AMOUNT-3DP).
 *
 * The inter-van transfer accept path rounds the transfer retail
 * value at the tenant's book digits (3dp on a 3dp tenant), but the
 * column the rounded value lands in was still NUMERIC(15, 2) (born
 * 0045), so Postgres silently rounded any 3dp value back to 2dp on
 * write: a 23.331 transfer stored as 23.33 on both trips' rows,
 * and the sender/receiver loaded_amounts disagreed with the
 * transfer's retail value by 0.001 per accept — the exact
 * silent-divergence class the residual-rounding chain exists to
 * eliminate. This column was missed by every widening sweep so far
 * (0256-0259, 0263-0266, 0271, 0276-0278, 0317, 0321, 0337 list
 * neither this table nor this column); only 0045 (creation) and
 * 0153 (vehicle/odometer columns) ever touch van_sales_trips.
 *
 * Widening is value-preserving (100.13 -> 100.130, precision 15 ->
 * 16 so the 13 integer digits are kept); no backfill, no stored
 * value changes, prospective only. The calculation package (3dp
 * rounding at tenant book digits in acceptInterVanTransfer) lands
 * in the SAME package as this migration — routing the calculation
 * first would post a loaded_amount the trips rows disagree with,
 * and the migration alone changes no behaviour.
 *
 * Follows the 0256/0263/0264/0337 pattern verbatim:
 * information_schema guard, skip when scale >= 3,
 * capacity-preserving widening, down a no-op that never truncates
 * posted history.
 */
const columns: Array<[string, string, number]> = [['van_sales_trips', 'loaded_amount', 3]];

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
