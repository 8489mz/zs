import { sql, type Kysely } from 'kysely';

/**
 * S1 additive widening (INV-SERVICES-AMOUNT-3DP): services.amount is still
 * numeric(14,2) — the 0256-0278 widening migrations never mention the
 * services table, so on a 3dp tenant (KWD/OMR/...) 10.125 is stored and
 * posted as 10.13 (0.005 loss) and the audit log prints the input 10.125
 * against the journal 10.13. This widens the column to numeric(15,3)
 * (current precision - current scale + 3), matching the 0256 pattern.
 * This does not rewrite existing values or change tenant currency.
 * Rollback deliberately NEVER truncates posted three-decimal amounts.
 */
const columns: Array<[string, string, number]> = [['services', 'amount', 3]];

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
    await sql.raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE numeric(${widenedPrecision}, ${requiredScale})`).execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never destroy 0.001 posted data by narrowing numeric precision on rollback.
}

export const migration = { up, down };
