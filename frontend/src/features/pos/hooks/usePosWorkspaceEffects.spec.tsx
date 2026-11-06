/* POS cash follows the discounted total (INV-INVOICE-DETAIL-AMOUNTS): when
 * the discount changes and the cash field was simply filled to the old
 * total (single cash payment, no card/transfer split), the cash field is
 * re-filled to the new total — so entering a 10% discount on a 150.00 sale
 * moves cash 150.00 to 135.00 instead of leaving a phantom 15.00 remaining.
 * A manually tendered amount, a split payment, a credit sale, or a total
 * change with no discount change must leave the cash field untouched.
 */
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePosWorkspaceEffects } from './usePosWorkspaceEffects';
import type { PosItem } from '@/features/pos/types/pos.types';

const cartItem = {
  lineKey: 'line-1',
  productId: '10',
  name: 'صنف تجريبي',
  unitId: '1',
  unitName: 'قطعة',
  unitMultiplier: 1,
  price: 150,
  costPrice: 100,
  qty: 1,
  stockLimit: 100,
  currentStock: 100,
  minStock: 0,
  priceType: 'retail',
} as PosItem;

interface CashProps {
  discount: number;
  total: number;
  cashAmount: number;
  cardAmount: number;
  transferAmount: number;
  paymentType: 'cash' | 'credit';
}

function setup() {
  const setters = {
    setCashAmount: vi.fn(),
    setCardAmount: vi.fn(),
    setTransferAmount: vi.fn(),
    setPaymentChannel: vi.fn(),
    setCart: vi.fn(),
    setSubmitMessage: vi.fn(),
    setSelectedLineKey: vi.fn(),
    setLastAddedLineKey: vi.fn(),
    setDiscountApprovalSecret: vi.fn(),
  };
  const render = (initialProps: CashProps) =>
    renderHook(
      ({ discount, total, cashAmount, cardAmount, transferAmount, paymentType }: CashProps) =>
        usePosWorkspaceEffects({
          cart: [cartItem],
          customerId: '',
          discount,
          paidAmount: cashAmount + cardAmount + transferAmount,
          total,
          cashAmount,
          setCashAmount: setters.setCashAmount,
          cardAmount,
          setCardAmount: setters.setCardAmount,
          transferAmount,
          setTransferAmount: setters.setTransferAmount,
          paymentType,
          paymentChannel: 'cash',
          setPaymentChannel: setters.setPaymentChannel,
          note: '',
          search: '',
          priceType: 'retail',
          tableNumber: '',
          orderType: 'takeaway',
          products: [],
          setCart: setters.setCart,
          setSubmitMessage: setters.setSubmitMessage,
          recentProductIds: [],
          lastSale: null,
          lastAddedLineKey: '',
          setLastAddedLineKey: setters.setLastAddedLineKey,
          selectedLineKey: '',
          setSelectedLineKey: setters.setSelectedLineKey,
          discountApprovalSecret: '',
          setDiscountApprovalSecret: setters.setDiscountApprovalSecret,
        }),
      { initialProps },
    );
  return { setters, render };
}

describe('POS cash follows the total when the discount changes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('re-fills cash to the new total when a discount is entered on a cash-filled sale', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 150, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 15, total: 135, cashAmount: 150, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).toHaveBeenCalledWith(135);
  });

  it('leaves a manually tendered cash amount untouched', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 200, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 15, total: 135, cashAmount: 200, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).not.toHaveBeenCalled();
  });

  it('leaves a split payment untouched', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 100, cardAmount: 50, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 15, total: 135, cashAmount: 100, cardAmount: 50, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).not.toHaveBeenCalled();
  });

  it('leaves cash untouched when the total changes without a discount change', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 150, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 0, total: 160, cashAmount: 150, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).not.toHaveBeenCalled();
  });

  it('leaves cash untouched on a credit sale', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 0, cardAmount: 0, transferAmount: 0, paymentType: 'credit' });

    act(() => {
      rerender({ discount: 15, total: 135, cashAmount: 0, cardAmount: 0, transferAmount: 0, paymentType: 'credit' });
    });

    expect(setters.setCashAmount).not.toHaveBeenCalled();
  });
});
