import { sql, type Kysely } from 'kysely';

/** Widen existing sale/partner monetary evidence without changing old values. */
const requiredColumns: Array<[string, string, number]> = [
  ['sales', 'subtotal', 3],
  ['sales', 'discount', 3],
  ['sales', 'tax_amount', 3],
  ['sales', 'total', 3],
  ['sales', 'paid_amount', 3],
  ['sales', 'store_credit_used', 3],
  ['sale_items', 'unit_price', 3],
  ['sale_items', 'line_total', 3],
  ['sale_payments', 'amount', 3],
  ['customers', 'balance', 3],
  ['customers', 'store_credit_balance', 3],
  ['customer_ledger', 'amount', 3],
  ['customer_ledger', 'balance_after', 3],
  ['products', 'retail_price', 3],
  ['products', 'wholesale_price', 3],
];
const optionalColumns: Array<[string, string, number]> = [
  ['sales', 'delivery_fee', 3],
  ['sales', 'service_charge', 3],
  ['sales', 'tip_amount', 3],
  ['sales', 'applied_amount', 3],
  ['sales', 'tendered_amount', 3],
  ['sales', 'change_amount', 3],
  ['sale_items', 'net_line_total', 3],
  ['sale_items', 'allocated_discount', 3],
  ['sale_items', 'allocated_tax', 3],
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const [table, column, scale] of [...requiredColumns, ...optionalColumns]) {
    const { rows } = await sql<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>`
      select data_type,numeric_precision,numeric_scale from information_schema.columns
      where table_schema=current_schema() and table_name=${table} and column_name=${column}
    `.execute(db);
    if (!rows.length) {
      if (requiredColumns.some(([t, c]) => t === table && c === column)) {
        throw new Error(`Required sales monetary column missing: ${table}.${column}`);
      }
      continue;
    }
    const row = rows[0];
    if (row.data_type !== 'numeric' || row.numeric_precision == null || row.numeric_scale == null) {
      throw new Error(`Sales monetary column not a constrained numeric: ${table}.${column}`);
    }
    if (Number(row.numeric_scale) >= scale) continue;
    const wholeDigits = Number(row.numeric_precision) - Number(row.numeric_scale);
    await sql
      .raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE numeric(${wholeDigits + scale},${scale})`)
      .execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Do not destroy existing KWD/OMR mill-denominated posted sale history on rollback.
}
export const migration = { up, down };
