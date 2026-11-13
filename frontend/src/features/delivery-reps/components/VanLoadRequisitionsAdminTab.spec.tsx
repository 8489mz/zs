/*
 * New file: frontend/src/features/delivery-reps/components/VanLoadRequisitionsAdminTab.spec.tsx
 *
 * WHAT THIS PINS (INV-VAN-ADMIN-INVALIDATIONS, part of P10): dispatching,
 * rejecting, or deleting a load requisition invalidated only the
 * requisitions list (and the trips list on dispatch) — never
 * ['van-admin-pending-requisitions-badge'], the query behind the
 * pending-loads counter (useVanSalesAdmin.ts:18, rendered at
 * VanSalesAdminManagementPage.tsx:281). Only the manual-refresh
 * handlers invalidated it, so the counter stayed stale until the admin
 * pressed refresh (live trial test10k 2026-11-13).
 *
 * WHAT IS DRIVEN (real admin tab, mocked api): render the requisitions
 * tab with one pending requisition.
 * - Case 1: dispatch it -> the pending-requisitions badge key is invalidated.
 * - Case 2: reject it -> the badge key is invalidated.
 * - Case 3: delete it -> the badge key is invalidated.
 *
 * NOT DRIVEN: the backend dispatch itself (proven by the load-request
 * live trial + the van-load specs); the badge's refetch (React Query
 * refetches an invalidated active query — the invalidation call IS the
 * production behaviour). Review (quantities-only, no status change)
 * correctly does NOT touch the badge and is not pinned here.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { VanLoadRequisitionsAdminTab } from './VanLoadRequisitionsAdminTab';
import { createTestQueryClient } from '@/test/test-query-client';

// jsdom has no Element.scrollIntoView; the shared CustomSelect calls it
// when its dropdown opens.
window.HTMLElement.prototype.scrollIntoView = vi.fn() as unknown as typeof window.HTMLElement.prototype.scrollIntoView;

const {
  mockListRequisitions,
  mockGetWarehouses,
  mockGetProducts,
  mockDispatch,
  mockReject,
  mockDelete,
  mockSystemConfirm,
} = vi.hoisted(() => ({
  mockListRequisitions: vi.fn(),
  mockGetWarehouses: vi.fn(),
  mockGetProducts: vi.fn(),
  mockDispatch: vi.fn(),
  mockReject: vi.fn(),
  mockDelete: vi.fn(),
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
    listAdminRequisitions: mockListRequisitions,
    getAdminWarehouses: mockGetWarehouses,
    getAdminAvailableProducts: mockGetProducts,
    dispatchRequisition: mockDispatch,
    rejectRequisition: mockReject,
    deleteRequisition: mockDelete,
    reviewRequisition: vi.fn(),
  },
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useSettingsQuery: () => ({ data: { paperSize: 'a4' } }),
}));

vi.mock('./DriverNewLoadRequisitionView', () => ({
  DriverNewLoadRequisitionView: () => null,
}));

vi.mock('@/lib/small-receipt-printer', () => ({
  printSmallReceiptDocument: vi.fn(),
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  systemConfirm: mockSystemConfirm,
}));

const pendingReq: any = {
  id: 2,
  docNo: 'REQ-261113-0002',
  repId: 38,
  repName: 'مندوب اختبار جملة',
  vehiclePlate: '',
  sourceWarehouseId: 1,
  sourceWarehouseName: 'المستودع الرئيسي',
  status: 'pending',
  requestedItems: [
    {
      productId: 1,
      productName: 'صنف اختبار جملة أ',
      barcode: '6220000990011',
      qty: 70,
      unit: 'قطعة',
    },
  ],
  approvedItems: [],
  createdAt: '2026-11-13T10:00:00.000Z',
};

function renderTab() {
  const queryClient = createTestQueryClient();
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  mockListRequisitions.mockResolvedValue([pendingReq]);
  mockGetWarehouses.mockResolvedValue([]);
  mockGetProducts.mockResolvedValue([]);
  mockDispatch.mockResolvedValue({ ok: true, requisitionId: 2, tripId: 6, docNo: 'REQ-261113-0002' });
  mockReject.mockResolvedValue({ ok: true, requisitionId: 2, status: 'rejected' });
  mockDelete.mockResolvedValue({ ok: true, requisitionId: 2, docNo: 'REQ-261113-0002' });
  mockSystemConfirm.mockResolvedValue(true);
  render(
    <QueryClientProvider client={queryClient}>
      <VanLoadRequisitionsAdminTab />
    </QueryClientProvider>,
  );
  return { queryClient, invalidateSpy };
}

describe('VanLoadRequisitionsAdminTab — pending badge invalidation (P10)', () => {
  it('case 1: dispatching a requisition invalidates the pending-requisitions badge', async () => {
    const { invalidateSpy } = renderTab();
    await screen.findByText('REQ-261113-0002');
    fireEvent.click(screen.getByRole('button', { name: 'صرف' }));
    await waitFor(() => expect(mockDispatch).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['van-admin-pending-requisitions-badge'],
      }),
    );
  });

  it('case 2: rejecting a requisition invalidates the pending-requisitions badge', async () => {
    const { invalidateSpy } = renderTab();
    await screen.findByText('REQ-261113-0002');
    fireEvent.click(screen.getByRole('button', { name: 'رفض' }));
    await screen.findByText('تأكيد رفض الإذن');
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد رفض الإذن' }));
    await waitFor(() => expect(mockReject).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['van-admin-pending-requisitions-badge'],
      }),
    );
  });

  it('case 3: deleting a requisition invalidates the pending-requisitions badge', async () => {
    const { invalidateSpy } = renderTab();
    await screen.findByText('REQ-261113-0002');
    fireEvent.click(screen.getByTitle('حذف الطلب نهائياً'));
    await waitFor(() => expect(mockDelete).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['van-admin-pending-requisitions-badge'],
      }),
    );
  });
});
