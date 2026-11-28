import { validateOfflineCreatedAt } from '../../../common/utils/client-date-bounds.util';

export interface OfflineStockShortfallItem {
  productId: number;
  productName: string;
  availableQty: number;
  requiredQty: number;
  deficitQty: number;
}

export interface OfflinePriceDriftItem {
  productId: number;
  productName: string;
  soldUnitPrice: number;
  currentAllowedUnitPrice: number;
}

export interface ResolvedPosOfflineSyncIdentity {
  isOfflineSyncSale: boolean;
  offlineDocNo: string;
  offlineCreatedAt: Date | null;
  posTerminalCode: string | null;
}

/**
 * Resolves and validates the offline-sync identity of a POS sale payload upfront
 * before Phase 1..5 execute so offer windows, stock reconciliation, price-drift
 * auditing, and closed-shift window matching share a single verified timestamp.
 */
export function resolvePosOfflineSyncIdentity(
  payload: {
    offlineDocNo?: unknown;
    offlineCreatedAt?: unknown;
    terminalCode?: unknown;
    source?: unknown;
  },
  now: Date = new Date(),
): ResolvedPosOfflineSyncIdentity {
  const offlineDocNo = String(payload?.offlineDocNo || '').trim();
  const offlineCreatedAt = validateOfflineCreatedAt(payload?.offlineCreatedAt, now);
  const posTerminalCode = String(payload?.terminalCode || '').trim() || null;
  const isOfflineSyncSale = Boolean(offlineDocNo && offlineCreatedAt);

  return {
    isOfflineSyncSale,
    offlineDocNo,
    offlineCreatedAt,
    posTerminalCode,
  };
}

/**
 * Fact-of-Sale Stock Gate for POS Offline Sync:
 * When a sale occurred offline (`isOfflineSyncSale === true`), the customer already paid
 * cash/card and physically left the store with the goods hours ago. Rejecting the sync with
 * `INSUFFICIENT_STOCK` hides collected cash from the drawer and deadlocks shift closing.
 * Instead, an offline synced sale permits negative stock deduction and emits a structured
 * shortfall record for manager inventory reconciliation and `pos_audit_events`.
 */
export function decideOfflineSaleStockGate(params: {
  isOfflineSyncSale: boolean;
  allowNegativeStockSales: boolean;
  hasBom: boolean;
  isService: boolean;
  availableStockQty: number;
  requiredQty: number;
  productId: number;
  productName: string;
}): {
  allowSale: boolean;
  allowNegativeMovement: boolean;
  shortfall: OfflineStockShortfallItem | null;
} {
  const baseAllowsNegative = Boolean(params.allowNegativeStockSales || params.hasBom || params.isService);
  if (baseAllowsNegative || params.availableStockQty >= params.requiredQty) {
    return {
      allowSale: true,
      allowNegativeMovement: baseAllowsNegative,
      shortfall: null,
    };
  }

  if (params.isOfflineSyncSale) {
    const deficitQty = Number((params.requiredQty - params.availableStockQty).toFixed(3));
    return {
      allowSale: true,
      allowNegativeMovement: true,
      shortfall: {
        productId: params.productId,
        productName: params.productName,
        availableQty: params.availableStockQty,
        requiredQty: params.requiredQty,
        deficitQty,
      },
    };
  }

  return {
    allowSale: false,
    allowNegativeMovement: false,
    shortfall: null,
  };
}

/**
 * Evaluates whether a positive unit price sold on an offline POS receipt that drifted
 * from current server truth (e.g. HQ updated retail price during a branch internet outage)
 * should post at the collected receipt price with an explicit manager audit record.
 */
export function decideOfflineSalePriceDrift(params: {
  isOfflineSyncSale: boolean;
  providedUnitPrice: number;
  allowedUnitPrice: number;
  productId: number;
  productName: string;
}): {
  acceptWithAudit: boolean;
  drift: OfflinePriceDriftItem | null;
} {
  const provided = Number(params.providedUnitPrice || 0);
  const allowed = Number(params.allowedUnitPrice || 0);
  if (!params.isOfflineSyncSale || !(provided > 0) || !Number.isFinite(provided)) {
    return { acceptWithAudit: false, drift: null };
  }

  if (Math.abs(provided - allowed) <= 0.0001) {
    return { acceptWithAudit: true, drift: null };
  }

  return {
    acceptWithAudit: true,
    drift: {
      productId: params.productId,
      productName: params.productName,
      soldUnitPrice: provided,
      currentAllowedUnitPrice: allowed,
    },
  };
}

export function formatOfflineReconciliationNoteTags(params: {
  shortfalls: OfflineStockShortfallItem[];
  priceDrifts: OfflinePriceDriftItem[];
}): string[] {
  const tags: string[] = [];
  if (params.shortfalls.length > 0) {
    const summary = params.shortfalls.map((s) => `${s.productName} (عجز ${s.deficitQty})`).join('، ');
    tags.push(`[تسوية مخزون أوفلاين للمراجعة: ${summary}]`);
  }
  if (params.priceDrifts.length > 0) {
    const summary = params.priceDrifts
      .map((d) => `${d.productName} (بيع بـ ${d.soldUnitPrice} مقابل ${d.currentAllowedUnitPrice})`)
      .join('، ');
    tags.push(`[فرق سعر أثناء الأوفلاين: ${summary}]`);
  }
  return tags;
}
