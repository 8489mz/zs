import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/http';

export interface Shipment {
  id: string;
  tenant_id: string;
  container_number: string;
  arrival_date: string | null;
  shipping_cost_usd: string;
  customs_cost_egp: string;
  internal_transport_cost_egp: string;
  exchange_rate_at_arrival: string;
  status: 'Pending' | 'In Customs' | 'Arrived';
  created_at: string;
  shipping_expense_id?: number;
  customs_expense_id?: number;
  transport_expense_id?: number;
  shipped_date?: string;
  eta_date?: string;
  clearance_date?: string;
  form4_number?: string | null;
  form4_date?: string | null;
  supplier_name?: string;
  bill_of_lading?: string;
  pricing_exchange_rate?: string;
  cost_allocation_method?: 'value' | 'weight' | 'cbm';
  project_id?: string | null;
  supplier_id?: number | null;
  actual_demurrage_fees?: string;
  // Explicit payee per cost component (INV-IMPORT-SUPPLIER-ATTRIBUTION).
  freight_supplier_id?: number | null;
  customs_supplier_id?: number | null;
  transport_supplier_id?: number | null;
  demurrage_supplier_id?: number | null;
  unallocable_cost_reason?: string | null;
}

export interface ShipmentItem {
  id: string;
  product_id: string;
  quantity: number;
  factory_unit_price_usd: string;
  allocated_overhead_egp: string;
  landed_cost_egp: string;
  created_at: string;
  product_name: string;
  received_quantity?: string;
  target_retail_margin?: string;
  target_wholesale_margin?: string;
  shortage_handling_method?: 'capitalize' | 'expense';
}

export interface ShipmentDetails extends Shipment {
  items: ShipmentItem[];
  inventory_receipt?: {
    id: number;
    state: string;
    posted_at: string;
    review_reason?: string | null;
    journal_entry_id?: number | null;
  } | null;
  demurrageRisk?: any;
}

export interface CreateShipmentDto {
  containerNumber: string;
  projectId?: string;
  arrivalDate?: string;
  supplierId?: string;
  billOfLading?: string;
  shippingDate?: string;
  freightType?: string;
  containerSize?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  freeDemurrageDays?: number;
  costAllocationMethod?: string;
}

export interface UpdateShipmentCostsDto {
  receiptLocationId?: number;
  shippingCostUsd?: number;
  shippingAccountId?: string;
  customsCostEgp?: number;
  customsAccountId?: string;
  internalTransportCostEgp?: number;
  transportAccountId?: string;
  // Explicit payee per cost component (INV-IMPORT-SUPPLIER-ATTRIBUTION).
  // A nonzero component with no payee and no unallocable reason fails
  // the receipt closed; the reason routes the component to clearing.
  freightSupplierId?: number;
  customsSupplierId?: number;
  transportSupplierId?: number;
  demurrageSupplierId?: number;
  unallocableCostReason?: string;
  exchangeRateAtArrival?: number;
  status?: string;
  shippedDate?: string;
  etaDate?: string;
  clearanceDate?: string;
  pricingExchangeRate?: number;
  form4Number?: string;
  form4Date?: string;
  costAllocationMethod?: 'value' | 'weight' | 'cbm';
}

export interface AddShipmentItemDto {
  productId: string;
  quantity: number;
  factoryUnitPriceUsd: number;
  unitWeightKg?: number;
  unitCbm?: number;
}

export interface RecordForeignTransferDto {
  supplierId: string;
  projectId?: string;
  proformaInvoiceId?: string;
  amountEgp: number;
  amountForeign: number;
  currency?: string;
  exchangeRateContract?: number;
  bankAccountId?: number;
  idempotencyKey?: string;
  notes?: string;
  approvalRequestId?: string;
  paymentMethod?: string;
  paymentReference?: string;
  bankSwiftCode?: string;
  form4Number?: string;
  form4Date?: string;
  carrierName?: string;
  travelDate?: string;
  handoverReceiptNo?: string;
  lcNumber?: string;
  lcIssuingBank?: string;
  lcExpiryDate?: string;
  lcDocuments?: string;
  cadHandoverProof?: string;
  paymentTerms?: string;
  paymentDueDate?: string;
}

/** Closed payment-method enum, mirroring the backend engine. Form 4 values stay optional at recording. */
export const IMPORT_PAYMENT_METHODS = [
  'bank_transfer',
  'cash_carried',
  'letter_of_credit',
  'cash_against_documents',
  'open_account',
] as const;

/** Arabic labels for the payment-method select, shared by the transfer and approvals forms. */
export const IMPORT_PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'تحويل بنكي',
  cash_carried: 'نقد محمول مع مسافر',
  letter_of_credit: 'اعتماد مستندي (LC)',
  cash_against_documents: 'دفع مقابل مستندات (CAD)',
  open_account: 'حساب مفتوح / آجل',
};

export type ImportPaymentMethod = (typeof IMPORT_PAYMENT_METHODS)[number];

/** Evidence fields the backend requires for each explicitly chosen method. */
export function paymentMethodEvidenceFields(method: string): string[] {
  switch (method) {
    case 'bank_transfer':
      return ['paymentReference'];
    case 'cash_carried':
      return ['carrierName', 'travelDate', 'handoverReceiptNo'];
    case 'letter_of_credit':
      return ['lcNumber', 'lcIssuingBank', 'lcExpiryDate', 'lcDocuments'];
    case 'cash_against_documents':
      return ['cadHandoverProof'];
    case 'open_account':
      return ['paymentTerms', 'paymentDueDate'];
    default:
      return [];
  }
}

