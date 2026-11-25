export interface InvoiceReturnQuantityRow {
  product_id?: number | string | null;
  sale_item_id?: number | string | null;
  purchase_item_id?: number | string | null;
  returned_qty?: number | string | null;
}
/**
 * The UI must receive all original invoice line IDs independently. Legacy
 * unlinked returns block the product until a human reconciles its provenance.
 */
export function buildInvoiceReturnedQuantities(
  type: 'sale' | 'purchase',
  rows: InvoiceReturnQuantityRow[],
): { returnedQtyByLine: Record<string, number>; blockedProductIds: string[] } {
  const returnedQtyByLine: Record<string, number> = {};
  const blocked = new Set<string>();
  for (const row of rows) {
    const qty = Number(row.returned_qty || 0);
    if (!Number.isFinite(qty) || qty < 0) {
      if (row.product_id != null) blocked.add(String(row.product_id));
      continue;
    }
    const originalId = type === 'sale' ? row.sale_item_id : row.purchase_item_id;
    if (originalId == null) {
      if (qty > 0 && row.product_id != null) blocked.add(String(row.product_id));
      continue;
    }
    const key = String(originalId);
    returnedQtyByLine[key] = Number((Number(returnedQtyByLine[key] || 0) + qty).toFixed(3));
  }
  return { returnedQtyByLine, blockedProductIds: [...blocked] };
}
