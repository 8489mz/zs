/* Pins INV-TREASURY-EXPENSE-REQUEST-KEY-FRONTEND: the expense form sends a
   stable per-submission requestKey. An identical payload reuses the key, a
   changed payload while the attempt is unresolved throws before any HTTP
   call, and only a known client rejection releases the attempt. */

import { describe, expect, it } from 'vitest';
import {
  acquireExpenseRequestAttempt,
  createExpenseRequestKey,
  expenseRequestFingerprint,
  mayReleaseExpenseRequestAttempt,
  normalizeExpenseRequestPayload,
} from './expense-request-key';

const FORM = {
  title: 'Rent',
  amount: '10',
  note: 'Office',
  date: '2026-11-01T10:00:00.000Z',
  branchId: '3',
  locationId: '',
  costCenterId: '7',
};

describe('expense request key', () => {
  it('generates a key inside the backend 8-160 range and rejects invalid generated keys', () => {
    expect(createExpenseRequestKey(() => 'stable-key-1')).toBe('stable-key-1');
    expect(createExpenseRequestKey(() => '123e4567-e89b-12d3-a456-426614174000')).toHaveLength(36);
    expect(() => createExpenseRequestKey(() => 'short')).toThrow();
    expect(() => createExpenseRequestKey(() => '   ')).toThrow();
    expect(() => createExpenseRequestKey(() => 'k'.repeat(161))).toThrow();
  });

  it('normalizes the form payload exactly as the mutation sends it today', () => {
    expect(normalizeExpenseRequestPayload(FORM)).toEqual({
      title: 'Rent',
      amount: 10,
      note: 'Office',
      date: '2026-11-01T10:00:00.000Z',
      branchId: 3,
      costCenterId: 7,
    });
  });

  it('fingerprints the normalized payload, not the raw form representation', () => {
    const first = expenseRequestFingerprint(normalizeExpenseRequestPayload(FORM));
    const equivalent = expenseRequestFingerprint(
      normalizeExpenseRequestPayload({ ...FORM, amount: 10, branchId: '3' }),
    );
    expect(first).toBe(equivalent);
    expect(
      expenseRequestFingerprint(
        normalizeExpenseRequestPayload({ ...FORM, amount: '11' }),
      ),
    ).not.toBe(first);
  });

  it('reuses the key for an identical payload without calling the generator again', () => {
    let calls = 0;
    const generate = () => {
      calls += 1;
      return `generated-${calls}`;
    };
    const first = acquireExpenseRequestAttempt(
      null,
      normalizeExpenseRequestPayload(FORM),
      generate,
    );
    expect(first.requestKey).toBe('generated-1');
    const retry = acquireExpenseRequestAttempt(
      first,
      normalizeExpenseRequestPayload({ ...FORM, amount: 10 }),
      generate,
    );
    expect(retry).toBe(first);
    expect(calls).toBe(1);
  });

  it('throws before any HTTP call when the payload changes while the attempt is unresolved', () => {
    const first = acquireExpenseRequestAttempt(
      null,
      normalizeExpenseRequestPayload(FORM),
      () => 'stable-key-1',
    );
    const changed = [
      { ...FORM, title: 'Electricity' },
      { ...FORM, amount: '20' },
      { ...FORM, note: 'Other' },
      { ...FORM, date: '2026-11-02T10:00:00.000Z' },
      { ...FORM, branchId: '4' },
      { ...FORM, costCenterId: '8' },
    ];
    for (const form of changed) {
      expect(() =>
        acquireExpenseRequestAttempt(first, normalizeExpenseRequestPayload(form), () => 'new-key'),
      ).toThrow();
    }
  });

  it('releases only on known client rejections, never on unknown outcomes', () => {
    expect(mayReleaseExpenseRequestAttempt({ status: 400 })).toBe(true);
    expect(mayReleaseExpenseRequestAttempt({ status: 401 })).toBe(true);
    expect(mayReleaseExpenseRequestAttempt({ status: 409 })).toBe(true);
    expect(mayReleaseExpenseRequestAttempt({ status: 429 })).toBe(true);
    expect(mayReleaseExpenseRequestAttempt({ status: 408 })).toBe(false);
    expect(mayReleaseExpenseRequestAttempt({ status: 500 })).toBe(false);
    expect(mayReleaseExpenseRequestAttempt({ status: 502 })).toBe(false);
    expect(mayReleaseExpenseRequestAttempt({ status: 0 })).toBe(false);
    expect(mayReleaseExpenseRequestAttempt(new Error('boom'))).toBe(false);
    expect(mayReleaseExpenseRequestAttempt(undefined)).toBe(false);
  });
});
