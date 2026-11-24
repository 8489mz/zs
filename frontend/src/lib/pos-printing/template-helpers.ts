import { getCurrencyDecimals, getGlobalSystemCurrency } from '../currencies';
import type { AppSettings } from '@/types/domain';
import { getReceiptNumberLocale } from '@/lib/pos-printing/shared';

export function resolveStoreIdentity(settings?: Partial<AppSettings> | null) {
  const brandName = String(settings?.storeName || 'متجر').trim() || 'متجر';
  const storeName = brandName;
  return { brandName, storeName };
}

export function getAdaptiveBrandFontSize(brandName: string, compact = false) {
  const length = Array.from(String(brandName || '').trim()).length;
  if (compact) {
    if (length > 30) return '13px';
    if (length > 22) return '15.5px';
    if (length > 15) return '18.5px';
    if (length > 10) return '21.5px';
    return '24px';
  }
  if (length > 30) return '16px';
  if (length > 22) return '20px';
  if (length > 15) return '24px';
  if (length > 10) return '28px';
  return '32px';
}

export function getNumberLocale(settings?: Partial<AppSettings> | null) {
  return getReceiptNumberLocale(settings);
}

export function formatReceiptNumber(value: number, settings?: Partial<AppSettings> | null, fractionDigits = 0) {
  return new Intl.NumberFormat(getNumberLocale(settings), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(value || 0));
}

export function formatReceiptMoney(value: number, settings?: Partial<AppSettings> | null) {
  const decimals = getCurrencyDecimals(settings?.currency);
  return formatReceiptNumber(Number(value || 0), settings, decimals);
}

export function formatReceiptQuantity(value: number, settings?: Partial<AppSettings> | null) {
  return new Intl.NumberFormat(getNumberLocale(settings), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number(value || 0));
}

export function formatReceiptText(value: string | number | null | undefined, settings?: Partial<AppSettings> | null) {
  const text = String(value ?? '—');
  const isEnglishFormat = settings?.printNumberFormat === 'english' ||
    (settings?.printNumberFormat !== 'arabic' && (settings?.currency === 'KWD' || settings?.country === 'KW' || getGlobalSystemCurrency() === 'KWD'));
  if (!isEnglishFormat) return text;
  return text
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}
