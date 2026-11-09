import { http } from '@/lib/http';

export type KdsTicketStatus = 'pending' | 'cooking' | 'ready' | 'served';
export type KdsItemStatus = 'pending' | 'cooking' | 'ready';
export type KdsStation = 'all' | 'kitchen' | 'grill' | 'beverages' | 'bakery' | 'general' | 'expo';
export type KdsUrgencyLevel = 'normal' | 'warning' | 'critical';

export interface KdsTicketItem {
  id: number;
  productId?: number;
  name: string;
  qty: number;
  unitName?: string;
  modifiers?: Array<{ name: string; qty?: number; price?: number }>;
  notes?: string;
  status: KdsItemStatus;
  station: KdsStation;
  prepTimeMinutes?: number;
  seatNumber?: number;
}

export interface KdsTicket {
  id: number;
  docNo: string;
  orderNumber: string;
  orderType: 'dine_in' | 'takeaway' | 'delivery';
  tableNumber?: string;
  customerName?: string;
  cashierName?: string;
  status: KdsTicketStatus;
  elapsedMinutes: number;
  elapsedSeconds: number;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  items: KdsTicketItem[];
  urgencyLevel: KdsUrgencyLevel;
  course?: 'appetizer' | 'main' | 'dessert' | 'beverage';
  aggregatorChannel?: string;
  aggregatorOrderId?: string;
  pagerNumber?: string;
}

export interface KdsSummaryStats {
  pendingCount: number;
  cookingCount: number;
  readyCount: number;
  criticalCount: number;
  avgPrepMinutes: number;
}

export interface KdsTicketsResponse {
  tickets: KdsTicket[];
  stats: KdsSummaryStats;
  lastServedId?: number;
  // R4-E I16: the queue is capped at 200 (oldest first); the banner needs
  // both the flag and the real total. R4-E I55: the runtime state blob was
  // unreadable, so tickets are shown without progress.
  truncated: boolean;
  totalActive?: number;
  kdsStateCorrupt?: boolean;
}

export const kdsApi = {
  getTickets: async (filters?: {
    station?: KdsStation;
    orderType?: string;
    status?: KdsTicketStatus;
  }): Promise<KdsTicketsResponse> => {
    const params = new URLSearchParams();
    if (filters?.station && filters.station !== 'all') params.append('station', filters.station);
    if (filters?.orderType && filters.orderType !== 'all') params.append('orderType', filters.orderType);
    if (filters?.status) params.append('status', filters.status);

    const queryStr = params.toString() ? `?${params.toString()}` : '';
    return http<KdsTicketsResponse>(`/api/sales/kds/tickets${queryStr}`);
  },

  advanceStatus: async (ticketId: number): Promise<{ ticketId: number; newStatus: KdsTicketStatus }> => {
    return http<{ ticketId: number; newStatus: KdsTicketStatus }>(
      `/api/sales/kds/tickets/${ticketId}/advance`,
      { method: 'POST' }
    );
  },

  setStatus: async (
    ticketId: number,
    status: KdsTicketStatus
  ): Promise<{ ticketId: number; status: KdsTicketStatus }> => {
    return http<{ ticketId: number; status: KdsTicketStatus }>(
      `/api/sales/kds/tickets/${ticketId}/status`,
      { method: 'POST', body: JSON.stringify({ status }) }
    );
  },

  setItemStatus: async (
    ticketId: number,
    itemId: number,
    status: KdsItemStatus
  ): Promise<{ ticketId: number; itemId: number; itemStatus: KdsItemStatus }> => {
    return http<{ ticketId: number; itemId: number; itemStatus: KdsItemStatus }>(
      `/api/sales/kds/tickets/${ticketId}/items/${itemId}/status`,
      { method: 'POST', body: JSON.stringify({ status }) }
    );
  },

  recallLastServed: async (): Promise<{ recalled: boolean; ticketId?: number; status?: KdsTicketStatus }> => {
    return http<{ recalled: boolean; ticketId?: number; status?: KdsTicketStatus }>(
      '/api/sales/kds/tickets/recall-last',
      { method: 'POST' }
    );
  },

  fireCourse: async (
    ticketId: number,
    course?: 'appetizer' | 'main' | 'dessert' | 'beverage'
  ): Promise<{ ticketId: number; course: string }> => {
    return http<{ ticketId: number; course: string }>(
      `/api/sales/kds/tickets/${ticketId}/fire-course`,
      { method: 'POST', body: JSON.stringify({ course }) }
    );
  },
};
