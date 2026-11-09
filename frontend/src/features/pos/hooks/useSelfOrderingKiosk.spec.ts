/* R-B1 + R-B2 + R-B4 (INV-REST-KIOSK-NO-FICTION): the kiosk used to invent
 * state in three places — a failed createOrder still showed a confirmation
 * with a random K-XXXX ticket and the caller's paymentStatus (B1); the QR
 * modal's green button claimed paymentStatus 'paid' with zero verification
 * (B2); and an unknown/missing store slug silently fell back to the
 * 'almhnds' menu, then 'default', then the POS catalog (B4). These tests
 * drive the three pure decisions that replace that fiction: a confirmation
 * exists only on a real server order number; 'pending' is a third, honest
 * ticket state that never reads as paid; and a slug resolves from the
 * caller's candidates only, with no default.
 *
 * R3-B (INV-REST-KIOSK-ORDER-TRUTH): the confirmation total is the
 * SERVER's recorded total (totalAmount), never the kiosk's raw sum; the
 * order carries a real customer phone (the page never collected one — the
 * hook substituted the fake '01000000000' for every order) or no phone at
 * all; a retried finalize reuses one idempotency key per attempt; and a
 * closed-shift refusal is shown verbatim instead of the generic error.
 *
 * Base note: these helpers did not exist at base, so there is no meaningful
 * "fails at base" run for them — the base behaviour is proven by reading the
 * old code (catch block identical to success; QR button passing 'paid';
 * hook default 'almhnds' + fallback chain), not by a failing import. The
 * R3-B base behaviour is likewise proven by reading: the old finalize
 * passed `total: totalCartAmount`, the hook hard-coded the fake phone, and
 * no idempotency key was ever sent. */

import { describe, expect, it } from 'vitest';
import {
  resolveKioskSlug,
  resolveKioskFinalizeOutcome,
  kioskConfirmationCopy,
  resolveKioskCustomerPhone,
  isValidKioskCustomerPhone,
  newKioskIdempotencyKey,
  buildKioskOrderPayload,
  resolveKioskOrderErrorMessage,
} from '@/features/pos/hooks/useSelfOrderingKiosk';

/** The spec's fake translator: returns the Arabic fallback verbatim. */
const t = (_key: string, fallback: string) => fallback;

const items = [
  { productId: 1, name: 'وجبة مشويات', price: 100, qty: 2 },
  { productId: 2, name: 'عصير', price: 25, qty: 1 },
];

type FinalizeInput = Parameters<typeof resolveKioskFinalizeOutcome>[0];

function finalizeInput(overrides: Partial<FinalizeInput> = {}): FinalizeInput {
  return {
    failed: false,
    serverOrderNumber: 'ON-20261109-0007',
    serverTotal: 225,
    diningModeLabel: 'تناول بالصالة',
    tableNumber: '12',
    items,
    placedAt: '11:30 ص',
    paymentStatus: 'unpaid',
    paymentMethodLabel: 'غير مدفوع - سداد عند الكاونتر',
    ...overrides,
  };
}

describe('resolveKioskSlug (R-B4)', () => {
  it('returns the first non-empty candidate: route beats query beats tenant', () => {
    expect(resolveKioskSlug(['almhnds', 'zs', 'other'])).toBe('almhnds');
    expect(resolveKioskSlug([undefined, 'zs', 'other'])).toBe('zs');
    expect(resolveKioskSlug([null, '', 'other'])).toBe('other');
  });

  it('trims whitespace and lowercases the slug', () => {
    expect(resolveKioskSlug(['  AlMHNDS  '])).toBe('almhnds');
  });

  it('returns null when every candidate is empty — there is no default slug', () => {
    expect(resolveKioskSlug([])).toBeNull();
    expect(resolveKioskSlug([undefined, null, '', '   '])).toBeNull();
  });

  it('never invents almhnds: no candidate means null, not the restaurant menu', () => {
    expect(resolveKioskSlug([undefined])).toBeNull();
    expect(resolveKioskSlug([''])).toBeNull();
  });

  it('still honours an explicitly chosen slug, including almhnds', () => {
    expect(resolveKioskSlug(['almhnds'])).toBe('almhnds');
    expect(resolveKioskSlug(['zs'])).toBe('zs');
  });
});

