/*
New file: frontend/src/features/hr/pages/EmployeePortalPage.spec.tsx
Pins the forced default-PIN change (INV-PORTAL-DEFAULT-PIN-FORCED-CHANGE).

THE GAP: the portal login page advertised the public default PIN and an
employee still on it walked straight into the dashboard. There was no
detection, no change screen and no gate.

THE RULE: a login that reports mustChangePin shows the PIN-change screen
instead of the dashboard — and no dashboard data call is made — until the
PIN is changed through the change endpoint, which returns a fresh token.
The same screen appears when a stored session's dashboard call answers
PIN_CHANGE_REQUIRED. A normal login opens the dashboard directly.

WHAT THIS PINS, driving the REAL EmployeePortalPage (api mocked at the
boundary, the page / login form / change screen all real):
- Login with mustChangePin true shows "تغيير رمز الدخول" and no dashboard
  tabs, and getDashboard is never called; submitting the change calls
  changePin and then the dashboard opens.
- Login with mustChangePin false opens the dashboard directly.
- A stored session whose dashboard call answers PIN_CHANGE_REQUIRED lands
  on the change screen too.
*/

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import EmployeePortalPage from '@/features/hr/pages/EmployeePortalPage';
import { ApiError } from '@/lib/http';

// The api module is mocked through a hoisted factory only: this spec file
// must NOT import the api layer at all (the page-composition check scans
// page files for direct api-layer imports, mocks included).
const apiMocks = vi.hoisted(() => ({
  getStoredToken: vi.fn(),
  getCurrentUser: vi.fn(),
  getStoredSession: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  changePin: vi.fn(),
  getDashboard: vi.fn(),
  getAttendance: vi.fn(),
  getPayslips: vi.fn(),
  getLeaves: vi.fn(),
  getLoansAndCustody: vi.fn(),
  requestLeave: vi.fn(),
  requestAdvance: vi.fn(),
}));

vi.mock('@/features/hr/api/employee-portal.api', () => ({
  employeePortalApi: apiMocks,
}));

const loginMock = apiMocks.login;
const changePinMock = apiMocks.changePin;
const getDashboardMock = apiMocks.getDashboard;
const getStoredTokenMock = apiMocks.getStoredToken;
const getCurrentUserMock = apiMocks.getCurrentUser;

const user = {
  employeeId: 1,
  employeeNo: '001',
  name: 'موظف اختبار',
  phone: '01000000001',
  branchId: 1,
  branchName: 'الفرع الرئيسي',
  departmentName: 'الإدارة العامة',
  positionName: 'موظف',
  hireDate: '2020-01-01',
  status: 'active',
  tenantId: 't1',
  accountId: 'a1',
};

const dashboardData = {
  profile: {
    id: 1, employeeNo: '001', name: 'موظف اختبار', branchName: 'الفرع الرئيسي',
    departmentName: 'الإدارة العامة', positionName: 'موظف', hireDate: '2020-01-01',
    status: 'active', baseSalary: 10000, housingAllowance: 0, transportAllowance: 0,
  },
  todayAttendance: { hasCheckedIn: false, hasCheckedOut: false, checkInTime: null, checkOutTime: null, workHours: 0, status: 'absent' },
  monthSummary: { month: '2026-11', daysPresent: 0, totalWorkHours: 0, totalLateMinutes: 0 },
  leaveBalances: [],
  latestPayslip: null,
  totalLoansRemaining: 0,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <EmployeePortalPage />
    </MemoryRouter>,
  );
}

async function loginAs(mustChangePin: boolean) {
  loginMock.mockResolvedValueOnce({ token: 'tok-1', employee: user, mustChangePin });
  fireEvent.change(screen.getByPlaceholderText('مثال: 01012345678'), { target: { value: '01000000001' } });
  fireEvent.change(screen.getByPlaceholderText('كلمة المرور أو الرمز السري الخاص بك'), { target: { value: '1234' } });
  fireEvent.click(screen.getByRole('button', { name: /تسجيل الدخول إلى حسابي/ }));
}

describe('EmployeePortalPage forced PIN change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStoredTokenMock.mockReturnValue(null);
    getCurrentUserMock.mockReturnValue(null);
    getDashboardMock.mockResolvedValue(dashboardData);
  });

  it('forces the PIN-change screen on a default PIN and opens the dashboard only after the change', async () => {
    renderPage();
    expect(screen.getByText('بوابة الموظف الذاتية')).toBeTruthy();

    await loginAs(true);

    // The change screen replaces the dashboard entirely.
    await waitFor(() => expect(screen.getByText('تغيير رمز الدخول')).toBeTruthy());
    expect(screen.queryAllByText('نظرة عامة')).toHaveLength(0);
    expect(getDashboardMock).not.toHaveBeenCalled();

    // Submit the change: current 1234 -> new 5678.
    changePinMock.mockResolvedValueOnce({ token: 'tok-2', employee: user, mustChangePin: false });
    fireEvent.change(screen.getByPlaceholderText('أدخل الرمز الحالي'), { target: { value: '1234' } });
    fireEvent.change(screen.getByPlaceholderText('4 أحرف على الأقل'), { target: { value: '5678' } });
    fireEvent.change(screen.getByPlaceholderText('أعد إدخال الرمز الجديد'), { target: { value: '5678' } });
    fireEvent.click(screen.getByRole('button', { name: /حفظ الرمز الجديد والمتابعة/ }));

    await waitFor(() => expect(changePinMock).toHaveBeenCalledWith({ currentPin: '1234', newPin: '5678' }));
    await waitFor(() => expect(screen.getAllByText('نظرة عامة').length).toBeGreaterThan(0));
    expect(screen.queryByText('تغيير رمز الدخول')).toBeNull();
    expect(getDashboardMock).toHaveBeenCalled();
  });

  it('opens the dashboard directly on a normal login', async () => {
    renderPage();
    await loginAs(false);

    await waitFor(() => expect(screen.getAllByText('نظرة عامة').length).toBeGreaterThan(0));
    expect(screen.queryByText('تغيير رمز الدخول')).toBeNull();
    expect(getDashboardMock).toHaveBeenCalled();
  });

  it('lands on the change screen when a stored session answers PIN_CHANGE_REQUIRED', async () => {
    getStoredTokenMock.mockReturnValue('tok-old');
    getCurrentUserMock.mockReturnValue(user);
    getDashboardMock.mockRejectedValueOnce(
      new ApiError('يجب تغيير رمز الدخول الافتراضي قبل المتابعة', 403, { code: 'PIN_CHANGE_REQUIRED' }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('تغيير رمز الدخول')).toBeTruthy());
    expect(screen.queryAllByText('نظرة عامة')).toHaveLength(0);
  });
});
