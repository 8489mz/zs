import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../database/database.constants';
import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import {
  CreateProjectDto,
  UpdateProjectDto,
  MarkTenderLostDto,
  AwardTenderDto,
  CreateBoqItemDto,
  UpdateBoqItemDto,
  CreateChangeOrderDto,
  UpdateChangeOrderStatusDto,
  CreateIpcInvoiceDto,
  CreateSubcontractDto,
  CreateDailyLogDto,
  CreateRfiDto,
  AnswerRfiDto,
  CreateScheduleTaskDto,
  UpdateScheduleTaskDto,
  CreateMaterialRequisitionDto,
  CreateMasterPriceItemDto,
  UpdateMasterPriceItemDto,
  CreateEngineeringConstantDto,
  AutoPriceBoqItemDto,
  CreateCostSnapshotDto,
  CreateRetentionRecordDto,
  ReleaseRetentionDto,
  CreatePaymentHoldDto,
  ReleasePaymentHoldDto,
  CreateSupplierReturnDto,
  CreateLaborAttendanceDto,
  CreatePettyCashDto,
  SettlePettyCashDto,
  CreateGovernmentLicenseDto,
  CreateMasterBoqLibraryItemDto,
  UpdateMasterBoqLibraryItemDto,
  BatchImportMasterBoqDto,
  ImportMasterBoqToProjectDto,
  SaveBoqTakeoffsDto,
  CreateSiteMobilizationExpenseDto,
  RecordLaborAttendanceRecordDto,
  CreateClientPaymentMilestoneDto,
  RecordInKindBarterDeductionDto,
  CreateEquipmentAssetDto,
  TransferEquipmentAssetDto,
  RecordSupplierPriceMemoryDto,
  CreateInspectionRequestDto,
  UpdateInspectionRequestStatusDto,
  CreateSnagItemDto,
  UpdateSnagItemStatusDto,
  CreateProjectHandoverDto,
  ApproveProjectHandoverDto,
  CreateSubmittalDto,
  UpdateSubmittalStatusDto,
  CreateMaterialEscalationDto,
  UpdateMaterialEscalationStatusDto,
  CreateSubcontractorBackchargeDto,
  UpdateBackchargeStatusDto,
  CreateEquipmentFuelLogDto,
  CreateSubcontractorDto,
  UpdateSubcontractorDto,
  CreateSubcontractorPaymentDto,
  CreateGuaranteeDto,
  UpdateGuaranteeDto,
  ExtendGuaranteeDto,
  ReleaseGuaranteeDto,
  InvokeGuaranteeDto,
  CreateCostPoolDto,
  CreateIndirectExpenseDto,
  CreateAllocationBatchDto,
  CreateContractingDocumentDto,
  CreateContractingDocumentRevisionDto,
  UpdateContractingDocumentRevisionStatusDto,
  DistributeContractingDocumentDto,
  CreateMeetingMinuteDto,
  CreateMeetingActionItemDto,
} from './dto/contracting.dto';
import {
  ContractingProjectSummary,
  ContractingInspectionRequest,
  ContractingSnagItem,
  ContractingProjectHandover,
  ContractingProjectCostBreakdown,
  ContractingSubmittal,
  ContractingMaterialEscalation,
  ContractingSubcontractorBackcharge,
  ContractingEquipmentFuelLog,
  ContractingProjectEvmMetrics,
} from './contracting.types';
import {
  BankGuarantee,
} from './guarantee-gateway.engine';
import { BatchAllocationSummary } from './field-indirect-allocation.engine';
import { ContractingProjectsSlice } from './contracting/contracting-projects.slice';
import { ContractingBoqSlice } from './contracting/contracting-boq.slice';
import { ContractingIpcInvoicesSlice } from './contracting/contracting-ipc-invoices.slice';
import { ContractingPostingSlice } from './contracting/contracting-posting.slice';
import { ContractingSubcontractorsSlice } from './contracting/contracting-subcontractors.slice';
import { ContractingSiteOperationsSlice } from './contracting/contracting-site-operations.slice';
import { ContractingPricingSlice } from './contracting/contracting-pricing.slice';
import { ContractingMoneyOperationsSlice } from './contracting/contracting-money-operations.slice';
import { ContractingAnalyticsSlice } from './contracting/contracting-analytics.slice';
import { ContractingMasterBoqSlice } from './contracting/contracting-master-boq.slice';
import { ContractingFieldOperationsSlice } from './contracting/contracting-field-operations.slice';
import { ContractingQualitySlice } from './contracting/contracting-quality.slice';
import { ContractingDocumentsSlice } from './contracting/contracting-documents.slice';
import { ContractingGuaranteesSlice } from './contracting/contracting-guarantees.slice';
// Note: getTenantTimezone is used by the contracting sub-services (site-operations), not by this facade.

