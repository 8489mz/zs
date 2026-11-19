import { http } from '@/lib/http';
import { getDriverAuthHeaders } from './van-sales-driver-auth';
import type { CustomerPackagingBalance, VanPackagingMovement, VanTripExpense } from './van-sales-types-a';

export const vanExpensesPackagingApi = {
  // =========================================================================
  // Trip Operational Expenses API
  // =========================================================================

  recordTripExpense: async (
    payloadOrTripId: number | { tripId: number; expenseType: string; amount: number; notes?: string; description?: string; receiptPhotoUrl?: string; receiptPhoto?: string; supervisorOverridePin?: string },
    extraPayload?: { expenseType: string; amount: number; notes?: string; description?: string; receiptPhotoUrl?: string; receiptPhoto?: string; supervisorOverridePin?: string },
  ): Promise<{ ok: boolean; expenseId: number; totalTripExpenses: number }> => {
    let tripId: number;
    let body: any;
    if (typeof payloadOrTripId === 'number') {
      tripId = payloadOrTripId;
      body = {
        tripId,
        expenseType: extraPayload?.expenseType,
        amount: extraPayload?.amount,
        notes: extraPayload?.notes || extraPayload?.description,
        receiptPhotoUrl: extraPayload?.receiptPhotoUrl || extraPayload?.receiptPhoto,
        supervisorOverridePin: extraPayload?.supervisorOverridePin,
      };
    } else {
      tripId = payloadOrTripId.tripId;
      body = {
        tripId,
        expenseType: payloadOrTripId.expenseType,
        amount: payloadOrTripId.amount,
        notes: payloadOrTripId.notes || payloadOrTripId.description,
        receiptPhotoUrl: payloadOrTripId.receiptPhotoUrl || payloadOrTripId.receiptPhoto,
        supervisorOverridePin: payloadOrTripId.supervisorOverridePin,
      };
    }
    return http(`/api/driver-portal/van-sales/trips/${tripId}/expenses`, {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(body),
    });
  },

  getTripExpenses: async (tripId: number): Promise<{ expenses: VanTripExpense[]; totalExpenses: number }> => {
    return http(`/api/driver-portal/van-sales/trips/${tripId}/expenses`, {
      headers: getDriverAuthHeaders(),
    });
  },

  getAdminTripExpenses: async (tripId: number): Promise<{ expenses: VanTripExpense[]; totalExpenses: number }> => {
    return http(`/api/van-sales/admin/trips/${tripId}/expenses`);
  },

  // =========================================================================
  // Returnable Packaging & Empties Ledger API
  // =========================================================================

  recordPackagingMovement: async (
    payloadOrTripId: number | { tripId: number; customerId?: number; packageType?: string; packagingType?: string; deliveredQty?: number; qtyOut?: number; returnedQty?: number; qtyIn?: number; notes?: string },
    extraPayload?: { customerId?: number; packageType?: string; packagingType?: string; deliveredQty?: number; qtyOut?: number; returnedQty?: number; qtyIn?: number; notes?: string },
  ): Promise<{ ok: boolean; movementId: number }> => {
    let tripId: number;
    let p: any;
    if (typeof payloadOrTripId === 'number') {
      tripId = payloadOrTripId;
      p = extraPayload || {};
    } else {
      tripId = payloadOrTripId.tripId;
      p = payloadOrTripId;
    }
    const body = {
      tripId,
      customerId: p.customerId,
      packageType: p.packageType || p.packagingType || 'crate_plastic',
      deliveredQty: p.deliveredQty ?? p.qtyOut ?? 0,
      returnedQty: p.returnedQty ?? p.qtyIn ?? 0,
      notes: p.notes,
    };
    return http(`/api/driver-portal/van-sales/trips/${tripId}/packaging`, {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(body),
    });
  },

  getTripPackagingMovements: async (tripId: number): Promise<VanPackagingMovement[]> => {
    return http(`/api/driver-portal/van-sales/trips/${tripId}/packaging`, {
      headers: getDriverAuthHeaders(),
    });
  },

  getAdminTripPackaging: async (tripId: number): Promise<VanPackagingMovement[]> => {
    return http(`/api/van-sales/admin/trips/${tripId}/packaging`);
  },

  getCustomerPackagingBalance: async (customerId: number): Promise<CustomerPackagingBalance[]> => {
    return http(`/api/driver-portal/van-sales/customers/${customerId}/packaging`, {
      headers: getDriverAuthHeaders(),
    });
  },

  getAdminCustomerPackaging: async (customerId: number): Promise<CustomerPackagingBalance[]> => {
    return http(`/api/van-sales/admin/customers/${customerId}/packaging`);
  },

  createCustomer: async (payload: {
    name: string;
    phone?: string;
    address?: string;
    district?: string;
    route?: string;
    notes?: string;
    visitDays?: string[];
    metadata?: any;
  }): Promise<{ ok: boolean; customer: any }> => {
    return http('/api/driver-portal/van-sales/customers', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },
};
