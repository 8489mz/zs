import { sql, type Kysely } from 'kysely';

/**
 * P1: GRNI + manufacturing book precision. Follows the 0256/0257 pattern.
 * Widening scale only is value-preserving (0.12 becomes 0.120); no backfill
 * is required and no stored value changes. Without this migration the code
 * patches are silently defeated at the storage layer: Postgres rounds
 * NUMERIC(14,2) inserts to 2dp, so a 3dp grni_amount would be stored
 * truncated and the settlement would reconcile to the truncated value.
 * Columns NOT widened here, deliberately: goods_receipt_lines.unit_cost is
 * already NUMERIC(15,4); manufacturing_wo_consumptions.unit_cost is already
 * NUMERIC(20,6) (migration 0252); journal lines were widened by 0256;
 * purchases / purchase_items money columns were widened by 0257.
 */
const columns: Array<[string, string, number]> = [
  ['purchase_items', 'grni_amount', 3],
  ['manufacturing_work_orders', 'total_cost', 3],
  ['manufacturing_wo_consumptions', 'line_total', 3],
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const [table, column, scale] of columns) {
    const { rows } = await sql<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>`
      select data_type, numeric_precision, numeric_scale from information_schema.columns
      where table_schema = current_schema() and table_name = ${table} and column_name = ${column}
    `.execute(db);
    if (!rows.length) throw new Error(`Required monetary column missing: ${table}.${column}`);
    const info = rows[0];
    if (info.data_type !== 'numeric' || info.numeric_precision == null || info.numeric_scale == null) {
      throw new Error(`Monetary column is not a fixed NUMERIC: ${table}.${column}`);
    }
    if (Number(info.numeric_scale) >= scale) continue;
    const capacity = Number(info.numeric_precision) - Number(info.numeric_scale);
    await sql
      .raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE numeric(${capacity + scale}, ${scale})`)
      .execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never truncate posted three-decimal balances by narrowing on rollback.
}

export const migration = { up, down };
