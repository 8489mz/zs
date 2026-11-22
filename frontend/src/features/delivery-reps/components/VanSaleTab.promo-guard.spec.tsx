/* INV-VAN-SALES-MOCK-IMPORT-ORIGINAL — promo evaluation is
 * non-critical: VanSaleTab calls vanSalesApi.evaluateCartPromotions
 * 250ms after a non-empty cart renders, inside a setTimeout where a
 * sync throw can never be caught by the chained .catch. When the
 * function is missing (stale or partial API), the tab must degrade
 * silently instead of crashing. This spec simulates exactly that: it
 * spreads the real API but overrides evaluateCartPromotions with
 * undefined, renders a one-item cart, waits past the timer, and
 * asserts the tab still renders. Fail-first proven — exit 1 with
 * `TypeError: vanSalesApi.evaluateCartPromotions is not a function`
 * before the typeof guard, exit 0 after.
 */
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VanSaleTab } from './VanSaleTab';

const { mockGetCustomerLastSoldPrices } = vi.hoisted(() => ({
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

vi.mock('../api/van-sales.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/van-sales.api')>();
  return {
    ...actual,
    vanSalesApi: {
      ...actual.vanSalesApi,
      getCustomerLastSoldPrices: mockGetCustomerLastSoldPrices,
      evaluateCartPromotions: undefined as unknown as typeof actual.vanSalesApi.evaluateCartPromotions,
    },
  };
});

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

describe('VanSaleTab promo evaluation guard', () => {
  it('renders a non-empty cart without throwing when evaluateCartPromotions is missing', async () => {
    const { container } = render(
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
    expect(mockGetCustomerLastSoldPrices).toHaveBeenCalled();
    expect(container.textContent).toContain('صنف اختبار');
  });
});
