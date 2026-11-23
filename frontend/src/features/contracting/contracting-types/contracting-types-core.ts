export type ProjectStatus =
  | 'planning'
  | 'draft'
  | 'submitted'
  | 'negotiation'
  | 'active'
  | 'suspended'
  | 'completed'
  | 'handed_over'
  | 'lost'
  | 'cancelled';
export type ChangeOrderImpactType = 'cost_only' | 'time_only' | 'cost_and_time';
export type ChangeOrderStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';
export type IpcType = 'client' | 'subcontractor';
export type IpcStatus = 'draft' | 'under_review' | 'approved' | 'paid';
export type SubcontractStatus = 'active' | 'completed' | 'terminated';
export type RfiStatus = 'open' | 'pending_reply' | 'answered' | 'closed';

export interface ContractingProject {
  id: string;
  code: string;
  name: string;
  clientId: number | null;
  clientName: string;
  status: ProjectStatus;
  contractValue: number;
  revisedContractValue: number;
  downPaymentAmount: number;
  downPaymentRecovered: number;
  retentionPercent: number;
  retentionTotalHeld: number;
  retentionReleased: number;
  startDate: string | null;
  expectedEndDate: string | null;
  actualEndDate: string | null;
  siteLocationId: number | null;
  costCenterId: number | null;
  projectManager: string | null;
  locationAddress: string | null;
  consultantName?: string | null;
  contractRef?: string | null;
  contractDate?: string | null;
  lossReason?: string | null;
  lossNotes?: string | null;
  competitorPrice?: number | null;
  revisionNumber?: number;
  originalTenderId?: number | null;
  submittedAt?: string | null;
  awardedAt?: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;

  // KPIs
  totalBilledClient: number;
  totalBilledSubcontractors: number;
  changeOrdersTotalCost: number;
  completionRatePercent: number;
  totalCostCommitted: number;
  actualCostIncurred: number;
  grossMarginForecast: number;
}

export interface ContractingBoqItem {
  id: string;
  projectId: string;
  itemCode: string;
  description: string;
  category: string;
  unit: string;
  contractQty: number;
  revisedQty: number;
  unitPrice: number;
  totalPrice: number;
  estimatedUnitCost: number;
  estimatedCost?: number;
  executedQty: number;
  isSectionHeader?: boolean;
  notes?: string | null;
  createdAt: string;
}

