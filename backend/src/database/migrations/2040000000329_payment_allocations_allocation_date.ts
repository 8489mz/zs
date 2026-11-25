import { type Migration, sql } from 'kysely';

/*
 * 0329 — drop the CURRENT_DATE default on payment_allocations.allocation_date
 * (single-server-clock audit, RC-9 / B4-P2).
 *
 * The default fires in the DATABASE server's local date, not the tenant
 * day — a Kuwait-tenant allocation at 00:30 Cairo time took the Cairo
 * day. The writer (PaymentAllocationService.allocatePayment) now
 * supplies the tenant day itself
 * (todayTenantDate(await getTenantTimezone(trx, tenantId), new Date())),
 * so dropping the default is behaviour-preserving for the app path:
 * the app value wins, and the DB can no longer silently fill a
 * wrong-zone day. payment_allocations has exactly ONE writer in src,
 * so no other insert path can depend on the default.
 *
 * Up is idempotent: a database where the default is already gone (or
 * a minimal test database without the table) simply skips the ALTER
 * (information_schema guard, same pattern as 0328).
 *
 * Down does NOT restore the default — restoring it would reintroduce
 * the exact hole this migration closes (P9 precedent: 0328's down
 * likewise never restores a CURRENT_DATE default).
 */

export async function up(db: any): Promise<void> {
  const found = await sql<{ column_default: string | null }>`
    SELECT column_default FROM information_schema.columns
    WHERE table_name = 'payment_allocations' AND column_name = 'allocation_date'
  `.execute(db);
  if (found.rows[0] && found.rows[0].column_default !== null) {
    await sql`
      ALTER TABLE ${sql.table('payment_allocations')}
      ALTER COLUMN ${sql.ref('allocation_date')} DROP DEFAULT
    `.execute(db);
  }
}

export async function down(db: any): Promise<void> {
  // Deliberately a no-op: see the header — restoring the CURRENT_DATE
  // default would reintroduce the hole this migration closes.
}

export const migration: Migration = { up, down };
