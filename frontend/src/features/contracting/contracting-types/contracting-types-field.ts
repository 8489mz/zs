import type { ContractingPettyCashRecord } from './contracting-types-planning';

export type ContractingPettyCash = ContractingPettyCashRecord;

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
    schedulePerformanceIndex: number;
    costPerformanceIndex: number;
    budgetVariancePercent: number;
    licensesComplianceScore: number;
    retentionRiskScore: number;
  };
  recommendations: string[];
}

export interface CashForecastBucket {
  period: '30_days' | '60_days' | '90_days';
  label: string;
  expectedInflows: number;
  expectedOutflows: number;
  netCashFlow: number;
}

export interface ContractingCashForecast {
  projectId?: string;
  totalCurrentCashPosition: number;
  forecastBasis?: 'due_date' | 'percentage_estimate';
  buckets: CashForecastBucket[];
  undated?: CashForecastBucket & { period: 'undated' };
  upcomingCommitmentsSummary: {
    pendingSubcontractorIpcs: number;
    // null = not yet linked to this forecast (supplier payables/payroll are not
    // scoped to a contracting project today) — distinct from a real zero balance.
    pendingSupplierInvoices: number | null;
    upcomingWages: number | null;
    upcomingLicenseRenewals: number;
  };
  totalExpectedInflow?: number;
  totalExpectedOutflow?: number;
}

export interface ProjectMaterialRequirementItem {
  code: string;
  name: string;
  unit: string;
  type: string;
  requiredQuantity: number;
  dispatchedQuantity: number;
  remainingQuantity: number;
  fulfillmentPercent: number;
  unitRate: number;
  totalEstimatedCost: number;
}

export interface ProjectMaterialRequirementsSummary {
  projectId: string;
  totalDistinctMaterialsCount: number;
  totalMaterialsCost: number;
  items: ProjectMaterialRequirementItem[];
}

export interface BoqProfitabilityItem {
  id: string;
  itemCode: string;
  description: string;
  category: string;
  unit: string;
  contractQty: number;
  executedQty: number;
  unitPrice: number;
  estimatedUnitCost: number;
  contractRevenue: number;
  estimatedCost: number;
  actualCost: number;
  directLaborCost?: number;
  directMaterialCost?: number;
  directEquipmentCost?: number;
  allocatedIndirectCost?: number;
  projectedProfit: number;
  profitMarginPercent: number;
  realizedProfit: number;
  status: 'profitable' | 'at_risk' | 'loss';
}

export interface BoqProfitabilitySummary {
  projectId: string;
  totalProjectRevenue: number;
  totalProjectEstimatedCost: number;
  totalProjectActualCost: number;
  totalProjectProfit: number;
  overallMarginPercent: number;
  lossMakingItemsCount: number;
  itemsCount: number;
  items: BoqProfitabilityItem[];
}

export interface MasterBoqTrade {
  tradeCategory: string;
  tradeNameAr: string;
  itemsCount: number;
}

export interface MasterBoqItem {
  id: string;
  tradeCategory: string;
  tradeNameAr: string;
  itemCode: string;
  name: string;
  description: string;
  unit: string;
  standardCost: number;
  standardPrice: number;
  isActive: boolean;
  isCustom?: boolean;
  tenantId?: string;
  createdAt: string;
}

// 1. BOQ CAD Takeoff Sheet
export interface ContractingBoqTakeoff {
  id?: string;
  projectId?: string;
  boqItemId?: string;
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
  createdAt?: string;
  updatedAt?: string;
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

export interface ContractingMobilizationSummary {
  projectId: string;
  totalAmount: number;
  itemsCount: number;
  expenses: ContractingSiteMobilizationExpense[];
}

// 3. Labor Attendance, Overtime & Bonus/Deductions
export interface ContractingLaborAttendanceRecord {
  id: string;
  projectId: string;
  boqItemId?: string | null;
  boqItemCode?: string | null;
  boqDescription?: string | null;
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
export interface ContractingItemProfitabilityItem {
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

export interface ContractingItemProfitabilitySummary {
  projectId: string;
  totalRevenue: number;
  totalActualCost: number;
  totalProfit: number;
  overallMarginPercent: number;
  items: ContractingItemProfitabilityItem[];
}

// 8. Comprehensive 5-Stream Cost Breakdown
export interface ContractingCostStream {
  key: string;
  name: string;
  amount: number;
  count: number;
  percentOfTotal: number;
}

