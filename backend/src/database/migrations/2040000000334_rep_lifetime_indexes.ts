import { type Migration, sql } from 'kysely';

/*
 * 0334 — rep lifetime-report indexes (INV-VAN-PROFIT-REP-REPORTING, P6).
 *
 * THE GAP: the unified rep lifetime endpoint aggregates a rep's whole
 * history by (tenant_id, delivery_rep_id) with created_at ranges
 * (today / this month / lifetime), and the discounted-only lists filter
 * the same way. The existing index idx_sales_tenant_delivery_rep
 * (tenant_id, delivery_rep_id, delivery_status) serves the equality
 * prefix but not the created_at range, and customer_payments /
 * van_field_returns have no rep index at all (only customer / trip /
 * status ones) — so every rep page load scanned the tenant's whole
 * collections and returns history.
 *
 * THE FIX: three covering indexes, one per table the lifetime
 * endpoint aggregates. CREATE INDEX IF NOT EXISTS, no data change,
 * no journal touched. The sales index keeps delivery_status out:
 * the lifetime queries filter by created_at ranges, not status
 * (the per-day due mirrors P1's computeTripDayBuckets, which takes
 * all sales on the trip regardless of status).
 */
export async function up(db: any): Promise<void> {
  await sql`CREATE INDEX IF NOT EXISTS idx_sales_tenant_delivery_rep_created_at ON sales(tenant_id, delivery_rep_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_customer_payments_tenant_rep_created_at ON customer_payments(tenant_id, rep_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_van_field_returns_tenant_rep_created_at ON van_field_returns(tenant_id, rep_id, created_at DESC)`.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_sales_tenant_delivery_rep_created_at`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_customer_payments_tenant_rep_created_at`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_van_field_returns_tenant_rep_created_at`.execute(db);
}