describe('resolveKioskFinalizeOutcome (R-B1)', () => {
  it('confirms with exactly the server order number — never an invented ticket', () => {
    const outcome = resolveKioskFinalizeOutcome(finalizeInput());
    expect(outcome.status).toBe('confirmed');
    if (outcome.status !== 'confirmed') throw new Error('expected confirmed');
    expect(outcome.confirmation.orderNumber).toBe('ON-20261109-0007');
    expect(outcome.confirmation.orderNumber).not.toMatch(/^K-\d+$/);
    expect(outcome.confirmation.total).toBe(225);
    expect(outcome.confirmation.items).toEqual(items);
    expect(outcome.confirmation.tableNumber).toBe('12');
  });

  it('shows the SERVER total, even when it differs from the kiosk raw sum', () => {
    // The cart sums to 225 (2x100 + 25) but the server repriced with an
    // offer to 160: the ticket must show 160, the recorded total.
    const outcome = resolveKioskFinalizeOutcome(finalizeInput({ serverTotal: 160 }));
    expect(outcome.status).toBe('confirmed');
    if (outcome.status !== 'confirmed') throw new Error('expected confirmed');
    expect(outcome.confirmation.total).toBe(160);
  });

  it('fails when the server answers without a total — no confirmation on a number alone', () => {
    for (const serverTotal of [undefined, null, NaN]) {
      const outcome = resolveKioskFinalizeOutcome(finalizeInput({ serverTotal }));
      expect(outcome.status).toBe('failed');
      expect(outcome).not.toHaveProperty('confirmation');
    }
  });

  it('fails when the server answers without an order number — no fallback ticket', () => {
    for (const serverOrderNumber of [undefined, '', '   ', null]) {
      const outcome = resolveKioskFinalizeOutcome(finalizeInput({ serverOrderNumber }));
      expect(outcome.status).toBe('failed');
      expect(outcome).not.toHaveProperty('confirmation');
    }
  });

  it('fails when the request itself failed — no confirmation and no carried-over paid', () => {
    const outcome = resolveKioskFinalizeOutcome(
      finalizeInput({ failed: true, serverOrderNumber: 'ON-20261109-0007', paymentStatus: 'paid' }),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome).not.toHaveProperty('confirmation');
  });

  it('carries the caller payment status through unchanged — it invents nothing', () => {
    const pending = resolveKioskFinalizeOutcome(
      finalizeInput({ paymentStatus: 'pending', paymentMethodLabel: 'تحويل QR — بانتظار تأكيد الكاشير' }),
    );
    expect(pending.status).toBe('confirmed');
    if (pending.status !== 'confirmed') throw new Error('expected confirmed');
    expect(pending.confirmation.paymentStatus).toBe('pending');
    expect(pending.confirmation.paymentMethodLabel).toBe('تحويل QR — بانتظار تأكيد الكاشير');

    const paid = resolveKioskFinalizeOutcome(
      finalizeInput({ paymentStatus: 'paid', paymentMethodLabel: 'مدفوع بالبطاقة (ماكينة الكشك)', authCode: 'A1', rrn: 'R1' }),
    );
    expect(paid.status).toBe('confirmed');
    if (paid.status !== 'confirmed') throw new Error('expected confirmed');
    expect(paid.confirmation.paymentStatus).toBe('paid');
    expect(paid.confirmation.authCode).toBe('A1');
    expect(paid.confirmation.rrn).toBe('R1');
  });
});

