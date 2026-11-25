/**
 * Pure Calculation Engine: Automated Reordering Rules (محرك قواعد إعادة الطلب التلقائي)
 *
 * Implements Odoo 17/18-standard Min-Max Inventory Reordering & Virtual Stock Forecasting.
 * Pure mathematical functions with ZERO external dependencies, imported identically by production and test suites.
 */

export interface StockForecastInput {
  onHandQty: number;
  incomingQty?: number; // Stock already ordered in confirmed/draft POs not yet received
  outgoingQty?: number; // Stock reserved or committed in pending customer orders
}

export interface StockForecastResult {
  forecastedQty: number;
  onHandQty: number;
  incomingQty: number;
  outgoingQty: number;
}

export interface ReorderingRuleEvaluationInput {
  ruleId?: number;
  productId: number;
  minQty: number;
  maxQty: number;
  qtyMultiple?: number;
  onHandQty: number;
  incomingQty?: number;
  outgoingQty?: number;
}

export interface ReorderingDecision {
  isBreached: boolean;
  forecastedQty: number;
  shortageQty: number;
  suggestedOrderQty: number;
  reason: 'FORECASTED_BELOW_MIN' | 'STOCK_SUFFICIENT' | 'INVALID_RULE_CONFIG';
}

export interface BreachedReorderItem {
  ruleId: number;
  productId: number;
  productName: string;
  unitCost: number;
  supplierId?: number | null;
  supplierName?: string | null;
  supplierPhone?: string | null;
  warehouseId?: number | null;
  warehouseName?: string | null;
  branchId?: number | null;
  onHandQty: number;
  incomingQty: number;
  forecastedQty: number;
  minQty: number;
  maxQty: number;
  qtyMultiple: number;
  suggestedOrderQty: number;
  estimatedCost: number;
}

export interface SupplierPurchaseOrderPlan {
  supplierId: number | null;
  supplierName: string;
  supplierPhone?: string | null;
  warehouseId: number | null;
  warehouseName: string;
  items: Array<{
    ruleId: number;
    productId: number;
    productName: string;
    quantity: number;
    unitCost: number;
    total: number;
  }>;
  totalQuantity: number;
  subtotal: number;
  totalAmount: number;
}

/**
 * Calculates forecasted (virtual) stock: On-Hand + Incoming (in POs) - Outgoing (in SOs/reservations).
 */
export function calculateForecastedStock(input: StockForecastInput): StockForecastResult {
  const onHand = Number(input.onHandQty || 0);
  const incoming = Number(input.incomingQty || 0);
  const outgoing = Number(input.outgoingQty || 0);

  const forecasted = Number((onHand + incoming - outgoing).toFixed(3));

  return {
    forecastedQty: forecasted,
    onHandQty: onHand,
    incomingQty: incoming,
    outgoingQty: outgoing,
  };
}

/**
 * Evaluates whether a product stock breaches its reorder threshold (Min Qty)
 * and determines the exact quantity to order to reach the target level (Max Qty),
 * taking batch/package multiples into account.
 */
export function evaluateReorderingRule(input: ReorderingRuleEvaluationInput): ReorderingDecision {
  const minQty = Number(input.minQty || 0);
  const maxQty = Number(input.maxQty || 0);
  const qtyMultiple = Number(input.qtyMultiple || 1);

  if (minQty < 0 || maxQty < minQty) {
    return {
      isBreached: false,
      forecastedQty: 0,
      shortageQty: 0,
      suggestedOrderQty: 0,
      reason: 'INVALID_RULE_CONFIG',
    };
  }

  const forecast = calculateForecastedStock({
    onHandQty: input.onHandQty,
    incomingQty: input.incomingQty,
    outgoingQty: input.outgoingQty,
  });

  const forecastedStock = forecast.forecastedQty;

  // Breach triggers when forecasted virtual stock drops below the safety minimum
  if (forecastedStock < minQty) {
    const rawShortage = Number((maxQty - forecastedStock).toFixed(3));
    if (rawShortage <= 0) {
      return {
        isBreached: false,
        forecastedQty: forecastedStock,
        shortageQty: 0,
        suggestedOrderQty: 0,
        reason: 'STOCK_SUFFICIENT',
      };
    }

    // Apply batch / packaging multiple (e.g. packs of 6, cartons of 24)
    const multiple = qtyMultiple > 0 ? qtyMultiple : 1;
    let suggestedOrderQty = rawShortage;

    if (multiple > 1) {
      const unitsPerMultiple = Math.ceil(rawShortage / multiple);
      suggestedOrderQty = Number((unitsPerMultiple * multiple).toFixed(3));
    } else {
      suggestedOrderQty = Number(rawShortage.toFixed(3));
    }

    return {
      isBreached: true,
      forecastedQty: forecastedStock,
      shortageQty: rawShortage,
      suggestedOrderQty,
      reason: 'FORECASTED_BELOW_MIN',
    };
  }

  return {
    isBreached: false,
    forecastedQty: forecastedStock,
    shortageQty: 0,
    suggestedOrderQty: 0,
    reason: 'STOCK_SUFFICIENT',
  };
}

/**
 * Groups multiple breached reorder items by preferred supplier and warehouse
 * into consolidated Purchase Order plans to avoid order fragmentation.
 */
export function groupReorderItemsBySupplier(items: BreachedReorderItem[]): SupplierPurchaseOrderPlan[] {
  const groupMap = new Map<string, SupplierPurchaseOrderPlan>();

  for (const item of items) {
    const supplierKey = item.supplierId ? String(item.supplierId) : 'unassigned';
    const warehouseKey = item.warehouseId ? String(item.warehouseId) : 'default';
    const compositeKey = `${supplierKey}__${warehouseKey}`;

    let plan = groupMap.get(compositeKey);
    if (!plan) {
      plan = {
        supplierId: item.supplierId ?? null,
        supplierName: item.supplierName || (item.supplierId ? `مورد #${item.supplierId}` : 'مورد غير محدد'),
        supplierPhone: item.supplierPhone ?? null,
        warehouseId: item.warehouseId ?? null,
        warehouseName: item.warehouseName || (item.warehouseId ? `مخزن #${item.warehouseId}` : 'المخزن الرئيسي'),
        items: [],
        totalQuantity: 0,
        subtotal: 0,
        totalAmount: 0,
      };
      groupMap.set(compositeKey, plan);
    }

    const itemTotal = Number((item.suggestedOrderQty * Number(item.unitCost || 0)).toFixed(3));

    plan.items.push({
      ruleId: item.ruleId,
      productId: item.productId,
      productName: item.productName,
      quantity: item.suggestedOrderQty,
      unitCost: Number(item.unitCost || 0),
      total: itemTotal,
    });

    plan.totalQuantity = Number((plan.totalQuantity + item.suggestedOrderQty).toFixed(3));
    plan.subtotal = Number((plan.subtotal + itemTotal).toFixed(3));
    plan.totalAmount = plan.subtotal;
  }

  return Array.from(groupMap.values());
}
