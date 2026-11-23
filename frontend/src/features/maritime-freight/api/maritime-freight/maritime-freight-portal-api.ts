import { http } from '@/lib/http';
import type { FreightPortalSession, FreightPortalDashboard } from './maritime-freight-portal-types';

export const freightCustomerPortalApi = {
  login: async (payload: { phone: string; pinCode: string; companyCode?: string; tenantId?: string }): Promise<FreightPortalSession> => {
    const res = await http<FreightPortalSession>('/api/freight-portal/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipUnauthorizedInterceptor: true,
    });
    if (res.token) {
      freightCustomerPortalApi.setStoredSession(res);
    }
    return res;
  },

  tokenLogin: async (token: string): Promise<FreightPortalSession> => {
    const res = await http<FreightPortalSession>('/api/freight-portal/auth/token-login', {
      method: 'POST',
      body: JSON.stringify({ token }),
      skipUnauthorizedInterceptor: true,
    });
    if (res.token) {
      freightCustomerPortalApi.setStoredSession(res);
    }
    return res;
  },

  getStoredSession: (): FreightPortalSession | null => {
    try {
      const token = localStorage.getItem('zs_freight_portal_token');
      const customer = localStorage.getItem('zs_freight_portal_customer');
      if (token && customer) return { token, customer: JSON.parse(customer) };
      return null;
    } catch {
      return null;
    }
  },

  setStoredSession: (session: FreightPortalSession) => {
    try {
      localStorage.setItem('zs_freight_portal_token', session.token);
      localStorage.setItem('zs_freight_portal_customer', JSON.stringify(session.customer));
    } catch {
      // ignore
    }
  },

  logout: () => {
    localStorage.removeItem('zs_freight_portal_token');
    localStorage.removeItem('zs_freight_portal_customer');
  },

  getAuthHeader: () => {
    const session = freightCustomerPortalApi.getStoredSession();
    return { Authorization: `Bearer ${session?.token || ''}` };
  },

  getDashboard: async (): Promise<FreightPortalDashboard> => {
    return http<FreightPortalDashboard>('/api/freight-portal/dashboard', {
      headers: freightCustomerPortalApi.getAuthHeader(),
      skipUnauthorizedInterceptor: true,
    });
  },

  getShipments: async (params?: { status?: string; search?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return http<{ items: any[]; total: number; page: number; pageSize: number; totalPages: number }>(
      `/api/freight-portal/shipments${query}`,
      {
        headers: freightCustomerPortalApi.getAuthHeader(),
        skipUnauthorizedInterceptor: true,
      },
    );
  },

  getShipmentDetails: async (jobId: string) => {
    return http<{
      job: any;
      containers: any[];
      milestones: any[];
      charges: any[];
      inlandTrips: any[];
      documents: any[];
    }>(`/api/freight-portal/shipments/${jobId}`, {
      headers: freightCustomerPortalApi.getAuthHeader(),
      skipUnauthorizedInterceptor: true,
    });
  },

  requestQuote: async (dto: any) => {
    return http<{ success: boolean; inquiryId: string; inquiryNumber: string; message: string }>(
      '/api/freight-portal/quotes/request',
      {
        method: 'POST',
        headers: freightCustomerPortalApi.getAuthHeader(),
        body: JSON.stringify(dto),
        skipUnauthorizedInterceptor: true,
      },
    );
  },

  getQuotations: async (status?: string) => {
    const query = status ? `?status=${status}` : '';
    return http<any[]>(`/api/freight-portal/quotes${query}`, {
      headers: freightCustomerPortalApi.getAuthHeader(),
      skipUnauthorizedInterceptor: true,
    });
  },

  getQuotationDetails: async (quoteId: string) => {
    return http<any>(`/api/freight-portal/quotes/${quoteId}`, {
      headers: freightCustomerPortalApi.getAuthHeader(),
      skipUnauthorizedInterceptor: true,
    });
  },

  approveQuotation: async (quoteId: string, payload: { approvalNotes?: string; clientReference?: string; confirmedBy?: string }) => {
    return http<{ success: boolean; quotationId: string; status: string; jobId?: string; jobNumber?: string; message: string }>(
      `/api/freight-portal/quotes/${quoteId}/approve`,
      {
        method: 'POST',
        headers: freightCustomerPortalApi.getAuthHeader(),
        body: JSON.stringify(payload),
        skipUnauthorizedInterceptor: true,
      },
    );
  },

  rejectQuotation: async (quoteId: string, payload: { reason?: string }) => {
    return http<{ success: boolean; quotationId: string; status: string; message: string }>(
      `/api/freight-portal/quotes/${quoteId}/reject`,
      {
        method: 'POST',
        headers: freightCustomerPortalApi.getAuthHeader(),
        body: JSON.stringify(payload),
        skipUnauthorizedInterceptor: true,
      },
    );
  },

  getStatement: async () => {
    return http<{ customer: any; jobsSummary: any[]; statementGeneratedAt: string }>(
      '/api/freight-portal/statement',
      {
        headers: freightCustomerPortalApi.getAuthHeader(),
        skipUnauthorizedInterceptor: true,
      },
    );
  },
};
