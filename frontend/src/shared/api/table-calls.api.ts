import { http } from '@/lib/http';

export interface TableServiceCall {
  id: number;
  tenant_id: string;
  branch_id?: number | null;
  table_number: string;
  call_type: 'waiter' | 'bill' | 'water' | 'clean' | 'bill_paid' | 'rescue';
  status: 'pending' | 'resolved';
  bill_amount?: number | null;
  tip_amount?: number | null;
  payment_reference?: string | null;
  payment_status?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

export const tableCallsApi = {
  // INV-TABLE-CALL-SLUG-TENANT: the public call sends the storefront
  // slug; the backend resolves the tenant server-side. A caller-supplied
  // tenantId is never sent (the backend ignores it).
  createCall: (data: { tableNumber: string; callType?: 'waiter' | 'bill' | 'water' | 'clean'; branchId?: number; notes?: string }, slug?: string) =>
    http<TableServiceCall>(`/api/sales/table-calls${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listPendingCalls: (branchId?: number) =>
    http<TableServiceCall[]>(`/api/sales/table-calls${branchId ? `?branchId=${branchId}` : ''}`),

  resolveCall: (id: number) =>
    http<TableServiceCall>(`/api/sales/table-calls/${id}/resolve`, {
      method: 'PATCH',
    }),

  resolveCallsForTable: (tableNumber: string) =>
    http<void>(`/api/sales/table-calls/table/${tableNumber}/resolve`, {
      method: 'PATCH',
    }),
};
