/* R-B10 + R-B11 + R-B12 + R-I32 + R-I33 (INV-REST-SPLIT-REAL-TOTALS):
 * the split modal re-implemented sale creation client-side, and every
 * number it produced was wrong in a different way:
 * - B10: getBillTotal was price x qty only and handlePayBill posted
 *   discount 0, taxRate 0, no service charge/tip, paid = that reduced sum;
 *   the modal closed settled when no unpaid bill remained, with no check
 *   that paid bills sum to totalAmount.
 * - B11: a fractional part was price/qty only and carried the FULL modifier
 *   list — burger 100 + cheese 20 split in 2 posted 140 instead of 120.
 * - B12: save-as-drafts looped setCart + setTableNumber + holdDraft, but
 *   holdDraft reads render-captured snapshot params, so every draft saved
 *   the ORIGINAL full cart under the ORIGINAL table number.
 * - I32: the init effect re-ran on any cart change, and handlePayBill
 *   itself calls setCart(remainingItems) — paying one bill of three
 *   collapsed the whole split back to Bill 1 + empty Bill 2, paid flags gone.
 * - I33: handlePayGuest set paid: true BEFORE createSale, the catch never
 *   reverted it, and no backend call happened until ALL guests were paid;
 *   the final sale sent taxRate 0, deliveryFee 0, no service charge/tip
 *   and hardcoded paymentChannel 'cash' for a mixed payments array.
 *
 * The fix prices every bill from the opening order snapshot (real line
 * values qty x (price + modifiers) + the order's discount / tax / service
 * charge / tip allocated pro-rata, last bill taking remainders), refuses
 * to close settled unless the paid sum matches the order total within the
 * provable tax-rounding tolerance, splits fractions out of the full line
 * value with no modifiers on the parts, saves drafts by calling the
 * held-draft mutation directly per bill, never resets on cart change, and
 * marks a guest paid only after the final sale posts.
 *
 * Base note: the helpers are new, so there is no behavioural base run for
 * them — the old behaviour is pinned by the exact old inputs (price-only
 * 100 instead of 120, parts 50+50 carrying cheese 20). The render tests
 * pin the wiring fixes against the real modal; their red proof is the
 * failing payload / reset / phantom-paid assertions run against the
 * pre-fix modal logic (see the base-run note in the package report). */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import {
  PosSplitBillModal,
  allocateSplitBillAmounts,
  buildFractionalParts,
  isSplitPaidSumSettled,
  moveSplitBillItem,
  moveSplitBillItems,
  resolveSplitPaymentChannel,
  splitRoundingTolerance,
  type SplitOrderTotals,
} from './PosSplitBillModal';
import type { PosItem } from '@/features/pos/types/pos.types';

const DIGITS = 2;

function item(overrides: Partial<PosItem> = {}): PosItem {
  return {
    lineKey: 'L1',
    productId: '1',
    name: 'برجر',
    unitId: 'u1',
    unitName: 'قطعة',
    unitMultiplier: 1,
    price: 100,
    costPrice: 50,
    qty: 1,
    stockLimit: 0,
    currentStock: 10,
    minStock: 0,
    priceType: 'retail',
    modifiers: [],
    ...overrides,
  } as PosItem;
}

const cheese = { price: 20, qty: 1 };

function orderTotals(overrides: Partial<SplitOrderTotals> = {}): SplitOrderTotals {
  return {
    subTotal: 300,
    discountValue: 30,
    serviceCharge: 27,
    taxRate: 14,
    pricesIncludeTax: false,
    tipAmount: 10,
    deliveryFee: 0,
    total: 348.58,
    ...overrides,
  };
}