export interface ContractingChangeOrder {
  id: string;
  projectId: string;
  changeOrderNumber: string;
  title: string;
  reason: string;
  impactType: ChangeOrderImpactType;
  costImpact: number;
  timeImpactDays: number;
  status: ChangeOrderStatus;
  approvedBy?: string | null;
  approvedAt?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface ContractingInvoiceItem {
  id?: string;
  boqItemId?: string | null;
  description: string;
  unit: string;
  unitPrice: number;
  previousQty: number;
  currentQty: number;
  storedMaterialsQty: number;
  cumulativeQty: number;
  completionPercent: number;
  currentTotal: number;
  cumulativeTotal: number;
  wirId?: string | null;
  claimedQty?: number;
  certifiedQty?: number;
  varianceReason?: string | null;
  progressStage?: string | null;
  stageWeightPct?: number | null;
  changeOrderId?: string | null;
  notes?: string | null;
}

export type SubcontractType = 'supply_and_apply' | 'labor_only' | 'supply_only' | 'labor_plus_consumables';
export type PaymentLinkageMode = 'independent' | 'pay_when_paid' | 'pay_when_certified';

export interface ContractingInvoice {
  id: string;
  projectId: string;
  ipcNumber: string;
  ipcType: IpcType;
  subcontractId?: string | null;
  subcontractorId?: number | null;
  subcontractorName?: string;
  sequenceOrder: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  previousAmount: number;
  currentAmount: number;
  storedMaterialsAmount: number;
  cumulativeAmount: number;
  advanceRecoveryAmount: number;
  retentionHeldAmount: number;
  otherDeductions: number;
  grossWorkDoneAmount?: number;
  escalationAmount?: number;
  mosAddedAmount?: number;
  mosReleasedAmount?: number;
  mosBalanceAmount?: number;
  backchargeAmount?: number;
  ldAmount?: number;
  materialExcessAmount?: number;
  sharedResourceAmount?: number;
  directPaymentAmount?: number;
  carriedForwardDebitIn?: number;
  taxableBaseAmount?: number;
  vatAmount?: number;
  whtAmount?: number;
  socialInsuranceAmount?: number;
  claimedAmount?: number;
  certifiedAmount?: number;
  certificationDueDate?: string | null;
  paymentDueDate?: string | null;
  calcEngineVersion?: string;
  netPayable: number;
  status: IpcStatus;
  journalEntryId?: number | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  notes?: string | null;
  createdAt: string;
  items?: ContractingInvoiceItem[];
  project?: ContractingProject;
}

export interface ContractingSubcontract {
  id: string;
  projectId: string;
  subcontractorId: number;
  subcontractorName?: string;
  contractNumber: string;
  contractType?: SubcontractType;
  scopeOfWork: string;
  totalAmount: number;
  retentionPercent: number;
  advancePct?: number;
  advanceAmount?: number;
  advanceRecoveryStartPct?: number;
  advanceRecoveryEndPct?: number;
  retentionLimitPct?: number;
  penaltyPerDay?: number;
  ldCapPct?: number;
  liabilityCapAmount?: number;
  whtRate?: number;
  socialInsurancePct?: number;
  paymentLinkageMode?: PaymentLinkageMode;
  paymentTermsDays?: number;
  tailReservePct?: number;
  wastageAllowancePct?: number;
  mosAdmissiblePct?: number;
  mosCapPct?: number;
  dlpMonths?: number;
  startDate?: string | null;
  endDate?: string | null;
  status: SubcontractStatus;
  notes?: string | null;
  createdAt: string;
  totalInvoiced?: number;
  totalRetentionHeld?: number;
  remainingCommitment?: number;
}

export interface ContractingSubcontractor {
  id: number;
  name: string;
  tradeSpecialty: string;
  phone?: string;
  mobile?: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  commercialReg?: string;
  nationalId?: string;
  bankName?: string;
  bankIban?: string;
  contactPerson?: string;
  rating: number;
  status: 'active' | 'suspended' | 'blacklisted';
  notes?: string;
  createdAt?: string;
  subcontractsCount?: number;
  totalCommitted?: number;
  totalInvoiced?: number;
  totalRetentionHeld?: number;
  totalPaid?: number;
  netBalance?: number;
}

export interface ContractingSubcontractorPayment {
  id: number;
  paymentNumber: string;
  paymentDate: string;
  amount: number;
  paymentMethod: 'cash' | 'bank_transfer' | 'check';
  referenceNumber?: string;
  notes?: string;
}

export interface SubcontractorLedgerTransaction {
  id: number;
  date: string;
  type: 'invoice' | 'payment' | 'backcharge';
  refNumber: string;
  description: string;
  projectId?: string;
  credit: number;
  debit: number;
  balanceAfter: number;
  details?: Record<string, any>;
}

export interface SubcontractorLedgerResponse {
  subcontractor: ContractingSubcontractor;
  summary: {
    totalSubcontracts: number;
    totalCommitted: number;
    totalInvoiced: number;
    totalPaid: number;
    totalBackcharges: number;
    totalRetentionHeld: number;
    netBalanceDue: number;
  };
  transactions: SubcontractorLedgerTransaction[];
}

export interface ContractingSiteDailyLog {
  id: string;
  projectId: string;
  logDate: string;
  weatherConditions?: string | null;
  laborCount: number;
  subcontractorLaborCount: number;
  equipmentOnSite?: string | null;
  workPerformed: string;
  delaysOrObstacles?: string | null;
  materialsReceived?: string | null;
  loggedBy?: string | null;
  createdAt: string;
}

export interface ContractingRfi {
  id: string;
  projectId: string;
  rfiNumber: string;
  subject: string;
  question: string;
  assignedTo?: string | null;
  status: RfiStatus;
  answer?: string | null;
  answeredBy?: string | null;
  answeredAt?: string | null;
  dateRequested: string;
  dateRequired?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface ContractingSummaryKpis {
  totalContractValue: number;
  totalBilledToDate: number;
  totalRetentionsHeld: number;
  activeProjectsCount: number;
}

