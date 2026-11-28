import { Injectable, Inject, Optional } from '@nestjs/common';
import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { Kysely, Transaction, Selectable } from 'kysely';
import {
  Database,
  ImportInventoryReceiptTable,
  ImportShipmentTable,
  ImportShipmentItemTable,
} from '../../database/database.types';
import { KYSELY_DB } from '../../database/database.constants';
import {
  CreateShipmentDto,
  UpdateShipmentCostsDto,
  AddShipmentItemDto,
  RecordForeignTransferDto,
  UpdateShipmentItemDto,
  CreateImportProjectDto,
  UpdateImportProjectDto,
  CalculateFeasibilityDto,
  CreateChinaSupplierDto,
  UpsertSupplierMetaDto,
  CreateQcInspectionDto,
  UpsertAciComplianceDto,
  CreateSourcingTripDto,
  PostSourcingTripExpenseDto,
  ProcessLateExpenseDto,
  CreateQuotationDto,
  SelectQuotationDto,
  CreateSampleOrderDto,
  UpdateSampleOrderInspectionDto,
  ConvertFeasibilityToProjectDto,
  CreateProformaInvoiceDto,
  CreateCustomsBrokerDto,
  DisburseBrokerAdvanceDto,
  LiquidateBrokerExpenseDto,
  RecordContainerDepositDto,
  RecordContainerReturnRefundDto,
  CreateContainerPreorderDto,
  ConvertPreorderToSaleDto,
  RefundImportPreorderDto,
  RecordFxAcquisitionDto,
  CreateImportDocumentDto,
  CreateApprovalRequestDto,
  DecideApprovalRequestDto,
  ResolveExceptionDto,
  ReverseImportReceiptDto,
  ResolveLegacyReceiptDto,
  VerifyBrokerExpenseDto,
} from './dto/import-sales.dto';

import { FeasibilityCalculationResult } from './engines/import-feasibility.engine';
import { ImportSourcingService } from './services/import-sourcing.service';
import { ImportProfitReportService } from './services/import-profit-report.service';
import { ImportReceiptPostingService } from './services/import-receipt-posting.service';
import { ImportContainerPreordersService } from './services/import-container-preorders.service';
import { ImportContainerDepositsService } from './services/import-container-deposits.service';
import { ImportTreasuryService } from './services/import-treasury.service';
import { ImportClosureAuditService } from './services/import-closure-audit.service';
import { ImportCommercialService } from './services/import-commercial.service';
import { ImportProjectsPartnersService } from './services/import-projects-partners.service';
import { ImportForeignTransfersService } from './services/import-foreign-transfers.service';
import { ImportCostRevaluationService } from './services/import-cost-revaluation.service';
import { ImportShipmentsService } from './services/import-shipments.service';
import { ImportAccountResolversSlice } from './import-account-resolvers/import-account-resolvers';
import { ImportApprovalGateSlice } from './import-approval-gate/import-approval-gate';
import { ImportReceiptHelpersSlice } from './import-receipt-helpers/import-receipt-helpers';
import { ImportForm4GatesSlice } from './import-form4-gates/import-form4-gates';
import { ImportContainerHelpersSlice } from './import-container-helpers/import-container-helpers';

/**
 * The profit default range is month-start to the tenant today —
 * never the host month (at 01:00 Cairo on Nov 1 the host
 * month-start was Oct 31). It serves both profit default sites
 * in this facade (attribution and the period report). The
 * facade fills only the missing end, so a caller that passes
 * one date keeps it.
 */
export function profitAttributionDefaultRange(todayKey: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayKey)) throw new Error(`Invalid business day key: ${todayKey}`);
  return { start: `${todayKey.slice(0, 8)}01`, end: todayKey };
}

