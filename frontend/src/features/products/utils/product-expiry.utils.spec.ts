/* Expiry classification for the item card (INV-EXPIRY-ALERT).
 * Pins the canonical 60-day rule: live example item 28314 (expiry
 * 2026-12-05) is near expiry on 2026-11-06, a far date is valid, and a
 * dateless item never breaks. Reference dates are built at UTC midnight so
 * the day math is identical in every timezone.
 */
import { describe, it, expect } from 'vitest';
import {
  PRODUCT_EXPIRY_ALERT_DAYS,
  evaluateProductExpiryStatus,
  getProductExpiryDate,
  productExpiryAlertLabel,
} from './product-expiry.utils';

const refNov6 = new Date(Date.UTC(2026, 10, 6));

describe('evaluateProductExpiryStatus', () => {
  it('classifies the live item 28314 (expiry 2026-12-05) as near expiry on 2026-11-06', () => {
    const result = evaluateProductExpiryStatus('2026-12-05', refNov6);
    expect(result.status).toBe('near_expiry');
    expect(result.daysRemaining).toBe(29);
    expect(result.earliestExpiryDate).toBe('2026-12-05');
    expect(productExpiryAlertLabel(result)).toContain('قريبة الانتهاء');
  });

  it('classifies a far expiry date as valid', () => {
    const result = evaluateProductExpiryStatus('2027-06-01', refNov6);
    expect(result.status).toBe('valid');
    expect(result.daysRemaining).toBeGreaterThan(PRODUCT_EXPIRY_ALERT_DAYS);
    expect(result.earliestExpiryDate).toBe('2027-06-01');
    expect(productExpiryAlertLabel(result)).toBeNull();
  });

  it('classifies an expired date as expired with negative days remaining', () => {
    const result = evaluateProductExpiryStatus('2026-11-05', refNov6);
    expect(result.status).toBe('expired');
    expect(result.daysRemaining).toBe(-1);
    expect(productExpiryAlertLabel(result)).toBe('منتهية الصلاحية');
  });

  it('treats the 60-day boundary as near expiry and 61 days as valid', () => {
    expect(evaluateProductExpiryStatus('2027-01-05', refNov6).status).toBe('near_expiry');
    expect(evaluateProductExpiryStatus('2027-01-05', refNov6).daysRemaining).toBe(60);
    expect(evaluateProductExpiryStatus('2027-01-06', refNov6).status).toBe('valid');
    expect(evaluateProductExpiryStatus('2027-01-06', refNov6).daysRemaining).toBe(61);
  });

  it('never breaks on a missing or unparseable expiry date', () => {
    for (const bad of [null, undefined, '', '   ', 'not-a-date']) {
      const result = evaluateProductExpiryStatus(bad, refNov6);
      expect(result.status).toBe('no_expiry');
      expect(result.daysRemaining).toBeNull();
      expect(result.earliestExpiryDate).toBeNull();
      expect(productExpiryAlertLabel(result)).toBeNull();
    }
  });
});

describe('getProductExpiryDate', () => {
  it('prefers the top-level expiryDate', () => {
    expect(getProductExpiryDate({ expiryDate: '2026-12-05', metadata: { expiryDate: '2027-01-01' } })).toBe(
      '2026-12-05',
    );
  });

  it('falls back to metadata expiryDate / expiry_date, including JSON-string metadata', () => {
    expect(getProductExpiryDate({ metadata: { expiryDate: '2026-12-05' } })).toBe('2026-12-05');
    expect(getProductExpiryDate({ metadata: { expiry_date: '2026-12-05' } })).toBe('2026-12-05');
    expect(getProductExpiryDate({ metadata: JSON.stringify({ expiryDate: '2026-12-05' }) })).toBe(
      '2026-12-05',
    );
  });

  it('returns null when nothing is recorded', () => {
    expect(getProductExpiryDate(null)).toBeNull();
    expect(getProductExpiryDate(undefined)).toBeNull();
    expect(getProductExpiryDate({})).toBeNull();
    expect(getProductExpiryDate({ metadata: {} })).toBeNull();
    expect(getProductExpiryDate({ metadata: 'not-json{' })).toBeNull();
  });
});