export type ForeignTransferEvidence = Partial<Record<
  | 'paymentReference' | 'bankSwiftCode' | 'form4Number' | 'form4Date'
  | 'carrierName' | 'travelDate' | 'handoverReceiptNo'
  | 'lcNumber' | 'lcIssuingBank' | 'lcExpiryDate' | 'lcDocuments'
  | 'cadHandoverProof' | 'paymentTerms' | 'paymentDueDate',
  string
>>;

/**
 * Builds the transfer payload the backend DTO declares: the method
 * and its evidence travel with the money record. Evidence keys with
 * empty values are dropped so the backend sees only what the user
 * actually entered.
 */
export function buildForeignTransferPayload(
  base: Omit<RecordForeignTransferDto, 'paymentMethod'>,
  paymentMethod: string,
  evidence: ForeignTransferEvidence,
): RecordForeignTransferDto {
  const cleaned: ForeignTransferEvidence = {};
  for (const [key, value] of Object.entries(evidence)) {
    if (typeof value === 'string' && value.trim()) cleaned[key as keyof ForeignTransferEvidence] = value.trim();
  }
  return { ...base, paymentMethod, ...cleaned };
}

export const useShipmentsQuery = () => {
  return useQuery({
    queryKey: ['import-shipments'],
    queryFn: async () => {
      const data = await http<{ rows: Shipment[], stats: Record<string, number> }>('/api/import-sales/shipments');
      return data;
    },
  });
};

export const useShipmentDetailsQuery = (id: string) => {
  return useQuery({
    queryKey: ['import-shipments', id],
    queryFn: async () => {
      const data = await http<ShipmentDetails>(`/api/import-sales/shipments/${id}`);
      return data;
    },
    enabled: !!id,
  });
};

export const useForeignTransfersQuery = () => {
  return useQuery({
    queryKey: ['foreign-transfers'],
    queryFn: async () => {
      return await http<any[]>('/api/import-sales/foreign-transfers');
    },
  });
};

export const useCreateShipmentMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (dto: CreateShipmentDto) => {
      const data = await http<Shipment>('/api/import-sales/shipments', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments'] });
    },
  });
};

export const useUpdateShipmentCostsMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (dto: UpdateShipmentCostsDto) => {
      const data = await http<ShipmentDetails>(`/api/import-sales/shipments/${shipmentId}/costs`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
      queryClient.invalidateQueries({ queryKey: ['import-shipments'] });
    },
  });
};

export interface ReverseImportReceiptDto {
  approvalRequestId: string;
  reason: string;
}

export interface ResolveLegacyReceiptDto {
  approvalRequestId: string;
  reason: string;
}

/** Approval-gated reversal of a posted receipt: restores stock/WAC/lots and mirrors the journal. */
export const useReversePostedReceiptMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: ReverseImportReceiptDto) => {
      return await http(`/api/import-sales/shipments/${shipmentId}/reverse-receipt`, {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
      queryClient.invalidateQueries({ queryKey: ['import-shipments'] });
    },
  });
};

/** Approval-gated review that unfreezes a legacy_review_required receipt on journal + movement proof. */
export const useResolveLegacyReceiptMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: ResolveLegacyReceiptDto) => {
      return await http(`/api/import-sales/shipments/${shipmentId}/resolve-legacy-review`, {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
      queryClient.invalidateQueries({ queryKey: ['import-shipments'] });
    },
  });
};

export const useAddShipmentItemMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (dto: AddShipmentItemDto) => {
      const data = await http<ShipmentItem>(`/api/import-sales/shipments/${shipmentId}/items`, {
        method: 'POST',
        body: JSON.stringify(dto),
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
    },
  });
};

export const useImportProjectItemsMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const data = await http<{ success: boolean; importedCount: number }>(
        `/api/import-sales/shipments/${shipmentId}/import-project-items`,
        { method: 'POST' }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
      queryClient.invalidateQueries({ queryKey: ['import-shipments'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
};

export const useUpdateShipmentItemMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ itemId, dto }: { itemId: string, dto: { receivedQuantity?: number, targetRetailMargin?: number, targetWholesaleMargin?: number, shortageHandlingMethod?: 'capitalize' | 'expense', unitWeightKg?: number, unitCbm?: number } }) => {
      const data = await http(`/api/import-sales/shipment-items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
    },
  });
};

export const useApplyPricesMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const data = await http<{success: boolean, updatedCount: number}>(`/api/import-sales/shipments/${shipmentId}/apply-prices`, {
        method: 'POST',
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
};

export interface ProfitReport {
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  totalExpenses: number;
  netProfitPool: number;
  profitAttributionVerified?: boolean;
  attributionStatus?: string;
  partnerShares: {
    partnerId: string;
    name: string;
    percentage: number;
    shareAmount: number;
    withdrawnProfit?: number;
    currentBalance?: number;
  }[];
}

export const useProfitReportQuery = (startDate: string, endDate: string) => {
  return useQuery({
    queryKey: ['profit-report', startDate, endDate],
    queryFn: async () => {
      const data = await http<{ success: boolean, message: string, data: ProfitReport }>(
        `/api/import-sales/profit-report?startDate=${startDate}&endDate=${endDate}`
      );
      return data.data;
    },
    enabled: !!startDate && !!endDate,
  });
};

export interface Partner {
  id: string;
  name: string;
  profit_share_percentage: number;
  capital_amount: number;
  withdrawn_profit?: number;
}

export const usePartnersQuery = () => {
  return useQuery({
    queryKey: ['import-partners'],
    queryFn: async () => {
      const data = await http<Partner[]>('/api/import-sales/partners');
      return data;
    },
  });
};

export const useCreatePartnerMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { name: string; percentage: number; capitalAmount?: number; accountId?: string }) => {
      return await http('/api/import-sales/partners', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-partners'] });
      queryClient.invalidateQueries({ queryKey: ['profit-report'] });
    },
  });
};

export const useUpdatePartnerMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...dto }: { id: string; name?: string; percentage?: number; capitalAmount?: number }) => {
      return await http(`/api/import-sales/partners/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-partners'] });
      queryClient.invalidateQueries({ queryKey: ['profit-report'] });
    },
  });
};

