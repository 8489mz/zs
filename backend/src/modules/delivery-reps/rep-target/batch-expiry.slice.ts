export interface BatchExpiryStatusResult {
  status: 'valid' | 'near_expiry' | 'expired' | 'no_expiry';
  daysRemaining: number | null;
  earliestExpiryDate: string | null;
}

/**
 * Evaluates FEFO / Batch Expiry status for Van Stock and Warehouse Load items.
 */
export function evaluateBatchExpiryStatus(
  expiryDateStr: string | null | undefined,
  referenceDate: Date = new Date(),
  nearExpiryDaysThreshold = 60,
): BatchExpiryStatusResult {
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
