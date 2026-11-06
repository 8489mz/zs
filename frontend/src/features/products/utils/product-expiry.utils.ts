/* Product expiry classification (INV-EXPIRY-ALERT).
 *
 * Mirrors the canonical backend rule in
 * backend/src/modules/delivery-reps/rep-target.engine.ts
 * (`evaluateBatchExpiryStatus`, default 60-day alert window): the expiry date
 * is read from the product itself (`expiryDate`) or from its stored metadata
 * (`metadata.expiryDate` / `metadata.expiry_date`, as saved by the product
 * form), and classified as valid / near_expiry / expired / no_expiry.
 * The item card (ProductCardModal) renders the date and the alert from here,
 * so a product recorded with an expiry date can no longer look dateless.
 */

export type ProductExpiryStatus = 'valid' | 'near_expiry' | 'expired' | 'no_expiry';

export interface ProductExpiryStatusResult {
  status: ProductExpiryStatus;
  daysRemaining: number | null;
  earliestExpiryDate: string | null;
}

/** Alert window in days, matching the backend FEFO rule (60 days). */
export const PRODUCT_EXPIRY_ALERT_DAYS = 60;

export interface ProductExpirySource {
  expiryDate?: string | null;
  metadata?: string | Record<string, unknown> | null;
}

/**
 * Reads the recorded expiry date for a product: the top-level `expiryDate`
 * first, then `metadata.expiryDate` / `metadata.expiry_date` (metadata may
 * arrive as an object or a JSON string). Returns null when nothing is
 * recorded, so callers never throw on a dateless product.
 */
export function getProductExpiryDate(
  product: ProductExpirySource | null | undefined,
): string | null {
  if (!product) return null;
  const direct = String(product.expiryDate || '').trim();
  if (direct) return direct;
  let meta: Record<string, unknown> | null = null;
  if (typeof product.metadata === 'string') {
    try {
      const parsed: unknown = JSON.parse(product.metadata);
      meta = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      meta = null;
    }
  } else if (product.metadata && typeof product.metadata === 'object') {
    meta = product.metadata as Record<string, unknown>;
  }
  if (!meta) return null;
  const fromMeta = String(meta.expiryDate || meta.expiry_date || '').trim();
  return fromMeta || null;
}

/**
 * Classifies an expiry date against a reference date (defaults to now).
 * Day math matches the backend rule: whole UTC calendar days between the
 * reference day and the expiry day. At or under the threshold the item is
 * near expiry; a past date is expired; a missing or unparseable date is
 * no_expiry (never an exception).
 */
export function evaluateProductExpiryStatus(
  expiryDateStr: string | null | undefined,
  referenceDate: Date = new Date(),
  nearExpiryDaysThreshold: number = PRODUCT_EXPIRY_ALERT_DAYS,
): ProductExpiryStatusResult {
  const raw = String(expiryDateStr || '').trim();
  if (!raw) {
    return { status: 'no_expiry', daysRemaining: null, earliestExpiryDate: null };
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { status: 'no_expiry', daysRemaining: null, earliestExpiryDate: null };
  }
  const refDayStart = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  );
  const expDayStart = Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  );
  const daysRemaining = Math.floor((expDayStart - refDayStart) / (1000 * 60 * 60 * 24));
  const isoDate = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
  if (daysRemaining < 0) {
    return { status: 'expired', daysRemaining, earliestExpiryDate: isoDate };
  }
  if (daysRemaining <= nearExpiryDaysThreshold) {
    return { status: 'near_expiry', daysRemaining, earliestExpiryDate: isoDate };
  }
  return { status: 'valid', daysRemaining, earliestExpiryDate: isoDate };
}

/** Arabic alert text for the item card, or null when no alert applies. */
export function productExpiryAlertLabel(result: ProductExpiryStatusResult): string | null {
  if (result.status === 'expired') return 'منتهية الصلاحية';
  if (result.status === 'near_expiry') {
    if (result.daysRemaining === 0) return 'تنتهي اليوم';
    if (result.daysRemaining === 1) return 'قريبة الانتهاء (باقي يوم واحد)';
    return `قريبة الانتهاء (باقي ${result.daysRemaining} يوم)`;
  }
  return null;
}