export interface PartnerLedgerEntry {
  id: string;
  tenant_id: string;
  partner_id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'PROFIT_PAYOUT';
  amount: number;
  transaction_date: string;
  note: string;
  created_at: string;
}

export const usePartnerLedgerQuery = (partnerId: string) => {
  return useQuery({
    queryKey: ['partner-ledger', partnerId],
    queryFn: async () => {
      return await http<PartnerLedgerEntry[]>(`/api/import-sales/partners/${partnerId}/ledger`);
    },
    enabled: !!partnerId
  });
};

export const useRecordCapitalTransactionMutation = (partnerId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { type: 'DEPOSIT' | 'WITHDRAWAL'; amount: number; date: string; note?: string; accountId?: string }) => {
      return await http(`/api/import-sales/partners/${partnerId}/capital-transaction`, {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-partners'] });
      queryClient.invalidateQueries({ queryKey: ['partner-ledger', partnerId] });
      queryClient.invalidateQueries({ queryKey: ['profit-report'] });
    },
  });
};

export const useDeletePartnerMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return await http(`/api/import-sales/partners/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-partners'] });
      queryClient.invalidateQueries({ queryKey: ['profit-report'] });
    },
  });
};

export const useRecordForeignTransferMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (dto: RecordForeignTransferDto) => {
      return await http<{ success: boolean }>('/api/import-sales/foreign-transfer', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreign-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['treasury'] });
    },
  });
};

export const usePartnerPayoutMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      partnerId,
      amount,
      approvalRequestId,
      projectId,
      treasuryAccountId,
    }: {
      partnerId: string;
      amount: number;
      approvalRequestId: string;
      projectId?: string;
      treasuryAccountId?: string;
    }) => {
      return await http<{ success: boolean }>(`/api/import-sales/partners/${partnerId}/payout`, {
        method: 'POST',
        body: JSON.stringify({ amount, approvalRequestId, projectId, treasuryAccountId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-partners'] });
      queryClient.invalidateQueries({ queryKey: ['profit-report'] });
      queryClient.invalidateQueries({ queryKey: ['partner-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['treasury'] });
    },
  });
};


// ==========================================
// IMPORT ENTERPRISE HOOKS & TYPES
// ==========================================

export interface ImportCommandCenterMetrics {
  capital: {
    totalCapital: number;
    deployedCapital: number;
    availableCapital: number;
    totalWithdrawn: number;
  };
  pipeline: {
    projects: Record<string, number>;
    shipments: {
      inTransit: number;
      inCustoms: number;
      arrived: number;
    };
  };
  liabilities: {
    totalDebtForeign: number;
    totalDebtEgp?: number;
    unpaidProformaUsd?: number;
    supplierLiabilities?: Array<{
      id: number;
      name: string;
      balanceEgp: number;
      unpaidForeignUsd?: number;
      currency: string;
    }>;
  };
  alerts: {
    demurrageAlerts: Array<{
      shipmentId: string;
      containerNumber: string;
      status: string;
      isOverdue: boolean;
      overdueDays: number;
      estimatedFeesEgp: number;
      daysRemaining: number | null;
    }>;
    aciExpiring: Array<{
      id: string;
      acid_number: string;
      acid_expiry_date: string;
      status: string;
    }>;
  };
  performance: ProfitReport;
}

export const useImportCommandCenterQuery = () => {
  return useQuery({
    queryKey: ['import-command-center'],
    queryFn: async () => {
      return await http<ImportCommandCenterMetrics>('/api/import-sales/command-center');
    },
  });
};

export interface ImportProject {
  id: string;
  project_no: string;
  title: string;
  target_market: string;
  country_origin: string;
  country_destination: string;
  budget_currency: string;
  allocated_capital: number;
  target_roi_percentage: number;
  status: string;
  feasibility_data?: any;
  notes?: string;
  created_at: string;
  shipmentCount?: number;
}

export const useImportProjectsQuery = (status?: string) => {
  return useQuery({
    queryKey: ['import-projects', status],
    queryFn: async () => {
      const url = status ? `/api/import-sales/projects?status=${status}` : '/api/import-sales/projects';
      return await http<ImportProject[]>(url);
    },
  });
};

export const useImportProjectDetailsQuery = (id: string) => {
  return useQuery({
    queryKey: ['import-projects', id],
    queryFn: async () => {
      return await http<any>(`/api/import-sales/projects/${id}`);
    },
    enabled: !!id,
  });
};

export const useCreateImportProjectMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      return await http<ImportProject>('/api/import-sales/projects', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-projects'] });
      queryClient.invalidateQueries({ queryKey: ['import-command-center'] });
    },
  });
};

export const useUpdateImportProjectMutation = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      return await http<ImportProject>(`/api/import-sales/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-projects', id] });
      queryClient.invalidateQueries({ queryKey: ['import-projects'] });
      queryClient.invalidateQueries({ queryKey: ['import-command-center'] });
    },
  });
};

export const useProjectPartnersQuery = (projectId: string) => {
  return useQuery({
    queryKey: ['import-projects', projectId, 'partners'],
    queryFn: async () => {
      return await http<any[]>(`/api/import-sales/projects/${projectId}/partners`);
    },
    enabled: !!projectId,
  });
};

export const useSetProjectPartnersMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (partners: Array<{ partnerId: string; capitalShare?: number; profitPercentage: number }>) => {
      return await http<any>(`/api/import-sales/projects/${projectId}/partners`, {
        method: 'POST',
        body: JSON.stringify({ partners }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-projects', projectId, 'partners'] });
      queryClient.invalidateQueries({ queryKey: ['import-projects'] });
    },
  });
};

