import type { ContractingCostStream } from './contracting-types-field';

export interface ContractingProjectCostBreakdown {
  projectId: string;
  contractValue: number;
  costBaseline: number;
  totalActualCost: number;
  varianceVsBaseline: number;
  profitMarginPercent: number;
  streams: ContractingCostStream[];
}

// 9. Work Inspection Requests (WIR)
export type InspectionStatus = 'submitted' | 'approved' | 'approved_with_notes' | 'rejected';

export interface ContractingInspectionRequest {
  id: string;
  projectId: string;
  requestNumber: string;
  title: string;
  discipline: string;
  locationDetails: string;
  inspectionDate: string;
  status: InspectionStatus;
  consultantName?: string | null;
  consultantDecisionDate?: string | null;
  consultantNotes?: string | null;
  boqItemId?: string | null;
  boqItemDescription?: string | null;
  subcontractId?: string | null;
  subcontractorName?: string | null;
  attachments?: string | null;
  requestedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 10. Punch List / Snag Items
export type SnagSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SnagStatus = 'open' | 'in_progress' | 'rectified' | 'verified_closed';

export interface ContractingSnagItem {
  id: string;
  projectId: string;
  itemNumber: string;
  description: string;
  location: string;
  severity: SnagSeverity;
  status: SnagStatus;
  identifiedBy: string;
  assignedTo?: string | null;
  targetDate?: string | null;
  closedDate?: string | null;
  rectificationNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 11. Project Handovers (Preliminary & Final)
export type HandoverType = 'preliminary' | 'final';
export type HandoverStatus = 'draft' | 'under_review' | 'approved' | 'rejected';

export interface ContractingProjectHandover {
  id: string;
  projectId: string;
  handoverType: HandoverType;
  handoverNumber: string;
  handoverDate: string;
  consultantRepresentative?: string | null;
  clientRepresentative?: string | null;
  contractorRepresentative?: string | null;
  committeeReport?: string | null;
  outstandingSnagCount: number;
  warrantyStartDate?: string | null;
  warrantyEndDate?: string | null;
  retentionReleasePercent: number;
  retentionReleaseAmount: number;
  status: HandoverStatus;
  approvedBy?: string | null;
  approvedAt?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 12. Material & Shop Drawing Submittals (MAR / MAS)
export type SubmittalType = 'material' | 'shop_drawing' | 'sample' | 'method_statement';
export type SubmittalStatus = 'submitted' | 'approved' | 'approved_as_noted' | 'revise_and_resubmit' | 'rejected';

export interface ContractingSubmittal {
  id: string;
  projectId: string;
  submittalNumber: string;
  submittalType: SubmittalType;
  title: string;
  specificationSection?: string | null;
  supplierManufacturer?: string | null;
  boqItemId?: string | null;
  boqItemCode?: string | null;
  subcontractId?: string | null;
  subcontractorName?: string | null;
  submissionDate: string;
  reviewDueDate?: string | null;
  consultantReviewDate?: string | null;
  status: SubmittalStatus;
  consultantName?: string | null;
  consultantComments?: string | null;
  attachments?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 13. Material Price Escalation Claims
export type MaterialEscalationType = 'rebar_steel' | 'portland_cement' | 'ready_mix' | 'bitumen' | 'sand_gravel' | 'other';
export type MaterialEscalationStatus = 'draft' | 'submitted_to_client' | 'approved_by_consultant' | 'settled_in_ipc' | 'rejected';

export interface ContractingMaterialEscalation {
  id: string;
  projectId: string;
  claimNumber: string;
  materialType: MaterialEscalationType;
  materialName: string;
  basePriceContract: number;
  currentMarketPrice: number;
  priceDifference: number;
  executedQuantity: number;
  unit: string;
  totalCompensationAmount: number;
  bulletinSourceReference?: string | null;
  status: MaterialEscalationStatus;
  ipcInvoiceId?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 14. Subcontractor Back-Charges & Penalties
export type BackchargeCategory = 'damage_rework' | 'safety_fine' | 'equipment_usage' | 'material_supplied' | 'site_cleanup' | 'other';
export type BackchargeStatus = 'pending_approval' | 'applied_to_deduction' | 'waived';

export interface ContractingSubcontractorBackcharge {
  id: string;
  projectId: string;
  voucherNumber: string;
  subcontractId: string;
  subcontractorName?: string | null;
  beneficiarySubcontractId?: string | null;
  beneficiarySubcontractorName?: string | null;
  backchargeCategory: BackchargeCategory;
  amount: number;
  description: string;
  occurrenceDate: string;
  status: BackchargeStatus;
  appliedIpcInvoiceId?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 15. Equipment Fuel & Operating Meter Logs
export interface ContractingEquipmentFuelLog {
  id: string;
  projectId: string;
  equipmentId?: string | null;
  equipmentName: string;
  logDate: string;
  startMeterHours: number;
  endMeterHours: number;
  operatingHours: number;
  fuelLitersAdded: number;
  fuelCostTotal: number;
  driverOperatorName?: string | null;
  boqItemId?: string | null;
  boqItemCode?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 16. Earned Value Management (EVM) & S-Curve Metrics
export interface ContractingProjectEvmMetrics {
  projectId: string;
  projectCode: string;
  projectName: string;
  plannedValue: number;
  earnedValue: number;
  actualCost: number;
  budgetAtCompletion: number;
  costVariance: number;
  scheduleVariance: number;
  cpi: number;
  spi: number;
  estimateAtCompletion: number;
  varianceAtCompletion: number;
  toCompletePerformanceIndex: number;
  healthIndicator: 'excellent' | 'good' | 'at_risk' | 'critical';
  sCurvePoints: {
    periodName: string;
    plannedCumulative: number;
    earnedCumulative: number;
    actualCumulative: number;
  }[];
}

// 17. Bank Guarantees & Gateway G1 (خطابات الضمان البنكية والبوابة الرقابية)
export type GuaranteeType =
  | 'advance_payment'
  | 'performance'
  | 'retention'
  | 'maintenance'
  | 'bid_bond';

export type GuaranteeStatus =
  | 'active'
  | 'expired'
  | 'released'
  | 'confiscated_invoked'
  | 'cancelled';

export interface ContractingGuarantee {
  id: string;
  projectId: string;
  projectName?: string | null;
  projectCode?: string | null;
  subcontractId?: string | null;
  subcontractNumber?: string | null;
  subcontractTitle?: string | null;
  subcontractorId?: number | null;
  subcontractorName?: string | null;
  guaranteeNumber: string;
  guaranteeType: GuaranteeType;
  issuingBank: string;
  amount: number;
  currency: string;
  issueDate: string;
  expiryDate: string;
  claimExpiryDate?: string | null;
  reductionSchedule?: any;
  status: GuaranteeStatus;
  documentUrl?: string | null;
  notes?: string | null;
  daysRemaining?: number;
  alertTier?: 'critical_t7' | 'warning_t30' | 'info_t60' | 'expired' | 'healthy';
  createdAt?: string;
  updatedAt?: string;
}

export interface GuaranteeExpiryAlert {
  guaranteeId: string;
  guaranteeNumber: string;
  guaranteeType: GuaranteeType;
  issuingBank: string;
  amount: number;
  expiryDate: string;
  daysRemaining: number;
  alertTier: 'critical_t7' | 'warning_t30' | 'info_t60' | 'expired';
  alertMessageAr: string;
}

