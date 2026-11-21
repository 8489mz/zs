// ============================================================================
// REQUISITION MULTI-WAREHOUSE SPLIT ENGINE (محرك فرز وتوزيع أذونات التحميل)
// ============================================================================

export interface RequisitionItemInput {
  productId: number;
  qty: number;
  sourceWarehouseId?: number;
  sourceWarehouseName?: string;
}

export interface RequisitionSplitGroup {
  warehouseId: number;
  warehouseName?: string;
  items: RequisitionItemInput[];
  totalQty: number;
}

/**
 * Pure engine to split load requisition items across their respective source warehouses.
 * When a delivery rep requests items located across different physical warehouses,
 * this engine automatically clusters them by warehouse so separate requisition vouchers can be issued.
 */
export function splitRequisitionByWarehouse(
  items: RequisitionItemInput[],
  defaultWarehouseId = 1,
): RequisitionSplitGroup[] {
  const groups = new Map<number, { name?: string; items: RequisitionItemInput[] }>();

  for (const item of items || []) {
    const qty = Number(item.qty || 0);
    if (qty <= 0) continue;
    const whId = item.sourceWarehouseId && Number(item.sourceWarehouseId) > 0
      ? Number(item.sourceWarehouseId)
      : defaultWarehouseId;

    const group = groups.get(whId) || { name: item.sourceWarehouseName, items: [] };
    group.items.push({ ...item, sourceWarehouseId: whId });
    if (!group.name && item.sourceWarehouseName) group.name = item.sourceWarehouseName;
    groups.set(whId, group);
  }

  const result: RequisitionSplitGroup[] = [];
  for (const [warehouseId, group] of groups.entries()) {
    const totalQty = group.items.reduce((sum, it) => sum + Number(it.qty || 0), 0);
    result.push({
      warehouseId,
      warehouseName: group.name,
      items: group.items,
      totalQty: Number(totalQty.toFixed(3)),
    });
  }

  return result.sort((a, b) => a.warehouseId - b.warehouseId);
}