describe('kioskConfirmationCopy (R-B2)', () => {
  it('paid ticket says paid, in full', () => {
    const copy = kioskConfirmationCopy('paid', { totalText: '225', paymentMethodLabel: 'مدفوع بالبطاقة (ماكينة الكشك)' }, t);
    expect(copy.tone).toBe('paid');
    expect(copy.heroTitle).toBe('تم استلام ودفع طلبك بنجاح!');
    expect(copy.badgeText).toContain('مدفوع بالكامل');
    expect(copy.badgeText).toContain('مدفوع بالبطاقة (ماكينة الكشك)');
    expect(copy.receiptTitle).toContain('PAID');
    expect(copy.printLabel).toBe('طباعة إيصال الطلب والنداء');
  });

  it('unpaid ticket says unpaid and points at the cashier', () => {
    const copy = kioskConfirmationCopy('unpaid', { totalText: '225', paymentMethodLabel: 'غير مدفوع - سداد عند الكاونتر' }, t);
    expect(copy.tone).toBe('unpaid');
    expect(copy.heroTitle).toBe('تم تسجيل طلبك بنجاح!');
    expect(copy.badgeText).toBe('تذكرة غير مدفوعة • يلزم السداد لدى الكاشير');
    expect(copy.receiptTitle).toContain('UNPAID');
    expect(copy.receiptFooter).toContain('لدى الكاشير');
  });

  it('pending ticket says the transfer awaits verification — never paid', () => {
    const copy = kioskConfirmationCopy(
      'pending',
      { totalText: '225', paymentMethodLabel: 'تحويل QR — بانتظار تأكيد الكاشير' },
      t,
    );
    expect(copy.tone).toBe('pending');
    expect(copy.heroTitle).toContain('قيد التأكيد');
    expect(copy.heroNote).toContain('225');
    expect(copy.heroNote).toContain('للكاشير للتأكد من وصول التحويل');
    expect(copy.badgeText).toBe('بانتظار تأكيد التحويل • اعرض التذكرة للكاشير');
    expect(copy.receiptTitle).toContain('PENDING');
    expect(copy.receiptBody).toContain('للكاشير للتأكد من وصول التحويل');
    expect(copy.printLabel).toBe('طباعة تذكرة بانتظار التأكيد');
    expect(copy.receiptFooter).toContain('قيد التأكيد');
  });

  it('pending copy never claims paid and never asks for a second payment', () => {
    const copy = kioskConfirmationCopy(
      'pending',
      { totalText: '225', paymentMethodLabel: 'تحويل QR — بانتظار تأكيد الكاشير' },
      t,
    );
    for (const text of [copy.heroTitle, copy.heroNote, copy.badgeText, copy.receiptTitle, copy.receiptBody, copy.receiptFooter]) {
      expect(text).not.toContain('مدفوع بالكامل');
      expect(text).not.toContain('PAID');
      expect(text).not.toContain('يلزم السداد');
    }
    expect(copy.badgeText).not.toContain('غير مدفوعة');
  });
});

describe('resolveKioskCustomerPhone (R-I56)', () => {
  it('passes a typed phone through trimmed', () => {
    expect(resolveKioskCustomerPhone('  01012345678 ')).toBe('01012345678');
    expect(resolveKioskCustomerPhone('+201012345678')).toBe('+201012345678');
  });

  it('never invents a phone: empty or missing input means no phone at all', () => {
    expect(resolveKioskCustomerPhone('')).toBeUndefined();
    expect(resolveKioskCustomerPhone('   ')).toBeUndefined();
    expect(resolveKioskCustomerPhone(undefined)).toBeUndefined();
    expect(resolveKioskCustomerPhone(null)).toBeUndefined();
    // The old fallback was '01000000000' — it must never come back.
    for (const input of ['', '   ', undefined, null]) {
      expect(resolveKioskCustomerPhone(input)).not.toBe('01000000000');
    }
  });
});

describe('isValidKioskCustomerPhone (R-I56)', () => {
  it('accepts a real Egyptian mobile (010/011/012/015, 11 digits)', () => {
    for (const phone of ['01012345678', '01112345678', '01212345678', '01512345678']) {
      expect(isValidKioskCustomerPhone(phone)).toBe(true);
    }
  });

  it('accepts a non-Egyptian number of 7–16 digits', () => {
    expect(isValidKioskCustomerPhone('966501234567')).toBe(true);
    expect(isValidKioskCustomerPhone('1234567')).toBe(true);
  });

  it('rejects too-short, too-long and wrong-prefix numbers', () => {
    expect(isValidKioskCustomerPhone('')).toBe(false);
    expect(isValidKioskCustomerPhone('123456')).toBe(false);
    expect(isValidKioskCustomerPhone('01012345678901234')).toBe(false);
    expect(isValidKioskCustomerPhone('01912345678')).toBe(false);
    expect(isValidKioskCustomerPhone('0101234567')).toBe(false);
  });

  it('the fake 01000000000 is format-valid — that is why the fix removes the fallback, not the format', () => {
    // The server's own rule accepts it too; the no-fake guarantee lives
    // in resolveKioskCustomerPhone / buildKioskOrderPayload, not here.
    expect(isValidKioskCustomerPhone('01000000000')).toBe(true);
  });
});

