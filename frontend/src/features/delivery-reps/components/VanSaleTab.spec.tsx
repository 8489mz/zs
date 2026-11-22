/* INV-VAN-SALES-MOCK-EVALUATE-PROMOTIONS — VanSaleTab evaluates cart
 * promotions 250ms after a non-empty cart renders, through
 * vanSalesApi.evaluateCartPromotions. The manual API mocks in the
 * delivery-reps specs listed only the functions each tab's own test
 * exercised, so evaluateCartPromotions was missing from 5 of the 6
 * specs — and the call sits inside a setTimeout, where a sync throw
 * of `undefined is not a function` can never be caught by the chained
 * .catch (no promise exists yet). This spec renders the real tab with
 * a one-item cart and waits past the timer, so it fails while the mock
 * lacks the function and passes once the stub is present. The stub
 * below matches the real return shape
 * (van-sales-fraud-promotions.ts:124).
 */
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VanSaleTab } from './VanSaleTab';

const { mockEvaluateCartPromotions, mockGetCustomerLastSoldPrices } = vi.hoisted(() => ({
  mockEvaluateCartPromotions: vi.fn().mockResolvedValue({
    ok: true,
    appliedPromotions: [],
    bonusItemsToAdd: [],
    totalPromotionalDiscount: 0,
    upsellNudges: [],
  }),
  mockGetCustomerLastSoldPrices: vi.fn().mockResolvedValue({ lastPrices: {} }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('../api/van-sales.api', () => ({
  vanSalesApi: {
    getCustomerLastSoldPrices: mockGetCustomerLastSoldPrices,
    evaluateCartPromotions: mockEvaluateCartPromotions,
  },
}));

const CUSTOMERS = [{ id: 7, name: 'محل اختبار', balance: 0 }];
const CART = [
  {
    productId: 2,
    name: 'صنف اختبار',
    qty: 2,
    unitPrice: 24,
    maxQty: 100,
    unitName: 'قطعة',
    unitMultiplier: 1,
    isBonus: false,
  },
];

describe('VanSaleTab promo evaluation', () => {
  it('calls evaluateCartPromotions with the real cart payload once the 250ms timer fires', async () => {
    render(
      <VanSaleTab
        customers={CUSTOMERS}
        selectedCustomerId={7}
        onSelectCustomer={() => {}}
        newCustomerName=""
        onNewCustomerNameChange={() => {}}
        cart={CART}
        onUpdateCartQty={() => {}}
        cartTotal={48}
        onGoToInventory={() => {}}
        onSubmitSale={() => {}}
        isSubmitting={false}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(mockEvaluateCartPromotions).toHaveBeenCalledTimes(1);
    expect(mockEvaluateCartPromotions).toHaveBeenCalledWith({
      cartItems: [
        {
          productId: 2,
          productName: 'صنف اختبار',
          qty: 2,
          unitPrice: 24,
          uom: 'قطعة',
          multiplier: 1,
          isBonus: false,
        },
      ],
      invoiceSubtotal: 48,
      customerType: undefined,
    });
  });
});
