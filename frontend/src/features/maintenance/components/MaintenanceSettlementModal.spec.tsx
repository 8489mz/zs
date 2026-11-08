/* MaintenanceSettlementModal — D-M1-1: NO discount concept. The final agreed
 * amount is the revenue: the operator edits the final amount, the amount to
 * collect is derived (final − advance) and shown, never edited, and the
 * chosen payment method is passed through on confirm. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MaintenanceSettlementModal } from '@/features/maintenance/components/MaintenanceSettlementModal';
import type { MaintenancePaymentMethod } from '@/features/maintenance/api/maintenance.api';
import type { MaintenanceTicket } from '@/types/domain-models/maintenance';

const TICKET: MaintenanceTicket = {
  id: 't1',
  ticketNo: 'ZM-261108-0001',
  customerId: null,
  customerName: 'أحمد',
  customerPhone: '01000000000',
  deviceBrand: 'Samsung',
  deviceModel: 'Galaxy A54',
  serialNumber: '123456789012345',
  passcode: null,
  problemDescription: 'شاشة مكسورة',
  deviceCondition: null,
  expectedCost: 1000,
  finalCost: 800,
  advancePayment: 300,
  status: 'repaired',
  technicianId: null,
  technicianName: null,
  technicianNotes: null,
  branchId: null,
  locationId: null,
  saleId: null,
  warrantyDays: 30,
  receivedAt: '2026-11-08T10:00:00.000Z',
  repairedAt: null,
  deliveredAt: null,
  createdAt: '2026-11-08T10:00:00.000Z',
  parts: [],
};

function renderModal(onConfirm = vi.fn()) {
  const user = userEvent.setup();
  const view = render(
    <MaintenanceSettlementModal
      settlementTicket={TICKET}
      onClose={vi.fn()}
      onConfirm={onConfirm}
      isPending={false}
    />,
  );
  return { ...view, user, onConfirm };
}

async function finalAmountInput() {
  const input = await screen.findByLabelText(/المبلغ النهائي المتفق عليه/) as HTMLInputElement;
  await waitFor(() => expect(input.value).toBe('800'));
  return input;
}

describe('MaintenanceSettlementModal final-amount settlement', () => {
  it('shows no discount UI anywhere', async () => {
    renderModal();
    await finalAmountInput();
    expect(screen.queryByText(/خصم/)).not.toBeInTheDocument();
    expect(screen.queryByText(/فرق/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('خصم');
  });

  it('defaults the final amount to finalCost and derives the amount to collect', async () => {
    renderModal();
    const input = await finalAmountInput();
    expect(input).toHaveValue(800);
    // Only one number input exists: the final amount. The amount to collect
    // is displayed text, never an editable field. (Amounts render next to a
    // currency symbol element, so assert on the rendered text, not one node.)
    expect(document.querySelectorAll('input[type="number"]')).toHaveLength(1);
    expect(screen.getByText('المطلوب تحصيله')).toBeInTheDocument();
    expect(document.body.textContent).toContain('500.00');
  });

  it('recomputes the derived collection when the final amount changes', async () => {
    const { user } = renderModal();
    const input = await finalAmountInput();
    await user.clear(input);
    await user.type(input, '900');
    await waitFor(() => expect(document.body.textContent).toContain('600.00'));
    expect(document.body.textContent).toContain('900.00');
  });

  it('passes final amount, derived collection and payment method on confirm', async () => {
    const { user, onConfirm } = renderModal();
    const input = await finalAmountInput();
    await user.clear(input);
    await user.type(input, '900');
    const method = screen.getByLabelText(/طريقة الدفع/) as HTMLSelectElement;
    await user.selectOptions(method, 'card');
    await user.click(screen.getByRole('button', { name: /تأكيد التحصيل والتسليم النهائي/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(900, 600, 'card' as MaintenancePaymentMethod);
  });

  it('confirms with cash by default and the unchanged final amount', async () => {
    const { user, onConfirm } = renderModal();
    await finalAmountInput();
    await user.click(screen.getByRole('button', { name: /تأكيد التحصيل والتسليم النهائي/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(800, 500, 'cash'));
  });

  it('blocks confirm when the final amount is below the advance already paid', async () => {
    const { user, onConfirm } = renderModal();
    const input = await finalAmountInput();
    await user.clear(input);
    await user.type(input, '200');
    await waitFor(() =>
      expect(screen.getByText(/المبلغ النهائي لا يمكن أن يكون أقل من العربون/)).toBeInTheDocument(),
    );
    const confirm = screen.getByRole('button', { name: /تأكيد التحصيل والتسليم النهائي/ });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
