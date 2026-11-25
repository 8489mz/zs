export type ProjectStatus = 'planning' | 'active' | 'suspended' | 'completed' | 'handed_over';
export type ChangeOrderImpactType = 'cost_only' | 'time_only' | 'cost_and_time';
export type ChangeOrderStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';
export type IpcType = 'client' | 'subcontractor';
export type IpcStatus = 'draft' | 'under_review' | 'approved' | 'paid';
export type SubcontractStatus = 'active' | 'completed' | 'terminated';
export type RfiStatus = 'open' | 'pending_reply' | 'answered' | 'closed';

export interface ContractingProjectSummary {
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
  costCenterCode?: string | null;
  projectManager: string | null;
  locationAddress: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;

  // Real-time calculated KPIs:
  totalBilledClient: number; // Total approved IPCs
  totalBilledSubcontractors: number;
  changeOrdersTotalCost: number; // Net value of approved change orders
  completionRatePercent: number; // (executed work / revised contract value)
  totalCostCommitted: number; // Subcontracts + site purchase orders
  actualCostIncurred: number; // Direct costs booked against project cost center
  grossMarginForecast: number; // Revised Contract Value - (Committed + Incurred)

  // Enterprise Intelligence & Health:
  healthScore?: number; // 0 - 100
  healthStatus?: 'green' | 'yellow' | 'red';
  activeLicensesCount?: number;
  expiringLicensesCount?: number;
  activeHoldsTotal?: number;
}

export type ScheduleTaskStatus = 'not_started' | 'in_progress' | 'completed' | 'delayed';
export type MaterialRequisitionStatus = 'issued' | 'draft' | 'approved';

