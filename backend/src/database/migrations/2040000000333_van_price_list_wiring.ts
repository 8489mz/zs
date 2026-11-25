import type { Migration } from 'kysely';

/*
 * INV-VAN-PRICE-LIST-WIRING: the decided pricing model (user,
 * 2026-11-16) is purchase price + 4 selling prices (retail,
 * half-wholesale, wholesale, credit = the base price reps sell at)
 * plus a cash-discount % (tenant setting) off the selling price on
 * immediate cash payment. Cash is NOT a stored price.
 *
 * - products.half_wholesale_price NUMERIC(14,3) NULL: the one
 *   selling price missing from the product form. NULL means "not
 *   set" and falls back to wholesale (then retail) at read time,
 *   mirroring how credit_price NULL falls back today. No ordering
 *   bound is enforced (half-wholesale between wholesale and retail
 *   is the owner's pricing choice, not a system rule).
 * - sales.system_cash_discount_amount NUMERIC(14,3) NULL: the
 *   SYSTEM cash discount computed server-side from the tenant
 *   setting, recorded distinctly from the rep-entered invoice
 *   discount (cashDiscountAmount, cap-gated) so the invoice can
 *   show "rep discount" vs "cash discount" as separate lines.
 *   NULL on historical rows (never computed there); 0 when the
 *   setting is off or the sale is not immediate cash.
 *
 * Prospective only: no backfill.
 */
export const migration: Migration = {
  async up(db) {
    await db.schema.alterTable('products').addColumn('half_wholesale_price', 'numeric(14, 3)').execute();
    await db.schema.alterTable('sales').addColumn('system_cash_discount_amount', 'numeric(14, 3)').execute();
  },
  async down(db) {
    await db.schema.alterTable('sales').dropColumn('system_cash_discount_amount').execute();
    await db.schema.alterTable('products').dropColumn('half_wholesale_price').execute();
  },
};
