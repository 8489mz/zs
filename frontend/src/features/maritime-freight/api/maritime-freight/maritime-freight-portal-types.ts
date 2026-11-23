export interface MaritimeCustomsDeclaration {
  id: string;
  jobId: string;
  declarationNumber: string | null;
  declarationType: 'import' | 'export';
  customsAuthority: string | null;
  brokerName: string | null;
  submittedDate: string | null;
  clearedDate: string | null;
  status: 'pending' | 'submitted' | 'cleared' | 'held' | 'rejected';
  totalCustomsValue: number;
  totalDutyAmount: number;
  currency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaritimeCustomsDeclarationItem {
  id: string;
  declarationId: string;
  hsCode: string;
  commodityDescription: string;
  quantity: number;
  unit: string;
  customsValue: number;
  dutyRatePercent: number;
  dutyAmount: number;
  notes: string | null;
}

export interface MaritimeRateCard {
  id: string;
  shippingLineId: string | null;
  carrierName: string;
  polCode: string;
  polName: string;
  podCode: string;
  podName: string;
  cargoMode: string;
  containerType: string;
  oceanFreight: number;
  currency: string;
  thcOrigin: number;
  thcDestination: number;
  bafCharges: number;
  otherCharges: number;
  totalFreightCost: number;
  transitTimeDays: number;
  freeDays: number;
  validFrom: string;
  validUntil: string;
  source: 'manual' | 'carrier_bid';
  sourceBidId: string | null;
  status: 'active' | 'expired' | 'draft';
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaritimeCarrierInvoice {
  id: string;
  jobId: string;
  jobNumber?: string;
  customerName?: string;
  polName?: string;
  podName?: string;
  shippingLineId: string | null;
  carrierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  totalInvoicedAmount: number;
  oceanFreight: number;
  thcCharges: number;
  bafCharges: number;
  detentionDemurrage: number;
  otherCharges: number;
  rateCardId: string | null;
  contractedAmount: number;
  varianceAmount: number;
  variancePct: number;
  auditStatus: 'pending' | 'matched' | 'overcharge' | 'undercharge' | 'no_contract' | 'approved_override' | 'disputed';
  overrideApprovedBy: string | null;
  overrideApprovedAt: string | null;
  overrideReason: string | null;
  journalEntryId: string | null;
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid' | 'held_for_dispute';
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  dispute?: {
    id: string;
    disputeNumber: string;
    disputeStatus: 'draft' | 'submitted' | 'accepted' | 'rejected' | 'partially_accepted';
    disputedAmount: number;
    creditNoteNumber: string | null;
    creditNoteAmount: number;
  } | null;
  rateCard?: {
    carrierName: string;
    unitCost: number;
  } | null;
}

export interface FreightAuditPreview {
  jobId: string;
  jobNumber: string;
  shippingLineName: string;
  polCode: string;
  podCode: string;
  containerCount: number;
  containerType: string;
  rateCard: any | null;
  audit: {
    hasRateCard: boolean;
    rateCardId: string | number | null;
    contractedRatePerUnit: number;
    containerCount: number;
    contractedTotal: number;
    invoicedTotal: number;
    varianceAmount: number;
    variancePct: number;
    auditStatus: 'matched' | 'overcharge' | 'undercharge' | 'no_contract' | 'approved_override' | 'disputed';
    isOvercharged: boolean;
    isUndercharged: boolean;
    isMatched: boolean;
    varianceBreakdown: {
      oceanFreightDiff: number;
      thcDiff: number;
      bafDiff: number;
      otherDiff: number;
    };
    recommendation: 'auto_approvable' | 'requires_override_or_dispute' | 'manual_review_no_contract';
  };
}

export interface FreightPortalCustomer {
  id: number;
  name: string;
  companyName?: string;
  phone: string;
  address?: string;
  balance: number;
  creditLimit: number;
  tenantId: string;
  tenantName: string;
  portalToken?: string;
}

export interface FreightPortalSession {
  token: string;
  customer: FreightPortalCustomer;
}

export interface FreightPortalDashboard {
  kpis: {
    activeShipmentsCount: number;
    deliveredShipmentsCount: number;
    pendingQuotesCount: number;
    approvedQuotesCount: number;
    outstandingBalance: number;
    creditLimit: number;
    availableCredit: number;
  };
  customer: {
    id: number;
    name: string;
    companyName?: string;
  };
  recentShipments: any[];
  recentQuotes: any[];
}
