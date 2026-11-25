import { sql, type Kysely } from 'kysely';

/** Return values must retain the original posted KWD/OMR minor unit. */
const required: Array<[string, string, number]> = [
  ['return_documents', 'total', 3],
  ['return_items', 'unit_total', 3],
  ['return_items', 'line_total', 3],
];
const optional: Array<[string, string, number]> = [
  ['return_items', 'allocated_tax', 3],
  ['purchase_items', 'allocated_tax', 3],
  ['return_documents', 'refund_amount', 3],
];
export async function up(db: Kysely<any>): Promise<void> {
  for (const [table, column, scale] of [...required, ...optional]) {
    const { rows } = await sql<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>`
      select data_type,numeric_precision,numeric_scale from information_schema.columns
      where table_schema=current_schema() and table_name=${table} and column_name=${column}
    `.execute(db);
    if (!rows.length) {
      if (required.some(([t, c]) => t === table && c === column))
        throw new Error(`Missing posted return monetary column ${table}.${column}`);
      continue;
    }
    const info = rows[0];
    if (info.data_type !== 'numeric' || info.numeric_precision == null || info.numeric_scale == null) {
      throw new Error(`Unexpected return monetary type ${table}.${column}`);
    }
    if (Number(info.numeric_scale) >= scale) continue;
    const integerDigits = Number(info.numeric_precision) - Number(info.numeric_scale);
    await sql
      .raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE numeric(${integerDigits + scale},${scale})`)
      .execute(db);
  }
}
export async function down(_db: Kysely<any>): Promise<void> {
  // Never narrow historical posted supplier/customer returns to cents.
}
export const migration = { up, down };
