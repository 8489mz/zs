/* Raw-date display (INV-RAW-DATE-DISPLAY): the installments schedule
 * renders due dates with the shared formatter, never raw ISO text —
 * a due date of 2026-12-05T00:00:00.000Z shows as 2026/12/05.
 * Renders the REAL InstallmentsScheduleTable.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InstallmentsScheduleTable } from './InstallmentsScheduleTable';
import type { CustomerInstallmentItem } from '@/features/sales/api/installments.api';

const installment: CustomerInstallmentItem = {
  id: 1,
  plan_id: 10,
  plan_number: 'INST-261105-0002',
  customer_id: 5,
  customer_name: 'عميل اختبار',
  customer_phone: '01000000000',
  installment_number: 1,
  installment_count: 3,
  due_date: '2026-12-05T00:00:00.000Z',
  amount: 100,
  paid_amount: 0,
  status: 'pending',
  paid_at: null,
  payment_method: 'cash',
  receipt_no: null,
  notes: '',
};

const renderTable = (installments: CustomerInstallmentItem[]) =>
  render(
    <InstallmentsScheduleTable
      isLoading={false}
      installments={installments}
      onPay={vi.fn()}
      onSendReminder={vi.fn()}
    />,
  );

describe('Installments schedule table due dates', () => {
  it('shows the due date formatted, never raw ISO', async () => {
    renderTable([installment]);

    expect(await screen.findByText('2026/12/05')).toBeTruthy();
    expect(screen.queryByText('2026-12-05T00:00:00.000Z')).toBeNull();
    expect(document.body.textContent).not.toContain('T00:00:00');
  });

  it('formats every row in the schedule', async () => {
    renderTable([
      installment,
      { ...installment, id: 2, installment_number: 2, due_date: '2027-01-05T00:00:00.000Z' },
    ]);

    expect(await screen.findByText('2026/12/05')).toBeTruthy();
    expect(await screen.findByText('2027/01/05')).toBeTruthy();
    expect(document.body.textContent).not.toContain('T00:00:00');
  });
});
