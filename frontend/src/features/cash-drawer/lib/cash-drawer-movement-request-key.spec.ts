/* Pins INV-CASH-DRAWER-MOVEMENT-IDEMPOTENCY (frontend half): the
   drawer movement mutation reuses one stable requestKey for retries
   of the identical payload, refuses a changed payload while the
   previous attempt is unresolved, and releases only on a known
   client rejection. */

import { describe, expect, it } from 'vitest';
import {
  acquireCashDrawerMovementRequestAttempt,
  cashDrawerMovementRequestFingerprint,
  createCashDrawerMovementRequestKey,
  mayReleaseCashDrawerMovementRequestAttempt,
  normalizeCashDrawerMovementRequestPayload,
  type CashDrawerMovementRequestAttempt,
} from './cash-drawer-movement-request-key';

const PAYLOAD = { shiftId: '7', type: 'cash_in' as const, amount: 100, note: 'float top-up' };

describe('cash-drawer movement request keys', () => {
  it('generates a UUID-shaped key inside the backend range', () => {
    const key = createCashDrawerMovementRequestKey(() => '123e4567-e89b-12d3-a456-426614174000');
    expect(key).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(() => createCashDrawerMovementRequestKey(() => 'short')).toThrow();
    expect(() => createCashDrawerMovementRequestKey(() => 'x'.repeat(161))).toThrow();
  });

  it('normalizes amount and trims the note like the server stores it', () => {
    expect(
      normalizeCashDrawerMovementRequestPayload({ shiftId: '7', type: 'cash_in', amount: '100', note: '  float top-up  ' }),
    ).toEqual(PAYLOAD);
  });

  it('fingerprints identical payloads identically regardless of representation', () => {
    const a = normalizeCashDrawerMovementRequestPayload({ shiftId: '7', type: 'cash_in', amount: '100', note: 'float' });
    const b = normalizeCashDrawerMovementRequestPayload({ shiftId: '7', type: 'cash_in', amount: 100, note: 'float' });
    expect(cashDrawerMovementRequestFingerprint(a)).toBe(cashDrawerMovementRequestFingerprint(b));
  });

  it('reuses the key for an identical payload and throws on a changed one', () => {
    const first = acquireCashDrawerMovementRequestAttempt(null, PAYLOAD, () => '123e4567-e89b-12d3-a456-426614174000');
    const reused = acquireCashDrawerMovementRequestAttempt(first, PAYLOAD);
    expect(reused).toBe(first);
    expect(() =>
      acquireCashDrawerMovementRequestAttempt(first, { ...PAYLOAD, amount: 200 }),
    ).toThrow();
    const attempt: CashDrawerMovementRequestAttempt = first;
    expect(attempt.requestKey).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('releases only on known client rejections, never on 408, 5xx, or network errors', () => {
    expect(mayReleaseCashDrawerMovementRequestAttempt({ status: 400 })).toBe(true);
    expect(mayReleaseCashDrawerMovementRequestAttempt({ status: 409 })).toBe(true);
    expect(mayReleaseCashDrawerMovementRequestAttempt({ status: 408 })).toBe(false);
    expect(mayReleaseCashDrawerMovementRequestAttempt({ status: 500 })).toBe(false);
    expect(mayReleaseCashDrawerMovementRequestAttempt({ status: 0 })).toBe(false);
    expect(mayReleaseCashDrawerMovementRequestAttempt(new Error('network down'))).toBe(false);
  });

  it('carries the safe-transfer counterpart through normalization (INV-REST-SAFE-TRANSFER-TYPES)', () => {
    const drop = normalizeCashDrawerMovementRequestPayload({
      shiftId: '7', type: 'safe_drop', amount: 50, note: 'drop', counterpartAccountId: '1120',
    });
    expect(drop.counterpartAccountId).toBe(1120);
    const replenishment = normalizeCashDrawerMovementRequestPayload({
      shiftId: '7', type: 'safe_replenishment', amount: 30, note: 'top-up', counterpartAccountId: 1120,
    });
    expect(replenishment.counterpartAccountId).toBe(1120);
    const plain = normalizeCashDrawerMovementRequestPayload({ shiftId: '7', type: 'cash_in', amount: 20, note: 'in' });
    expect(plain.counterpartAccountId).toBeUndefined();
  });

  it('fingerprints differ when only the counterpart differs', () => {
    const a = normalizeCashDrawerMovementRequestPayload({
      shiftId: '7', type: 'safe_drop', amount: 50, note: 'drop', counterpartAccountId: 1120,
    });
    const b = normalizeCashDrawerMovementRequestPayload({
      shiftId: '7', type: 'safe_drop', amount: 50, note: 'drop', counterpartAccountId: 1130,
    });
    expect(cashDrawerMovementRequestFingerprint(a)).not.toBe(cashDrawerMovementRequestFingerprint(b));
    const aAgain = normalizeCashDrawerMovementRequestPayload({
      shiftId: '7', type: 'safe_drop', amount: 50, note: 'drop', counterpartAccountId: '1120',
    });
    expect(cashDrawerMovementRequestFingerprint(a)).toBe(cashDrawerMovementRequestFingerprint(aAgain));
  });

  it('throws when only the counterpart changes while an attempt is unresolved', () => {
    const first = acquireCashDrawerMovementRequestAttempt(
      null,
      normalizeCashDrawerMovementRequestPayload({
        shiftId: '7', type: 'safe_drop', amount: 50, note: 'drop', counterpartAccountId: 1120,
      }),
      () => '123e4567-e89b-12d3-a456-426614174000',
    );
    expect(() =>
      acquireCashDrawerMovementRequestAttempt(
        first,
        normalizeCashDrawerMovementRequestPayload({
          shiftId: '7', type: 'safe_drop', amount: 50, note: 'drop', counterpartAccountId: 1130,
        }),
      ),
    ).toThrow();
    expect(
      acquireCashDrawerMovementRequestAttempt(
        first,
        normalizeCashDrawerMovementRequestPayload({
          shiftId: '7', type: 'safe_drop', amount: 50, note: 'drop', counterpartAccountId: 1120,
        }),
      ),
    ).toBe(first);
  });
});
