import { sql, type Kysely } from 'kysely';

/** P0-4: three-minor-unit withholding-tax persistence; widening is data-preserving. */
const columns: Array<[string, string, number]> = [
  ['withholding_tax_transactions', 'base_amount', 3],
  ['withholding_tax_transactions', 'tax_amount', 3],
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const [table, column, scale] of columns) {
    const { rows } = await sql<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>`
      select data_type, numeric_precision, numeric_scale from information_schema.columns
      where table_schema=current_schema() and table_name=${table} and column_name=${column}
    `.execute(db);
    if (!rows.length) throw new Error(`Required P0-4 monetary column missing: ${table}.${column}`);
    const info = rows[0];
    if (info.data_type !== 'numeric' || info.numeric_precision == null || info.numeric_scale == null) {
      throw new Error(`P0-4 monetary column is not a fixed NUMERIC: ${table}.${column}`);
    }
    if (Number(info.numeric_scale) >= scale) continue;
    const capacity = Number(info.numeric_precision) - Number(info.numeric_scale);
    await sql.raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE numeric(${capacity + scale}, ${scale})`).execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never truncate mill-denominated posted withholding-tax history.
}

export const migration = { up, down };
