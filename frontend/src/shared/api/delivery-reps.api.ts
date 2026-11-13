import { http } from '@/lib/http';

export interface DeliveryRep {
  id: number;
  name: string;
  phone: string | null;
  full_name?: string | null;
  national_id?: string | null;
  address?: string | null;
  vehicle_plate?: string | null;
  pin_code?: string | null;
  pin_hash?: string | null;
  has_pin?: boolean;
  rep_type?: 'delivery' | 'van' | 'both' | string | null;
  is_van_rep?: boolean;
  van_location_id?: number | null;
  is_active: boolean;
  permissions?: {
    can_edit_routes?: boolean;
    can_add_customers?: boolean;
    require_gps_on_visit?: boolean;
    can_give_discount?: boolean;
    max_discount_percent?: number;
    can_sell_over_credit_limit?: boolean;
    can_collect_cash?: boolean;
    [key: string]: any;
  };
  metadata?: Record<string, any>;
}

export interface UpsertDeliveryRepPayload {
  name: string;
  phone?: string;
  fullName?: string;
  nationalId?: string;
  address?: string;
  vehiclePlate?: string;
  pinCode?: string;
  repType?: 'delivery' | 'van' | 'both';
  isVanRep?: boolean;
  isActive?: boolean;
  permissions?: {
    can_edit_routes?: boolean;
    can_add_customers?: boolean;
    require_gps_on_visit?: boolean;
    can_give_discount?: boolean;
    max_discount_percent?: number;
    can_sell_over_credit_limit?: boolean;
    can_collect_cash?: boolean;
    [key: string]: any;
  };
  metadata?: Record<string, any>;
}

export interface SettleOrderPayload {
  signatureDataUrl?: string;
  proofPhotoUrl?: string;
  gpsLat?: number;
  gpsLng?: number;
  notes?: string;
  /** Cash the rep actually handed over, counted by the cashier. When omitted the book cash due is settled, as before. */
  countedCashAmount?: number;
}

export interface DeliveryOrder {
  id: number;
  docNo: string;
  total: number;
  /** Remaining cash due for this order (deliverySettlementBasis net of
   * prior returns), attached by listOrders / driverListOrders.
   * Optional: other endpoints sharing this type do not attach it.
   * The pending badge sums this field, never the raw invoice total. */
  remainingAmount?: number;
  deliveryFee?: number;
  deliveryFeeMode?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerAddress?: string | null;
  orderType: string;
  deliveryRepId: number | null;
  deliveryRepName?: string;
  deliveryStatus: string | null;
  deliverySignature?: string | null;
  deliveryPhotoUrl?: string | null;
  deliveryGpsLat?: number | null;
  deliveryGpsLng?: number | null;
  deliveryNotes?: string | null;
  collectionStatus: string | null;
  settledAt: string | null;
  settledByName?: string;
  createdByName?: string;
  createdAt: string;
}

export interface DeliveryRepSummary {
  totalOrders: number;
  totalAmount: number;
  collectedAmount: number;
  pendingAmount: number;
}

function unwrapArray<T>(raw: unknown, key: string): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object' && key in raw) return (raw as Record<string, unknown>)[key] as T[];
  return [];
}

