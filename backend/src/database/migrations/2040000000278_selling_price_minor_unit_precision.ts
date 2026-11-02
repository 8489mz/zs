import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000278: widen the REMAINING selling-price
 * columns to three minor units, following the 0256-0259/0276/0277
 * widening pattern verbatim (information_schema guard, skip when
 * already scale >= 3, capacity-preserving, down is a no-op that
 * never truncates posted history).
 *
 * CORRECTION (see INV-SELLING-PRICE-SCALE-3): the main sale chain
 * was already widened — 0258 (sales, sale_items unit_price /
 * line_total, sale_payments, customers, customer_ledger,
 * products retail/wholesale), 0259 (returns), 0277 (journal
 * lines) — so this migration targets ONLY the columns those
 * sweeps missed. Re-widening an already-wide column is a
 * harmless skip, but the list below deliberately excludes them
 * so the migration's scope stays auditable.
 */
const requiredColumns: Array<[string, string, number]> = [
  ['products', 'credit_price', 3],
  ['products', 'consumer_price', 3],
  ['products', 'min_selling_price', 3],
  ['sale_items', 'consumer_price', 3],
  ['sale_items', 'unit_offer_savings', 3],
  ['sales_order_items', 'consumer_price', 3],
  ['sales_order_items', 'unit_offer_savings', 3],
  ['held_sales', 'paid_amount', 3],
  ['held_sales', 'cash_amount', 3],
  ['held_sales', 'card_amount', 3],
  ['held_sales', 'discount', 3],
  ['held_sales', 'paid_online_amount', 3],
  ['held_sale_items', 'unit_price', 3],
  ['online_orders', 'subtotal', 3],
  ['online_orders', 'delivery_fee', 3],
  ['online_orders', 'total_amount', 3],
];

const optionalColumns: Array<[string, string, number]> = [
  ['online_orders', 'discount_amount', 3],
  ['held_sales', 'delivery_fee', 3],
  ['price_list_items', 'fixed_price', 3],
  ['product_offers', 'value', 3],
  ['product_customer_prices', 'price', 3],
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const [table, column, scale] of requiredColumns) {
    const { rows } = await sql<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>`
      select data_type, numeric_precision, numeric_scale from information_schema.columns
      where table_schema=current_schema() and table_name=${table} and column_name=${column}
    `.execute(db);
    if (!rows.length) throw new Error(`Required selling-price column missing: ${table}.${column}`);
    const info = rows[0];
    if (info.data_type !== 'numeric' || info.numeric_precision == null || info.numeric_scale == null) {
      throw new Error(`Selling-price column is not a fixed NUMERIC: ${table}.${column}`);
    }
    if (Number(info.numeric_scale) >= scale) continue;
    const capacity = Number(info.numeric_precision) - Number(info.numeric_scale);
    await sql.raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE numeric(${capacity + scale}, ${scale})`).execute(db);
  }
  for (const [table, column, scale] of optionalColumns) {
    const { rows } = await sql<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>`
      select data_type, numeric_precision, numeric_scale from information_schema.columns
      where table_schema=current_schema() and table_name=${table} and column_name=${column}
    `.execute(db);
    if (!rows.length) continue;
    const info = rows[0];
    // Optional columns widen only when they are fixed NUMERICs;
    // a differently-typed column is left alone, never failed.
    if (info.data_type !== 'numeric' || info.numeric_precision == null || info.numeric_scale == null) continue;
    if (Number(info.numeric_scale) >= scale) continue;
    const capacity = Number(info.numeric_precision) - Number(info.numeric_scale);
    await sql.raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE numeric(${capacity + scale}, ${scale})`).execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never truncate mill-denominated posted selling-price history.
}

export const migration = { up, down };