@Injectable()
export class ImportSalesService {
  private readonly inventoryDb: Kysely<Database>;
  private readonly sourcingService: ImportSourcingService;
  private readonly profitReportService: ImportProfitReportService;
  private readonly receiptPostingService: ImportReceiptPostingService;
  private readonly containerPreordersService: ImportContainerPreordersService;
  private readonly containerDepositsService: ImportContainerDepositsService;
  private readonly treasuryService: ImportTreasuryService;
  private readonly closureAuditService: ImportClosureAuditService;
  private readonly commercialService: ImportCommercialService;
  private readonly projectsPartnersService: ImportProjectsPartnersService;
  private readonly foreignTransfersService: ImportForeignTransfersService;
  private readonly costRevaluationService: ImportCostRevaluationService;
  private readonly shipmentsService: ImportShipmentsService;
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<any>,
    @Optional() @Inject(AccountingPostingService) private readonly accountingPosting?: AccountingPostingService,
  ) {
    this.inventoryDb = db;
    this.sourcingService = new ImportSourcingService({
      db,
      accountingPosting: this.accountingPosting,
      resolveTenantAccount: this.accountResolvers.resolveTenantAccount.bind(this.accountResolvers),
      verifyAndConsumeApprovalRequest: this.approvalGate.verifyAndConsumeApprovalRequest.bind(this.approvalGate),
      assertForm4GrnGate: this.form4Gates.assertForm4GrnGate.bind(this.form4Gates),
    });
    this.profitReportService = new ImportProfitReportService({
      db,
      eligibleRoleAccountIds: this.accountResolvers.eligibleRoleAccountIds.bind(this.accountResolvers),
    });
    this.receiptPostingService = new ImportReceiptPostingService({
      db,
      accountingPosting: this.accountingPosting,
      resolveImportReceiptSupplierId: this.receiptHelpers.resolveImportReceiptSupplierId.bind(this.receiptHelpers),
      resolveImportProjectCostCenter: this.receiptHelpers.resolveImportProjectCostCenter.bind(this.receiptHelpers),
      costLine: this.receiptHelpers.costLine.bind(this.receiptHelpers),
      resolveTenantAccount: this.accountResolvers.resolveTenantAccount.bind(this.accountResolvers),
      lockShipment: this.receiptHelpers.lockShipment.bind(this.receiptHelpers),
      verifyAndConsumeApprovalRequest: this.approvalGate.verifyAndConsumeApprovalRequest.bind(this.approvalGate),
      assertShipmentEditable: this.receiptHelpers.assertShipmentEditable.bind(this.receiptHelpers),
    });
    this.containerPreordersService = new ImportContainerPreordersService({
      db,
      accountingPosting: this.accountingPosting,
      resolveTenantAccount: this.accountResolvers.resolveTenantAccount.bind(this.accountResolvers),
      isUniqueViolation: this.containerHelpers.isUniqueViolation.bind(this.containerHelpers),
    });
    this.containerDepositsService = new ImportContainerDepositsService({
      db,
      accountingPosting: this.accountingPosting,
      resolveTenantAccount: this.accountResolvers.resolveTenantAccount.bind(this.accountResolvers),
      isUniqueViolation: this.containerHelpers.isUniqueViolation.bind(this.containerHelpers),
      dateKey: this.containerHelpers.dateKey.bind(this.containerHelpers),
      eligibleRoleAccountIds: this.accountResolvers.eligibleRoleAccountIds.bind(this.accountResolvers),
    });
    this.treasuryService = new ImportTreasuryService({
      db,
      accountingPosting: this.accountingPosting,
      resolveTenantAccount: this.accountResolvers.resolveTenantAccount.bind(this.accountResolvers),
      lockShipment: this.receiptHelpers.lockShipment.bind(this.receiptHelpers),
      verifyAndConsumeApprovalRequest: this.approvalGate.verifyAndConsumeApprovalRequest.bind(this.approvalGate),
      applyImportCostRevaluation: this.applyImportCostRevaluation.bind(this),
    });
    this.closureAuditService = new ImportClosureAuditService({
      db,
      generatePeriodProfitReport: this.generatePeriodProfitReport.bind(this),
      verifyAndConsumeApprovalRequest: this.approvalGate.verifyAndConsumeApprovalRequest.bind(this.approvalGate),
      listApprovalRequests: this.listApprovalRequests.bind(this),
    });
    this.commercialService = new ImportCommercialService({
      db,
      generatePeriodProfitReport: this.generatePeriodProfitReport.bind(this),
    });
    this.projectsPartnersService = new ImportProjectsPartnersService({
      db,
      accountingPosting: this.accountingPosting,
      resolveTenantAccount: this.accountResolvers.resolveTenantAccount.bind(this.accountResolvers),
      verifyAndConsumeApprovalRequest: this.approvalGate.verifyAndConsumeApprovalRequest.bind(this.approvalGate),
      generatePeriodProfitReport: this.generatePeriodProfitReport.bind(this),
    });
    this.foreignTransfersService = new ImportForeignTransfersService({
      db,
      accountingPosting: this.accountingPosting,
      resolveTenantAccount: this.accountResolvers.resolveTenantAccount.bind(this.accountResolvers),
      verifyAndConsumeApprovalRequest: this.approvalGate.verifyAndConsumeApprovalRequest.bind(this.approvalGate),
    });
    this.costRevaluationService = new ImportCostRevaluationService({
      db,
      accountingPosting: this.accountingPosting,
      resolveImportProjectCostCenter: this.receiptHelpers.resolveImportProjectCostCenter.bind(this.receiptHelpers),
      resolveTenantAccount: this.accountResolvers.resolveTenantAccount.bind(this.accountResolvers),
      lockShipment: this.receiptHelpers.lockShipment.bind(this.receiptHelpers),
    });
    this.shipmentsService = new ImportShipmentsService({
      db,
      lockShipment: this.receiptHelpers.lockShipment.bind(this.receiptHelpers),
      assertShipmentEditable: this.receiptHelpers.assertShipmentEditable.bind(this.receiptHelpers),
      assertForm4ClearanceGate: this.form4Gates.assertForm4ClearanceGate.bind(this.form4Gates),
      calculateLandedCostInTransaction: this.calculateLandedCostInTransaction.bind(this),
      postShipmentToInventory: this.postShipmentToInventory.bind(this),
    });
  }

  private accountResolversInstance?: ImportAccountResolversSlice;
  private get accountResolvers(): ImportAccountResolversSlice {
    return (this.accountResolversInstance ??= new ImportAccountResolversSlice());
  }

  private approvalGateInstance?: ImportApprovalGateSlice;
  private get approvalGate(): ImportApprovalGateSlice {
    return (this.approvalGateInstance ??= new ImportApprovalGateSlice());
  }

  private receiptHelpersInstance?: ImportReceiptHelpersSlice;
  private get receiptHelpers(): ImportReceiptHelpersSlice {
    return (this.receiptHelpersInstance ??= new ImportReceiptHelpersSlice());
  }

  private form4GatesInstance?: ImportForm4GatesSlice;
  private get form4Gates(): ImportForm4GatesSlice {
    return (this.form4GatesInstance ??= new ImportForm4GatesSlice(this.db));
  }

  private containerHelpersInstance?: ImportContainerHelpersSlice;
  private get containerHelpers(): ImportContainerHelpersSlice {
    return (this.containerHelpersInstance ??= new ImportContainerHelpersSlice());
  }

  private async lockShipment(trx: Transaction<Database>, tenantId: string, shipmentId: string) {
    return this.receiptHelpers.lockShipment(trx, tenantId, shipmentId);
  }

  private assertShipmentEditable(state: Awaited<ReturnType<ImportSalesService['lockShipment']>>) {
    return this.receiptHelpers.assertShipmentEditable(state);
  }

  private async resolveTenantAccount(
    trx: any,
    tenantId: string,
    role:
      | 'cogs'
      | 'inventory'
      | 'payable'
      | 'receivable'
      | 'sales_revenue'
      | 'bank'
      | 'forex_loss'
      | 'forex_gain'
      | 'broker_advance'
      | 'container_deposit'
      | 'customer_advance'
      | 'vat_receivable'
      | 'clearing'
      | 'equity',
    preferredAccountId?: number | null,
  ): Promise<number> {
    return this.accountResolvers.resolveTenantAccount(trx, tenantId, role, preferredAccountId);
  }

  private async resolveImportReceiptSupplierId(trx: any, tenantId: string, shipment: any): Promise<number> {
    return this.receiptHelpers.resolveImportReceiptSupplierId(trx, tenantId, shipment);
  }

  private async resolveImportProjectCostCenter(trx: any, tenantId: string, shipment: any): Promise<number | null> {
    return this.receiptHelpers.resolveImportProjectCostCenter(trx, tenantId, shipment);
  }

  private async verifyAndConsumeApprovalRequest(
    trx: any,
    tenantId: string,
    actionType: string,
    referenceId: string,
    approvalRequestId?: string,
    expectedDetails?: {
      amount?: number;
      projectId?: string;
      partnerId?: string;
      currency?: string;
      proformaInvoiceId?: string;
      supplierId?: string;
      paymentMethod?: string;
      shipmentId?: string;
      receiptId?: string;
      brokerExpenseId?: string;
      tripId?: string;
    },
  ): Promise<void> {
    return this.approvalGate.verifyAndConsumeApprovalRequest(
      trx,
      tenantId,
      actionType,
      referenceId,
      approvalRequestId,
      expectedDetails,
    );
  }

  private costLine(item: Selectable<ImportShipmentItemTable>) {
    return this.receiptHelpers.costLine(item);
  }

  private async postPartnerCapitalMovement(
    trx: any,
    tenantId: string,
    userId: number,
    partnerName: string,
    partnerId: string,
    type: 'DEPOSIT' | 'WITHDRAWAL',
    amount: number,
    movementDate: Date,
    requestedCashAccountId: string,
    note: string,
  ): Promise<number> {
    return this.projectsPartnersService.postPartnerCapitalMovement(
      trx,
      tenantId,
      userId,
      partnerName,
      partnerId,
      type,
      amount,
      movementDate,
      requestedCashAccountId,
      note,
    );
  }

  async getPartners(tenantId: string) {
    return this.projectsPartnersService.getPartners(tenantId);
  }

  async createPartner(
    tenantId: string,
    userId: number,
    name: string,
    percentage: number,
    capitalAmount: number = 0,
    accountId?: string,
  ) {
    return this.projectsPartnersService.createPartner(tenantId, userId, name, percentage, capitalAmount, accountId);
  }

  async updatePartner(tenantId: string, id: string, name?: string, percentage?: number, capitalAmount?: number) {
    return this.projectsPartnersService.updatePartner(tenantId, id, name, percentage, capitalAmount);
  }

  async deletePartner(tenantId: string, id: string) {
    return this.projectsPartnersService.deletePartner(tenantId, id);
  }

  // ==========================================
  // 2. IMPORT PROJECTS & FEASIBILITY ENGINE
  // ==========================================

  async listProjects(tenantId: string, status?: string) {
    return this.projectsPartnersService.listProjects(tenantId, status);
  }

  async getProjectById(tenantId: string, id: string) {
    return this.projectsPartnersService.getProjectById(tenantId, id);
  }

  async createProject(tenantId: string, dto: CreateImportProjectDto) {
    return this.projectsPartnersService.createProject(tenantId, dto);
  }

  async updateProject(tenantId: string, projectId: string, dto: UpdateImportProjectDto) {
    return this.projectsPartnersService.updateProject(tenantId, projectId, dto);
  }

  calculateFeasibility(dto: CalculateFeasibilityDto): FeasibilityCalculationResult {
    return this.sourcingService.calculateFeasibility(dto);
  }

  // ==========================================
  // 3. CHINA SOURCING & QC INSPECTIONS
  // ==========================================

  async createChinaSupplier(tenantId: string, userId: string | number, dto: CreateChinaSupplierDto) {
    return this.sourcingService.createChinaSupplier(tenantId, userId, dto);
  }

  async listChinaSuppliers(tenantId: string) {
    return this.sourcingService.listChinaSuppliers(tenantId);
  }

  async upsertSupplierImportMeta(tenantId: string, supplierId: string, dto: UpsertSupplierMetaDto) {
    return this.sourcingService.upsertSupplierImportMeta(tenantId, supplierId, dto);
  }

  async verifySupplierBankDetails(tenantId: string, userId: number, supplierId: string, verificationNotes?: string) {
    return this.sourcingService.verifySupplierBankDetails(tenantId, userId, supplierId, verificationNotes);
  }

  async listSourcingTrips(tenantId: string, projectId?: string) {
    return this.sourcingService.listSourcingTrips(tenantId, projectId);
  }

  async createSourcingTrip(tenantId: string, dto: CreateSourcingTripDto) {
    return this.sourcingService.createSourcingTrip(tenantId, dto);
  }

  async postSourcingTripExpense(tenantId: string, userId: number, tripId: string, dto: PostSourcingTripExpenseDto) {
    return this.sourcingService.postSourcingTripExpense(tenantId, userId, tripId, dto);
  }

  async listQcInspections(tenantId: string, projectId?: string, shipmentId?: string) {
    return this.sourcingService.listQcInspections(tenantId, projectId, shipmentId);
  }

  async createQcInspection(tenantId: string, dto: CreateQcInspectionDto) {
    return this.sourcingService.createQcInspection(tenantId, dto);
  }

  private async assertForm4GrnGate(tenantId: string, shipmentId: string): Promise<void> {
    return this.form4Gates.assertForm4GrnGate(tenantId, shipmentId);
  }

  async updateQcInspection(tenantId: string, id: string, dto: Partial<CreateQcInspectionDto>) {
    return this.sourcingService.updateQcInspection(tenantId, id, dto);
  }

  // ==========================================
  // 4. EGYPT COMPLIANCE & ACI / CUSTOMS TARIFFS
  // ==========================================

  async getAciCompliance(tenantId: string, targetId: string) {
    return this.sourcingService.getAciCompliance(tenantId, targetId);
  }

  async upsertAciCompliance(tenantId: string, dto: UpsertAciComplianceDto) {
    return this.sourcingService.upsertAciCompliance(tenantId, dto);
  }

  listTariffSectors() {
    return this.sourcingService.listTariffSectors();
  }

  listSectorPresets() {
    return this.sourcingService.listSectorPresets();
  }

  async syncOfficialTariffs(tenantId: string) {
    return this.sourcingService.syncOfficialTariffs(tenantId);
  }

  async listCustomsTariffs(tenantId: string, search?: string, sector?: string) {
    return this.sourcingService.listCustomsTariffs(tenantId, search, sector);
  }

  async calculateCustomsTax(
    tenantId: string,
    hsCode: string,
    cifValueEgp: number,
    overrides?: { overrideDutyRatePercent?: number; overrideVatRatePercent?: number },
  ) {
    return this.sourcingService.calculateCustomsTax(tenantId, hsCode, cifValueEgp, overrides);
  }

  // ==========================================
  // 5. SHIPMENTS & INVENTORY ATOMIC RECEIPTS
  // ==========================================

  async listShipments(tenantId: string) {
    return this.shipmentsService.listShipments(tenantId);
  }

  async createShipment(tenantId: string, dto: CreateShipmentDto) {
    return this.shipmentsService.createShipment(tenantId, dto);
  }

  async getShipmentById(tenantId: string, id: string) {
    return this.shipmentsService.getShipmentById(tenantId, id);
  }

  async addShipmentItem(tenantId: string, shipmentId: string, dto: AddShipmentItemDto) {
    return this.shipmentsService.addShipmentItem(tenantId, shipmentId, dto);
  }

  async importProjectItemsToShipment(tenantId: string, userId: number, shipmentId: string) {
    return this.shipmentsService.importProjectItemsToShipment(tenantId, userId, shipmentId);
  }

  private async assertCostComponentPayees(
    trx: Transaction<Database>,
    tenantId: string,
    shipmentId: string,
    effective: {
      shippingCostUsd: number;
      customsCostEgp: number;
      internalTransportCostEgp: number;
      actualDemurrageFees: number;
      exchangeRateAtArrival: number | null;
      freightSupplierId: number;
      customsSupplierId: number;
      transportSupplierId: number;
      demurrageSupplierId: number;
      unallocableCostReason: string;
      // INV-IMPORT-LANDED-COST-DUTY-VAT: the itemized tax rates
      // and the CIF insurance. Duty/VAT are rate-derived (CIF x
      // rate), so the payee check keys on the rates, not on a
      // stored amount; insurance rides with the freight payee
      // (the forwarder arranges it), duty/VAT with the customs
      // payee (the broker settles them). No new payee type.
      customsDutyRatePercent: number;
      vatRatePercent: number;
      insuranceCostUsd: number;
    },
  ): Promise<void> {
    return this.shipmentsService.assertCostComponentPayees(trx, tenantId, shipmentId, effective);
  }

  async updateShipmentCosts(tenantId: string, userId: number, shipmentId: string, dto: UpdateShipmentCostsDto) {
    return this.shipmentsService.updateShipmentCosts(tenantId, userId, shipmentId, dto);
  }

  private async assertForm4ClearanceGate(
    executor: Transaction<Database> | Kysely<Database>,
    tenantId: string,
    shipment: Selectable<ImportShipmentTable>,
  ): Promise<void> {
    return this.form4Gates.assertForm4ClearanceGate(executor, tenantId, shipment);
  }

  private async postShipmentToInventory(
    trx: Transaction<Database>,
    tenantId: string,
    shipmentId: string,
    userId: number,
    receiptLocationId?: number,
  ) {
    return this.receiptPostingService.postShipmentToInventory(trx, tenantId, shipmentId, userId, receiptLocationId);
  }

  async reversePostedReceipt(tenantId: string, userId: number, shipmentId: string, dto: ReverseImportReceiptDto) {
    return this.receiptPostingService.reversePostedReceipt(tenantId, userId, shipmentId, dto);
  }

  async resolveLegacyReceipt(tenantId: string, userId: number, shipmentId: string, dto: ResolveLegacyReceiptDto) {
    return this.receiptPostingService.resolveLegacyReceipt(tenantId, userId, shipmentId, dto);
  }

  async calculateLandedCost(tenantId: string, shipmentId: string) {
    return this.shipmentsService.calculateLandedCost(tenantId, shipmentId);
  }

  private async calculateLandedCostInTransaction(
    trx: Transaction<Database>,
    shipment: Selectable<ImportShipmentTable>,
  ) {
    return this.receiptPostingService.calculateLandedCostInTransaction(trx, shipment);
  }

  private async applyImportCostRevaluation(
    trx: Transaction<Database>,
    tenantId: string,
    userId: number,
    shipment: Selectable<ImportShipmentTable>,
    receipt: Selectable<ImportInventoryReceiptTable> | undefined,
    opts: {
      amount: number;
      title: string;
      note?: string | null;
      idempotencyKey?: string;
      accountId?: number | null;
      payableAccountId?: number | null;
      credit:
        | { kind: 'payable'; supplierId: number }
        | { kind: 'broker_advance'; accountId: number }
        | { kind: 'clearing'; accountId: number; reason: string };
      /** Attribution recorded on the late-expense event row (INV-IMPORT-SUPPLIER-ATTRIBUTION). */
      supplierId?: number | null;
      unallocableReason?: string | null;
      brokerExpenseId?: string;
    },
  ) {
    return this.costRevaluationService.applyImportCostRevaluation(trx, tenantId, userId, shipment, receipt, opts);
  }

  async processLateShipmentExpense(tenantId: string, userId: number, shipmentId: string, dto: ProcessLateExpenseDto) {
    return this.costRevaluationService.processLateShipmentExpense(tenantId, userId, shipmentId, dto);
  }

  private async eligibleRoleAccountIds(
    qb: any,
    tenantId: string,
    role: 'cogs' | 'forex_loss' | 'forex_gain' | 'inventory',
  ): Promise<number[]> {
    return this.accountResolvers.eligibleRoleAccountIds(qb, tenantId, role);
  }

  private async sumPostedProjectCostComponents(
    qb: any,
    tenantId: string,
    projectId: string,
    start: Date,
    end: Date,
  ): Promise<{
    shortageExpenseEgp: number;
    brokerExpensedEgp: number;
    fxVarianceEgp: number;
    depositDeductionsEgp: number;
  }> {
    return this.profitReportService.sumPostedProjectCostComponents(qb, tenantId, projectId, start, end);
  }

  async generatePeriodProfitReport(
    tenantId: string,
    startDate?: string | Date,
    endDate?: string | Date,
    projectId?: string,
    executor?: any,
  ) {
    if (!startDate || !endDate) {
      const todayKey = await resolveBusinessDateKey(this.db, tenantId, new Date());
      const range = profitAttributionDefaultRange(todayKey);
      return this.profitReportService.generatePeriodProfitReport(
        tenantId,
        startDate ?? range.start,
        endDate ?? range.end,
        projectId,
        executor,
      );
    }
    return this.profitReportService.generatePeriodProfitReport(tenantId, startDate, endDate, projectId, executor);
  }

  async listForeignTransfers(tenantId: string) {
    return this.foreignTransfersService.listForeignTransfers(tenantId);
  }

  async recordForeignTransfer(tenantId: string, userId: number, dto: RecordForeignTransferDto) {
    return this.foreignTransfersService.recordForeignTransfer(tenantId, userId, dto);
  }

  async recordPartnerPayout(
    tenantId: string,
    userId: number,
    partnerId: string,
    amount: number,
    approvalRequestId?: string,
    projectId?: string,
    treasuryAccountId?: string,
  ) {
    return this.projectsPartnersService.recordPartnerPayout(
      tenantId,
      userId,
      partnerId,
      amount,
      approvalRequestId,
      projectId,
      treasuryAccountId,
    );
  }

  async getPartnerLedger(tenantId: string, partnerId: string) {
    return this.projectsPartnersService.getPartnerLedger(tenantId, partnerId);
  }

  async recordCapitalTransaction(
    tenantId: string,
    userId: number,
    partnerId: string,
    dto: {
      type: 'DEPOSIT' | 'WITHDRAWAL';
      amount: number;
      date: string;
      note?: string;
      accountId?: string;
      idempotencyKey?: string;
    },
  ) {
    return this.projectsPartnersService.recordCapitalTransaction(tenantId, userId, partnerId, dto);
  }

  async updateShipmentItem(tenantId: string, itemId: string, dto: UpdateShipmentItemDto) {
    return this.receiptPostingService.updateShipmentItem(tenantId, itemId, dto);
  }

  async applySuggestedPrices(tenantId: string, shipmentId: string) {
    return this.costRevaluationService.applySuggestedPrices(tenantId, shipmentId);
  }

  async getImportCommandCenterMetrics(tenantId: string) {
    return this.profitReportService.getImportCommandCenterMetrics(tenantId);
  }

  // ==========================================
  // 8. PROJECT PARTNER DISTRIBUTION & CLOSURE
  // ==========================================

  async getProjectPartners(tenantId: string, projectId: string) {
    return this.closureAuditService.getProjectPartners(tenantId, projectId);
  }

  async setProjectPartners(
    tenantId: string,
    projectId: string,
    partners: Array<{ partnerId: string; capitalShare?: number; profitPercentage: number }>,
  ) {
    return this.closureAuditService.setProjectPartners(tenantId, projectId, partners);
  }

  async closeProject(tenantId: string, userId: number, projectId: string, approvalRequestId?: string) {
    return this.closureAuditService.closeProject(tenantId, userId, projectId, approvalRequestId);
  }

  // -------------------------------------------------------------
  // INTERNATIONAL RFQ & QUOTATIONS COMPARISON
  // -------------------------------------------------------------
  async createQuotation(tenantId: string, dto: CreateQuotationDto) {
    return this.commercialService.createQuotation(tenantId, dto);
  }

  async listQuotations(tenantId: string, projectId?: string, supplierId?: string) {
    return this.commercialService.listQuotations(tenantId, projectId, supplierId);
  }

  async selectQuotation(tenantId: string, quotationId: string, dto: SelectQuotationDto) {
    return this.commercialService.selectQuotation(tenantId, quotationId, dto);
  }

  // -------------------------------------------------------------
  // PRODUCT SAMPLES & REFERENCE APPROVAL
  // -------------------------------------------------------------
  async createSampleOrder(tenantId: string, dto: CreateSampleOrderDto) {
    return this.commercialService.createSampleOrder(tenantId, dto);
  }

  async listSampleOrders(tenantId: string, projectId?: string) {
    return this.commercialService.listSampleOrders(tenantId, projectId);
  }

  async updateSampleOrderInspection(tenantId: string, sampleId: string, dto: UpdateSampleOrderInspectionDto) {
    return this.commercialService.updateSampleOrderInspection(tenantId, sampleId, dto);
  }

  // -------------------------------------------------------------
  // FEASIBILITY CONVERSION & PROFORMA / PO LIFECYCLE
  // -------------------------------------------------------------
  async convertFeasibilityToProject(tenantId: string, projectId: string, dto: ConvertFeasibilityToProjectDto) {
    return this.commercialService.convertFeasibilityToProject(tenantId, projectId, dto);
  }

  async getProformaInvoices(tenantId: string, projectId?: string, supplierId?: string) {
    return this.commercialService.getProformaInvoices(tenantId, projectId, supplierId);
  }

  async getProformaById(tenantId: string, id: string) {
    return this.commercialService.getProformaById(tenantId, id);
  }

  async createProformaInvoice(tenantId: string, dto: CreateProformaInvoiceDto) {
    return this.commercialService.createProformaInvoice(tenantId, dto);
  }

  async updateProformaInvoice(tenantId: string, id: string, dto: Partial<CreateProformaInvoiceDto>) {
    return this.commercialService.updateProformaInvoice(tenantId, id, dto);
  }

  async approveProformaInvoice(tenantId: string, userId: number, id: string) {
    return this.commercialService.approveProformaInvoice(tenantId, userId, id);
  }

  async generatePoFromProforma(tenantId: string, userId: number, id: string) {
    return this.commercialService.generatePoFromProforma(tenantId, userId, id);
  }

  // -------------------------------------------------------------
  // CUSTOMS BROKER REGISTRY & ADVANCE LIQUIDATION
  // -------------------------------------------------------------
  async listCustomsBrokers(tenantId: string) {
    return this.treasuryService.listCustomsBrokers(tenantId);
  }

  async createCustomsBroker(tenantId: string, dto: CreateCustomsBrokerDto) {
    return this.treasuryService.createCustomsBroker(tenantId, dto);
  }

  async updateCustomsBroker(tenantId: string, id: string, dto: Partial<CreateCustomsBrokerDto>) {
    return this.treasuryService.updateCustomsBroker(tenantId, id, dto);
  }

  async disburseBrokerAdvance(tenantId: string, userId: number, dto: DisburseBrokerAdvanceDto) {
    return this.treasuryService.disburseBrokerAdvance(tenantId, userId, dto);
  }

  async liquidateBrokerExpenses(tenantId: string, userId: number, dto: LiquidateBrokerExpenseDto) {
    return this.treasuryService.liquidateBrokerExpenses(tenantId, userId, dto);
  }

  async verifyBrokerExpense(tenantId: string, userId: number, expenseId: string, dto: VerifyBrokerExpenseDto) {
    return this.treasuryService.verifyBrokerExpense(tenantId, userId, expenseId, dto);
  }

  async getCustomsBrokerStatement(tenantId: string, brokerId: string) {
    return this.treasuryService.getCustomsBrokerStatement(tenantId, brokerId);
  }

  private isUniqueViolation(err: any): boolean {
    return this.containerHelpers.isUniqueViolation(err);
  }
  private dateKey(value: unknown): string {
    return this.containerHelpers.dateKey(value);
  }

  private async replayContainerDepositOrThrow(
    tenantId: string,
    dto: RecordContainerDepositDto,
    effectiveKey: string,
    originalError: any,
  ): Promise<any> {
    return this.containerDepositsService.replayContainerDepositOrThrow(tenantId, dto, effectiveKey, originalError);
  }

  async recordContainerDeposit(tenantId: string, userId: number, dto: RecordContainerDepositDto) {
    return this.containerDepositsService.recordContainerDeposit(tenantId, userId, dto);
  }

  async recordContainerReturnAndRefund(
    tenantId: string,
    userId: number,
    depositId: string,
    dto: RecordContainerReturnRefundDto,
  ) {
    return this.containerDepositsService.recordContainerReturnAndRefund(tenantId, userId, depositId, dto);
  }

  async listContainerDeposits(tenantId: string, shipmentId?: string) {
    return this.containerDepositsService.listContainerDeposits(tenantId, shipmentId);
  }

  // -------------------------------------------------------------
  // IN-TRANSIT CONTAINER PRE-ORDERS (حجز البضاعة العايمة قبل الوصول)
  // -------------------------------------------------------------
  private async replayContainerPreorderOrThrow(
    tenantId: string,
    dto: CreateContainerPreorderDto,
    effectiveKey: string,
    originalError: any,
  ): Promise<any> {
    return this.containerPreordersService.replayContainerPreorderOrThrow(tenantId, dto, effectiveKey, originalError);
  }

  async createContainerPreorder(tenantId: string, userId: number, dto: CreateContainerPreorderDto) {
    return this.containerPreordersService.createContainerPreorder(tenantId, userId, dto);
  }

  async listContainerPreorders(tenantId: string, shipmentId?: string, customerId?: string) {
    return this.containerPreordersService.listContainerPreorders(tenantId, shipmentId, customerId);
  }

  async refundContainerPreorder(tenantId: string, userId: number, preorderId: string, dto: RefundImportPreorderDto) {
    return this.containerPreordersService.refundContainerPreorder(tenantId, userId, preorderId, dto);
  }

  async cancelContainerPreorder(tenantId: string, preorderId: string, reason?: string) {
    return this.containerPreordersService.cancelContainerPreorder(tenantId, preorderId, reason);
  }

  // -------------------------------------------------------------
  // SINGLE-CONTAINER EXECUTIVE AUTOPSY SHEET (كشف حساب وتشريح الحاوية P&L)
  // -------------------------------------------------------------

  // -------------------------------------------------------------
  // CONVERT CONTAINER PRE-ORDER TO CONFIRMED SALE INVOICE
  // -------------------------------------------------------------
  async convertPreorderToSale(
    tenantId: string,
    userId: number,
    preorderId: string,
    dto: ConvertPreorderToSaleDto = {},
  ) {
    return this.containerPreordersService.convertPreorderToSale(tenantId, userId, preorderId, dto);
  }

  async getContainerAutopsySheet(tenantId: string, shipmentId: string) {
    return this.containerDepositsService.getContainerAutopsySheet(tenantId, shipmentId);
  }

  // -------------------------------------------------------------
  // FX TREASURY DESK
  // -------------------------------------------------------------
  async recordFxAcquisition(tenantId: string, userId: number, dto: RecordFxAcquisitionDto) {
    return this.treasuryService.recordFxAcquisition(tenantId, userId, dto);
  }

  async getFxPortfolio(tenantId: string) {
    return this.treasuryService.getFxPortfolio(tenantId);
  }

  // -------------------------------------------------------------
  // UNIFIED DOCUMENT CENTER
  // -------------------------------------------------------------
  async createImportDocument(tenantId: string, userId: number, dto: CreateImportDocumentDto) {
    return this.commercialService.createImportDocument(tenantId, userId, dto);
  }

  async listImportDocuments(tenantId: string, projectId?: string, shipmentId?: string) {
    return this.commercialService.listImportDocuments(tenantId, projectId, shipmentId);
  }

  // -------------------------------------------------------------
  // MAKER-CHECKER GOVERNANCE WORKFLOW
  // -------------------------------------------------------------
  async createApprovalRequest(tenantId: string, userId: number, dto: CreateApprovalRequestDto) {
    return this.commercialService.createApprovalRequest(tenantId, userId, dto);
  }

  async listApprovalRequests(tenantId: string, status?: string) {
    return this.commercialService.listApprovalRequests(tenantId, status);
  }

  async decideApprovalRequest(tenantId: string, userId: number, requestId: string, dto: DecideApprovalRequestDto) {
    return this.commercialService.decideApprovalRequest(tenantId, userId, requestId, dto);
  }

  // -------------------------------------------------------------
  // IMPORT TRACEABILITY (INV-IMPORT-TRACEABILITY-APPROVALS-POOL)
  // One traceability source of truth: every import event is read
  // from the table that actually stores it — never from a separate
  // counter. The live trials proved the separate counters stay 0:
  // approvals read only import_approval_requests, whose ONLY writer
  // is the manual createApprovalRequest (no flow transition — project
  // create, PI approval, shipment create, receipt posting, supplier
  // payment — ever inserts a row); the reconciliation scan only
  // looks for stale broker advances and overdue deposits, never at
  // receipts; and the profit pool page never passed a projectId, so
  // it could only render the company-wide aggregate. These two read
  // methods derive every row below from the posted state, so a
  // posted receipt (JE-00015025 shape) shows up with its real
  // state in the approvals queue, in the reconciliation tie-out
  // and in the per-project / per-shipment profit attribution.
  // -------------------------------------------------------------
  async listImportFlowEvents(tenantId: string, projectId?: string) {
    return this.closureAuditService.listImportFlowEvents(tenantId, projectId);
  }

  async listProjectProfitAttribution(tenantId: string, startDate?: string | Date, endDate?: string | Date) {
    if (!startDate || !endDate) {
      const todayKey = await resolveBusinessDateKey(this.db, tenantId, new Date());
      const range = profitAttributionDefaultRange(todayKey);
      return this.commercialService.listProjectProfitAttribution(
        tenantId,
        startDate ?? range.start,
        endDate ?? range.end,
      );
    }
    return this.commercialService.listProjectProfitAttribution(tenantId, startDate, endDate);
  }

  // -------------------------------------------------------------
  // RECONCILIATION ENGINE & EXCEPTIONS CENTER
  // -------------------------------------------------------------
  async runImportReconciliationScan(tenantId: string) {
    return this.closureAuditService.runImportReconciliationScan(tenantId);
  }

  async listReconciliationExceptions(tenantId: string, status?: string) {
    return this.closureAuditService.listReconciliationExceptions(tenantId, status);
  }

  async resolveReconciliationException(
    tenantId: string,
    userId: number,
    exceptionId: string,
    dto: ResolveExceptionDto,
  ) {
    return this.closureAuditService.resolveReconciliationException(tenantId, userId, exceptionId, dto);
  }
}