export const useCalculateFeasibilityMutation = () => {
  return useMutation({
    mutationFn: async (dto: any) => {
      return await http<any>('/api/import-sales/calculate-feasibility', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
  });
};

export interface ChinaSupplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  balance: number;
  chinese_name?: string;
  city?: string;
  province?: string;
  moq_description?: string;
  production_lead_time_days?: number;
  verified_bank_details?: any;
  incoterms_accepted?: string[];
  qc_rating?: number;
  quality_certifications?: string[];
  audit_status?: string;
  import_notes?: string;
}

export const useChinaSuppliersQuery = () => {
  return useQuery({
    queryKey: ['china-suppliers'],
    queryFn: async () => {
      return await http<ChinaSupplier[]>('/api/import-sales/china-suppliers');
    },
  });
};

export interface CreateChinaSupplierPayload {
  name: string;
  chineseName?: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  moqDescription?: string;
  productionLeadTimeDays?: number;
  bankBeneficiary?: string;
  bankName?: string;
  bankSwift?: string;
  bankAccount?: string;
  incotermsAccepted?: string[];
  notes?: string;
}

export const useCreateChinaSupplierMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateChinaSupplierPayload) => {
      return await http('/api/import-sales/china-suppliers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['china-suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });
};

export const useUpsertSupplierMetaMutation = (defaultSupplierId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const targetSupplierId = dto?.supplierId || defaultSupplierId;
      const payload = {
        chineseName: dto.chineseName ?? dto.chinese_name,
        city: dto.city,
        province: dto.province,
        moqDescription: dto.moqDescription ?? dto.moq_description,
        verifiedBankDetails: dto.verifiedBankDetails ?? dto.verified_bank_details,
        incotermsAccepted: dto.incotermsAccepted ?? dto.incoterms_accepted,
        qualityCertifications: dto.qualityCertifications ?? dto.quality_certifications,
        notes: dto.notes,
        productionLeadTimeDays:
          dto.productionLeadTimeDays !== undefined
            ? Number(dto.productionLeadTimeDays)
            : dto.production_lead_time_days !== undefined
              ? Number(dto.production_lead_time_days)
              : undefined,
        qcRating:
          dto.qcRating !== undefined
            ? Number(dto.qcRating)
            : dto.qc_rating !== undefined
              ? Number(dto.qc_rating)
              : undefined,
        auditStatus: dto.auditStatus ?? dto.audit_status,
      };
      return await http(`/api/import-sales/suppliers/${targetSupplierId}/meta`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['china-suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });
};

export const useQcInspectionsQuery = (projectId?: string, shipmentId?: string) => {
  return useQuery({
    queryKey: ['qc-inspections', projectId, shipmentId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);
      if (shipmentId) params.set('shipmentId', shipmentId);
      return await http<any[]>(`/api/import-sales/qc-inspections?${params.toString()}`);
    },
  });
};

export const useCreateQcInspectionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      return await http('/api/import-sales/qc-inspections', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qc-inspections'] });
    },
  });
};

export const useAciComplianceQuery = (id: string) => {
  return useQuery({
    queryKey: ['aci-compliance', id],
    queryFn: async () => {
      return await http<any>(`/api/import-sales/aci-compliance/${id}`);
    },
    enabled: !!id,
  });
};

export const useUpsertAciComplianceMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      return await http('/api/import-sales/aci-compliance', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aci-compliance'] });
      queryClient.invalidateQueries({ queryKey: ['import-command-center'] });
    },
  });
};

export const useCustomsTariffsQuery = (search?: string, sector?: string) => {
  return useQuery({
    queryKey: ['customs-tariffs', search, sector],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (sector && sector !== 'all') params.append('sector', sector);
      const qs = params.toString();
      const url = qs ? `/api/import-sales/customs-tariffs?${qs}` : '/api/import-sales/customs-tariffs';
      return await http<any[]>(url);
    },
  });
};

export const useCustomsTariffSectorsQuery = () => {
  return useQuery({
    queryKey: ['customs-tariffs-sectors'],
    queryFn: async () => {
      return await http<Array<{ id: string; name_ar: string; name_en: string; description_ar: string }>>(
        '/api/import-sales/customs-tariffs/sectors'
      );
    },
    staleTime: 1000 * 60 * 30,
  });
};

export const useSectorPresetsQuery = () => {
  return useQuery({
    queryKey: ['import-sector-presets'],
    queryFn: async () => {
      return await http<Array<{ key: string; nameAr: string; nameEn: string; categoryName: string }>>(
        '/api/import-sales/sector-presets'
      );
    },
    staleTime: 1000 * 60 * 30,
  });
};

export const useSyncOfficialTariffsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return await http('/api/import-sales/customs-tariffs/sync-official', { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customs-tariffs'] });
    },
  });
};

