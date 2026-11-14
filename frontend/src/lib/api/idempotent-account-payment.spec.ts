/*
 * STUCK-RECEIPT deadlock (trial T24): a non-cash customer collection
 * could never succeed, and the failure deadlocked the form forever.
 *
 * THE MECHANISM, driving the REAL postIdempotentAccountPayment with a
 * mocked http layer and a real localStorage (jsdom):
 * - the helper stores its attempt BEFORE the POST, under
 *   zs:payment-attempt:{tenantId}:{accountId}:/api/customer-payments:{partnerId};
 * - on a POST error it asked the server for the status, but only a
 *   'failed' answer released the stored attempt. A 4xx thrown before
 *   any reservation answers 'not_found' — and nothing was released;
 * - worse, the body-diff check fired BEFORE the status query, so
 *   corrected data hit the stuck warning without the server ever
 *   being asked.
 *
 * THE FIX (this package):
 * - the server is asked about a stored attempt BEFORE bodies are
 *   compared: 'not_found' releases the stored attempt (nothing was
 *   ever reserved under it), 'failed' releases it and asks for
 *   corrected data, 'committed' returns the recorded receipt, and
 *   'processing' / 'recovery_required' still block;
 * - after a failed POST, 'not_found' releases the stored attempt
 *   exactly like 'failed' does, so the cashier can correct the data
 *   and resend;
 * - an UNKNOWN outcome (the status query itself fails) still keeps
 *   the stored attempt: the key is released only on a server answer,
 *   never on a network error.
 *
 * WHAT THIS PINS:
 * - a fresh POST success retires the key;
 * - a POST 400 + status 'not_found' rethrows AND releases the key,
 *   and the corrected resend then succeeds with a fresh key;
 * - a POST 400 + status 'failed' rethrows AND releases the key;
 * - a POST 400 + an unreachable status endpoint rethrows AND keeps
 *   the key (unknown outcome is never released);
 * - a stored attempt with corrected data + status 'not_found'
 *   resends instead of throwing the stuck warning;
 * - a stored attempt with corrected data + status 'processing'
 *   still blocks and never POSTs;
 * - a stored attempt + status 'committed' returns the recorded
 *   receipt without POSTing;
 * - a stored attempt + status 'failed' releases the key and asks
 *   for corrected data without POSTing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postIdempotentAccountPayment } from './idempotent-account-payment';

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      tenant: { id: 't1', accountId: 'a1' },
      user: { tenantId: 't1', accountId: 'a1' },
    }),
  },
}));

const KEY = 'zs:payment-attempt:t1:a1:/api/customer-payments:7';
const RECEIPT = { customerId: 7, amount: 200, paymentChannel: 'instapay', transferReference: 'TRX-987654' };
const CORRECTED = { customerId: 7, amount: 200, paymentChannel: 'instapay', transferReference: 'TRX-111222' };

let uuidCounter = 0;

function storeAttempt(body: unknown, key = 'old-key-1'): void {
  localStorage.setItem(KEY, JSON.stringify({ body: JSON.stringify(body), key }));
}

function postCalls(): Array<{ path: string; init: unknown }> {
  return httpMock.mock.calls
    .filter(([path]: [string]) => path === '/api/customer-payments')
    .map(([path, init]: [string, unknown]) => ({ path, init }));
}

function statusCalls(): string[] {
  return httpMock.mock.calls
    .filter(([path]: [string]) => String(path).includes('/status'))
    .map(([path]: [string]) => String(path));
}

beforeEach(() => {
  httpMock.mockReset();
  localStorage.clear();
  uuidCounter = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `fresh-uuid-${(uuidCounter += 1)}`,
  });
});

describe('postIdempotentAccountPayment — stuck-receipt release', () => {
  it('a fresh POST success retires the stored key', async () => {
    httpMock.mockResolvedValueOnce({ ok: true, id: 5 });
    const result = await postIdempotentAccountPayment('/api/customer-payments', RECEIPT);
    expect(result).toEqual({ ok: true, id: 5 });
    expect(postCalls()).toHaveLength(1);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a POST 400 + status not_found rethrows AND releases the key, and the corrected resend succeeds', async () => {
    httpMock
      .mockRejectedValueOnce(new Error('NONCASH_RECEIPT_REFERENCE_REQUIRED'))
      .mockResolvedValueOnce({ status: 'not_found' })
      .mockResolvedValueOnce({ ok: true, id: 6 });
    await expect(
      postIdempotentAccountPayment('/api/customer-payments', { customerId: 7, amount: 200, paymentChannel: 'instapay' }),
    ).rejects.toThrow('NONCASH_RECEIPT_REFERENCE_REQUIRED');
    // The deadlocked attempt is gone: nothing reserved, safe to resend.
    expect(localStorage.getItem(KEY)).toBeNull();
    const result = await postIdempotentAccountPayment('/api/customer-payments', CORRECTED);
    expect(result).toEqual({ ok: true, id: 6 });
    expect(postCalls()).toHaveLength(2);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a POST 400 + status failed rethrows AND releases the key', async () => {
    httpMock
      .mockRejectedValueOnce(new Error('NONCASH_RECEIPT_REFERENCE_REQUIRED'))
      .mockResolvedValueOnce({ status: 'failed' });
    await expect(
      postIdempotentAccountPayment('/api/customer-payments', { customerId: 7, amount: 200, paymentChannel: 'instapay' }),
    ).rejects.toThrow('NONCASH_RECEIPT_REFERENCE_REQUIRED');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a POST 400 + an unreachable status endpoint rethrows AND keeps the key', async () => {
    httpMock
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'));
    await expect(
      postIdempotentAccountPayment('/api/customer-payments', RECEIPT),
    ).rejects.toThrow('timeout');
    const stored = localStorage.getItem(KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string).body).toBe(JSON.stringify(RECEIPT));
  });

  it('a stored attempt with corrected data + status not_found resends instead of warning', async () => {
    storeAttempt({ customerId: 7, amount: 200, paymentChannel: 'instapay' });
    httpMock
      .mockResolvedValueOnce({ status: 'not_found' })
      .mockResolvedValueOnce({ ok: true, id: 7 });
    const result = await postIdempotentAccountPayment('/api/customer-payments', CORRECTED);
    expect(result).toEqual({ ok: true, id: 7 });
    expect(statusCalls()).toHaveLength(1);
    expect(postCalls()).toHaveLength(1);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a stored attempt with corrected data + status processing still blocks and never POSTs', async () => {
    storeAttempt({ customerId: 7, amount: 200, paymentChannel: 'instapay' });
    httpMock.mockResolvedValueOnce({ status: 'processing' });
    await expect(
      postIdempotentAccountPayment('/api/customer-payments', CORRECTED),
    ).rejects.toThrow('غير محسومة');
    expect(postCalls()).toHaveLength(0);
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it('a stored attempt + status committed returns the recorded receipt without POSTing', async () => {
    storeAttempt(RECEIPT);
    httpMock.mockResolvedValueOnce({ status: 'committed', response: { id: 9, docNo: 'ZCR-1' } });
    const result = await postIdempotentAccountPayment('/api/customer-payments', RECEIPT);
    expect(result).toEqual({ ok: true, id: 9, docNo: 'ZCR-1' });
    expect(postCalls()).toHaveLength(0);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a stored attempt + status failed releases the key and asks for corrected data without POSTing', async () => {
    storeAttempt(RECEIPT);
    httpMock.mockResolvedValueOnce({ status: 'failed' });
    await expect(
      postIdempotentAccountPayment('/api/customer-payments', RECEIPT),
    ).rejects.toThrow('فشل السند السابق');
    expect(postCalls()).toHaveLength(0);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
