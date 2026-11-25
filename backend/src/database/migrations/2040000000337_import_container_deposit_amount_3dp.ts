import { sql, type Kysely } from 'kysely';

/**
 * Import container deposit amounts to 3dp (INV-IMPORT-DEPOSIT-AMOUNT-3DP).
 *
 * The persisted refund columns were still NUMERIC(15, 2) (born 0238 for
 * import_container_deposits, 0241 for import_container_refund_events),
 * so Postgres silently rounded any 3dp value back to 2dp on write:
 * a 100.125 deposit stored as 100.13, and a 50.125 refund stored as
 * 50.13 while the journal credit (journal_entry_lines, scale 3 since
 * 0256 + 0277) kept 50.125 — GL vs subledger disagreeing by 0.005,
 * the exact silent-divergence class the residual-rounding chain
 * exists to eliminate. These five columns were missed by every
 * widening sweep so far (0256-0259, 0263-0266, 0271, 0276-0278, 0317,
 * 0321 list neither table); only 0238, 0241 and 0306 (serial_id /
 * idempotency only) ever touch them.
 *
 * Widening is value-preserving (100.13 -> 100.130, precision 15 -> 16
 * so the 13 integer digits are kept); no backfill, no stored value
 * changes, prospective only. The refund-path calculation package
 * (3dp rounding at tenant book digits) must land only AFTER this
 * migration — routing the calculation first would post a JE the
 * subledger rows disagree with.
 *
 * Follows the 0256/0263/0264 pattern verbatim: information_schema
 * guard, skip when scale >= 3, capacity-preserving widening, down a
 * no-op that never truncates posted history.
 */
const columns: Array<[string, string, number]> = [
  ['import_container_deposits', 'deposit_amount_egp', 3],
  ['import_container_deposits', 'refunded_amount_egp', 3],
  ['import_container_deposits', 'deductions_amount_egp', 3],
  ['import_container_refund_events', 'refunded_amount_egp', 3],
  ['import_container_refund_events', 'deductions_amount_egp', 3],
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