describe('newKioskIdempotencyKey (idempotency)', () => {
  it('generates a kiosk-prefixed key, different on every call, inside the 128-char DTO limit', () => {
    const first = newKioskIdempotencyKey();
    const second = newKioskIdempotencyKey();
    expect(first).toMatch(/^kiosk-/);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(second).not.toBe(first);
  });
});

describe('buildKioskOrderPayload (R-I56 + idempotency)', () => {
  const basePayload = {
    customerName: 'عميل اختبار',
    orderType: 'takeaway',
    items: [{ productId: 101, qty: 2 }],
    paymentMethod: 'cash',
  };

  it('sends no phone when none was typed — never the fake fallback', () => {
    const payload = buildKioskOrderPayload(basePayload, 'almhnds');
    expect(payload.customerPhone).toBeUndefined();
    expect(payload.customerPhone).not.toBe('01000000000');
  });

  it('passes a typed phone through unchanged', () => {
    const payload = buildKioskOrderPayload({ ...basePayload, customerPhone: ' 01012345678 ' }, 'almhnds');
    expect(payload.customerPhone).toBe('01012345678');
  });

  it('maps takeaway to delivery + pickup, dine-in to dine_in + table', () => {
    const takeaway = buildKioskOrderPayload(basePayload, 'almhnds');
    expect(takeaway.orderType).toBe('delivery');
    expect(takeaway.fulfillmentType).toBe('pickup');

    const dineIn = buildKioskOrderPayload(
      { ...basePayload, orderType: 'dine_in', tableNumber: '5' },
      'almhnds',
    );
    expect(dineIn.orderType).toBe('dine_in');
    expect(dineIn.fulfillmentType).toBe('dine_in');
    expect(dineIn.tableNumber).toBe('5');
  });

  it('forwards the idempotency key when the caller holds one, omits it otherwise', () => {
    const withKey = buildKioskOrderPayload({ ...basePayload, idempotencyKey: 'kiosk-abc' }, 'almhnds');
    expect(withKey.idempotencyKey).toBe('kiosk-abc');
    const withoutKey = buildKioskOrderPayload(basePayload, 'almhnds');
    expect(withoutKey.idempotencyKey).toBeUndefined();
  });

  it('throws on an unknown slug instead of posting to a fallback store', () => {
    expect(() => buildKioskOrderPayload(basePayload, null)).toThrow('غير مرتبط بمتجر معروف');
    expect(() => buildKioskOrderPayload(basePayload, '')).toThrow('غير مرتبط بمتجر معروف');
  });
});

describe('resolveKioskOrderErrorMessage (R-I56 shift gate)', () => {
  it('shows the closed-shift refusal verbatim — retrying will not help', () => {
    const message = 'لا توجد وردية مفتوحة حالياً — لا يمكن استقبال طلبات جديدة';
    expect(resolveKioskOrderErrorMessage(new Error(message))).toBe(message);
  });

  it('keeps the generic visible error for anything else', () => {
    const generic = 'تعذّر إرسال الطلب إلى النظام. تحقق من الاتصال وحاول مرة أخرى.';
    expect(resolveKioskOrderErrorMessage(new Error('تعذر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.'))).toBe(generic);
    expect(resolveKioskOrderErrorMessage(new Error('Network Error'))).toBe(generic);
    expect(resolveKioskOrderErrorMessage(undefined)).toBe(generic);
    expect(resolveKioskOrderErrorMessage('some string')).toBe(generic);
  });
});
