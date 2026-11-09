/* R-B14 (INV-REST-EXPRESS-AMOUNT-SYNC): the express checkout's "received"
 * cash amount lived only in the section's local state (customCashInput).
 * Only tenderedAmount was synced to workspace state; the legs (cashAmount /
 * cardAmount) were set only inside the synchronous confirm handler — one
 * render too late, because handleSubmit reads the legs from render-captured
 * params — and the F2 path never set them at all. The live harm: a typed
 * underpayment (e.g. 50 on a 127 total) posted as FULLY PAID, because the leg
 * still held the preset-time total (127) while tendered carried 50.
 *
 * The fix syncs the legs in the same effect that already syncs tenderedAmount,
 * from the same source of truth (effectiveReceivedCash / total), on every
 * change of the received amount or the active preset — so by the time confirm
 * runs (button or F2), handleSubmit's render-captured params are already
 * correct. These tests assert the sync happens on INPUT CHANGE, before any
 * confirm click: that pre-confirm sync is exactly the precondition F2 needs,
 * since the dialog's F2 handler calls confirm with no amount of its own.
 *
 * The mount sync is not new behaviour: setPaymentPreset('cash'/'card')
 * already fills the leg to the total at preset selection (including dialog
 * open); the effect only keeps that same value true while the section is
 * mounted. When neither cash nor card is active (credit / wallet / a
 * detailed-view split), the effect leaves the legs untouched — credit legs
 * are zeroed by the workspace itself and a split is the detailed view's
 * business until express confirm overwrites it, exactly as today. */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PosCheckoutExpressSection } from './PosCheckoutExpressSection';

const TOTAL = 127;

function createMockPos() {
  return {
    totals: { total: TOTAL },
    cart: [{ id: 1, name: 'برجر', qty: 1, price: TOTAL }],
    settings: { currency: 'EGP' },
    settingsQuery: { data: { currency: 'EGP' } },
    createSale: { isPending: false },
    canSubmitSale: true,
    canSubmitHint: '',
    paymentType: 'cash',
    customerId: '',
    note: '',
    setNote: vi.fn(),
    setCashAmount: vi.fn(),
    setCardAmount: vi.fn(),
    setTransferAmount: vi.fn(),
    setTenderedAmount: vi.fn(),
    setPaymentChannel: vi.fn(),
    setTerminalPaymentDetails: vi.fn(),
  };
}

function renderSection(mockPos: ReturnType<typeof createMockPos>, activePreset: 'cash' | 'card' | 'none') {
  const confirmSaleMock = vi.fn();
  render(
    <PosCheckoutExpressSection
      pos={mockPos as any}
      isKwdStore={false}
      isKsaStore={false}
      isPaymentActive={(preset) => (activePreset === 'none' ? false : preset === activePreset)}
      onSelectPaymentPreset={vi.fn()}
      onConfirmSale={confirmSaleMock}
      onSwitchToDetailed={vi.fn()}
      selectedCustomerName="عميل نقدي"
      onOpenCustomerPicker={vi.fn()}
      onOpenNotes={vi.fn()}
      isNotesOpen={false}
      cartQtySummaries={['1 قطعة']}
    />,
  );
  return confirmSaleMock;
}