export const useCalculateCustomsMutation = () => {
  return useMutation({
    mutationFn: async (dto: { hsCode: string; cifValueEgp: number }) => {
      return await http<any>('/api/import-sales/calculate-customs', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
  });
};

export const useCloseProjectMutation = (defaultProjectId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: string | { projectId?: string; approvalRequestId: string; closingNotes?: string }) => {
      const projectId = typeof args === 'string' ? defaultProjectId : args.projectId || defaultProjectId;
      const approvalRequestId = typeof args === 'string' ? args : args.approvalRequestId;
      const closingNotes = typeof args === 'string' ? undefined : (args as any).closingNotes;
      return await http(`/api/import-sales/projects/${projectId}/close`, {
        method: 'POST',
        body: JSON.stringify({ approvalRequestId, closingNotes }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-projects'] });
      if (defaultProjectId) {
        queryClient.invalidateQueries({ queryKey: ['import-projects', defaultProjectId] });
      }
      queryClient.invalidateQueries({ queryKey: ['import-command-center'] });
    },
  });
};

export interface CustomsBroker {
  id: string;
  name: string;
  license_no?: string;
  license_number?: string;
  port_name?: string;
  phone?: string;
  customs_ports?: string[];
  is_active?: boolean;
  total_advances_egp?: number;
  total_liquidated_egp?: number;
  unliquidated_balance_egp?: number;
  current_balance_egp?: number;
  created_at?: string;
}

export const useCustomsBrokersQuery = () => {
  return useQuery({
    queryKey: ['customs-brokers'],
    queryFn: async () => {
      const data = await http<CustomsBroker[]>('/api/import-sales/customs-brokers');
      return data;
    },
  });
};

export const useCreateCustomsBrokerMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        name: dto.name,
        licenseNo: dto.licenseNo ?? dto.licenseNumber ?? dto.license_no,
        phone: dto.phone,
        email: dto.email,
        customsPorts:
          dto.customsPorts ??
          (dto.portName ? [dto.portName] : dto.customs_ports ? dto.customs_ports : undefined),
        taxNumber: dto.taxNumber ?? dto.tax_number,
        commercialRegistry: dto.commercialRegistry ?? dto.commercial_registry,
        notes: dto.notes,
      };
      return await http<CustomsBroker>('/api/import-sales/customs-brokers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customs-brokers'] });
    },
  });
};

export const useDisburseBrokerAdvanceMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        brokerId: dto.brokerId ?? dto.broker_id,
        projectId: dto.projectId || dto.project_id || undefined,
        shipmentId: dto.shipmentId || dto.shipment_id || undefined,
        advanceNo: dto.advanceNo || dto.advance_no || `ADV-${Date.now().toString().slice(-6)}`,
        amountEgp: Number(dto.amountEgp ?? dto.amount_egp ?? dto.amount ?? 0),
        disbursementDate: dto.disbursementDate || dto.disbursement_date || new Date().toISOString().slice(0, 10),
        paymentMethod: dto.paymentMethod || dto.payment_method || 'bank_transfer',
        treasuryAccountId: dto.treasuryAccountId || dto.treasury_account_id || undefined,
        notes: dto.notes || undefined,
      };
      return await http<any>('/api/import-sales/customs-brokers/advances', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customs-brokers'] });
      queryClient.invalidateQueries({ queryKey: ['customs-broker-statement'] });
    },
  });
};

export const useLiquidateBrokerExpenseMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        brokerId: dto.brokerId ?? dto.broker_id,
        advanceId: dto.advanceId || dto.advance_id || undefined,
        projectId: dto.projectId || dto.project_id || undefined,
        shipmentId: dto.shipmentId || dto.shipment_id || undefined,
        receiptNo: dto.receiptNo || dto.receiptNumber || dto.receipt_no || `REC-${Date.now().toString().slice(-6)}`,
        expenseDate: dto.expenseDate || dto.expense_date || new Date().toISOString().slice(0, 10),
        category: dto.category || dto.expenseCategory || 'clearance_fees',
        amountEgp: Number(dto.amountEgp ?? dto.amount_egp ?? dto.amount ?? 0),
        isCapitalized: dto.isCapitalized ?? dto.is_capitalized ?? true,
        isRefundableVat: dto.isRefundableVat ?? dto.is_refundable_vat ?? false,
        attachmentUrl: dto.attachmentUrl || dto.attachment_url || undefined,
        notes: dto.notes || undefined,
      };
      return await http<any>('/api/import-sales/customs-brokers/liquidate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customs-brokers'] });
      queryClient.invalidateQueries({ queryKey: ['customs-broker-statement'] });
    },
  });
};

export const useVerifyBrokerExpenseMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { expenseId: string; approvalRequestId: string }) => {
      return await http<any>(`/api/import-sales/customs-brokers/expenses/${dto.expenseId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ approvalRequestId: dto.approvalRequestId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customs-brokers'] });
      queryClient.invalidateQueries({ queryKey: ['customs-broker-statement'] });
    },
  });
};

export const useCustomsBrokerStatementQuery = (brokerId: string) => {
  return useQuery({
    queryKey: ['customs-broker-statement', brokerId],
    queryFn: async () => {
      return await http<any>(`/api/import-sales/customs-brokers/${brokerId}/statement`);
    },
    enabled: !!brokerId,
  });
};

export const useContainerDepositsQuery = (shipmentId?: string) => {
  return useQuery({
    queryKey: ['container-deposits', shipmentId],
    queryFn: async () => {
      const url = shipmentId ? `/api/import-sales/container-deposits?shipmentId=${shipmentId}` : '/api/import-sales/container-deposits';
      return await http<any[]>(url);
    },
  });
};

export const useRecordContainerDepositMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        shipmentId: dto.shipmentId || dto.shipment_id,
        projectId: dto.projectId || dto.project_id || undefined,
        containerNo: dto.containerNo || dto.containerNumber || dto.container_no,
        shippingLine: dto.shippingLine || dto.shipping_line,
        depositAmountEgp: Number(dto.depositAmountEgp ?? dto.deposit_amount_egp ?? 0),
        paymentDate: dto.paymentDate || dto.payment_date || new Date().toISOString().slice(0, 10),
        expectedReturnDate: dto.expectedReturnDate || dto.freeDaysDeadline || dto.expected_return_date || undefined,
        treasuryAccountId: dto.treasuryAccountId || dto.treasury_account_id || undefined,
        receiptNo: dto.receiptNo || dto.receipt_no || undefined,
        idempotencyKey: dto.idempotencyKey || `DEP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        notes: dto.notes || undefined,
      };
      return await http<any>('/api/import-sales/container-deposits', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['container-deposits'] });
    },
  });
};

