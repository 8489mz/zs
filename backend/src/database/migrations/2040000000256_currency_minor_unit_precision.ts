import { sql, type Kysely } from 'kysely';

/**
 * P0-C additive widening: numeric(precision,2) cannot store a Kuwaiti/Omani fil.
 * This does not rewrite existing finance values or change tenant currency.
 * Rollback deliberately NEVER truncates posted three-decimal balances.
 */
const columns: Array<[string, string, number]> = [
  ['journal_entry_lines', 'debit', 3],
  ['journal_entry_lines', 'credit', 3],
  ['purchases', 'landed_cost_total', 3],
  ['purchase_landed_costs', 'amount', 3],
  ['purchase_items', 'allocated_landed_cost', 3],
  ['purchase_items', 'landed_unit_cost', 6],
  ['accounting_cheques', 'base_amount', 3],
  ['accounting_cheques', 'settlement_base_amount', 3],
  ['treasury_transactions', 'amount', 3],
  ['supplier_payments', 'amount', 3],
  ['customer_payments', 'amount', 3],
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
