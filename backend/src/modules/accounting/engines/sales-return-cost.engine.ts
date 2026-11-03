export interface ReturnCostLine {
  product_id: number | null;
  sale_item_id: number | null;
  qty: number | string;
  cost_price?: number | string | null;
}

export interface OriginalSaleCostLine {
  id: number;
  product_id: number | null;
  cost_price: number | string | null;
}

export interface ResolvedSalesReturnCostLine {
  productId: number;
  saleItemId: number | null;
  qty: number;
  /** Effective per-sold-unit cost: the return line's saved cost when present, else the original sale line's frozen cost. */
  unitCost: number;
}

/**
 * Resolve each return line to its original sale line and effective unit
 * cost, with the same provenance and ambiguity rules calculateSalesReturnCost
 * has always enforced. Pure: no I/O, no rounding — callers that need the
 * residual basis (the return COGS mirror) build their groups from these
 * resolved lines instead of re-implementing the matching.
 */
export function resolveSalesReturnCostLines(
  returns: ReturnCostLine[],
  saleItems: OriginalSaleCostLine[],
): ResolvedSalesReturnCostLine[] {
  const byId = new Map(saleItems.map((item) => [Number(item.id), item]));
  const byProduct = new Map<number, OriginalSaleCostLine[]>();
  for (const item of saleItems) {
    const productId = Number(item.product_id);
    if (!byProduct.has(productId)) byProduct.set(productId, []);
    byProduct.get(productId)!.push(item);
  }

  const resolved: ResolvedSalesReturnCostLine[] = [];
  for (const line of returns) {
    const productId = Number(line.product_id);
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(productId) || productId <= 0) {
      throw new Error('Invalid sales return cost line');
    }
    // A saved cost is not proof that the linked sale line belongs to this product.
    // Validate provenance even when the return already carries a unit cost.
    const hasSaleItemLink = line.sale_item_id != null;
    const original = hasSaleItemLink ? byId.get(Number(line.sale_item_id)) : undefined;
    if (hasSaleItemLink && (!original || Number(original.product_id) !== productId)) {
      throw new Error(`Original sale line missing or mismatched for returned product ${productId}`);
    }
    if (line.cost_price != null) {
      const savedCost = Number(line.cost_price);
      if (!Number.isFinite(savedCost) || savedCost < 0) throw new Error(`Invalid saved return cost for product ${productId}`);
      resolved.push({ productId, saleItemId: hasSaleItemLink ? Number(line.sale_item_id) : null, qty, unitCost: savedCost });
      continue;
    }
    const candidates = original ? [original] : (byProduct.get(productId) || []);
    if (!candidates.length || (original && Number(original.product_id) !== productId)) {
      throw new Error(`Original sale line missing for returned product ${productId}`);
    }
    const costs = candidates.map((candidate) => Number(candidate.cost_price));
    if (candidates.some((candidate) => candidate.cost_price === null) ||
      costs.some((cost) => !Number.isFinite(cost) || cost < 0) || new Set(costs).size !== 1) {
      throw new Error(`Ambiguous original cost for returned product ${productId}; sale item id is required`);
    }
    resolved.push({
      productId,
      saleItemId: hasSaleItemLink ? Number(line.sale_item_id) : (candidates.length === 1 ? Number(candidates[0].id) : null),
      qty,
      unitCost: costs[0],
    });
  }
  return resolved;
}

/** Match each return to its original sale line; never guess when legacy lines are ambiguous. */
export function calculateSalesReturnCost(returns: ReturnCostLine[], saleItems: OriginalSaleCostLine[]): number {
  return resolveSalesReturnCostLines(returns, saleItems)
    .reduce((total, line) => total + line.qty * line.unitCost, 0);
}
