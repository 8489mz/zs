/* Delivered maintenance tickets are fully settled by construction: delivery
 * enforces remaining + advance = finalCost server-side (422
 * MAINTENANCE_SETTLEMENT_MISMATCH otherwise), so the list row must show
 * the full cost as paid and zero remaining ("خالص"), never the advance-only
 * "مسدد: 100 / متبقي: 200" the old formula produced for the live ticket
 * ZM-261108-0002 (final 300, advance 100, delivered). Terminal tickets
 * (cancelled / unrepairable) hold nothing collectible either: a terminal
 * transition refunds any advance first, so they must never show the
 * pre-refund advance as paid nor a remaining balance. Open tickets keep
 * the advance-only paid figure and the remaining balance. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MaintenanceTicketsTable } from '@/features/maintenance/components/tickets/MaintenanceTicketsTable';
import type { MaintenanceTicket } from '@/types/domain-models/maintenance';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

function ticket(overrides: Partial<MaintenanceTicket>): MaintenanceTicket {
  return {
    id: 't1',
    ticketNo: 'ZM-261108-0002',
    customerId: null,
    customerName: 'عميل الاختبار',
    customerPhone: '01000000000',
    deviceBrand: 'Samsung',
    deviceModel: 'Galaxy A54',
    serialNumber: '123456789012345',
    passcode: null,
    problemDescription: 'شاشة مكسورة',
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
    receivedAt: '2026-11-08T10:00:00.000Z',
    repairedAt: null,
    deliveredAt: null,
    createdAt: '2026-11-08T10:00:00.000Z',
    parts: [],
    ...overrides,
  };
}

function renderTable(tickets: MaintenanceTicket[]) {
  render(
    <MaintenanceTicketsTable
      isLoading={false}
      isError={false}
      tickets={tickets}
      totalItems={tickets.length}
      page={1}
      totalPages={1}
      setPage={vi.fn()}
      serialLabel="السيريال"
      copiedPhone={null}
      onCopyPhone={vi.fn()}
      onOpenDetail={vi.fn()}
      onOpenReceipt={vi.fn()}
      onOpenSettlement={vi.fn()}
      onChangeStatus={vi.fn()}
      getStatusMeta={() => ({ label: 'x', bg: '#ffffff', color: '#000000', border: '#000000' })}
      formatDate={(dt) => dt}
    />,
  );
}

function rowFor(ticketNo: string): HTMLElement {
  const row = screen.getByText(ticketNo).closest('tr');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

describe('MaintenanceTicketsTable financial cell', () => {
  it('delivered ticket (final 300, advance 100) shows paid 300, remaining 0, خالص, no red remaining badge', () => {
    renderTable([ticket({ status: 'delivered', finalCost: 300, advancePayment: 100 })]);
    const row = rowFor('ZM-261108-0002');
    expect(row.textContent).toContain('300.00');
    expect(row.textContent).toContain('مسدد: 300');
    expect(row.textContent).not.toContain('متبقي');
    expect(row.textContent).toContain('خالص');
  });

  it('open ticket (final 300, advance 100) still shows paid 100 and remaining 200', () => {
    renderTable([ticket({ status: 'received', finalCost: 300, advancePayment: 100 })]);
    const row = rowFor('ZM-261108-0002');
    expect(row.textContent).toContain('مسدد: 100');
    expect(row.textContent).toContain('متبقي: 200');
    expect(row.textContent).not.toContain('خالص');
    const remainingBadge = screen.getByText(/متبقي:/);
    expect(remainingBadge).not.toBeNull();
    expect((remainingBadge as HTMLElement).style.background).toBe('rgb(255, 251, 235)');
  });

  it('ready-for-delivery ticket keeps the open-ticket figures', () => {
    renderTable([ticket({ status: 'repaired', finalCost: 300, advancePayment: 100 })]);
    const row = rowFor('ZM-261108-0002');
    expect(row.textContent).toContain('مسدد: 100');
    expect(row.textContent).toContain('متبقي: 200');
    expect(row.textContent).not.toContain('خالص');
  });

  it('cancelled ticket with a refunded advance shows neither paid nor remaining', () => {
    renderTable([ticket({ status: 'cancelled', finalCost: 300, advancePayment: 100 })]);
    const row = rowFor('ZM-261108-0002');
    expect(row.textContent).not.toContain('مسدد');
    expect(row.textContent).not.toContain('متبقي');
    expect(row.textContent).toContain('خالص');
  });

  it('unrepairable ticket with no advance shows neither paid nor remaining', () => {
    renderTable([ticket({ status: 'unrepairable', finalCost: 300, advancePayment: 0 })]);
    const row = rowFor('ZM-261108-0002');
    expect(row.textContent).not.toContain('مسدد');
    expect(row.textContent).not.toContain('متبقي');
    expect(row.textContent).toContain('خالص');
  });

  it('delivered free repair (final 0, expected 300, advance 0) shows 0.00 and خالص', () => {
    renderTable([ticket({ status: 'delivered', finalCost: 0, expectedCost: 300, advancePayment: 0 })]);
    const row = rowFor('ZM-261108-0002');
    expect(row.textContent).toContain('0.00');
    expect(row.textContent).not.toContain('مسدد');
    expect(row.textContent).not.toContain('متبقي');
    expect(row.textContent).toContain('خالص');
  });
});
