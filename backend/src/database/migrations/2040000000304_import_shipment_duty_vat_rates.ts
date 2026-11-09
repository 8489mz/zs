import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0304 — add import_shipments.customs_duty_rate_percent,
 * vat_rate_percent and insurance_cost_usd
 * (NUMERIC, NOT NULL, DEFAULT 0).
 *
 * Trial 2026-11-09 problem 6: for the same test goods (10 x $1,
 * freight $5, FX 50) feasibility computed duty 5% (40 EGP) +
 * VAT 14% (117.60 EGP) -> total 1,107.60 EGP (110.76/unit),
 * but the shipment cost model had NO duty/VAT fields — its
 * "جمارك" is a flat EGP fee — so the same goods landed at
 * 90.00/unit (total 900 EGP). The two stages disagreed by
 * 207.60 EGP with no reconciliation.
 *
 * These columns are what the shipment keys its tax on from now
 * on: duty % and VAT % carried from the feasibility study when
 * the shipment is created from it (explicit DTO values win,
 * missing study rates fall back to the feasibility engine's own
 * defaults of 5% / 14%), and the insurance USD that belongs in
 * the CIF basis — feasibility's CIF is goods + freight +
 * insurance, so without the insurance the shipment's duty/VAT
 * could never reproduce the study's 40.00 / 117.60. The flat
 * customs_cost_egp stays untouched as a clearance-style fee,
 * never the tax. Duty is charged on CIF and VAT on (CIF +
 * duty), both capitalized into landed cost exactly as
 * feasibility capitalizes them by default; no VAT is
 * reclassified to a recoverable/input-tax account and no new
 * GL account or payee type is introduced.
 *
 * New columns only, all NOT NULL DEFAULT 0 — no FK, no
 * constraint, no backfill step needed: Postgres fills existing
 * rows with the DEFAULT in the same ADD COLUMN (PG 11+ does
 * this without a table rewrite), so legacy rows read as 0%
 * duty / 0% VAT / no insurance and keep their old totals.
 * The service additionally treats a NULL rate as 0
 * defensively. Up is idempotent (ADD COLUMN IF NOT EXISTS);
 * down drops the columns.
 */
export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "customs_duty_rate_percent" NUMERIC(6, 2) NOT NULL DEFAULT 0`.execute(db);
  await sql`ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "vat_rate_percent" NUMERIC(6, 2) NOT NULL DEFAULT 0`.execute(db);
  await sql`ALTER TABLE "import_shipments" ADD COLUMN IF NOT EXISTS "insurance_cost_usd" NUMERIC(12, 2) NOT NULL DEFAULT 0`.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`ALTER TABLE "import_shipments" DROP COLUMN IF EXISTS "customs_duty_rate_percent"`.execute(db);
  await sql`ALTER TABLE "import_shipments" DROP COLUMN IF EXISTS "vat_rate_percent"`.execute(db);
  await sql`ALTER TABLE "import_shipments" DROP COLUMN IF EXISTS "insurance_cost_usd"`.execute(db);
}

export const migration: Migration = { up, down };
