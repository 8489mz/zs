export interface InventoryReportProductRow {
  id?: number | string | null;
  name?: string | null;
  stock_qty?: number | string | null;
  min_stock_qty?: number | string | null;
  retail_price?: number | string | null;
  cost_price?: number | string | null;
  category_name?: string | null;
  supplier_name?: string | null;
}

export interface InventoryLocationBreakdownRow {
  product_id?: number | string | null;
  location_id?: number | string | null;
  branch_id?: number | string | null;
  qty?: number | string | null;
  location_name?: string | null;
  branch_name?: string | null;
}

export interface InventoryLocationHighlightRow {
  product_id?: number | string | null;
  location_id?: number | string | null;
  branch_id?: number | string | null;
  qty?: number | string | null;
  min_stock_qty?: number | string | null;
  location_name?: string | null;
  branch_name?: string | null;
}

export interface InventoryLocationSnapshot {
  locationId: string;
  locationName: string;
  branchId: string;
  branchName: string;
  qty: number;
}

export interface InventoryReportItem {
  id: string;
  name: string;
  stock: number;
  stockQty: number;
  minStock: number;
  retailPrice: number;
  costPrice: number;
  category: string;
  supplier: string;
  status: 'ok' | 'low' | 'out';
  topLocationName: string;
  topLocationQty: number;
  locationsLabel: string;
  assignedQty: number;
  unassignedQty: number;
  stockLocationExcessQty: number;
  locations: InventoryLocationSnapshot[];
}

export interface InventoryLocationHighlight {
  locationId: string;
  locationName: string;
  branchId: string;
  branchName: string;
  totalQty: number;
  trackedProducts: number;
  attentionItems: number;
  lowStockItems: number;
  outOfStockItems: number;
}

function toPositiveNumber(value: number | string | null | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatLocationLabel(item: InventoryLocationSnapshot): string {
  const branchSuffix = item.branchName ? ` (${item.branchName})` : '';
  return `${item.locationName}${branchSuffix}: ${item.qty}`;
}

export function groupInventoryLocationBreakdown(
  rows: InventoryLocationBreakdownRow[],
): Map<string, InventoryLocationSnapshot[]> {
  const breakdownByProduct = new Map<string, InventoryLocationSnapshot[]>();

  for (const row of rows) {
    const productId = String(row.product_id || '');
    if (!productId) continue;

    const qty = toPositiveNumber(row.qty);
    if (qty <= 0) continue;

    const current = breakdownByProduct.get(productId) || [];
    current.push({
      locationId: row.location_id ? String(row.location_id) : '',
      locationName: row.location_name || 'مخزون غير مخصص',
      branchId: row.branch_id ? String(row.branch_id) : '',
      branchName: row.branch_name || '',
      qty,
    });
    breakdownByProduct.set(productId, current);
  }

  return breakdownByProduct;
}

export function buildInventoryReportItems(
  rows: InventoryReportProductRow[],
  locationBreakdownRows: InventoryLocationBreakdownRow[],
): InventoryReportItem[] {
  const breakdownByProduct = groupInventoryLocationBreakdown(locationBreakdownRows);

  return rows.map((row) => {
    const stockQty = toPositiveNumber(row.stock_qty);
    const minStock = toPositiveNumber(row.min_stock_qty);
    const breakdown = [...(breakdownByProduct.get(String(row.id)) || [])].sort(
      (a, b) => b.qty - a.qty || a.locationName.localeCompare(b.locationName, 'ar'),
    );
    const topLocation = breakdown[0] || null;
    const assignedQty = breakdown.reduce((sum, item) => sum + (item.locationId ? item.qty : 0), 0);
    const unassignedQty = Math.max(0, stockQty - assignedQty);
    const stockLocationExcessQty = Math.max(0, Number((assignedQty - stockQty).toFixed(3)));
    // Show the complete reconciliation state, not only the first three
    // positive stock locations. Unassigned inventory is financially material.
    const labels = breakdown.slice(0, 3).map(formatLocationLabel);
    if (unassignedQty > 0.001) labels.push(`مخزون غير مخصص: ${unassignedQty}`);
    if (stockLocationExcessQty > 0.001) {
      labels.push(`فرق مخزون يحتاج مصالحة: المواقع تزيد عن الإجمالي بـ ${stockLocationExcessQty}`);
    }
    const locationsLabel = labels.length ? labels.join(' • ') : '—';

    return {
      id: String(row.id || ''),
      name: row.name || '',
      stock: stockQty,
      stockQty,
      minStock,
      retailPrice: toPositiveNumber(row.retail_price),
      costPrice: toPositiveNumber(row.cost_price),
      category: row.category_name || '',
      supplier: row.supplier_name || '',
      status: stockQty <= 0 ? 'out' : stockQty <= minStock ? 'low' : 'ok',
      topLocationName: topLocation?.locationName || '',
      topLocationQty: topLocation?.qty || 0,
      locationsLabel,
      assignedQty,
      unassignedQty,
      stockLocationExcessQty,
      locations: breakdown,
    };
  });
}

export function buildInventoryLocationHighlights(
  rows: InventoryLocationHighlightRow[],
  limit = 5,
): { trackedLocations: number; highlights: InventoryLocationHighlight[] } {
  const summary = new Map<string, InventoryLocationHighlight>();

  for (const row of rows) {
    if (!row.location_id) continue;

    const key = String(row.location_id);
    const current = summary.get(key) || {
      locationId: key,
      locationName: row.location_name || `الموقع #${row.location_id}`,
      branchId: row.branch_id ? String(row.branch_id) : '',
      branchName: row.branch_name || '',
      totalQty: 0,
      trackedProducts: 0,
      attentionItems: 0,
      lowStockItems: 0,
      outOfStockItems: 0,
    };

    const qty = toPositiveNumber(row.qty);
    const minStock = toPositiveNumber(row.min_stock_qty);

    current.totalQty += qty;
    current.trackedProducts += 1;
    if (qty <= minStock) current.attentionItems += 1;
    if (qty > 0 && qty <= minStock) current.lowStockItems += 1;
    if (qty <= 0) current.outOfStockItems += 1;

    summary.set(key, current);
  }

  const highlights = Array.from(summary.values())
    .sort(
      (left, right) =>
        right.attentionItems - left.attentionItems ||
        right.totalQty - left.totalQty ||
        left.locationName.localeCompare(right.locationName, 'ar'),
    )
    .slice(0, limit);

  return {
    trackedLocations: summary.size,
    highlights,
  };
}

export function buildInventorySummary(
  totalItems: number,
  outOfStock: number,
  lowStock: number,
  totalActive: number,
  trackedLocations: number,
) {
  return {
    totalItems,
    outOfStock,
    lowStock,
    healthy: Math.max(0, totalActive - outOfStock - lowStock),
    trackedLocations,
  };
}
