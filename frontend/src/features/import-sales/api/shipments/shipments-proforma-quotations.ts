import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { todayLocalDateKey } from '@/lib/format';

export interface ProformaInvoice {
  id: string;
  tenant_id: string;
  project_id?: string;
  supplier_id: number;
  supplier_name?: string;
  pi_number: string;
  pi_date?: string;
  issue_date?: string;
  currency: string;
  total_amount_foreign: string | number;
  paid_amount_foreign: string | number;
  payment_status: 'unpaid' | 'partial' | 'paid';
  po_number?: string;
  po_status?: string;
  international_po_number?: string;
  status: string;
  items?: any;
  created_at?: string;
}

export const useProformaInvoicesQuery = (projectId?: string) => {
  return useQuery({
    queryKey: ['proforma-invoices', projectId],
    queryFn: async () => {
      const url = projectId ? `/api/import-sales/proforma-invoices?projectId=${projectId}` : '/api/import-sales/proforma-invoices';
      return await http<any[]>(url);
    },
  });
};

export const useApproveProformaInvoiceMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (piId: string) => {
      return await http<any>(`/api/import-sales/proforma-invoices/${piId}/approve`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proforma-invoices'] });
    },
  });
};

export const useGenerateInternationalPoMutation = (defaultPiId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (piId?: string) => {
      const id = piId || defaultPiId;
      return await http<any>(`/api/import-sales/proforma-invoices/${id}/generate-po`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proforma-invoices'] });
    },
  });
};

export interface CreateProformaInvoicePayload {
  projectId?: string;
  supplierId: string | number;
  piNumber: string;
  piDate?: string;
  issueDate?: string;
  currency?: string;
  totalAmountForeign: number;
  incoterm?: string;
  deliveryPort?: string;
  paymentTerms?: string;
  exchangeRateContract?: number;
  advancePercentage?: number;
  balancePercentage?: number;
  items?: any[];
  notes?: string;
}

export const useCreateProformaInvoiceMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateProformaInvoicePayload) => {
      const body = {
        projectId: payload.projectId || undefined,
        supplierId: Number(payload.supplierId),
        piNumber: payload.piNumber,
        piDate: payload.piDate || payload.issueDate || todayLocalDateKey(),
        currency: payload.currency || 'USD',
        totalAmountForeign: Number(payload.totalAmountForeign),
        incoterm: payload.incoterm || 'FOB',
        deliveryPort: payload.deliveryPort || undefined,
        paymentTerms: payload.paymentTerms || undefined,
        exchangeRateContract: payload.exchangeRateContract ? Number(payload.exchangeRateContract) : 50,
        advancePercentage: payload.advancePercentage ? Number(payload.advancePercentage) : 30,
        balancePercentage: payload.balancePercentage ? Number(payload.balancePercentage) : 70,
        items: payload.items || [],
        notes: payload.notes || undefined,
      };
      return await http<any>('/api/import-sales/proforma-invoices', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proforma-invoices'] });
    },
  });
};

export interface Quotation {
  id: string;
  tenant_id: string;
  project_id?: string;
  supplier_id: number;
  supplier_name?: string;
  quotation_no?: string;
  item_name?: string;
  incoterm?: string;
  currency?: string;
  unit_price_foreign?: string | number;
  total_amount_foreign?: string | number;
  exchange_rate_estimated?: string | number;
  estimated_freight_usd?: string | number;
  shipping_cost_estimated_usd?: string | number;
  estimated_customs_rate_percent?: string | number;
  customs_duty_estimated_egp?: string | number;
  estimated_landed_cost_egp?: string | number;
  estimated_unit_cost_egp?: string | number;
  production_lead_days?: number;
  lead_time_days?: number;
  moq?: number;
  status: 'pending' | 'draft' | 'under_review' | 'selected' | 'rejected';
  selection_reason?: string;
  expiry_date?: string;
  valid_until?: string;
  created_at?: string;
}

export const useQuotationsQuery = (projectId?: string) => {
  return useQuery({
    queryKey: ['import-quotations', projectId],
    queryFn: async () => {
      const url = projectId ? `/api/import-sales/quotations?projectId=${projectId}` : '/api/import-sales/quotations';
      return await http<any[]>(url);
    },
  });
};

export const useCreateQuotationMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        projectId: dto.projectId || dto.project_id || undefined,
        supplierId: Number(dto.supplierId ?? dto.supplier_id),
        quotationNo: dto.quotationNo || dto.quotation_no || `RFQ-${Date.now().toString().slice(-6)}`,
        inquiryDate: dto.inquiryDate || todayLocalDateKey(),
        expiryDate: dto.expiryDate || dto.validUntil || undefined,
        incoterm: dto.incoterm || 'FOB',
        currency: dto.currency || 'USD',
        itemName: dto.itemName || dto.item_name || `عرض سعر #${dto.quotationNo || ''}`.trim(),
        productId: dto.productId ? Number(dto.productId) : undefined,
        unitPriceForeign: Number(dto.unitPriceForeign ?? dto.totalAmountForeign ?? dto.unit_price_foreign ?? 0),
        moq: Number(dto.moq || 1),
        productionLeadDays: Number(dto.productionLeadDays ?? dto.leadTimeDays ?? 30),
        portOfLoading: dto.portOfLoading || undefined,
        estimatedFreightUsd: Number(dto.estimatedFreightUsd ?? dto.shippingCostEstimatedUsd ?? 0),
        estimatedCustomsRatePercent: Number(dto.estimatedCustomsRatePercent ?? 5),
        exchangeRate: Number(dto.exchangeRate ?? dto.exchangeRateEstimated ?? 50),
        notes: dto.notes || undefined,
      };
      return await http<any>('/api/import-sales/quotations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-quotations'] });
    },
  });
};

export const useSelectQuotationMutation = (defaultQuotationId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: string | { quotationId?: string; reason?: string; selectionReason?: string }) => {
      let id = defaultQuotationId;
      let selectionReason: string | undefined;
      if (typeof args === 'string') {
        selectionReason = args;
      } else if (args) {
        id = args.quotationId || defaultQuotationId;
        selectionReason = args.selectionReason || args.reason;
      }
      return await http<any>(`/api/import-sales/quotations/${id}/select`, {
        method: 'POST',
        body: JSON.stringify({
          selectionReason: selectionReason || 'اعتماد عرض السعر الأفضل فنياً ومالياً',
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-quotations'] });
      queryClient.invalidateQueries({ queryKey: ['import-projects'] });
    },
  });
};

// ==========================================
// PRE-ORDER CONVERSION TO SALES
// ==========================================
export const useConvertPreorderToSaleMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ preorderId, dto }: { preorderId: string; dto?: any }) => {
      return await http<any>(`/api/import-sales/preorders/${preorderId}/convert-to-sale`, {
        method: 'POST',
        body: JSON.stringify(dto || {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['container-preorders'] });
      queryClient.invalidateQueries({ queryKey: ['container-autopsy'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
};
