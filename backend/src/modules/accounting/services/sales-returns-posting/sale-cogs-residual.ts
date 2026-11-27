// Sale COGS residual helpers (file #46 S1).
// Pure move from sales-returns-posting.service.ts: saleCogsResidual,
// readSaleResidualLines, residualCogsGroups, salesReturnCogsResidual,
// salesReturnCogsAmount. Self-contained cluster — no dep fields, no
// bound deps; the in-slice this.* calls stay inside this class.

import type { Transaction } from 'kysely';
import { sql } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import { calculateSalesReturnCost, resolveSalesReturnCostLines } from '../../engines/sales-return-cost.engine';
import { cogsResidualAmount, type CogsResidualGroup } from '../../engines/cogs-residual.engine';
import type { MoneyDigits } from '../../engines/money-minor-units.engine';
import { residualModifierList, residualSoldUnitRemaining } from './sales-returns-posting-types';

export class SaleCogsResidualService {
  /**
   * INV-COGS-REMAINDER-ABSORPTION + INV-COGS-REMAINDER-SOLD-UNIT-BASIS:
   * COGS for a sale (or edited sale) is the residual of the pre-sale stock
   * value minus the remaining stock value at book digits, per product and
   * frozen unit cost. The remaining quantity is read AFTER the sale's stock
   * movement on the caller's transaction handle, summed across all branches
   * and locations (weighted cost is product-level), and converted to the
   * sold-unit basis before the residual (remaining VALUE at the frozen
   * per-base-unit costs, divided by the per-sold-unit frozen cost), so the
   * read and the journal commit or roll back together. Products with
   * no stock row (or a null product) contribute zero remaining
   * quantity, which makes the residual equal the old total
   * rounding for those lines.
   */
  async saleCogsResidual(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
    bookDigits: MoneyDigits,
  ): Promise<number> {
    const saleItems = await this.readSaleResidualLines(queryable, tenantId, saleId);
    const groups = await this.residualCogsGroups(queryable, tenantId, saleItems, null);
    return cogsResidualAmount(groups, bookDigits);
  }

