import { http } from '@/lib/http';
import type { EmployeeReportDetailsResponse, EmployeeReportsPageResponse, EmployeeReportsQueryParams } from '@/features/reports/api/reports.api';
import { buildQueryString } from '@/lib/query-string';

export const employeeReportsApi = {
  employeesPage: (params: EmployeeReportsQueryParams) =>
    http<EmployeeReportsPageResponse>(`/api/reports/employees${buildQueryString(params as Record<string, string | number | undefined | null>)}`),
  employeeDetails: (userId: string, params: { from?: string; to?: string; limit?: number } = {}) =>
    http<EmployeeReportDetailsResponse>(`/api/reports/employees/${encodeURIComponent(userId)}/details${buildQueryString(params as Record<string, string | number | undefined | null>)}`),
};
