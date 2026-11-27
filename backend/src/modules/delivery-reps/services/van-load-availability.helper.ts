/*
 * F10 load-availability helpers (INV-VAN-LOAD-AVAILABLE-QTY): pure
 * row-grouping for the one canonical available quantity. This file
 * holds NO stock arithmetic — the available definition lives exactly
 * once in computeLocationAvailability / computeVanLoadAvailableQty
 * (location-stock-ledger.ts). What lives here is only the grouping
 * of raw balance rows and pending-permit rows into the shapes those
 * functions consume, shared by the load form
 * (van-requisitions.service.ts) and the trip-open pre-check
 * (trip-open-load.service.ts) so the two can never drift apart.
 */

/** A pending load permit that will draw stock from a warehouse. */
export interface VanLoadPendingHold {
  docNo: string;
  repId: number;
  repName: string;
  qty: number;
  sourceWarehouseId: number;
}

export function parseRequisitionItems(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export type ProductBalanceSummary = {
  byWarehouse: Map<number, { qty: number; reservedQty: number }>;
  unassignedQty: number;
  unassignedReserved: number;
  locatedSum: number;
};

/**
 * Groups raw product_location_stock rows per product: per-warehouse
 * on-hand/reserved, the unassigned leg (location and branch both
 * null), and the located sum the ledger's discrepancy rule needs.
 */
export function summarizeProductBalances(balances: any[]): Map<number, ProductBalanceSummary> {
  const byProduct = new Map<number, ProductBalanceSummary>();
  for (const b of balances || []) {
    const pid = Number(b.product_id);
    let entry = byProduct.get(pid);
    if (!entry) {
      entry = { byWarehouse: new Map(), unassignedQty: 0, unassignedReserved: 0, locatedSum: 0 };
      byProduct.set(pid, entry);
    }
    const qty = Number(b.qty || 0);
    const reserved = Number(b.reserved_qty || 0);
    entry.locatedSum += qty;
    if (b.location_id == null && b.branch_id == null) {
      entry.unassignedQty += qty;
      entry.unassignedReserved += reserved;
    } else if (b.location_id != null) {
      const whId = Number(b.location_id);
      const prev = entry.byWarehouse.get(whId) || { qty: 0, reservedQty: 0 };
      entry.byWarehouse.set(whId, { qty: prev.qty + qty, reservedQty: prev.reservedQty + reserved });
    }
  }
  return byProduct;
}

/**
 * Groups pending load-permit rows per product. A pending permit
 * reserves NOTHING in the ledger (submit writes no reservation) —
 * the hold is informational only, so the rep/admin sees which permit
 * will draw from this stock when it is dispatched. The available
 * number never nets holds off.
 */
export function groupPendingHoldsByProduct(rows: any[]): Map<number, VanLoadPendingHold[]> {
  const holdsByProduct = new Map<number, VanLoadPendingHold[]>();
  for (const row of rows || []) {
    const requested = parseRequisitionItems(row.requestedItems);
    const useItems = requested.length > 0 ? requested : parseRequisitionItems(row.approvedItems);
    const byProduct = new Map<number, number>();
    for (const it of useItems || []) {
      const pid = Number(it.productId);
      if (!pid || Number(it.qty || 0) <= 0) continue;
      byProduct.set(pid, (byProduct.get(pid) || 0) + Number(it.qty || 0));
    }
    for (const [pid, qty] of byProduct) {
      const list = holdsByProduct.get(pid) || [];
      list.push({
        docNo: String(row.docNo),
        repId: Number(row.repId),
        repName: String(row.repName || ''),
        qty,
        sourceWarehouseId: Number(row.sourceWarehouseId || 0),
      });
      holdsByProduct.set(pid, list);
    }
  }
  return holdsByProduct;
}

/**
 * The qty one pending permit holds for a product at one warehouse
 * (requested items win over approved items; an item counts only when
 * its own source warehouse — or the permit's — is that warehouse).
 */
export function pendingHoldQtyFor(items: any[], productId: number, warehouseId: number): number {
  let qty = 0;
  for (const it of items || []) {
    if (Number(it.productId) !== Number(productId)) continue;
    const itemWh = Number(it.sourceWarehouseId || warehouseId);
    if (itemWh !== Number(warehouseId)) continue;
    qty += Number(it.qty || 0);
  }
  return qty;
}
