import { sql, type Kysely } from 'kysely';

/*
 * 0296 — GRN freight allocation (INV-SHIPPING-ALLOCATION).
 *
 * The live audit (2026-11-07, test10k) found shipping 20.00 on
 * invoice ZP-261105-001288 never reached item cost and the WAC stayed
 * 58.82. Batch 10 P1 fixed only the direct purchase-invoice receipt
 * path (createPurchase landedCosts): the second receipt path — a
 * purchase order received through a goods receipt note — had no
 * freight anywhere. The GRN form carries no freight field,
 * postGoodsReceipt blends the WAC from the bare unit cost only, and
 * the GRNI journal accrues the bare cost only, so a merchant buying
 * through the PO flow can never get shipping into item cost at
 * receipt. (The invoice itself predates the Batch 10 fix — created
 * 2026-11-05, fix pushed 2026-11-07 — so it stays at 58.82 by the
 * prospective-only rule; this fix covers every NEW receipt.)
 *
 * Adds a nullable freight_amount (NUMERIC(15, 4), the table's money
 * style) to goods_receipt_notes, plus the per-line allocation proof
 * (allocated_landed_cost / landed_unit_cost, mirroring purchase_items)
 * to goods_receipt_lines. NULL/0 means "no freight" (legacy rows and
 * freight-free receipts); the values are written only when freight is
 * supplied at receipt creation. No backfill, no existing column
 * touched, no data rewrite. Prospective only.
 */
export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS freight_amount NUMERIC(15, 4) NOT NULL DEFAULT 0`.execute(db);
    await sql`ALTER TABLE goods_receipt_lines ADD COLUMN IF NOT EXISTS allocated_landed_cost NUMERIC(15, 4) NOT NULL DEFAULT 0`.execute(db);
    await sql`ALTER TABLE goods_receipt_lines ADD COLUMN IF NOT EXISTS landed_unit_cost NUMERIC(15, 6)`.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE goods_receipt_notes DROP COLUMN IF EXISTS freight_amount`.execute(db);
    await sql`ALTER TABLE goods_receipt_lines DROP COLUMN IF EXISTS allocated_landed_cost`.execute(db);
    await sql`ALTER TABLE goods_receipt_lines DROP COLUMN IF EXISTS landed_unit_cost`.execute(db);
  },
};
