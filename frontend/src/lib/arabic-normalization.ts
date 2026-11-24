const ARABIC_DIACRITICS_REGEX = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const SEARCH_NOISE_REGEX = /[^\p{L}\p{N}\s]+/gu;
const MULTI_SPACE_REGEX = /\s+/g;
const EASTERN_ARABIC_DIGITS_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function normalizeArabicDigits(value: unknown): string {
  return String(value ?? '').replace(/[٠-٩۰-۹]/g, (char) => EASTERN_ARABIC_DIGITS_MAP[char] || char);
}

export function normalizeArabicBase(value: unknown): string {
  return normalizeArabicDigits(value)
    .replace(/[أإآٱٲٳ]/g, 'ا')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/[ى]/g, 'ي')
    .replace(/[ة]/g, 'ه')
    .replace(/[ء]/g, '')
    .replace(ARABIC_DIACRITICS_REGEX, '')
    .replace(MULTI_SPACE_REGEX, ' ');
}

export function normalizeArabicInput(value: unknown): string {
  return normalizeArabicBase(value).trim();
}

export function normalizeArabicSearchText(value: unknown): string {
  return normalizeArabicBase(value)
    .toLowerCase()
    .replace(SEARCH_NOISE_REGEX, ' ')
    .replace(MULTI_SPACE_REGEX, ' ');
}

export function normalizeArabicSearchKey(value: unknown): string {
  return normalizeArabicSearchText(value).trim();
}

/**
 * Checks if haystack matches needle with Arabic, case, and multi-token normalization
 */
export function matchesArabic(haystack: unknown, needle: unknown): boolean {
  const normNeedle = normalizeArabicSearchKey(needle);
  if (!normNeedle) return true;
  const normHaystack = normalizeArabicSearchKey(haystack);
  if (!normHaystack) return false;
  if (normHaystack.includes(normNeedle)) return true;
  const tokens = normNeedle.split(' ').filter(Boolean);
  return tokens.length > 1 && tokens.every((token) => normHaystack.includes(token));
}

/**
 * Computes relevance rank score (1000 down to 0) matching backend product-search-rank.engine.ts
 * so exact / whole-word matches ("بن", "باهي 1.5") always rank ahead of partial substrings ("جبنة").
 */
export function scoreArabicSearchRelevance(
  label: unknown,
  query: unknown,
  codes?: Array<string | null | undefined>,
  extraIdentity?: Array<string | null | undefined>,
): number {
  const rawLower = String(query ?? '').trim().toLowerCase();
  const q = normalizeArabicSearchKey(query);
  if (!q) return 1;
  const tokens = q.split(' ').filter(Boolean);

  const normLabel = normalizeArabicSearchKey(label);
  const rawCodes = (codes || [])
    .map((c) => String(c ?? '').trim().toLowerCase())
    .filter(Boolean);

  if ((rawLower && rawCodes.includes(rawLower)) || normLabel === q) return 1000;
  if (normLabel && normLabel.startsWith(`${q} `)) return 900;
  if (normLabel && ` ${normLabel} `.includes(` ${q} `)) return 800;
  if (normLabel && normLabel.startsWith(q)) return 720;
  if (normLabel && ` ${normLabel}`.includes(` ${q}`)) return 650;
  if (tokens.length > 1 && normLabel && tokens.every((t) => ` ${normLabel}`.includes(` ${t}`))) return 550;
  if (rawLower && rawCodes.some((c) => c.startsWith(rawLower))) return 500;
  if (rawLower && rawCodes.some((c) => c.includes(rawLower))) return 450;
  if (normLabel && tokens.every((t) => normLabel.includes(t))) return 350;

  if (extraIdentity && extraIdentity.length > 0) {
    const normExtra = normalizeArabicSearchKey(
      [label, ...rawCodes, ...extraIdentity].filter(Boolean).join(' '),
    );
    if (normExtra && tokens.every((t) => normExtra.includes(t))) return 250;
  }

  return 0;
}

const ARABIC_LETTERS_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Checks if a string contains any Arabic letters
 */
export function hasArabicCharacters(value: unknown): boolean {
  if (!value) return false;
  return ARABIC_LETTERS_REGEX.test(String(value));
}

/**
 * Returns 'rtl' if text contains Arabic characters, otherwise 'ltr'
 */
export function getTextDirection(value: unknown): 'rtl' | 'ltr' {
  return hasArabicCharacters(value) ? 'rtl' : 'ltr';
}

