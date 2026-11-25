import { sql, type Kysely } from 'kysely';

/** P0-C: three-minor-unit document/partner persistence; widening is data-preserving. */
const columns: Array<[string, string, number]> = [
  ['purchases', 'subtotal', 3],
  ['purchases', 'discount', 3],
  ['purchases', 'tax_amount', 3],
  ['purchases', 'total', 3],
  ['purchase_items', 'unit_cost', 6],
  ['purchase_items', 'line_total', 3],
  ['suppliers', 'balance', 3],
  ['supplier_ledger', 'amount', 3],
  ['supplier_ledger', 'balance_after', 3],
  ['stock_movements', 'unit_cost', 6],
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const [table, column, scale] of columns) {
    const { rows } = await sql<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>`
      select data_type, numeric_precision, numeric_scale from information_schema.columns
      where table_schema=current_schema() and table_name=${table} and column_name=${column}
    `.execute(db);
    if (!rows.length) throw new Error(`Required P0-C monetary column missing: ${table}.${column}`);
    const info = rows[0];
    if (info.data_type !== 'numeric' || info.numeric_precision == null || info.numeric_scale == null) {
      throw new Error(`P0-C monetary column is not a fixed NUMERIC: ${table}.${column}`);
    }
    if (Number(info.numeric_scale) >= scale) continue;
    const capacity = Number(info.numeric_precision) - Number(info.numeric_scale);
    await sql
      .raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE numeric(${capacity + scale}, ${scale})`)
      .execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never truncate mill-denominated posted vendor debt or inventory history.
}

export const migration = { up, down };
