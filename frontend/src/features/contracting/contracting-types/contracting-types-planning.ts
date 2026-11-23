import type { ContractingBoqItem } from './contracting-types-core';

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
  plannedManpowerCount?: number;
  plannedEquipmentCount?: number;
  resourceTrade?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceLoadingWeek {
  weekStart: string;
  weekEnd: string;
  totalManpower: number;
  totalEquipment: number;
  taskCount: number;
}

export interface ResourceLoadingTradeBreakdown {
  trade: string;
  manpower: number;
  equipment: number;
}

export interface ResourceLoadingHistogram {
  projectId: string;
  weeks: ResourceLoadingWeek[];
  tradeBreakdown: ResourceLoadingTradeBreakdown[];
  peakManpowerWeek: ResourceLoadingWeek | null;
  peakEquipmentWeek: ResourceLoadingWeek | null;
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
  updatedAt?: string;
}

// ============================================================================
// Enterprise Contracting Types
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

export interface AutoPriceBoqResult {
  constantCode: string;
  constantName: string;
  unit: string;
  quantity: number;
  unitDirectCost: number;
  suggestedUnitPrice: number;
  totalEstimatedCost: number;
  totalPrice: number;
  projectedProfit: number;
  breakdown: {
    name: string;
    code: string;
    qtyPerUnit: number;
    unit: string;
    unitRate: number;
    componentCost: number;
  }[];
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
  boqSnapshot: ContractingBoqItem[];
  createdAt: string;
}

export type RetentionStatus = 'held' | 'partially_released' | 'fully_released' | 'released' | 'active';

export interface ContractingRetentionRecord {
  id: string;
  projectId: string;
  subcontractId?: string | null;
  partyType?: 'client' | 'subcontractor';
  entityType?: string;
  partyId?: number | null;
  partyName?: string;
  entityName?: string;
  heldAmount?: number;
  retentionAmount?: number;
  amount?: number;
  releasedAmount?: number;
  releaseAmount?: number;
  retentionPercent?: number;
  ipcInvoiceId?: string | null;
  releaseDueDate?: string | null;
  status: RetentionStatus;
  guaranteeCertificateRef?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface ContractingPaymentHold {
  id: string;
  projectId: string;
  subcontractId?: string | null;
  partyType?: 'subcontractor' | 'supplier' | 'boq_item';
  targetType?: string;
  partyName?: string;
  targetName?: string;
  holdAmount?: number;
  amount?: number;
  reason?: string;
  holdReason?: string;
  defectDescription?: string | null;
  isReleased?: boolean;
  status?: 'active' | 'released';
  holdDate?: string;
  releasedAt?: string | null;
  releaseDate?: string | null;
  releasedBy?: string | null;
  releaseNotes?: string | null;
  notes?: string | null;
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
  returnNumber?: string;
  supplierId?: number | null;
  supplierName?: string;
  materialName?: string;
  itemName?: string;
  quantity?: number;
  unit?: string;
  unitCost?: number;
  reason?: string;
  returnDate?: string;
  totalAmount?: number;
  status?: 'draft' | 'posted';
  creditNoteNumber?: string | null;
  items?: ContractingSupplierReturnItem[];
  notes?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export type LaborTrade = 'carpenter' | 'blacksmith' | 'mason' | 'helper' | 'operator' | 'surveyor' | 'electrician' | 'plumber' | string;

export interface ContractingLaborAttendance {
  id: string;
  projectId: string;
  workerName: string;
  trade: LaborTrade;
  workDate: string;
  shiftType?: string;
  hoursWorked?: number;
  regularHours?: number;
  overtimeHours?: number;
  dailyRate?: number;
  dailyWage?: number;
  allocatedProjectSharePercent?: number;
  calculatedCost?: number;
  taskDescription?: string;
  boqItemCode?: string;
  splitProjectId?: string | null;
  splitHours?: number;
  totalWage?: number;
  status?: 'recorded' | 'approved' | 'paid' | string;
  notes?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export type PettyCashStatus = 'active' | 'settled' | 'overdue' | 'closed';

export interface PettyCashReceipt {
  receiptNumber: string;
  expenseCategory: string;
  amount: number;
  description: string;
  vendorName?: string;
  receiptDate: string;
}

export interface ContractingPettyCashRecord {
  id: string;
  projectId: string;
  custodianName: string;
  custodianRole?: string;
  disbursementNumber?: string;
  amount: number;
  amountGiven?: number;
  spentAmount?: number;
  amountSettled?: number;
  remainingBalance?: number;
  remainingAmount?: number;
  issueDate: string;
  settledDate?: string;
  settlementDate?: string;
  settlementDueDate?: string | null;
  status: PettyCashStatus;
  receipts?: PettyCashReceipt[];
  receiptNumbers?: string;
  closureNotes?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt?: string;
}
