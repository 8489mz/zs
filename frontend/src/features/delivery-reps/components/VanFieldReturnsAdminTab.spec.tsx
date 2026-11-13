/*
 * New file: frontend/src/features/delivery-reps/components/VanFieldReturnsAdminTab.spec.tsx
 *
 * WHAT THIS PINS (INV-VAN-ADMIN-INVALIDATIONS, part of P10): approving
 * (or rejecting) a field return invalidated only the returns list and
 * the trips LIST — never ['van-trip-admin-details', tripId], the query
 * behind the open trip-details dialog (VanTripsTab.tsx:46, no
 * refetchInterval). The dialog kept its pre-approval snapshot until a
 * full page reload (live trial test10k 2026-11-13).
 *
 * WHAT IS DRIVEN (real admin tab, mocked api): render the returns tab
 * with one pending return on trip #6.
 * - Case 1: approve it -> ['van-trip-admin-details', 6] is invalidated.
 * - Case 2: reject it -> the same details key is invalidated.
 *
 * NOT DRIVEN: the backend approval itself (proven by the P13 approval
 * specs); the dialog's refetch (React Query refetches an invalidated
 * active query — the invalidation call IS the production behaviour).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { VanFieldReturnsAdminTab } from './VanFieldReturnsAdminTab';
import { createTestQueryClient } from '@/test/test-query-client';

const { mockListReturns, mockApproveReturn, mockRejectReturn, mockSystemConfirm } = vi.hoisted(() => ({
  mockListReturns: vi.fn(),
  mockApproveReturn: vi.fn(),
  mockRejectReturn: vi.fn(),
  mockSystemConfirm: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

vi.mock('../api/van-sales.api', () => ({
  vanSalesApi: {
    listAdminReturns: mockListReturns,
    approveReturn: mockApproveReturn,
    rejectReturn: mockRejectReturn,
  },
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  systemConfirm: mockSystemConfirm,
}));

const pendingReturn: any = {
  id: 1,
  docNo: 'VRET-261113-0001',
  tripId: 6,
  repId: 38,
  repName: 'مندوب اختبار جملة',
  customerId: 3060,
  customerName: 'محل اختبار جملة 1',
  saleId: 100,
  saleDocNo: 'VAN-261113-0002',
  status: 'pending_approval',
  returnReason: 'damaged',
  totalAmount: 144,
  items: [{ productId: 1, productName: 'صنف اختبار جملة أ', qty: 1, unitPrice: 144 }],
  createdAt: '2026-11-13T10:00:00.000Z',
};

function renderTab() {
  const queryClient = createTestQueryClient();
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  mockListReturns.mockResolvedValue([pendingReturn]);
  mockApproveReturn.mockResolvedValue({ ok: true, returnId: 1, status: 'approved' });
  mockRejectReturn.mockResolvedValue({ ok: true, returnId: 1, status: 'rejected' });
  mockSystemConfirm.mockResolvedValue(true);
  render(
    <QueryClientProvider client={queryClient}>
      <VanFieldReturnsAdminTab />
    </QueryClientProvider>,
  );
  return { queryClient, invalidateSpy };
}

describe('VanFieldReturnsAdminTab — trip-details invalidation (P10)', () => {
  it('case 1: approving a return invalidates the open trip-details dialog query', async () => {
    const { invalidateSpy } = renderTab();
    await screen.findByText('#VRET-261113-0001');
    fireEvent.click(screen.getByRole('button', { name: 'قبول' }));
    await waitFor(() => expect(mockApproveReturn).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['van-trip-admin-details', 6],
      }),
    );
  });

  it('case 2: rejecting a return invalidates the open trip-details dialog query', async () => {
    const { invalidateSpy } = renderTab();
    await screen.findByText('#VRET-261113-0001');
    fireEvent.click(screen.getByRole('button', { name: 'رفض' }));
    await screen.findByText('تأكيد رفض المرتجع');
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد رفض المرتجع' }));
    await waitFor(() => expect(mockRejectReturn).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['van-trip-admin-details', 6],
      }),
    );
  });
});
