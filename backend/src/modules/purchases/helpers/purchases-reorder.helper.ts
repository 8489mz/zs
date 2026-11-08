import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export interface ReorderProductInput {
  id: number;
  name: string;
  barcode?: string | null;
  stock_qty?: number | string | null;
  min_stock_qty?: number | string | null;
  cost_price?: number | string | null;
  retail_price?: number | string | null;
  supplier_id?: number | string | null;
  category_id?: number | string | null;
  category_name?: string | null;
  default_location_id?: number | string | null;
}

export interface ReorderSupplierInput {
  id: number;
  name: string;
  phone?: string | null;
  leadTimeDays?: number | null;
}

export interface ReorderItemSuggestion {
  productId: number;
  name: string;
  barcode: string;
  categoryName: string;
  currentStock: number;
  minStock: number;
  costPrice: number;
  retailPrice: number;
  qtySoldPeriod: number;
  dailyRunRate: number;
  daysRemaining: number;
  leadTimeDays: number;
  leadTimeDemand: number;
  safetyStock: number;
  reorderPoint: number;
  urgency: 'out_of_stock' | 'critical' | 'warning' | 'healthy' | 'overstocked';
  needsReorder: boolean;
  suggestedQty: number;
  estimatedTotalCost: number;
  supplierId: number | null;
  supplierName: string;
  supplierPhone: string;
  defaultLocationId: number | null;
}

export interface SupplierReorderGroup {
  supplierId: number | null;
  supplierName: string;
  supplierPhone: string;
  leadTimeDays: number;
  itemsCount: number;
  criticalCount: number;
  totalSuggestedQty: number;
  totalEstimatedCost: number;
  items: ReorderItemSuggestion[];
}

export interface ReorderAnalysisSummary {
  totalMonitoredProducts: number;
  needsReorderCount: number;
  outOfStockCount: number;
  criticalCount: number;
  warningCount: number;
  healthyCount: number;
  overstockedCount: number;
  totalEstimatedProcurementCost: number;
  suppliersCount: number;
  daysAnalysis: number;
  targetCoverageDays: number;
}

export interface ReorderAnalysisResult {
  summary: ReorderAnalysisSummary;
  supplierGroups: SupplierReorderGroup[];
  allSuggestions: ReorderItemSuggestion[];
}

export interface BuildReorderOptions {
  daysAnalysis?: number; // e.g. 30
  targetCoverageDays?: number; // e.g. 30
  defaultLeadTimeDays?: number; // e.g. 3
  onlyNeedsReorder?: boolean;
  urgencyFilter?: 'all' | 'needs_reorder' | 'out_of_stock' | 'critical' | 'warning';
  // Book digits of the tenant's base currency. Money outputs
  // (cost/retail price, estimated totals) round at these digits;
  // quantities and run rates stay at 2dp. Defaults to 2.
  moneyDigits?: MoneyDigits;
}

function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundTo(num: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round((num + Number.EPSILON) * factor) / factor;
}

