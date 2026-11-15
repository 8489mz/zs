import { randomUUID } from 'crypto';
import { Injectable, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException, Inject, Optional } from '@nestjs/common';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../accounting/accounting-tenant-foundation.service';
import { Kysely, sql, Transaction, Selectable, Updateable } from 'kysely';
import { Database, ImportInventoryReceiptTable, ImportShipmentTable, ImportShipmentItemTable } from '../../database/database.types';
import { requireImportNumber } from './import-inventory-cost.engine';
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
import { formatLocalCalendarDay } from '../../common/utils/tenant-timezone.util';
import { addDaysToDayKey } from '../../common/utils/client-date-bounds.util';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { resolveFxRate } from '../accounting/fx-rate-resolution';

import { FeasibilityCalculationResult } from './engines/import-feasibility.engine';
import { resolveSectorPreset } from './data/sector-presets.data';
import {
  calculateDemurrageRisk,
  calculateLateExpenseAllocation,
} from './engines/import-landed-cost.engine';
import { isPaymentMethod } from './engines/import-payment-method.engine';
import { evaluateForm4Gate, FORM4_REQUIRED_THRESHOLD_USD } from './engines/import-form4-gate.engine';
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
      resolveTenantAccount: this.resolveTenantAccount.bind(this),
      verifyAndConsumeApprovalRequest: this.verifyAndConsumeApprovalRequest.bind(this),
      assertForm4GrnGate: this.assertForm4GrnGate.bind(this),
    });
    this.profitReportService = new ImportProfitReportService({
      db,
      eligibleRoleAccountIds: this.eligibleRoleAccountIds.bind(this),
    });
    this.receiptPostingService = new ImportReceiptPostingService({
      db,
      accountingPosting: this.accountingPosting,
      resolveImportReceiptSupplierId: this.resolveImportReceiptSupplierId.bind(this),
      resolveImportProjectCostCenter: this.resolveImportProjectCostCenter.bind(this),
      costLine: this.costLine.bind(this),
      resolveTenantAccount: this.resolveTenantAccount.bind(this),
      lockShipment: this.lockShipment.bind(this),
      verifyAndConsumeApprovalRequest: this.verifyAndConsumeApprovalRequest.bind(this),
      assertShipmentEditable: this.assertShipmentEditable.bind(this),
    });
    this.containerPreordersService = new ImportContainerPreordersService({
      db,
      accountingPosting: this.accountingPosting,
      resolveTenantAccount: this.resolveTenantAccount.bind(this),
      isUniqueViolation: this.isUniqueViolation.bind(this),
    });
    this.containerDepositsService = new ImportContainerDepositsService({
      db,
      accountingPosting: this.accountingPosting,
      resolveTenantAccount: this.resolveTenantAccount.bind(this),
      isUniqueViolation: this.isUniqueViolation.bind(this),
      dateKey: this.dateKey.bind(this),
      eligibleRoleAccountIds: this.eligibleRoleAccountIds.bind(this),
    });
    this.treasuryService = new ImportTreasuryService({
      db,
      accountingPosting: this.accountingPosting,
      resolveTenantAccount: this.resolveTenantAccount.bind(this),
      lockShipment: this.lockShipment.bind(this),
      verifyAndConsumeApprovalRequest: this.verifyAndConsumeApprovalRequest.bind(this),
      applyImportCostRevaluation: this.applyImportCostRevaluation.bind(this),
    });
    this.closureAuditService = new ImportClosureAuditService({
      db,
      generatePeriodProfitReport: this.generatePeriodProfitReport.bind(this),
      verifyAndConsumeApprovalRequest: this.verifyAndConsumeApprovalRequest.bind(this),
      listApprovalRequests: this.listApprovalRequests.bind(this),
    });
    this.commercialService = new ImportCommercialService({
      db,
      generatePeriodProfitReport: this.generatePeriodProfitReport.bind(this),
    });
    this.projectsPartnersService = new ImportProjectsPartnersService({
      db,
      accountingPosting: this.accountingPosting,
      resolveTenantAccount: this.resolveTenantAccount.bind(this),
      verifyAndConsumeApprovalRequest: this.verifyAndConsumeApprovalRequest.bind(this),
      generatePeriodProfitReport: this.generatePeriodProfitReport.bind(this),
    });
    this.foreignTransfersService = new ImportForeignTransfersService({
      db,
      accountingPosting: this.accountingPosting,
      resolveTenantAccount: this.resolveTenantAccount.bind(this),
      verifyAndConsumeApprovalRequest: this.verifyAndConsumeApprovalRequest.bind(this),
    });
    this.costRevaluationService = new ImportCostRevaluationService({
      db,
      accountingPosting: this.accountingPosting,
      resolveImportProjectCostCenter: this.resolveImportProjectCostCenter.bind(this),
      resolveTenantAccount: this.resolveTenantAccount.bind(this),
      lockShipment: this.lockShipment.bind(this),
    });
    this.shipmentsService = new ImportShipmentsService({
      db,
      lockShipment: this.lockShipment.bind(this),
      assertShipmentEditable: this.assertShipmentEditable.bind(this),
      assertForm4ClearanceGate: this.assertForm4ClearanceGate.bind(this),
      calculateLandedCostInTransaction: this.calculateLandedCostInTransaction.bind(this),
      postShipmentToInventory: this.postShipmentToInventory.bind(this),
    });
  }

  private async lockShipment(trx: Transaction<Database>, tenantId: string, shipmentId: string) {
    const shipment = await trx.selectFrom('import_shipments').selectAll()
      .where('tenant_id', '=', tenantId).where('id', '=', shipmentId).forUpdate().executeTakeFirst();
    if (!shipment) throw new NotFoundException('الشحنة غير موجودة');
    const receipt = await trx.selectFrom('import_inventory_receipts').selectAll()
      .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId).executeTakeFirst();
    return { shipment, receipt };
  }

  private assertShipmentEditable(state: Awaited<ReturnType<ImportSalesService['lockShipment']>>) {
    if (state.receipt?.state === 'legacy_review_required' || (!state.receipt && state.shipment.status === 'Arrived')) {
      throw new BadRequestException('الشحنة القديمة تحتاج مراجعة الاستلام وتسوية معتمدة قبل أي تعديل أو إعادة ترحيل');
    }
    if (state.receipt) {
      throw new BadRequestException('تم ترحيل الشحنة للمخزون؛ لا يمكن تعديل الكميات أو التكاليف إلا عبر تسوية معتمدة');
    }
  }

  /**
   * Resolves a real tenant account from Chart of Accounts / Accounting Settings.
   * Eliminates hardcoded account IDs (2110, 1110, 5201, 1130, 5101).
   * Follows the "No Silent Skips" architectural invariant.
   */
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
    preferredAccountId?: number | null
  ): Promise<number> {
    const roleExpectedTypes: Record<string, { type: string; label: string }> = {
      bank: { type: 'asset', label: 'الأصول/النقدية والبنك' },
      payable: { type: 'liability', label: 'الخصوم/الموردين' },
      receivable: { type: 'asset', label: 'الأصول المتداولة/العملاء والمدينون' },
      sales_revenue: { type: 'revenue', label: 'الإيرادات/إيرادات المبيعات' },
      inventory: { type: 'asset', label: 'الأصول/المخزون' },
      cogs: { type: 'expense', label: 'المصروفات/تكلفة المبيعات' },
      forex_loss: { type: 'expense', label: 'المصروفات/خسائر فروق العملة' },
      forex_gain: { type: 'revenue', label: 'الإيرادات/أرباح فروق العملة' },
      broker_advance: { type: 'asset', label: 'الأصول المتداولة/عهد المخلصين الجمركيين' },
      container_deposit: { type: 'asset', label: 'الأصول المتداولة/تأمينات الحاويات المستردة' },
      customer_advance: { type: 'liability', label: 'الخصوم المتداولة/دفعات العملاء المقدمة والعربونات' },
      vat_receivable: { type: 'asset', label: 'الأصول المتداولة/ضريبة القيمة المضافة المستردة' },
      equity: { type: 'equity', label: 'حقوق الملكية/رأس مال الشركاء' },
    };

    const roleInfo = roleExpectedTypes[role];

    const accountIsEligible = (account: any): boolean => {
      if (!account || !account.is_active) return false;
      // INV-IMPORT-SUPPLIER-ATTRIBUTION: the clearing/suspense
      // account is tenant-designated only (accounting_settings
      // .clearing_account_id, no COA-code fallback below) and must
      // be a plain asset/liability account: never a flagged control
      // account and never code 1130/2110, because the partner
      // subledger sync reads every line on a flagged or 1130/2110
      // account and throws on a partner-less line — a clearing
      // line is partner-less by definition, so designating a
      // control account as the clearing account must fail closed
      // here, at resolve time, with a clear message.
      if (role === 'clearing') {
        if (['1130', '2110'].includes(account.code)) return false;
        if (account.is_cash_bank || account.is_inventory || account.is_payable || account.is_receivable) return false;
        return account.account_type === 'asset' || account.account_type === 'liability';
      }
      if (role === 'receivable') {
        if (account.is_cash_bank || account.is_inventory || account.is_payable) return false;
        return account.account_type === 'asset' || account.is_receivable === true;
      }
      if (roleInfo && account.account_type !== roleInfo.type) return false;
      if (role === 'bank' && account.is_cash_bank === false) return false;
      if (role === 'inventory' && account.is_inventory === false) return false;
      if (role === 'payable' && account.is_payable === false) return false;
      
      // Strict Architectural Isolation:
      // customer_advance MUST NOT be a supplier payable account (AP 2110)
      if (role === 'customer_advance') {
        if (account.is_payable === true || account.code === '2110') return false;
      }
      // broker_advance MUST NOT be cash/bank, inventory, or generic current assets
      // INV-IMPORT-BROKER-ADVANCE-ACCOUNT: it must NEVER be the
      // Customers control account either. Live trial phase 2
      // (JE-00015026/JE-00015027) posted a broker custody advance
      // and its settlement through 1130 "العملاء" because the
      // candidate list below started with 1130 and the seeded COA
      // has no 1181/1230 row: the first candidate always won.
      // 1130 is a receivable control account (is_receivable,
      // is_control_account); broker custody is not a customer
      // receivable, and a partner-less broker leg on it pollutes
      // the customer subledger. Reject any receivable account
      // and code 1130 here so even a settings-designated or
      // caller-preferred 1130 fails closed instead of posting.
      if (role === 'broker_advance') {
        if (account.is_cash_bank || account.is_inventory || account.is_payable || account.is_receivable) return false;
        if (['1110', '1120', '1130', '1140', '1100'].includes(account.code)) return false;
      }
      // container_deposit MUST NOT be cash/bank, inventory, or generic current assets
      if (role === 'container_deposit') {
        if (account.is_cash_bank || account.is_inventory || account.is_payable) return false;
        if (['1110', '1120', '1140', '1100'].includes(account.code)) return false;
      }
      return true;
    };

    const accountById = async (id: number) => {
      return await trx
        .selectFrom('accounting_accounts')
        .select(['id', 'account_id', 'code', 'account_type', 'is_active', 'is_cash_bank', 'is_inventory', 'is_payable', 'is_receivable'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst();
    };

    if (preferredAccountId !== undefined && preferredAccountId !== null) {
      const id = Number(preferredAccountId);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new BadRequestException('معرف الحساب المحاسبي يجب أن يكون رقمًا صحيحًا موجبًا.');
      }
      const preferred = await accountById(id);
      if (!preferred) {
        throw new BadRequestException(`الحساب المحاسبي المحدد (${id}) غير موجود في دليل حسابات المنشأة.`);
      }
      if (!accountIsEligible(preferred)) {
        throw new BadRequestException(
          `الحساب المحاسبي المحدد (${id}) غير صالح لدور (${role}) أو معطل. راجع نوع الحساب وعلامة وظيفته المحاسبية.`
        );
      }
      return Number(preferred.id);
    }

    // Fallback 1: Check accounting_settings
    const settings = await trx
      .selectFrom('accounting_settings')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    let settingsAccountId: number | null = null;
    if (settings) {
      if (role === 'cogs') settingsAccountId = settings.cogs_account_id;
      else if (role === 'inventory') settingsAccountId = settings.inventory_account_id;
      else if (role === 'payable') settingsAccountId = settings.supplier_payable_account_id;
      else if (role === 'receivable') settingsAccountId = settings.customer_receivable_account_id;
      else if (role === 'sales_revenue') settingsAccountId = settings.sales_revenue_account_id;
      else if (role === 'clearing') settingsAccountId = (settings as any).clearing_account_id;
      else if (role === 'bank') settingsAccountId = settings.bank_account_id || settings.cash_account_id;
    }

    if (settingsAccountId && Number(settingsAccountId) > 0) {
      const fromSettings = await accountById(Number(settingsAccountId));
      if (fromSettings && accountIsEligible(fromSettings)) {
        return Number(fromSettings.id);
      }
    }

    // Fallback 2: Check candidate COA codes matching the required specific role
    const candidateCodes: Record<string, string[]> = {
      cogs: ['5110', '5101', '5100'],
      inventory: ['1140', '1141', '1200'],
      payable: ['2110'],
      receivable: ['1131', '1125', '1130', '2130'],
      sales_revenue: ['4110', '4100', '4000', '4201'],
      bank: ['1120', '1110'],
      forex_loss: ['5201', '5190'],
      forex_gain: ['4201', '4190'],
      // INV-IMPORT-BROKER-ADVANCE-ACCOUNT: 1130 (Customers) was
      // the first candidate here and always won on a seeded COA,
      // which has no 1181/1230 row — so every broker advance
      // posted Dr 1130 (live JE-00015026/JE-00015027). The broker
      // advance belongs to its own dedicated advance account:
      // 1181 "عهد المخلصين الجمركيين" when the tenant created
      // it, else 1230. With neither present the resolver fails
      // closed with a clear message instead of silently posting
      // a broker advance to the Customers ledger.
      broker_advance: ['1181', '1230'],
      container_deposit: ['1180', '1182', '1240'],
      customer_advance: ['2130', '2120'],
      vat_receivable: ['1160', '1150'],
      // Clearing has NO code fallback: a suspense account is
      // designated explicitly in settings, never guessed from a
      // COA code (INV-IMPORT-SUPPLIER-ATTRIBUTION).
      clearing: [],
      equity: ['3100', '3101', '3200', '3000'],
    };

    const codes = candidateCodes[role] || [];
    for (const code of codes) {
      const byCode = await trx
        .selectFrom('accounting_accounts')
        .select(['id', 'account_id', 'code', 'account_type', 'is_active', 'is_cash_bank', 'is_inventory', 'is_payable', 'is_receivable'])
        .where('tenant_id', '=', tenantId)
        .where('code', '=', code)
        .executeTakeFirst();
      if (byCode && accountIsEligible(byCode)) {
        return Number(byCode.id);
      }
    }

    // Strict Architectural Policy: Zero arbitrary fallbacks by account_type to prevent account contamination.
    // If no explicit matching account exists in settings or candidate codes, fail loudly.
    throw new UnprocessableEntityException(
      `تعذر تحديد حساب محاسبي نشط ومصنف لدور (${role}) في دليل الحسابات. يرجى تهيئة وتفعيل الحساب المناسب في شجرة الحسابات أو إعدادات المحاسبة أولاً.`
    );
  }

  /**
   * INV-IMPORT-RECEIPT-SUPPLIER-FAIL-CLOSED: the supplier credited by
   * an import receipt / late-expense journal is the shipment supplier,
   * else the linked project's feasibility supplier. There is no
   * fallback to the tenant's first supplier and no auto-created
   * generic supplier: crediting the wrong subledger silently
   * misstates supplier balances. The resolved id is validated to
   * belong to this tenant's suppliers. Callers must resolve BEFORE
   * any stock or journal write.
   */
  private async resolveImportReceiptSupplierId(
    trx: any,
    tenantId: string,
    shipment: any,
  ): Promise<number> {
    const candidates: number[] = [];
    if (shipment?.supplier_id) candidates.push(Number(shipment.supplier_id));
    if (shipment?.project_id) {
      const proj = await trx
        .selectFrom('import_projects')
        .select('feasibility_data')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', shipment.project_id)
        .executeTakeFirst();
      const f = typeof proj?.feasibility_data === 'string' ? JSON.parse(proj.feasibility_data) : (proj?.feasibility_data || {});
      if (f?.supplierId) candidates.push(Number(f.supplierId));
    }
    for (const candidate of candidates) {
      if (!Number.isSafeInteger(candidate) || candidate <= 0) continue;
      const supplier = await trx
        .selectFrom('suppliers')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', candidate)
        .executeTakeFirst();
      if (supplier) return Number(supplier.id);
    }
    throw new BadRequestException(
      'لا يمكن ترحيل قيد استلام أو مصروف متأخر بلا مورد محدد: حدد مورد الشحنة أو مورد دراسة جدوى المشروع قبل الترحيل. [IMPORT_RECEIPT_SUPPLIER_REQUIRED]',
    );
  }

  /**
   * INV-IMPORT-RECEIPT-JE-SUPPLIER-SUBACCOUNT: resolve the import
   * project's cost centre for the receipt journal, following the
   * contracting canonical pattern (resolve-or-create by code
   * CC-<project code>, dimension 'project'). The receipt journal
   * used to post every line with a NULL cost centre, so the JE
   * screen showed '-' and the project attribution lived nowhere
   * on the journal itself. A shipment with no project has no
   * project cost centre (NULL, honest); a project_id pointing at
   * a missing project row fails closed instead of posting an
   * unattributed journal. The concurrent-create race is absorbed
   * by the (tenant_id, code) unique key: a do-nothing conflict
   * re-reads the row the other transaction inserted.
   */
  private async resolveImportProjectCostCenter(
    trx: any,
    tenantId: string,
    shipment: any,
  ): Promise<number | null> {
    const projectId = shipment?.project_id;
    if (!projectId) return null;
    const project = await trx
      .selectFrom('import_projects')
      .select(['project_no', 'title', 'allocated_capital'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!project?.project_no) {
      throw new BadRequestException(
        'لا يمكن ترحيل قيد استلام شحنة مشروعها غير موجود في هذه المنشأة؛ راجع مشروع الشحنة قبل الترحيل. [IMPORT_RECEIPT_PROJECT_NOT_FOUND]',
      );
    }
    const code = `CC-${project.project_no}`;
    const existing = await trx
      .selectFrom('cost_centers')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (existing) return Number(existing.id);
    const inserted = await trx
      .insertInto('cost_centers')
      .values({
        tenant_id: tenantId,
        code,
        name: `مشروع: ${project.title || project.project_no}`,
        dimension: 'project',
        budget_amount: Number(project.allocated_capital || 0),
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['tenant_id', 'code']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted) return Number(inserted.id);
    const raced = await trx
      .selectFrom('cost_centers')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (raced) return Number(raced.id);
    throw new BadRequestException(
      'تعذر تحديد مركز تكلفة مشروع الاستلام؛ أعد المحاولة. [IMPORT_RECEIPT_COST_CENTER_UNRESOLVED]',
    );
  }

  /**
   * Helper to verify and consume a Maker-Checker approval request for sensitive actions
   */
  private async verifyAndConsumeApprovalRequest(
    trx: any,
    tenantId: string,
    actionType: string,
    referenceId: string,
    approvalRequestId?: string,
    expectedDetails?: { amount?: number; projectId?: string; partnerId?: string; currency?: string; proformaInvoiceId?: string; supplierId?: string; paymentMethod?: string; shipmentId?: string; receiptId?: string; brokerExpenseId?: string; tripId?: string }
  ): Promise<void> {
    if (!approvalRequestId) return;

    const req = await trx
      .selectFrom('import_approval_requests')
      .selectAll()
      .where('id', '=', approvalRequestId)
      .where('tenant_id', '=', tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!req) {
      throw new BadRequestException('طلب الاعتماد (Maker-Checker) المحدد غير موجود.');
    }

    if (req.action_type !== actionType) {
      throw new BadRequestException(
        `نوع طلب الاعتماد (${req.action_type}) لا يطابق الإجراء المطلوب (${actionType}).`
      );
    }

    if (req.status === 'executed') {
      throw new BadRequestException('طلب الاعتماد تم استهلاكه وتنفيذه مسبقاً ولا يمكن استخدامه مجدداً (Single-Use Token).');
    }

    if (req.status !== 'approved') {
      throw new BadRequestException(
        `طلب الاعتماد غير مؤهل للتنفيذ، حالته الحالية (${req.status}) وليست معتمدة (approved).`
      );
    }

    if (referenceId && req.reference_id && req.reference_id !== referenceId) {
      throw new BadRequestException(
        `طلب الاعتماد مرتبط بمرجع (${req.reference_id}) يختلف عن المعرف المطلوب (${referenceId}).`
      );
    }

    if (expectedDetails && !req.request_payload) throw new BadRequestException('بيانات الموافقة التفصيلية إلزامية.');
    if (req.request_payload) {
      const payload = typeof req.request_payload === 'string'
        ? JSON.parse(req.request_payload || '{}')
        : req.request_payload;

      if (expectedDetails?.partnerId && payload.partnerId !== expectedDetails.partnerId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص للشريك (${payload.partnerId}) ولا يطابق الشريك المطلوب (${expectedDetails.partnerId}).`
        );
      }

      if (expectedDetails?.projectId && payload.projectId !== expectedDetails.projectId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص للمشروع (${payload.projectId}) ولا يطابق المشروع (${expectedDetails.projectId}).`
        );
      }

      // Supplier binding: compare as strings — the payload may
      // carry the supplier id as a number (trip-expense
      // approvals) while the caller passes a string, and the
      // binding must mean "the same supplier", not "the same
      // JSON type" (INV-IMPORT-FX-TRIPS-POSTING).
      if (expectedDetails?.supplierId && String(payload.supplierId ?? '') !== String(expectedDetails.supplierId)) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص للمورد (${payload.supplierId}) ولا يطابق المورد المطلوب (${expectedDetails.supplierId}).`
        );
      }

      // Receipt binding (INV-IMPORT-RECEIPT-REVERSAL): a reversal
      // or legacy-review approval authorizes exactly one shipment
      // and one receipt. The reference_id already binds the
      // shipment; these payload checks bind the receipt and
      // reject a token minted for a different document.
      if (expectedDetails?.shipmentId && payload.shipmentId !== expectedDetails.shipmentId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص للشحنة (${payload.shipmentId}) ولا يطابق الشحنة المطلوبة (${expectedDetails.shipmentId}).`
        );
      }
      if (expectedDetails?.receiptId && String(payload.receiptId ?? '') !== expectedDetails.receiptId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص لسند استلام (${payload.receiptId}) ولا يطابق سند الاستلام المطلوب (${expectedDetails.receiptId}).`
        );
      }

      // Broker-expense binding (INV-IMPORT-BROKER-CAPITALISATION): a
      // verification approval authorizes exactly one broker
      // expense. The reference_id already binds the expense id;
      // this payload check binds the expense id carried in the
      // payload too, so a token minted for another receipt cannot
      // verify this one.
      if (expectedDetails?.brokerExpenseId && String(payload.brokerExpenseId ?? '') !== expectedDetails.brokerExpenseId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص لمصروف مخلص (${payload.brokerExpenseId}) ولا يطابق المصروف المطلوب (${expectedDetails.brokerExpenseId}).`
        );
      }

      // Sourcing-trip binding (INV-IMPORT-FX-TRIPS-POSTING): a
      // trip-expense approval authorizes exactly one trip. The
      // reference_id already binds the trip id; this payload
      // check binds the trip id carried in the payload too.
      if (expectedDetails?.tripId && String(payload.tripId ?? '') !== expectedDetails.tripId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص لرحلة توريد (${payload.tripId}) ولا يطابق الرحلة المطلوبة (${expectedDetails.tripId}).`
        );
      }

      if (expectedDetails?.currency && String(payload.currency || '').toUpperCase() !== expectedDetails.currency) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص لعملة (${payload.currency}) ولا يطابق عملة الحوالة المطلوبة (${expectedDetails.currency}).`
        );
      }

      if (expectedDetails?.proformaInvoiceId && payload.proformaInvoiceId !== expectedDetails.proformaInvoiceId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص للفاتورة المبدئية (${payload.proformaInvoiceId}) ولا يطابق الفاتورة المطلوبة (${expectedDetails.proformaInvoiceId}).`
        );
      }

      // Payment-method binding (INV-IMPORT-PAYMENT-METHODS): an
      // approval that names a payment method authorizes only that
      // method, exactly like the currency binding above. An
      // approval with no method in its payload cannot authorize a
      // method-bound transfer: the approver never saw the method.
      if (expectedDetails?.paymentMethod && payload.paymentMethod !== expectedDetails.paymentMethod) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص لطريقة دفع (${payload.paymentMethod}) ولا يطابق طريقة الدفع المطلوبة (${expectedDetails.paymentMethod}).`
        );
      }

      if (expectedDetails?.amount !== undefined) {
        if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) throw new BadRequestException('الموافقة لا تحتوي على سقف مبلغ صالح.');
        const approvedAmount = Number(payload.amount);
        if (expectedDetails.amount > approvedAmount + 0.01) {
          throw new BadRequestException(
            `مبلغ الصرف المطلوب (${expectedDetails.amount.toFixed(2)}) يتجاوز سقف المبلغ المعتمد في طلب الموافقة (${approvedAmount.toFixed(2)}).`
          );
        }
      }
    }

    // Mark as executed so it cannot be replayed or reused
    await trx
      .updateTable('import_approval_requests')
      .set({
        status: 'executed',
        decided_at: new Date(),
      })
      .where('id', '=', approvalRequestId)
      .where('tenant_id', '=', tenantId)
      .execute();
  }

  private costLine(item: Selectable<ImportShipmentItemTable>) {
    return {
      id: item.id, productId: Number(item.product_id), quantity: Number(item.quantity),
      receivedQuantity: Number(item.received_quantity ?? item.quantity),
      factoryUnitPriceUsd: Number(item.factory_unit_price_usd),
      shortageHandlingMethod: item.shortage_handling_method ?? 'capitalize',
    };
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
    note: string
  ): Promise<number> {
    return this.projectsPartnersService.postPartnerCapitalMovement(trx, tenantId, userId, partnerName, partnerId, type, amount, movementDate, requestedCashAccountId, note);
  }

  async getPartners(tenantId: string) {
    return this.projectsPartnersService.getPartners(tenantId);
  }

  async createPartner(tenantId: string, userId: number, name: string, percentage: number, capitalAmount: number = 0, accountId?: string) {
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

  async verifySupplierBankDetails(
    tenantId: string,
    userId: number,
    supplierId: string,
    verificationNotes?: string
  ) {
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

  /**
   * Form 4 gate on the GRN (receiving) approval path
   * (INV-IMPORT-FORM4-GRN-GATE). Reuses assertForm4ClearanceGate
   * verbatim — same engine, same message, same
   * IMPORT_FORM4_REQUIRED code — so the dialog's already-wired
   * onError path surfaces the named error instead of the success
   * toast. The gate runs on the stored shipment row (B/L value
   * and funding type are read from data, never from caller
   * flags). When no shipment row can be loaded there is no B/L
   * value or funding type to evaluate, so the approval records;
   * the receipt posting itself is still gated at the Arrived
   * transition, which loads the shipment with
   * executeTakeFirstOrThrow. The 42P01 catch covers harnesses
   * without an import_shipments relation; it never skips a
   * gateable shipment, because a shipment row that exists is
   * always gated. Non-receiving stages never reach this method.
   */
  private async assertForm4GrnGate(tenantId: string, shipmentId: string): Promise<void> {
    let shipment: Selectable<ImportShipmentTable> | undefined;
    try {
      shipment = await this.inventoryDb
        .selectFrom('import_shipments')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', shipmentId)
        .executeTakeFirst();
    } catch (err: any) {
      if (err?.code === '42P01') return;
      throw err;
    }
    if (!shipment) return;
    await this.assertForm4ClearanceGate(this.inventoryDb, tenantId, shipment);
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
    overrides?: { overrideDutyRatePercent?: number; overrideVatRatePercent?: number }
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

  /**
   * Form 4 clearance gate (INV-IMPORT-FORM4-CLEARANCE-GATE).
   * Caller holds the shipment lock and runs inside the costs
   * transaction; the shipment row already reflects this call's
   * Form 4 fields. The GRN caller (assertForm4GrnGate) passes
   * the plain db handle instead: an unlocked read is safe there
   * because a concurrent Form 4 write can only satisfy the gate,
   * and the receipt posting re-evaluates it under the lock. B/L value is the sum of item quantity x
   * factory unit price in USD. Funding is attributed through
   * project-linked proforma invoices only: an unlinked transfer
   * cannot be attributed to a shipment, so it neither triggers
   * nor satisfies the gate (recorded scoping, same attribution
   * limit as the approval binding). Throws before any write
   * outside this transaction commits.
   *
   * SUPERSEDED SCOPING (I1-P4, trial 2026-11-09 problem 4):
   * the engine's "no funding recorded → gate does not apply"
   * branch NO LONGER exempts a shipment. Every shipment now
   * carries funding_type (migration 2040000000303, default
   * bank_transfer), and it is ALWAYS fed to the engine as a
   * funding method — alongside any transfer methods — so a
   * bank-default shipment above the threshold is gated even
   * with zero supplier_payments rows (the trial defect:
   * MSCU-TEST-002, $2,500, no funding rows, sailed into
   * "In Customs"). A legacy NULL funding_type reads as
   * bank_transfer (defensive default; the migration backfills
   * existing rows with the default). Any bank-channel method
   * anywhere (shipment or transfer) triggers the gate; only
   * all-cash_carried is exempt.
   */
  private async assertForm4ClearanceGate(executor: Transaction<Database> | Kysely<Database>, tenantId: string, shipment: Selectable<ImportShipmentTable>): Promise<void> {
    const items = await executor.selectFrom('import_shipment_items')
      .select(['quantity', 'factory_unit_price_usd'])
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', shipment.id)
      .execute();
    const shipmentUsdValue = items.reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.factory_unit_price_usd || 0),
      0,
    );
    let funding: Array<{ payment_method: string | null | undefined; form4_number: string | null | undefined }> = [];
    if (shipment.project_id) {
      funding = await executor.selectFrom('supplier_payments')
        .innerJoin('import_proforma_invoices', 'import_proforma_invoices.id', 'supplier_payments.proforma_invoice_id')
        .select([
          'supplier_payments.payment_method as payment_method',
          'supplier_payments.form4_number as form4_number',
        ])
        .where('supplier_payments.tenant_id', '=', tenantId)
        .where('import_proforma_invoices.project_id', '=', shipment.project_id)
        .execute();
    }
    // The shipment's own funding type is always a funding method
    // (see the header): a NULL legacy value means bank_transfer,
    // never "no funding".
    const shipmentFundingType = (shipment as any).funding_type || 'bank_transfer';
    const decision = evaluateForm4Gate({
      shipmentUsdValue,
      fundingMethods: [shipmentFundingType, ...funding.map((f) => f.payment_method)],
      shipmentForm4Number: shipment.form4_number ?? null,
      transferForm4Numbers: funding.map((f) => f.form4_number),
    });
    if (decision.required && !decision.satisfied) {
      throw new BadRequestException(
        `لا يمكن نقل الحاوية (${shipment.container_number}) إلى التخليص الجمركي أو الوصول بلا نموذج 4: شحنة ممولة عبر القنوات البنكية بقيمة ${shipmentUsdValue.toFixed(2)} دولار تتجاوز حد ${FORM4_REQUIRED_THRESHOLD_USD} دولار. سجل رقم نموذج 4 على الشحنة أو على الحوالة الممولة أولاً. [IMPORT_FORM4_REQUIRED]`,
      );
    }
  }

  private async postShipmentToInventory(trx: Transaction<Database>, tenantId: string, shipmentId: string, userId: number, receiptLocationId?: number) {
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
    shipment: Selectable<ImportShipmentTable>
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
      credit: { kind: 'payable'; supplierId: number } | { kind: 'broker_advance'; accountId: number } | { kind: 'clearing'; accountId: number; reason: string };
      /** Attribution recorded on the late-expense event row (INV-IMPORT-SUPPLIER-ATTRIBUTION). */
      supplierId?: number | null;
      unallocableReason?: string | null;
      brokerExpenseId?: string;
    },
  ) {
    return this.costRevaluationService.applyImportCostRevaluation(trx, tenantId, userId, shipment, receipt, opts);
  }

  async processLateShipmentExpense(
    tenantId: string,
    userId: number,
    shipmentId: string,
    dto: ProcessLateExpenseDto
  ) {
    return this.costRevaluationService.processLateShipmentExpense(tenantId, userId, shipmentId, dto);
  }

  /**
   * The set of accounts a READ may attribute to a role: the same
   * acceptance set resolveTenantAccount enforces on posting
   * paths (accounting_settings override, else the candidate COA
   * codes, active, correctly typed and flagged). A read sums
   * over the whole set instead of resolving one id: a missing
   * role account then yields an empty set and a zero component
   * instead of breaking the report — posting paths still fail
   * closed through resolveTenantAccount itself, and a posted
   * line can only sit on an account the posting resolver
   * accepted, so the set can never undercount the ledger.
   */
  private async eligibleRoleAccountIds(
    qb: any,
    tenantId: string,
    role: 'cogs' | 'forex_loss' | 'forex_gain' | 'inventory',
  ): Promise<number[]> {
    const roleSpec: Record<string, { type: string; codes: string[]; settingsKey?: string; requireInventoryFlag?: boolean }> = {
      cogs: { type: 'expense', codes: ['5110', '5101', '5100'], settingsKey: 'cogs_account_id' },
      forex_loss: { type: 'expense', codes: ['5201', '5190'] },
      forex_gain: { type: 'revenue', codes: ['4201', '4190'] },
      inventory: { type: 'asset', codes: ['1140', '1141', '1200'], settingsKey: 'inventory_account_id', requireInventoryFlag: true },
    };
    const spec = roleSpec[role];
    let settingsId: number | null = null;
    if (spec.settingsKey) {
      const settings: any = await qb
        .selectFrom('accounting_settings')
        .select(spec.settingsKey as any)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const raw = settings ? Number((settings as any)[spec.settingsKey]) : NaN;
      if (Number.isSafeInteger(raw) && raw > 0) settingsId = raw;
    }
    const rows: any[] = await qb
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .where('account_type', '=', spec.type)
      .$if(spec.requireInventoryFlag === true, (eb: any) => eb.where('is_inventory', '=', true))
      .where((eb: any) =>
        eb.or([
          ...(settingsId !== null ? [eb('id', '=', settingsId)] : []),
          eb('code', 'in', spec.codes),
        ]),
      )
      .execute();
    return rows.map((r) => Number(r.id)).filter((n) => Number.isSafeInteger(n) && n > 0);
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
    startDate: string | Date,
    endDate: string | Date,
    projectId?: string,
    executor?: any
  ) {
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
    treasuryAccountId?: string
  ) {
    return this.projectsPartnersService.recordPartnerPayout(tenantId, userId, partnerId, amount, approvalRequestId, projectId, treasuryAccountId);
  }

  async getPartnerLedger(tenantId: string, partnerId: string) {
    return this.projectsPartnersService.getPartnerLedger(tenantId, partnerId);
  }

  async recordCapitalTransaction(
    tenantId: string,
    userId: number,
    partnerId: string,
    dto: { type: 'DEPOSIT' | 'WITHDRAWAL'; amount: number; date: string; note?: string; accountId?: string; idempotencyKey?: string }
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
    partners: Array<{ partnerId: string; capitalShare?: number; profitPercentage: number }>
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

  // -------------------------------------------------------------
  // CONTAINER SECURITY DEPOSITS & RETURN
  // -------------------------------------------------------------
  // I6-E helpers: a 23505 is a lost race on a uniqueness index, never
  // a raw error to surface; and a DATE value (Date object from the
  // driver or 'yyyy-mm-dd' string) normalises to its calendar key.
  private isUniqueViolation(err: any): boolean {
    return (
      err?.code === '23505' ||
      String(err?.message || '').includes('duplicate key value violates unique constraint')
    );
  }

  private dateKey(value: unknown): string {
    // The stored side is a pg DATE (node-postgres local-midnight
    // Date): it keys from the host-local calendar parts. The UTC
    // slice rendered the previous day on any host east of UTC, so a
    // same-payload retry compared yesterday's stored day against
    // the DTO day and failed closed with a spurious duplicate-key
    // conflict. The DTO side is a date-only string: its UTC-midnight
    // parse slices back to the written day, unchanged.
    if (value instanceof Date) return formatLocalCalendarDay(value);
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toISOString().slice(0, 10);
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
    dto: RecordContainerReturnRefundDto
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
    dto: ConvertPreorderToSaleDto = {}
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

  async listProjectProfitAttribution(tenantId: string, startDate: string | Date, endDate: string | Date) {
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

  async resolveReconciliationException(tenantId: string, userId: number, exceptionId: string, dto: ResolveExceptionDto) {
    return this.closureAuditService.resolveReconciliationException(tenantId, userId, exceptionId, dto);
  }
}
