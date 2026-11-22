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
