export interface ParsedQuantityQuery {
  hasPrefix: boolean;
  quantity: number;
  cleanQuery: string;
  isSuffixQuantityChange?: boolean;
}

/**
 * Checks if a code looks like an electronic scale variable-measure barcode (e.g. EAN-13 with 20-29 or 99 prefix and 12-13 digits).
 */
export function isScaleBarcodeLike(text: string): boolean {
  const digits = String(text || '').trim().replace(/\D/g, '');
  if (digits.length >= 12 && digits.length <= 13) {
    if (/^(2[0-9]|99)/.test(digits)) {
      return true;
    }
  }
  return false;
}

/**
 * Parses search or barcode input to extract quantity multipliers.
 * Examples:
 * - "10+6221234567890" => { hasPrefix: true, quantity: 10, cleanQuery: "6221234567890" }
 * - "10*6221234567890" => { hasPrefix: true, quantity: 10, cleanQuery: "6221234567890" }
 * - "10x6221234567890" => { hasPrefix: true, quantity: 10, cleanQuery: "6221234567890" }
 * - "5*اندومي"         => { hasPrefix: true, quantity: 5, cleanQuery: "اندومي" }
 * - "2.5*طماطم"        => { hasPrefix: true, quantity: 2.5, cleanQuery: "طماطم" }
 * - ".25*code"         => { hasPrefix: true, quantity: 0.25, cleanQuery: "code" }
 * - "2+210004400250"   => { hasPrefix: false, quantity: 1, cleanQuery: "210004400250" } (Scale barcode exempt)
 * - "10+" or "10*"     => { hasPrefix: true, quantity: 10, cleanQuery: "" }
 * - "*10" or "+10"     => { hasPrefix: true, quantity: 10, cleanQuery: "", isSuffixQuantityChange: true }
 * - "6221234567890"    => { hasPrefix: false, quantity: 1, cleanQuery: "6221234567890" }
 */
export function parseQuantityPrefixQuery(rawInput?: string | null): ParsedQuantityQuery {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    return { hasPrefix: false, quantity: 1, cleanQuery: '' };
  }

  // 1. Check if user typed "+10" or "*10" (Suffix command to update quantity of current cart line)
  const suffixMatch = trimmed.match(/^[*+xX]\s*(\d+(?:\.\d+)?|\.\d+)$/);
  if (suffixMatch) {
    const qty = Number(suffixMatch[1]);
    if (qty > 0 && !isNaN(qty)) {
      return { hasPrefix: true, quantity: qty, cleanQuery: '', isSuffixQuantityChange: true };
    }
  }

  // 2. Check prefix multiplier: e.g. "10*", "10+", "10x", "2.5*", "10*اندومي", "10+6221234567890"
  const prefixMatch = trimmed.match(/^(\d+(?:\.\d+)?|\.\d+)\s*[*+xX]\s*(.*)$/);
  if (prefixMatch) {
    const qty = Number(prefixMatch[1]);
    const cleanQuery = prefixMatch[2].trim();
    if (qty > 0 && !isNaN(qty)) {
      // EXCEPTION FOR SCALE / WEIGHTED BARCODES:
      // If the query after the prefix is a scale barcode (starts with 20-29 or 99 with 12-13 digits),
      // we disable the multiplier because each scale sticker carries a unique exact weight.
      if (cleanQuery && isScaleBarcodeLike(cleanQuery)) {
        return { hasPrefix: false, quantity: 1, cleanQuery };
      }
      return { hasPrefix: true, quantity: qty, cleanQuery };
    }
  }

  return { hasPrefix: false, quantity: 1, cleanQuery: trimmed };
}
