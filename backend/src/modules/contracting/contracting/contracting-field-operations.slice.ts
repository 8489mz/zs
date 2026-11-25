import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import {
  CreateSiteMobilizationExpenseDto,
  RecordLaborAttendanceRecordDto,
  CreateClientPaymentMilestoneDto,
  RecordInKindBarterDeductionDto,
  CreateEquipmentAssetDto,
  TransferEquipmentAssetDto,
  RecordSupplierPriceMemoryDto,
} from '../dto/contracting.dto';
import { ContractingProjectSummary } from '../contracting.types';
import { ContractingFieldOperationsService } from '../services/contracting-field-operations.service';

export interface ContractingFieldOperationsSliceBoundDeps {
  // getProjectById lives in the projects slice (ContractingProjectsSlice);
  // called by the field-ops sub-service wherever it needs a project summary.
  getProjectById: (auth: AuthContext, id: string) => Promise<ContractingProjectSummary>;
}

export class ContractingFieldOperationsSlice {
  private readonly fieldOperationsService: ContractingFieldOperationsService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: ContractingFieldOperationsSliceBoundDeps,
  ) {
    this.fieldOperationsService = new ContractingFieldOperationsService({
      db: this.db,
      getProjectById: this.bound.getProjectById,
    });
  }

  // ==========================================================================
  // 26. Site Mobilization & Worker Housing Expenses (تجهيز الموقع والمصاريف التأسيسية)
  // ==========================================================================

  async getMobilizationExpenses(auth: AuthContext, projectId: string) {
    return this.fieldOperationsService.getMobilizationExpenses(auth, projectId);
  }

  async createMobilizationExpense(auth: AuthContext, projectId: string, dto: CreateSiteMobilizationExpenseDto) {
    return this.fieldOperationsService.createMobilizationExpense(auth, projectId, dto);
  }

  async deleteMobilizationExpense(auth: AuthContext, id: string) {
    return this.fieldOperationsService.deleteMobilizationExpense(auth, id);
  }

  // ==========================================================================
  // 27. Labor Attendance, Overtime & Bonus/Deduction Records (كشوف يوميات العمالة والسهرات)
  // ==========================================================================

  async getLaborAttendanceRecords(auth: AuthContext, projectId: string, date?: string) {
    return this.fieldOperationsService.getLaborAttendanceRecords(auth, projectId, date);
  }

  async recordLaborAttendance(auth: AuthContext, projectId: string, dto: RecordLaborAttendanceRecordDto) {
    return this.fieldOperationsService.recordLaborAttendance(auth, projectId, dto);
  }

  async deleteLaborAttendanceRecord(auth: AuthContext, id: string) {
    return this.fieldOperationsService.deleteLaborAttendanceRecord(auth, id);
  }

  // ==========================================================================
  // 28. Client Payment Milestones & In-Kind Barter Settlements (جدول الدفعات والمقايضة العينية)
  // ==========================================================================

  async getClientPaymentMilestones(auth: AuthContext, projectId: string) {
    return this.fieldOperationsService.getClientPaymentMilestones(auth, projectId);
  }

  async createClientPaymentMilestone(auth: AuthContext, projectId: string, dto: CreateClientPaymentMilestoneDto) {
    return this.fieldOperationsService.createClientPaymentMilestone(auth, projectId, dto);
  }

  async recordInKindBarterDeduction(auth: AuthContext, milestoneId: string, dto: RecordInKindBarterDeductionDto) {
    return this.fieldOperationsService.recordInKindBarterDeduction(auth, milestoneId, dto);
  }

  async deleteClientPaymentMilestone(auth: AuthContext, id: string) {
    return this.fieldOperationsService.deleteClientPaymentMilestone(auth, id);
  }

  // ==========================================================================
  // 29. Equipment & Tools Asset Tracking (سجل وتتبع العِدة والمعدات بالمشاريع)
  // ==========================================================================

  async getEquipmentAssets(
    auth: AuthContext,
    query?: { projectId?: string; operationalStatus?: string; search?: string },
  ) {
    return this.fieldOperationsService.getEquipmentAssets(auth, query);
  }

  async createEquipmentAsset(auth: AuthContext, dto: CreateEquipmentAssetDto) {
    return this.fieldOperationsService.createEquipmentAsset(auth, dto);
  }

  async transferEquipmentAsset(auth: AuthContext, equipmentId: string, dto: TransferEquipmentAssetDto) {
    return this.fieldOperationsService.transferEquipmentAsset(auth, equipmentId, dto);
  }

  async getEquipmentTransfers(auth: AuthContext, equipmentId?: string) {
    return this.fieldOperationsService.getEquipmentTransfers(auth, equipmentId);
  }

  // ==========================================================================
  // 30. Supplier Price Memory & Directory (دليل الموردين والذاكرة السعرية والتقييم)
  // ==========================================================================

  async getSupplierPriceMemory(
    auth: AuthContext,
    query?: { supplierId?: number; materialName?: string; governorate?: string; paymentTerms?: string },
  ) {
    return this.fieldOperationsService.getSupplierPriceMemory(auth, query);
  }

  async recordSupplierPriceMemory(auth: AuthContext, dto: RecordSupplierPriceMemoryDto) {
    return this.fieldOperationsService.recordSupplierPriceMemory(auth, dto);
  }
}
