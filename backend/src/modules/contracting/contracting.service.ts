import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { KYSELY_DB } from '../../database/database.constants';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import {
  getDailyDocumentPrefix,
} from '../../common/utils/document-number.util';
import { formatLocalCalendarDay, getTenantTimezone, todayTenantDate } from '../../common/utils/tenant-timezone.util';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';
import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
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
import {
  computePoolAllocation,
  reconcileAllocationInvariants,
  BatchAllocationSummary,
} from './field-indirect-allocation.engine';
import { ContractingProjectsService } from './services/contracting-projects.service';
import { ContractingSiteOperationsService } from './services/contracting-site-operations.service';
import { ContractingPricingService } from './services/contracting-pricing.service';
import { ContractingMoneyOperationsService } from './services/contracting-money-operations.service';
import { ContractingQualityService } from './services/contracting-quality.service';
import { ContractingDocumentsService } from './services/contracting-documents.service';
import { ContractingBoqService } from './services/contracting-boq.service';
import { ContractingMasterBoqService } from './services/contracting-master-boq.service';
import { ContractingFieldOperationsService } from './services/contracting-field-operations.service';
import { ContractingSubcontractorsService } from './services/contracting-subcontractors.service';
import { ContractingGuaranteesService } from './services/contracting-guarantees.service';
import { ContractingIpcInvoicesService } from './services/contracting-ipc-invoices.service';
import { ContractingPostingService } from './services/contracting-posting.service';
import { ContractingAnalyticsService } from './services/contracting-analytics.service';

