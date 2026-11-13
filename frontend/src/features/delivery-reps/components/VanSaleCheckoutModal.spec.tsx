/*
 * New file: frontend/src/features/delivery-reps/components/VanSaleCheckoutModal.spec.tsx
 *
 * WHAT THIS PINS (INV-VAN-CHECKOUT-DISCOUNT-PERMISSION, part of P7): the
 * checkout modal offered a cash-discount control to every rep even when
 * the admin's can_give_discount flag was OFF (the server then refused
 * the submit — live trial test10k 2026-11-13).
 *
 * WHAT IS DRIVEN (real modal, mocked i18n only): render the modal with a
 * 72.00 cart and assert the discount section.
 * - Case 1 (P7): canGiveDiscount={false} -> no discount control renders.
 * - Case 2 (P7): canGiveDiscount={true} -> the control renders and 2%
 *   applies locally (confirm passes cashDiscountAmount 1.44).
 * - Case 3 (P7, fail closed): prop omitted -> no discount control.
 *
 * NOT DRIVEN: the server-side discount gate (van-sales.service.ts
 * refuses any cash discount when can_give_discount is false — untouched);
 * the backend login already returns the rep's full permissions object,
 * so no backend change is needed for the flag to reach the page.
 * (P11 WhatsApp-share cases live in the same file, added by the P11
 * package — see the second describe block.)
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VanSaleCheckoutModal } from './VanSaleCheckoutModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

const DISCOUNT_TOGGLE = '+ إضافة خصم تسوية نقدي (اختياري)';
const CONFIRM_LABEL = 'تأكيد وإصدار الفاتورة';

const customerNoPhone = { id: 3060, name: 'محل اختبار جملة 1', balance: 0 };

function renderModal(props: Record<string, unknown>) {
  const onConfirmCheckout = vi.fn();
  const utils = render(
    <VanSaleCheckoutModal {...baseProps} onConfirmCheckout={onConfirmCheckout} {...props} />,
  );
  return { ...utils, onConfirmCheckout };
}

const baseProps = {
  open: true,
  onClose: () => {},
  cartTotal: 72,
  cartItemsCount: 1,
  cartTotalPieces: 1,
  cartonsCount: '0',
  onCartonsCountChange: () => {},
  deliveryProofPhoto: '',
  onDeliveryProofPhotoChange: () => {},
  isSubmitting: false,
  onConfirmCheckout: vi.fn(),
};

describe('VanSaleCheckoutModal discount permission (P7)', () => {
  it('case 1: canGiveDiscount={false} renders no discount control', () => {
    renderModal({ canGiveDiscount: false, customer: customerNoPhone });
    expect(screen.queryByText(DISCOUNT_TOGGLE)).toBeNull();
  });

  it('case 2: canGiveDiscount={true} renders the control and 2% applies locally', () => {
    const { onConfirmCheckout } = renderModal({ canGiveDiscount: true, customer: customerNoPhone });
    fireEvent.click(screen.getByText(DISCOUNT_TOGGLE));
    fireEvent.click(screen.getByText(/2% \(1\.44/));
    fireEvent.click(screen.getByText(CONFIRM_LABEL));
    expect(onConfirmCheckout).toHaveBeenCalledTimes(1);
    expect(onConfirmCheckout.mock.calls[0][0].cashDiscountAmount).toBe(1.44);
  });

  it('case 3: prop omitted hides the discount control (fail closed)', () => {
    renderModal({ customer: customerNoPhone });
    expect(screen.queryByText(DISCOUNT_TOGGLE)).toBeNull();
  });
});
