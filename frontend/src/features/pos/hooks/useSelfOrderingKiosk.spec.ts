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
 * T1 (INV-REST-KIOSK-ERROR-TRUTH): the live trial proved the old
 * verbatim rule was too narrow — only the shift refusal passed through,
 * so a real business refusal (not entitled / pickup disabled / product
 * unavailable / out of stock) looked like a network failure. The
 * resolveKioskOrderErrorMessage cases below now pin the new truth: a
 * 400/422 ApiError with a real message is shown verbatim, and the
 * generic error is kept ONLY for genuine network/timeout/unknown
 * errors. The shift-gate verbatim case stays as-is.
 *
 * Base note: these helpers did not exist at base, so there is no meaningful
 * "fails at base" run for them — the base behaviour is proven by reading the
 * old code (catch block identical to success; QR button passing 'paid';
 * hook default 'almhnds' + fallback chain), not by a failing import. The
 * R3-B base behaviour is likewise proven by reading: the old finalize
 * passed `total: totalCartAmount`, the hook hard-coded the fake phone, and
 * no idempotency key was ever sent. */

import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/http';
import {
  resolveKioskSlug,
  resolveKioskFinalizeOutcome,
  kioskConfirmationCopy,
  resolveKioskCustomerPhone,
  isValidKioskCustomerPhone,
  newKioskIdempotencyKey,
  buildKioskOrderPayload,
  resolveKioskOrderErrorMessage,
  kioskCartLineKey,
  kioskCartLineUnitPrice,
  kioskCartTotal,
  addKioskCartLine,
  updateKioskCartLineModifiers,
  validateKioskModifierSelection,
  buildGroupModifierSelection,
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

describe('resolveKioskOrderErrorMessage (R-I56 shift gate + T1 business-refusal truth)', () => {
  const generic = 'تعذّر إرسال الطلب إلى النظام. تحقق من الاتصال وحاول مرة أخرى.';

  it('shows the closed-shift refusal verbatim — retrying will not help', () => {
    const message = 'لا توجد وردية مفتوحة حالياً — لا يمكن استقبال طلبات جديدة';
    expect(resolveKioskOrderErrorMessage(new Error(message))).toBe(message);
  });

  it('shows a 400 business refusal verbatim — the server reason, not a network failure', () => {
    // The live trial proved the cost: the entitlement refusal looked like
    // a connection failure because every non-shift message became generic.
    const refusals = [
      'المتجر الإلكتروني غير مفعّل لهذه المنشأة أو غير مشمول في باقتها، ولا يمكن استقبال طلبات جديدة',
      'خدمة الاستلام الذاتي من الفرع غير مفعلة لهذا المتجر',
      'المنتج غير متاح حالياً',
      'الكمية المطلوبة غير متوفرة في المخزون',
    ];
    for (const message of refusals) {
      expect(resolveKioskOrderErrorMessage(new ApiError(message, 400))).toBe(message);
    }
  });

  it('shows a 422 business refusal verbatim (modifier contract / validation)', () => {
    const message = 'اختيار المجموعة "الصوص" غير صحيح — راجع اختياراتك';
    expect(resolveKioskOrderErrorMessage(new ApiError(message, 422))).toBe(message);
  });

  it('keeps the generic error for genuine network / timeout / unknown errors only', () => {
    expect(
      resolveKioskOrderErrorMessage(
        new ApiError('تعذر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.', 0, { code: 'network_error' }),
      ),
    ).toBe(generic);
    expect(
      resolveKioskOrderErrorMessage(new ApiError('انتهت مهلة الطلب. حاول مرة أخرى.', 408, { code: 'timeout' })),
    ).toBe(generic);
    expect(resolveKioskOrderErrorMessage(new Error('Network Error'))).toBe(generic);
    expect(resolveKioskOrderErrorMessage(new Error('تعذر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.'))).toBe(generic);
    expect(resolveKioskOrderErrorMessage(undefined)).toBe(generic);
    expect(resolveKioskOrderErrorMessage('some string')).toBe(generic);
  });

  it('keeps the generic error when the server sent no usable message, or the failure is not a business refusal', () => {
    expect(resolveKioskOrderErrorMessage(new ApiError('', 400))).toBe(generic);
    expect(resolveKioskOrderErrorMessage(new ApiError('تعذر تنفيذ العملية المطلوبة.', 400))).toBe(generic);
    expect(resolveKioskOrderErrorMessage(new ApiError('حدث خطأ غير متوقع في الخادم.', 500))).toBe(generic);
    expect(resolveKioskOrderErrorMessage(new ApiError('غير مصرح لك بالوصول.', 401))).toBe(generic);
  });
});

/*
 * R7-B2 (INV-REST-KIOSK-MODIFIER-UI): the kiosk cart used to merge by
 * productId only and the payload builder dropped modifiers by
 * construction, so two different extras of one product collapsed into
 * one line and no modifier ever reached the server. These tests drive
 * the pure cart model that replaces it: line identity is product +
 * sorted option ids, totals include the picked extras, the payload
 * maps modifiers, and the client-side group rules mirror the server's
 * R4-C contract (mandatory / min / max / single-select).
 *
 * Base note: at base none of these helpers existed — the cart had no
 * modifiers field and buildKioskOrderPayload mapped items to
 * { productId, quantity, notes } only — so every test below fails at
 * base by a missing import, which is the honest red proof. */

const sauceGroup: any = {
  id: 10,
  name: 'الصوص',
  nameEn: 'Sauce',
  selectionType: 'single',
  isMandatory: true,
  minSelections: 1,
  maxSelections: 1,
  displayOrder: 0,
  isActive: true,
  options: [
    { id: 201, groupId: 10, name: 'صوص حار', nameEn: 'Spicy', price: 0, componentProductId: null },
    { id: 202, groupId: 10, name: 'صوص جبنة', nameEn: 'Cheese sauce', price: 10, componentProductId: null },
  ],
};

const extrasGroup: any = {
  id: 11,
  name: 'إضافات',
  nameEn: 'Extras',
  selectionType: 'multiple',
  isMandatory: false,
  minSelections: 2,
  maxSelections: 2,
  displayOrder: 1,
  isActive: true,
  options: [
    { id: 211, groupId: 11, name: 'جبنة إضافية', nameEn: 'Extra cheese', price: 20, componentProductId: null },
    { id: 212, groupId: 11, name: 'بيض', nameEn: 'Egg', price: 15, componentProductId: null },
    { id: 213, groupId: 11, name: 'مشروم', nameEn: 'Mushroom', price: 12, componentProductId: null },
  ],
};

const spicySauce = buildGroupModifierSelection(sauceGroup, sauceGroup.options[0]);
const cheeseSauce = buildGroupModifierSelection(sauceGroup, sauceGroup.options[1]);
const extraCheese = buildGroupModifierSelection(extrasGroup, extrasGroup.options[0]);
const egg = buildGroupModifierSelection(extrasGroup, extrasGroup.options[1]);

describe('kioskCartLineKey (R7-B2)', () => {
  it('the same product with different options is a different line', () => {
    expect(kioskCartLineKey(5, [spicySauce])).not.toBe(kioskCartLineKey(5, [cheeseSauce]));
    expect(kioskCartLineKey(5, [spicySauce])).not.toBe(kioskCartLineKey(5, undefined));
  });

  it('the same pick in a different tap order is the same line', () => {
    expect(kioskCartLineKey(5, [extraCheese, egg])).toBe(kioskCartLineKey(5, [egg, extraCheese]));
  });

  it('an option qty is part of the identity: cheese x1 and cheese x2 stay separate', () => {
    expect(kioskCartLineKey(5, [extraCheese])).not.toBe(
      kioskCartLineKey(5, [{ ...extraCheese, qty: 2 }]),
    );
  });
});

describe('addKioskCartLine (R7-B2)', () => {
  const burger = (modifiers: any[] | undefined, qty = 1) => ({
    productId: 5,
    name: 'برجر',
    price: 100,
    qty,
    modifiers,
    lineKey: kioskCartLineKey(5, modifiers),
  });

  it('merges a second add of the SAME product + SAME options into qty + 1', () => {
    const cart = addKioskCartLine([burger([spicySauce])], burger([spicySauce]));
    expect(cart).toHaveLength(1);
    expect(cart[0].qty).toBe(2);
  });

  it('keeps the same product with DIFFERENT options as separate lines', () => {
    const cart = addKioskCartLine([burger([spicySauce])], burger([cheeseSauce]));
    expect(cart).toHaveLength(2);
    expect(cart.map((line) => line.modifiers?.[0].name)).toEqual(['صوص حار', 'صوص جبنة']);
  });

  it('keeps a plain line and a modified line of the same product separate', () => {
    const cart = addKioskCartLine([burger(undefined)], burger([spicySauce]));
    expect(cart).toHaveLength(2);
  });
});

describe('kioskCartTotal (R7-B2)', () => {
  it('a line total is qty x (base + modifiers), with a modifier qty multiplied', () => {
    const line = {
      productId: 5,
      price: 100,
      qty: 2,
      modifiers: [{ ...extraCheese, qty: 2 }],
    };
    // Per unit: 100 + 20x2 = 140; two units = 280.
    expect(kioskCartLineUnitPrice(line)).toBe(140);
    expect(kioskCartTotal([line])).toBe(280);
  });

  it('the cart total sums plain and modified lines together', () => {
    const cart = [
      { productId: 5, price: 100, qty: 1, modifiers: [cheeseSauce] },
      { productId: 6, price: 25, qty: 1, modifiers: undefined },
    ];
    // (100 + 10) + 25 = 135.
    expect(kioskCartTotal(cart)).toBe(135);
  });

  it('a modifier-less cart totals exactly like the old base-only sum', () => {
    expect(kioskCartTotal([{ productId: 1, price: 100, qty: 2, modifiers: undefined }])).toBe(200);
  });
});

describe('updateKioskCartLineModifiers (R7-B2)', () => {
  const burger = (modifiers: any[] | undefined, qty = 1) => ({
    productId: 5,
    name: 'برجر',
    price: 100,
    qty,
    modifiers,
    lineKey: kioskCartLineKey(5, modifiers),
  });

  it('rewrites one line picks and keeps the other lines untouched', () => {
    const cart = [burger([spicySauce]), burger([cheeseSauce])];
    const next = updateKioskCartLineModifiers(cart, kioskCartLineKey(5, [spicySauce]), [cheeseSauce, extraCheese]);
    expect(next).toHaveLength(2);
    expect(next[0].modifiers?.map((m) => m.name)).toEqual(['صوص جبنة', 'جبنة إضافية']);
    expect(next[1].modifiers?.map((m) => m.name)).toEqual(['صوص جبنة']);
  });

  it('merges into the twin line when the edit collides with another line', () => {
    const cart = [burger([spicySauce], 1), burger([cheeseSauce], 2)];
    const next = updateKioskCartLineModifiers(cart, kioskCartLineKey(5, [spicySauce]), [cheeseSauce]);
    expect(next).toHaveLength(1);
    expect(next[0].qty).toBe(3);
    expect(next[0].modifiers?.map((m) => m.name)).toEqual(['صوص جبنة']);
  });

  it('leaves the cart untouched for an unknown line key', () => {
    const cart = [burger([spicySauce])];
    expect(updateKioskCartLineModifiers(cart, '999|', [cheeseSauce])).toEqual(cart);
  });
});

describe('validateKioskModifierSelection (R7-B2)', () => {
  it('a missing mandatory group is named in the error', () => {
    const error = validateKioskModifierSelection([sauceGroup, extrasGroup], []);
    expect(error).toContain('الصوص');
    expect(error).toContain('إلزامية');
  });

  it('a satisfied mandatory group passes, and an optional group may be skipped', () => {
    expect(validateKioskModifierSelection([sauceGroup, extrasGroup], [spicySauce])).toBeNull();
  });

  it('an optional group picked below its min fails — the min binds once picked', () => {
    // extrasGroup min is 2: one pick is not enough.
    const error = validateKioskModifierSelection([extrasGroup], [extraCheese]);
    expect(error).toContain('2');
    expect(error).toContain('إضافات');
    expect(validateKioskModifierSelection([extrasGroup], [extraCheese, egg])).toBeNull();
  });

  it('an option qty never counts as extra picks: one option x2 is still one pick', () => {
    const error = validateKioskModifierSelection([extrasGroup], [{ ...extraCheese, qty: 2 }]);
    expect(error).not.toBeNull();
  });

  it('a single-select group with two picks fails at the max of one', () => {
    const error = validateKioskModifierSelection([sauceGroup], [spicySauce, cheeseSauce]);
    expect(error).toContain('الصوص');
    expect(validateKioskModifierSelection([sauceGroup], [spicySauce])).toBeNull();
  });

  it('a multi group over its max fails', () => {
    const mushroom = buildGroupModifierSelection(extrasGroup, extrasGroup.options[2]);
    const error = validateKioskModifierSelection([extrasGroup], [extraCheese, egg, mushroom]);
    expect(error).toContain('إضافات');
  });
});

describe('buildKioskOrderPayload maps modifiers (R7-B2)', () => {
  const cheesePick = { ...extraCheese, qty: 2 };

  it('sends the picked modifiers on the line, with their option ids and qty', () => {
    const payload = buildKioskOrderPayload(
      {
        customerName: 'عميل اختبار',
        orderType: 'dine_in',
        tableNumber: '5',
        items: [{ productId: 5, qty: 1, modifiers: [spicySauce, cheesePick] }],
        paymentMethod: 'cash',
      },
      'almhnds',
    ) as any;
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].productId).toBe(5);
    expect(payload.items[0].quantity).toBe(1);
    expect(payload.items[0].modifiers).toHaveLength(2);
    expect(payload.items[0].modifiers[0].optionId).toBe(201);
    expect(payload.items[0].modifiers[1].optionId).toBe(211);
    expect(payload.items[0].modifiers[1].qty).toBe(2);
    expect(payload.items[0].modifiers[1].price).toBe(20);
  });

  it('omits the modifiers field entirely for a line with no picks', () => {
    const payload = buildKioskOrderPayload(
      {
        customerName: 'عميل اختبار',
        orderType: 'takeaway',
        items: [
          { productId: 5, qty: 1 },
          { productId: 6, qty: 1, modifiers: [] },
        ],
        paymentMethod: 'cash',
      },
      'almhnds',
    ) as any;
    expect(payload.items[0].modifiers).toBeUndefined();
    expect(payload.items[1].modifiers).toBeUndefined();
  });
});
