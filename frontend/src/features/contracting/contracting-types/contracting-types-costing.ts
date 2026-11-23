// =============================================================================
// Track 1: Field Indirect Cost Allocation Types (AACE RP 10S-90 / 34R-05)
// =============================================================================

export type CostPoolType = 'labor_care' | 'labor_burden' | 'equipment_shared' | 'site_supervision' | 'custom';
export type DriverType = 'labor_days' | 'labor_cost' | 'equipment_hours' | 'direct_effort' | 'manual_ratio';

export interface CostPool {
  id: string;
  projectId: string;
  poolCode: string;
  poolName: string;
  poolType: CostPoolType;
  driverType: DriverType;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface IndirectExpense {
  id: string;
  projectId: string;
  poolId: string;
  poolCode: string;
  poolName: string;
  poolType: CostPoolType;
  driverType: DriverType;
  batchId?: string | null;
  mobilizationExpenseId?: string | null;
  expenseTitle: string;
  grossAmount: number;
  recoveredAmount: number;
  netAmount: number;
  expenseDate: string;
  voucherRef?: string | null;
  createdAt: string;
}

export interface AllocationBatch {
  id: string;
  projectId: string;
  batchNumber: string;
  periodStart: string;
  periodEnd: string;
  status: 'draft' | 'posted' | 'reversed';
  totalGrossExpenses: number;
  totalRecoveredBackcharges: number;
  totalNetPoolCost: number;
  totalAllocatedAmount: number;
  deferredInAmount: number;
  deferredOutAmount: number;
  postedAt?: string | null;
  postedBy?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface ItemAllocationDetail {
  boqItemId: string;
  boqCode: string;
  driverQty: number;
  allocationRatio: number;
  allocatedAmount: number;
}

export interface PoolAllocationResult {
  poolId: string;
  poolCode: string;
  poolName: string;
  poolType: CostPoolType;
  driverType: DriverType;
  grossExpenseAmount: number;
  recoveredBackchargeAmount: number;
  deferredInAmount: number;
  netPoolCost: number;
  totalDriverQty: number;
  ratePerDriverUnit: number;
  deferredOutAmount: number;
  allocatedAmountTotal: number;
  allocations: ItemAllocationDetail[];
}

export interface BoqItemAggregatedSummary {
  boqItemId: string;
  boqCode: string;
  allocatedByPool: Record<string, number>;
  totalAllocatedIndirectCost: number;
}

export interface BatchAllocationSummary {
  totalGrossExpense: number;
  totalRecoveredBackcharge: number;
  totalDeferredIn: number;
  totalNetCost: number;
  totalAllocated: number;
  totalDeferredOut: number;
  poolSummaries: PoolAllocationResult[];
  boqItemSummaries: BoqItemAggregatedSummary[];
}

export interface CreateCostPoolPayload {
  poolCode: string;
  poolName: string;
  poolType: CostPoolType;
  driverType: DriverType;
  description?: string;
}

export interface CreateIndirectExpensePayload {
  poolId: string;
  expenseTitle: string;
  grossAmount: number;
  recoveredAmount?: number;
  expenseDate?: string;
  voucherRef?: string;
  mobilizationExpenseId?: string;
}

export interface CreateAllocationBatchPayload {
  periodStart: string;
  periodEnd: string;
  deferredInAmount?: number;
  notes?: string;
}

// Document Register (Drawing/Document Control)
export type DocumentType = 'drawing' | 'specification' | 'contract' | 'correspondence' | 'method_statement' | 'other';
export type DocumentStatus = 'draft' | 'for_review' | 'approved' | 'superseded' | 'void';
export type DocumentReviewStatus = 'for_review' | 'approved' | 'approved_as_noted' | 'revise_resubmit' | 'rejected' | 'superseded';
export type DocumentRecipientRole = 'internal' | 'consultant' | 'owner' | 'subcontractor' | 'authority' | 'other';
export type DocumentDistributionMethod = 'email' | 'whatsapp' | 'hand' | 'portal' | 'other';

export interface ContractingDocument {
  id: string;
  projectId: string;
  docNumber: string;
  title: string;
  discipline: string;
  docType: DocumentType;
  currentRevisionId: string | null;
  status: DocumentStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractingDocumentRevision {
  id: string;
  documentId: string;
  revCode: string;
  fileRef?: string | null;
  reviewStatus: DocumentReviewStatus;
  issuedDate: string;
  reviewedBy?: string | null;
  reviewDate?: string | null;
  reviewComments?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface ContractingDocumentDistribution {
  id: string;
  revisionId: string;
  recipientName: string;
  recipientRole: DocumentRecipientRole;
  distributionMethod: DocumentDistributionMethod;
  distributedAt: string;
  acknowledgedAt?: string | null;
}

export interface ContractingDocumentDetail {
  document: ContractingDocument;
  revisions: ContractingDocumentRevision[];
  distributions: ContractingDocumentDistribution[];
}

export interface CreateContractingDocumentPayload {
  title: string;
  discipline?: string;
  docType?: DocumentType;
  notes?: string;
  revCode?: string;
  fileRef?: string;
}

// Meeting Minutes
export interface MeetingAttendee {
  name: string;
  company?: string;
  role?: string;
}

export interface ContractingMeetingMinute {
  id: string;
  projectId: string;
  minuteNumber: string;
  meetingType: string;
  meetingDate: string;
  location?: string | null;
  attendees: MeetingAttendee[];
  agenda?: string | null;
  summary?: string | null;
  preparedBy?: string | null;
  status: 'draft' | 'issued';
  createdAt: string;
  updatedAt: string;
}

export interface ContractingMeetingActionItem {
  id: string;
  minuteId: string;
  description: string;
  ownerName?: string | null;
  dueDate?: string | null;
  status: 'open' | 'closed';
  linkedRfiId?: string | null;
  linkedChangeOrderId?: string | null;
  closedAt?: string | null;
  notes?: string | null;
}

export interface ContractingMeetingMinuteDetail {
  minute: ContractingMeetingMinute;
  actionItems: ContractingMeetingActionItem[];
}

export interface CreateMeetingMinutePayload {
  meetingType?: string;
  meetingDate?: string;
  location?: string;
  attendees?: MeetingAttendee[];
  agenda?: string;
  summary?: string;
  preparedBy?: string;
}

export interface CreateMeetingActionItemPayload {
  description: string;
  ownerName?: string;
  dueDate?: string;
  linkedRfiId?: string;
  linkedChangeOrderId?: string;
  notes?: string;
}
