/*
 * Pins the middle of the short-transfer-receipt reason + approval plumbing
 * (INV-SHORT-TRANSFER-RECEIPT-REASON, as revised by
 * INV-TRANSFER-RECEIPT-SHORTAGE-APPROVAL, 2026-11-12): the workspace
 * mutation must carry the per-transfer varianceReason and the approver
 * password the dialog collected into the receiveStockTransfer call, so
 * the backend gate sees them. The dialog half is pinned by
 * InventoryTransferActionDialog.spec.tsx and the request body half by
 * the api serialisation case there; this file pins the mutation in
 * between, driving the REAL hook with a mocked api boundary.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useInventoryWorkspaceMutations } from './useInventoryWorkspaceMutations';
import { createTestQueryClient } from '@/test/test-query-client';

const mocks = vi.hoisted(() => ({
  receiveStockTransfer: vi.fn().mockResolvedValue({}),
  cancelStockTransfer: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/features/inventory/api/inventory.api', () => ({
  inventoryApi: {
    receiveStockTransfer: mocks.receiveStockTransfer,
    cancelStockTransfer: mocks.cancelStockTransfer,
  },
}));

function renderMutations() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useInventoryWorkspaceMutations({
        queryClient,
        transferForm: {} as never,
        transferItems: [],
        countForm: {} as never,
        countItems: [],
        setTransferItems: vi.fn(),
        setTransferForm: vi.fn(),
        setCountItems: vi.fn(),
        setCountForm: vi.fn(),
        setPostingPin: vi.fn(),
        setSelectedTransferIds: vi.fn(),
        setSelectedSessionIds: vi.fn(),
        setCreatedTransfer: vi.fn(),
      }),
    { wrapper },
  );
}

describe('transfer action mutation variance reason', () => {
  it('passes the per-transfer reason to the receive call', async () => {
    const { result } = renderMutations();
    await act(async () => {
      await result.current.transferActionMutation.mutateAsync({
        transferIds: ['7'],
        action: 'receive',
        receiptItems: { '7': [{ itemId: 71, receivedQty: 8 }] },
        varianceReasons: { '7': 'نقصت وحدتان أثناء النقل' },
      });
    });
    expect(mocks.receiveStockTransfer).toHaveBeenCalledTimes(1);
    expect(mocks.receiveStockTransfer).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ 'x-idempotency-key': expect.any(String) }),
      { items: [{ itemId: 71, receivedQty: 8 }], varianceReason: 'نقصت وحدتان أثناء النقل' },
    );
  });

  it('sends no reason for a receipt without variance reasons', async () => {
    const { result } = renderMutations();
    await act(async () => {
      await result.current.transferActionMutation.mutateAsync({
        transferIds: ['7'],
        action: 'receive',
        receiptItems: { '7': [{ itemId: 71, receivedQty: 10 }] },
      });
    });
    expect(mocks.receiveStockTransfer).toHaveBeenCalledTimes(1);
    const payload = mocks.receiveStockTransfer.mock.calls[0][2] as { varianceReason?: string };
    expect(payload.varianceReason).toBeUndefined();
  });

  it('passes the approver password to the receive call', async () => {
    const { result } = renderMutations();
    await act(async () => {
      await result.current.transferActionMutation.mutateAsync({
        transferIds: ['7'],
        action: 'receive',
        receiptItems: { '7': [{ itemId: 71, receivedQty: 8 }] },
        varianceReasons: { '7': 'نقصت وحدتان أثناء النقل' },
        approvalSecrets: { '7': 'approver-password' },
      });
    });
    expect(mocks.receiveStockTransfer).toHaveBeenCalledTimes(1);
    expect(mocks.receiveStockTransfer).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ 'x-idempotency-key': expect.any(String) }),
      { items: [{ itemId: 71, receivedQty: 8 }], varianceReason: 'نقصت وحدتان أثناء النقل', approvalSecret: 'approver-password' },
    );
  });
});