export const deliveryRepsApi = {
  list: async (): Promise<DeliveryRep[]> =>
    unwrapArray<DeliveryRep>(await http<DeliveryRep[] | { deliveryReps: DeliveryRep[] }>('/api/delivery-reps'), 'deliveryReps'),

  create: async (data: UpsertDeliveryRepPayload): Promise<DeliveryRep> =>
    http<DeliveryRep>('/api/delivery-reps', { method: 'POST', body: JSON.stringify(data) }),

  update: async (id: number, data: UpsertDeliveryRepPayload): Promise<DeliveryRep> =>
    http<DeliveryRep>(`/api/delivery-reps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  remove: async (id: number): Promise<unknown> =>
    http(`/api/delivery-reps/${id}`, { method: 'DELETE' }),

  listOrders: async (repId: number, params?: { dateFrom?: string; dateTo?: string; status?: string }): Promise<DeliveryOrder[]> => {
    const searchParams = new URLSearchParams();
    if (params?.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params?.dateTo) searchParams.set('dateTo', params.dateTo);
    if (params?.status) searchParams.set('status', params.status);
    const qs = searchParams.toString();
    return unwrapArray<DeliveryOrder>(await http<DeliveryOrder[] | { orders: DeliveryOrder[] }>(`/api/delivery-reps/${repId}/orders${qs ? `?${qs}` : ''}`), 'orders');
  },

  settleOrder: async (saleId: number, payload?: SettleOrderPayload): Promise<unknown> =>
    http(`/api/delivery-reps/settle/${saleId}`, { method: 'POST', body: JSON.stringify(payload || {}) }),

  settleAllOrders: async (repId: number, expectedAmount: number): Promise<unknown> =>
    http(`/api/delivery-reps/${repId}/settle-all`, { method: 'POST', body: JSON.stringify({ expectedAmount }) }),

  listSettlements: async (repId: number, params?: { dateFrom?: string; dateTo?: string }): Promise<any[]> => {
    const searchParams = new URLSearchParams();
    if (params?.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params?.dateTo) searchParams.set('dateTo', params.dateTo);
    const qs = searchParams.toString();
    return unwrapArray<any>(await http<any[] | { settlements: any[] }>(`/api/delivery-reps/${repId}/settlements${qs ? `?${qs}` : ''}`), 'settlements');
  },

  getKPIs: async (repId: number): Promise<{ totalOrders: number; successfulOrders: number; returnedOrders: number; successRate: number; averageDelayHours: number; averageDelayMins?: number; rating: number }> => {
    const res = await http<{ kpis: any }>(`/api/delivery-reps/${repId}/kpi`);
    return res.kpis;
  },

  getSummary: async (repId: number): Promise<DeliveryRepSummary> => {
    const res = await http<{ summary: DeliveryRepSummary }>(`/api/delivery-reps/${repId}/summary`);
    return res.summary;
  },

  listVehicles: async (): Promise<Array<{ id: number; plateNumber: string; modelName?: string }>> => {
    try {
      const res = await http<{ ok: boolean; vehicles: Array<{ id: number; plateNumber: string; modelName?: string }> }>('/api/van-sales/admin/vehicles');
      return res?.vehicles || [];
    } catch {
      return [];
    }
  },

  dispatchOrders: (payload: { repId: number; saleIds?: number[]; onlineOrderIds?: number[]; notes?: string }) =>
    http<{
      success: boolean;
      repId: number;
      repName: string;
      dispatchedCount: number;
      notifications: Array<{ recipientPhone: string; orderNumber: string; text: string }>;
      message: string;
    }>('/api/delivery-reps/dispatch', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

export interface DriverPortalUser {
  id: number;
  name: string;
  fullName?: string | null;
  phone?: string | null;
  vehiclePlate?: string | null;
  tenantId: string;
  tenantName?: string;
  isVanRep?: boolean;
  vanLocationId?: number | null;
  // INV-VAN-GPS-FLAG-OFF-VISIT: the backend login response already sends
  // the rep's permissions object; the portal type dropped it, so the
  // customer-pick GPS gate never saw the admin's require_gps_on_visit
  // toggle. Only this one flag is surfaced here (the portal needs no
  // other rep permission).
  permissions?: {
    require_gps_on_visit?: boolean;
  };
}

export const driverPortalApi = {
  // INV-DRIVER-PIN-FIRST-LOGIN-CHANGE: whether the stored session is still
  // on the default PIN. Persisted beside the token so a rep who closes the
  // tab on the forced-change screen is forced again on return, instead of
  // walking straight into the portal from the stored session.
  getStoredMustChangePin: (): boolean => {
    try {
      return localStorage.getItem('zs_driver_portal_must_change_pin') === '1';
    } catch {
      return false;
    }
  },

  login: async (phone: string, pinCode: string, companyCode?: string): Promise<{ token: string; rep: DriverPortalUser; mustChangePin?: boolean; isOffline?: boolean }> => {
    const cleanPhone = phone.trim();
    const cleanPin = pinCode.trim();

    // Fast offline check if browser is known to be offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const cached = driverPortalApi.getOfflineAuthCache();
      if (cached && cached.phone === cleanPhone && cached.pinCode === cleanPin) {
        localStorage.setItem('zs_driver_portal_token', cached.token);
        localStorage.setItem('zs_driver_portal_rep', JSON.stringify(cached.rep));
        // The offline cache holds the plaintext PIN, so a still-default
        // PIN is detectable here too — the forced change must not be
        // bypassable by going offline.
        const mustChangePin = cached.pinCode === '1234';
        if (mustChangePin) localStorage.setItem('zs_driver_portal_must_change_pin', '1');
        else localStorage.removeItem('zs_driver_portal_must_change_pin');
        return { token: cached.token, rep: cached.rep, mustChangePin, isOffline: true };
      }
      throw new Error('أنت غير متصل بالإنترنت حالياً، وبيانات الدخول لا تطابق الحساب المسجل سابقاً على هذا الجهاز.');
    }

    try {
      const res = await http<{ token: string; rep: DriverPortalUser; mustChangePin?: boolean }>('/api/driver-portal/login', {
        method: 'POST',
        body: JSON.stringify({ phone: cleanPhone, pinCode: cleanPin, ...(companyCode ? { companyCode } : {}) }),
      });
      if (res?.token) {
        localStorage.setItem('zs_driver_portal_token', res.token);
        localStorage.setItem('zs_driver_portal_rep', JSON.stringify(res.rep));
        if (res.mustChangePin === true) localStorage.setItem('zs_driver_portal_must_change_pin', '1');
        else localStorage.removeItem('zs_driver_portal_must_change_pin');
        localStorage.setItem(
          'zs_driver_portal_auth_cache',
          JSON.stringify({
            phone: cleanPhone,
            pinCode: cleanPin,
            token: res.token,
            rep: res.rep,
          }),
        );
      }
      return res;
    } catch (err: any) {
      // If error is network drop / server unreachable, fallback to verified offline cache
      const isNetworkError =
        !err?.status ||
        err?.status === 0 ||
        err?.message?.toLowerCase().includes('failed to fetch') ||
        err?.message?.includes('NetworkError');

      if (isNetworkError) {
        const cached = driverPortalApi.getOfflineAuthCache();
        if (cached && cached.phone === cleanPhone && cached.pinCode === cleanPin) {
          localStorage.setItem('zs_driver_portal_token', cached.token);
          localStorage.setItem('zs_driver_portal_rep', JSON.stringify(cached.rep));
          const mustChangePin = cached.pinCode === '1234';
          if (mustChangePin) localStorage.setItem('zs_driver_portal_must_change_pin', '1');
          else localStorage.removeItem('zs_driver_portal_must_change_pin');
          return { token: cached.token, rep: cached.rep, mustChangePin, isOffline: true };
        }
      }
      throw err;
    }
  },

  // INV-DRIVER-PIN-FIRST-LOGIN-CHANGE: the only portal call allowed while
  // the rep still uses the default PIN. Returns a fresh token; the caller
  // stores it exactly like a login. The offline auth cache is re-keyed to
  // the new PIN so the old PIN cannot be reused offline after the change.
  changePin: async (payload: { currentPin: string; newPin: string }): Promise<{ token: string; rep: DriverPortalUser; mustChangePin: boolean }> => {
    const token = localStorage.getItem('zs_driver_portal_token');
    const res = await http<{ token: string; rep: DriverPortalUser; mustChangePin: boolean }>('/api/driver-portal/change-pin', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res?.token) {
      localStorage.setItem('zs_driver_portal_token', res.token);
      localStorage.setItem('zs_driver_portal_rep', JSON.stringify(res.rep));
      localStorage.removeItem('zs_driver_portal_must_change_pin');
      const cached = driverPortalApi.getOfflineAuthCache();
      if (cached) {
        localStorage.setItem(
          'zs_driver_portal_auth_cache',
          JSON.stringify({ ...cached, pinCode: payload.newPin, token: res.token, rep: res.rep }),
        );
      }
    }
    return res;
  },

  getOfflineAuthCache: (): { phone: string; pinCode: string; token: string; rep: DriverPortalUser } | null => {
    try {
      const raw = localStorage.getItem('zs_driver_portal_auth_cache');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  getStoredSession: (): { token: string; rep: DriverPortalUser } | null => {
    try {
      const token = localStorage.getItem('zs_driver_portal_token');
      const rep = localStorage.getItem('zs_driver_portal_rep');
      if (token && rep) return { token, rep: JSON.parse(rep) };
      return null;
    } catch {
      return null;
    }
  },

  logout: () => {
    localStorage.removeItem('zs_driver_portal_token');
    localStorage.removeItem('zs_driver_portal_rep');
    localStorage.removeItem('zs_driver_portal_must_change_pin');
  },

  getOrders: async (status?: string): Promise<DeliveryOrder[]> => {
    const token = localStorage.getItem('zs_driver_portal_token');
    const query = status ? `?status=${status}` : '';
    const res = await http<{ ok: boolean; orders: DeliveryOrder[] }>(`/api/driver-portal/orders${query}`, {
      headers: { Authorization: `Bearer ${token || ''}` },
    });
    return res.orders || [];
  },

  settleOrder: async (saleId: number, payload?: SettleOrderPayload): Promise<{ ok: boolean }> => {
    const token = localStorage.getItem('zs_driver_portal_token');
    return http<{ ok: boolean }>(`/api/driver-portal/orders/${saleId}/settle`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token || ''}` },
      body: JSON.stringify(payload || {}),
    });
  },
};

