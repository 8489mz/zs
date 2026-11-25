import { type Migration, sql } from 'kysely';

/*
 * 0327 — supplier type + overdraft limit (INV-SUPPLIER-ADVANCE-OVERDRAFT-LIMIT).
 *
 * A freelancer (ads/marketing, not an on-site employee) is registered as a
 * supplier, not an HR employee — the HR path would drag in attendance,
 * payroll runs, EOS and insurance for a monthly vendor fee. The supplier
 * card therefore needs a type ('supplier' | 'freelancer') and an owner-set
 * overdraft limit for withdrawals on overdraft.
 *
 * `supplier_type` defaults to 'supplier', so every existing row keeps its
 * meaning; `overdraft_limit` is NULL, and NULL means UNCAPPED — the
 * deliberate deviation from a default of 0. A default of 0 would have
 * blocked the already-live advance flow (INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT)
 * for every ordinary supplier the moment the cap was enforced. The cap
 * applies only when a limit is set.
 *
 * Up is idempotent (ADD COLUMN IF NOT EXISTS) and prospective only: two
 * config columns, no amounts, no posted journals touched. Down drops the
 * two columns; they hold configuration only, no financial history.
 */
export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_type TEXT NOT NULL DEFAULT 'supplier'`.execute(db);
  await sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS overdraft_limit NUMERIC(14,3) NULL`.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`ALTER TABLE suppliers DROP COLUMN IF EXISTS overdraft_limit`.execute(db);
  await sql`ALTER TABLE suppliers DROP COLUMN IF EXISTS supplier_type`.execute(db);
}

export const migration: Migration = { up, down };
