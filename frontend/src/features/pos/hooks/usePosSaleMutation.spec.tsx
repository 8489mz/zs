import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePosSaleMutation } from '@/features/pos/hooks/usePosSaleMutation';
import type { CreatePosSaleInput } from '@/features/pos/contracts';
import { createTestQueryClient } from '@/test/test-query-client';
import { useAuthStore } from '@/stores/auth-store';

const { createSaleMock, invalidateSalesDomainMock } = vi.hoisted(() => ({
  createSaleMock: vi.fn(),
  invalidateSalesDomainMock: vi.fn(),
}));

vi.mock('@/features/pos/api/pos.api', () => ({
  posApi: {
    createSale: createSaleMock,
  },
}));

vi.mock('@/app/query-invalidation', () => ({
  invalidateSalesDomain: invalidateSalesDomainMock,
}));

function createWrapper() {
  const queryClient = createTestQueryClient();

  return {
    queryClient,
    Wrapper({ children }: PropsWithChildren) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
  };
}

function createSaleInput(): CreatePosSaleInput {
  return {
    cart: [{
      lineKey: 'line-1',
      productId: 'product-1',
      name: 'Product 1',
      unitId: 'unit-1',
      unitName: 'piece',
      unitMultiplier: 1,
      price: 50,
      costPrice: 40,
      qty: 1,
      stockLimit: 10,
      currentStock: 10,
      minStock: 1,
      priceType: 'retail',
    }],
    customerId: '',
    paymentType: 'cash',
    paymentChannel: 'cash',
    discount: 0,
    deliveryFee: 0,
    note: '',
    paidAmount: 50,
    tenderedAmount: 50,
    payments: [{ paymentChannel: 'cash', amount: 50 }],
    taxRate: 0,
    pricesIncludeTax: false,
    expectedTotal: 50,
    branchId: 'branch-1',
    locationId: 'location-1',
  };
}

describe('usePosSaleMutation', () => {
  beforeEach(() => {
    invalidateSalesDomainMock.mockReset();
    createSaleMock.mockReset();
    useAuthStore.setState({
      tenant: { id: 'test-tenant', accountId: 'test-account' } as any,
      user: { tenantId: 'test-tenant', accountId: 'test-account' } as any,
    });
  });

  it('uses the shared sales invalidation flow with dashboard freshness on success (deferred 180ms)', async () => {
    vi.useFakeTimers();
    try {
      createSaleMock.mockResolvedValueOnce({ id: 'sale-42' });
      invalidateSalesDomainMock.mockResolvedValueOnce(undefined);

      const { queryClient, Wrapper } = createWrapper();
      const { result } = renderHook(() => usePosSaleMutation(), { wrapper: Wrapper });

      await act(async () => {
        await result.current.mutateAsync(createSaleInput());
      });

      expect(invalidateSalesDomainMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(180);
      });

      expect(invalidateSalesDomainMock).toHaveBeenCalledWith(queryClient, {
        saleId: 'sale-42',
        includeDashboard: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('confirms a committed sale without waiting for active query refetches', async () => {
    vi.useFakeTimers();
    try {
      createSaleMock.mockResolvedValueOnce({ id: 'sale-43' });
      let finishRefresh: (() => void) | undefined;
      invalidateSalesDomainMock.mockReturnValueOnce(new Promise<void>((resolve) => {
        finishRefresh = resolve;
      }));

      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => usePosSaleMutation(), { wrapper: Wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync(createSaleInput())).resolves.toEqual({ id: 'sale-43' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180);
      });
      expect(invalidateSalesDomainMock).toHaveBeenCalledOnce();
      finishRefresh?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it('safely catches ApiError network failures, enqueues offline sale without throwing, and skips active domain invalidation', async () => {
    createSaleMock.mockRejectedValueOnce({
      name: 'ApiError',
      status: 0,
      code: 'network_error',
      message: 'تعذر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.',
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => usePosSaleMutation(), { wrapper: Wrapper });

    let saleResult: any;
    await act(async () => {
      saleResult = await result.current.mutateAsync(createSaleInput());
    });

    expect(saleResult).toBeDefined();
    expect(saleResult.offline).toBe(true);
    expect(saleResult.docNo).toMatch(/^INV-/);
    expect(invalidateSalesDomainMock).not.toHaveBeenCalled();
  });

  it('does not acknowledge an offline sale when the queue cannot be saved', async () => {
    createSaleMock.mockRejectedValueOnce({ status: 0, code: 'network_error', message: 'Network unavailable' });
    const setItem = Storage.prototype.setItem;
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === 'zsystems_pos_offline_sales_queue') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return setItem.call(this, key, value);
    });

    try {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => usePosSaleMutation(), { wrapper: Wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync(createSaleInput())).rejects.toThrow('تعذر حفظ الفاتورة');
      });
      expect(invalidateSalesDomainMock).not.toHaveBeenCalled();
    } finally {
      storageSpy.mockRestore();
    }
  });
});
