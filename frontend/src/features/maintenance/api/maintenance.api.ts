import { http } from '@/lib/http';
import { buildQueryString } from '@/lib/query-string';
import type { MaintenanceTicket, MaintenanceStatus } from '@/types/domain-models/maintenance';

export interface MaintenanceListParams {
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface MaintenanceListPageResponse {
  tickets: MaintenanceTicket[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface UpsertMaintenanceTicketPayload {
  customerId?: number;
  customerName: string;
  customerPhone: string;
  deviceBrand?: string;
  deviceModel: string;
  serialNumber?: string;
  passcode?: string;
  problemDescription: string;
  deviceCondition?: string;
  expectedCost?: number;
  finalCost?: number;
  advancePayment?: number;
  status?: MaintenanceStatus;
  technicianId?: number;
  technicianName?: string;
  technicianNotes?: string;
  branchId?: number;
  locationId?: number;
  warrantyDays?: number;
}

export type MaintenancePaymentMethod = 'cash' | 'card' | 'wallet' | 'instapay';

export interface MaintenanceTicketCounts {
  received: number;
  inspecting: number;
  in_progress: number;
  waiting_parts: number;
  repaired: number;
  delivered: number;
  unrepairable: number;
  cancelled: number;
  total: number;
}

export interface MaintenanceTicketCountsResponse {
  counts: MaintenanceTicketCounts;
  totalRemaining: number;
}

/* KPI groupings for the tickets page, computed from the aggregate counts
 * endpoint (never from a pageSize:1000 list — the backend caps pageSize
 * at 100, so list-derived counts go silently wrong past 100 tickets). */
export function summarizeTicketCounts(counts: MaintenanceTicketCounts, totalRemaining: number) {
  return {
    inProgressCount: counts.received + counts.in_progress + counts.waiting_parts,
    readyCount: counts.repaired,
    deliveredCount: counts.delivered,
    receivedCount: counts.received,
    totalCount: counts.total,
    totalRemainingSum: totalRemaining,
  };
}

export const maintenanceApi = {
  list: (params: MaintenanceListParams = {}) =>
    http<MaintenanceListPageResponse>(`/api/maintenance/tickets${buildQueryString(params)}`),

  get: (id: string | number) =>
    http<{ ticket: MaintenanceTicket }>(`/api/maintenance/tickets/${id}`),

  create: (payload: UpsertMaintenanceTicketPayload) =>
    http<{ ok: boolean; id: string; ticketNo: string }>('/api/maintenance/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  update: (id: string | number, payload: UpsertMaintenanceTicketPayload) =>
    http<{ ok: boolean }>(`/api/maintenance/tickets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  updateStatus: (
    id: string | number,
    payload: {
      status: MaintenanceStatus;
      finalCost?: number;
      collectedAmount?: number;
      technicianNotes?: string;
      paymentMethod?: MaintenancePaymentMethod;
      refundAdvance?: boolean;
    },
  ) =>
    http<{ ok: boolean }>(`/api/maintenance/tickets/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  addPart: (
    ticketId: string | number,
    payload: {
      productId: number;
      productName: string;
      qty: number;
      unitCost?: number;
      unitPrice: number;
      locationId?: number;
    },
  ) =>
    http<{ ok: boolean; partId: string; newFinalCost: number }>(`/api/maintenance/tickets/${ticketId}/parts`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  removePart: (ticketId: string | number, partId: string | number) =>
    http<{ ok: boolean }>(`/api/maintenance/tickets/${ticketId}/parts/${partId}`, {
      method: 'DELETE',
    }),

  getCounts: () =>
    http<MaintenanceTicketCountsResponse>('/api/maintenance/tickets/counts'),

  delete: (id: string | number) =>
    http<{ ok: boolean }>(`/api/maintenance/tickets/${id}`, {
      method: 'DELETE',
    }),
};
