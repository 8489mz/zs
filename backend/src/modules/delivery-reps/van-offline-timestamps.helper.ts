import { AppError } from '../../common/errors/app-error';
import { validateOfflineCreatedAt } from '../cash-drawer/helpers/cash-drawer.helper';

/**
 * INV-VAN-OFFLINE-TIMESTAMPS: the van-side front door for offline
 * timestamps. The POS gate (validateOfflineCreatedAt) is reused
 * verbatim — 7-day past bound, +5-minute future bound, pre-2000
 * reject — never re-implemented here. On top of it the van path
 * requires an ISO instant WITH an offset (Z or ±HH:MM): a naive
 * local-time string ('2026-11-09T10:00:00') parses as the SERVER's
 * local zone and would book the wrong tenant day, so it is rejected
 * here instead of silently reinterpreted. A Date instance (already
 * an absolute instant) passes straight to the gate.
 */
const OFFSET_ISO_RE = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;

export function validateVanOfflineCreatedAt(value: unknown, now?: Date): Date | null {
  if (value instanceof Date) return validateOfflineCreatedAt(value, now);
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!OFFSET_ISO_RE.test(raw)) {
    throw new AppError('تاريخ الحركة الأوفلاين يجب أن يتضمن المنطقة الزمنية', 'OFFLINE_TIMESTAMP_INVALID', 400);
  }
  return validateOfflineCreatedAt(value, now);
}