@Injectable()
export class ContractingService {
  private readonly projectsService: ContractingProjectsService;
  private readonly siteOperationsService: ContractingSiteOperationsService;
  private readonly pricingService: ContractingPricingService;
  private readonly moneyOperationsService: ContractingMoneyOperationsService;
  private readonly qualityService: ContractingQualityService;
  private readonly documentsService: ContractingDocumentsService;
  private readonly boqService: ContractingBoqService;
  private readonly masterBoqService: ContractingMasterBoqService;
  private readonly fieldOperationsService: ContractingFieldOperationsService;
  private readonly subcontractorsService: ContractingSubcontractorsService;
  private readonly guaranteesService: ContractingGuaranteesService;
  private readonly ipcInvoicesService: ContractingIpcInvoicesService;
  private readonly postingService: ContractingPostingService;
  private readonly analyticsService: ContractingAnalyticsService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
  ) {
    this.projectsService = new ContractingProjectsService({
      db: this.db,
    });
    this.siteOperationsService = new ContractingSiteOperationsService({
      db: this.db,
    });
    this.pricingService = new ContractingPricingService({
      db: this.db,
    });
    this.moneyOperationsService = new ContractingMoneyOperationsService({
      db: this.db,
    });
    this.qualityService = new ContractingQualityService({
      db: this.db,
    });
    this.documentsService = new ContractingDocumentsService({
      db: this.db,
    });
    this.boqService = new ContractingBoqService({
      db: this.db,
      getProjectById: this.getProjectById.bind(this),
    });
    this.masterBoqService = new ContractingMasterBoqService({
      db: this.db,
      getProjectById: this.getProjectById.bind(this),
    });
    this.fieldOperationsService = new ContractingFieldOperationsService({
      db: this.db,
      getProjectById: this.getProjectById.bind(this),
    });
    this.subcontractorsService = new ContractingSubcontractorsService({
      db: this.db,
    });
    this.guaranteesService = new ContractingGuaranteesService({
      db: this.db,
      getProjectById: this.getProjectById.bind(this),
      getBoqItems: this.getBoqItems.bind(this),
      getSubcontractById: this.getSubcontractById.bind(this),
      getSubcontractorById: this.getSubcontractorById.bind(this),
    });
    this.ipcInvoicesService = new ContractingIpcInvoicesService({
      db: this.db,
      getGuaranteesRaw: this.getGuaranteesRaw.bind(this),
    });
    this.postingService = new ContractingPostingService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      getGuaranteesRaw: this.getGuaranteesRaw.bind(this),
    });
    this.analyticsService = new ContractingAnalyticsService({
      db: this.db,
      getProjectById: this.getProjectById.bind(this),
      getBoqItems: this.getBoqItems.bind(this),
      getEngineeringConstants: this.getEngineeringConstants.bind(this),
      getMaterialRequisitions: this.getMaterialRequisitions.bind(this),
      getScheduleTasks: this.getScheduleTasks.bind(this),
      getGovernmentLicenses: this.getGovernmentLicenses.bind(this),
      getPaymentHolds: this.getPaymentHolds.bind(this),
      getMobilizationExpenses: this.getMobilizationExpenses.bind(this),
    });
  }

  // ==========================================================================
  // 1. Projects Management
  // ==========================================================================

  async getProjects(auth: AuthContext, query?: { status?: string; search?: string }) {
    return this.projectsService.getProjects(auth, query);
  }

  async getProjectById(auth: AuthContext, id: string): Promise<ContractingProjectSummary> {
    return this.projectsService.getProjectById(auth, id);
  }

  async createProject(auth: AuthContext, dto: CreateProjectDto) {
    return this.projectsService.createProject(auth, dto);
  }

  async updateProject(auth: AuthContext, id: string, dto: UpdateProjectDto) {
    return this.projectsService.updateProject(auth, id, dto);
  }

  async createTenderRevision(auth: AuthContext, id: string) {
    return this.projectsService.createTenderRevision(auth, id);
  }

  async markTenderLost(auth: AuthContext, id: string, dto: MarkTenderLostDto) {
    return this.projectsService.markTenderLost(auth, id, dto);
  }

  async awardTender(auth: AuthContext, id: string, dto: AwardTenderDto) {
    return this.projectsService.awardTender(auth, id, dto);
  }

  async deleteProject(auth: AuthContext, id: string) {
    return this.projectsService.deleteProject(auth, id);
  }

  // ==========================================================================
  // 2. BOQ (Bill of Quantities / Schedule of Values - SOV)
  // ==========================================================================

  async getBoqItems(auth: AuthContext, projectId: string) {
    return this.boqService.getBoqItems(auth, projectId);
  }

  async createBoqItem(auth: AuthContext, projectId: string, dto: CreateBoqItemDto) {
    return this.boqService.createBoqItem(auth, projectId, dto);
  }

  async batchCreateBoqItems(auth: AuthContext, projectId: string, items: CreateBoqItemDto[]) {
    return this.boqService.batchCreateBoqItems(auth, projectId, items);
  }

  async updateBoqItem(auth: AuthContext, id: string, dto: UpdateBoqItemDto) {
    return this.boqService.updateBoqItem(auth, id, dto);
  }

  async deleteBoqItem(auth: AuthContext, id: string) {
    return this.boqService.deleteBoqItem(auth, id);
  }

  // ==========================================================================
  // 3. Change Orders (أوامر التغيير والملحقات)
  // ==========================================================================

  async getChangeOrders(auth: AuthContext, projectId: string) {
    return this.boqService.getChangeOrders(auth, projectId);
  }

  async createChangeOrder(auth: AuthContext, projectId: string, dto: CreateChangeOrderDto) {
    return this.boqService.createChangeOrder(auth, projectId, dto);
  }

  async updateChangeOrderStatus(auth: AuthContext, id: string, dto: UpdateChangeOrderStatusDto) {
    return this.boqService.updateChangeOrderStatus(auth, id, dto);
  }

  // ==========================================================================
  // 4. Progress Billing / IPC Invoices (المستخلصات التراكمية AIA G702 / G703)
  // ==========================================================================

  async getInvoices(auth: AuthContext, projectId: string, type: 'client' | 'subcontractor' = 'client') {
    return this.ipcInvoicesService.getInvoices(auth, projectId, type);
  }

  async getInvoiceById(auth: AuthContext, id: string) {
    return this.ipcInvoicesService.getInvoiceById(auth, id);
  }

  async createInvoice(auth: AuthContext, projectId: string, dto: CreateIpcInvoiceDto) {
    return this.ipcInvoicesService.createInvoice(auth, projectId, dto);
  }

  async approveInvoice(auth: AuthContext, id: string) {
    return this.ipcInvoicesService.approveInvoice(auth, id);
  }

  async postInvoiceJournalEntry(auth: AuthContext, invoiceId: string) {
    return this.postingService.postInvoiceJournalEntry(auth, invoiceId);
  }

  // ==========================================================================
  // 5. Subcontractors Management (Commitments)
  // ==========================================================================

  async getSubcontracts(auth: AuthContext, projectId: string) {
    return this.subcontractorsService.getSubcontracts(auth, projectId);
  }

  async createSubcontract(auth: AuthContext, projectId: string, dto: CreateSubcontractDto) {
    return this.subcontractorsService.createSubcontract(auth, projectId, dto);
  }

  async getSubcontractById(auth: AuthContext, id: string) {
    return this.subcontractorsService.getSubcontractById(auth, id);
  }

  // ==========================================================================
  // 6. Site Daily Logs (اليومية الميدانية للموقع)
  // ==========================================================================

  async getDailyLogs(auth: AuthContext, projectId: string) {
    return this.siteOperationsService.getDailyLogs(auth, projectId);
  }

  async createDailyLog(auth: AuthContext, projectId: string, dto: CreateDailyLogDto) {
    return this.siteOperationsService.createDailyLog(auth, projectId, dto);
  }

  // ==========================================================================
  // 7. RFIs (Technical Office Requests - استفسارات المهندس والاستشاري)
  // ==========================================================================

  async getRfiList(auth: AuthContext, projectId: string) {
    return this.siteOperationsService.getRfiList(auth, projectId);
  }

  async createRfi(auth: AuthContext, projectId: string, dto: CreateRfiDto) {
    return this.siteOperationsService.createRfi(auth, projectId, dto);
  }

  async answerRfi(auth: AuthContext, id: string, dto: AnswerRfiDto) {
    return this.siteOperationsService.answerRfi(auth, id, dto);
  }

  // ==========================================================================
  // 9. Schedule Tasks & Gantt / CPM
  // ==========================================================================


  async getScheduleTasks(auth: AuthContext, projectId: string) {
    return this.siteOperationsService.getScheduleTasks(auth, projectId);
  }

  async createScheduleTask(auth: AuthContext, projectId: string, dto: CreateScheduleTaskDto) {
    return this.siteOperationsService.createScheduleTask(auth, projectId, dto);
  }

  async updateScheduleTask(auth: AuthContext, id: string, dto: UpdateScheduleTaskDto) {
    return this.siteOperationsService.updateScheduleTask(auth, id, dto);
  }

  async deleteScheduleTask(auth: AuthContext, id: string) {
    return this.siteOperationsService.deleteScheduleTask(auth, id);
  }

  async getResourceLoadingHistogram(auth: AuthContext, projectId: string) {
    return this.siteOperationsService.getResourceLoadingHistogram(auth, projectId);
  }

  // ==========================================================================
  // 10. Material Requisitions (أذون صرف الخامات المباشرة على بنود المقايسة)
  // ==========================================================================

  async getMaterialRequisitions(auth: AuthContext, projectId: string) {
    return this.siteOperationsService.getMaterialRequisitions(auth, projectId);
  }

  async createMaterialRequisition(auth: AuthContext, projectId: string, dto: CreateMaterialRequisitionDto) {
    return this.siteOperationsService.createMaterialRequisition(auth, projectId, dto);
  }

  async deleteMaterialRequisition(auth: AuthContext, id: string) {
    return this.siteOperationsService.deleteMaterialRequisition(auth, id);
  }

  // ==========================================================================
  // Helper: Enrich Project Financial KPIs
  // ==========================================================================

  // ==========================================================================
  // 12. Master Price List (أسعار السوق للخامات والمصنعيات والمعدات)
  // ==========================================================================

  async getMasterPriceList(auth: AuthContext, query?: { itemType?: string; category?: string; search?: string }) {
    return this.pricingService.getMasterPriceList(auth, query);
  }

  async createMasterPriceItem(auth: AuthContext, dto: CreateMasterPriceItemDto) {
    return this.pricingService.createMasterPriceItem(auth, dto);
  }

  async updateMasterPriceItem(auth: AuthContext, id: string, dto: UpdateMasterPriceItemDto) {
    return this.pricingService.updateMasterPriceItem(auth, id, dto);
  }

  async deleteMasterPriceItem(auth: AuthContext, id: string) {
    return this.pricingService.deleteMasterPriceItem(auth, id);
  }

  // ==========================================================================
  // 13. Engineering Constants & Auto-Pricing Engine
  // ==========================================================================

  async getEngineeringConstants(auth: AuthContext) {
    return this.pricingService.getEngineeringConstants(auth);
  }

  async createEngineeringConstant(auth: AuthContext, dto: CreateEngineeringConstantDto) {
    return this.pricingService.createEngineeringConstant(auth, dto);
  }

  async autoPriceBoqItem(auth: AuthContext, dto: AutoPriceBoqItemDto) {
    return this.pricingService.autoPriceBoqItem(auth, dto);
  }

  // ==========================================================================
  // 14. Cost Baseline Snapshots (تجميد تكلفة وميزانية المشروع)
  // ==========================================================================

  async getCostSnapshots(auth: AuthContext, projectId: string) {
    return this.boqService.getCostSnapshots(auth, projectId);
  }

  async createCostSnapshot(auth: AuthContext, projectId: string, dto: CreateCostSnapshotDto) {
    return this.boqService.createCostSnapshot(auth, projectId, dto);
  }

  // ==========================================================================
  // 15. Retention & Guarantees Records
  // ==========================================================================

  async getRetentionRecords(auth: AuthContext, query?: { projectId?: string; status?: string }) {
    return this.moneyOperationsService.getRetentionRecords(auth, query);
  }

  async createRetentionRecord(auth: AuthContext, projectId: string, dto: CreateRetentionRecordDto) {
    return this.moneyOperationsService.createRetentionRecord(auth, projectId, dto);
  }

  async releaseRetentionRecord(auth: AuthContext, id: string, dto: ReleaseRetentionDto) {
    return this.moneyOperationsService.releaseRetentionRecord(auth, id, dto);
  }

  // ==========================================================================
  // 16. Payment Holds (حجز دفعات لعيوب جودة أو تأخير)
  // ==========================================================================

  async getPaymentHolds(auth: AuthContext, query?: { projectId?: string; isReleased?: boolean }) {
    return this.moneyOperationsService.getPaymentHolds(auth, query);
  }

  async createPaymentHold(auth: AuthContext, projectId: string, dto: CreatePaymentHoldDto) {
    return this.moneyOperationsService.createPaymentHold(auth, projectId, dto);
  }

  async releasePaymentHold(auth: AuthContext, id: string, dto: ReleasePaymentHoldDto) {
    return this.moneyOperationsService.releasePaymentHold(auth, id, dto);
  }

  // ==========================================================================
  // 17. Supplier Returns & Credit Notes (أذون مرتجع الخامات)
  // ==========================================================================

  async getSupplierReturns(auth: AuthContext, query?: { projectId?: string }) {
    return this.moneyOperationsService.getSupplierReturns(auth, query);
  }

  async createSupplierReturn(auth: AuthContext, projectId: string, dto: CreateSupplierReturnDto) {
    return this.moneyOperationsService.createSupplierReturn(auth, projectId, dto);
  }

  // ==========================================================================
  // 18. Site Labor Attendance & Split Allocation
  // ==========================================================================

  async getLaborAttendance(auth: AuthContext, query?: { projectId?: string; workDate?: string }) {
    return this.moneyOperationsService.getLaborAttendance(auth, query);
  }

  async createLaborAttendance(auth: AuthContext, projectId: string, dto: CreateLaborAttendanceDto) {
    return this.moneyOperationsService.createLaborAttendance(auth, projectId, dto);
  }

  // ==========================================================================
  // 19. Petty Cash & Site Custody (العهد النقدية مع منع التكرار قبل الإغلاق)
  // ==========================================================================

  async getPettyCashRecords(auth: AuthContext, query?: { projectId?: string; status?: string }) {
    return this.moneyOperationsService.getPettyCashRecords(auth, query);
  }

  async createPettyCash(auth: AuthContext, projectId: string, dto: CreatePettyCashDto) {
    return this.moneyOperationsService.createPettyCash(auth, projectId, dto);
  }

  async settlePettyCash(auth: AuthContext, id: string, dto: SettlePettyCashDto) {
    return this.moneyOperationsService.settlePettyCash(auth, id, dto);
  }

  // ==========================================================================
  // 20. Government Licenses & Site Compliance
  // ==========================================================================

  async getGovernmentLicenses(auth: AuthContext, query?: { projectId?: string; status?: string }) {
    return this.moneyOperationsService.getGovernmentLicenses(auth, query);
  }

  async createGovernmentLicense(auth: AuthContext, projectId: string, dto: CreateGovernmentLicenseDto) {
    return this.moneyOperationsService.createGovernmentLicense(auth, projectId, dto);
  }

  // ==========================================================================
  // 21. Executive Intelligence: Project Health Score & Cash Forecasting
  // ==========================================================================

  async getProjectHealthScore(auth: AuthContext, projectId: string) {
    return this.analyticsService.getProjectHealthScore(auth, projectId);
  }

  async getCashForecast(auth: AuthContext, query?: { projectId?: string }) {
    return this.analyticsService.getCashForecast(auth, query);
  }

  // ==========================================================================
  // 22. Material Requirements Planning (MRP) & Bill of Materials Breakdown
  // ==========================================================================

  async getProjectMaterialRequirements(auth: AuthContext, projectId: string) {
    return this.analyticsService.getProjectMaterialRequirements(auth, projectId);
  }

  // ==========================================================================
  // 23. Item-Level Profit & Loss (P&L) & Cost Variance Analyzer
  // ==========================================================================

  async getBoqProfitabilityAnalysis(auth: AuthContext, projectId: string) {
    return this.analyticsService.getBoqProfitabilityAnalysis(auth, projectId);
  }

  // ==========================================================================
  // 24. Multi-Trade Master BOQ Library (بنك بنود المقاولات المرجعي وسحب التخصصات)
  // ==========================================================================

  async getMasterBoqTrades(auth: AuthContext) {
    return this.masterBoqService.getMasterBoqTrades(auth);
  }

  async getMasterBoqLibrary(auth: AuthContext, query?: { tradeCategory?: string; search?: string; status?: string }) {
    return this.masterBoqService.getMasterBoqLibrary(auth, query);
  }

  async createMasterBoqItem(auth: AuthContext, dto: CreateMasterBoqLibraryItemDto) {
    return this.masterBoqService.createMasterBoqItem(auth, dto);
  }

  async bulkImportMasterBoqItems(auth: AuthContext, dto: BatchImportMasterBoqDto) {
    return this.masterBoqService.bulkImportMasterBoqItems(auth, dto);
  }

  async updateMasterBoqItem(auth: AuthContext, id: string, dto: UpdateMasterBoqLibraryItemDto) {
    return this.masterBoqService.updateMasterBoqItem(auth, id, dto);
  }

  async toggleMasterBoqItemStatus(auth: AuthContext, id: string, targetActive?: boolean) {
    return this.masterBoqService.toggleMasterBoqItemStatus(auth, id, targetActive);
  }

  async deleteMasterBoqItem(auth: AuthContext, id: string) {
    return this.masterBoqService.deleteMasterBoqItem(auth, id);
  }

  async importMasterBoqItemsToProject(auth: AuthContext, projectId: string, dto: ImportMasterBoqToProjectDto) {
    return this.masterBoqService.importMasterBoqItemsToProject(auth, projectId, dto);
  }

  // ==========================================================================
  // 25. BOQ CAD Quantity Takeoffs (شيت حصر الكميات الهندسي باللوحات والأبعاد)
  // ==========================================================================

  async getTakeoffsByBoqItem(auth: AuthContext, boqItemId: string) {
    return this.masterBoqService.getTakeoffsByBoqItem(auth, boqItemId);
  }

  async saveTakeoffs(auth: AuthContext, boqItemId: string, dto: SaveBoqTakeoffsDto) {
    return this.masterBoqService.saveTakeoffs(auth, boqItemId, dto);
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

  async getEquipmentAssets(auth: AuthContext, query?: { projectId?: string; operationalStatus?: string; search?: string }) {
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

  async getSupplierPriceMemory(auth: AuthContext, query?: { supplierId?: number; materialName?: string; governorate?: string; paymentTerms?: string }) {
    return this.fieldOperationsService.getSupplierPriceMemory(auth, query);
  }

  async recordSupplierPriceMemory(auth: AuthContext, dto: RecordSupplierPriceMemoryDto) {
    return this.fieldOperationsService.recordSupplierPriceMemory(auth, dto);
  }

  // ==========================================================================
  // 31. Item-Level Direct Cost & Profitability Ledger (ربحية البند اللحظية)
  // ==========================================================================

  async getItemProfitabilityLedger(auth: AuthContext, projectId: string) {
    return this.analyticsService.getItemProfitabilityLedger(auth, projectId);
  }

  // ==========================================================================
  // 32. Comprehensive Project Actual Cost Breakdown (تحليل التكاليف الفعلية ومقارنة الميزانية)
  // ==========================================================================

  async getProjectCostBreakdown(auth: AuthContext, projectId: string): Promise<ContractingProjectCostBreakdown> {
    return this.analyticsService.getProjectCostBreakdown(auth, projectId);
  }

  // ==========================================================================
  // 33. Work Inspection Requests (WIR - طلبات فحص واستلام الأعمال الإنشائية)
  // ==========================================================================

  async getInspectionRequests(auth: AuthContext, projectId: string, status?: string): Promise<ContractingInspectionRequest[]> {
    return this.qualityService.getInspectionRequests(auth, projectId, status);
  }

  async createInspectionRequest(auth: AuthContext, projectId: string, dto: CreateInspectionRequestDto): Promise<ContractingInspectionRequest> {
    return this.qualityService.createInspectionRequest(auth, projectId, dto);
  }

  async updateInspectionRequestStatus(auth: AuthContext, id: string, dto: UpdateInspectionRequestStatusDto) {
    return this.qualityService.updateInspectionRequestStatus(auth, id, dto);
  }

  async deleteInspectionRequest(auth: AuthContext, id: string) {
    return this.qualityService.deleteInspectionRequest(auth, id);
  }

  // ==========================================================================
  // 34. Snag Items & Punch List (قائمة الملاحظات وعيوب المصنعية والتسليم)
  // ==========================================================================

  async getSnagItems(auth: AuthContext, projectId: string, status?: string, severity?: string): Promise<ContractingSnagItem[]> {
    return this.qualityService.getSnagItems(auth, projectId, status, severity);
  }

  async createSnagItem(auth: AuthContext, projectId: string, dto: CreateSnagItemDto): Promise<ContractingSnagItem> {
    return this.qualityService.createSnagItem(auth, projectId, dto);
  }

  async updateSnagItemStatus(auth: AuthContext, id: string, dto: UpdateSnagItemStatusDto) {
    return this.qualityService.updateSnagItemStatus(auth, id, dto);
  }

  async deleteSnagItem(auth: AuthContext, id: string) {
    return this.qualityService.deleteSnagItem(auth, id);
  }

  // ==========================================================================
  // 35. Project Handovers & Releases (محاضر التسليم الابتدائي والنهائي)
  // ==========================================================================

  async getProjectHandovers(auth: AuthContext, projectId: string): Promise<ContractingProjectHandover[]> {
    return this.qualityService.getProjectHandovers(auth, projectId);
  }

  async createProjectHandover(auth: AuthContext, projectId: string, dto: CreateProjectHandoverDto): Promise<ContractingProjectHandover> {
    return this.qualityService.createProjectHandover(auth, projectId, dto);
  }

  async approveProjectHandover(auth: AuthContext, id: string, dto: ApproveProjectHandoverDto) {
    return this.qualityService.approveProjectHandover(auth, id, dto);
  }

  // ==========================================================================
  // 12. Material & Shop Drawing Submittals (MAR / MAS)
  // ==========================================================================

  async getSubmittals(auth: AuthContext, projectId: string): Promise<ContractingSubmittal[]> {
    return this.qualityService.getSubmittals(auth, projectId);
  }

  async createSubmittal(auth: AuthContext, projectId: string, dto: CreateSubmittalDto): Promise<ContractingSubmittal> {
    return this.qualityService.createSubmittal(auth, projectId, dto);
  }

  async updateSubmittalStatus(auth: AuthContext, id: string, dto: UpdateSubmittalStatusDto) {
    return this.qualityService.updateSubmittalStatus(auth, id, dto);
  }

  // ==========================================================================
  // 13. Material Price Escalation Claims
  // ==========================================================================

  async getMaterialEscalations(auth: AuthContext, projectId: string): Promise<ContractingMaterialEscalation[]> {
    return this.qualityService.getMaterialEscalations(auth, projectId);
  }

  async createMaterialEscalation(auth: AuthContext, projectId: string, dto: CreateMaterialEscalationDto): Promise<ContractingMaterialEscalation> {
    return this.qualityService.createMaterialEscalation(auth, projectId, dto);
  }

  async updateMaterialEscalationStatus(auth: AuthContext, id: string, dto: UpdateMaterialEscalationStatusDto) {
    return this.qualityService.updateMaterialEscalationStatus(auth, id, dto);
  }

  // ==========================================================================
  // 14. Subcontractor Back-Charges & Deductions
  // ==========================================================================

  async getSubcontractorBackcharges(auth: AuthContext, projectId: string): Promise<ContractingSubcontractorBackcharge[]> {
    return this.qualityService.getSubcontractorBackcharges(auth, projectId);
  }

  async createSubcontractorBackcharge(auth: AuthContext, projectId: string, dto: CreateSubcontractorBackchargeDto): Promise<ContractingSubcontractorBackcharge> {
    return this.qualityService.createSubcontractorBackcharge(auth, projectId, dto);
  }

  async updateBackchargeStatus(auth: AuthContext, id: string, dto: UpdateBackchargeStatusDto) {
    return this.qualityService.updateBackchargeStatus(auth, id, dto);
  }

  // ==========================================================================
  // 15. Equipment Fuel & Operating Meter Logs
  // ==========================================================================

    async getEquipmentFuelLogs(auth: AuthContext, projectId: string): Promise<ContractingEquipmentFuelLog[]> {
    return this.documentsService.getEquipmentFuelLogs(auth, projectId);
  }

    async createEquipmentFuelLog(auth: AuthContext, projectId: string, dto: CreateEquipmentFuelLogDto): Promise<ContractingEquipmentFuelLog> {
    return this.documentsService.createEquipmentFuelLog(auth, projectId, dto);
  }

  // ==========================================================================
  // 16. Earned Value Management (EVM) & S-Curve Calculation Engine
  // ==========================================================================

  async getProjectEvmMetrics(auth: AuthContext, projectId: string): Promise<ContractingProjectEvmMetrics> {
    return this.analyticsService.getProjectEvmMetrics(auth, projectId);
  }

  // ==========================================================================
  // 12. Subcontractors Directory & Financial Ledger (إدارة ودليل مقاولي الباطن وكشف الحساب)
  // ==========================================================================

  async getSubcontractors(auth: AuthContext, query?: { search?: string; tradeSpecialty?: string; status?: string }) {
    return this.subcontractorsService.getSubcontractors(auth, query);
  }

  async getSubcontractorById(auth: AuthContext, id: number) {
    return this.subcontractorsService.getSubcontractorById(auth, id);
  }

  async createSubcontractor(auth: AuthContext, dto: CreateSubcontractorDto) {
    return this.subcontractorsService.createSubcontractor(auth, dto);
  }

  async updateSubcontractor(auth: AuthContext, id: number, dto: UpdateSubcontractorDto) {
    return this.subcontractorsService.updateSubcontractor(auth, id, dto);
  }

  async deleteSubcontractor(auth: AuthContext, id: number) {
    return this.subcontractorsService.deleteSubcontractor(auth, id);
  }

  async getSubcontractorLedger(auth: AuthContext, subcontractorId: number, query?: { projectId?: string; fromDate?: string; toDate?: string }) {
    return this.subcontractorsService.getSubcontractorLedger(auth, subcontractorId, query);
  }

  async createSubcontractorPayment(auth: AuthContext, dto: CreateSubcontractorPaymentDto) {
    return this.postingService.createSubcontractorPayment(auth, dto);
  }

  // ==========================================================================
  // 38. Bank Guarantees & Gateway G1 Lifecycle Management (خطابات الضمان البنكية)
  // ==========================================================================

  async getGuaranteesRaw(
    tenantId: string,
    filters: { projectId?: string; subcontractId?: string; status?: string } = {}
  ): Promise<BankGuarantee[]> {
    return this.guaranteesService.getGuaranteesRaw(tenantId, filters);
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
    return this.guaranteesService.getGuarantees(auth, query);
  }

  async getGuaranteeById(auth: AuthContext, id: string) {
    return this.guaranteesService.getGuaranteeById(auth, id);
  }

  async createGuarantee(auth: AuthContext, dto: CreateGuaranteeDto) {
    return this.guaranteesService.createGuarantee(auth, dto);
  }

  async updateGuarantee(auth: AuthContext, id: string, dto: UpdateGuaranteeDto) {
    return this.guaranteesService.updateGuarantee(auth, id, dto);
  }

  async extendGuarantee(auth: AuthContext, id: string, dto: ExtendGuaranteeDto) {
    return this.guaranteesService.extendGuarantee(auth, id, dto);
  }

  async releaseGuarantee(auth: AuthContext, id: string, dto: ReleaseGuaranteeDto) {
    return this.guaranteesService.releaseGuarantee(auth, id, dto);
  }

  async invokeGuarantee(auth: AuthContext, id: string, dto: InvokeGuaranteeDto) {
    return this.guaranteesService.invokeGuarantee(auth, id, dto);
  }

  async getGuaranteeExpiryAlerts(auth: AuthContext, projectId?: string) {
    return this.guaranteesService.getGuaranteeExpiryAlerts(auth, projectId);
  }

  // ==========================================================================
  // Track 1: Field Indirect Costs & Distributables Allocation (AACE RP 10S-90 / 34R-05)
  // ==========================================================================

  async initializeDefaultCostPools(auth: AuthContext, projectId: string) {
    return this.guaranteesService.initializeDefaultCostPools(auth, projectId);
  }

  async getCostPools(auth: AuthContext, projectId: string) {
    return this.guaranteesService.getCostPools(auth, projectId);
  }

  async createCostPool(auth: AuthContext, projectId: string, dto: CreateCostPoolDto) {
    return this.guaranteesService.createCostPool(auth, projectId, dto);
  }

  async getIndirectExpenses(auth: AuthContext, projectId: string, poolId?: string) {
    return this.guaranteesService.getIndirectExpenses(auth, projectId, poolId);
  }

  async createIndirectExpense(auth: AuthContext, projectId: string, dto: CreateIndirectExpenseDto) {
    return this.guaranteesService.createIndirectExpense(auth, projectId, dto);
  }

  async getAllocationBatches(auth: AuthContext, projectId: string) {
    return this.guaranteesService.getAllocationBatches(auth, projectId);
  }

  async previewBatchAllocation(auth: AuthContext, projectId: string, dto: CreateAllocationBatchDto): Promise<BatchAllocationSummary> {
    return this.guaranteesService.previewBatchAllocation(auth, projectId, dto);
  }

  async postBatchAllocation(auth: AuthContext, projectId: string, dto: CreateAllocationBatchDto) {
    return this.guaranteesService.postBatchAllocation(auth, projectId, dto);
  }

  // ==========================================================================
  // 41. Document Register (Drawing/Document Control — Procore/Autodesk Build Benchmark)
  // ==========================================================================

  async listDocuments(auth: AuthContext, projectId: string) {
    return this.documentsService.listDocuments(auth, projectId);
  }

  async getDocumentDetail(auth: AuthContext, documentId: string) {
    return this.documentsService.getDocumentDetail(auth, documentId);
  }

  async createDocument(auth: AuthContext, projectId: string, dto: CreateContractingDocumentDto) {
    return this.documentsService.createDocument(auth, projectId, dto);
  }

  async addDocumentRevision(auth: AuthContext, documentId: string, dto: CreateContractingDocumentRevisionDto) {
    return this.documentsService.addDocumentRevision(auth, documentId, dto);
  }

  async updateDocumentRevisionStatus(auth: AuthContext, revisionId: string, dto: UpdateContractingDocumentRevisionStatusDto) {
    return this.documentsService.updateDocumentRevisionStatus(auth, revisionId, dto);
  }

  async distributeDocument(auth: AuthContext, revisionId: string, dto: DistributeContractingDocumentDto) {
    return this.documentsService.distributeDocument(auth, revisionId, dto);
  }

  // ==========================================================================
  // 42. Meeting Minutes & Action Items
  // ==========================================================================

  async listMeetingMinutes(auth: AuthContext, projectId: string) {
    return this.documentsService.listMeetingMinutes(auth, projectId);
  }

  async getMeetingMinuteDetail(auth: AuthContext, minuteId: string) {
    return this.documentsService.getMeetingMinuteDetail(auth, minuteId);
  }

  async createMeetingMinute(auth: AuthContext, projectId: string, dto: CreateMeetingMinuteDto) {
    return this.documentsService.createMeetingMinute(auth, projectId, dto);
  }

  async addMeetingActionItem(auth: AuthContext, minuteId: string, dto: CreateMeetingActionItemDto) {
    return this.documentsService.addMeetingActionItem(auth, minuteId, dto);
  }

  async updateMeetingActionItemStatus(auth: AuthContext, actionItemId: string, status: 'open' | 'closed') {
    return this.documentsService.updateMeetingActionItemStatus(auth, actionItemId, status);
  }
}