export function calculateReorderItemSuggestion(
  product: ReorderProductInput,
  qtySold: number,
  supplier: ReorderSupplierInput | undefined,
  options: BuildReorderOptions = {},
): ReorderItemSuggestion {
  const daysAnalysis = Math.max(1, options.daysAnalysis || 30);
  const targetCoverageDays = Math.max(1, options.targetCoverageDays || 30);
  const defaultLeadTimeDays = Math.max(1, options.defaultLeadTimeDays || 3);
  const moneyDigits: MoneyDigits = options.moneyDigits ?? 2;

  const currentStock = toNumber(product.stock_qty, 0);
  const minStock = toNumber(product.min_stock_qty, 0);
  const costPrice = toNumber(product.cost_price, 0);
  const retailPrice = toNumber(product.retail_price, 0);
  const soldPeriod = Math.max(0, toNumber(qtySold, 0));

  const dailyRunRate = roundTo(soldPeriod / daysAnalysis, 2);
  const leadTimeDays = supplier?.leadTimeDays ? Math.max(1, supplier.leadTimeDays) : defaultLeadTimeDays;
  const leadTimeDemand = roundTo(dailyRunRate * leadTimeDays, 2);
  const safetyStock = minStock > 0 ? minStock : Math.ceil(dailyRunRate * 3);
  const reorderPoint = Math.ceil(leadTimeDemand + safetyStock);

  let daysRemaining = 999;
  if (currentStock <= 0) {
    daysRemaining = 0;
  } else if (dailyRunRate > 0) {
    daysRemaining = Math.max(0, Math.floor(currentStock / dailyRunRate));
  }

  let urgency: 'out_of_stock' | 'critical' | 'warning' | 'healthy' | 'overstocked' = 'healthy';
  if (currentStock <= 0) {
    urgency = 'out_of_stock';
  } else if (daysRemaining <= leadTimeDays || currentStock <= minStock) {
    urgency = 'critical';
  } else if (daysRemaining <= (leadTimeDays + 7) || currentStock <= reorderPoint) {
    urgency = 'warning';
  } else if (daysRemaining > 60 && currentStock > 50) {
    urgency = 'overstocked';
  }

  const needsReorder = urgency === 'out_of_stock' || urgency === 'critical' || urgency === 'warning' || currentStock <= reorderPoint;

  let suggestedQty = 0;
  if (dailyRunRate > 0) {
    const targetBuffer = (dailyRunRate * targetCoverageDays) + safetyStock;
    suggestedQty = Math.max(0, Math.ceil(targetBuffer - currentStock));
  } else if (currentStock < minStock) {
    suggestedQty = Math.max(0, Math.ceil(minStock - currentStock));
  }

  if (needsReorder && suggestedQty === 0) {
    suggestedQty = 1;
  }

  const estimatedTotalCost = roundMoney(suggestedQty * costPrice, moneyDigits);

  return {
    productId: Number(product.id),
    name: product.name || `صنف #${product.id}`,
    barcode: product.barcode || '',
    categoryName: product.category_name || '',
    currentStock: roundTo(currentStock, 2),
    minStock: roundTo(minStock, 2),
    costPrice: roundMoney(costPrice, moneyDigits),
    retailPrice: roundMoney(retailPrice, moneyDigits),
    qtySoldPeriod: roundTo(soldPeriod, 2),
    dailyRunRate,
    daysRemaining: Math.min(365, daysRemaining),
    leadTimeDays,
    leadTimeDemand,
    safetyStock,
    reorderPoint,
    urgency,
    needsReorder,
    suggestedQty,
    estimatedTotalCost,
    supplierId: supplier ? Number(supplier.id) : (product.supplier_id ? Number(product.supplier_id) : null),
    supplierName: supplier?.name || 'مورد غير محدد',
    supplierPhone: supplier?.phone || '',
    defaultLocationId: product.default_location_id ? Number(product.default_location_id) : null,
  };
}