export const useRefundContainerDepositMutation = (defaultDepositId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: any) => {
      const depositId = args?.depositId || defaultDepositId;
      const raw = args?.dto !== undefined ? args.dto : args;
      const payload = {
        actualReturnDate: raw.actualReturnDate || raw.actual_return_date || new Date().toISOString().slice(0, 10),
        refundedAmountEgp: Number(raw.refundedAmountEgp ?? raw.refunded_amount_egp ?? 0),
        deductionsAmountEgp:
          raw.deductionsAmountEgp !== undefined
            ? Number(raw.deductionsAmountEgp)
            : raw.deductedDamagesEgp !== undefined
              ? Number(raw.deductedDamagesEgp)
              : undefined,
        deductionReason: raw.deductionReason || raw.deduction_reason || raw.notes || undefined,
        treasuryAccountId: raw.treasuryAccountId || raw.treasury_account_id || undefined,
      };
      return await http<any>(`/api/import-sales/container-deposits/${depositId}/return-refund`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['container-deposits'] });
    },
  });
};

export const useContainerPreordersQuery = (shipmentId?: string) => {
  return useQuery({
    queryKey: ['container-preorders', shipmentId],
    queryFn: async () => {
      const url = shipmentId ? `/api/import-sales/preorders?shipmentId=${shipmentId}` : '/api/import-sales/preorders';
      return await http<any[]>(url);
    },
  });
};

export const useCreateContainerPreorderMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        shipmentId: dto.shipmentId || dto.shipment_id,
        projectId: dto.projectId || dto.project_id || undefined,
        customerId: Number(dto.customerId ?? dto.customer_id),
        productId: Number(dto.productId ?? dto.product_id),
        reservedQuantity: Number(dto.reservedQuantity ?? dto.reserved_quantity),
        agreedUnitPriceEgp: Number(dto.agreedUnitPriceEgp ?? dto.unit_price_egp ?? dto.agreed_unit_price_egp),
        depositAmountEgp: dto.depositAmountEgp !== undefined ? Number(dto.depositAmountEgp) : undefined,
        treasuryAccountId: dto.treasuryAccountId ? Number(dto.treasuryAccountId) : undefined,
        idempotencyKey: dto.idempotencyKey || `PRE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        notes: dto.notes || undefined,
      };
      return await http<any>('/api/import-sales/preorders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['container-preorders'] });
    },
  });
};

export const useCancelPreorderMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ preorderId, reason }: { preorderId: string; reason?: string }) => {
      return await http<any>(`/api/import-sales/preorders/${preorderId}/cancel`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['container-preorders'] });
      queryClient.invalidateQueries({ queryKey: ['container-autopsy'] });
    },
  });
};

export const useContainerAutopsyQuery = (shipmentId: string) => {
  return useQuery({
    queryKey: ['container-autopsy', shipmentId],
    queryFn: async () => {
      return await http<any>(`/api/import-sales/shipments/${shipmentId}/autopsy`);
    },
    enabled: !!shipmentId,
  });
};

export const useSampleOrdersQuery = (projectId?: string) => {
  return useQuery({
    queryKey: ['sample-orders', projectId],
    queryFn: async () => {
      const url = projectId ? `/api/import-sales/samples?projectId=${projectId}` : '/api/import-sales/samples';
      return await http<any[]>(url);
    },
  });
};

export const useCreateSampleOrderMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        projectId: dto.projectId || dto.project_id || undefined,
        supplierId: Number(dto.supplierId ?? dto.supplier_id),
        sampleCode: dto.sampleCode || dto.sample_code || `SMP-${Date.now().toString().slice(-6)}`,
        itemName: dto.itemName || dto.sampleName || dto.item_name,
        sampleCostForeign:
          dto.sampleCostForeign !== undefined
            ? Number(dto.sampleCostForeign)
            : dto.sampleCostUsd !== undefined
              ? Number(dto.sampleCostUsd)
              : 0,
        freightCostForeign:
          dto.freightCostForeign !== undefined
            ? Number(dto.freightCostForeign)
            : dto.courierCostUsd !== undefined
              ? Number(dto.courierCostUsd)
              : 0,
        currency: dto.currency || 'USD',
        requestDate: dto.requestDate || dto.request_date || new Date().toISOString().slice(0, 10),
        courierTrackingNo: dto.courierTrackingNo || dto.trackingNumber || dto.courier_tracking_no || undefined,
        notes: dto.notes || undefined,
      };
      return await http<any>('/api/import-sales/samples', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sample-orders'] });
    },
  });
};

export const useUpdateSampleInspectionMutation = (defaultSampleId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: any) => {
      const sampleId = args?.sampleId || defaultSampleId;
      const raw = args?.dto !== undefined ? args.dto : args;
      const payload = {
        qualityScore:
          raw.qualityScore !== undefined
            ? Number(raw.qualityScore)
            : raw.qualityRating !== undefined
              ? Number(raw.qualityRating) * 20
              : undefined,
        decision: raw.decision,
        referenceSampleApproved:
          raw.referenceSampleApproved !== undefined
            ? Boolean(raw.referenceSampleApproved)
            : raw.isGoldenSample !== undefined
              ? Boolean(raw.isGoldenSample)
              : undefined,
        defectAnalysis: raw.defectAnalysis ?? raw.inspectionNotes ?? raw.defect_analysis,
        receivedDate: raw.receivedDate || new Date().toISOString().slice(0, 10),
      };
      return await http<any>(`/api/import-sales/samples/${sampleId}/inspection`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sample-orders'] });
    },
  });
};

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
        piDate: payload.piDate || payload.issueDate || new Date().toISOString().slice(0, 10),
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
        inquiryDate: dto.inquiryDate || new Date().toISOString().slice(0, 10),
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

// ==========================================
// MAKER-CHECKER APPROVALS
// ==========================================
export const useApprovalRequestsQuery = (status?: string) => {
  return useQuery({
    queryKey: ['import-approvals', status],
    queryFn: async () => {
      const url = status ? `/api/import-sales/approvals?status=${encodeURIComponent(status)}` : '/api/import-sales/approvals';
      return await http<any[]>(url);
    },
  });
};

export const useCreateApprovalRequestMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        actionType: dto.actionType || dto.action_type,
        referenceId: String(dto.referenceId ?? dto.reference_id ?? dto.entityId ?? ''),
        requestPayload:
          dto.requestPayload ??
          dto.request_payload ?? {
            entityType: dto.entityType,
            amountEgp: dto.amountEgp,
            reason: dto.reason,
            ...(dto.payload || {}),
          },
      };
      return await http<any>('/api/import-sales/approvals', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-approvals'] });
    },
  });
};

export const useDecideApprovalRequestMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      decision,
      rejectionReason,
      decisionNotes,
      comments,
    }: {
      id: string;
      decision: 'approved' | 'rejected';
      rejectionReason?: string;
      decisionNotes?: string;
      comments?: string;
    }) => {
      return await http<any>(`/api/import-sales/approvals/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          rejectionReason: rejectionReason || decisionNotes || comments,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-approvals'] });
    },
  });
};

