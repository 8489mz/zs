import { type Migration, sql } from 'kysely';

/*
 * 0328 — stamp unification (single-server-clock audit, RC-9 / P9).
 *
 * TWO defects, one migration, both prospective-only (no row is rewritten,
 * no amount or posted journal changes):
 *
 * (a) Naive TIMESTAMP instant columns. van_sales_trips (opened_at /
 * closed_at / created_at / updated_at) and van_field_visits (visited_at /
 * created_at) store DB NOW() instants in TIMESTAMP WITHOUT TIME ZONE, so
 * what they MEAN depends on the database `timezone` setting — and
 * node-postgres reads them back as host-local Dates, shifting every
 * instant by the host offset. sales.settled_at is the same root cause
 * (naive `timestamp`, stamped by DB NOW() at settlement) and converts
 * in the same pass. REFUTED from the audit's list: van_sales_trips has
 * NO settled_at column (no migration ever added one) — nothing to
 * convert there.
 *
 * Conversion reinterprets each stored wall time in the database's own
 * current timezone setting (the same setting under which NOW() stamped
 * the rows), so the stored INSTANT is preserved: `USING col AT TIME
 * ZONE current_setting('TIMEZONE')`. If the database timezone was ever
 * changed after rows were written, those old rows shift by the delta —
 * unknowable from the database, and the deployed Postgres `timezone`
 * setting is an open audit check; the live server stamps and reads
 * under one setting today. Up is idempotent: a column already
 * timestamptz is skipped (information_schema guard), so re-running the
 * migration is a no-op.
 *
 * (b) CURRENT_DATE defaults on business DATE columns. The default fires
 * in the DATABASE server's local date, not the tenant day — a
 * Kuwait-tenant expense created at 00:30 Cairo time takes the wrong
 * day. Every column below already has its date supplied by the app
 * (tenant-day fallback via resolveBusinessDateKey / todayTenantDate, or
 * a required DTO field), EXCEPT import_broker_expenses.payment_date,
 * which NO writer supplied — its insert now supplies the tenant day in
 * the same package (import-sales.service.ts). Dropping the defaults is
 * therefore behaviour-preserving: the app value wins, and the DB can
 * no longer silently fill a wrong-zone day. Down does NOT restore the
 * defaults — restoring them would reintroduce the exact hole closed
 * here; down only reverses the type conversion.
 *
 * Stamp-source rule this migration establishes (recorded in
 * ARCHITECTURE_INVARIANTS.md at merge): one stamp source per table —
 * van trip/visit instants are DB-stamped (NOW() + defaults, columns
 * now timestamptz); shift-close stamps are app-stamped (one captured
 * `now` per close/review operation, shared by the column and the JSON
 * note — cash-drawer.service.ts); business DATE columns never carry a
 * CURRENT_DATE default.
 */

const TIMESTAMPTZ_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'van_sales_trips', column: 'opened_at' },
  { table: 'van_sales_trips', column: 'closed_at' },
  { table: 'van_sales_trips', column: 'created_at' },
  { table: 'van_sales_trips', column: 'updated_at' },
  { table: 'van_field_visits', column: 'visited_at' },
  { table: 'van_field_visits', column: 'created_at' },
  { table: 'sales', column: 'settled_at' },
];

const DATE_DEFAULT_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'customer_installments', column: 'start_date' },
  { table: 'hr_end_of_service_settlements', column: 'settlement_date' },
  { table: 'contracting_site_daily_logs', column: 'log_date' },
  { table: 'contracting_material_requisitions', column: 'issue_date' },
  { table: 'contracting_supplier_returns', column: 'return_date' },
  { table: 'contracting_labor_attendance', column: 'work_date' },
  { table: 'contracting_petty_cash', column: 'issue_date' },
  { table: 'contracting_site_mobilization_expenses', column: 'expense_date' },
  { table: 'contracting_equipment_transfers', column: 'transfer_date' },
  { table: 'contracting_subcontractor_payments', column: 'payment_date' },
  { table: 'contracting_indirect_expenses', column: 'expense_date' },
  { table: 'contracting_equipment_fuel_logs', column: 'log_date' },
  { table: 'contracting_rfis', column: 'date_requested' },
  { table: 'contracting_labor_attendance_records', column: 'attendance_date' },
  { table: 'contracting_supplier_price_memory', column: 'last_purchase_date' },
  { table: 'contracting_submittals', column: 'submission_date' },
  { table: 'contracting_subcontractor_backcharges', column: 'occurrence_date' },
  { table: 'contracting_inspection_requests', column: 'scheduled_date' },
  { table: 'contracting_project_handovers', column: 'handover_date' },
  { table: 'maritime_carrier_invoices', column: 'invoice_date' },
  { table: 'import_broker_expenses', column: 'expense_date' },
  { table: 'import_broker_expenses', column: 'payment_date' },
];

export async function up(db: any): Promise<void> {
  for (const { table, column } of TIMESTAMPTZ_COLUMNS) {
    const found = await sql<{ data_type: string }>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    `.execute(db);
    if (found.rows[0]?.data_type === 'timestamp without time zone') {
      await sql`
        ALTER TABLE ${sql.table(table)}
        ALTER COLUMN ${sql.ref(column)}
        TYPE TIMESTAMPTZ USING ${sql.ref(column)} AT TIME ZONE current_setting('TIMEZONE')
      `.execute(db);
    }
  }
  for (const { table, column } of DATE_DEFAULT_COLUMNS) {
    // Guarded like the conversion above: a database that never ran a
    // given module's migration (or a minimal test database) simply
    // skips the column instead of aborting the whole migration.
    const found = await sql<{ column_default: string | null }>`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    `.execute(db);
    if (found.rows[0] && found.rows[0].column_default !== null) {
      await sql`
        ALTER TABLE ${sql.table(table)}
        ALTER COLUMN ${sql.ref(column)} DROP DEFAULT
      `.execute(db);
    }
  }
}

export async function down(db: any): Promise<void> {
  for (const { table, column } of TIMESTAMPTZ_COLUMNS) {
    const found = await sql<{ data_type: string }>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    `.execute(db);
    if (found.rows[0]?.data_type === 'timestamp with time zone') {
      await sql`
        ALTER TABLE ${sql.table(table)}
        ALTER COLUMN ${sql.ref(column)}
        TYPE TIMESTAMP USING ${sql.ref(column)} AT TIME ZONE current_setting('TIMEZONE')
      `.execute(db);
    }
  }
}

export const migration: Migration = { up, down };
