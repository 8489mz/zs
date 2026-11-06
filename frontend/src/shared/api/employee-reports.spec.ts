/*
 * INV-USER-DETAILS-DIALOG: the settings user-details dialog loads through
 * employeeReportsApi.employeeDetails, which must call the backend route
 * GET /api/reports/employees/:id/details. The backend exposes only that
 * route (plus the list route GET /api/reports/employees); calling
 * /api/reports/employees/:id without /details 404s, so the dialog showed
 * "could not load user details" while the edit dialog (list data) worked.
 */
import { describe, expect, it, vi } from 'vitest';
import { employeeReportsApi } from '@/shared/api/employee-reports';

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

const detailsPayload = {
  employee: {
    id: 7,
    name: 'muse',
    username: 'muse',
    salesTotal: 1200,
    salesCount: 3,
    purchasesTotal: 0,
    purchasesCount: 0,
    returnsTotal: 0,
    returnsCount: 0,
    auditCount: 5,
  },
  summary: {},
  activities: [],
};

describe('employeeReportsApi.employeeDetails', () => {
  it('calls the /details route and returns the employee data', async () => {
    httpMock.mockResolvedValueOnce(detailsPayload);

    const result = await employeeReportsApi.employeeDetails('7', { limit: 25 });

    expect(httpMock).toHaveBeenCalledWith('/api/reports/employees/7/details?limit=25');
    expect(result.employee?.name).toBe('muse');
    expect(result.employee?.username).toBe('muse');
  });

  it('calls the /details route with no query string when no params are given', async () => {
    httpMock.mockResolvedValueOnce(detailsPayload);

    await employeeReportsApi.employeeDetails('7');

    expect(httpMock).toHaveBeenCalledWith('/api/reports/employees/7/details');
  });

  it('surfaces the named USER_NOT_FOUND error for a missing user instead of a generic failure', async () => {
    httpMock.mockRejectedValueOnce(
      Object.assign(new Error('User not found'), { code: 'USER_NOT_FOUND', status: 404 }),
    );

    await expect(employeeReportsApi.employeeDetails('999999')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });
});
