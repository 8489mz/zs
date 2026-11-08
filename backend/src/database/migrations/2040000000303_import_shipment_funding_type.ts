import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0303 — add import_shipments.funding_type (TEXT, NOT NULL,
 * DEFAULT 'bank_transfer').
 *
 * Trial 2026-11-09 problem 4: container MSCU-TEST-002 (goods
 * $2,500, above the USD 2,000 Form 4 threshold, Form 4 blank)
 * moved to "In Customs" with no error. The gate engine
 * (INV-IMPORT-FORM4-CLEARANCE-GATE) was already correct and
 * already wired at both clearance and receipt, but its funding
 * input came only from supplier_payments rows linked through
 * proforma invoices — and the trial shipment had no funding
 * rows, so the engine's "no funding recorded → gate does not
 * apply" scoping let it through. The shipment screen had no
 * funding-type field at all, so the rule had nothing to key on.
 *
 * This column is what the gate keys on from now on: every
 * shipment carries a funding type, defaulting to bank_transfer
 * (the common case); cash_carried is exempt from Form 4. The
 * service feeds the shipment's funding_type into
 * evaluateForm4Gate as a funding method alongside any
 * transfer methods, so "no funding recorded" no longer exempts
 * a bank-default shipment. That old engine scoping is
 * SUPERSEDED by policy (recorded at the call site in
 * import-sales.service.ts) — the pure engine keeps its
 * empty-methods branch only as its defined behaviour for
 * callers with genuinely no funding information.
 *
 * New nullable-then-default column only — no FK, no
 * constraint, no backfill step needed: Postgres fills existing
 * rows with the DEFAULT in the same ADD COLUMN (PG 11+
 * does this without a table rewrite), so legacy rows read as
 * bank_transfer. The service additionally treats a NULL
 * funding_type as bank_transfer defensively, so a legacy row
 * can never slip through the gate as untyped.
 * Up is idempotent (ADD COLUMN IF NOT EXISTS); down drops the
 * column.
 */
export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "funding_type" TEXT NOT NULL DEFAULT 'bank_transfer'`.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`ALTER TABLE "import_shipments" DROP COLUMN IF EXISTS "funding_type"`.execute(db);
}

export const migration: Migration = { up, down };