// ==========================================
// FX TREASURY & CURRENCY PORTFOLIO
// ==========================================
export const usePostSourcingTripExpenseMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { tripId: string; approvalRequestId: string; supplierId: number; expenseAccountId: number }) => {
      return await http<any>(`/api/import-sales/sourcing-trips/${dto.tripId}/post-expense`, {
        method: 'POST',
        body: JSON.stringify({
          approvalRequestId: dto.approvalRequestId,
          supplierId: dto.supplierId,
          expenseAccountId: dto.expenseAccountId,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-sourcing-trips'] });
    },
  });
};

export const useFxPortfolioQuery = () => {
  return useQuery({
    queryKey: ['import-fx-portfolio'],
    queryFn: async () => {
      return await http<any>('/api/import-sales/fx-portfolio');
    },
  });
};

/**
 * INV-IMPORT-ESTIMATES-HONEST: builds the FX-acquisition POST payload.
 * The EGP cost is NEVER invented: when the caller supplies neither an
 * explicit EGP cost nor an explicit exchange rate, this throws before any
 * request is sent instead of silently pricing the acquisition at an
 * assumed rate of 50. The backend trusts egpCost and posts a treasury
 * journal from it, so a silent fallback here would post invented money.
 */
export function buildFxAcquisitionPayload(dto: any): Record<string, unknown> {
  const foreignAmount = Number(dto.foreignAmount ?? dto.foreign_amount ?? 0);
  const explicitEgp = dto.egpCost ?? dto.egp_cost;
  const explicitRate = dto.exchangeRate ?? dto.exchange_rate;
  const hasEgp = explicitEgp !== undefined && explicitEgp !== null && explicitEgp !== '';
  const hasRate = explicitRate !== undefined && explicitRate !== null && explicitRate !== '' && Number(explicitRate) > 0;
  if (!hasEgp && !hasRate) {
    throw new Error(
      'لا يمكن تسجيل تدبير عملة بلا تكلفة بالجنيه ولا سعر صرف؛ حدد أحدهما صراحة. [IMPORT_FX_RATE_REQUIRED]',
    );
  }
  const egpCost = hasEgp ? Number(explicitEgp) : foreignAmount * Number(explicitRate);
  return {
    currency: dto.currency || 'USD',
    foreignAmount,
    egpCost,
    exchangeRate: dto.exchangeRate ?? dto.exchange_rate ?? undefined,
    acquisitionDate: dto.acquisitionDate || dto.acquisition_date || new Date().toISOString().slice(0, 10),
    source: dto.source || dto.sourceType || 'bank',
    bankAccountId: dto.bankAccountId || (dto.treasuryAccountId ? String(dto.treasuryAccountId) : undefined),
    sourceAccountId: dto.sourceAccountId || (dto.sourceTreasuryAccountId ? String(dto.sourceTreasuryAccountId) : undefined),
    transferId: dto.transferId ?? dto.supplierPaymentId ?? undefined,
    notes: dto.notes || undefined,
  };
}

export const useRecordFxAcquisitionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = buildFxAcquisitionPayload(dto);
      return await http<any>('/api/import-sales/fx-acquisitions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-fx-portfolio'] });
    },
  });
};

// ==========================================
// RECONCILIATION & EXCEPTIONS SCANNER
// ==========================================
export const useReconciliationExceptionsQuery = (status?: string) => {
  return useQuery({
    queryKey: ['import-reconciliation-exceptions', status],
    queryFn: async () => {
      const url = status ? `/api/import-sales/reconciliation/exceptions?status=${encodeURIComponent(status)}` : '/api/import-sales/reconciliation/exceptions';
      return await http<any[]>(url);
    },
  });
};

export const useRunReconciliationScanMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return await http<any>('/api/import-sales/reconciliation/scan', {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-reconciliation-exceptions'] });
    },
  });
};

export const useResolveReconciliationExceptionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, resolutionNotes }: { id: string; resolutionNotes?: string; status?: string }) => {
      return await http<any>(`/api/import-sales/reconciliation/exceptions/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolutionNotes: resolutionNotes || 'تمت المعالجة والمطابقة المحاسبية' }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-reconciliation-exceptions'] });
    },
  });
};

// ==========================================
// SOURCING TRIPS
// ==========================================
export const useSourcingTripsQuery = (projectId?: string) => {
  return useQuery({
    queryKey: ['import-sourcing-trips', projectId],
    queryFn: async () => {
      const url = projectId ? `/api/import-sales/sourcing-trips?projectId=${encodeURIComponent(projectId)}` : '/api/import-sales/sourcing-trips';
      return await http<any[]>(url);
    },
  });
};

export const useCreateSourcingTripMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        projectId: dto.projectId || dto.project_id || undefined,
        tripTitle: dto.tripTitle || dto.trip_title || dto.trip_name || dto.title,
        destinationCity: dto.destinationCity || dto.destination_city || dto.cities_visited || dto.destination || 'Guangzhou / Yiwu',
        startDate: dto.startDate || dto.start_date || new Date().toISOString().slice(0, 10),
        endDate: dto.endDate || dto.end_date || undefined,
        budgetEgp: Number(dto.budgetEgp ?? dto.budget_egp ?? (dto.travel_cost_usd ? Number(dto.travel_cost_usd) * 50 : 0)),
        actualCostEgp: Number(dto.actualCostEgp ?? dto.actual_cost_egp ?? (dto.travel_cost_usd ? Number(dto.travel_cost_usd) * 50 : 0)),
        notes: dto.notes || dto.objectives || dto.outcomes_summary || undefined,
      };
      return await http<any>('/api/import-sales/sourcing-trips', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-sourcing-trips'] });
    },
  });
};

// ==========================================
// RECEIVING INSPECTIONS, LATE EXPENSES & FEASIBILITY CONVERSION
// ==========================================
export const useCreateReceivingInspectionMutation = (defaultShipmentId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const shipmentId = dto?.shipmentId || defaultShipmentId;
      return await http<any>('/api/import-sales/qc-inspections', {
        method: 'POST',
        body: JSON.stringify({ ...dto, shipmentId }),
      });
    },
    onSuccess: (_data, variables: any) => {
      const shipmentId = variables?.shipmentId || defaultShipmentId;
      if (shipmentId) {
        queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
        queryClient.invalidateQueries({ queryKey: ['container-autopsy', shipmentId] });
      }
    },
  });
};

// The backend route is POST shipments/:shipmentId/late-expense and its
// DTO (ProcessLateExpenseDto) declares lateExpenseAmount, title,
// accountId, note, payableAccountId, supplierId and
// unallocableReason. The dialog historically sent unrelated fields
// (expenseCategory, handlingMethod, treasuryAccountId,
// idempotencyKey) to the plural route; the whitelist validation
// pipe rejected every submit before the service. Map every caller
// shape to exactly the DTO fields. The dialog treasury account is
// deliberately NOT mapped to accountId: the backend reads
// accountId as a COGS-account override, not a payment account,
// and this endpoint posts a payable, never a treasury movement.
// supplierId names the explicit payee; unallocableReason records
// why the expense is genuinely unallocable (clearing path) —
// exactly one of the two must be supplied, never a silent
// default to the goods supplier.
const LATE_EXPENSE_TYPE_TITLES: Record<string, string> = {
  demurrage: 'غرامات تأخير وأرضيات',
  customs_diff: 'فروق تسوية جمركية لاحقة',
  transport: 'نقل ومشال إضافي',
  other: 'مصروفات استيراد أخرى',
};

export function buildLateExpensePayload(rawDto: any): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    lateExpenseAmount: Number(rawDto?.lateExpenseAmount ?? rawDto?.amountEgp ?? rawDto?.amount ?? 0),
    title:
      rawDto?.title ||
      LATE_EXPENSE_TYPE_TITLES[rawDto?.expenseCategory || rawDto?.expenseType] ||
      'Late shipment expense',
  };
  const note = rawDto?.note ?? rawDto?.notes ?? rawDto?.description;
  if (note !== undefined) payload.note = note;
  if (rawDto?.accountId !== undefined) payload.accountId = String(rawDto.accountId);
  if (rawDto?.payableAccountId !== undefined) payload.payableAccountId = Number(rawDto.payableAccountId);
  if (rawDto?.supplierId !== undefined && rawDto?.supplierId !== null && rawDto?.supplierId !== '') payload.supplierId = Number(rawDto.supplierId);
  if (rawDto?.unallocableReason !== undefined && rawDto?.unallocableReason !== null && String(rawDto.unallocableReason).trim() !== '') payload.unallocableReason = String(rawDto.unallocableReason);
  return payload;
}

// The backend returns the split under allocation.lateCogsAdjustmentEgp /
// allocation.lateInventoryAdjustmentEgp. Read only those fields.
export function lateExpenseAllocationSummary(res: any): {
  capitalizedToInventoryEgp: number;
  expensedToCogsEgp: number;
} {
  return {
    capitalizedToInventoryEgp: Number(res?.allocation?.lateInventoryAdjustmentEgp || 0),
    expensedToCogsEgp: Number(res?.allocation?.lateCogsAdjustmentEgp || 0),
  };
}

export const useRecordLateShipmentExpenseMutation = (defaultShipmentId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: any) => {
      const shipmentId = args?.shipmentId || defaultShipmentId;
      const rawDto = args?.dto !== undefined ? args.dto : args;
      return await http<any>(`/api/import-sales/shipments/${shipmentId}/late-expense`, {
        method: 'POST',
        body: JSON.stringify(buildLateExpensePayload(rawDto)),
      });
    },
    onSuccess: (_data, variables: any) => {
      const shipmentId = variables?.shipmentId || defaultShipmentId;
      if (shipmentId) {
        queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
        queryClient.invalidateQueries({ queryKey: ['container-autopsy', shipmentId] });
      }
    },
  });
};

export const useConvertFeasibilityToProjectMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      if (dto.projectId) {
        return await http<any>(`/api/import-sales/projects/${dto.projectId}/convert-feasibility`, {
          method: 'POST',
          body: JSON.stringify(dto),
        });
      }
      return await http<any>('/api/import-sales/projects', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-projects'] });
      queryClient.invalidateQueries({ queryKey: ['proforma-invoices'] });
    },
  });
};

