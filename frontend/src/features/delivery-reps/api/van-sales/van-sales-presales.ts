import { http } from '@/lib/http';
import { getDriverAuthHeaders } from './van-sales-driver-auth';
import type { PreSalesCatalogItem, PreSalesOrderItemInput, PreSalesOrderRecord } from './van-sales-types-a';

export const vanPreSalesApi = {
  // Field Pre-Sales (Order Booking from Main Warehouse) API
  fetchPreSalesCatalog: async (params?: { warehouseLocationId?: number; search?: string; categoryId?: number }): Promise<PreSalesCatalogItem[]> => {
    const sp = new URLSearchParams();
    if (params?.warehouseLocationId) sp.set('warehouseLocationId', String(params.warehouseLocationId));
    if (params?.search) sp.set('search', params.search);
    if (params?.categoryId) sp.set('categoryId', String(params.categoryId));
    const qs = sp.toString();
    const res = await http<any>(
      `/api/driver-portal/van-sales/pre-sales/catalog${qs ? `?${qs}` : ''}`,
      { headers: getDriverAuthHeaders() }
    );
    return res.products || res.items || [];
  },

  createPreSalesOrder: async (payload: {
    customerId: number;
    paymentMethod: 'cash' | 'credit';
    warehouseLocationId?: number;
    notes?: string;
    deliveryDate?: string;
    items: PreSalesOrderItemInput[];
  }): Promise<{ ok: boolean; orderId: number; orderNumber: string; totalAmount: number; status: string }> => {
    return http('/api/driver-portal/van-sales/pre-sales/orders', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  fetchMyPreSalesOrders: async (params?: { status?: string; dateFrom?: string; dateTo?: string; search?: string }): Promise<PreSalesOrderRecord[]> => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
    if (params?.dateTo) sp.set('dateTo', params.dateTo);
    if (params?.search) sp.set('search', params.search);
    const qs = sp.toString();
    const res = await http<{ ok: boolean; orders: PreSalesOrderRecord[] }>(
      `/api/driver-portal/van-sales/pre-sales/my-orders${qs ? `?${qs}` : ''}`,
      { headers: getDriverAuthHeaders() }
    );
    return res.orders || [];
  },

  getPreSalesOrderDetails: async (orderId: number): Promise<PreSalesOrderRecord> => {
    const res = await http<any>(
      `/api/driver-portal/van-sales/pre-sales/orders/${orderId}`,
      { headers: getDriverAuthHeaders() }
    );
    return res.order || res;
  },

  // Supervisor Admin Pre-Sales Endpoints
  listAdminPreSalesOrders: async (filters?: {
    repId?: number;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }): Promise<PreSalesOrderRecord[]> => {
    const sp = new URLSearchParams();
    if (filters?.repId) sp.set('repId', String(filters.repId));
    if (filters?.status) sp.set('status', filters.status);
    if (filters?.dateFrom) sp.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) sp.set('dateTo', filters.dateTo);
    if (filters?.search) sp.set('search', filters.search);
    const qs = sp.toString();
    const res = await http<{ ok: boolean; orders: PreSalesOrderRecord[] }>(`/api/van-sales/admin/pre-sales-orders${qs ? `?${qs}` : ''}`);
    return res.orders || [];
  },

  getAdminPreSalesOrderDetails: async (orderId: number): Promise<PreSalesOrderRecord> => {
    const res = await http<any>(`/api/van-sales/admin/pre-sales-orders/${orderId}`);
    return res.order || res;
  },

  approveAdminPreSalesOrder: async (orderId: number): Promise<{ ok: boolean; status: string }> => {
    return http(`/api/van-sales/admin/pre-sales-orders/${orderId}/approve`, {
      method: 'POST',
    });
  },

  rejectAdminPreSalesOrder: async (orderId: number, reason?: string): Promise<{ ok: boolean; status: string }> => {
    return http(`/api/van-sales/admin/pre-sales-orders/${orderId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  consolidateAdminPreSalesOrdersToRequisition: async (payload: {
    orderIds: number[];
    deliveryRepId: number;
    notes?: string;
  }): Promise<{
    ok: boolean;
    requisitionId: number;
    requisitionDocNo: string;
    consolidatedOrdersCount: number;
    totalDistinctItems: number;
  }> => {
    return http('/api/van-sales/admin/pre-sales-orders/consolidate-requisition', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  convertAdminPreSalesOrderToInvoice: async (
    orderId: number,
    payload?: { paymentMethod?: 'cash' | 'credit'; notes?: string },
  ): Promise<{
    ok: boolean;
    orderId: number;
    orderNumber: string;
    saleId: number;
    invoiceDocNo: string;
    totalAmount: number;
  }> => {
    return http(`/api/van-sales/admin/pre-sales-orders/${orderId}/convert-invoice`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },
};