export interface ContractingScheduleTask {
  id: string;
  projectId: string;
  taskCode: string;
  taskName: string;
  wbsCode: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  progressPercent: number;
  predecessorId?: string | null;
  isCriticalPath: boolean;
  status: ScheduleTaskStatus;
  boqItemId?: string | null;
  assignedTeam?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractingMaterialRequisition {
  id: string;
  projectId: string;
  requisitionNumber: string;
  boqItemId?: string | null;
  warehouseId?: number | null;
  productId?: number | null;
  itemName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  issueDate: string;
  recipientName?: string | null;
  status: MaterialRequisitionStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Enterprise Contracting Enhancements Types
// ============================================================================

export type PriceItemType = 'material' | 'labor' | 'equipment' | 'subcontract';

export interface ContractingMasterPriceItem {
  id: string;
  itemType: PriceItemType;
  code: string;
  name: string;
  unit: string;
  unitRate: number;
  category: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EngineeringConstantComponent {
  componentCode: string;
  componentName: string;
  componentType: PriceItemType;
  qtyPerUnit: number;
  unit: string;
  unitRate?: number;
  totalCost?: number;
}

export interface ContractingEngineeringConstant {
  id: string;
  itemCode: string;
  itemName: string;
  unit: string;
  wastePercent: number;
  overheadPercent: number;
  profitMarkupPercent: number;
  components: EngineeringConstantComponent[];
  calculatedDirectCost?: number;
  calculatedSellingPrice?: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractingCostSnapshot {
  id: string;
  projectId: string;
  snapshotName: string;
  totalBudgetCost: number;
  totalContractValue: number;
  isLocked: boolean;
  lockedAt: string;
  lockedBy?: string | null;
  boqSnapshot: any[];
  createdAt: string;
}

export type RetentionStatus = 'held' | 'partially_released' | 'fully_released';

export interface ContractingRetentionRecord {
  id: string;
  projectId: string;
  subcontractId?: string | null;
  partyType: 'client' | 'subcontractor';
  partyId?: number | null;
  partyName: string;
  heldAmount: number;
  releasedAmount: number;
  retentionPercent: number;
  ipcInvoiceId?: string | null;
  releaseDueDate?: string | null;
  status: RetentionStatus;
  guaranteeCertificateRef?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractingPaymentHold {
  id: string;
  projectId: string;
  subcontractId?: string | null;
  partyType: 'subcontractor' | 'supplier';
  partyName: string;
  holdAmount: number;
  reason: string;
  defectDescription?: string | null;
  isReleased: boolean;
  releasedAt?: string | null;
  releasedBy?: string | null;
  releaseNotes?: string | null;
  createdAt: string;
}

export interface ContractingSupplierReturnItem {
  productId?: number | null;
  itemName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalAmount: number;
  reason: string;
}

export interface ContractingSupplierReturn {
  id: string;
  projectId: string;
  returnNumber: string;
  supplierId?: number | null;
  supplierName: string;
  returnDate: string;
  totalAmount: number;
  status: 'draft' | 'posted';
  creditNoteNumber?: string | null;
  items: ContractingSupplierReturnItem[];
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LaborTrade =
  'carpenter' | 'blacksmith' | 'mason' | 'helper' | 'operator' | 'surveyor' | 'electrician' | 'plumber';

export interface ContractingLaborAttendance {
  id: string;
  projectId: string;
  workerName: string;
  trade: LaborTrade;
  workDate: string;
  shiftType: string;
  hoursWorked: number;
  splitProjectId?: string | null;
  splitHours: number;
  dailyRate: number;
  totalWage: number;
  status: 'recorded' | 'approved' | 'paid';
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PettyCashStatus = 'active' | 'settled' | 'overdue';

export interface PettyCashReceipt {
  receiptNumber: string;
  expenseCategory: string;
  amount: number;
  description: string;
  vendorName?: string;
  receiptDate: string;
}

export interface ContractingPettyCash {
  id: string;
  projectId: string;
  custodianName: string;
  custodianRole: string;
  disbursementNumber: string;
  amountGiven: number;
  amountSettled: number;
  remainingBalance: number;
  issueDate: string;
  settlementDueDate?: string | null;
  status: PettyCashStatus;
  receipts: PettyCashReceipt[];
  closureNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LicenseType = 'excavation' | 'building' | 'civil_defense' | 'road_occupancy' | 'environmental' | 'other';
export type LicenseStatus = 'active' | 'expiring_soon' | 'expired' | 'renewed';

export interface ContractingGovernmentLicense {
  id: string;
  projectId: string;
  licenseType: LicenseType;
  licenseNumber: string;
  issuingAuthority: string;
  issueDate?: string | null;
  expiryDate: string;
  feeAmount: number;
  status: LicenseStatus;
  documentUrl?: string | null;
  alertLeadDays: number;
  daysUntilExpiry?: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectHealthScore {
  projectId: string;
  projectCode: string;
  projectName: string;
  score: number; // 0 - 100
  status: 'green' | 'yellow' | 'red';
  breakdown: {
    schedulePerformanceIndex: number; // SPI
    costPerformanceIndex: number; // CPI
    budgetVariancePercent: number;
    licensesComplianceScore: number;
    retentionRiskScore: number;
  };
  recommendations: string[];
}

export interface CashForecastBucket {
  period: '30_days' | '60_days' | '90_days';
  label: string;
  expectedInflows: number; // Expected client IPC collections
  expectedOutflows: number; // Subcontractor payments, supplier cheques, payroll, licenses
  netCashFlow: number;
}

export interface ContractingCashForecast {
  projectId?: string;
  totalCurrentCashPosition: number;
  buckets: CashForecastBucket[];
  upcomingCommitmentsSummary: {
    pendingSubcontractorIpcs: number;
    pendingSupplierInvoices: number;
    upcomingWages: number;
    upcomingLicenseRenewals: number;
  };
}

// 1. BOQ CAD Takeoff Sheet
export interface ContractingBoqTakeoff {
  id: string;
  projectId: string;
  boqItemId: string;
  drawingRef: string;
  axisRef: string;
  description: string;
  length: number;
  width: number;
  height: number;
  countMultiplier: number;
  voidDeduction: number;
  netQty: number;
  wastePercent: number;
  totalWithWaste: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 2. Site Mobilization & Worker Housing Expenses
export type MobilizationExpenseCategory =
  | 'worker_housing'
  | 'site_preparation'
  | 'temporary_utilities'
  | 'site_cabins'
  | 'permits_legal'
  | 'transport_logistics'
  | 'other';

export interface ContractingSiteMobilizationExpense {
  id: string;
  projectId: string;
  expenseCategory: MobilizationExpenseCategory;
  title: string;
  amount: number;
  expenseDate: string;
  paidTo: string;
  paymentMethod: string;
  referenceReceipt?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 3. Labor Attendance, Overtime & Bonus/Deductions
export interface ContractingLaborAttendanceRecord {
  id: string;
  projectId: string;
  boqItemId?: string | null;
  boqItemCode?: string | null;
  workerName: string;
  workerRole: 'supervisor' | 'master_craftsman' | 'technician' | 'helper' | 'laborer';
  attendanceDate: string;
  status: 'present' | 'absent' | 'half_day' | 'late';
  dailyBaseWage: number;
  overtimeHours: number;
  overtimeRatePerHour: number;
  nightShiftAllowance: number;
  bonusAmount: number;
  deductionAmount: number;
  totalPayable: number;
  isPaid: boolean;
  paymentBatchRef?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 4. Client Payment Milestones & In-Kind Barter Settlements
export interface ContractingClientPaymentMilestone {
  id: string;
  projectId: string;
  milestoneName: string;
  dueDate?: string | null;
  requiredProgressPercent: number;
  scheduledAmount: number;
  receivedAmount: number;
  settlementType: 'cash' | 'bank' | 'in_kind_unit' | 'mixed';
  inKindUnitRef?: string | null;
  inKindValuation: number;
  status: 'pending' | 'partially_paid' | 'fully_paid' | 'in_kind_settled';
  settledAt?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 5. Equipment & Tools Asset Tracking
export interface ContractingEquipmentAsset {
  id: string;
  assetCode: string;
  name: string;
  category: 'heavy_machinery' | 'power_tools' | 'safety_gear' | 'scaffolding' | 'measurement_survey' | 'generators';
  serialNumber?: string | null;
  currentProjectId?: string | null;
  currentProjectName?: string | null;
  currentLocationDesc: string;
  assignedSupervisor?: string | null;
  operationalStatus: 'active_working' | 'under_maintenance' | 'idle_in_store' | 'retired';
  purchaseCost: number;
  purchaseDate?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractingEquipmentTransfer {
  id: string;
  equipmentId: string;
  equipmentCode?: string;
  equipmentName?: string;
  fromProjectId?: string | null;
  fromProjectName?: string | null;
  toProjectId?: string | null;
  toProjectName?: string | null;
  transferDate: string;
  dispatchedBy: string;
  receivedBy: string;
  conditionOnDispatch: string;
  conditionOnReceipt: string;
  notes?: string | null;
  createdAt: string;
}

// 6. Supplier Price Memory & Rating
export interface ContractingSupplierPriceMemory {
  id: string;
  supplierId: number;
  supplierName: string;
  materialName: string;
  unit: string;
  lastUnitPrice: number;
  lastPurchaseDate: string;
  lastProjectId?: string | null;
  lastProjectName?: string | null;
  governorate: string;
  paymentTerms: 'cash' | 'credit_30' | 'credit_60' | 'installments';
  qualityRating: number;
  deliverySpeedRating: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 7. Item Profitability Ledger
export interface ContractingItemProfitability {
  boqItemId: string;
  itemCode: string;
  description: string;
  unit: string;
  contractQty: number;
  revisedQty: number;
  unitPrice: number;
  totalContractRevenue: number;
  materialsCost: number;
  laborCost: number;
  subcontractsCost: number;
  allocatedMobilizationCost: number;
  totalActualCost: number;
  grossProfit: number;
  profitMarginPercent: number;
  isProfitable: boolean;
}

// 8. Work Inspection Requests (WIR)
export interface ContractingInspectionRequest {
  id: string;
  projectId: string;
  wirNumber: string;
  boqItemId?: string | null;
  boqItemCode?: string | null;
  boqItemDescription?: string | null;
  subcontractId?: string | null;
  subcontractNumber?: string | null;
  locationGrid: string;
  tradeCategory: string;
  inspectionType: string;
  scheduledDate: string;
  status: 'submitted' | 'approved' | 'approved_with_notes' | 'rejected';
  consultantName?: string | null;
  consultantNotes?: string | null;
  inspectedAt?: string | null;
  attachments?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 9. Snag Items & Punch List
export interface ContractingSnagItem {
  id: string;
  projectId: string;
  boqItemId?: string | null;
  boqItemCode?: string | null;
  itemTitle: string;
  locationDesc: string;
  severity: 'minor' | 'major' | 'critical';
  responsibleParty: 'internal' | 'subcontractor';
  subcontractorId?: number | null;
  subcontractorName?: string | null;
  subcontractId?: string | null;
  assignedTo?: string | null;
  dueDate?: string | null;
  status: 'open' | 'rectified' | 'verified_closed';
  rectifiedDate?: string | null;
  verifiedBy?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 10. Project Handovers & Guarantee Releases
export interface ContractingProjectHandover {
  id: string;
  projectId: string;
  handoverType: 'preliminary' | 'final';
  handoverDate: string;
  committeeMembers: string;
  warrantyStartDate?: string | null;
  warrantyEndDate?: string | null;
  retentionReleaseAmount: number;
  status: 'draft' | 'approved';
  certificateRef?: string | null;
  notes?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// 11. Comprehensive Actual Cost Breakdown
export interface ContractingProjectCostBreakdown {
  projectId: string;
  projectCode: string;
  projectName: string;
  contractValue: number;
  revisedContractValue: number;
  costBaseline: number;
  totalBilledClient: number;
  materialsCost: number;
  laborCost: number;
  subcontractsCost: number;
  mobilizationCost: number;
  pettyCashCost: number;
  totalActualCost: number;
  costVariance: number;
  actualGrossProfit: number;
  actualProfitMarginPercent: number;
  costDistribution: {
    materialsPercent: number;
    laborPercent: number;
    subcontractsPercent: number;
    mobilizationPercent: number;
    pettyCashPercent: number;
  };
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

// 13. Material Price Escalation & Fluctuation Claims
export type MaterialEscalationType =
  'rebar_steel' | 'portland_cement' | 'ready_mix' | 'bitumen' | 'sand_gravel' | 'other';
export type MaterialEscalationStatus =
  'draft' | 'submitted_to_client' | 'approved_by_consultant' | 'settled_in_ipc' | 'rejected';

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
export type BackchargeCategory =
  'damage_rework' | 'safety_fine' | 'equipment_usage' | 'material_supplied' | 'site_cleanup' | 'other';
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
  plannedValue: number; // PV
  earnedValue: number; // EV
  actualCost: number; // AC
  budgetAtCompletion: number; // BAC
  costVariance: number; // CV = EV - AC
  scheduleVariance: number; // SV = EV - PV
  cpi: number; // Cost Performance Index = EV / AC
  spi: number; // Schedule Performance Index = EV / PV
  estimateAtCompletion: number; // EAC = BAC / CPI
  varianceAtCompletion: number; // VAC = BAC - EAC
  toCompletePerformanceIndex: number; // TCPI = (BAC - EV) / (BAC - AC)
  healthIndicator: 'excellent' | 'good' | 'at_risk' | 'critical';
  sCurvePoints: {
    periodName: string;
    plannedCumulative: number;
    earnedCumulative: number;
    actualCumulative: number;
  }[];
}
