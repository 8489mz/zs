import { type Migration, sql } from 'kysely';

/*
 * 0330 — add the missing import_broker_expenses.payment_date column
 * (ci-full #50 backend failure, clock P9 follow-up).
 *
 * Clock P9 (migration 0328 + import-sales.service.ts) assumed this
 * column existed with a CURRENT_DATE default and made the app supply
 * the tenant day on insert — but no migration ever created the
 * column: 0238's CREATE TABLE has no payment_date, no later migration
 * adds it, and ImportBrokerExpenseTable has no such field. The service
 * insert therefore failed at runtime ("column payment_date ... does
 * not exist") — in production liquidateBrokerExpenses could never
 * succeed — and the P9 spec only pinned the service source text, so
 * nothing caught it until import-profit-honesty ran the real insert
 * against its minimal schema in ci-full #50.
 *
 * Up adds the column as nullable DATE with NO default: the app always
 * supplies the tenant day (P9 stamp-source rule), and a default
 * would reintroduce the wrong-zone day 0328 removed everywhere else.
 * Legacy rows stay NULL. Up is idempotent (information_schema guard,
 * same pattern as 0328/0329).
 *
 * Down drops the column — it never existed before this migration, so
 * dropping restores the prior schema exactly.
 */

export async function up(db: any): Promise<void> {
  const found = await sql<{ column_name: string | null }>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'import_broker_expenses' AND column_name = 'payment_date'
  `.execute(db);
  if (!found.rows[0]) {
    await sql`
      ALTER TABLE ${sql.table('import_broker_expenses')}
      ADD COLUMN ${sql.ref('payment_date')} DATE
    `.execute(db);
  }
}

export async function down(db: any): Promise<void> {
  await sql`
    ALTER TABLE ${sql.table('import_broker_expenses')}
    DROP COLUMN IF EXISTS ${sql.ref('payment_date')}
  `.execute(db);
}

export const migration: Migration = { up, down };
