/*
 * INV-REST-TIP-STAFF-REAL (R6-D): the tip modal's staff list was hardcoded
 * fake ids (1-5: أحمد محمود، محمد سعيد، كريم عادل، عمر ياسين، الشيف
 * إبراهيم) and handleAddStaff invented employeeId: Date.now() for a
 * typed-in name — neither is a person, and the server validates every id
 * against hr_employees, so a pool built on them could never save. The
 * modal now reads a real picker fed by the restaurant-scoped staff list
 * (GET /api/sales/restaurant/staff — active employees, id + displayName
 * + branchId + expectedDailyHours only): the HR endpoint
 * /api/hr/employees is NOT used because it requires hrEmployees or
 * hrAttendance, which the manager caller who opens this modal (admin
 * role, or pos_manager / manage_restaurant) does not necessarily hold.
 *
 * What this pins, against the real modal with the api module mocked:
 * - the REAL employee names from the staff query render; the five fake
 *   names appear nowhere (base-red: at base the modal renders the fakes
 *   with no network call at all — getTipPoolStaff is never called).
 * - an empty staff query shows the empty state and the save button is
 *   disabled (the server requires >= 1 staff member, NO_STAFF_SELECTED).
 * - inactive employees are excluded from the picker options.
 * - adding a picked employee sends its REAL numeric employeeId
 *   (Number(id)), employeeName: displayName, the per-person role select
 *   (default waiter), and hoursWorked from expectedDailyHours ?? 8 —
 *   never an invented id.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosTipPoolModal } from './PosTipPoolModal';
import { createTestQueryClient } from '@/test/test-query-client';

const { getTipPoolStaffMock, calculateTipPoolMock } = vi.hoisted(() => ({
  getTipPoolStaffMock: vi.fn(),
  calculateTipPoolMock: vi.fn(),
}));

vi.mock('@/features/pos/api/restaurant-advanced-fnb.api', () => ({
  restaurantAdvancedFnbApi: {
    getTipPoolStaff: getTipPoolStaffMock,
    calculateTipPool: calculateTipPoolMock,
  },
}));

const FAKE_NAMES = ['أحمد محمود', 'محمد سعيد', 'كريم عادل', 'عمر ياسين', 'الشيف إبراهيم'];

const STAFF = [
  { id: '7', displayName: 'سارة أحمد', branchId: '1', expectedDailyHours: 6, status: 'active' },
  { id: '9', displayName: 'خالد علي', branchId: '1', expectedDailyHours: null, status: 'active' },
  { id: '11', displayName: 'منى حسن', branchId: '2', expectedDailyHours: 8, status: 'inactive' },
];

function mockStaff(rows: typeof STAFF) {
  getTipPoolStaffMock.mockResolvedValue(rows);
  calculateTipPoolMock.mockResolvedValue({ pool: {}, distributions: [], totalTips: 150 });
}

function renderModal() {
  const queryClient = createTestQueryClient();
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <PosTipPoolModal open onClose={onClose} initialCashTips={100} initialCardTips={50} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

async function addEmployee(displayName: string, employeeId: string) {
  const picker = screen.getByLabelText('اختر موظفاً من القائمة');
  fireEvent.change(picker, { target: { value: employeeId } });
  fireEvent.click(screen.getByRole('button', { name: 'إضافة' }));
  await waitFor(() => expect(screen.getByText(displayName)).toBeInTheDocument());
}

async function savePool() {
  fireEvent.click(screen.getByRole('button', { name: /حفظ مجمع الإكراميات/ }));
  await waitFor(() => expect(calculateTipPoolMock).toHaveBeenCalled());
  return calculateTipPoolMock.mock.calls[0][0];
}

describe('PosTipPoolModal staff picker (INV-REST-TIP-STAFF-REAL)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the REAL employee names from the staff query; the five fake names appear nowhere', async () => {
    mockStaff(STAFF);
    renderModal();
    await waitFor(() => expect(screen.getByText('سارة أحمد')).toBeInTheDocument());
    expect(screen.getByText('خالد علي')).toBeInTheDocument();
    expect(getTipPoolStaffMock).toHaveBeenCalledTimes(1);
    for (const fake of FAKE_NAMES) {
      expect(screen.queryByText(fake)).not.toBeInTheDocument();
    }
    expect(screen.getByRole('option', { name: 'سارة أحمد' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'خالد علي' })).toBeInTheDocument();
  });

  it('staff query empty → empty state and the save button is disabled', async () => {
    mockStaff([]);
    renderModal();
    await waitFor(() =>
      expect(screen.getByText('لا يوجد موظفون نشطون — لا يمكن حفظ مجمع إكراميات بدون طاقم')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /حفظ مجمع الإكراميات/ })).toBeDisabled();
    expect(calculateTipPoolMock).not.toHaveBeenCalled();
  });

  it('inactive employees are excluded from the picker', async () => {
    mockStaff(STAFF);
    renderModal();
    await waitFor(() => expect(screen.getByText('سارة أحمد')).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'منى حسن' })).not.toBeInTheDocument();
    expect(screen.queryByText('منى حسن')).not.toBeInTheDocument();
  });

  it('adding a picked employee sends its REAL numeric employeeId, displayName, default waiter role and expectedDailyHours', async () => {
    mockStaff(STAFF);
    renderModal();
    await waitFor(() => expect(screen.getByText('سارة أحمد')).toBeInTheDocument());
    // The per-person role select defaults to waiter before anything is picked.
    expect(screen.getByLabelText('الدور الوظيفي للموظف المختار')).toHaveValue('waiter');
    await addEmployee('سارة أحمد', '7');
    // A picked employee leaves the picker: the same person cannot be added twice.
    expect(screen.queryByRole('option', { name: 'سارة أحمد' })).not.toBeInTheDocument();
    const dto = await savePool();
    expect(dto.staff).toHaveLength(1);
    expect(dto.staff[0].employeeId).toBe(7);
    expect(typeof dto.staff[0].employeeId).toBe('number');
    expect(dto.staff[0].employeeName).toBe('سارة أحمد');
    expect(dto.staff[0].roleName).toBe('waiter');
    expect(dto.staff[0].hoursWorked).toBe(6);
  });

  it('hoursWorked defaults to 8 when the employee has no expectedDailyHours', async () => {
    mockStaff(STAFF);
    renderModal();
    await waitFor(() => expect(screen.getByText('خالد علي')).toBeInTheDocument());
    await addEmployee('خالد علي', '9');
    const dto = await savePool();
    expect(dto.staff).toHaveLength(1);
    expect(dto.staff[0].employeeId).toBe(9);
    expect(dto.staff[0].employeeName).toBe('خالد علي');
    expect(dto.staff[0].hoursWorked).toBe(8);
  });
});