  async readSaleResidualLines(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
  ): Promise<
    Array<{
      id: number;
      product_id: number | null;
      qty: number | string;
      cost_price: number | string | null;
      unit_multiplier: number | string | null;
      modifiers: unknown;
    }>
  > {
    return (
      queryable
        .selectFrom('sale_items')
        .select(['id', 'product_id', 'qty', 'cost_price', 'unit_multiplier', 'modifiers'])
        .where('sale_id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        // Deterministic line order: the remaining quantity of a product is
        // assigned to its first product-and-cost group, so the anchor must
        // not depend on the database's unspecified row order.
        .orderBy('id')
        .execute() as Promise<
        Array<{
          id: number;
          product_id: number | null;
          qty: number | string;
          cost_price: number | string | null;
          unit_multiplier: number | string | null;
          modifiers: unknown;
        }>
      >
    );
  }

  /*
   * Shared residual grouping for sale COGS and the sales-return mirror
   * (INV-SALES-RETURN-COGS-RESIDUAL-MIRROR). One grouping rule, two
   * quantities: in sale mode (qtySoldBySaleItemId null) each line
   * contributes its sold quantity and the anchor is the remaining
   * quantity read after the sale's stock movement. In return mode the
   * map holds the returned quantity per sale line (sold units); only
   * lines in the map participate, and the anchor is the post-sale
   * remaining quantity reconstructed as the current remaining stock
   * (read after the return's restock, on the same transaction) minus
   * the restocked base quantity of the group — so the reversal is
   * exactly the residual the sale would have posted for the returned
   * portion, and sequential returns telescope to the posted COGS.
   * Modifier anchoring, the per-group rule, and the deterministic
   * order are identical in both modes: soldProductIds and the
   * component pool are computed over ALL sale lines, while only
   * participating lines create groups.
   */
  async residualCogsGroups(
    queryable: Transaction<Database>,
    tenantId: string,
    saleItems: Array<{
      id: number;
      product_id: number | null;
      qty: number | string;
      cost_price: number | string | null;
      unit_multiplier: number | string | null;
      modifiers: unknown;
    }>,
    qtySoldBySaleItemId: Map<number, number> | null,
  ): Promise<CogsResidualGroup[]> {
    const soldProductIds = new Set<number>();
    for (const item of saleItems) {
      const id = Number(item.product_id || 0);
      if (id > 0) soldProductIds.add(id);
    }
    const modifierLists = saleItems.map((item) => residualModifierList(item.modifiers));
    const productIds = new Set<number>(soldProductIds);
    for (const mods of modifierLists) {
      for (const mod of mods) {
        if (mod.componentId > 0) productIds.add(mod.componentId);
      }
    }
    const remainingByProduct = new Map<number, number>();
    if (productIds.size > 0) {
      const stockRows = await queryable
        .selectFrom('product_location_stock')
        .select(['product_id', 'qty'])
        .where('tenant_id', '=', tenantId)
        .where('product_id', 'in', [...productIds])
        .execute();
      for (const row of stockRows) {
        const id = Number(row.product_id || 0);
        remainingByProduct.set(id, (remainingByProduct.get(id) || 0) + Number(row.qty || 0));
      }
    }
    // Restocked base quantity per product-and-cost group (return mode
    // only): returned sold units converted back to base units through
    // each line's own multiplier, so the reconstructed post-sale
    // remaining quantity is in the same base units the stock read
    // reports. Sale mode contributes nothing here.
    const restockedBaseByGroup = new Map<string, number>();
    if (qtySoldBySaleItemId) {
      for (const item of saleItems) {
        const returned = qtySoldBySaleItemId.get(Number(item.id));
        if (!(returned! > 0)) continue;
        const rawMultiplier = Number(item.unit_multiplier ?? 1);
        const multiplier = Number.isFinite(rawMultiplier) && rawMultiplier > 0 ? rawMultiplier : 1;
        const key = `${Number(item.product_id || 0)}|${Number(item.cost_price || 0)}`;
        restockedBaseByGroup.set(key, (restockedBaseByGroup.get(key) || 0) + returned! * multiplier);
      }
    }
    const anchoredModifierProducts = new Set<number>();
    const grouped = new Map<string, CogsResidualGroup>();
    saleItems.forEach((item, index) => {
      const productId = Number(item.product_id || 0);
      const unitCost = Number(item.cost_price || 0);
      const qtySold = qtySoldBySaleItemId ? qtySoldBySaleItemId.get(Number(item.id)) || 0 : Number(item.qty || 0);
      if (qtySoldBySaleItemId && !(qtySold > 0)) return;
      const key = `${productId}|${unitCost}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.qtySold += qtySold;
        return;
      }
      const rawMultiplier = Number(item.unit_multiplier ?? 1);
      const multiplier = Number.isFinite(rawMultiplier) && rawMultiplier > 0 ? rawMultiplier : 1;
      grouped.set(key, {
        qtySold,
        unitCost,
        qtyRemaining: residualSoldUnitRemaining({
          unitCost,
          multiplier,
          remainingBaseQty:
            productId > 0 ? (remainingByProduct.get(productId) || 0) - (restockedBaseByGroup.get(key) || 0) : 0,
          modifiers: modifierLists[index],
          remainingByProduct,
          soldProductIds,
          anchoredModifierProducts,
          parentProductId: productId,
        }),
      });
    });
    return [...grouped.values()];
  }

  /*
   * INV-SALES-RETURN-COGS-RESIDUAL-MIRROR: a return reverses COGS on the
   * same residual basis the sale posted it. The plain qty x frozen cost
   * product ignores the anchor remainder the sale's COGS carries, so a
   * return stranded one minor unit in 1140 per affected return. The
   * mirror feeds the returned quantity through the shared residual
   * grouping with the post-sale remaining quantity reconstructed from
   * the post-restock stock read, so GL equals physical after sale +
   * return in the worked case and a full return nets COGS to zero.
   * Eligibility is deliberately narrow: every return line must resolve
   * to one original sale line at that line's frozen cost (a saved cost
   * of zero means a prepared composite whose COGS stays expensed and
   * contributes nothing; a differing nonzero saved cost keeps the
   * pinned plain-product override instead of inventing an anchor).
   * Anything else — no linked sale, an unresolvable line, a differing
   * saved cost — falls back to the legacy plain computation, which
   * keeps every previously pinned behaviour intact.
   */
  async salesReturnCogsResidual(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
    bookDigits: MoneyDigits,
    returnedQtyBySaleItemId: Map<number, number>,
  ): Promise<number> {
    const saleItems = await this.readSaleResidualLines(queryable, tenantId, saleId);
    const groups = await this.residualCogsGroups(queryable, tenantId, saleItems, returnedQtyBySaleItemId);
    return cogsResidualAmount(groups, bookDigits);
  }

  async salesReturnCogsAmount(
    queryable: Transaction<Database>,
    tenantId: string,
    sale: { id: number } | null,
    returnItems: Array<{
      product_id: number | null;
      sale_item_id: number | null;
      qty: number | string;
      cost_price?: number | string | null;
    }>,
    saleItems: Array<{ id: number; product_id: number | null; cost_price: number | string | null }>,
    bookDigits: MoneyDigits,
  ): Promise<number> {
    const legacy = calculateSalesReturnCost(returnItems, saleItems);
    if (!sale) return legacy;
    const saleCostById = new Map(saleItems.map((item) => [Number(item.id), Number(item.cost_price || 0)]));
    const returnedQtyBySaleItemId = new Map<number, number>();
    for (const line of resolveSalesReturnCostLines(returnItems, saleItems)) {
      if (line.saleItemId == null) return legacy;
      const saleCost = saleCostById.get(line.saleItemId);
      if (saleCost == null) return legacy;
      if (line.unitCost === 0) continue;
      if (Math.abs(line.unitCost - saleCost) > 0.0000001) return legacy;
      returnedQtyBySaleItemId.set(line.saleItemId, (returnedQtyBySaleItemId.get(line.saleItemId) || 0) + line.qty);
    }
    if (returnedQtyBySaleItemId.size === 0) return 0;
    return this.salesReturnCogsResidual(queryable, tenantId, Number(sale.id), bookDigits, returnedQtyBySaleItemId);
  }
}
