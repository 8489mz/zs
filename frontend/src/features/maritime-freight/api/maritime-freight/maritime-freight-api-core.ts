import { http } from '@/lib/http';
import type { ShippingPort, ShippingLine, ReferenceDataResponse, MaritimeRfq, MaritimeRfqBid, MaritimeQuotation, MaritimeJob, MaritimeContainer, CreateMaritimeContainerPayload, UpdateMaritimeContainerPayload, MaritimePipelineConfig, CargoInsurance, WarehouseReceipt, MaritimeJobDocument, MaritimeInlandTruckingTrip } from './maritime-freight-types';
import type { MaritimeRateCard, MaritimeCustomsDeclaration, MaritimeCustomsDeclarationItem, FreightAuditPreview, MaritimeCarrierInvoice } from './maritime-freight-portal-types';

function toQueryString(params?: Record<string, any>): string {
  if (!params) return '';
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== null && val !== '') {
      searchParams.append(key, String(val));
    }
  });
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

export const maritimeApi = {
  // Ports
  getPorts: () => http<ShippingPort[]>('/api/maritime-freight/ports'),
  createPort: (data: { code: string; nameAr: string; nameEn: string; countryCode: string; countryName: string }) =>
    http<ShippingPort>('/api/maritime-freight/ports', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Shipping Lines & Overseas Partners
  getShippingLines: (params?: { carrierType?: string; tradeLane?: string; countryCode?: string; search?: string }) =>
    http<ShippingLine[]>(`/api/maritime-freight/shipping-lines${toQueryString(params)}`),
  createShippingLine: (data: any) =>
    http<ShippingLine>('/api/maritime-freight/shipping-lines', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateShippingLine: (id: string, data: any) =>
    http<ShippingLine>(`/api/maritime-freight/shipping-lines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteShippingLine: (id: string) =>
    http<{ success: boolean }>(`/api/maritime-freight/shipping-lines/${id}`, {
      method: 'DELETE',
    }),
  seedDefaultMasterData: () =>
    http<{ portsAdded: number; linesAdded: number; agentsAdded: number }>('/api/maritime-freight/master-data/seed-defaults', {
      method: 'POST',
    }),
  importCarriersBulk: (items: any[]) =>
    http<{ insertedCount: number; updatedCount: number; totalProcessed: number; summary: string }>('/api/maritime-freight/shipping-lines/import-bulk', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  getReferenceData: () =>
    http<ReferenceDataResponse>('/api/maritime-freight/reference-data'),

  // RFQs
  getRfqs: (params?: { status?: string; search?: string }) =>
    http<MaritimeRfq[]>(`/api/maritime-freight/rfqs${toQueryString(params)}`),
  getRfqById: (id: string) => http<MaritimeRfq>(`/api/maritime-freight/rfqs/${id}`),
  createRfq: (data: any) =>
    http<MaritimeRfq>('/api/maritime-freight/rfqs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  dispatchRfqEmails: (id: string, targetLineIds?: number[]) =>
    http<{ sentCount: number; message: string }>(`/api/maritime-freight/rfqs/${id}/dispatch-emails`, {
      method: 'POST',
      body: JSON.stringify({ targetLineIds }),
    }),

  // Bids
  submitBid: (data: any) =>
    http<MaritimeRfqBid>('/api/maritime-freight/bids', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  awardBid: (id: string) =>
    http<MaritimeRfqBid>(`/api/maritime-freight/bids/${id}/award`, {
      method: 'POST',
    }),
  parseEmailText: (text: string) =>
    http<any>('/api/maritime-freight/parse-email-text', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  // Quotations
  getQuotations: (params?: { status?: string; search?: string }) =>
    http<MaritimeQuotation[]>(`/api/maritime-freight/quotations${toQueryString(params)}`),
  createQuotation: (data: any) =>
    http<MaritimeQuotation>('/api/maritime-freight/quotations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateQuotationStatus: (id: string, status: 'approved' | 'rejected' | 'sent') =>
    http<MaritimeQuotation>(`/api/maritime-freight/quotations/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  // Jobs
  getJobs: (params?: { status?: string; search?: string; milestone?: string }) =>
    http<MaritimeJob[]>(`/api/maritime-freight/jobs${toQueryString(params)}`),
  getJobById: (id: string) => http<MaritimeJob>(`/api/maritime-freight/jobs/${id}`),
  createJob: (data: any) =>
    http<MaritimeJob>('/api/maritime-freight/jobs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateJob: (id: string, data: any) =>
    http<MaritimeJob>(`/api/maritime-freight/jobs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  parseBookingText: (text: string) =>
    http<{
      bookingNumber: string | null;
      shippingLineName: string | null;
      vesselName: string | null;
      voyageNumber: string | null;
      polName: string | null;
      podName: string | null;
      etd: string | null;
      eta: string | null;
      portCutOff: string | null;
      mblNumber: string | null;
      containers: Array<{ containerNumber: string; containerType: string }>;
    }>('/api/maritime-freight/jobs/parse-booking-text', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  addJobMilestone: (id: string, milestoneKey: string, notes?: string, location?: string) =>
    http<MaritimeJob>(`/api/maritime-freight/jobs/${id}/milestones`, {
      method: 'POST',
      body: JSON.stringify({ milestoneKey, notes, location }),
    }),
  releaseDeliveryOrder: (id: string) =>
    http<MaritimeJob>(`/api/maritime-freight/jobs/${id}/release-do`, {
      method: 'POST',
    }),
  getJobWhatsAppAlert: (id: string, milestone: string) =>
    http<{ message: string; customerPhone?: string; customerName: string; jobNumber: string }>(
      `/api/maritime-freight/jobs/${id}/whatsapp-alert?milestone=${milestone}`,
    ),
  settleJobFromBalance: (jobId: string, amount?: number) =>
    http<{
      success: boolean;
      job: MaritimeJob;
      settledAmount: number;
      remainingUnpaid: number;
      customerBalanceAfter: number;
      customerAvailableCreditAfter: number;
      message: string;
    }>(`/api/maritime-freight/jobs/${jobId}/settle-from-balance`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  getCustomerActiveJobs: (customerId: number | string) =>
    http<Array<{
      id: string;
      job_number: string;
      pol_name: string;
      pod_name: string;
      vessel_name: string | null;
      milestone_status: string;
      client_invoiced_total: number;
      client_paid_total: number;
      payment_status: 'unpaid' | 'partially_paid' | 'paid';
      status: string;
      invoiced: number;
      paid: number;
      unpaid: number;
    }>>(`/api/maritime-freight/customers/${customerId}/active-jobs`),

  // Containers
  getContainers: (params?: { overdueOnly?: boolean; depositHeldOnly?: boolean; search?: string }) =>
    http<MaritimeContainer[]>(`/api/maritime-freight/containers${toQueryString(params)}`),
  createContainer: (data: CreateMaritimeContainerPayload) =>
    http<MaritimeContainer>('/api/maritime-freight/containers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateContainer: (id: string, data: UpdateMaritimeContainerPayload) => {
    const { seal_number, discharged_at, gated_out_at, ...payload } = data;
    return http<MaritimeContainer>(`/api/maritime-freight/containers/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...payload,
        ...(seal_number !== undefined ? { sealNumber: seal_number } : {}),
        ...(discharged_at !== undefined ? { dischargedAt: discharged_at } : {}),
        ...(gated_out_at !== undefined ? { gatedOutAt: gated_out_at } : {}),
      }),
    });
  },

  // Tab Badges & Summary Counts
  getCounts: () =>
    http<{
      inquiries: number;
      rfqs: number;
      matrixBids: number;
      quotations: number;
      jobs: number;
      containers: number;
      master: number;
      settings: number;
    }>('/api/maritime-freight/counts'),

  // Client Freight Inquiries Engine
  getInquiries: (params?: { status?: string; search?: string }) =>
    http<any[]>(`/api/maritime-freight/inquiries${toQueryString(params)}`),
  getInquiryById: (id: string) =>
    http<any>(`/api/maritime-freight/inquiries/${id}`),
  createInquiry: (data: any) =>
    http<any>('/api/maritime-freight/inquiries', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  convertInquiryToRfq: (id: string, targetLineIds?: number[]) =>
    http<MaritimeRfq>(`/api/maritime-freight/inquiries/${id}/convert-to-rfq`, {
      method: 'POST',
      body: JSON.stringify({ targetLineIds }),
    }),
  autoConvertQuotationToJob: (quotationId: string) =>
    http<MaritimeJob>(`/api/maritime-freight/quotations/${quotationId}/convert-to-job`, {
      method: 'POST',
    }),

  // Mail & Outlook Automation Settings
  getMailSettings: () =>
    http<any>('/api/maritime-freight/mail-settings'),
  saveMailSettings: (data: any) =>
    http<any>('/api/maritime-freight/mail-settings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  testMailConnection: (data?: any) =>
    http<{ smtpOk: boolean; smtpMessage: string; imapOk: boolean; imapMessage: string }>('/api/maritime-freight/mail-settings/test', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
  sendTestEmail: (email: string) =>
    http<{ success: boolean; messageId: string }>('/api/maritime-freight/mail-settings/send-test', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  syncInboundBids: () =>
    http<{ scanned: number; imported: number; summary: string; error?: string }>('/api/maritime-freight/mail-settings/sync-bids', {
      method: 'POST',
    }),

  // Automation Pipeline & Checkpoints Engine
  getPipelineSettings: () =>
    http<MaritimePipelineConfig>('/api/maritime-freight/pipeline-settings'),
  savePipelineSettings: (data: Partial<MaritimePipelineConfig>) =>
    http<MaritimePipelineConfig>('/api/maritime-freight/pipeline-settings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  triggerPipeline: () =>
    http<{ processedRfqs: number; awardedCount: number; quotesGenerated: number; details: string[] }>(
      '/api/maritime-freight/pipeline/trigger',
      { method: 'POST' },
    ),

  // Financial Ledger & Accounting Posting
  issueJobSalesInvoice: (id: string, payload?: { amount?: number; notes?: string }) =>
    http<{ success: boolean; job: MaritimeJob; journalEntryId: number; entryNo: string; amount: number; message: string }>(
      `/api/maritime-freight/jobs/${id}/issue-invoice`,
      {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      },
    ),
  recordJobExpenseVoucher: (
    id: string,
    payload: {
      amount: number;
      expenseType?: 'carrier' | 'port' | 'other';
      paymentMethod?: 'payable' | 'cash' | 'bank';
      supplierId?: number;
      supplierName?: string;
      description?: string;
    },
  ) =>
    http<{ success: boolean; job: MaritimeJob; journalEntryId: number; entryNo: string; amount: number; message: string }>(
      `/api/maritime-freight/jobs/${id}/record-expense`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
  getJobFinancialLedger: (id: string) =>
    http<{ jobId: string; jobNumber: string; costCenterId?: string; entries: any[] }>(
      `/api/maritime-freight/jobs/${id}/financial-ledger`,
    ),

  // Public Tracking
  getPublicTracking: (token: string) =>
    http<any>(`/api/public/freight-tracking/${token}`),

  // Direct WhatsApp Milestone Dispatch
  sendJobMilestoneWhatsApp: (jobId: string, milestone: string, phone?: string) =>
    http<{ success: boolean; message?: string }>(`/api/maritime-freight/jobs/${jobId}/send-whatsapp`, {
      method: 'POST',
      body: JSON.stringify({ milestone, phone }),
    }),

  // Rate Management (Contract/Tariff Rate Cards)
  listRateCards: (params?: { polCode?: string; podCode?: string; containerType?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.polCode) qs.set('polCode', params.polCode);
    if (params?.podCode) qs.set('podCode', params.podCode);
    if (params?.containerType) qs.set('containerType', params.containerType);
    if (params?.status) qs.set('status', params.status);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return http<MaritimeRateCard[]>(`/api/maritime-freight/rate-cards${query}`);
  },

  findBestRate: (polCode: string, podCode: string, containerType?: string) => {
    const qs = new URLSearchParams({ polCode, podCode });
    if (containerType) qs.set('containerType', containerType);
    return http<MaritimeRateCard[]>(`/api/maritime-freight/rate-cards/best?${qs.toString()}`);
  },

  createRateCard: (data: Partial<MaritimeRateCard>) =>
    http<MaritimeRateCard>('/api/maritime-freight/rate-cards', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  createRateCardFromBid: (bidId: string, validUntil: string) =>
    http<MaritimeRateCard>(`/api/maritime-freight/bids/${bidId}/save-as-rate-card`, {
      method: 'POST',
      body: JSON.stringify({ validUntil }),
    }),

  updateRateCardStatus: (id: string, status: 'active' | 'expired' | 'draft') =>
    http<MaritimeRateCard>(`/api/maritime-freight/rate-cards/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  deleteRateCard: (id: string) =>
    http<{ success: boolean }>(`/api/maritime-freight/rate-cards/${id}`, {
      method: 'DELETE',
    }),

  // Customs Declarations (HS Codes & Duty Tracking)
  listCustomsDeclarations: (jobId: string) =>
    http<MaritimeCustomsDeclaration[]>(`/api/maritime-freight/jobs/${jobId}/customs-declarations`),

  getCustomsDeclarationDetail: (id: string) =>
    http<{ declaration: MaritimeCustomsDeclaration; items: MaritimeCustomsDeclarationItem[] }>(`/api/maritime-freight/customs-declarations/${id}`),

  createCustomsDeclaration: (jobId: string, data: any) =>
    http<{ declaration: MaritimeCustomsDeclaration; items: MaritimeCustomsDeclarationItem[] }>(`/api/maritime-freight/jobs/${jobId}/customs-declarations`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  addCustomsDeclarationItem: (declarationId: string, data: any) =>
    http<MaritimeCustomsDeclarationItem>(`/api/maritime-freight/customs-declarations/${declarationId}/items`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCustomsDeclarationStatus: (id: string, status: string, declarationNumber?: string) =>
    http<MaritimeCustomsDeclaration>(`/api/maritime-freight/customs-declarations/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, declarationNumber }),
    }),

  // Freight Audit & Carrier Invoices (Rate Reconciliation)
  previewCarrierInvoiceAudit: (jobId: string, data: any) =>
    http<FreightAuditPreview>(`/api/maritime-freight/jobs/${jobId}/carrier-invoices/preview`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  createCarrierInvoice: (jobId: string, data: any) =>
    http<{ success: boolean; invoice: MaritimeCarrierInvoice; audit: any; message: string }>(`/api/maritime-freight/jobs/${jobId}/carrier-invoices`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listJobCarrierInvoices: (jobId: string) =>
    http<MaritimeCarrierInvoice[]>(`/api/maritime-freight/jobs/${jobId}/carrier-invoices`),

  listAllCarrierInvoices: (params?: {
    auditStatus?: string;
    shippingLineId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.auditStatus) qs.set('auditStatus', params.auditStatus);
    if (params?.shippingLineId) qs.set('shippingLineId', params.shippingLineId);
    if (params?.search) qs.set('search', params.search);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return http<{
      invoices: MaritimeCarrierInvoice[];
      summary: {
        totalInvoices: number;
        totalInvoicedAmount: number;
        matchedCount: number;
        overchargeCount: number;
        disputedCount: number;
        totalOverchargeAmount: number;
      };
    }>(`/api/maritime-freight/carrier-invoices${query}`);
  },

  overrideCarrierInvoice: (id: string, reason: string) =>
    http<{ success: boolean; invoice: MaritimeCarrierInvoice; message: string }>(`/api/maritime-freight/carrier-invoices/${id}/override`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  createCarrierDispute: (id: string, data: { reason: string; disputedAmount?: number }) =>
    http<{ success: boolean; dispute: any; message: string }>(`/api/maritime-freight/carrier-invoices/${id}/dispute`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  resolveCarrierDispute: (id: string, data: any) =>
    http<{ success: boolean; dispute: any; message: string }>(`/api/maritime-freight/carrier-disputes/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Cargo Insurance
  createCargoInsurance: (jobId: string, data: Partial<CargoInsurance>) =>
    http<CargoInsurance>(`/api/maritime-freight/jobs/${jobId}/insurances`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCargoInsurance: (id: string, data: Partial<CargoInsurance>) =>
    http<CargoInsurance>(`/api/maritime-freight/insurances/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  claimCargoInsurance: (id: string, data: { claimAmount: number; claimStatus: string; claimNotes?: string }) =>
    http<CargoInsurance>(`/api/maritime-freight/insurances/${id}/claim`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getJobInsurances: (jobId: string) =>
    http<CargoInsurance[]>(`/api/maritime-freight/jobs/${jobId}/insurances`),

  // Transit & Bonded Warehouse Receipts
  createWarehouseReceipt: (jobId: string, data: Partial<WarehouseReceipt>) =>
    http<WarehouseReceipt>(`/api/maritime-freight/jobs/${jobId}/warehouse-receipts`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  releaseWarehouseReceipt: (id: string, data: { notes?: string }) =>
    http<WarehouseReceipt>(`/api/maritime-freight/warehouse-receipts/${id}/release`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getJobWarehouseReceipts: (jobId: string) =>
    http<WarehouseReceipt[]>(`/api/maritime-freight/jobs/${jobId}/warehouse-receipts`),
  getWarehouseReceipts: (params?: { status?: string; search?: string }) =>
    http<WarehouseReceipt[]>(`/api/maritime-freight/warehouse-receipts${toQueryString(params)}`),

  // Itemized Charges & ROE
  getQuotationCharges: (quotationId: string | number) =>
    http<any[]>(`/api/maritime-freight/quotations/${quotationId}/charges`),
  getJobCharges: (jobId: string | number) =>
    http<any[]>(`/api/maritime-freight/jobs/${jobId}/charges`),
  updateJobCharges: (jobId: string | number, charges: any[]) =>
    http<any[]>(`/api/maritime-freight/jobs/${jobId}/charges`, {
      method: 'PUT',
      body: JSON.stringify({ charges }),
    }),
  calculateJobForex: (jobId: string | number, actualRoe: number) =>
    http<any>(`/api/maritime-freight/jobs/${jobId}/calculate-forex`, {
      method: 'POST',
      body: JSON.stringify({ actualRoe }),
    }),

  // Consolidation Sub-Jobs
  listConsolidationSubJobs: (jobId: string | number) =>
    http<MaritimeJob[]>(`/api/maritime-freight/jobs/${jobId}/sub-jobs`),
  getJobSubJobs: (jobId: string | number) =>
    http<MaritimeJob[]>(`/api/maritime-freight/jobs/${jobId}/sub-jobs`),
  createConsolidationSubJob: (jobId: string | number, data: any) =>
    http<MaritimeJob>(`/api/maritime-freight/jobs/${jobId}/sub-jobs`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  createJobSubJob: (jobId: string | number, data: any) =>
    http<MaritimeJob>(`/api/maritime-freight/jobs/${jobId}/sub-jobs`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Digital Shipment e-Folder / Document Binder
  listJobDocuments: (jobId: string | number) =>
    http<MaritimeJobDocument[]>(`/api/maritime-freight/jobs/${jobId}/documents`),
  getJobDocuments: (jobId: string | number) =>
    http<MaritimeJobDocument[]>(`/api/maritime-freight/jobs/${jobId}/documents`),
  createJobDocument: (jobId: string | number, data: any) =>
    http<MaritimeJobDocument>(`/api/maritime-freight/jobs/${jobId}/documents`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  uploadJobDocument: (jobId: string | number, data: any) =>
    http<MaritimeJobDocument>(`/api/maritime-freight/jobs/${jobId}/documents`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteJobDocument: (jobId: string | number, docId: string | number) =>
    http<{ success: boolean }>(`/api/maritime-freight/jobs/${jobId}/documents/${docId}`, {
      method: 'DELETE',
    }),

  // Overseas Agent Settlements & Profit Sharing (SOA)
  listAgentSettlements: (params?: { agentId?: string; status?: string; search?: string }) =>
    http<any[]>(`/api/maritime-freight/agent-settlements${toQueryString(params)}`),
  createAgentSettlement: (data: any) =>
    http<any>(`/api/maritime-freight/agent-settlements`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateAgentSettlementStatus: (id: string | number, status: string, notes?: string) =>
    http<any>(`/api/maritime-freight/agent-settlements/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, notes }),
    }),
  getAgentStatementOfAccount: (agentId: string | number) =>
    http<{ agentId: string; settlements: any[]; summary: any }>(`/api/maritime-freight/agent-settlements/agents/${agentId}/soa`),

  // Inland Trucking Trips & Container Dispatch
  listInlandTruckingTrips: (jobId?: string | number) =>
    http<MaritimeInlandTruckingTrip[]>(`/api/maritime-freight/inland-trucking-trips${toQueryString({ jobId })}`),
  getJobTruckingTrips: (jobId?: string | number) =>
    http<MaritimeInlandTruckingTrip[]>(`/api/maritime-freight/inland-trucking-trips${toQueryString({ jobId })}`),
  createInlandTruckingTrip: (data: any) =>
    http<any>(`/api/maritime-freight/inland-trucking-trips`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  createJobTruckingTrip: (jobId: string | number, data: any) =>
    http<MaritimeInlandTruckingTrip>(`/api/maritime-freight/inland-trucking-trips`, {
      method: 'POST',
      body: JSON.stringify({ ...data, jobId }),
    }),
  updateInlandTruckingTripStatus: (id: string | number, tripStatus: string, deliveryDate?: string, notes?: string) =>
    http<any>(`/api/maritime-freight/inland-trucking-trips/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ tripStatus, deliveryDate, notes }),
    }),
  updateTruckingTrip: (id: string | number, data: any) =>
    http<MaritimeInlandTruckingTrip>(`/api/maritime-freight/inland-trucking-trips/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        tripStatus: data.status || data.tripStatus,
        deliveryDate: data.actualDeliveryTime || data.deliveryDate,
        notes: data.notes,
      }),
    }),

  // Carrier tracking (estimated/scheduled events only; no live carrier integration)
  syncCarrierTracking: (carrierCode: string, trackingNumber: string) =>
    http<any>(`/api/maritime-freight/carrier-tracking/sync`, {
      method: 'POST',
      body: JSON.stringify({ carrierCode, trackingNumber }),
    }),
  recordCarrierApiEvent: (data: any) =>
    http<any>(`/api/maritime-freight/carrier-tracking/events`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  listCarrierApiEvents: (trackingNumber: string) =>
    http<any[]>(`/api/maritime-freight/carrier-tracking/${trackingNumber}/events`),
};
