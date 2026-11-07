/*
New file: frontend/src/features/hr/pages/HrLeavesPage.spec.tsx
Pins the leaves-page default filter (INV-LEAVES-FILTER).

THE GAP: the leaves page mounted with the "pending review" quick filter
active (useState('pending')), so on a tenant with no pending requests the
table opened empty even though requests existed — the live test10k case was
one approved request and zero pending, so the page showed "no matching
results" on open.

THE RULE: the page opens on the "all" filter, so whatever requests exist
are visible immediately. The user can still narrow to "pending" from the
toolbar / KPI tiles afterwards.

WHAT THIS PINS, driving the REAL HrLeavesPage (hooks mocked at the
boundary, the page / filter / table all real):
- With only an approved request present (the live test10k shape), the
  approved request is visible on mount and no empty-filter message shows.
- With a pending and an approved request present, both are visible on
  mount.
*/

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HrLeavesPage } from '@/features/hr/pages/HrLeavesPage';

const hrMocks = vi.hoisted(() => ({
  leaveRequests: vi.fn(),
  leaveTypes: vi.fn(),
  workspace: vi.fn(),
  mutations: vi.fn(),
}));

vi.mock('@/features/hr/hooks/useHr', () => ({
  useHrLeaveRequests: (...args: unknown[]) => hrMocks.leaveRequests(...args),
  useHrLeaveTypes: (...args: unknown[]) => hrMocks.leaveTypes(...args),
  useHrWorkspace: (...args: unknown[]) => hrMocks.workspace(...args),
  useHrMutations: (...args: unknown[]) => hrMocks.mutations(...args),
}));

function requestRow(overrides: Record<string, unknown>) {
  return {
    id: '1',
    employeeId: '7',
    employeeNo: 'E-7',
    employeeName: 'موظف معتمد',
    leaveTypeId: '1',
    leaveTypeName: 'سنوية',
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    daysCount: 2,
    status: 'approved',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <HrLeavesPage />
    </MemoryRouter>,
  );
}

describe('HrLeavesPage default filter', () => {
  beforeEach(() => {
    hrMocks.leaveTypes.mockReturnValue({ data: { rows: [] }, isLoading: false, isError: false });
    hrMocks.workspace.mockReturnValue({ employees: { data: { employees: [] } } });
    hrMocks.mutations.mockReturnValue({
      createLeaveRequest: { mutateAsync: vi.fn(), isPending: false },
      approveLeaveRequest: { mutate: vi.fn(), isPending: false },
      rejectLeaveRequest: { mutateAsync: vi.fn(), isPending: false },
      cancelLeaveRequest: { mutate: vi.fn(), isPending: false },
    });
  });

  it('shows the existing approved request on open when nothing is pending (live test10k shape)', () => {
    hrMocks.leaveRequests.mockReturnValue({
      data: { requests: [requestRow({})] },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderPage();

    expect(screen.getByText('موظف معتمد')).toBeInTheDocument();
    expect(screen.queryByText('لا توجد نتائج مطابقة للفلاتر الحالية.')).not.toBeInTheDocument();
  });

  it('shows both pending and approved requests on open', () => {
    hrMocks.leaveRequests.mockReturnValue({
      data: {
        requests: [
          requestRow({}),
          requestRow({ id: '2', employeeNo: 'E-8', employeeName: 'موظف قيد المراجعة', status: 'pending' }),
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderPage();

    expect(screen.getByText('موظف معتمد')).toBeInTheDocument();
    expect(screen.getByText('موظف قيد المراجعة')).toBeInTheDocument();
  });
});
