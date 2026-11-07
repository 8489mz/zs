/**
 * Arabic to English Keyboard Remapper & Invoice Barcode Normalizer
 * Translates scanner keystrokes entered while the OS keyboard layout is set to Arabic.
 */

const ARABIC_TO_ENGLISH_MAP: Record<string, string> = {
  // Arabic Letters
  'ض': 'q', 'ص': 'w', 'ث': 'e', 'ق': 'r', 'ف': 't', 'غ': 'y', 'ع': 'u', 'ه': 'i', 'خ': 'o', 'ح': 'p', 'ج': '[', 'د': ']',
  'ش': 'a', 'س': 's', 'ي': 'd', 'ب': 'f', 'ل': 'g', 'ا': 'h', 'ت': 'j', 'ن': 'k', 'م': 'l', 'ك': ';', 'ط': '\'',
  'ئ': 'z', 'ء': 'x', 'ؤ': 'c', 'ر': 'v', 'لا': 'b', 'ى': 'n', 'ة': 'm', 'و': ',', 'ز': '.', 'ظ': '/',
  // Capital / Shift letters on Arabic keyboard
  'َ': 'Q', 'ً': 'W', 'ُ': 'E', 'ٌ': 'R', 'لإ': 'T', 'إ': 'Y', '‘': 'U', '÷': 'I', '×': 'O', '؛': 'P',
  'ِ': 'A', 'ٍ': 'S', 'لأ': 'G', 'أ': 'H', 'ـ': 'J', '،': 'K',
  '~': 'Z', 'ْ': 'X', 'لآ': 'B', 'آ': 'N', '؟': '?',
  // Arabic digits
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function remapArabicKeyboardToEnglish(input: string): string {
  if (!input) return '';
  let result = '';
  for (let i = 0; i < input.length; i++) {
    // Check for two-character ligature 'لا' or 'لأ' or 'لإ' or 'لآ'
    if (i + 1 < input.length) {
      const pair = input.substring(i, i + 2);
      if (ARABIC_TO_ENGLISH_MAP[pair]) {
        result += ARABIC_TO_ENGLISH_MAP[pair];
        i++;
        continue;
      }
    }
    const char = input[i];
    result += ARABIC_TO_ENGLISH_MAP[char] !== undefined ? ARABIC_TO_ENGLISH_MAP[char] : char;
  }
  return result;
}

export function stripSeparators(input: string): string {
  return String(input || '')
    .replace(/[\/\-_.\s\\]/g, '')
    .trim()
    .toLowerCase();
}

export function isInvoiceBarcodeQuery(raw: string): boolean {
  const query = String(raw || '').trim();
  if (!query) return false;
  const remapped = remapArabicKeyboardToEnglish(query).trim().toUpperCase();

  // Matches invoice patterns like Z-260825-0011, Z/260825/0011, INV-1234, 260825-0011, Z2608250011, 2608206
  if (/^Z[-/_.]?\d+/i.test(remapped) || /^INV[-/_.]?\d+/i.test(remapped)) return true;
  // A bare numeric dashed code is an invoice only when its 6-digit prefix is
  // a valid YYMMDD date (e.g. 260825-0011). A numeric product barcode such as
  // 622123-456789 (month 21) must go straight to barcode lookup instead of
  // taking the invoice-search detour.
  if (/^(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[-/_.]\d+/.test(remapped)) return true;
  if (/^Z/i.test(remapped) && remapped.length >= 5) return true;
  if (/^ZL\d+/i.test(remapped) && remapped.length >= 5) return true;
  // Also check if raw contained Arabic 'ئ' or 'ظ' (mapped to Z)
  if (/^[ئظ][-/_.]?\d+/i.test(query)) return true;

  // Exact invoice barcode format: YYMMDD + sequence (e.g. 2608206 -> 26=Year, 08=Month, 20=Day, 6=Seq)
  const invoiceDateMatch = remapped.match(/^(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(\d{1,6})$/);
  if (invoiceDateMatch) {
    return true;
  }

  return false;
}

/**
 * Routing decision for a numeric dashed product barcode (INV-BARCODE-HIJACK-FIX):
 * returns true when the query must skip the invoice search entirely and go
 * straight to barcode lookup. True only for a digits-and-separators code
 * (e.g. 622123-456789) that is NOT an invoice code. Bare digits (e.g. 123,
 * which can be an invoice sequence number), plain barcodes without a
 * separator, and alphanumeric codes keep today's invoice-first order.
 */
export function shouldSkipInvoiceSearch(raw: string): boolean {
  const query = String(raw || '').trim();
  if (!query) return false;
  const remapped = remapArabicKeyboardToEnglish(query).trim().toUpperCase();
  if (!/^\d+(?:[-/_.]\d+)+$/.test(remapped)) return false;
  return !isInvoiceBarcodeQuery(query);
}

export function getNormalizedInvoiceSearchTerms(raw: string): string[] {
  const original = String(raw || '').trim();
  if (!original) return [];
  const remapped = remapArabicKeyboardToEnglish(original).trim().toUpperCase();
  const strippedRemapped = stripSeparators(remapped);
  const strippedOriginal = stripSeparators(original);

  const terms = new Set<string>();

  // 1. If query contains date pattern YYMMDD and sequence number (e.g. 260828-0024 or 2608280024)
  const numbersMatch = remapped.match(/^(\d{6})[^\d]*(\d+)$/) || remapped.match(/(\d{6})[^\d]*(\d+)/);
  if (numbersMatch) {
    const [, datePart, seqPart] = numbersMatch;
    const numSeq = Number(seqPart);
    if (!Number.isNaN(numSeq)) {
      terms.add(`Z-${datePart}-${seqPart.padStart(4, '0')}`);
      terms.add(`Z-${datePart}-${seqPart}`);
      terms.add(`${datePart}-${seqPart.padStart(4, '0')}`);
      terms.add(`${datePart}-${seqPart}`);
      terms.add(`${datePart}${seqPart.padStart(4, '0')}`);
      terms.add(`${datePart}${seqPart}`);
    }
  }

  // 2. Add remapped English code (e.g. Z-260830-0001)
  if (remapped) terms.add(remapped);
  if (strippedRemapped) terms.add(strippedRemapped);

  // 3. Fallback to original
  if (original && original !== remapped) terms.add(original);
  if (strippedOriginal && strippedOriginal !== strippedRemapped) terms.add(strippedOriginal);

  return Array.from(terms).filter(Boolean);
}

export function matchesSaleDocNo(saleDocNo: string | undefined | null, query: string): boolean {
  const target = String(saleDocNo || '').trim().toLowerCase();
  const search = String(query || '').trim().toLowerCase();
  if (!target || !search) return false;

  // 1. Direct or separator-stripped exact match
  if (target === search) return true;
  if (stripSeparators(target) === stripSeparators(search)) return true;

  const remappedSearch = remapArabicKeyboardToEnglish(search).toLowerCase();
  if (target === remappedSearch) return true;
  if (stripSeparators(target) === stripSeparators(remappedSearch)) return true;

  // 2. Exact full numeric sequence match
  const targetNums = target.replace(/\D/g, '');
  const searchNums = remappedSearch.replace(/\D/g, '');
  if (targetNums && searchNums && targetNums === searchNums) {
    return true;
  }

  // 3. Date + Sequence matching (e.g. Z-260820-0006 vs 2608206 or Z-260830-0016 vs 260830-16)
  const targetDateMatch = target.match(/(\d{6})[^\d]*(\d+)/);
  const searchDateMatch = remappedSearch.match(/(\d{6})[^\d]*(\d+)/);
  if (targetDateMatch && searchDateMatch) {
    const targetDate = targetDateMatch[1];
    const searchDate = searchDateMatch[1];
    const targetSeq = Number(targetDateMatch[2]);
    const searchSeq = Number(searchDateMatch[2]);

    if (targetDate === searchDate && targetSeq === searchSeq && !Number.isNaN(targetSeq) && !Number.isNaN(searchSeq)) {
      return true;
    }
  }

  // 4. Sequential scheme match (e.g. Z-123 vs 123)
  if (/^z[-/_.]?\d+$/i.test(target) && /^\d+$/.test(searchNums)) {
    if (Number(targetNums) === Number(searchNums) && !Number.isNaN(Number(searchNums))) {
      return true;
    }
  }

  return false;
}

/**
 * Live sanitizer for search input:
 * If the user/scanner enters an invoice barcode with Arabic keyboard layout
 * (e.g. starting with 'ئ' or 'ظ' or containing barcode sequences),
 * it converts it live to clean English (e.g. 'Z-260825-0011').
 */
export function sanitizeSearchInputLive(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (/^[ئظ][\/\-_.\s\d]/i.test(trimmed) || /^[ئظ]\d/i.test(trimmed)) {
    const remapped = remapArabicKeyboardToEnglish(input);
    if (/^z[-/_.]?\d+/i.test(remapped)) {
      return remapped.replace(/^z/i, 'Z').replace(/[\/]/g, '-');
    }
    return remapped;
  }
  if (/^z[\/\-_.]\d+[\/\-_.]\d+/i.test(trimmed)) {
    return trimmed.replace(/^z/i, 'Z').replace(/[\/]/g, '-');
  }
  return input;
}
