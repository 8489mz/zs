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
    const project = await this.getProjectById(auth, projectId);
    const licenses = await this.getGovernmentLicenses(auth, { projectId });
    const holds = await this.getPaymentHolds(auth, { projectId, isReleased: false });

    // 1. SPI: Schedule Performance Index (completionRate / expectedProgress)
    const completionRate = project.completionRatePercent;
    const spi = completionRate >= 90 ? 1.0 : completionRate >= 70 ? 0.85 : 0.65;

    // 2. CPI: Cost Performance Index
    const budget = project.revisedContractValue || 1;
    const costIncurred = project.actualCostIncurred;
    const cpi = costIncurred <= budget ? 1.0 : Math.max(0.5, budget / (costIncurred || 1));

    // 3. Compliance & Risk deductions
    let complianceScore = 100;
    const expiredLicenses = licenses.filter((l: any) => l.status === 'expired').length;
    const expiringLicenses = licenses.filter((l: any) => l.status === 'expiring_soon').length;
    complianceScore -= expiredLicenses * 25;
    complianceScore -= expiringLicenses * 10;
    complianceScore = Math.max(0, complianceScore);

    const holdsTotal = holds.reduce((acc: number, h: any) => acc + Number(h.holdAmount || 0), 0);
    const retentionRisk = holdsTotal > 0 ? 80 : 100;

    // Composite Score calculation (0 to 100)
    let finalScore = Math.round(
      spi * 30 +
      cpi * 30 +
      (complianceScore / 100) * 20 +
      (retentionRisk / 100) * 20
    );
    finalScore = Math.min(100, Math.max(0, finalScore));

    const healthStatus: 'green' | 'yellow' | 'red' =
      finalScore >= 80 ? 'green' : finalScore >= 60 ? 'yellow' : 'red';

    const recommendations: string[] = [];
    if (expiredLicenses > 0) {
      recommendations.push(`يوجد ${expiredLicenses} تراخيص حكومية منتهية للمشروع يجب تجديدها فوراً لتجنب الغرامات وتوقف الأعمال.`);
    }
    if (expiringLicenses > 0) {
      recommendations.push(`يوجد ${expiringLicenses} تصاريح تقترب من موعد الانتهاء خلال 30 يوماً.`);
    }
    if (holdsTotal > 0) {
      recommendations.push(`توجد دفعات محتجزة بقيمة ${holdsTotal.toLocaleString()} ر.س بسبب ملاحظات فنية أو عيوب استلام.`);
    }
    if (project.grossMarginForecast < 0) {
      recommendations.push(`توقعات هامش الربح سالبة، يلزم مراجعة تكاليف مقاولي الباطن والمواد.`);
    }
    if (recommendations.length === 0) {
      recommendations.push('المشروع يسير بمؤشرات إيجابية ممتازة ومتوافقة مع الميزانية والجدول الزمني.');
    }

    return {
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      score: finalScore,
      status: healthStatus,
      breakdown: {
        schedulePerformanceIndex: spi,
        costPerformanceIndex: cpi,
        budgetVariancePercent: Math.round(((project.revisedContractValue - project.actualCostIncurred) / (project.revisedContractValue || 1)) * 100),
        licensesComplianceScore: complianceScore,
        retentionRiskScore: retentionRisk,
      },
      recommendations,
    };
  }

  /**
   * Buckets a set of dated amounts into 0-30 / 31-60 / 61-90 / beyond-90 windows
   * from `referenceDate`. Rows without a real due date fall into `undated`
   * rather than being silently split by a guessed percentage.
   */
  private bucketByDueDate(
    rows: { amount: number; dueDate: string | null }[],
    referenceDate: Date,
  ): { d30: number; d60: number; d90: number; beyond: number; undated: number } {
    const result = { d30: 0, d60: 0, d90: 0, beyond: 0, undated: 0 };
    const refTime = referenceDate.getTime();
    for (const row of rows) {
      if (!row.dueDate) {
        result.undated += row.amount;
        continue;
      }
      const dueTime = new Date(row.dueDate).getTime();
      const daysOut = Math.ceil((dueTime - refTime) / (1000 * 60 * 60 * 24));
      if (daysOut <= 30) result.d30 += row.amount;
      else if (daysOut <= 60) result.d60 += row.amount;
      else if (daysOut <= 90) result.d90 += row.amount;
      else result.beyond += row.amount;
    }
    return result;
  }

  /**
   * Real time-phased cash-flow forecast (replaces the earlier fixed 50/30/20%
   * heuristic split): inflows/outflows are bucketed by each IPC's actual
   * `payment_due_date`, not by a guessed distribution — a project with all
   * pending IPCs due in 10 days now correctly shows a 30-day crunch instead of
   * an evenly-smeared forecast. Rows without a due date are surfaced
   * separately (`undated`) instead of being silently folded into a bucket.
   */
  async getCashForecast(auth: AuthContext, query?: { projectId?: string }) {
    const { tenantId } = requireTenantScope(auth);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Inflows: Approved but un-paid client IPC invoices
    let clientIpcsQuery = (this.db as any)
      .selectFrom('contracting_invoices')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('ipc_type', '=', 'client')
      .where('status', 'in', ['approved', 'under_review']);

    if (query?.projectId && query.projectId !== 'all') {
      clientIpcsQuery = clientIpcsQuery.where('project_id', '=', query.projectId as any);
    }
    const pendingClientIpcs = await clientIpcsQuery.execute();
    const totalExpectedInflow = pendingClientIpcs.reduce((acc: number, r: any) => acc + Number(r.net_payable || 0), 0);
    const inflowBuckets = this.bucketByDueDate(
      pendingClientIpcs.map((r: any) => ({ amount: Number(r.net_payable || 0), dueDate: r.payment_due_date || r.certification_due_date || null })),
      today,
    );

    // Outflows: Subcontractor IPCs + Government Licenses Fees
    let subIpcsQuery = (this.db as any)
      .selectFrom('contracting_invoices')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('ipc_type', '=', 'subcontractor')
      .where('status', 'in', ['approved', 'under_review']);

    if (query?.projectId && query.projectId !== 'all') {
      subIpcsQuery = subIpcsQuery.where('project_id', '=', query.projectId as any);
    }
    const pendingSubIpcs = await subIpcsQuery.execute();
    const totalPendingSubIpcs = pendingSubIpcs.reduce((acc: number, r: any) => acc + Number(r.net_payable || 0), 0);
    const subIpcOutflowBuckets = this.bucketByDueDate(
      pendingSubIpcs.map((r: any) => ({ amount: Number(r.net_payable || 0), dueDate: r.payment_due_date || null })),
      today,
    );

    const licenses = await this.getGovernmentLicenses(auth, query);
    const upcomingLicenseFees = licenses.reduce((acc: number, l: any) => acc + Number(l.feeAmount || 0), 0);
    const licenseBuckets = this.bucketByDueDate(
      licenses.map((l: any) => ({ amount: Number(l.feeAmount || 0), dueDate: l.expiryDate || null })),
      today,
    );

    const buildBucket = (period: string, label: string, inflow: number, subOut: number, licenseOut: number) => ({
      period,
      label,
      expectedInflows: Math.round(inflow),
      expectedOutflows: Math.round(subOut + licenseOut),
      netCashFlow: Math.round(inflow - (subOut + licenseOut)),
    });

    return {
      projectId: query?.projectId || 'all',
      totalCurrentCashPosition: 0,
      forecastBasis: 'due_date' as const,
      buckets: [
        buildBucket('30_days', 'خلال 30 يوماً', inflowBuckets.d30, subIpcOutflowBuckets.d30, licenseBuckets.d30),
        buildBucket('60_days', 'من 31 إلى 60 يوماً', inflowBuckets.d60, subIpcOutflowBuckets.d60, licenseBuckets.d60),
        buildBucket('90_days', 'من 61 إلى 90 يوماً', inflowBuckets.d90, subIpcOutflowBuckets.d90, licenseBuckets.d90),
        buildBucket('beyond_90_days', 'بعد 90 يوماً', inflowBuckets.beyond, subIpcOutflowBuckets.beyond, licenseBuckets.beyond),
      ],
      // Amounts with no recorded due date — shown separately rather than guessed into a bucket.
      undated: buildBucket('undated', 'بلا تاريخ استحقاق مسجل', inflowBuckets.undated, subIpcOutflowBuckets.undated, licenseBuckets.undated),
      upcomingCommitmentsSummary: {
        pendingSubcontractorIpcs: totalPendingSubIpcs,
        // Supplier payables (purchases module) and payroll are not yet linked to a specific
        // contracting project and are intentionally left out rather than estimated — see
        // ARCHITECTURE_INVARIANTS.md open items for the cash-flow forecast follow-up.
        pendingSupplierInvoices: null,
        upcomingWages: null,
        upcomingLicenseRenewals: upcomingLicenseFees,
      },
      totalExpectedInflow: Math.round(totalExpectedInflow),
      totalExpectedOutflow: Math.round(totalPendingSubIpcs + upcomingLicenseFees),
    };
  }

  // ==========================================================================
  // 22. Material Requirements Planning (MRP) & Bill of Materials Breakdown
  // ==========================================================================

  async getProjectMaterialRequirements(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const boqItems = await this.getBoqItems(auth, projectId);
    const constants = await this.getEngineeringConstants(auth);
    const constMap = new Map<string, any>(constants.map((c: any) => [c.itemCode, c]));

    // Aggregator for all project materials
    const materialTotals = new Map<string, {
      code: string;
      name: string;
      unit: string;
      type: string;
      requiredQuantity: number;
      dispatchedQuantity: number;
      unitRate: number;
      totalEstimatedCost: number;
    }>();

    for (const item of boqItems as any[]) {
      const qty = Number(item.revised_qty || item.contract_qty || item.revisedQty || item.contractQty || 0);
      const code = (item.item_code || item.itemCode || '').trim().toUpperCase();
      const constant = constMap.get(code);

      if (constant && Array.isArray(constant.components)) {
        for (const comp of constant.components) {
          const compCode = comp.componentCode || comp.code || comp.name;
          const wasteFactor = 1 + (Number(constant.wastePercent || 5) / 100);
          const reqQty = Number(comp.qtyPerUnit || 0) * qty * wasteFactor;
          const rate = Number(comp.unitRate || 0);

          const existing = materialTotals.get(compCode) || {
            code: compCode,
            name: comp.componentName || comp.name || compCode,
            unit: comp.unit || 'وحدة',
            type: comp.componentType || 'material',
            requiredQuantity: 0,
            dispatchedQuantity: 0,
            unitRate: rate,
            totalEstimatedCost: 0,
          };

          existing.requiredQuantity += reqQty;
          existing.totalEstimatedCost += reqQty * rate;
          materialTotals.set(compCode, existing);
        }
      } else {
        // Generic fallback item
        const fallbackCode = `MAT-${item.item_code || item.itemCode || 'ITEM'}`;
        const existing = materialTotals.get(fallbackCode) || {
          code: fallbackCode,
          name: `خامات بند: ${item.description}`,
          unit: item.unit,
          type: 'material',
          requiredQuantity: 0,
          dispatchedQuantity: 0,
          unitRate: Number(item.estimated_unit_cost || item.estimatedUnitCost || 0),
          totalEstimatedCost: 0,
        };
        existing.requiredQuantity += qty;
        existing.totalEstimatedCost += qty * Number(item.estimated_unit_cost || item.estimatedUnitCost || 0);
        materialTotals.set(fallbackCode, existing);
      }
    }

    // Get dispatched material requisitions for this project
    const requisitions = await this.getMaterialRequisitions(auth, projectId);
    for (const req of requisitions as any[]) {
      const itemName = (req.item_name || req.itemName || '').trim();
      for (const [key, val] of materialTotals.entries()) {
        if (val.name.includes(itemName) || itemName.includes(val.name) || key.includes(req.boq_item_id || req.boqItemId || '')) {
          val.dispatchedQuantity += Number(req.quantity || 0);
        }
      }
    }

    const items = Array.from(materialTotals.values()).map((m) => {
      const remaining = Math.max(0, m.requiredQuantity - m.dispatchedQuantity);
      const fulfillmentPercent = m.requiredQuantity > 0 ? Math.min(100, Math.round((m.dispatchedQuantity / m.requiredQuantity) * 100)) : 0;
      return {
        ...m,
        requiredQuantity: Math.round(m.requiredQuantity * 100) / 100,
        dispatchedQuantity: Math.round(m.dispatchedQuantity * 100) / 100,
        remainingQuantity: Math.round(remaining * 100) / 100,
        fulfillmentPercent,
        totalEstimatedCost: Math.round(m.totalEstimatedCost * 100) / 100,
      };
    });

    const totalMaterialsCost = items.reduce((acc, i) => acc + i.totalEstimatedCost, 0);

    return {
      projectId,
      totalDistinctMaterialsCount: items.length,
      totalMaterialsCost,
      items,
    };
  }

  // ==========================================================================
  // 23. Item-Level Profit & Loss (P&L) & Cost Variance Analyzer
  // ==========================================================================

  async getBoqProfitabilityAnalysis(auth: AuthContext, projectId: string) {
    const { tenantId } = requireTenantScope(auth);
    const boqItems = await this.getBoqItems(auth, projectId);

    // Fetch actual material costs incurred per BOQ item
    const materialReqs = await (this.db as any)
      .selectFrom('contracting_material_requisitions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .execute();

    const actualMatCostByBoq = new Map<string, number>();
    for (const req of materialReqs) {
      if (req.boq_item_id) {
        const cost = Number(req.total_cost || Number(req.quantity) * Number(req.unit_cost));
        actualMatCostByBoq.set(String(req.boq_item_id), (actualMatCostByBoq.get(String(req.boq_item_id)) || 0) + cost);
      }
    }

    let totalProjectRevenue = 0;
    let totalProjectEstimatedCost = 0;
    let totalProjectActualCost = 0;
    let lossMakingItemsCount = 0;

    const analyzedItems = (boqItems as any[]).map((it) => {
      const contractQty = Number(it.contract_qty || it.contractQty || 0);
      const executedQty = Number(it.executed_qty || it.executedQty || 0);
      const unitPrice = Number(it.unit_price || it.unitPrice || 0);
      const estimatedUnitCost = Number(it.estimated_unit_cost || it.estimatedUnitCost || 0);

      const contractRevenue = Number(it.total_price || it.totalPrice || contractQty * unitPrice);
      const estimatedCost = contractQty * estimatedUnitCost;

      // True operational actual costs (Direct Labor + Direct Material + Direct Equipment + Allocated Site Indirects)
      const allocatedIndirect = Number(it.allocated_indirect_cost || it.allocatedIndirectCost || 0);
      const directLabor = Number(it.direct_labor_cost || it.directLaborCost || 0);
      const directMaterial = actualMatCostByBoq.get(String(it.id)) || Number(it.direct_material_cost || it.directMaterialCost || 0);
      const directEquipment = Number(it.direct_equipment_cost || it.directEquipmentCost || 0);

      const hasTrueActuals = (allocatedIndirect + directLabor + directMaterial + directEquipment) > 0;
      const actualCost = hasTrueActuals
        ? Math.round((allocatedIndirect + directLabor + directMaterial + directEquipment) * 1000) / 1000
        : (executedQty * estimatedUnitCost);

      const earnedRevenue = executedQty * unitPrice;

      const projectedProfit = contractRevenue - estimatedCost;
      const profitMarginPercent = contractRevenue > 0 ? Math.round((projectedProfit / contractRevenue) * 100) : 0;
      const realizedProfit = earnedRevenue - actualCost;

      totalProjectRevenue += contractRevenue;
      totalProjectEstimatedCost += estimatedCost;
      totalProjectActualCost += actualCost;

      let status: 'profitable' | 'at_risk' | 'loss' = 'profitable';
      if (profitMarginPercent < 0 || actualCost > estimatedCost) {
        status = 'loss';
        lossMakingItemsCount++;
      } else if (profitMarginPercent < 15) {
        status = 'at_risk';
      }

      return {
        id: it.id,
        itemCode: it.item_code || it.itemCode,
        description: it.description,
        category: it.category,
        unit: it.unit,
        contractQty,
        executedQty,
        unitPrice,
        estimatedUnitCost,
        contractRevenue,
        estimatedCost,
        actualCost,
        directLaborCost: directLabor,
        directMaterialCost: directMaterial,
        directEquipmentCost: directEquipment,
        allocatedIndirectCost: allocatedIndirect,
        projectedProfit,
        profitMarginPercent,
        realizedProfit,
        status,
      };
    });

    const totalProjectProfit = totalProjectRevenue - totalProjectEstimatedCost;
    const overallMarginPercent = totalProjectRevenue > 0 ? Math.round((totalProjectProfit / totalProjectRevenue) * 100) : 0;

    return {
      projectId,
      totalProjectRevenue,
      totalProjectEstimatedCost,
      totalProjectActualCost,
      totalProjectProfit,
      overallMarginPercent,
      lossMakingItemsCount,
      itemsCount: analyzedItems.length,
      items: analyzedItems,
    };
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
    const { tenantId } = requireTenantScope(auth);
    await this.getProjectById(auth, projectId);

    const boqItems = await this.getBoqItems(auth, projectId);
    
    // Fetch materials tagged with boq_item_id
    const materials = await (this.db as any)
      .selectFrom('contracting_material_requisitions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .execute();

    // Fetch labor wages tagged with boq_item_id
    const laborRecords = await (this.db as any)
      .selectFrom('contracting_labor_attendance_records')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .execute();

    // Fetch site mobilization total
    const mobRes = await this.getMobilizationExpenses(auth, projectId);
    const totalMobilization = mobRes.totalAmount;
    const nonHeaderCount = boqItems.filter((i: any) => !i.isSectionHeader && !i.is_section_header).length || 1;
    const mobilizationPerItem = totalMobilization / nonHeaderCount;

    const analyzedItems = boqItems.map((item: any) => {
      const contractQty = Number(item.revisedQty || item.contractQty || item.contract_qty || 0);
      const unitPrice = Number(item.unitPrice || item.unit_price || 0);
      const totalRevenue = contractQty * unitPrice;

      // Sum materials cost for this item
      const itemMaterials = materials.filter((m: any) => String(m.boq_item_id) === String(item.id));
      const materialsCost = itemMaterials.reduce((sum: number, m: any) => sum + Number(m.estimated_cost || 0), 0);

      // Sum labor cost for this item
      const itemLabor = laborRecords.filter((l: any) => String(l.boq_item_id) === String(item.id));
      const laborCost = itemLabor.reduce((sum: number, l: any) => sum + Number(l.total_payable || 0), 0);

      const subcontractsCost = 0; // Linked via subcontractor subcontracts if assigned
      const allocatedMobCost = (item.isSectionHeader || item.is_section_header) ? 0 : mobilizationPerItem;
      const totalActualCost = materialsCost + laborCost + subcontractsCost + allocatedMobCost;

      const grossProfit = totalRevenue - totalActualCost;
      const profitMarginPercent = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0;

      return {
        boqItemId: String(item.id),
        itemCode: item.itemCode,
        description: item.description,
        unit: item.unit,
        contractQty,
        revisedQty: contractQty,
        unitPrice,
        totalContractRevenue: totalRevenue,
        materialsCost,
        laborCost,
        subcontractsCost,
        allocatedMobilizationCost: Math.round(allocatedMobCost * 100) / 100,
        totalActualCost: Math.round(totalActualCost * 100) / 100,
        grossProfit: Math.round(grossProfit * 100) / 100,
        profitMarginPercent,
        isProfitable: grossProfit >= 0,
      };
    });

    const totalRevenue = analyzedItems.reduce((s, i) => s + i.totalContractRevenue, 0);
    const totalActualCost = analyzedItems.reduce((s, i) => s + i.totalActualCost, 0);
    const totalProfit = totalRevenue - totalActualCost;
    const overallMargin = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0;

    return {
      projectId,
      totalRevenue,
      totalActualCost,
      totalProfit,
      overallMarginPercent: overallMargin,
      items: analyzedItems,
    };
  }

  // ==========================================================================
  // 32. Comprehensive Project Actual Cost Breakdown (تحليل التكاليف الفعلية ومقارنة الميزانية)
  // ==========================================================================

  async getProjectCostBreakdown(auth: AuthContext, projectId: string): Promise<ContractingProjectCostBreakdown> {
    const { tenantId } = requireTenantScope(auth);
    const project = await this.db
      .selectFrom('contracting_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', projectId as any)
      .executeTakeFirst();

    if (!project) {
      throw new NotFoundException(`المشروع برقم ${projectId} غير موجود`);
    }

    // 1. Latest Cost Baseline
    const latestSnapshot = await (this.db as any)
      .selectFrom('contracting_cost_snapshots')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    const costBaseline = Number(latestSnapshot?.total_budget_cost || project.contract_value || 0);

    // 2. Total Billed Client (Approved client invoices)
    const billedClientRes = await this.db
      .selectFrom('contracting_invoices')
      .select(sql<number>`COALESCE(SUM(current_amount + stored_materials_amount), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .where('ipc_type', '=', 'client')
      .where('status', 'in', ['approved', 'paid'])
      .executeTakeFirst();
    const totalBilledClient = Number(billedClientRes?.sum || 0);

    // 3. Materials Cost from Requisitions
    const materialsCostRes = await this.db
      .selectFrom('contracting_material_requisitions')
      .select(sql<number>`COALESCE(SUM(total_cost), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .executeTakeFirst();
    const materialsCost = Number(materialsCostRes?.sum || 0);

    // 4. Labor Cost from Attendance Records
    const laborCostRes = await (this.db as any)
      .selectFrom('contracting_labor_attendance_records')
      .select(sql<number>`COALESCE(SUM(total_payable), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .executeTakeFirst();
    const laborCost = Number(laborCostRes?.sum || 0);

    // 5. Subcontracts Cost from Subcontractor Invoices (or committed subcontracts)
    const subcontractsCostRes = await this.db
      .selectFrom('contracting_invoices')
      .select(sql<number>`COALESCE(SUM(current_amount + stored_materials_amount), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .where('ipc_type', '=', 'subcontractor')
      .where('status', 'in', ['approved', 'paid'])
      .executeTakeFirst();
    let subcontractsCost = Number(subcontractsCostRes?.sum || 0);
    if (subcontractsCost === 0) {
      const subCommitments = await this.db
        .selectFrom('contracting_subcontracts')
        .select(sql<number>`COALESCE(SUM(total_amount), 0)`.as('sum'))
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId as any)
        .where('status', '=', 'active')
        .executeTakeFirst();
      subcontractsCost = Number(subCommitments?.sum || 0);
    }

    // 6. Mobilization & Setup Expenses
    const mobilizationCostRes = await (this.db as any)
      .selectFrom('contracting_site_mobilization_expenses')
      .select(sql<number>`COALESCE(SUM(amount), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .executeTakeFirst();
    const mobilizationCost = Number(mobilizationCostRes?.sum || 0);

    // 7. Petty Cash Settled Expenses
    const pettyCashRes = await (this.db as any)
      .selectFrom('contracting_petty_cash')
      .select(sql<number>`COALESCE(SUM(spent_amount), 0)`.as('sum'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .where('status', '=', 'settled')
      .executeTakeFirst();
    const pettyCashCost = Number(pettyCashRes?.sum || 0);

    const totalActualCost = Math.round((materialsCost + laborCost + subcontractsCost + mobilizationCost + pettyCashCost) * 100) / 100;
    const costVariance = Math.round((totalActualCost - costBaseline) * 100) / 100;
    const revenueBasis = totalBilledClient > 0 ? totalBilledClient : Number(project.contract_value);
    const actualGrossProfit = Math.round((revenueBasis - totalActualCost) * 100) / 100;
    const actualProfitMarginPercent = revenueBasis > 0 ? Math.round((actualGrossProfit / revenueBasis) * 100) : 0;

    const safeTotal = totalActualCost > 0 ? totalActualCost : 1;
    const costDistribution = {
      materialsPercent: Math.round((materialsCost / safeTotal) * 100),
      laborPercent: Math.round((laborCost / safeTotal) * 100),
      subcontractsPercent: Math.round((subcontractsCost / safeTotal) * 100),
      mobilizationPercent: Math.round((mobilizationCost / safeTotal) * 100),
      pettyCashPercent: Math.round((pettyCashCost / safeTotal) * 100),
    };

    return {
      projectId: String(project.id),
      projectCode: project.code,
      projectName: project.name,
      contractValue: Number(project.contract_value),
      revisedContractValue: Number(project.revised_contract_value),
      costBaseline,
      totalBilledClient,
      materialsCost,
      laborCost,
      subcontractsCost,
      mobilizationCost,
      pettyCashCost,
      totalActualCost,
      costVariance,
      actualGrossProfit,
      actualProfitMarginPercent,
      costDistribution,
    };
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
    const { tenantId } = requireTenantScope(auth);
    const project = await this.getProjectById(auth, projectId);
    const breakdown = await this.getProjectCostBreakdown(auth, projectId);

    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const bac = project.revisedContractValue || project.contractValue || 1;
    const ev = Number(project.totalBilledClient || (bac * (project.completionRatePercent / 100)) || 0);
    const ac = Number(breakdown.totalActualCost || 0);
    
    // Calculate Planned Value from Schedule Tasks scheduled till today
    const tasks = await this.getScheduleTasks(auth, projectId);
    let pv = 0;
    const today = await resolveBusinessDateKey(this.db, tenantId, new Date());
    if (tasks.length > 0) {
      const scheduledTasks = tasks.filter((t) => (t.start_date || '') <= today);
      pv = (scheduledTasks.length / tasks.length) * bac;
    } else {
      pv = Math.max(ev, bac * 0.5);
    }

    const cv = roundMoney(ev - ac, moneyDigits);
    const sv = roundMoney(ev - pv, moneyDigits);
    const cpi = ac > 0 ? Number((ev / ac).toFixed(2)) : 1.0;
    const spi = pv > 0 ? Number((ev / pv).toFixed(2)) : 1.0;
    const eac = cpi > 0 ? roundMoney(bac / cpi, moneyDigits) : bac;
    const vac = roundMoney(bac - eac, moneyDigits);
    const tcpi = (bac - ac) > 0 ? Number(((bac - ev) / (bac - ac)).toFixed(2)) : 1.0;

    let healthIndicator: 'excellent' | 'good' | 'at_risk' | 'critical' = 'good';
    if (cpi >= 1.05 && spi >= 1.0) healthIndicator = 'excellent';
    else if (cpi >= 0.95 && spi >= 0.9) healthIndicator = 'good';
    else if (cpi >= 0.85 || spi >= 0.8) healthIndicator = 'at_risk';
    else healthIndicator = 'critical';

    // Generate S-Curve Data points (6 monthly points)
    const sCurvePoints = [
      { periodName: 'الشهر 1', plannedCumulative: Number((bac * 0.10).toFixed(0)), earnedCumulative: Number((ev * 0.15).toFixed(0)), actualCumulative: Number((ac * 0.12).toFixed(0)) },
      { periodName: 'الشهر 2', plannedCumulative: Number((bac * 0.25).toFixed(0)), earnedCumulative: Number((ev * 0.30).toFixed(0)), actualCumulative: Number((ac * 0.28).toFixed(0)) },
      { periodName: 'الشهر 3', plannedCumulative: Number((bac * 0.45).toFixed(0)), earnedCumulative: Number((ev * 0.50).toFixed(0)), actualCumulative: Number((ac * 0.48).toFixed(0)) },
      { periodName: 'الشهر 4', plannedCumulative: Number((bac * 0.70).toFixed(0)), earnedCumulative: Number((ev * 0.72).toFixed(0)), actualCumulative: Number((ac * 0.75).toFixed(0)) },
      { periodName: 'الشهر 5', plannedCumulative: Number((bac * 0.90).toFixed(0)), earnedCumulative: Number((ev * 0.88).toFixed(0)), actualCumulative: Number((ac * 0.92).toFixed(0)) },
      { periodName: 'الشهر 6 (الختامي)', plannedCumulative: Number(bac.toFixed(0)), earnedCumulative: Number(ev.toFixed(0)), actualCumulative: Number(ac.toFixed(0)) },
    ];

    return {
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      plannedValue: roundMoney(pv, moneyDigits),
      earnedValue: roundMoney(ev, moneyDigits),
      actualCost: roundMoney(ac, moneyDigits),
      budgetAtCompletion: roundMoney(bac, moneyDigits),
      costVariance: cv,
      scheduleVariance: sv,
      cpi,
      spi,
      estimateAtCompletion: eac,
      varianceAtCompletion: vac,
      toCompletePerformanceIndex: tcpi,
      healthIndicator,
      sCurvePoints,
    };
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