@Injectable()
export class ContractingService {

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
  ) {
  }

  private projectsSliceInstance?: ContractingProjectsSlice;
  private get projectsSlice(): ContractingProjectsSlice {
    return (this.projectsSliceInstance ??= new ContractingProjectsSlice(
      this.db,
    ));
  }

  private boqSliceInstance?: ContractingBoqSlice;
  private get boqSlice(): ContractingBoqSlice {
    return (this.boqSliceInstance ??= new ContractingBoqSlice(
      this.db,
      {
        getProjectById: (auth, id) =>
          this.projectsSlice.getProjectById(auth, id),
      },
    ));
  }

  private ipcInvoicesSliceInstance?: ContractingIpcInvoicesSlice;
  private get ipcInvoicesSlice(): ContractingIpcInvoicesSlice {
    return (this.ipcInvoicesSliceInstance ??= new ContractingIpcInvoicesSlice(
      this.db,
      {
        getGuaranteesRaw: (tenantId, filters) =>
          this.guaranteesSlice.getGuaranteesRaw(tenantId, filters),
      },
    ));
  }

  private postingSliceInstance?: ContractingPostingSlice;
  private get postingSlice(): ContractingPostingSlice {
    return (this.postingSliceInstance ??= new ContractingPostingSlice(
      this.db,
      this.accountingPosting,
      {
        getGuaranteesRaw: (tenantId, filters) =>
          this.guaranteesSlice.getGuaranteesRaw(tenantId, filters),
      },
    ));
  }

  private subcontractorsSliceInstance?: ContractingSubcontractorsSlice;
  private get subcontractorsSlice(): ContractingSubcontractorsSlice {
    return (this.subcontractorsSliceInstance ??= new ContractingSubcontractorsSlice(
      this.db,
    ));
  }

  private siteOperationsSliceInstance?: ContractingSiteOperationsSlice;
  private get siteOperationsSlice(): ContractingSiteOperationsSlice {
    return (this.siteOperationsSliceInstance ??= new ContractingSiteOperationsSlice(
      this.db,
    ));
  }

  private pricingSliceInstance?: ContractingPricingSlice;
  private get pricingSlice(): ContractingPricingSlice {
    return (this.pricingSliceInstance ??= new ContractingPricingSlice(
      this.db,
    ));
  }

  private moneyOperationsSliceInstance?: ContractingMoneyOperationsSlice;
  private get moneyOperationsSlice(): ContractingMoneyOperationsSlice {
    return (this.moneyOperationsSliceInstance ??= new ContractingMoneyOperationsSlice(
      this.db,
    ));
  }

  private analyticsSliceInstance?: ContractingAnalyticsSlice;
  private get analyticsSlice(): ContractingAnalyticsSlice {
    return (this.analyticsSliceInstance ??= new ContractingAnalyticsSlice(
      this.db,
      {
        getProjectById: (auth, id) =>
          this.projectsSlice.getProjectById(auth, id),
        getBoqItems: (auth, projectId) =>
          this.boqSlice.getBoqItems(auth, projectId),
        getEngineeringConstants: (auth) =>
          this.pricingSlice.getEngineeringConstants(auth),
        getMaterialRequisitions: (auth, projectId) =>
          this.siteOperationsSlice.getMaterialRequisitions(auth, projectId),
        getScheduleTasks: (auth, projectId) =>
          this.siteOperationsSlice.getScheduleTasks(auth, projectId),
        getGovernmentLicenses: (auth, query) =>
          this.moneyOperationsSlice.getGovernmentLicenses(auth, query),
        getPaymentHolds: (auth, query) =>
          this.moneyOperationsSlice.getPaymentHolds(auth, query),
        getMobilizationExpenses: (auth, projectId) =>
          this.fieldOperationsSlice.getMobilizationExpenses(auth, projectId),
      },
    ));
  }

  private masterBoqSliceInstance?: ContractingMasterBoqSlice;
  private get masterBoqSlice(): ContractingMasterBoqSlice {
    return (this.masterBoqSliceInstance ??= new ContractingMasterBoqSlice(
      this.db,
      {
        getProjectById: (auth, id) =>
          this.projectsSlice.getProjectById(auth, id),
      },
    ));
  }

  private fieldOperationsSliceInstance?: ContractingFieldOperationsSlice;
  private get fieldOperationsSlice(): ContractingFieldOperationsSlice {
    return (this.fieldOperationsSliceInstance ??= new ContractingFieldOperationsSlice(
      this.db,
      {
        getProjectById: (auth, id) =>
          this.projectsSlice.getProjectById(auth, id),
      },
    ));
  }

  private qualitySliceInstance?: ContractingQualitySlice;
  private get qualitySlice(): ContractingQualitySlice {
    return (this.qualitySliceInstance ??= new ContractingQualitySlice(
      this.db,
    ));
  }

  private documentsSliceInstance?: ContractingDocumentsSlice;
  private get documentsSlice(): ContractingDocumentsSlice {
    return (this.documentsSliceInstance ??= new ContractingDocumentsSlice(
      this.db,
    ));
  }

  private guaranteesSliceInstance?: ContractingGuaranteesSlice;
  private get guaranteesSlice(): ContractingGuaranteesSlice {
    return (this.guaranteesSliceInstance ??= new ContractingGuaranteesSlice(
      this.db,
      {
        getProjectById: (auth, id) =>
          this.projectsSlice.getProjectById(auth, id),
        getBoqItems: (auth, projectId) =>
          this.boqSlice.getBoqItems(auth, projectId),
        getSubcontractById: (auth, id) =>
          this.subcontractorsSlice.getSubcontractById(auth, id),
        getSubcontractorById: (auth, id) =>
          this.subcontractorsSlice.getSubcontractorById(auth, id),
      },
    ));
  }

  async getProjects(auth: AuthContext, query?: { status?: string; search?: string }) {
    return this.projectsSlice.getProjects(auth, query);
  }

  async getProjectById(auth: AuthContext, id: string): Promise<ContractingProjectSummary> {
    return this.projectsSlice.getProjectById(auth, id);
  }

  async createProject(auth: AuthContext, dto: CreateProjectDto) {
    return this.projectsSlice.createProject(auth, dto);
  }

  async updateProject(auth: AuthContext, id: string, dto: UpdateProjectDto) {
    return this.projectsSlice.updateProject(auth, id, dto);
  }

  async createTenderRevision(auth: AuthContext, id: string) {
    return this.projectsSlice.createTenderRevision(auth, id);
  }

  async markTenderLost(auth: AuthContext, id: string, dto: MarkTenderLostDto) {
    return this.projectsSlice.markTenderLost(auth, id, dto);
  }

  async awardTender(auth: AuthContext, id: string, dto: AwardTenderDto) {
    return this.projectsSlice.awardTender(auth, id, dto);
  }

  async deleteProject(auth: AuthContext, id: string) {
    return this.projectsSlice.deleteProject(auth, id);
  }

  async getBoqItems(auth: AuthContext, projectId: string) {
    return this.boqSlice.getBoqItems(auth, projectId);
  }

  async createBoqItem(auth: AuthContext, projectId: string, dto: CreateBoqItemDto) {
    return this.boqSlice.createBoqItem(auth, projectId, dto);
  }

  async batchCreateBoqItems(auth: AuthContext, projectId: string, items: CreateBoqItemDto[]) {
    return this.boqSlice.batchCreateBoqItems(auth, projectId, items);
  }

  async updateBoqItem(auth: AuthContext, id: string, dto: UpdateBoqItemDto) {
    return this.boqSlice.updateBoqItem(auth, id, dto);
  }

  async deleteBoqItem(auth: AuthContext, id: string) {
    return this.boqSlice.deleteBoqItem(auth, id);
  }

  async getChangeOrders(auth: AuthContext, projectId: string) {
    return this.boqSlice.getChangeOrders(auth, projectId);
  }

  async createChangeOrder(auth: AuthContext, projectId: string, dto: CreateChangeOrderDto) {
    return this.boqSlice.createChangeOrder(auth, projectId, dto);
  }

  async updateChangeOrderStatus(auth: AuthContext, id: string, dto: UpdateChangeOrderStatusDto) {
    return this.boqSlice.updateChangeOrderStatus(auth, id, dto);
  }

  async getInvoices(auth: AuthContext, projectId: string, type: 'client' | 'subcontractor' = 'client') {
    return this.ipcInvoicesSlice.getInvoices(auth, projectId, type);
  }

  async getInvoiceById(auth: AuthContext, id: string) {
    return this.ipcInvoicesSlice.getInvoiceById(auth, id);
  }

  async createInvoice(auth: AuthContext, projectId: string, dto: CreateIpcInvoiceDto) {
    return this.ipcInvoicesSlice.createInvoice(auth, projectId, dto);
  }

  async approveInvoice(auth: AuthContext, id: string) {
    return this.ipcInvoicesSlice.approveInvoice(auth, id);
  }

  async postInvoiceJournalEntry(auth: AuthContext, invoiceId: string) {
    return this.postingSlice.postInvoiceJournalEntry(auth, invoiceId);
  }

  async getSubcontracts(auth: AuthContext, projectId: string) {
    return this.subcontractorsSlice.getSubcontracts(auth, projectId);
  }

  async createSubcontract(auth: AuthContext, projectId: string, dto: CreateSubcontractDto) {
    return this.subcontractorsSlice.createSubcontract(auth, projectId, dto);
  }

  async getSubcontractById(auth: AuthContext, id: string) {
    return this.subcontractorsSlice.getSubcontractById(auth, id);
  }

  async getDailyLogs(auth: AuthContext, projectId: string) {
    return this.siteOperationsSlice.getDailyLogs(auth, projectId);
  }

  async createDailyLog(auth: AuthContext, projectId: string, dto: CreateDailyLogDto) {
    return this.siteOperationsSlice.createDailyLog(auth, projectId, dto);
  }

  async getRfiList(auth: AuthContext, projectId: string) {
    return this.siteOperationsSlice.getRfiList(auth, projectId);
  }

  async createRfi(auth: AuthContext, projectId: string, dto: CreateRfiDto) {
    return this.siteOperationsSlice.createRfi(auth, projectId, dto);
  }

  async answerRfi(auth: AuthContext, id: string, dto: AnswerRfiDto) {
    return this.siteOperationsSlice.answerRfi(auth, id, dto);
  }

  async getScheduleTasks(auth: AuthContext, projectId: string) {
    return this.siteOperationsSlice.getScheduleTasks(auth, projectId);
  }

  async createScheduleTask(auth: AuthContext, projectId: string, dto: CreateScheduleTaskDto) {
    return this.siteOperationsSlice.createScheduleTask(auth, projectId, dto);
  }

  async updateScheduleTask(auth: AuthContext, id: string, dto: UpdateScheduleTaskDto) {
    return this.siteOperationsSlice.updateScheduleTask(auth, id, dto);
  }

  async deleteScheduleTask(auth: AuthContext, id: string) {
    return this.siteOperationsSlice.deleteScheduleTask(auth, id);
  }

  async getResourceLoadingHistogram(auth: AuthContext, projectId: string) {
    return this.siteOperationsSlice.getResourceLoadingHistogram(auth, projectId);
  }

  async getMaterialRequisitions(auth: AuthContext, projectId: string) {
    return this.siteOperationsSlice.getMaterialRequisitions(auth, projectId);
  }

  async createMaterialRequisition(auth: AuthContext, projectId: string, dto: CreateMaterialRequisitionDto) {
    return this.siteOperationsSlice.createMaterialRequisition(auth, projectId, dto);
  }

  async deleteMaterialRequisition(auth: AuthContext, id: string) {
    return this.siteOperationsSlice.deleteMaterialRequisition(auth, id);
  }

  async getMasterPriceList(auth: AuthContext, query?: { itemType?: string; category?: string; search?: string }) {
    return this.pricingSlice.getMasterPriceList(auth, query);
  }

  async createMasterPriceItem(auth: AuthContext, dto: CreateMasterPriceItemDto) {
    return this.pricingSlice.createMasterPriceItem(auth, dto);
  }

  async updateMasterPriceItem(auth: AuthContext, id: string, dto: UpdateMasterPriceItemDto) {
    return this.pricingSlice.updateMasterPriceItem(auth, id, dto);
  }

  async deleteMasterPriceItem(auth: AuthContext, id: string) {
    return this.pricingSlice.deleteMasterPriceItem(auth, id);
  }

  async getEngineeringConstants(auth: AuthContext) {
    return this.pricingSlice.getEngineeringConstants(auth);
  }

  async createEngineeringConstant(auth: AuthContext, dto: CreateEngineeringConstantDto) {
    return this.pricingSlice.createEngineeringConstant(auth, dto);
  }

  async autoPriceBoqItem(auth: AuthContext, dto: AutoPriceBoqItemDto) {
    return this.pricingSlice.autoPriceBoqItem(auth, dto);
  }

  // ==========================================================================
  // Helper: Enrich Project Financial KPIs
  // ==========================================================================

  async getCostSnapshots(auth: AuthContext, projectId: string) {
    return this.boqSlice.getCostSnapshots(auth, projectId);
  }

  async createCostSnapshot(auth: AuthContext, projectId: string, dto: CreateCostSnapshotDto) {
    return this.boqSlice.createCostSnapshot(auth, projectId, dto);
  }

  async getRetentionRecords(auth: AuthContext, query?: { projectId?: string; status?: string }) {
    return this.moneyOperationsSlice.getRetentionRecords(auth, query);
  }

  async createRetentionRecord(auth: AuthContext, projectId: string, dto: CreateRetentionRecordDto) {
    return this.moneyOperationsSlice.createRetentionRecord(auth, projectId, dto);
  }

  async releaseRetentionRecord(auth: AuthContext, id: string, dto: ReleaseRetentionDto) {
    return this.moneyOperationsSlice.releaseRetentionRecord(auth, id, dto);
  }

  async getPaymentHolds(auth: AuthContext, query?: { projectId?: string; isReleased?: boolean }) {
    return this.moneyOperationsSlice.getPaymentHolds(auth, query);
  }

  async createPaymentHold(auth: AuthContext, projectId: string, dto: CreatePaymentHoldDto) {
    return this.moneyOperationsSlice.createPaymentHold(auth, projectId, dto);
  }

  async releasePaymentHold(auth: AuthContext, id: string, dto: ReleasePaymentHoldDto) {
    return this.moneyOperationsSlice.releasePaymentHold(auth, id, dto);
  }

  async getSupplierReturns(auth: AuthContext, query?: { projectId?: string }) {
    return this.moneyOperationsSlice.getSupplierReturns(auth, query);
  }

  async createSupplierReturn(auth: AuthContext, projectId: string, dto: CreateSupplierReturnDto) {
    return this.moneyOperationsSlice.createSupplierReturn(auth, projectId, dto);
  }

  async getLaborAttendance(auth: AuthContext, query?: { projectId?: string; workDate?: string }) {
    return this.moneyOperationsSlice.getLaborAttendance(auth, query);
  }

  async createLaborAttendance(auth: AuthContext, projectId: string, dto: CreateLaborAttendanceDto) {
    return this.moneyOperationsSlice.createLaborAttendance(auth, projectId, dto);
  }

  async getPettyCashRecords(auth: AuthContext, query?: { projectId?: string; status?: string }) {
    return this.moneyOperationsSlice.getPettyCashRecords(auth, query);
  }

  async createPettyCash(auth: AuthContext, projectId: string, dto: CreatePettyCashDto) {
    return this.moneyOperationsSlice.createPettyCash(auth, projectId, dto);
  }

  async settlePettyCash(auth: AuthContext, id: string, dto: SettlePettyCashDto) {
    return this.moneyOperationsSlice.settlePettyCash(auth, id, dto);
  }

  async getGovernmentLicenses(auth: AuthContext, query?: { projectId?: string; status?: string }) {
    return this.moneyOperationsSlice.getGovernmentLicenses(auth, query);
  }

  async createGovernmentLicense(auth: AuthContext, projectId: string, dto: CreateGovernmentLicenseDto) {
    return this.moneyOperationsSlice.createGovernmentLicense(auth, projectId, dto);
  }

  async getProjectHealthScore(auth: AuthContext, projectId: string) {
    return this.analyticsSlice.getProjectHealthScore(auth, projectId);
  }

  async getCashForecast(auth: AuthContext, query?: { projectId?: string }) {
    return this.analyticsSlice.getCashForecast(auth, query);
  }

  async getProjectMaterialRequirements(auth: AuthContext, projectId: string) {
    return this.analyticsSlice.getProjectMaterialRequirements(auth, projectId);
  }

  async getBoqProfitabilityAnalysis(auth: AuthContext, projectId: string) {
    return this.analyticsSlice.getBoqProfitabilityAnalysis(auth, projectId);
  }

  async getMasterBoqTrades(auth: AuthContext) {
    return this.masterBoqSlice.getMasterBoqTrades(auth);
  }

  async getMasterBoqLibrary(auth: AuthContext, query?: { tradeCategory?: string; search?: string; status?: string }) {
    return this.masterBoqSlice.getMasterBoqLibrary(auth, query);
  }

  async createMasterBoqItem(auth: AuthContext, dto: CreateMasterBoqLibraryItemDto) {
    return this.masterBoqSlice.createMasterBoqItem(auth, dto);
  }

  async bulkImportMasterBoqItems(auth: AuthContext, dto: BatchImportMasterBoqDto) {
    return this.masterBoqSlice.bulkImportMasterBoqItems(auth, dto);
  }

  async updateMasterBoqItem(auth: AuthContext, id: string, dto: UpdateMasterBoqLibraryItemDto) {
    return this.masterBoqSlice.updateMasterBoqItem(auth, id, dto);
  }

  async toggleMasterBoqItemStatus(auth: AuthContext, id: string, targetActive?: boolean) {
    return this.masterBoqSlice.toggleMasterBoqItemStatus(auth, id, targetActive);
  }

  async deleteMasterBoqItem(auth: AuthContext, id: string) {
    return this.masterBoqSlice.deleteMasterBoqItem(auth, id);
  }

  async importMasterBoqItemsToProject(auth: AuthContext, projectId: string, dto: ImportMasterBoqToProjectDto) {
    return this.masterBoqSlice.importMasterBoqItemsToProject(auth, projectId, dto);
  }

  async getTakeoffsByBoqItem(auth: AuthContext, boqItemId: string) {
    return this.masterBoqSlice.getTakeoffsByBoqItem(auth, boqItemId);
  }

  async saveTakeoffs(auth: AuthContext, boqItemId: string, dto: SaveBoqTakeoffsDto) {
    return this.masterBoqSlice.saveTakeoffs(auth, boqItemId, dto);
  }

  async getMobilizationExpenses(auth: AuthContext, projectId: string) {
    return this.fieldOperationsSlice.getMobilizationExpenses(auth, projectId);
  }

  async createMobilizationExpense(auth: AuthContext, projectId: string, dto: CreateSiteMobilizationExpenseDto) {
    return this.fieldOperationsSlice.createMobilizationExpense(auth, projectId, dto);
  }

  async deleteMobilizationExpense(auth: AuthContext, id: string) {
    return this.fieldOperationsSlice.deleteMobilizationExpense(auth, id);
  }

  async getLaborAttendanceRecords(auth: AuthContext, projectId: string, date?: string) {
    return this.fieldOperationsSlice.getLaborAttendanceRecords(auth, projectId, date);
  }

  async recordLaborAttendance(auth: AuthContext, projectId: string, dto: RecordLaborAttendanceRecordDto) {
    return this.fieldOperationsSlice.recordLaborAttendance(auth, projectId, dto);
  }

  async deleteLaborAttendanceRecord(auth: AuthContext, id: string) {
    return this.fieldOperationsSlice.deleteLaborAttendanceRecord(auth, id);
  }

  async getClientPaymentMilestones(auth: AuthContext, projectId: string) {
    return this.fieldOperationsSlice.getClientPaymentMilestones(auth, projectId);
  }

  async createClientPaymentMilestone(auth: AuthContext, projectId: string, dto: CreateClientPaymentMilestoneDto) {
    return this.fieldOperationsSlice.createClientPaymentMilestone(auth, projectId, dto);
  }

  async recordInKindBarterDeduction(auth: AuthContext, milestoneId: string, dto: RecordInKindBarterDeductionDto) {
    return this.fieldOperationsSlice.recordInKindBarterDeduction(auth, milestoneId, dto);
  }

  async deleteClientPaymentMilestone(auth: AuthContext, id: string) {
    return this.fieldOperationsSlice.deleteClientPaymentMilestone(auth, id);
  }

  async getEquipmentAssets(auth: AuthContext, query?: { projectId?: string; operationalStatus?: string; search?: string }) {
    return this.fieldOperationsSlice.getEquipmentAssets(auth, query);
  }

  async createEquipmentAsset(auth: AuthContext, dto: CreateEquipmentAssetDto) {
    return this.fieldOperationsSlice.createEquipmentAsset(auth, dto);
  }

  async transferEquipmentAsset(auth: AuthContext, equipmentId: string, dto: TransferEquipmentAssetDto) {
    return this.fieldOperationsSlice.transferEquipmentAsset(auth, equipmentId, dto);
  }

  async getEquipmentTransfers(auth: AuthContext, equipmentId?: string) {
    return this.fieldOperationsSlice.getEquipmentTransfers(auth, equipmentId);
  }

  async getSupplierPriceMemory(auth: AuthContext, query?: { supplierId?: number; materialName?: string; governorate?: string; paymentTerms?: string }) {
    return this.fieldOperationsSlice.getSupplierPriceMemory(auth, query);
  }

  async recordSupplierPriceMemory(auth: AuthContext, dto: RecordSupplierPriceMemoryDto) {
    return this.fieldOperationsSlice.recordSupplierPriceMemory(auth, dto);
  }

  async getItemProfitabilityLedger(auth: AuthContext, projectId: string) {
    return this.analyticsSlice.getItemProfitabilityLedger(auth, projectId);
  }

  async getProjectCostBreakdown(auth: AuthContext, projectId: string): Promise<ContractingProjectCostBreakdown> {
    return this.analyticsSlice.getProjectCostBreakdown(auth, projectId);
  }

  async getInspectionRequests(auth: AuthContext, projectId: string, status?: string): Promise<ContractingInspectionRequest[]> {
    return this.qualitySlice.getInspectionRequests(auth, projectId, status);
  }

  async createInspectionRequest(auth: AuthContext, projectId: string, dto: CreateInspectionRequestDto): Promise<ContractingInspectionRequest> {
    return this.qualitySlice.createInspectionRequest(auth, projectId, dto);
  }

  async updateInspectionRequestStatus(auth: AuthContext, id: string, dto: UpdateInspectionRequestStatusDto) {
    return this.qualitySlice.updateInspectionRequestStatus(auth, id, dto);
  }

  async deleteInspectionRequest(auth: AuthContext, id: string) {
    return this.qualitySlice.deleteInspectionRequest(auth, id);
  }

  async getSnagItems(auth: AuthContext, projectId: string, status?: string, severity?: string): Promise<ContractingSnagItem[]> {
    return this.qualitySlice.getSnagItems(auth, projectId, status, severity);
  }

  async createSnagItem(auth: AuthContext, projectId: string, dto: CreateSnagItemDto): Promise<ContractingSnagItem> {
    return this.qualitySlice.createSnagItem(auth, projectId, dto);
  }

  async updateSnagItemStatus(auth: AuthContext, id: string, dto: UpdateSnagItemStatusDto) {
    return this.qualitySlice.updateSnagItemStatus(auth, id, dto);
  }

  async deleteSnagItem(auth: AuthContext, id: string) {
    return this.qualitySlice.deleteSnagItem(auth, id);
  }

  async getProjectHandovers(auth: AuthContext, projectId: string): Promise<ContractingProjectHandover[]> {
    return this.qualitySlice.getProjectHandovers(auth, projectId);
  }

  async createProjectHandover(auth: AuthContext, projectId: string, dto: CreateProjectHandoverDto): Promise<ContractingProjectHandover> {
    return this.qualitySlice.createProjectHandover(auth, projectId, dto);
  }

  async approveProjectHandover(auth: AuthContext, id: string, dto: ApproveProjectHandoverDto) {
    return this.qualitySlice.approveProjectHandover(auth, id, dto);
  }

  async getSubmittals(auth: AuthContext, projectId: string): Promise<ContractingSubmittal[]> {
    return this.qualitySlice.getSubmittals(auth, projectId);
  }

  async createSubmittal(auth: AuthContext, projectId: string, dto: CreateSubmittalDto): Promise<ContractingSubmittal> {
    return this.qualitySlice.createSubmittal(auth, projectId, dto);
  }

  async updateSubmittalStatus(auth: AuthContext, id: string, dto: UpdateSubmittalStatusDto) {
    return this.qualitySlice.updateSubmittalStatus(auth, id, dto);
  }

  async getMaterialEscalations(auth: AuthContext, projectId: string): Promise<ContractingMaterialEscalation[]> {
    return this.qualitySlice.getMaterialEscalations(auth, projectId);
  }

  async createMaterialEscalation(auth: AuthContext, projectId: string, dto: CreateMaterialEscalationDto): Promise<ContractingMaterialEscalation> {
    return this.qualitySlice.createMaterialEscalation(auth, projectId, dto);
  }

  async updateMaterialEscalationStatus(auth: AuthContext, id: string, dto: UpdateMaterialEscalationStatusDto) {
    return this.qualitySlice.updateMaterialEscalationStatus(auth, id, dto);
  }

  async getSubcontractorBackcharges(auth: AuthContext, projectId: string): Promise<ContractingSubcontractorBackcharge[]> {
    return this.qualitySlice.getSubcontractorBackcharges(auth, projectId);
  }

  async createSubcontractorBackcharge(auth: AuthContext, projectId: string, dto: CreateSubcontractorBackchargeDto): Promise<ContractingSubcontractorBackcharge> {
    return this.qualitySlice.createSubcontractorBackcharge(auth, projectId, dto);
  }

  async updateBackchargeStatus(auth: AuthContext, id: string, dto: UpdateBackchargeStatusDto) {
    return this.qualitySlice.updateBackchargeStatus(auth, id, dto);
  }

    async getEquipmentFuelLogs(auth: AuthContext, projectId: string): Promise<ContractingEquipmentFuelLog[]> {
    return this.documentsSlice.getEquipmentFuelLogs(auth, projectId);
  }

    async createEquipmentFuelLog(auth: AuthContext, projectId: string, dto: CreateEquipmentFuelLogDto): Promise<ContractingEquipmentFuelLog> {
    return this.documentsSlice.createEquipmentFuelLog(auth, projectId, dto);
  }

  async getProjectEvmMetrics(auth: AuthContext, projectId: string): Promise<ContractingProjectEvmMetrics> {
    return this.analyticsSlice.getProjectEvmMetrics(auth, projectId);
  }

  async getSubcontractors(auth: AuthContext, query?: { search?: string; tradeSpecialty?: string; status?: string }) {
    return this.subcontractorsSlice.getSubcontractors(auth, query);
  }

  async getSubcontractorById(auth: AuthContext, id: number) {
    return this.subcontractorsSlice.getSubcontractorById(auth, id);
  }

  async createSubcontractor(auth: AuthContext, dto: CreateSubcontractorDto) {
    return this.subcontractorsSlice.createSubcontractor(auth, dto);
  }

  async updateSubcontractor(auth: AuthContext, id: number, dto: UpdateSubcontractorDto) {
    return this.subcontractorsSlice.updateSubcontractor(auth, id, dto);
  }

  async deleteSubcontractor(auth: AuthContext, id: number) {
    return this.subcontractorsSlice.deleteSubcontractor(auth, id);
  }

  async getSubcontractorLedger(auth: AuthContext, subcontractorId: number, query?: { projectId?: string; fromDate?: string; toDate?: string }) {
    return this.subcontractorsSlice.getSubcontractorLedger(auth, subcontractorId, query);
  }

  async createSubcontractorPayment(auth: AuthContext, dto: CreateSubcontractorPaymentDto) {
    return this.postingSlice.createSubcontractorPayment(auth, dto);
  }

  async getGuaranteesRaw(
    tenantId: string,
    filters: { projectId?: string; subcontractId?: string; status?: string } = {}
  ): Promise<BankGuarantee[]> {
    return this.guaranteesSlice.getGuaranteesRaw(tenantId, filters);
  }

  async getGuarantees(
    auth: AuthContext,
    query: {
      projectId?: string;
      subcontractId?: string;
      subcontractorId?: number;
      status?: string;
      guaranteeType?: string;
    } = {}
  ) {
    return this.guaranteesSlice.getGuarantees(auth, query);
  }

  async getGuaranteeById(auth: AuthContext, id: string) {
    return this.guaranteesSlice.getGuaranteeById(auth, id);
  }

  async createGuarantee(auth: AuthContext, dto: CreateGuaranteeDto) {
    return this.guaranteesSlice.createGuarantee(auth, dto);
  }

  async updateGuarantee(auth: AuthContext, id: string, dto: UpdateGuaranteeDto) {
    return this.guaranteesSlice.updateGuarantee(auth, id, dto);
  }

  async extendGuarantee(auth: AuthContext, id: string, dto: ExtendGuaranteeDto) {
    return this.guaranteesSlice.extendGuarantee(auth, id, dto);
  }

  async releaseGuarantee(auth: AuthContext, id: string, dto: ReleaseGuaranteeDto) {
    return this.guaranteesSlice.releaseGuarantee(auth, id, dto);
  }

  async invokeGuarantee(auth: AuthContext, id: string, dto: InvokeGuaranteeDto) {
    return this.guaranteesSlice.invokeGuarantee(auth, id, dto);
  }

  async getGuaranteeExpiryAlerts(auth: AuthContext, projectId?: string) {
    return this.guaranteesSlice.getGuaranteeExpiryAlerts(auth, projectId);
  }

  async initializeDefaultCostPools(auth: AuthContext, projectId: string) {
    return this.guaranteesSlice.initializeDefaultCostPools(auth, projectId);
  }

  async getCostPools(auth: AuthContext, projectId: string) {
    return this.guaranteesSlice.getCostPools(auth, projectId);
  }

  async createCostPool(auth: AuthContext, projectId: string, dto: CreateCostPoolDto) {
    return this.guaranteesSlice.createCostPool(auth, projectId, dto);
  }

  async getIndirectExpenses(auth: AuthContext, projectId: string, poolId?: string) {
    return this.guaranteesSlice.getIndirectExpenses(auth, projectId, poolId);
  }

  async createIndirectExpense(auth: AuthContext, projectId: string, dto: CreateIndirectExpenseDto) {
    return this.guaranteesSlice.createIndirectExpense(auth, projectId, dto);
  }

  async getAllocationBatches(auth: AuthContext, projectId: string) {
    return this.guaranteesSlice.getAllocationBatches(auth, projectId);
  }

  async previewBatchAllocation(auth: AuthContext, projectId: string, dto: CreateAllocationBatchDto): Promise<BatchAllocationSummary> {
    return this.guaranteesSlice.previewBatchAllocation(auth, projectId, dto);
  }

  async postBatchAllocation(auth: AuthContext, projectId: string, dto: CreateAllocationBatchDto) {
    return this.guaranteesSlice.postBatchAllocation(auth, projectId, dto);
  }

  async listDocuments(auth: AuthContext, projectId: string) {
    return this.documentsSlice.listDocuments(auth, projectId);
  }

  async getDocumentDetail(auth: AuthContext, documentId: string) {
    return this.documentsSlice.getDocumentDetail(auth, documentId);
  }

  async createDocument(auth: AuthContext, projectId: string, dto: CreateContractingDocumentDto) {
    return this.documentsSlice.createDocument(auth, projectId, dto);
  }

  async addDocumentRevision(auth: AuthContext, documentId: string, dto: CreateContractingDocumentRevisionDto) {
    return this.documentsSlice.addDocumentRevision(auth, documentId, dto);
  }

  async updateDocumentRevisionStatus(auth: AuthContext, revisionId: string, dto: UpdateContractingDocumentRevisionStatusDto) {
    return this.documentsSlice.updateDocumentRevisionStatus(auth, revisionId, dto);
  }

  async distributeDocument(auth: AuthContext, revisionId: string, dto: DistributeContractingDocumentDto) {
    return this.documentsSlice.distributeDocument(auth, revisionId, dto);
  }

  async listMeetingMinutes(auth: AuthContext, projectId: string) {
    return this.documentsSlice.listMeetingMinutes(auth, projectId);
  }

  async getMeetingMinuteDetail(auth: AuthContext, minuteId: string) {
    return this.documentsSlice.getMeetingMinuteDetail(auth, minuteId);
  }

  async createMeetingMinute(auth: AuthContext, projectId: string, dto: CreateMeetingMinuteDto) {
    return this.documentsSlice.createMeetingMinute(auth, projectId, dto);
  }

  async addMeetingActionItem(auth: AuthContext, minuteId: string, dto: CreateMeetingActionItemDto) {
    return this.documentsSlice.addMeetingActionItem(auth, minuteId, dto);
  }

  async updateMeetingActionItemStatus(auth: AuthContext, actionItemId: string, status: 'open' | 'closed') {
    return this.documentsSlice.updateMeetingActionItemStatus(auth, actionItemId, status);
  }
}
