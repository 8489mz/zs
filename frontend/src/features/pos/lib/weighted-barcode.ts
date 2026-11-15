import type { AppSettings } from '@/types/domain';
import { parseQuantityPrefixQuery } from '@/features/pos/lib/pos-quantity-prefix';
import { parseWeightedBarcode } from '@/shared/lib/weighted-barcode';

export * from '@/shared/lib/weighted-barcode';

/**
 * Determines whether a rapid scanner buffer flush represents a weighted barcode
 * (with optional quantity prefix such as `2*2100012015005`) and should auto-submit
 * even when the hardware scanner omits an Enter suffix or input focus is outside search.
 */
export function isAutoSubmittableWeightedBarcode(
  rawQuery: string,
  settings?: Partial<AppSettings> | null,
): boolean {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) return false;
  const parsedPrefix = parseQuantityPrefixQuery(trimmed);
  const candidate = parsedPrefix.cleanQuery || trimmed;
  return Boolean(parseWeightedBarcode(candidate, settings));
}