describe('PosCheckoutExpressSection - received amount synced to workspace state (R-B14)', () => {
  it('syncs a typed custom amount to the cash leg on input change, before any confirm', () => {
    const mockPos = createMockPos();
    const confirmSaleMock = renderSection(mockPos, 'cash');

    const input = screen.getByPlaceholderText(String(TOTAL));
    fireEvent.change(input, { target: { value: '500' } });

    // No confirm click happened yet — the leg must already be correct,
    // because handleSubmit reads render-captured params at confirm time.
    expect(confirmSaleMock).not.toHaveBeenCalled();
    expect(mockPos.setCashAmount).toHaveBeenCalledWith(500);
    expect(mockPos.setCardAmount).toHaveBeenCalledWith(0);
    expect(mockPos.setTransferAmount).toHaveBeenCalledWith(0);
    expect(mockPos.setTenderedAmount).toHaveBeenCalledWith(500);
  });

  it('re-syncs the cash leg back to the total when the custom input is cleared', () => {
    const mockPos = createMockPos();
    renderSection(mockPos, 'cash');

    const input = screen.getByPlaceholderText(String(TOTAL));
    fireEvent.change(input, { target: { value: '500' } });
    expect(mockPos.setCashAmount).toHaveBeenCalledWith(500);

    fireEvent.change(input, { target: { value: '' } });
    expect(mockPos.setCashAmount).toHaveBeenCalledWith(TOTAL);
    expect(mockPos.setTenderedAmount).toHaveBeenCalledWith(TOTAL);
  });

  it('syncs the cash leg when a banknote shortcut is tapped, before any confirm', () => {
    const mockPos = createMockPos();
    renderSection(mockPos, 'cash');

    fireEvent.click(screen.getByRole('button', { name: '200' }));

    expect(mockPos.setCashAmount).toHaveBeenCalledWith(200);
    expect(mockPos.setTenderedAmount).toHaveBeenCalledWith(200);
  });

  it('syncs the card leg to the total while the card preset is active', () => {
    const mockPos = createMockPos();
    renderSection(mockPos, 'card');

    // The card amount is the total (no typed amount exists on this path);
    // it must be in state before confirm, because the dialog auto-selects
    // the card preset on open without any later set-amount call, and F2
    // confirms with no amount of its own.
    expect(mockPos.setCardAmount).toHaveBeenCalledWith(TOTAL);
    expect(mockPos.setCashAmount).toHaveBeenCalledWith(0);
    expect(mockPos.setTransferAmount).toHaveBeenCalledWith(0);
  });

  it('syncs a typed 0 as 0 and never resurrects the total at confirm', () => {
    const mockPos = createMockPos();
    const confirmSaleMock = renderSection(mockPos, 'cash');

    const input = screen.getByPlaceholderText(String(TOTAL));
    fireEvent.change(input, { target: { value: '0' } });
    expect(mockPos.setCashAmount).toHaveBeenCalledWith(0);

    // The mount sync legitimately wrote the total before anything was
    // typed; the assertion below only covers calls after typing 0.
    mockPos.setCashAmount.mockClear();
    const confirmButton = screen.getByRole('button', { name: /تأكيد البيع والطباعة/i });
    fireEvent.click(confirmButton);
    expect(confirmSaleMock).toHaveBeenCalledWith(0);
    // The old confirm handler wrote `effectiveReceivedCash || total`,
    // turning an explicit 0 into a full payment after submit was blocked.
    expect(mockPos.setCashAmount).toHaveBeenCalledWith(0);
    expect(mockPos.setCashAmount).not.toHaveBeenCalledWith(TOTAL);
  });

  it('confirms the typed amount with the leg already synced before the click', () => {
    const mockPos = createMockPos();
    const confirmSaleMock = renderSection(mockPos, 'cash');

    const input = screen.getByPlaceholderText(String(TOTAL));
    fireEvent.change(input, { target: { value: '500' } });
    expect(mockPos.setCashAmount).toHaveBeenCalledWith(500);

    const confirmButton = screen.getByRole('button', { name: /تأكيد البيع والطباعة/i });
    fireEvent.click(confirmButton);
    expect(confirmSaleMock).toHaveBeenCalledWith(500);
    expect(mockPos.setCashAmount).toHaveBeenLastCalledWith(500);
  });

  it('leaves the legs untouched when neither cash nor card is active', () => {
    const mockPos = createMockPos();
    renderSection(mockPos, 'none');

    // Credit legs are zeroed by the workspace itself and a detailed-view
    // split belongs to the detailed view until express confirm overwrites
    // it — the sync effect must not destroy either.
    expect(mockPos.setTenderedAmount).toHaveBeenCalledWith(0);
    expect(mockPos.setCashAmount).not.toHaveBeenCalled();
    expect(mockPos.setCardAmount).not.toHaveBeenCalled();
    expect(mockPos.setTransferAmount).not.toHaveBeenCalled();
  });
});
