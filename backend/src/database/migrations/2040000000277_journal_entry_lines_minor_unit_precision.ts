import { sql, type Kysely } from 'kysely';

/** Journal-leg storage at three minor units; widening is data-preserving. */
const columns: Array<[string, string, number]> = [
  ['journal_entry_lines', 'debit', 3],
  ['journal_entry_lines', 'credit', 3],
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const [table, column, scale] of columns) {
    const { rows } = await sql<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>`
      select data_type, numeric_precision, numeric_scale from information_schema.columns
      where table_schema=current_schema() and table_name=${table} and column_name=${column}
    `.execute(db);
    if (!rows.length) throw new Error(`Required journal monetary column missing: ${table}.${column}`);
    const info = rows[0];
    if (info.data_type !== 'numeric' || info.numeric_precision == null || info.numeric_scale == null) {
      throw new Error(`Journal monetary column is not a fixed NUMERIC: ${table}.${column}`);
    }
    if (Number(info.numeric_scale) >= scale) continue;
    const capacity = Number(info.numeric_precision) - Number(info.numeric_scale);
    await sql.raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE numeric(${capacity + scale}, ${scale})`).execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never truncate mill-denominated posted journal history.
}

export const migration = { up, down };
