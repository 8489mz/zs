import { Kysely } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { ReportRangeQueryDto } from '../dto/report-query.dto';
import { parseRange } from './reports-range.helper';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export async function buildFoodCostVarianceReport(
  db: Kysely<Database>,
  query: ReportRangeQueryDto,
  auth: AuthContext,
): Promise<Record<string, unknown>> {
  const scope = requireTenantScope(auth);
  const digits = currencyMoneyDigits(await tenantBaseCurrency(db, scope.tenantId));
  const range = parseRange(query);
  const fromDate = new Date(range.from);
  const toDate = new Date(range.to);

  // 1. Fetch sales items during the range
  const saleItems = await db
    .selectFrom('sale_items as si')
    .innerJoin('sales as s', (j) =>
      j.onRef('s.id', '=', 'si.sale_id').onRef('s.tenant_id', '=', 'si.tenant_id')
    )
    .select([
      'si.product_id',
      'si.qty',
      'si.modifiers',
    ])
    .where('si.tenant_id', '=', scope.tenantId)
    .where('s.status', '=', 'posted')
    .where('s.created_at', '>=', fromDate)
    .where('s.created_at', '<=', toDate)
    .execute();

  // 2. Fetch BOM recipes for sold products
  const bomLines = await db
    .selectFrom('manufacturing_boms as b')
    .innerJoin('manufacturing_bom_lines as bl', 'bl.bom_id', 'b.id')
    .select([
      'b.product_id as finished_product_id',
      'bl.component_product_id',
      'bl.quantity as component_qty',
      'bl.unit_name',
    ])
    .where('b.tenant_id', '=', scope.tenantId)
    .where('b.is_active', '=', true)
    .execute();

  const bomByProduct = new Map<number, Array<{ componentProductId: number; qty: number; unitName: string }>>();
  for (const bl of bomLines) {
    const fId = Number(bl.finished_product_id);
    if (!bomByProduct.has(fId)) bomByProduct.set(fId, []);
    bomByProduct.get(fId)!.push({
      componentProductId: Number(bl.component_product_id),
      qty: Number(bl.component_qty || 0),
      unitName: bl.unit_name || 'وحدة',
    });
  }

  // 3. Modifier options lookup
  const modifierOptions = await db
    .selectFrom('pos_modifier_options')
    .select(['name', 'component_product_id', 'consumption_qty', 'unit_name'])
    .where('tenant_id', '=', scope.tenantId)
    .where('component_product_id', 'is not', null)
    .execute();

  const modOptionMap = new Map<string, { componentProductId: number; consumptionQty: number; unitName: string }>();
  for (const mo of modifierOptions) {
    if (mo.component_product_id) {
      modOptionMap.set(mo.name.trim().toLowerCase(), {
        componentProductId: Number(mo.component_product_id),
        consumptionQty: Number(mo.consumption_qty || 1),
        unitName: mo.unit_name || 'وحدة',
      });
    }
  }

  // 4. Calculate theoretical consumption per component
  const theoreticalMap = new Map<number, number>();

  for (const item of saleItems) {
    const pId = Number(item.product_id);
    const soldQty = Number(item.qty || 0);

    const components = bomByProduct.get(pId);
    if (components && components.length > 0) {
      for (const comp of components) {
        const prev = theoreticalMap.get(comp.componentProductId) || 0;
        theoreticalMap.set(comp.componentProductId, prev + (soldQty * comp.qty));
      }
    } else {
      const prev = theoreticalMap.get(pId) || 0;
      theoreticalMap.set(pId, prev + soldQty);
    }

    let mods: any[] = [];
    if (typeof item.modifiers === 'string') {
      try { mods = JSON.parse(item.modifiers); } catch { mods = []; }
    } else if (Array.isArray(item.modifiers)) {
      mods = item.modifiers;
    }

    for (const m of mods) {
      const modName = String(m.name || '').trim().toLowerCase();
      const modQty = Number(m.qty || 1) * soldQty;
      const matched = modOptionMap.get(modName);
      if (matched) {
        const prev = theoreticalMap.get(matched.componentProductId) || 0;
        theoreticalMap.set(matched.componentProductId, prev + (modQty * matched.consumptionQty));
      }
    }
  }

  // 5. Fetch logged food waste during the range
  const wasteLogs = await db
    .selectFrom('restaurant_food_waste_logs')
    .select(['product_id', 'quantity', 'total_cost'])
    .where('tenant_id', '=', scope.tenantId)
    .where('created_at', '>=', fromDate)
    .where('created_at', '<=', toDate)
    .execute();

  const wasteMap = new Map<number, { qty: number; cost: number }>();
  for (const w of wasteLogs) {
    const pId = Number(w.product_id);
    const prev = wasteMap.get(pId) || { qty: 0, cost: 0 };
    wasteMap.set(pId, {
      qty: prev.qty + Number(w.quantity || 0),
      cost: prev.cost + Number(w.total_cost || 0),
    });
  }

  // 6. Fetch stock deductions during the range
  const stockOut = await db
    .selectFrom('stock_movements')
    .select(['product_id', 'qty', 'movement_type'])
    .where('tenant_id', '=', scope.tenantId)
    .where('created_at', '>=', fromDate)
    .where('created_at', '<=', toDate)
    .execute();

  const actualStockMap = new Map<number, number>();
  for (const sm of stockOut) {
    if (sm.product_id) {
      const pId = Number(sm.product_id);
      const qtyVal = Math.abs(Number(sm.qty || 0));
      actualStockMap.set(pId, (actualStockMap.get(pId) || 0) + qtyVal);
    }
  }

  // 7. Get products info for all involved products
  const allProductIds = Array.from(new Set([
    ...Array.from(theoreticalMap.keys()),
    ...Array.from(wasteMap.keys()),
    ...Array.from(actualStockMap.keys()),
  ]));

  if (allProductIds.length === 0) {
    return {
      range,
      summary: {
        totalTheoreticalCost: 0,
        totalActualCost: 0,
        totalWasteCost: 0,
        totalVarianceCost: 0,
        overallVariancePct: 0,
      },
      items: [],
    };
  }

  const products = await db
    .selectFrom('products')
    .select(['id', 'name', 'barcode', 'style_code', 'cost_price', 'retail_price'])
    .where('tenant_id', '=', scope.tenantId)
    .where('id', 'in', allProductIds)
    .execute();

  const productMap = new Map<number, any>();
  for (const p of products) {
    productMap.set(Number(p.id), p);
  }

  let sumTheoreticalCost = 0;
  let sumActualCost = 0;
  let sumWasteCost = 0;
  let sumVarianceCost = 0;

  const rows = allProductIds.map((pId) => {
    const prod = productMap.get(pId);
    const costPrice = Number(prod?.cost_price || 0);
    const theoreticalQty = Number((theoreticalMap.get(pId) || 0).toFixed(3));
    const theoreticalCost = roundMoney(theoreticalQty * costPrice, digits);

    const waste = wasteMap.get(pId) || { qty: 0, cost: 0 };
    const wasteQty = Number(waste.qty.toFixed(3));
    const wasteCost = roundMoney(waste.cost, digits);

    const recordedActual = actualStockMap.get(pId);
    const actualQty = recordedActual !== undefined
      ? Number(recordedActual.toFixed(3))
      : Number((theoreticalQty + wasteQty).toFixed(3));
    const actualCost = roundMoney(actualQty * costPrice, digits);

    const varianceQty = Number((actualQty - (theoreticalQty + wasteQty)).toFixed(3));
    const varianceCost = roundMoney(varianceQty * costPrice, digits);
    const variancePct = theoreticalQty > 0
      ? Number(((varianceQty / theoreticalQty) * 100).toFixed(1))
      : (varianceQty > 0 ? 100 : 0);

    sumTheoreticalCost += theoreticalCost;
    sumActualCost += actualCost;
    sumWasteCost += wasteCost;
    sumVarianceCost += varianceCost;

    let status: 'normal' | 'warning' | 'critical' = 'normal';
    if (Math.abs(variancePct) > 5 || Math.abs(varianceCost) > 100) {
      status = 'critical';
    } else if (Math.abs(variancePct) > 2) {
      status = 'warning';
    }

    return {
      productId: pId,
      productName: prod?.name || `صنف #${pId}`,
      sku: prod?.barcode || prod?.style_code || '',
      unitName: 'وحدة',
      costPrice,
      theoreticalQty,
      theoreticalCost,
      wasteQty,
      wasteCost,
      actualQty,
      actualCost,
      varianceQty,
      varianceCost,
      variancePct,
      status,
    };
  });

  rows.sort((a, b) => Math.abs(b.varianceCost) - Math.abs(a.varianceCost));

  const overallVariancePct = sumTheoreticalCost > 0
    ? Number(((sumVarianceCost / sumTheoreticalCost) * 100).toFixed(1))
    : 0;

  return {
    range,
    summary: {
      totalTheoreticalCost: roundMoney(sumTheoreticalCost, digits),
      totalActualCost: roundMoney(sumActualCost, digits),
      totalWasteCost: roundMoney(sumWasteCost, digits),
      totalVarianceCost: roundMoney(sumVarianceCost, digits),
      overallVariancePct,
    },
    items: rows,
  };
}
