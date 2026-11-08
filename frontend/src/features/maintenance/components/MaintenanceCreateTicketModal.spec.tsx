/* M1-P4: intake modal validation surfaces specific toasts and never submits an
 * advance bigger than the estimate. Drives the real MaintenanceCreateTicketModal:
 * missing required fields toast the missing field names and do not call create;
 * advance > expectedCost toasts both amounts and does not call create (including
 * the advance-with-no-estimate edge, expectedCost 0); advance <= expectedCost
 * proceeds to maintenanceApi.create with the payload unchanged. */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MaintenanceCreateTicketModal } from '@/features/maintenance/components/MaintenanceCreateTicketModal';
import { getMaintenanceProfile } from '@/features/maintenance/constants/maintenance-profiles';
import type { MaintenanceTicket } from '@/types/domain-models/maintenance';

const { createMock, getMock, toastErrorMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  getMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/features/maintenance/api/maintenance.api', () => ({
  maintenanceApi: {
    create: createMock,
    get: getMock,
  },
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: {
    error: toastErrorMock,
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

const TICKET: MaintenanceTicket = {
  id: '1',
  ticketNo: 'ZM-261108-0001',
  customerName: 'أحمد محمد',
  customerPhone: '01012345678',
  deviceBrand: 'Apple',
  deviceModel: 'iPhone 15',
  serialNumber: null,
  passcode: null,
  problemDescription: 'الشاشة مكسورة',
  deviceCondition: null,
  expectedCost: 300,
  finalCost: 300,
  advancePayment: 100,
  status: 'received',
  technicianId: null,
  technicianName: null,
  technicianNotes: null,
  branchId: null,
  locationId: null,
  saleId: null,
  warrantyDays: 30,
  receivedAt: '2026-11-08T00:00:00.000Z',
  repairedAt: null,
  deliveredAt: null,
  createdAt: '2026-11-08T00:00:00.000Z',
  parts: [],
};

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const view = render(
    <MaintenanceCreateTicketModal
      open
      onClose={onClose}
      onSuccess={onSuccess}
      maintenanceProfile={getMaintenanceProfile('mobile')}
    />,
    { wrapper: Wrapper },
  );
  return { ...view, onClose, onSuccess };
}

function fillRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText('الاسم الثلاثي أو الثنائي'), {
    target: { value: 'أحمد محمد' },
  });
  fireEvent.change(screen.getByPlaceholderText('01012345678'), {
    target: { value: '01012345678' },
  });
  fireEvent.change(screen.getByPlaceholderText('مثال: Apple...'), {
    target: { value: 'iPhone 15' },
  });
  fireEvent.change(screen.getByPlaceholderText('مثال: الشاشة مكسورة، الجهاز لا يشحن...'), {
    target: { value: 'الشاشة مكسورة' },
  });
}

function setMoney(expectedCost: string, advancePayment: string) {
  const [expectedInput, advanceInput] = screen.getAllByPlaceholderText('0.00');
  fireEvent.change(expectedInput, { target: { value: expectedCost } });
  fireEvent.change(advanceInput, { target: { value: advancePayment } });
}

function submitForm() {
  const submitButton = screen.getByRole('button', { name: /حفظ واستخراج إيصال الاستلام/ });
  const form = submitButton.closest('form');
  if (!form) throw new Error('submit button is not inside a form');
  fireEvent.submit(form);
}

describe('MaintenanceCreateTicketModal (M1-P4)', () => {
  beforeEach(() => {
    createMock.mockReset();
    getMock.mockReset();
    toastErrorMock.mockReset();
    createMock.mockResolvedValue({ ok: true, id: '1', ticketNo: 'ZM-261108-0001' });
    getMock.mockResolvedValue({ ticket: TICKET });
  });

  it('toasts the missing field names and does not call create when required fields are empty', () => {
    renderModal();
    submitForm();
    expect(createMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    const message = String(toastErrorMock.mock.calls[0][0]);
    expect(message).toContain('اسم العميل');
    expect(message).toContain('الهاتف');
    expect(message).toContain('موديل الجهاز');
    expect(message).toContain('وصف العطل');
  });

  it('blocks advance > estimate with a toast naming both amounts and does not call create', () => {
    renderModal();
    fillRequiredFields();
    setMoney('300', '500');
    submitForm();
    expect(createMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    const message = String(toastErrorMock.mock.calls[0][0]);
    expect(message).toContain('500.00');
    expect(message).toContain('300.00');
  });

  it('blocks an advance with no estimate (expectedCost 0, advance > 0)', () => {
    renderModal();
    fillRequiredFields();
    setMoney('0', '50');
    submitForm();
    expect(createMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    const message = String(toastErrorMock.mock.calls[0][0]);
    expect(message).toContain('50.00');
    expect(message).toContain('0.00');
  });

  it('proceeds to create with the payload unchanged when advance <= estimate', async () => {
    const { onSuccess } = renderModal();
    fillRequiredFields();
    setMoney('300', '100');
    submitForm();
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ expectedCost: 300, advancePayment: 100 }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(TICKET));
  });
});
