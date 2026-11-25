import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';

export type DbExecutor = Kysely<Database>;
export type TenantScope = { tenantId: string; accountId: string };

/**
 * INV-IMPORT-CHUNKED-1000: one import request carries at most 1,000 rows.
 * A 10,000-row file sent as a single request runs one minutes-long
 * transaction and the edge answers 504 while the server keeps working, so
 * the workbench sends 1,000-row chunks (frontend ImportWorkbench) and the
 * server enforces the same cap here so no caller can re-create the 504.
 */
export const MAX_IMPORT_ROWS_PER_REQUEST = 1000;

export function cleanString(value: unknown): string {
  return String(value ?? '').trim();
}

export function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeImportKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

export function normalizeArabicDigits(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0660-\u0669]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

export function normalizeNumberText(value: unknown): string {
  return normalizeArabicDigits(value).replace(/[،,]/g, '.').trim();
}

export function digitsOnly(value: unknown): string {
  return normalizeArabicDigits(value).replace(/\D/g, '');
}

export function normalizePhoneText(value: unknown): string {
  return normalizeArabicDigits(value).replace(/\s+/g, '').trim();
}

export function normalizeBarcodeText(value: unknown): string {
  let text = cleanString(value);
  if (!text) return '';
  text = normalizeArabicDigits(text);
  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(text)) {
    const num = Number(text);
    if (Number.isFinite(num) && Math.floor(num) === num) {
      try {
        text = BigInt(Math.round(num)).toString();
      } catch {
        text = num.toLocaleString('fullwide', { useGrouping: false });
      }
    }
  }
  return text;
}

export function parseDateOnly(value: unknown): string | null {
  const text = normalizeArabicDigits(value).trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const ymdSlash = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymdSlash) {
    const month = Number(ymdSlash[2]);
    const day = Number(ymdSlash[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${ymdSlash[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const mdYSlash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdYSlash) {
    const month = Number(mdYSlash[1]);
    const day = Number(mdYSlash[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${mdYSlash[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

export function toNumericOrNull(value: unknown): number | null {
  const text = normalizeNumberText(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
