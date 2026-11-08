/**
 * Returns the number of decimal fraction digits for a given currency code.
 * KWD, OMR, BHD, JOD, TND, IQD and LYD use 3 decimals, everything else 2.
 * The old inline list only knew KWD/BHD/OMR, so JOD/TND/IQD/LYD tenants
 * formatted (and, through `useSystemCurrency`, rounded) at 2dp.
 *
 * NOTE: this set intentionally mirrors the canonical lists in
 * `shared/utils/money.ts` (`currencyMoneyDigits`) and the backend
 * `money-minor-units.engine.ts` instead of importing the helper — this
 * module is imported by the FE3 plain-Node proof spec, and neither the
 * `@/` alias nor a `.ts` extension survives both plain-Node ESM
 * resolution and the frontend typecheck (`allowImportingTsExtensions:
 * false`). The three lists must agree; the FE3 spec
 * (`backend/test/critical/fe3-frontend-book-digits.spec.ts`) asserts
 * `getCurrencyDecimals(code) === currencyMoneyDigits(code)` for every
 * code in the set, so a drift fails the spec. Display formatting must
 * never throw, so a malformed code falls back to 2 instead of the
 * helper's fail-closed throw; missing/empty codes already mean 2
 * (tenant settings still loading — 'EGP' default).
 */
const threeDecimalCurrencies = new Set(['KWD', 'OMR', 'BHD', 'JOD', 'TND', 'IQD', 'LYD']);

export function getCurrencyDecimals(currencyCode?: string | null): number {
  const code = currencyCode || getGlobalSystemCurrency();
  const upper = String(code).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) return 2;
  return threeDecimalCurrencies.has(upper) ? 3 : 2;
}
/** Supported currencies across the system. Single source of truth used by Settings and Purchase Order pages. */
export const SUPPORTED_CURRENCIES = [
  { code: 'SAR', label: 'SAR - ريال سعودي', symbol: 'ر.س', decimals: 2 },
  { code: 'EGP', label: 'EGP - جنيه مصري', symbol: 'ج.م', decimals: 2 },
  { code: 'AED', label: 'AED - درهم إماراتي', symbol: 'د.إ', decimals: 2 },
  { code: 'KWD', label: 'KWD - دينار كويتي (فلس)', symbol: 'د.ك', decimals: 3 },
  { code: 'QAR', label: 'QAR - ريال قطري', symbol: 'ر.ق', decimals: 2 },
  { code: 'BHD', label: 'BHD - دينار بحريني (فلس)', symbol: 'د.ب', decimals: 3 },
  { code: 'OMR', label: 'OMR - ريال عماني (بيسة)', symbol: 'ر.ع', decimals: 3 },
  { code: 'USD', label: 'USD - US Dollar', symbol: '$', decimals: 2 },
] as const;

export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number]['code'];

const STORAGE_KEY = 'zs_system_currency';
let activeSystemCurrency: string = 'EGP';
const subscribers = new Set<(currency: string) => void>();

/**
 * Updates the global system currency in memory, local storage, and notifies all subscribers.
 */
export function setGlobalSystemCurrency(currencyCode?: string | null): void {
  if (!currencyCode) return;
  const normalized = String(currencyCode).trim().toUpperCase();
  if (normalized && normalized !== activeSystemCurrency) {
    activeSystemCurrency = normalized;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, normalized);
      } catch {}
    }
    subscribers.forEach((cb) => cb(normalized));
  }
}

/**
 * Returns the active global system currency code (e.g. 'SAR', 'EGP', 'AED').
 */
export function getGlobalSystemCurrency(): string {
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        activeSystemCurrency = stored.trim().toUpperCase();
        return activeSystemCurrency;
      }
    } catch {}
  }
  return activeSystemCurrency || 'EGP';
}

/**
 * Returns the currency symbol ('ر.س' / 'ج.م' in Arabic, or 'SAR' / 'EGP' in English).
 */
export function getCurrencySymbol(currencyCode?: string | null): string {
  const code = currencyCode || getGlobalSystemCurrency();
  const upper = String(code).trim().toUpperCase();
  const isEn =
    (typeof document !== 'undefined' && document.documentElement.lang === 'en') ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('zs_storefront_lang') === 'en');
  if (isEn) {
    return upper === 'USD' ? '$' : upper;
  }
  const match = SUPPORTED_CURRENCIES.find((c) => c.code === upper);
  return match ? match.symbol : upper;
}

/**
 * Returns the active global system currency symbol.
 */
export function getGlobalCurrencySymbol(): string {
  return getCurrencySymbol(getGlobalSystemCurrency());
}

export function isThreeDecimalCurrency(currencyCode?: string | null): boolean {
  return getCurrencyDecimals(currencyCode) === 3;
}

/**
 * Resolves the 2-letter country code ('KW', 'SA', 'EG', etc.) from settings or active currency.
 */
export function getSystemCountryCode(settings?: { country?: string; currency?: string } | null): string {
  if (settings?.country) {
    const raw = String(settings.country).trim().toUpperCase();
    if (raw) return raw;
  }
  const curr = String(settings?.currency || getGlobalSystemCurrency()).trim().toUpperCase();
  if (curr === 'KWD') return 'KW';
  if (curr === 'SAR') return 'SA';
  if (curr === 'AED') return 'AE';
  if (curr === 'QAR') return 'QA';
  if (curr === 'BHD') return 'BH';
  if (curr === 'OMR') return 'OM';
  return 'EG';
}

export function isKuwait(settings?: { country?: string; currency?: string } | null): boolean {
  const code = getSystemCountryCode(settings);
  const curr = String(settings?.currency || getGlobalSystemCurrency()).trim().toUpperCase();
  return code === 'KW' || curr === 'KWD';
}

export function isSaudi(settings?: { country?: string; currency?: string } | null): boolean {
  const code = getSystemCountryCode(settings);
  const curr = String(settings?.currency || getGlobalSystemCurrency()).trim().toUpperCase();
  return code === 'SA' || curr === 'SAR';
}

export function isEgypt(settings?: { country?: string; currency?: string } | null): boolean {
  const code = getSystemCountryCode(settings);
  const curr = String(settings?.currency || getGlobalSystemCurrency()).trim().toUpperCase();
  return code === 'EG' || curr === 'EGP';
}

/**
 * Subscribe to global system currency changes.
 */
export function subscribeToCurrencyChanges(callback: (currency: string) => void): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

