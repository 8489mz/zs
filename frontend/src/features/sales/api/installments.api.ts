import { http } from '@/lib/http';

export interface InstallmentPlanItem {
  id: number;
  plan_number: string;
  sale_id: number | null;
  sale_doc_no?: string | null;
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  total_amount: number;
  down_payment: number;
  financed_amount: number;
  interest_rate_percent: number;
  interest_amount: number;
  total_with_interest: number;
  installment_count: number;
  monthly_amount: number;
  start_date: string;
  status: 'active' | 'completed' | 'defaulted' | 'cancelled';
  notes: string;
  paid_amount?: number;
  paid_count?: number;
  remaining_amount?: number;
  progress_percent?: number;
  created_at: string;
}

export interface CustomerInstallmentItem {
  id: number;
  plan_id: number;
  plan_number?: string;
  customer_id: number;
  customer_name?: string;
  customer_phone?: string;
  installment_number: number;
  installment_count?: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: 'pending' | 'partially_paid' | 'paid' | 'overdue';
  display_status?: 'pending' | 'partially_paid' | 'paid' | 'overdue';
  remaining_installment?: number;
  remaining_amount?: number;
  paid_at: string | null;
  payment_method: string;
  receipt_no: string | null;
  notes: string;
}

export interface InstallmentsMetrics {
  active_plans: number;
  total_plans: number;
  active_total_amount: number;
  total_collected: number;
  unpaid_amount: number;
  overdue_count: number;
  overdue_amount: number;
}

export interface CreateInstallmentPlanPayload {
  customerId: number;
  saleId?: number | null;
  totalAmount: number;
  downPayment?: number;
  interestRatePercent?: number;
  installmentCount: number;
  startDate?: string;
  // INV-INSTALLMENT-FIRST-DUE-DATE: the entered first-installment due
  // date; the schedule starts on it when supplied.
  firstDueDate?: string;
  notes?: string;
  branchId?: number | null;
}

export interface PayInstallmentPayload {
  amount: number;
  paymentMethod?: 'cash' | 'card' | 'bank_transfer' | 'instapay';
  notes?: string;
  receiptNo?: string;
}

export const installmentsApi = {
  getMetrics: async (): Promise<InstallmentsMetrics> => {
    return http<InstallmentsMetrics>('/api/installments/metrics');
  },

  listPlans: async (params?: { customerId?: number; status?: string; search?: string }): Promise<{ plans: InstallmentPlanItem[] }> => {
    const query = new URLSearchParams();
    if (params?.customerId) query.set('customerId', String(params.customerId));
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return http<{ plans: InstallmentPlanItem[] }>(`/api/installments/plans${qs ? `?${qs}` : ''}`);
  },

  getPlanDetails: async (id: number): Promise<{ plan: InstallmentPlanItem; installments: CustomerInstallmentItem[] }> => {
    return http<{ plan: InstallmentPlanItem; installments: CustomerInstallmentItem[] }>(`/api/installments/plans/${id}`);
  },

  createPlan: async (payload: CreateInstallmentPlanPayload): Promise<{ plan: InstallmentPlanItem; installments: CustomerInstallmentItem[] }> => {
    return http('/api/installments/plans', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  listSchedule: async (params?: {
    planId?: number;
    customerId?: number;
    status?: string;
    dueFrom?: string;
    dueTo?: string;
    search?: string;
    pageSize?: number;
  }): Promise<{ installments: CustomerInstallmentItem[] }> => {
    const query = new URLSearchParams();
    if (params?.planId) query.set('planId', String(params.planId));
    if (params?.customerId) query.set('customerId', String(params.customerId));
    if (params?.status) query.set('status', params.status);
    if (params?.dueFrom) query.set('dueFrom', params.dueFrom);
    if (params?.dueTo) query.set('dueTo', params.dueTo);
    if (params?.search) query.set('search', params.search);
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    const qs = query.toString();
    return http<{ installments: CustomerInstallmentItem[] }>(`/api/installments/schedule${qs ? `?${qs}` : ''}`);
  },

  payInstallment: async (
    id: number,
    payload: PayInstallmentPayload,
  ): Promise<{
    success: boolean;
    installment: CustomerInstallmentItem;
    receipt: {
      receipt_no: string;
      paid_amount: number;
      installment_number: number;
      paid_at: string;
      payment_method: string;
      customer_name: string;
      customer_phone: string;
    };
  }> => {
    return http(`/api/installments/${id}/pay`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