export function buildReorderAnalysis(
  products: ReorderProductInput[],
  salesMap: Map<number, number>,
  suppliersMap: Map<number, ReorderSupplierInput>,
  options: BuildReorderOptions = {},
): ReorderAnalysisResult {
  const daysAnalysis = Math.max(1, options.daysAnalysis || 30);
  const targetCoverageDays = Math.max(1, options.targetCoverageDays || 30);
  const moneyDigits: MoneyDigits = options.moneyDigits ?? 2;

  const allSuggestions: ReorderItemSuggestion[] = [];

  for (const product of products) {
    const pId = Number(product.id);
    const sold = salesMap.get(pId) || 0;
    const sId = product.supplier_id ? Number(product.supplier_id) : undefined;
    const supplier = sId ? suppliersMap.get(sId) : undefined;

    const item = calculateReorderItemSuggestion(product, sold, supplier, options);
    allSuggestions.push(item);
  }

  // Calculate high-level summary metrics over all active products
  let outOfStockCount = 0;
  let criticalCount = 0;
  let warningCount = 0;
  let healthyCount = 0;
  let overstockedCount = 0;
  let needsReorderCount = 0;

  for (const item of allSuggestions) {
    if (item.urgency === 'out_of_stock') outOfStockCount++;
    else if (item.urgency === 'critical') criticalCount++;
    else if (item.urgency === 'warning') warningCount++;
    else if (item.urgency === 'healthy') healthyCount++;
    else if (item.urgency === 'overstocked') overstockedCount++;

    if (item.needsReorder) needsReorderCount++;
  }

  // Filter items based on user criteria
  let filteredItems = allSuggestions;
  const urgencyFilter = options.urgencyFilter || (options.onlyNeedsReorder ? 'needs_reorder' : 'all');

  if (urgencyFilter === 'needs_reorder') {
    filteredItems = allSuggestions.filter((i) => i.needsReorder);
  } else if (urgencyFilter === 'out_of_stock') {
    filteredItems = allSuggestions.filter((i) => i.urgency === 'out_of_stock');
  } else if (urgencyFilter === 'critical') {
    filteredItems = allSuggestions.filter((i) => i.urgency === 'critical');
  } else if (urgencyFilter === 'warning') {
    filteredItems = allSuggestions.filter((i) => i.urgency === 'warning');
  }

  // Sort by urgency priority (out_of_stock > critical > warning > healthy > overstocked), then lowest daysRemaining
  const urgencyPriority = { out_of_stock: 0, critical: 1, warning: 2, healthy: 3, overstocked: 4 };
  filteredItems.sort((a, b) => {
    const pA = urgencyPriority[a.urgency];
    const pB = urgencyPriority[b.urgency];
    if (pA !== pB) return pA - pB;
    return a.daysRemaining - b.daysRemaining;
  });

  // Group by Supplier
  const groupsMap = new Map<number | null, SupplierReorderGroup>();

  for (const item of filteredItems) {
    const sId = item.supplierId;
    let group = groupsMap.get(sId);
    if (!group) {
      group = {
        supplierId: sId,
        supplierName: item.supplierName,
        supplierPhone: item.supplierPhone,
        leadTimeDays: item.leadTimeDays,
        itemsCount: 0,
        criticalCount: 0,
        totalSuggestedQty: 0,
        totalEstimatedCost: 0,
        items: [],
      };
      groupsMap.set(sId, group);
    }
    group.items.push(item);
    group.itemsCount += 1;
    if (item.urgency === 'out_of_stock' || item.urgency === 'critical') {
      group.criticalCount += 1;
    }
    group.totalSuggestedQty += item.suggestedQty;
    group.totalEstimatedCost = roundMoney(group.totalEstimatedCost + item.estimatedTotalCost, moneyDigits);
  }

  // Sort groups: suppliers with critical items first, then by highest total estimated cost
  const supplierGroups = Array.from(groupsMap.values()).sort((a, b) => {
    if (b.criticalCount !== a.criticalCount) {
      return b.criticalCount - a.criticalCount;
    }
    return b.totalEstimatedCost - a.totalEstimatedCost;
  });

  let totalEstimatedProcurementCost = 0;
  for (const g of supplierGroups) {
    totalEstimatedProcurementCost = roundMoney(totalEstimatedProcurementCost + g.totalEstimatedCost, moneyDigits);
  }

  return {
    summary: {
      totalMonitoredProducts: products.length,
      needsReorderCount,
      outOfStockCount,
      criticalCount,
      warningCount,
      healthyCount,
      overstockedCount,
      totalEstimatedProcurementCost,
      suppliersCount: supplierGroups.length,
      daysAnalysis,
      targetCoverageDays,
    },
    supplierGroups,
    allSuggestions: filteredItems,
  };
}