describe('allocateSplitBillAmounts (B10)', () => {
  it('charges the real line value: a modified item totals price + modifiers, not price only', () => {
    const burger = item({ modifiers: [cheese] });
    const lineTotal = calcCartLineTotal(burger);
    expect(lineTotal).toBe(120);
    const [bill] = allocateSplitBillAmounts(
      [lineTotal, 0],
      orderTotals({ subTotal: 120, discountValue: 0, serviceCharge: 0, taxRate: 0, tipAmount: 0, total: 120 }),
      DIGITS,
    );
    expect(bill.total).toBe(120);
    expect(bill.subtotal).toBe(120);
  });

  it('allocates discount, service charge, tax and tip across bills and sums exactly to the order total', () => {
    const [first, second] = allocateSplitBillAmounts([100, 200], orderTotals(), DIGITS);
    expect(first).toEqual({
      subtotal: 100,
      discount: 10,
      serviceCharge: 9,
      taxAmount: 13.86,
      tipAmount: 3.33,
      deliveryFee: 0,
      total: 116.19,
    });
    expect(second).toEqual({
      subtotal: 200,
      discount: 20,
      serviceCharge: 18,
      taxAmount: 27.72,
      tipAmount: 6.67,
      deliveryFee: 0,
      total: 232.39,
    });
    expect(first.total + second.total).toBe(348.58);
  });

  it('gives an empty bill zeros and lets the last non-empty bill take the remainders', () => {
    const amounts = allocateSplitBillAmounts([100, 0, 200], orderTotals(), DIGITS);
    expect(amounts[1].total).toBe(0);
    expect(amounts[0].total + amounts[1].total + amounts[2].total).toBe(348.58);
    expect(amounts[2].discount).toBe(20);
    expect(amounts[2].tipAmount).toBe(6.67);
  });

  it('prices tax-inclusive bills with the tax inside the total', () => {
    const [first, second] = allocateSplitBillAmounts(
      [100, 100],
      orderTotals({
        subTotal: 200,
        discountValue: 0,
        serviceCharge: 0,
        taxRate: 14,
        pricesIncludeTax: true,
        tipAmount: 0,
        total: 200,
      }),
      DIGITS,
    );
    expect(first.taxAmount).toBe(12.28);
    expect(first.total).toBe(100);
    expect(second.total).toBe(100);
    expect(first.total + second.total).toBe(200);
  });

  it('never lets a bill discount exceed its own lines', () => {
    const [first] = allocateSplitBillAmounts(
      [10, 290],
      orderTotals({ discountValue: 300 }),
      DIGITS,
    );
    expect(first.discount).toBeLessThanOrEqual(10);
  });
});

describe('buildFractionalParts (B11)', () => {
  it('splits burger 100 + cheese 20 in 2 into 60 + 60 with no modifiers on either part', () => {
    const burger = item({ modifiers: [cheese] });
    const parts = buildFractionalParts(burger, 2, DIGITS);
    expect(parts).not.toBeNull();
    expect(parts!.map((p) => p.price)).toEqual([60, 60]);
    expect(parts!.map((p) => p.qty)).toEqual([1, 1]);
    expect(parts![0].modifiers).toEqual([]);
    expect(parts![1].modifiers).toEqual([]);
    // What the backend posts per part: qty x (price + modifiers) = 60.
    expect(parts!.reduce((s, p) => s + calcCartLineTotal(p), 0)).toBe(120);
    expect(parts![0].name).toContain('حصة 1/2');
    expect(parts![1].name).toContain('حصة 2/2');
  });

  it('splits in 3 into equal shares that sum to the full line value', () => {
    const burger = item({ modifiers: [cheese] });
    const parts = buildFractionalParts(burger, 3, DIGITS);
    expect(parts!.map((p) => p.price)).toEqual([40, 40, 40]);
    expect(parts!.reduce((s, p) => s + calcCartLineTotal(p), 0)).toBe(120);
  });

  it('splits a qty-2 line out of its full value, not its price-only value', () => {
    const burgers = item({ qty: 2, modifiers: [cheese] });
    expect(calcCartLineTotal(burgers)).toBe(240);
    const parts = buildFractionalParts(burgers, 2, DIGITS);
    expect(parts!.map((p) => p.price)).toEqual([120, 120]);
  });

  it('returns null for a zero line', () => {
    expect(buildFractionalParts(item({ price: 0 }), 2, DIGITS)).toBeNull();
  });
});

