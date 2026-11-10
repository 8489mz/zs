/* T11-A (INV-REST-COMBO-SUBMIT-TRUTH, follow-up A): the checkout dialog
 * stays open on a failed submit, but the failure reason lived only in
 * the footer banner underneath it — the cashier staring at the open
 * dialog saw no reason. The dialog must surface submitMessage INSIDE
 * itself while it stays open on failure. At base the dialog renders no
 * such banner, so the first two cases fail there; the third pins that
 * no banner appears when there is no message. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PosCheckoutDialog } from './PosCheckoutDialog';
import { createTestQueryClient } from '@/test/test-query-client';

vi.mock('@/shared/api/delivery-reps.api', () => ({
  deliveryRepsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/features/pos/hooks/usePosUiCustomization', () => ({
  usePosUiCustomization: () => ({
    customization: { checkoutMode: 'detailed', defaultPaymentChannel: 'cash' },
  }),
}));

const FAILURE_MESSAGE = 'تعذّر حفظ الفاتورة: إجمالي الفاتورة (150) لا يطابق الإجمالي المحسوب (225).';

function makePos(overrides: Record<string, unknown> = {}) {
  return {
    cart: [{
      lineKey: 'p1::u1::retail',
      productId: 'p1',
      name: 'Burger',
      unitName: 'قطعة',
      unitMultiplier: 1,
      price: 150,
      qty: 1,
    }],
    totals: {
      total: 150,
      subTotal: 150,
      discountValue: 0,
      deliveryFee: 0,
      taxRate: 0,
      pricesIncludeTax: false,
      serviceCharge: 0,
      taxAmount: 0,
      tipAmount: 0,
    },
    paidAmount: 0,
    amountDue: 150,
    changeAmount: 0,
    cashAmount: 0,
    cardAmount: 0,
    transferAmount: 0,
    tenderedAmount: 0,
    tipAmount: 0,
    discount: 0,
    deliveryFee: 0,
    loyaltyPointsRedeemed: 0,
    paymentType: 'cash',
    paymentChannel: 'cash',
    orderType: 'takeaway',
    deliveryFeeMode: 'manual',
    collectionStatus: undefined,
    deliveryRepId: '',
    customerId: '',
    customersQuery: { data: [] },
    quickCustomerName: '',
    quickCustomerPhone: '',
    quickCustomerAddress: '',
    quickCustomerMutation: { mutateAsync: vi.fn() },
    settings: {},
    settingsQuery: { data: { restaurantModuleEnabled: false } },
    createSale: { isPending: false, isError: false },
    submitMessage: '',
    setSubmitMessage: vi.fn(),
    canSubmitSale: true,
    canSubmitHint: '',
    canShowLastSaleActions: false,
    canApplyDiscount: true,
    hasDiscountPermissionViolation: false,
    discountApprovalGranted: false,
    discountAuthorizationMutation: { mutateAsync: vi.fn() },
    setDiscountApprovalGranted: vi.fn(),
    setDiscountApprovalSecret: vi.fn(),
    setPaymentPreset: vi.fn(),
    setNote: vi.fn(),
    note: '',
    setCashAmount: vi.fn(),
    setCardAmount: vi.fn(),
    setTransferAmount: vi.fn(),
    setTenderedAmount: vi.fn(),
    setTipAmount: vi.fn(),
    setDiscount: vi.fn(),
    setDeliveryFee: vi.fn(),
    setDeliveryFeeMode: vi.fn(),
    setLoyaltyPointsRedeemed: vi.fn(),
    setTerminalPaymentDetails: vi.fn(),
    terminalPaymentDetails: null,
    setCustomerId: vi.fn(),
    setQuickCustomerName: vi.fn(),
    setQuickCustomerPhone: vi.fn(),
    setQuickCustomerAddress: vi.fn(),
    setOrderType: vi.fn(),
    setCollectionStatus: vi.fn(),
    setDeliveryRepId: vi.fn(),
    setPaymentChannel: vi.fn(),
    handleQuickCustomerSubmit: vi.fn(),
    api: {},
    ...overrides,
  };
}

function renderDialog(pos: unknown) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <PosCheckoutDialog
          open
          pos={pos as any}
          selectedCustomerName="عميل نقدي"
          onClose={vi.fn()}
          onConfirmSale={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PosCheckoutDialog — failure reason inside the dialog (T11-A)', () => {
  it('shows the submit failure reason inside the dialog while it stays open', () => {
    renderDialog(makePos({
      submitMessage: FAILURE_MESSAGE,
      createSale: { isPending: false, isError: true },
    }));

    expect(screen.getByText(/إجمالي الفاتورة \(150\) لا يطابق الإجمالي المحسوب \(225\)/)).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toContain(FAILURE_MESSAGE);
  }, 30000);

  it('shows a dialog-local validation failure (no mutation error) inside the dialog', () => {
    renderDialog(makePos({
      submitMessage: 'يرجى اختيار مندوب التوصيل لتسجيل عهدة التحصيل عليه (في حالة تحصيل من العميل).',
      createSale: { isPending: false, isError: false },
      canShowLastSaleActions: false,
    }));

    expect(screen.getByText(/يرجى اختيار مندوب التوصيل/)).toBeInTheDocument();
  }, 30000);

  it('shows no banner when there is no submit message', () => {
    renderDialog(makePos({ submitMessage: '' }));

    expect(screen.queryByRole('alert')).toBeNull();
  }, 30000);
});
