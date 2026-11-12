/*
 * Pins the short-transfer-receipt reason + approval plumbing
 * (INV-SHORT-TRANSFER-RECEIPT-REASON, as revised by
 * INV-TRANSFER-RECEIPT-SHORTAGE-APPROVAL, 2026-11-12).
 *
 * THE GAP: the backend rejects any short receipt without a written variance
 * reason of at least 8 characters AND approval by a different admin user
 * (TRANSFER_SHORTAGE_REASON_REQUIRED / TRANSFER_SHORTAGE_APPROVAL_REQUIRED),
 * but the receipt dialog collected only the reason, so a merchant receiving
 * less than dispatched could never complete a shortfall receipt from the UI.
 *
 * WHAT THIS PINS, driving the REAL dialog and the REAL api wrapper:
 * - typing a received quantity below dispatched reveals a per-transfer
 *   variance-reason field (required, at least 8 characters) and an
 *   approver-password field: confirming without both is blocked, and a
 *   short reason is blocked even with a password; a valid reason plus
 *   the approver password calls onConfirm with rows, reasons, and
 *   approval secrets keyed by transfer id.
 * - a full receipt needs no reason and no approval and sends none.
 * - with two transfers in one batch, only the short one shows (and
 *   carries) a reason field, and the approval password applies to it.
 * - inventoryApi.receiveStockTransfer serialises varianceReason and
 *   approvalSecret into the POST body the backend already accepts.
 * The backend gate itself stays pinned by transfer-receipt-pinned.spec.ts;
 * this spec pins the UI/API half.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InventoryTransferActionDialog } from './InventoryWorkspaceDialogs';
import { inventoryApi } from '@/shared/api/inventory.api';
import type { StockTransfer } from '@/types/domain';

const mockHttp = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@/lib/http', () => ({ http: mockHttp }));

function makeTransfer(id: string, docNo: string, qty: number): StockTransfer {
  return {
    id,
    docNo,
    fromLocationId: '1',
    toLocationId: '2',
    status: 'sent',
    date: '2026-11-04',
    items: [{ id: `${id}1`, productId: '1', productName: 'صنف أ', qty }],
  };
}

function renderDialog(transfers: StockTransfer[], onConfirm = vi.fn()) {
  render(
    <InventoryTransferActionDialog
      action={{ action: 'receive', transfers }}
      isBusy={false}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe('short transfer receipt variance reason and approval', () => {
  it('blocks a short receipt without a reason and approval, and sends a valid reason plus the approver password', () => {
    const onConfirm = renderDialog([makeTransfer('7', 'TR-260104-0007', 10)]);
    const qtyInput = screen.getByLabelText(/الكمية المستلمة/);
    fireEvent.change(qtyInput, { target: { value: '8' } });

    const reasonInput = screen.getByLabelText(/سبب فرق الكمية/);
    const approverInput = screen.getByLabelText(/كلمة مرور المعتمد/);
    // No reason, no approver password: confirm is blocked.
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الاستلام/ }));
    expect(onConfirm).toHaveBeenCalledTimes(0);

    // A short reason (under 8 characters) is blocked even with a password.
    fireEvent.change(reasonInput, { target: { value: 'ناقص' } });
    fireEvent.change(approverInput, { target: { value: 'approver-password' } });
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الاستلام/ }));
    expect(onConfirm).toHaveBeenCalledTimes(0);

    // A valid reason plus the approver password confirms.
    fireEvent.change(reasonInput, { target: { value: 'نقصت وحدتان أثناء النقل' } });
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الاستلام/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      { '7': [{ itemId: 71, receivedQty: 8 }] },
      { '7': 'نقصت وحدتان أثناء النقل' },
      { '7': 'approver-password' },
    );
  });

  it('needs no reason for a full receipt', () => {
    const onConfirm = renderDialog([makeTransfer('7', 'TR-260104-0007', 10)]);
    expect(screen.queryByLabelText(/سبب فرق الكمية/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الاستلام/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      { '7': [{ itemId: 71, receivedQty: 10 }] },
      {},
      {},
    );
  });

  it('collects a reason only for the short transfer in a batch', () => {
    const onConfirm = renderDialog([
      makeTransfer('7', 'TR-260104-0007', 10),
      makeTransfer('8', 'TR-260104-0008', 5),
    ]);
    const qtyInputs = screen.getAllByLabelText(/الكمية المستلمة/);
    fireEvent.change(qtyInputs[0], { target: { value: '8' } });
    expect(screen.getAllByLabelText(/سبب فرق الكمية/)).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/سبب فرق الكمية/), { target: { value: 'كسرت ثلاث وحدات في الطريق' } });
    fireEvent.change(screen.getByLabelText(/كلمة مرور المعتمد/), { target: { value: 'approver-password' } });
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الاستلام/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      { '7': [{ itemId: 71, receivedQty: 8 }], '8': [{ itemId: 81, receivedQty: 5 }] },
      { '7': 'كسرت ثلاث وحدات في الطريق' },
      { '7': 'approver-password' },
    );
  });

  it('sends varianceReason and approvalSecret in the receive request body', async () => {
    await inventoryApi.receiveStockTransfer('7', undefined, {
      items: [{ itemId: 71, receivedQty: 8 }],
      varianceReason: 'نقصت وحدتان أثناء النقل',
      approvalSecret: 'approver-password',
    });
    expect(mockHttp).toHaveBeenCalledTimes(1);
    const [path, init] = mockHttp.mock.calls[0] as [string, { body: string }];
    expect(path).toBe('/api/stock-transfers/7/receive');
    expect(JSON.parse(init.body)).toEqual({
      items: [{ itemId: 71, receivedQty: 8 }],
      varianceReason: 'نقصت وحدتان أثناء النقل',
      approvalSecret: 'approver-password',
    });
  });
});
