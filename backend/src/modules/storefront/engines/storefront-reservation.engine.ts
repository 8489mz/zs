/**
 * Pure decision engine for online order stock reservation timeouts and expiration.
 *
 * Prevents Denial-of-Inventory attacks and lingering reservations when customers
 * abandon online checkouts or payment sessions.
 *
 * Kept pure (no db, no I/O) so the critical test imports the same logic the
 * service runs.
 */

export const DEFAULT_ONLINE_PAYMENT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_COD_STALE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface OrderReservationCandidate {
  id?: number | string;
  stock_reserved?: boolean | null;
  status?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  stock_reserved_at?: Date | string | null;
  created_at?: Date | string | null;
  sale_id?: number | null;
}

export interface ReservationExpirationOptions {
  onlineTimeoutMs?: number;
  codTimeoutMs?: number;
}

/**
 * Checks whether an online order has exceeded its allowed unpaid window.
 *
 * D-SF-12 / INV-SF-REAPER-UNRESERVED-EXPIRY: expiry is by the order clock,
 * not by whether stock was reserved. Placement stores stock_reserved = false
 * (with stock_reserved_at NULL) whenever the storefront setting "allow
 * ordering without stock" is ON, so requiring a reservation made every
 * such order invisible to the reaper and abandoned unpaid orders sat
 * pending forever. An unreserved order therefore expires by the same
 * thresholds (online 30 min, COD 24 h) from created_at — the engine's
 * stock_reserved_at || created_at fallback is created_at for it, because
 * placement stores NULL stock_reserved_at when nothing was reserved.
 * Only the stock RELEASE is reservation-gated (callers must check
 * stock_reserved before releasing); the expiry decision is not.
 */
export function isReservationExpired(
  candidate: OrderReservationCandidate,
  now: Date = new Date(),
  options?: ReservationExpirationOptions,
): boolean {
  // 1. Already invoiced/converted orders are final
  if (candidate.sale_id != null) {
    return false;
  }

  // 2. Only orders still in 'pending' status can expire
  if (candidate.status !== 'pending') {
    return false;
  }

  // 3. Paid orders are never auto-reaped
  if (candidate.payment_status === 'paid') {
    return false;
  }

  // 4. Evaluate elapsed time since reservation (reserved orders) or since
  // placement (unreserved orders: stock_reserved_at is NULL, created_at applies)
  const rawDate = candidate.stock_reserved_at || candidate.created_at;
  const reservedAt = rawDate ? new Date(rawDate).getTime() : 0;
  if (!reservedAt || Number.isNaN(reservedAt)) {
    return false;
  }

  const elapsedMs = now.getTime() - reservedAt;
  if (elapsedMs < 0) {
    return false;
  }

  const isCod = String(candidate.payment_method || '').toLowerCase() === 'cod';
  const thresholdMs = isCod
    ? (options?.codTimeoutMs ?? DEFAULT_COD_STALE_TIMEOUT_MS)
    : (options?.onlineTimeoutMs ?? DEFAULT_ONLINE_PAYMENT_TIMEOUT_MS);

  return elapsedMs >= thresholdMs;
}

export interface ParsedReservationItem {
  productId: number;
  quantity: number;
  unitPrice?: number;
  name?: string;
}

/**
 * Safely parses and extracts normalized line items for stock release.
 */
export function extractReservationItems(itemsRaw: unknown): ParsedReservationItem[] {
  let items: any[] = [];
  if (typeof itemsRaw === 'string') {
    try {
      items = JSON.parse(itemsRaw);
    } catch {
      return [];
    }
  } else if (Array.isArray(itemsRaw)) {
    items = itemsRaw;
  }

  if (!Array.isArray(items)) {
    return [];
  }

  const result: ParsedReservationItem[] = [];
  for (const it of items) {
    const pId = Number(it?.productId ?? it?.product_id ?? it?.id);
    const qty = Number(it?.quantity ?? it?.qty ?? 0);
    if (!Number.isNaN(pId) && pId > 0 && !Number.isNaN(qty) && qty > 0) {
      result.push({
        productId: pId,
        quantity: qty,
        unitPrice: Number(it?.unitPrice ?? it?.price ?? 0),
        name: typeof it?.name === 'string' ? it.name : undefined,
      });
    }
  }

  return result;
}