describe('resolveSplitPaymentChannel (I33)', () => {
  it('returns cash / card / instapay for single-channel mixes and mixed otherwise', () => {
    expect(resolveSplitPaymentChannel(100, 0, 0)).toBe('cash');
    expect(resolveSplitPaymentChannel(0, 100, 0)).toBe('card');
    expect(resolveSplitPaymentChannel(0, 0, 100)).toBe('instapay');
    expect(resolveSplitPaymentChannel(50, 50, 0)).toBe('mixed');
    expect(resolveSplitPaymentChannel(50, 0, 50)).toBe('mixed');
    expect(resolveSplitPaymentChannel(0, 50, 50)).toBe('instapay');
    expect(resolveSplitPaymentChannel(0, 0, 0)).toBe('cash');
  });
});

describe('isSplitPaidSumSettled + splitRoundingTolerance (B10 guard)', () => {
  it('tolerates only the provable per-bill tax-rounding drift', () => {
    expect(splitRoundingTolerance(3, 2)).toBe(0.02);
    // 33.33 + 33.33 + 33.34 at 14%: per-bill taxes sum to 14.01, the order
    // tax is 14.00 — one cent of pure rounding drift, inside tolerance.
    expect(isSplitPaidSumSettled(114.01, 114.0, 3, 2)).toBe(true);
    expect(isSplitPaidSumSettled(114.0, 114.0, 3, 2)).toBe(true);
  });

  it('refuses a real shortfall', () => {
    expect(isSplitPaidSumSettled(113.0, 114.0, 3, 2)).toBe(false);
    expect(isSplitPaidSumSettled(100, 348.58, 2, 2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Render tests against the real modal.
// ---------------------------------------------------------------------------

function createMockPos(cart: PosItem[], totals: SplitOrderTotals) {
  return {
    cart,
    totals,
    settings: { currency: 'EGP' },
    settingsQuery: { data: { currency: 'EGP' } },
    customerId: '',
    discount: 0,
    tipAmount: 0,
    orderType: 'dine_in',
    tableNumber: '5',
    paymentType: 'cash',
    paymentChannel: 'cash',
    note: '',
    search: '',
    priceType: 'retail',
    branchId: '1',
    locationId: '1',
    currentBranch: null,
    currentLocation: null,
    deliveryRepId: '',
    collectionStatus: 'cod',
    guestCount: 2,
    createSale: { isPending: false, mutateAsync: vi.fn().mockResolvedValue({ id: 1 }) },
    saveHeldDraftMutation: { mutateAsync: vi.fn().mockResolvedValue({}) },
    holdDraft: vi.fn(),
    setCart: vi.fn(),
    setTableNumber: vi.fn(),
  };
}

function renderModal(mockPos: ReturnType<typeof createMockPos>) {
  const onClose = vi.fn();
  const onSplitCompleted = vi.fn();
  render(
    <MemoryRouter>
      <PosSplitBillModal open pos={mockPos as never} onClose={onClose} onSplitCompleted={onSplitCompleted} />
    </MemoryRouter>,
  );
  return { onClose, onSplitCompleted };
}

describe('PosSplitBillModal — paying a bill posts the real total (B10)', () => {
  it('posts modifiers, allocated discount, real tax rate, service charge and tip — never the price-only sum', async () => {
    const burger = item({ lineKey: 'L1', productId: '1', name: 'برجر', modifiers: [cheese] });
    const fries = item({ lineKey: 'L2', productId: '2', name: 'بطاطس', price: 50, qty: 2, modifiers: [] });
    const totals = orderTotals({
      subTotal: 220,
      discountValue: 20,
      serviceCharge: 20,
      taxRate: 14,
      tipAmount: 10,
      total: 260.8,
    });
    const mockPos = createMockPos([burger, fries], totals);
    renderModal(mockPos);

    fireEvent.click(screen.getByRole('button', { name: 'تحصيل نقد' }));

    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockPos.createSale.mutateAsync.mock.calls[0][0];
    expect(payload.cart).toHaveLength(2);
    expect(payload.cart[0].modifiers).toEqual([cheese]);
    expect(payload.discount).toBe(20);
    expect(payload.deliveryFee).toBe(0);
    expect(payload.taxRate).toBe(14);
    expect(payload.pricesIncludeTax).toBe(false);
    expect(payload.serviceCharge).toBe(20);
    expect(payload.tipAmount).toBe(10);
    expect(payload.paidAmount).toBe(260.8);
    expect(payload.tenderedAmount).toBe(260.8);
    expect(payload.expectedTotal).toBe(260.8);
    expect(payload.payments).toEqual([{ paymentChannel: 'cash', amount: 260.8 }]);
    // Settled: the workspace cart is cleared.
    expect(mockPos.setCart).toHaveBeenCalledWith([]);
    expect(mockPos.setTableNumber).toHaveBeenCalledWith('');
  });
});

describe('PosSplitBillModal — paying one bill never resets the others (I32)', () => {
  it('keeps the paid badge and the other bills after paying the middle bill of three items', async () => {
    const a = item({ lineKey: 'LA', productId: '1', name: 'صنف أ', price: 10, modifiers: [] });
    const b = item({ lineKey: 'LB', productId: '2', name: 'صنف ب', price: 10, modifiers: [] });
    const c = item({ lineKey: 'LC', productId: '3', name: 'صنف ج', price: 10, modifiers: [] });
    const totals = orderTotals({ subTotal: 30, discountValue: 0, serviceCharge: 0, taxRate: 0, tipAmount: 0, total: 30 });
    const mockPos = createMockPos([a, b, c], totals);
    const { rerender } = render(
      <MemoryRouter>
        <PosSplitBillModal open pos={mockPos as never} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    // Move item C to Bill 2 (third transfer button, in row order).
    const moveButtons = screen.getAllByTitle('نقل إلى الشيك 2');
    expect(moveButtons).toHaveLength(3);
    fireEvent.click(moveButtons[2]);
    expect(screen.getByText('صنف ج')).toBeTruthy();

    // Pay Bill 1 (cash): the first 'تحصيل نقد' button.
    fireEvent.click(screen.getAllByRole('button', { name: 'تحصيل نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockPos.createSale.mutateAsync.mock.calls[0][0];
    expect(payload.cart.map((i: PosItem) => i.name)).toEqual(['صنف أ', 'صنف ب']);
    expect(payload.paidAmount).toBe(20);
    // The modal syncs the remaining items back to the workspace cart.
    expect(mockPos.setCart).toHaveBeenCalledWith([expect.objectContaining({ name: 'صنف ج' })]);

    // The parent applies that setCart: the workspace cart is now [C] only.
    // The modal must NOT re-initialise its bills from the new cart.
    const nextPos = createMockPos(
      [c],
      orderTotals({ subTotal: 10, discountValue: 0, serviceCharge: 0, taxRate: 0, tipAmount: 0, total: 10 }),
    );
    rerender(
      <MemoryRouter>
        <PosSplitBillModal open pos={nextPos as never} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    // Bill 1 still shows its paid badge, Bill 2 still holds item C.
    expect(screen.getByText(/تم السداد/)).toBeTruthy();
    expect(screen.getByText('صنف ج')).toBeTruthy();
    expect(screen.getByText('الشيك 2')).toBeTruthy();
  });
});

describe('PosSplitBillModal — fractional split posts shares, not double-charged parts (B11)', () => {
  it('splits 100 + 20 into two 60 parts with no modifiers and no mismatch warning', async () => {
    const burger = item({ modifiers: [cheese] });
    const totals = orderTotals({ subTotal: 120, discountValue: 0, serviceCharge: 0, taxRate: 0, tipAmount: 0, total: 120 });
    const mockPos = createMockPos([burger], totals);
    renderModal(mockPos);

    fireEvent.click(screen.getByRole('button', { name: '½ نصفين' }));
    expect(screen.getByText(/حصة 1\/2/)).toBeTruthy();
    expect(screen.getByText(/حصة 2\/2/)).toBeTruthy();
    expect(screen.queryByText(/لا يطابق/)).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'تحصيل نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockPos.createSale.mutateAsync.mock.calls[0][0];
    expect(payload.cart).toHaveLength(1);
    expect(payload.cart[0].price).toBe(60);
    expect(payload.cart[0].qty).toBe(1);
    expect(payload.cart[0].modifiers).toEqual([]);
    expect(payload.paidAmount).toBe(60);
    expect(payload.expectedTotal).toBe(60);
  });
});

describe('PosSplitBillModal — save as drafts saves each bill under its own check (B12)', () => {
  it('calls the held-draft mutation once per bill with that bill’s own items and table label', async () => {
    const a = item({ lineKey: 'LA', productId: '1', name: 'صنف أ', price: 10, modifiers: [] });
    const b = item({ lineKey: 'LB', productId: '2', name: 'صنف ب', price: 10, modifiers: [] });
    const totals = orderTotals({ subTotal: 20, discountValue: 0, serviceCharge: 0, taxRate: 0, tipAmount: 0, total: 20 });
    const mockPos = createMockPos([a, b], totals);
    renderModal(mockPos);

    const moveButtons = screen.getAllByTitle('نقل إلى الشيك 2');
    fireEvent.click(moveButtons[1]);

    fireEvent.click(screen.getByRole('button', { name: 'حفظ الشيكات كطلبات معلقة منفصلة في الصالة' }));
    await waitFor(() => expect(mockPos.saveHeldDraftMutation.mutateAsync).toHaveBeenCalledTimes(2));
    const [first, second] = mockPos.saveHeldDraftMutation.mutateAsync.mock.calls.map((c) => c[0]);
    expect(first.tableNumber).toBe('5 - شيك 1');
    expect(first.items.map((i: { productId: number }) => i.productId)).toEqual([1]);
    expect(second.tableNumber).toBe('5 - شيك 2');
    expect(second.items.map((i: { productId: number }) => i.productId)).toEqual([2]);
    // The workspace cart is only reset at the end — never overwritten per bill.
    expect(mockPos.setCart).toHaveBeenCalledTimes(1);
    expect(mockPos.setCart).toHaveBeenCalledWith([]);
    expect(mockPos.setTableNumber).toHaveBeenCalledWith('');
  });
});

describe('PosSplitBillModal — even split never shows a guest paid before the sale posts (I33)', () => {
  function evenPos() {
    const a = item({ lineKey: 'LA', productId: '1', name: 'صنف أ', price: 100, modifiers: [] });
    const totals = orderTotals({
      subTotal: 100,
      discountValue: 0,
      serviceCharge: 10,
      taxRate: 14,
      tipAmount: 0,
      total: 125.4,
    });
    return createMockPos([a], totals);
  }

  function switchToEven() {
    fireEvent.click(screen.getByRole('button', { name: 'تقسيم بالتساوي (ضيوف)' }));
  }

  it('collects the first guest without marking paid and posts the real final sale when all collected', async () => {
    const mockPos = evenPos();
    renderModal(mockPos);
    switchToEven();

    fireEvent.click(screen.getAllByRole('button', { name: 'سداد نقد' })[0]);
    await waitFor(() => expect(screen.getByText(/تم التحصيل/)).toBeTruthy());
    expect(mockPos.createSale.mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByText(/تم السداد/)).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'سداد نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockPos.createSale.mutateAsync.mock.calls[0][0];
    expect(payload.taxRate).toBe(14);
    expect(payload.pricesIncludeTax).toBe(false);
    expect(payload.deliveryFee).toBe(0);
    expect(payload.serviceCharge).toBe(10);
    expect(payload.tipAmount).toBe(0);
    expect(payload.discount).toBe(0);
    expect(payload.paymentChannel).toBe('cash');
    expect(payload.paidAmount).toBe(125.4);
    expect(payload.expectedTotal).toBe(125.4);
    expect(payload.payments).toEqual([{ paymentChannel: 'cash', amount: 125.4 }]);
    await waitFor(() => expect(screen.getAllByText(/تم السداد/)).toHaveLength(2));
  });

  it('leaves no guest paid when the final post fails, and the retry posts it', async () => {
    const mockPos = evenPos();
    mockPos.createSale.mutateAsync
      .mockRejectedValueOnce(new Error('انقطع الاتصال'))
      .mockResolvedValue({ id: 7 });
    renderModal(mockPos);
    switchToEven();

    fireEvent.click(screen.getAllByRole('button', { name: 'سداد نقد' })[0]);
    await waitFor(() => expect(screen.getByText(/تم التحصيل/)).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: 'سداد نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/تم السداد/)).toBeNull();
    expect(screen.getAllByText(/تم التحصيل/)).toHaveLength(2);

    const retry = await screen.findByRole('button', { name: 'إعادة محاولة ترحيل البيع' });
    fireEvent.click(retry);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText(/تم السداد/)).toHaveLength(2));
  });
});

/* R-I34 / INV-REST-LINE-IDENTITY: split moves used to match on
 * product + unit + price, so a modified line moved onto a bill holding the
 * same product plain collapsed into it and the moved modifiers vanished.
 * Moves now match on lineKey only. */
describe('PosSplitBillModal — split moves never collapse lines that differ only by modifiers (R-I34)', () => {
  const cheese = { price: 20, qty: 1, name: 'جبنة إضافية' };
  const bill = (id: string, items: PosItem[]) => ({ id, name: `الشيك ${id}`, items, isPaid: false });

  it('moving a modified line onto a bill holding the same product plain keeps two lines with modifiers intact', () => {
    const modified = item({ lineKey: 'p1::u1::retail::cheese', productId: '1', price: 100, qty: 1, modifiers: [cheese] });
    const plain = item({ lineKey: 'p1::u1::retail', productId: '1', price: 100, qty: 1, modifiers: [] });
    const next = moveSplitBillItem([bill('b1', [modified]), bill('b2', [plain])], 'b1', 'b2', modified.lineKey, 1);
    expect(next[0].items).toHaveLength(0);
    expect(next[1].items).toHaveLength(2);
    const moved = next[1].items.find((line) => (line.modifiers || []).length === 1);
    expect(moved).toBeTruthy();
    expect(calcCartLineTotal(moved!)).toBe(120);
    expect(next[1].items.reduce((sum, line) => sum + calcCartLineTotal(line), 0)).toBe(220);
  });

  it('moving a partial quantity keeps the modifiers on the moved half and leaves the remainder untouched', () => {
    const modified = item({ lineKey: 'p1::u1::retail::cheese', productId: '1', price: 100, qty: 2, modifiers: [cheese] });
    const next = moveSplitBillItem([bill('b1', [modified]), bill('b2', [])], 'b1', 'b2', modified.lineKey, 1);
    expect(next[0].items[0].qty).toBe(1);
    expect(next[0].items[0].modifiers).toEqual([cheese]);
    expect(next[1].items).toHaveLength(1);
    expect(next[1].items[0].qty).toBe(1);
    expect(next[1].items[0].modifiers).toEqual([cheese]);
    expect(next[1].items[0].lineKey).not.toBe(modified.lineKey);
  });

  it('moving an identical line merges quantities instead of duplicating it', () => {
    const line = item({ lineKey: 'p1::u1::retail', productId: '1', price: 100, qty: 1, modifiers: [] });
    const other = item({ lineKey: 'p1::u1::retail', productId: '1', price: 100, qty: 1, modifiers: [] });
    const next = moveSplitBillItem([bill('b1', [line]), bill('b2', [other])], 'b1', 'b2', line.lineKey, 1);
    expect(next[0].items).toHaveLength(0);
    expect(next[1].items).toHaveLength(1);
    expect(next[1].items[0].qty).toBe(2);
  });

  it('move-all with differing modifiers never collapses', () => {
    const modified = item({ lineKey: 'p1::u1::retail::cheese', productId: '1', price: 100, qty: 1, modifiers: [cheese] });
    const plain = item({ lineKey: 'p1::u1::retail', productId: '1', price: 100, qty: 1, modifiers: [] });
    const next = moveSplitBillItems([bill('b1', [modified]), bill('b2', [plain])], 'b1', 'b2');
    expect(next[0].items).toHaveLength(0);
    expect(next[1].items).toHaveLength(2);
    expect(next[1].items.reduce((sum, line) => sum + calcCartLineTotal(line), 0)).toBe(220);
  });
});
