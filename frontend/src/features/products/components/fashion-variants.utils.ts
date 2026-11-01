import { normalizeArabicInput, normalizeArabicSearchKey } from '@/lib/arabic-normalization';

export interface FashionVariantDraft {
  id?: string;
  color: string;
  size: string;
  barcode: string;
  stock: number;
  costPrice?: number;
  retailPrice?: number;
  wholesalePrice?: number;
  minStock?: number;
  sku?: string;
  isManual?: boolean;
  /** Per-variant photo. Same value format as a single product's imageUrl
   * (compressed data URL from VariantImageCell / ProductImageUploadField);
   * the backend stores it in the child row's metadata.imageUrl via the
   * existing storefront-media normalization. Undefined = no per-variant
   * photo (the child inherits the parent photo on create). */
  imageUrl?: string;
}

function makeVariantKey(color: string, size: string) {
  return `${normalizeArabicSearchKey(String(color || ''))}::${normalizeArabicSearchKey(String(size || ''))}`;
}

export function splitFashionTokens(value: string | undefined) {
  const seen = new Set<string>();
  const tokens: string[] = [];

  // Protect hyphenated age/size ranges with units (e.g. "2-3 سنوات", "0-3 شهور", "4-5y")
  let sanitized = String(value || '');
  const ageRangePlaceholder = '___AGE_RANGE_HYPHEN___';
  sanitized = sanitized.replace(
    /(^|[^\d])(\d+)\s*[-–—−]\s*(\d+)\s*(سنوات|سنة|شهور|شهر|أشهر|عام|أعوام|سنين|y|m|years|months|yrs|mos)(?=[^\p{L}\p{N}]|$)/gui,
    `$1$2${ageRangePlaceholder}$3 $4`
  );

  // Dashes (- – — −), commas (، ,), newlines, pipes (|), and slashes (/) all act as delimiters
  const delimiterPattern = /(?:\s*[\n،,|/–—−\-]\s*)+/g;

  for (const rawEntry of sanitized.split(delimiterPattern)) {
    const restored = rawEntry.replace(new RegExp(ageRangePlaceholder, 'g'), '-');
    const entry = normalizeArabicInput(restored);
    if (!entry) continue;
    const key = normalizeArabicSearchKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(entry);
  }
  return tokens;
}

export function mergeFashionTokens(currentValue: string | undefined, additions: string[]) {
  return splitFashionTokens([...(splitFashionTokens(currentValue)), ...additions.map((value) => normalizeArabicInput(value))].join('، ')).join('، ');
}

export function buildFashionVariantDrafts(
  colors: string[],
  sizes: string[],
  existingRows: FashionVariantDraft[],
  defaultStock: number,
): FashionVariantDraft[] {
  const existingMap = new Map(existingRows.map((row) => [makeVariantKey(row.color, row.size), row]));
  const nextRows: FashionVariantDraft[] = [];
  const normalizedColors = colors.length ? colors : [''];
  const normalizedSizes = sizes.length ? sizes : [''];

  if (colors.length || sizes.length) {
    for (const color of normalizedColors) {
      for (const size of normalizedSizes) {
        if (!String(color || '').trim() && !String(size || '').trim()) continue;
        const key = makeVariantKey(color, size);
        const existing = existingMap.get(key);
        const id = existing?.id || `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        nextRows.push(
          existing
            ? { ...existing, color, size }
            : { id, color, size, barcode: '', stock: Number(defaultStock || 0), isManual: false }
        );
      }
    }
  }

  // Preserve only rows that were added manually by the user or are empty rows in progress
  for (const row of existingRows) {
    if (row.isManual || (!String(row.color || '').trim() && !String(row.size || '').trim())) {
      const key = makeVariantKey(row.color, row.size);
      if (!nextRows.some((nr) => makeVariantKey(nr.color, nr.size) === key)) {
        const id = row.id || `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        nextRows.push({ ...row, id, isManual: true });
      }
    }
  }

  return nextRows;
}
