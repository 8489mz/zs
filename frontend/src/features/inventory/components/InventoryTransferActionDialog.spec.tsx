/*
 * Pins the short-transfer-receipt reason plumbing (INV-SHORT-TRANSFER-RECEIPT-REASON).
 *
 * THE GAP: the backend rejects any short receipt without a written variance
 * reason of at least 8 characters (TRANSFER_VARIANCE_REASON_REQUIRED), but
 * the receipt dialog never collected or sent one, so a merchant receiving
 * less than dispatched had to falsely receive 100% (phantom stock, no
 * shrinkage journal) or cancel the whole transfer.
 *
 * WHAT THIS PINS, driving the REAL dialog and the REAL api wrapper
 * (revised by the spirit-of-law decision Q4, INV-SPIRIT-TRANSFER-RECEIPT-PARTIAL):
 * - typing a received quantity below dispatched reveals a per-transfer
 *   variance-reason field, but the reason is OPTIONAL: confirming
 *   without one calls onConfirm with no reason, and the shortage is
 *   recorded pending a reason; a short one-word reason is sent as-is.
 * - a supplied reason is passed to onConfirm keyed by transfer id,
 *   alongside the receipt rows; a full receipt needs no reason and
 *   sends none.
 * - with two transfers in one batch, only the short one shows (and
 *   carries) a reason field.
 * - inventoryApi.receiveStockTransfer serialises varianceReason into the
 *   POST body the backend already accepts.
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

describe('short transfer receipt variance reason', () => {
  it('confirms a short receipt without a reason, and sends a short reason as-is', () => {
    const onConfirm = renderDialog([makeTransfer('7', 'TR-260104-0007', 10)]);
    const qtyInput = screen.getByLabelText(/الكمية المستلمة/);
    fireEvent.change(qtyInput, { target: { value: '8' } });

    const reasonInput = screen.getByLabelText(/سبب فرق الكمية/);
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الاستلام/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      { '7': [{ itemId: 71, receivedQty: 8 }] },
      {},
    );

    fireEvent.change(reasonInput, { target: { value: 'ناقص' } });
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الاستلام/ }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledWith(
      { '7': [{ itemId: 71, receivedQty: 8 }] },
      { '7': 'ناقص' },
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
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الاستلام/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      { '7': [{ itemId: 71, receivedQty: 8 }], '8': [{ itemId: 81, receivedQty: 5 }] },
      { '7': 'كسرت ثلاث وحدات في الطريق' },
    );
  });

  it('sends varianceReason in the receive request body', async () => {
    await inventoryApi.receiveStockTransfer('7', undefined, {
      items: [{ itemId: 71, receivedQty: 8 }],
      varianceReason: 'نقصت وحدتان أثناء النقل',
    });
    expect(mockHttp).toHaveBeenCalledTimes(1);
    const [path, init] = mockHttp.mock.calls[0] as [string, { body: string }];
    expect(path).toBe('/api/stock-transfers/7/receive');
    expect(JSON.parse(init.body)).toEqual({
      items: [{ itemId: 71, receivedQty: 8 }],
      varianceReason: 'نقصت وحدتان أثناء النقل',
    });
  });
});
