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
import { allocateSaleFromImportLots, calculateImportSaleCost } from './helpers/import-lot-allocation.helper';
import { applyStockDelta, lockStockProducts } from '../../common/utils/location-stock-ledger';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { formatLocalCalendarDay, getTenantTimezone } from '../../common/utils/tenant-timezone.util';
import { addDaysToDayKey } from '../../common/utils/client-date-bounds.util';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { generateDailySequenceNumber } from '../delivery-reps/services/van-common.util';
import { resolveFxRate } from '../accounting/fx-rate-resolution';

import { FeasibilityCalculationResult } from './engines/import-feasibility.engine';
import { resolveSectorPreset } from './data/sector-presets.data';
import {
  calculateDemurrageRisk,
  calculateLateExpenseAllocation,
} from './engines/import-landed-cost.engine';
import { isPaymentMethod } from './engines/import-payment-method.engine';
import { evaluateForm4Gate, FORM4_REQUIRED_THRESHOLD_USD } from './engines/import-form4-gate.engine';
import { resolveBrokerCapitalizationBucket } from './engines/import-broker-capitalization.engine';
import { resolveImportProjectDisplayStatus } from './engines/import-project-status.engine';
import { ImportSourcingService } from './services/import-sourcing.service';
import { ImportProfitReportService } from './services/import-profit-report.service';
import { ImportReceiptPostingService } from './services/import-receipt-posting.service';
import { ImportForeignTransfersService } from './services/import-foreign-transfers.service';
import { ImportCostRevaluationService } from './services/import-cost-revaluation.service';
import { ImportShipmentsService } from './services/import-shipments.service';

@Injectable()
export class ImportSalesService {
  private readonly inventoryDb: Kysely<Database>;
  private readonly sourcingService: ImportSourcingService;
  private readonly profitReportService: ImportProfitReportService;
  private readonly receiptPostingService: ImportReceiptPostingService;
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
    const cashAccountId = await this.resolveTenantAccount(trx, tenantId, 'bank', Number(requestedCashAccountId));
    const cashAccount = await trx.selectFrom('accounting_accounts')
      .select(['id', 'account_id'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', cashAccountId)
      .executeTakeFirstOrThrow();

    const equityAccountId = await this.resolveTenantAccount(trx, tenantId, 'equity');
    const cashIsDebit = type === 'DEPOSIT';

    const posted = await trx.insertInto('treasury_transactions').values({
      tenant_id: tenantId,
      account_id: cashAccount.account_id,
      txn_type: cashIsDebit ? 'partner_capital_deposit' : 'partner_capital_withdrawal',
      amount: cashIsDebit ? amount : -amount,
      note: `${cashIsDebit ? 'إيداع' : 'سحب'} رأس مال الشريك: ${partnerName}${note ? ' - ' + note : ''} (سجل ${partnerId})`,
      reference_type: 'partner_capital',
      reference_id: null,
      return_document_id: null,
      branch_id: null,
      location_id: null,
      created_by: userId,
    }).returning('id').executeTakeFirstOrThrow();

    const postingService = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
    await postingService.postDomainJournal(trx, {
      sourceType: 'import_partner_capital',
      sourceId: Number(posted.id),
      tenantId,
      accountId: cashAccount.account_id,
      entryDate: movementDate,
      description: `${cashIsDebit ? 'مساهمة' : 'رد'} رأس مال الشريك ${partnerName} (حركة خزينة #${posted.id})`,
      branchId: null,
      locationId: null,
      createdBy: userId,
      postedBy: userId,
      lines: [
        {
          accountId: cashAccountId,
          description: `${cashIsDebit ? 'إيداع نقدي' : 'سحب نقدي'} - رأس مال الشريك ${partnerName}`,
          debit: cashIsDebit ? amount : 0,
          credit: cashIsDebit ? 0 : amount,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        },
        {
          accountId: equityAccountId,
          description: `حساب حقوق الملكية / رأس مال الشريك ${partnerName}`,
          debit: cashIsDebit ? 0 : amount,
          credit: cashIsDebit ? amount : 0,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        },
      ],
    });

    return Number(posted.id);
  }

  async getPartners(tenantId: string) {
    return await this.db
      .selectFrom('import_partners')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('name', 'asc')
      .execute();
  }

  async createPartner(tenantId: string, userId: number, name: string, percentage: number, capitalAmount: number = 0, accountId?: string) {
    if (!name?.trim()) throw new BadRequestException('اسم الشريك مطلوب.');
    const cleanPercentage = Number(percentage);
    const cleanCapital = Number(capitalAmount);
    if (!Number.isFinite(cleanPercentage) || cleanPercentage < 0 || cleanPercentage > 100) {
      throw new BadRequestException('نسبة الشراكة يجب أن تكون بين 0% و100%.');
    }
    if (!Number.isFinite(cleanCapital) || cleanCapital < 0) {
      throw new BadRequestException('رأس المال يجب أن يكون مبلغًا موجبًا أو صفرًا.');
    }
    if (cleanCapital > 0 && !accountId) {
      throw new BadRequestException('يلزم تحديد حساب بنك أو خزينة معتمد لإثبات إيداع رأس مال الشريك.');
    }

    // The global profit_share_percentage on import_partners is a
    // legacy field: distribution reads the per-project pool in
    // import_project_partners, which enforces its own <= 100.001
    // ceiling per project. No global sum is enforced here.
    return await this.db.transaction().execute(async (trx) => {
      const partner = await trx.insertInto('import_partners').values({
        tenant_id: tenantId,
        name: name.trim(),
        profit_share_percentage: cleanPercentage,
        capital_amount: cleanCapital,
        withdrawn_profit: 0,
      }).returningAll().executeTakeFirstOrThrow();

      if (cleanCapital > 0) {
        const ledger = await trx.insertInto('import_partner_ledger').values({
          tenant_id: tenantId,
          partner_id: partner.id,
          type: 'DEPOSIT',
          amount: cleanCapital,
          transaction_date: new Date(),
          note: 'إيداع رأس مال افتتاحي',
          created_by: userId,
          idempotency_key: null,
        }).returning('id').executeTakeFirstOrThrow();

        await this.postPartnerCapitalMovement(
          trx,
          tenantId,
          userId,
          partner.name,
          partner.id,
          'DEPOSIT',
          cleanCapital,
          new Date(),
          accountId!,
          String(ledger.id)
        );
      }

      return partner;
    });
  }

  async updatePartner(tenantId: string, id: string, name?: string, percentage?: number, capitalAmount?: number) {
    if (capitalAmount !== undefined) {
      throw new BadRequestException('لا يمكن تعديل رأس مال الشريك مباشرة بدون حركة إيداع أو سحب دفترية مسجلة.');
    }

    if (percentage !== undefined) {
      const cleanPercentage = Number(percentage);
      if (!Number.isFinite(cleanPercentage) || cleanPercentage < 0 || cleanPercentage > 100) {
        throw new BadRequestException('نسبة الشراكة يجب أن تكون بين 0% و 100%.');
      }
    }

    return await this.db.transaction().execute(async (trx) => {
      if (percentage !== undefined) {
        await trx.selectFrom('tenants').select('id')
          .where('id', '=', tenantId).forUpdate().executeTakeFirstOrThrow();
        const payout = await trx.selectFrom('import_partner_ledger')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('partner_id', '=', id)
          .where('type', '=', 'PROFIT_PAYOUT')
          .executeTakeFirst();
        if (payout) {
          throw new BadRequestException('لا يمكن تعديل نسبة شريك بعد توزيع أرباح فعلية دون نظام نسب تاريخية معتمد.');
        }

      }

      let updateData: any = {};
      if (name !== undefined) updateData.name = name.trim();
      if (percentage !== undefined) updateData.profit_share_percentage = Number(percentage);

      if (Object.keys(updateData).length === 0) return null;

      return await trx
        .updateTable('import_partners')
        .set(updateData)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async deletePartner(tenantId: string, id: string) {
    return await this.db.transaction().execute(async (trx) => {
      // The ledger and project associations are ON DELETE CASCADE in the schema.
      // Relying on an FK violation would silently ERASE financial history.
      const partner = await trx.selectFrom('import_partners').select('id')
        .where('tenant_id', '=', tenantId).where('id', '=', id)
        .forUpdate().executeTakeFirst();
      if (!partner) throw new NotFoundException('الشريك غير موجود.');

      const [ledger, projectLink] = await Promise.all([
        trx.selectFrom('import_partner_ledger').select('id')
          .where('tenant_id', '=', tenantId).where('partner_id', '=', id).executeTakeFirst(),
        trx.selectFrom('import_project_partners').select('id')
          .where('tenant_id', '=', tenantId).where('partner_id', '=', id).executeTakeFirst(),
      ]);
      if (ledger || projectLink) {
        throw new BadRequestException(
          'لا يمكن حذف شريك له سجل رأس مال أو أرباح أو ارتباط بمشروع؛ احتفظ بالتاريخ واستخدم حالة عدم النشاط عند إتاحتها.'
        );
      }
      await trx.deleteFrom('import_partners')
        .where('tenant_id', '=', tenantId).where('id', '=', id).execute();
      return { success: true };
    });
  }

  // ==========================================
  // 2. IMPORT PROJECTS & FEASIBILITY ENGINE
  // ==========================================

  async listProjects(tenantId: string, status?: string) {
    // INV-IMPORT-PROJECT-STATUS-APPROVED: the list never trusts the
    // stored import_projects.status — it is a stale single-writer
    // field (create 'feasibility', convert 'sourcing', close
    // 'closed'; nothing else ever advances it), so projects that
    // ran the real cycle without converting read 'feasibility'
    // forever. The displayed status is derived per project from the
    // authoritative lifecycle evidence (see the engine), and the
    // ?status= filter applies to that DERIVED status, so filtering
    // for 'sourcing' finds an approved-but-unconverted project.
    const projects = await this.db
      .selectFrom('import_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc')
      .execute();

    const shipmentCounts = await this.db
      .selectFrom('import_shipments')
      .select(['project_id', sql<number>`count(*)`.as('shipment_count')])
      .where('tenant_id', '=', tenantId)
      .where('project_id', 'is not', null)
      .groupBy('project_id')
      .execute();

    const countByProject = new Map<string, number>(
      shipmentCounts.map((sc) => [String(sc.project_id), Number(sc.shipment_count)])
    );

    const arrivedShipments = await this.db
      .selectFrom('import_shipments')
      .select('project_id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', 'is not', null)
      .where('status', '=', 'Arrived')
      .groupBy('project_id')
      .execute();

    const arrivedByProject = new Set(arrivedShipments.map((s) => String(s.project_id)));

    const approvedProformas = await this.db
      .selectFrom('import_proforma_invoices')
      .select('project_id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', 'is not', null)
      .where('status', '=', 'approved')
      .groupBy('project_id')
      .execute();

    const approvedProformaByProject = new Set(approvedProformas.map((pi) => String(pi.project_id)));

    const wanted = (status || '').trim().toLowerCase();
    return projects
      .map((p) => ({
        ...p,
        status: resolveImportProjectDisplayStatus(p.status, {
          feasibilityConvertedAt: (p as any).feasibility_converted_at,
          hasApprovedProforma: approvedProformaByProject.has(String(p.id)),
          hasShipment: (countByProject.get(String(p.id)) || 0) > 0,
          hasArrivedShipment: arrivedByProject.has(String(p.id)),
        }),
        shipmentCount: countByProject.get(String(p.id)) || 0,
      }))
      .filter((p) => !wanted || p.status.toLowerCase() === wanted);
  }

  async getProjectById(tenantId: string, id: string) {
    const project = await this.db
      .selectFrom('import_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!project) throw new NotFoundException('مشروع الاستيراد غير موجود.');

    const shipments = await this.db
      .selectFrom('import_shipments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', id)
      .orderBy('created_at', 'desc')
      .execute();

    const qcInspections = await this.db
      .selectFrom('import_qc_inspections')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', id)
      .orderBy('inspection_date', 'desc')
      .execute();

    const sourcingTrips = await this.db
      .selectFrom('import_sourcing_trips')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', id)
      .orderBy('start_date', 'desc')
      .execute();

    const aciRecords = await this.db
      .selectFrom('import_aci_compliance')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', id)
      .execute();

    const partners = await this.db
      .selectFrom('import_project_partners')
      .innerJoin('import_partners', 'import_partners.id', 'import_project_partners.partner_id')
      .select([
        'import_project_partners.id',
        'import_project_partners.partner_id',
        'import_project_partners.capital_share_amount',
        'import_project_partners.profit_percentage',
        'import_partners.name as partner_name',
      ])
      .where('import_project_partners.tenant_id', '=', tenantId)
      .where('import_project_partners.project_id', '=', id)
      .execute();

    // INV-IMPORT-PROJECT-STATUS-APPROVED: the detail view derives
    // the same display status as the list (same engine, same
    // evidence), so a project never reads 'feasibility' here while
    // the list shows 'sourcing' for it.
    const approvedProforma = await this.db
      .selectFrom('import_proforma_invoices')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', id)
      .where('status', '=', 'approved')
      .limit(1)
      .executeTakeFirst();

    return {
      ...project,
      status: resolveImportProjectDisplayStatus(project.status, {
        feasibilityConvertedAt: (project as any).feasibility_converted_at,
        hasApprovedProforma: !!approvedProforma,
        hasShipment: shipments.length > 0,
        hasArrivedShipment: shipments.some((s: any) => s.status === 'Arrived'),
      }),
      shipments,
      qcInspections,
      sourcingTrips,
      aciRecords,
      partners,
    };
  }

  async createProject(tenantId: string, dto: CreateImportProjectDto) {
    return await this.db.transaction().execute(async (trx) => {
      // Collision-proof numbering: an advisory-locked MAX+1 over
      // today's tenant-local numbers, never COUNT(*) + 1, which
      // duplicates under concurrency. An explicitly supplied number
      // is kept (trimmed) and guarded by the unique index on
      // (tenant_id, project_no) added by migration 0279.
      const suppliedNo = dto.projectNo?.trim();
      const projectNo = suppliedNo
        ? suppliedNo
        : await generateDailySequenceNumber(trx, this.db as any, 'import_projects', 'project_no', 'IMP', tenantId);

      // INV-IMPORT-SECTOR-PRESET: the preset is a validated data
      // choice. An unknown key fails closed before any write; a
      // project with no preset stores NULL (generic behaviour).
      const sectorPresetKey = dto.sectorPreset?.trim() || null;
      if (sectorPresetKey && !resolveSectorPreset(sectorPresetKey)) {
        throw new BadRequestException(
          `قطاع الاستيراد المحدد (${sectorPresetKey}) غير معروف؛ اختر قطاعاً من القائمة المعتمدة أو اتركه فارغاً للسلوك العام. [IMPORT_UNKNOWN_SECTOR_PRESET]`,
        );
      }

      let project;
      try {
        project = await trx
          .insertInto('import_projects')
          .values({
            tenant_id: tenantId,
            project_no: projectNo,
            title: dto.title.trim(),
            target_market: dto.targetMarket || 'Egypt',
            country_origin: dto.countryOrigin || 'China',
            country_destination: dto.countryDestination || 'Egypt',
            budget_currency: dto.budgetCurrency || 'USD',
            allocated_capital: dto.allocatedCapital || 0,
            target_roi_percentage: dto.targetRoiPercentage || 25,
            status: dto.status || 'feasibility',
            feasibility_data: dto.feasibilityData ? JSON.stringify(dto.feasibilityData) : '{}',
            notes: dto.notes,
            sector_preset: sectorPresetKey,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err: any) {
        if (err?.code === '23505') {
          throw new ConflictException(
            `رقم المشروع (${projectNo}) مستخدم بالفعل لهذه المنشأة؛ اختر رقماً آخر أو اترك الترقيم التلقائي.`
          );
        }
        throw err;
      }

      if (dto.partners && Array.isArray(dto.partners) && dto.partners.length > 0) {
        // The per-project pool is authoritative: its percentages
        // must each lie in 0..100 and sum to <= 100.001, the same
        // ceiling setProjectPartners enforces.
        let projectPercentageTotal = 0;
        for (const p of dto.partners) {
          const pct = Number(p.profitPercentage || 0);
          if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
            throw new BadRequestException('نسبة ربح الشريك في المشروع يجب أن تكون بين 0% و 100%.');
          }
          projectPercentageTotal += pct;
        }
        if (projectPercentageTotal > 100.001) {
          throw new BadRequestException(`مجموع نسب شركاء المشروع (${projectPercentageTotal}%) يتجاوز 100%.`);
        }
        for (const p of dto.partners) {
          let partnerId = p.partnerId;
          const partnerName = (p as any).name?.trim();

          if (!partnerId && partnerName) {
            const existing = await trx
              .selectFrom('import_partners')
              .select(['id'])
              .where('tenant_id', '=', tenantId)
              .where('name', '=', partnerName)
              .executeTakeFirst();
            if (existing) {
              partnerId = existing.id;
            } else {
              const created = await trx
                .insertInto('import_partners')
                .values({
                  tenant_id: tenantId,
                  name: partnerName,
                  capital_amount: Number(p.capitalShare || 0),
                  profit_share_percentage: Number(p.profitPercentage || 0),
                  withdrawn_profit: 0,
                })
                .returningAll()
                .executeTakeFirstOrThrow();
              partnerId = created.id;
            }
          }

          if (partnerId) {
            // New partner rows start on the tenant-local business day.
            const todayKey = await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date());
            await trx
              .insertInto('import_project_partners')
              .values({
                tenant_id: tenantId,
                project_id: project.id,
                partner_id: partnerId,
                capital_share_amount: Number(p.capitalShare || 0),
                profit_percentage: Number(p.profitPercentage || 0),
                is_active: true,
                effective_from: todayKey,
              })
              .onConflict((oc) =>
                oc.columns(['tenant_id', 'project_id', 'partner_id']).doUpdateSet({
                  capital_share_amount: Number(p.capitalShare || 0),
                  profit_percentage: Number(p.profitPercentage || 0),
                  is_active: true,
                  effective_from: todayKey,
                })
              )
              .execute();
          }
        }
      }

      return project;
    });
  }

  async updateProject(tenantId: string, projectId: string, dto: UpdateImportProjectDto) {
    // INV-IMPORT-PROJECT-PROFORMA-GUARDS: status never moves through
    // the plain PATCH. Lifecycle transitions (close) run only through
    // closeProject with its maker-checker approval and settlement
    // checks; a PATCH-supplied status would bypass all of them.
    if (dto.status !== undefined) {
      throw new BadRequestException(
        'لا يمكن تغيير حالة المشروع من هنا: إغلاق المشروع يتم فقط عبر مسار الإغلاق المعتمد. [IMPORT_PROJECT_STATUS_VIA_CLOSE_ONLY]',
      );
    }
    if (dto.feasibilityData !== undefined) {
      const current = await this.db
        .selectFrom('import_projects')
        .select('status')
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (current?.status === 'closed') {
        throw new BadRequestException(
          'لا يمكن تعديل دراسة جدوى مشروع مغلق: بيانات الدراسة مجمدة بعد الإغلاق. [IMPORT_PROJECT_CLOSED_FEASIBILITY_FROZEN]',
        );
      }
    }
    const payload: any = { updated_at: sql`NOW()` };
    if (dto.title !== undefined) payload.title = dto.title.trim();
    if (dto.targetMarket !== undefined) payload.target_market = dto.targetMarket;
    if (dto.countryOrigin !== undefined) payload.country_origin = dto.countryOrigin;
    if (dto.countryDestination !== undefined) payload.country_destination = dto.countryDestination;
    if (dto.budgetCurrency !== undefined) payload.budget_currency = dto.budgetCurrency;
    if (dto.allocatedCapital !== undefined) payload.allocated_capital = dto.allocatedCapital;
    if (dto.targetRoiPercentage !== undefined) payload.target_roi_percentage = dto.targetRoiPercentage;
    if (dto.feasibilityData !== undefined) payload.feasibility_data = JSON.stringify(dto.feasibilityData);
    if (dto.notes !== undefined) payload.notes = dto.notes;
    if (dto.sectorPreset !== undefined) {
      // INV-IMPORT-SECTOR-PRESET: the preset may change only
      // before any shipment items exist for the project — after
      // that, catalog rows were already created under the old
      // preset's conventions and mixing them would corrupt the
      // catalog. Clearing the preset (null/empty) follows the
      // same guard.
      const nextPresetKey = dto.sectorPreset?.trim() || null;
      if (nextPresetKey && !resolveSectorPreset(nextPresetKey)) {
        throw new BadRequestException(
          `قطاع الاستيراد المحدد (${nextPresetKey}) غير معروف؛ اختر قطاعاً من القائمة المعتمدة أو اتركه فارغاً للسلوك العام. [IMPORT_UNKNOWN_SECTOR_PRESET]`,
        );
      }
      const current = await this.db
        .selectFrom('import_projects')
        .select('sector_preset')
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const currentKey = (current as any)?.sector_preset || null;
      if (currentKey !== nextPresetKey) {
        const hasItems = await this.db
          .selectFrom('import_shipment_items')
          .innerJoin('import_shipments', 'import_shipments.id', 'import_shipment_items.shipment_id')
          .select('import_shipment_items.id')
          .where('import_shipments.tenant_id', '=', tenantId)
          .where('import_shipments.project_id', '=', projectId)
          .limit(1)
          .executeTakeFirst();
        if (hasItems) {
          throw new BadRequestException(
            'لا يمكن تغيير قطاع المشروع بعد استيراد أصنافه إلى الحاويات: الأصناف أُنشئت وفق قواعد القطاع السابق. أنشئ مشروعاً جديداً بالقطاع المطلوب. [IMPORT_SECTOR_PRESET_LOCKED]',
          );
        }
      }
      payload.sector_preset = nextPresetKey;
    }

    return await this.db
      .updateTable('import_projects')
      .set(payload)
      .where('id', '=', projectId)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
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
    const cleanAmount = Number(amount);
    if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
      throw new BadRequestException('مبلغ صرف الأرباح يجب أن يكون أكبر من الصفر.');
    }

    if (!approvalRequestId) {
      throw new BadRequestException('صرف أرباح الشركاء يخضع لحوكمة Maker-Checker الإلزامية ويتطلب معرّف موافقة معتمد (approvalRequestId).');
    }

    return await this.db.transaction().execute(async (trx) => {
      const partner = await trx
        .selectFrom('import_partners')
        .selectAll()
        .where('id', '=', partnerId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // Bind payout to its approved project; never silently choose the first project linked to a partner.
      // INV-IMPORT-TRACEABILITY-APPROVALS-POOL: a UUID that does not
      // exist must fail with the named maker-checker error, not a raw
      // NoResultError — the trial's distribution step demanded an
      // approval UUID with no approval behind it, and the generic
      // failure hid which field was wrong.
      const approved = await trx.selectFrom('import_approval_requests').select('request_payload')
        .where('tenant_id', '=', tenantId).where('id', '=', approvalRequestId).executeTakeFirst();
      if (!approved) {
        throw new BadRequestException('طلب الاعتماد (Maker-Checker) المحدد غير موجود.');
      }
      let approvalDetails: any;
      try {
        approvalDetails = typeof approved.request_payload === 'string'
          ? JSON.parse(approved.request_payload || '{}') : approved.request_payload;
      } catch {
        throw new BadRequestException('تفاصيل الموافقة غير صالحة.');
      }
      const targetProjectId = projectId || String(approvalDetails?.projectId || '');
      if (!targetProjectId) throw new BadRequestException('يجب تحديد مشروع أرباح معتمد.');
      const projectPartner = await trx.selectFrom('import_project_partners').select('project_id')
        .where('tenant_id', '=', tenantId).where('project_id', '=', targetProjectId)
        .where('partner_id', '=', partnerId).where('is_active', '=', true).executeTakeFirst();
      if (!projectPartner) throw new BadRequestException('الشريك غير مرتبط بمشروع الأرباح المعتمد.');

      await this.verifyAndConsumeApprovalRequest(
        trx,
        tenantId,
        'partner_distribution',
        partnerId,
        approvalRequestId,
        { amount: cleanAmount, projectId: targetProjectId, partnerId }
      );

      const profitReport = await this.generatePeriodProfitReport(
        tenantId,
        new Date('2020-01-01'),
        new Date(),
        targetProjectId,
        trx
      );
      if (!profitReport.data.profitAttributionVerified) {
        throw new UnprocessableEntityException(
          'صرف الأرباح موقوف لحين إتمام تتبع مصدر البضاعة واعتماد أرباح كل مشروع؛ التقرير الحالي تقديري وغير صالح للتوزيع.'
        );
      }
      const partnerShare = profitReport.data.partnerShares.find((p: any) => p.partnerId === partnerId);
      const totalEntitled = Number(partnerShare?.shareAmount || 0);
      const allAttributed = await trx.selectFrom('import_partner_project_payouts')
        .select(sql<number>`coalesce(sum(amount_egp), 0)`.as('total'))
        .where('tenant_id', '=', tenantId).where('partner_id', '=', partnerId).executeTakeFirst();
      if (Number(partner.withdrawn_profit || 0) > Number(allAttributed?.total || 0) + 0.01) {
        throw new UnprocessableEntityException('توجد توزيعات تاريخية غير مرتبطة بمشروع؛ يجب تسويتها قبل صرف أرباح إضافية.');
      }
      const withdrawn = Number(partnerShare?.withdrawnProfit || 0);
      const maxAvailable = Math.max(0, totalEntitled - withdrawn);

      if (cleanAmount > maxAvailable) {
        throw new BadRequestException(
          `لا يمكن صرف أرباح تتجاوز المستحق المعتمد للشريك. المتاح للصرف حالياً: ${maxAvailable.toFixed(2)} ج.م (المطلوب: ${cleanAmount.toFixed(2)} ج.م).`
        );
      }

      const bankAccountId = await this.resolveTenantAccount(
        trx,
        tenantId,
        'bank',
        treasuryAccountId ? Number(treasuryAccountId) : null
      );
      const bankScope = await trx
        .selectFrom('accounting_accounts')
        .select(['id', 'account_id', 'code'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bankAccountId)
        .executeTakeFirst();
      const scopeAccountId = bankScope?.account_id || tenantId;

      const equityAccountId = await this.resolveTenantAccount(trx, tenantId, 'equity');

      const postedTreasury = await trx
        .insertInto('treasury_transactions')
        .values({
          tenant_id: tenantId,
          account_id: scopeAccountId,
          txn_type: 'partner_payout',
          amount: -cleanAmount,
          note: `صرف أرباح الشريك: ${partner.name}`,
          reference_type: 'partner_payout',
          reference_id: null,
          created_by: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx.insertInto('import_partner_project_payouts').values({
        tenant_id: tenantId, partner_id: partnerId, project_id: targetProjectId,
        treasury_transaction_id: postedTreasury.id, amount_egp: cleanAmount,
        created_by: userId,
      }).execute();
      await trx
        .updateTable('import_partners')
        .set((eb) => ({
          withdrawn_profit: sql`${eb.ref('withdrawn_profit')} + ${cleanAmount}`,
        }))
        .where('id', '=', partnerId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const ledgerInsert = await trx
        .insertInto('import_partner_ledger')
        .values({
          tenant_id: tenantId,
          partner_id: partnerId,
          type: 'PROFIT_PAYOUT',
          amount: cleanAmount,
          transaction_date: new Date(),
          note: `صرف أرباح الشريك: ${partner.name} (طلب موافقة: ${approvalRequestId})`,
          created_by: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const postingService = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const journalEntryId = await postingService.postDomainJournal(trx, {
        sourceType: 'import_partner_payout',
        sourceId: Number(postedTreasury.id),
        tenantId,
        accountId: scopeAccountId,
        entryDate: new Date(),
        description: `صرف أرباح الشريك ${partner.name} - مشروع ${targetProjectId || 'عام'} (حركة خزينة #${postedTreasury.id})`,
        branchId: null,
        locationId: null,
        createdBy: userId,
        postedBy: userId,
        lines: [
          {
            accountId: equityAccountId,
            description: `توزيعات أرباح الشريك ${partner.name} - تخفيض حقوق الملكية/الأرباح المستحقة`,
            debit: cleanAmount,
            credit: 0,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
          {
            accountId: bankAccountId,
            description: `صرف بنكي/نقدي لأرباح الشريك ${partner.name}`,
            debit: 0,
            credit: cleanAmount,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
        ],
      });

      return {
        success: true,
        ledgerId: ledgerInsert.id,
        journalEntryId,
        treasuryTransactionId: postedTreasury.id,
      };
    });
  }

  async getPartnerLedger(tenantId: string, partnerId: string) {
    return await this.db
      .selectFrom('import_partner_ledger')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('partner_id', '=', partnerId)
      .orderBy('transaction_date', 'desc')
      .orderBy('created_at', 'desc')
      .execute();
  }

  async recordCapitalTransaction(
    tenantId: string,
    userId: number,
    partnerId: string,
    dto: { type: 'DEPOSIT' | 'WITHDRAWAL'; amount: number; date: string; note?: string; accountId?: string; idempotencyKey?: string }
  ) {
    const cleanAmount = Number(dto.amount);
    const movementDate = new Date(dto.date);
    if (dto.type !== 'DEPOSIT' && dto.type !== 'WITHDRAWAL') {
      throw new BadRequestException('نوع حركة رأس المال غير صالح.');
    }
    if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
      throw new BadRequestException('مبلغ حركة رأس المال يجب أن يكون أكبر من الصفر.');
    }
    const requiredCashAccountId = dto.accountId;
    if (!requiredCashAccountId) {
      throw new BadRequestException('تحديد حساب البنك أو الخزينة إلزامي لكل حركة رأس مال فعلية.');
    }
    if (Number.isNaN(movementDate.getTime())) {
      throw new BadRequestException('تاريخ حركة رأس المال غير صالح.');
    }

    return await this.db.transaction().execute(async (trx) => {
      const partner = await trx
        .selectFrom('import_partners')
        .selectAll()
        .where('id', '=', partnerId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (dto.type === 'WITHDRAWAL' && Number(partner.capital_amount || 0) < cleanAmount) {
        throw new BadRequestException(
          `رصيد رأس المال الحالي (${partner.capital_amount}) لا يكفي لسحب مبلغ ${cleanAmount}.`
        );
      }

      // Optional idempotency key (same pattern as the deposit /
      // preorder refund paths): a supplied key is checked before
      // the insert, and the partial unique index serialises
      // concurrent retries. Without a key the call behaves exactly
      // as before.
      const capitalKey = dto.idempotencyKey ? String(dto.idempotencyKey).trim() : '';
      if (capitalKey.length > 128) {
        throw new BadRequestException('مفتاح عدم التكرار لحركة رأس المال يجب ألا يتجاوز 128 حرفاً.');
      }
      if (capitalKey) {
        const previousMovement = await trx
          .selectFrom('import_partner_ledger')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('partner_id', '=', partnerId)
          .where('idempotency_key', '=', capitalKey)
          .executeTakeFirst();
        if (previousMovement) {
          throw new ConflictException('تم تسجيل حركة رأس المال هذه مسبقاً بنفس مفتاح عدم التكرار.');
        }
      }

      let ledgerInsert;
      try {
        ledgerInsert = await trx
          .insertInto('import_partner_ledger')
          .values({
            tenant_id: tenantId,
            partner_id: partnerId,
            type: dto.type,
            amount: cleanAmount,
            transaction_date: dto.date,
            note: dto.note || '',
            created_by: userId,
            idempotency_key: capitalKey || null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
      } catch (err: any) {
        if (err?.code === '23505') {
          throw new ConflictException('تم تسجيل حركة رأس المال هذه مسبقاً بنفس مفتاح عدم التكرار.');
        }
        throw err;
      }

      const sign = dto.type === 'DEPOSIT' ? '+' : '-';
      await trx
        .updateTable('import_partners')
        .set((eb) => ({
          capital_amount: sql`${eb.ref('capital_amount')} ${sql.raw(sign)} ${cleanAmount}`,
        }))
        .where('id', '=', partnerId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const treasuryTransactionId = await this.postPartnerCapitalMovement(
        trx,
        tenantId,
        userId,
        partner.name,
        partner.id,
        dto.type,
        cleanAmount,
        movementDate,
        requiredCashAccountId,
        dto.note || ''
      );

      return { success: true, ledgerId: ledgerInsert.id, treasuryTransactionId };
    });
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
    return await this.db
      .selectFrom('import_project_partners')
      .innerJoin('import_partners', 'import_partners.id', 'import_project_partners.partner_id')
      .select([
        'import_project_partners.id as allocation_id',
        'import_project_partners.partner_id',
        'import_partners.name as partner_name',
        'import_project_partners.capital_share_amount',
        'import_project_partners.profit_percentage',
        'import_project_partners.effective_from',
        'import_project_partners.is_active',
      ])
      .where('import_project_partners.tenant_id', '=', tenantId)
      .where('import_project_partners.project_id', '=', projectId)
      .where('import_project_partners.is_active', '=', true)
      .execute();
  }

  async setProjectPartners(
    tenantId: string,
    projectId: string,
    partners: Array<{ partnerId: string; capitalShare?: number; profitPercentage: number }>
  ) {
    return await this.db.transaction().execute(async (trx) => {
      const project = await trx
        .selectFrom('import_projects')
        .selectAll()
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!project) throw new NotFoundException('مشروع الاستيراد غير موجود.');
      if (project.status === 'closed') {
        throw new BadRequestException('لا يمكن تعديل نسب الشركاء لمشروع مقفل ومسوى مالياً.');
      }

      // Existing single-row partner allocations are not effective-dated history.
      // Freeze edits when financial execution has started to protect prior earnings.
      const postedReceipt = await trx.selectFrom('import_shipments as shipment')
        .innerJoin('import_inventory_receipts as receipt', 'receipt.shipment_id', 'shipment.id')
        .select('shipment.id')
        .where('shipment.project_id', '=', projectId)
        .where('shipment.tenant_id', '=', tenantId)
        .where('receipt.tenant_id', '=', tenantId)
        .where('receipt.state', '=', 'posted')
        .executeTakeFirst();
      const paidProforma = await trx.selectFrom('import_proforma_invoices')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .where('paid_amount_foreign', '>', 0)
        .executeTakeFirst();
      if (postedReceipt || paidProforma) {
        throw new BadRequestException(
          'لا يجوز تعديل نسب المشروع بعد بدء السداد أو الاستلام دون سجل تاريخي لنسب الشراكة.'
        );
      }

      const totalPercentage = partners.reduce((sum, p) => sum + Number(p.profitPercentage || 0), 0);
      if (totalPercentage > 100.001) {
        throw new BadRequestException(`مجموع نسب الشركاء للمشروع (${totalPercentage}%) يتجاوز 100%.`);
      }

      const partnerIds = partners.map((p) => p.partnerId);
      if (partnerIds.length > 0) {
        const validPartners = await trx
          .selectFrom('import_partners')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', 'in', partnerIds)
          .execute();

        if (validPartners.length !== partnerIds.length) {
          throw new BadRequestException('أحد الشركاء المحددين غير مسجل أو ينتمي لمنشأة أخرى.');
        }
      }

      // Delete partners no longer in the project to maintain clean foreign keys
      if (partnerIds.length > 0) {
        await trx
          .deleteFrom('import_project_partners')
          .where('project_id', '=', projectId)
          .where('tenant_id', '=', tenantId)
          .where('partner_id', 'not in', partnerIds)
          .execute();
      } else {
        await trx
          .deleteFrom('import_project_partners')
          .where('project_id', '=', projectId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // Upsert each partner cleanly to prevent duplicate key collision on (tenant_id, project_id, partner_id)
      // New partner rows start on the tenant-local business day.
      const todayKey = await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date());
      for (const p of partners) {
        await trx
          .insertInto('import_project_partners')
          .values({
            tenant_id: tenantId,
            project_id: projectId,
            partner_id: p.partnerId,
            capital_share_amount: Number(p.capitalShare || 0),
            profit_percentage: Number(p.profitPercentage || 0),
            is_active: true,
            effective_from: todayKey,
          })
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'project_id', 'partner_id']).doUpdateSet({
              capital_share_amount: Number(p.capitalShare || 0),
              profit_percentage: Number(p.profitPercentage || 0),
              is_active: true,
              effective_from: todayKey,
            })
          )
          .execute();
      }

      return { success: true, count: partners.length };
    });
  }

  async closeProject(tenantId: string, userId: number, projectId: string, approvalRequestId?: string) {
    if (!approvalRequestId) throw new BadRequestException('إقفال مشروع الاستيراد يتطلب موافقة Maker-Checker معتمدة.');
    return await this.db.transaction().execute(async (trx) => {
      const project = await trx
        .selectFrom('import_projects')
        .selectAll()
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (project.status === 'closed') {
        throw new BadRequestException('المشروع مقفل بالفعل.');
      }
      await this.verifyAndConsumeApprovalRequest(trx, tenantId, 'project_closure', projectId, approvalRequestId);

      const shipments = await trx
        .selectFrom('import_shipments')
        .selectAll()
        .where('project_id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .execute();

      for (const s of shipments) {
        if (s.status !== 'Arrived') {
          throw new BadRequestException(`لا يمكن إقفال المشروع: الحاوية ${s.container_number} ما زالت بالحالة (${s.status}) ولم تصل بعد.`);
        }
        const receipt = await trx
          .selectFrom('import_inventory_receipts')
          .select('state')
          .where('shipment_id', '=', s.id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        if (!receipt || receipt.state !== 'posted') {
          throw new BadRequestException(`لا يمكن إقفال المشروع: الحاوية ${s.container_number} لم يتم ترحيل استلامها المخزني بالكامل.`);
        }
      }

      const proformas = await trx
        .selectFrom('import_proforma_invoices')
        .selectAll()
        .where('project_id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .execute();

      for (const pi of proformas) {
        const isPaid = pi.payment_status === 'paid' && Number(pi.paid_amount_foreign || 0) >= Number(pi.total_amount_foreign || 0);
        if (!isPaid) {
          throw new BadRequestException(
            `لا يمكن إقفال المشروع: الفاتورة المبدئية رقم ${pi.pi_number} للمورد غير مسددة بالكامل (الحالة: ${pi.payment_status}، المسدد: ${pi.paid_amount_foreign || 0} من ${pi.total_amount_foreign || 0}).`
          );
        }
      }

      // Ensure no unsettled purchase invoices linked to this project architecturally
      const projectPurchases = await trx
        .selectFrom('purchases')
        .select(['id', 'doc_no', 'total', 'paid_amount', 'status'])
        .where('tenant_id', '=', tenantId)
        .where('import_project_id', '=', projectId)
        .where('status', '!=', 'cancelled')
        .execute();

      for (const pur of projectPurchases) {
        const paid = Number(pur.paid_amount || 0);
        const total = Number(pur.total || 0);
        if (paid < total - 0.001) {
          throw new BadRequestException(
            `لا يمكن إقفال المشروع: فاتورة الشراء رقم ${pur.doc_no || pur.id} غير مسددة بالكامل للمورد (المتبقي: ${(total - paid).toFixed(2)} ج.م).`
          );
        }
      }

      // Guard: No unliquidated customs broker advances
      const activeAdvances = await trx
        .selectFrom('import_broker_advances')
        .select(['advance_no', 'remaining_amount_egp'])
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .where('remaining_amount_egp', '>', 0)
        .execute();

      if (activeAdvances.length > 0) {
        const first = activeAdvances[0];
        throw new BadRequestException(
          `لا يمكن إقفال المشروع: توجد عهدة مخلص معلقة (إذن رقم ${first.advance_no}) بمبلغ متبقٍ ${Number(first.remaining_amount_egp).toFixed(2)} ج.م يلزم تسويتها أولاً.`
        );
      }

      // Guard: No pending container security deposits
      const pendingDeposits = await trx
        .selectFrom('import_container_deposits')
        .select(['container_no', 'refund_status'])
        .where('tenant_id', '=', tenantId)
        .where((eb) =>
          eb.or([
            eb('project_id', '=', projectId),
            shipments.length > 0 ? eb('shipment_id', 'in', shipments.map((s) => s.id)) : sql`1=0`,
          ])
        )
        .where('refund_status', 'in', ['pending', 'partially_refunded'])
        .execute();

      if (pendingDeposits.length > 0) {
        const first = pendingDeposits[0];
        throw new BadRequestException(
          `لا يمكن إقفال المشروع: يوجد تأمين حاوية معلق (#${first.container_no}) بحالة (${first.refund_status}) يلزم استرداده وتسويته أولاً.`
        );
      }

      // Guard: No unverified broker expenses (INV-IMPORT-BROKER-
      // CAPITALISATION). A project cannot close while a
      // liquidated broker expense still awaits its maker-checker
      // verification: the capitalisation underneath it is
      // attested by one person only.
      const unverifiedExpenses = await trx
        .selectFrom('import_broker_expenses')
        .select(['receipt_no', 'amount_egp'])
        .where('tenant_id', '=', tenantId)
        .where((eb) =>
          eb.or([
            eb('project_id', '=', projectId),
            shipments.length > 0 ? eb('shipment_id', 'in', shipments.map((s) => s.id)) : sql`1=0`,
          ])
        )
        .where('is_verified', '=', false)
        .execute();

      if (unverifiedExpenses.length > 0) {
        const first = unverifiedExpenses[0];
        throw new BadRequestException(
          `لا يمكن إقفال المشروع: يوجد مصروف مخلص غير متحقق منه (إيصال #${first.receipt_no}، ${Number(first.amount_egp).toFixed(2)} ج.م) يلزم التحقق منه بموافقة معتمدة أولاً.`
        );
      }

      const startDate = project.created_at || new Date('2020-01-01');
      const profitReport = await this.generatePeriodProfitReport(tenantId, startDate, new Date(), projectId, trx);

      if (!profitReport.data.profitAttributionVerified) {
        // An unverified report may show zero sales precisely because allocation is missing.
        // Never treat that synthetic zero as safe to close.
        throw new UnprocessableEntityException(
          'لا يمكن إقفال المشروع قبل اعتماد تتبع مصدر المبيعات وكميات المخزون بالكامل.'
        );
      }

      // Guard: No unsold remaining inventory in lots
      const remainingLots = await trx
        .selectFrom('import_inventory_lots')
        .select(['lot_number', 'remaining_quantity'])
        .where('tenant_id', '=', tenantId)
        .where((eb) =>
          eb.or([
            eb('project_id', '=', projectId),
            shipments.length > 0 ? eb('shipment_id', 'in', shipments.map((s) => s.id)) : sql`1=0`,
          ])
        )
        .where('remaining_quantity', '>', 0)
        .execute();

      if (remainingLots.length > 0) {
        const first = remainingLots[0];
        throw new BadRequestException(
          `لا يمكن إقفال المشروع: يوجد رصيد مخزني غير مباع بالباتش (${first.lot_number}) متبقٍ به ${first.remaining_quantity} وحدة يلزم بيعه أو تسويته مخزنيًا قبل الإقفال النهائي.`
        );
      }

      const projectItems = shipments.length > 0
        ? await trx
            .selectFrom('import_shipment_items')
            .select(['product_id', 'quantity', 'received_quantity'])
            .where('tenant_id', '=', tenantId)
            .where('shipment_id', 'in', shipments.map((s) => s.id))
            .execute()
        : [];

      let totalReceived = 0;
      for (const it of projectItems) {
        totalReceived += Number(it.received_quantity ?? it.quantity);
      }

      const closureData = {
        closedAt: new Date().toISOString(),
        closedBy: userId,
        shipmentsCount: shipments.length,
        totalReceivedUnits: totalReceived,
        financialReconciliation: profitReport.data,
        reconciliationStatus: profitReport.data.profitAttributionVerified ? 'verified' : 'pending_source_attribution',
      };

      await trx
        .updateTable('import_projects')
        .set({
          status: 'closed',
          closure_data: closureData as any,
          closure_date: new Date(),
          closed_by: userId,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .execute();

      return {
        success: true,
        message: `تمت تسوية وإقفال مشروع الاستيراد #${project.project_no} بنجاح وحفظ السجل المالي النهائي.`,
        closureData,
      };
    });
  }

  // -------------------------------------------------------------
  // INTERNATIONAL RFQ & QUOTATIONS COMPARISON
  // -------------------------------------------------------------
  async createQuotation(tenantId: string, dto: CreateQuotationDto) {
    // INV-IMPORT-ESTIMATES-HONEST + INV-IMPORT-FX-RESOLVER (F1): the
    // estimate basis is recorded, never silent — and the rate itself
    // is never invented. When the caller supplies no exchange rate,
    // the rate resolves live through resolveFxRate for the quotation
    // currency and fails closed when no rate is registered (no
    // hardcoded 50). The row still carries the exact basis it was
    // computed from (exchange_rate_used, exchange_rate_assumed) so
    // every consumer can label the estimate with what was assumed.
    const rateAssumed = dto.exchangeRate === undefined || dto.exchangeRate === null || Number(dto.exchangeRate) <= 0;
    const customsAssumed = dto.estimatedCustomsRatePercent === undefined || dto.estimatedCustomsRatePercent === null;
    const currency = String(dto.currency || 'USD').trim().toUpperCase() || 'USD';
    const commRate = rateAssumed
      ? await resolveFxRate(this.db, tenantId, currency)
      : await resolveFxRate(this.db, tenantId, currency, { suppliedRate: Number(dto.exchangeRate) });
    const estLanded =
      Number(dto.unitPriceForeign) * commRate +
      Number(dto.estimatedFreightUsd || 0) * commRate +
      Number(dto.unitPriceForeign) * commRate * (Number(dto.estimatedCustomsRatePercent || 5) / 100);

    return await this.db
      .insertInto('import_quotations')
      .values({
        tenant_id: tenantId,
        project_id: dto.projectId ?? null,
        supplier_id: Number(dto.supplierId),
        quotation_no: dto.quotationNo,
        inquiry_date: dto.inquiryDate || await resolveBusinessDateKey(this.db, tenantId, new Date()),
        expiry_date: dto.expiryDate || null,
        incoterm: dto.incoterm || 'FOB',
        currency: dto.currency || 'USD',
        item_name: dto.itemName,
        product_id: dto.productId ? Number(dto.productId) : null,
        unit_price_foreign: dto.unitPriceForeign,
        moq: dto.moq || 1,
        production_lead_days: dto.productionLeadDays || 30,
        port_of_loading: dto.portOfLoading || null,
        estimated_freight_usd: dto.estimatedFreightUsd || 0,
        estimated_customs_rate_percent: dto.estimatedCustomsRatePercent || 5,
        estimated_landed_cost_egp: Number(estLanded.toFixed(4)),
        exchange_rate_used: commRate,
        exchange_rate_assumed: rateAssumed,
        customs_rate_assumed: customsAssumed,
        status: 'pending',
        notes: dto.notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listQuotations(tenantId: string, projectId?: string, supplierId?: string) {
    let q = this.db
      .selectFrom('import_quotations as q')
      .leftJoin('suppliers as s', 's.id', 'q.supplier_id')
      .selectAll('q')
      .select(['s.name as supplier_name'])
      .where('q.tenant_id', '=', tenantId);
    if (projectId) q = q.where('q.project_id', '=', projectId);
    if (supplierId) q = q.where('q.supplier_id', '=', Number(supplierId));
    return await q.orderBy('q.created_at', 'desc').execute();
  }

  async selectQuotation(tenantId: string, quotationId: string, dto: SelectQuotationDto) {
    return await this.db.transaction().execute(async (trx) => {
      // INV-IMPORT-QUOTATION-LOCK: the candidate row is locked
      // for the transaction, so two concurrent selections of the
      // same quotation serialise instead of racing.
      const quote = await trx
        .selectFrom('import_quotations')
        .selectAll()
        .where('id', '=', quotationId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // Re-selecting the same already-selected quotation is an
      // idempotent no-op: it succeeds unchanged and never
      // re-rejects siblings (a new round's candidates stay).
      if (quote.status === 'selected') {
        return quote;
      }
      if (quote.status !== 'pending') {
        throw new BadRequestException(
          `لا يمكن اعتماد عرض سعر غير معلق (الحالة الحالية: ${quote.status})؛ الاعتماد متاح فقط للعروض المعلقة. [IMPORT_QUOTATION_NOT_SELECTABLE]`,
        );
      }

      // An expired quotation can never be selected.
      const toDateOnly = (v: any): string | null => {
        if (v === null || v === undefined || v === '') return null;
        if (v instanceof Date) return formatLocalCalendarDay(v);
        return String(v).slice(0, 10);
      };
      const today = await resolveBusinessDateKey(this.db, tenantId, new Date());
      const expiry = toDateOnly((quote as any).expiry_date);
      if (expiry && expiry < today) {
        throw new BadRequestException(
          `انتهت صلاحية عرض السعر هذا (تاريخ الانتهاء: ${expiry}) ولا يمكن اعتماده؛ اطلب عرض سعر جديداً. [IMPORT_QUOTATION_EXPIRED]`,
        );
      }

      if (quote.project_id) {
        // Lock the whole (project, item) sibling group before
        // deciding: concurrent selections for the same item
        // serialise on these rows, so exactly one winner emerges
        // and a stale sibling can never flip a locked selection.
        const siblings = await trx
          .selectFrom('import_quotations')
          .select(['id', 'status', 'created_at', 'updated_at'])
          .where('tenant_id', '=', tenantId)
          .where('project_id', '=', quote.project_id)
          .where('item_name', '=', quote.item_name)
          .forUpdate()
          .execute();
        const winner = siblings.find(
          (s: any) => s.status === 'selected' && String(s.id) !== String(quotationId),
        );
        if (winner) {
          // Stale-round rule: a quotation created at or before
          // the existing selection belongs to the locked round
          // and cannot supersede it; a quotation created after
          // the selection is a new round and may supersede.
          const toMs = (v: any): number => {
            if (v instanceof Date) return v.getTime();
            const t = Date.parse(String(v));
            return Number.isFinite(t) ? t : 0;
          };
          if (toMs((quote as any).created_at) <= toMs((winner as any).updated_at)) {
            throw new BadRequestException(
              'تم اعتماد عرض سعر أحدث لنفس الصنف في هذا المشروع؛ لا يمكن لعرض أقدم أن يلغي الاعتماد المقفل. أنشئ عرض سعر جديداً لجولة تفاوض جديدة. [IMPORT_QUOTATION_SELECTION_LOCKED]',
            );
          }
        }

        await trx
          .updateTable('import_quotations')
          .set({ status: 'rejected' })
          .where('tenant_id', '=', tenantId)
          .where('project_id', '=', quote.project_id)
          .where('item_name', '=', quote.item_name)
          .where('id', '!=', quotationId)
          .execute();
      }

      return await trx
        .updateTable('import_quotations')
        .set({
          status: 'selected',
          selection_reason: dto?.selectionReason || 'اعتماد عرض السعر الأفضل فنياً ومالياً',
          updated_at: sql`NOW()`,
        })
        .where('id', '=', quotationId)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  // -------------------------------------------------------------
  // PRODUCT SAMPLES & REFERENCE APPROVAL
  // -------------------------------------------------------------
  async createSampleOrder(tenantId: string, dto: CreateSampleOrderDto) {
    return await this.db
      .insertInto('import_sample_orders')
      .values({
        tenant_id: tenantId,
        project_id: dto.projectId ?? null,
        supplier_id: Number(dto.supplierId),
        sample_code: dto.sampleCode,
        item_name: dto.itemName,
        sample_cost_foreign: dto.sampleCostForeign || 0,
        freight_cost_foreign: dto.freightCostForeign || 0,
        currency: dto.currency || 'USD',
        request_date: dto.requestDate || await resolveBusinessDateKey(this.db, tenantId, new Date()),
        courier_tracking_no: dto.courierTrackingNo || null,
        decision: 'pending',
        reference_sample_approved: false,
        notes: dto.notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listSampleOrders(tenantId: string, projectId?: string) {
    let q = this.db
      .selectFrom('import_sample_orders as s')
      .leftJoin('suppliers as sup', 'sup.id', 's.supplier_id')
      .selectAll('s')
      .select(['sup.name as supplier_name'])
      .where('s.tenant_id', '=', tenantId);
    if (projectId) q = q.where('s.project_id', '=', projectId);
    return await q.orderBy('s.created_at', 'desc').execute();
  }

  async updateSampleOrderInspection(tenantId: string, sampleId: string, dto: UpdateSampleOrderInspectionDto) {
    const updates: any = { updated_at: sql`NOW()` };
    if (dto.qualityScore !== undefined) updates.quality_score = dto.qualityScore;
    if (dto.decision) updates.decision = dto.decision;
    if (dto.referenceSampleApproved !== undefined) updates.reference_sample_approved = dto.referenceSampleApproved;
    if (dto.defectAnalysis !== undefined) updates.defect_analysis = dto.defectAnalysis;
    if (dto.photoUrls) updates.photo_urls = JSON.stringify(dto.photoUrls);
    if (dto.receivedDate) updates.received_date = dto.receivedDate;

    return await this.db
      .updateTable('import_sample_orders')
      .set(updates)
      .where('id', '=', sampleId)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // -------------------------------------------------------------
  // FEASIBILITY CONVERSION & PROFORMA / PO LIFECYCLE
  // -------------------------------------------------------------
  async convertFeasibilityToProject(tenantId: string, projectId: string, dto: ConvertFeasibilityToProjectDto) {
    return await this.db.transaction().execute(async (trx) => {
      const project = await trx
        .selectFrom('import_projects')
        .selectAll()
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // I1-P2: approving a feasibility study transitions the existing
      // project only, once. A second approval must fail closed instead
      // of re-running the conversion — re-running would rebuild the
      // cash-flow schedule and mint a second proforma for the same study.
      if (project.feasibility_converted_at) {
        throw new BadRequestException(
          `دراسة الجدوى للمشروع ${project.project_no} معتمدة بالفعل؛ لا يمكن اعتمادها مرة ثانية. [IMPORT_FEASIBILITY_ALREADY_CONVERTED]`,
        );
      }

      const feas = project.feasibility_data;
      if (!feas || !feas.items || !feas.items.length) {
        throw new BadRequestException('دراسة الجدوى لا تحتوي على أصناف صالحة للتحويل.');
      }

      // INV-FEASIBILITY-CONTRACT-RATE-REQUIRED: no invented rate.
      // The old fallback of 50 lived only here, then was stored as
      // the proforma's exchange_rate_contract, so the invented rate
      // became the authoritative contract rate downstream. A
      // non-EGP project without a usable commercial rate must not
      // convert: the merchant sets the rate on the feasibility
      // study and converts again. Mirrors the proforma gate
      // (INV-IMPORT-PROFORMA-EXCHANGE-RATE): EGP budgets convert
      // at rate 1. Checked before any write.
      const budgetCurrency = (project.budget_currency || 'USD').toUpperCase();
      const commRate = budgetCurrency === 'EGP' ? 1 : Number(feas.exchangeRateCommercial);
      if (!Number.isFinite(commRate) || commRate <= 0) {
        throw new BadRequestException(
          `لا يمكن تحويل دراسة الجدوى ${project.project_no} بلا سعر صرف تجاري صالح؛ حدد سعر الصرف التجاري (${budgetCurrency}) على دراسة الجدوى قبل التحويل. [IMPORT_EXCHANGE_RATE_REQUIRED]`,
        );
      }
      const totalFactoryUsd = Number(feas.totalFactoryCostUsd || 0);
      // INV-IMPORT-ESTIMATES-HONEST: the 30% advance default is recorded,
      // and the milestone text states the ACTUAL percentages used — the
      // previous hardcoded "(30%)" / "(70%)" text lied whenever the caller
      // supplied a different split. Each schedule entry carries its basis
      // (estimate flag, whether the advance split was assumed, the rate).
      const advanceAssumed = dto.advancePaymentPercentage === undefined || dto.advancePaymentPercentage === null;
      const advPercent = advanceAssumed ? 30 : Number(dto.advancePaymentPercentage);
      const balPercent = 100 - advPercent;
      const advanceUsd = (totalFactoryUsd * advPercent) / 100;
      const balanceUsd = (totalFactoryUsd * balPercent) / 100;

      const cashFlowSchedule = [
        {
          stage: 'T0_Contract_Advance',
          milestone: `دفعة مقدمة للمصنع عند توقيع العقد (${advPercent}%)`,
          amountUsd: advanceUsd,
          amountEgp: advanceUsd * commRate,
          dueDaysFromStart: 0,
          is_estimate: true,
          assumed_advance_percentage: advanceAssumed,
          exchange_rate_used: commRate,
        },
        {
          stage: 'T1_Pre_Shipment_Balance',
          milestone: `سداد رصيد المصنع بعد فحص الجودة وقبل الشحن (${balPercent}%)`,
          amountUsd: balanceUsd,
          amountEgp: balanceUsd * commRate,
          dueDaysFromStart: 30,
          is_estimate: true,
          assumed_advance_percentage: advanceAssumed,
          exchange_rate_used: commRate,
        },
        {
          stage: 'T2_Freight_And_Insurance',
          milestone: 'سداد نولون الشحن البحري والتأمين عند إصدار البوليصة',
          amountUsd: Number(feas.internationalShippingUsd || 0) + Number(feas.insuranceUsd || 0),
          amountEgp: (Number(feas.internationalShippingUsd || 0) + Number(feas.insuranceUsd || 0)) * commRate,
          dueDaysFromStart: 40,
          is_estimate: true,
          assumed_advance_percentage: advanceAssumed,
          exchange_rate_used: commRate,
        },
        {
          stage: 'T3_Customs_And_Clearance',
          milestone: 'رسوم الجمارك والضريبة والتخليص بميناء الوصول',
          amountUsd: 0,
          amountEgp:
            Number(feas.customsDutyEgp || 0) +
            Number(feas.clearanceAndPortFeesEgp || 0) +
            (feas.vatIsRefundable ? 0 : Number(feas.customsVatEgp || 0)),
          dueDaysFromStart: 55,
          is_estimate: true,
          assumed_advance_percentage: advanceAssumed,
          exchange_rate_used: commRate,
        },
        {
          stage: 'T4_Inland_Transport',
          milestone: 'النولون البري ونقل الحاويات إلى المخازن',
          amountUsd: 0,
          amountEgp: Number(feas.internalTransportEgp || 0),
          dueDaysFromStart: 60,
          is_estimate: true,
          assumed_advance_percentage: advanceAssumed,
          exchange_rate_used: commRate,
        },
      ];

      let proformaId = null;
      if (dto.supplierId) {
        const piNumber = `PI-${project.project_no}-${Date.now().toString().slice(-4)}`;
        const pi = await trx
          .insertInto('import_proforma_invoices')
          .values({
            tenant_id: tenantId,
            project_id: projectId,
            supplier_id: Number(dto.supplierId),
            pi_number: piNumber,
            pi_date: await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date()),
            currency: project.budget_currency || 'USD',
            total_amount_foreign: totalFactoryUsd,
            incoterm: 'FOB',
            delivery_port: dto.targetPort || project.country_destination || 'Alexandria',
            payment_terms: `${advPercent}% advance, ${balPercent}% against shipping documents`,
            exchange_rate_contract: commRate,
            status: 'draft',
            advance_percentage: advPercent,
            balance_percentage: balPercent,
            items: JSON.stringify(feas.items),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        proformaId = pi.id;
      }

      await trx
        .updateTable('import_projects')
        .set({
          status: 'sourcing',
          feasibility_converted_at: sql`NOW()`,
          cash_flow_schedule: JSON.stringify(cashFlowSchedule),
          initial_po_id: proformaId,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .execute();

      return {
        success: true,
        projectId,
        proformaId,
        cashFlowSchedule,
      };
    });
  }

  async getProformaInvoices(tenantId: string, projectId?: string, supplierId?: string) {
    let q = this.db
      .selectFrom('import_proforma_invoices as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .leftJoin('import_projects as pr', 'pr.id', 'p.project_id')
      .selectAll('p')
      .select(['s.name as supplier_name', 'pr.title as project_title', 'pr.project_no'])
      .where('p.tenant_id', '=', tenantId);
    if (projectId) q = q.where('p.project_id', '=', projectId);
    if (supplierId) q = q.where('p.supplier_id', '=', Number(supplierId));
    return await q.orderBy('p.created_at', 'desc').execute();
  }

  async getProformaById(tenantId: string, id: string) {
    return await this.db
      .selectFrom('import_proforma_invoices as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .selectAll('p')
      .select(['s.name as supplier_name'])
      .where('p.id', '=', id)
      .where('p.tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();
  }

  async createProformaInvoice(tenantId: string, dto: CreateProformaInvoiceDto) {
    // INV-IMPORT-PROJECT-PROFORMA-GUARDS: the supplier must exist in
    // this tenant (the FK alone allows any tenant's supplier), and
    // pi_number must be unique per tenant. The duplicate check is a
    // service check only — no unique index exists, so concurrent
    // creates can still race; that residual is recorded, not hidden.
    const supplier = await this.db
      .selectFrom('suppliers')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', Number(dto.supplierId))
      .executeTakeFirst();
    if (!supplier) {
      throw new BadRequestException(
        'المورد المحدد للفاتورة المبدئية غير موجود في هذه المنشأة. [IMPORT_PROFORMA_SUPPLIER_REQUIRED]',
      );
    }
    const duplicate = await this.db
      .selectFrom('import_proforma_invoices')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('pi_number', '=', dto.piNumber)
      .executeTakeFirst();
    if (duplicate) {
      throw new BadRequestException(
        `رقم الفاتورة المبدئية ${dto.piNumber} مستخدم بالفعل في هذه المنشأة. [IMPORT_PROFORMA_DUPLICATE_NUMBER]`,
      );
    }
    // Advance+balance structure (INV-IMPORT-PAYMENT-METHODS): no
    // silent 30/70 split. Either both percentages are explicit and
    // sum to 100, or neither is recorded (NULL = no advance
    // structure agreed). A one-sided percentage fails closed.
    const advPct = dto.advancePercentage;
    const balPct = dto.balancePercentage;
    if ((advPct !== undefined) !== (balPct !== undefined)) {
      throw new BadRequestException('نسبة الدفعة المقدمة ونسبة الرصيد يجب تحديدهما معًا صراحة أو تركهما معًا.');
    }
    if (advPct !== undefined && balPct !== undefined) {
      if (!Number.isFinite(advPct) || !Number.isFinite(balPct) || advPct <= 0 || advPct >= 100 || Math.abs(advPct + balPct - 100) > 0.001) {
        throw new BadRequestException('نسبة الدفعة المقدمة والرصيد يجب أن تكونا موجبتين ومجموعهما 100.');
      }
    }
    return await this.db
      .insertInto('import_proforma_invoices')
      .values({
        tenant_id: tenantId,
        project_id: dto.projectId ?? null,
        supplier_id: Number(dto.supplierId),
        pi_number: dto.piNumber,
        pi_date: dto.piDate,
        currency: dto.currency || 'USD',
        total_amount_foreign: dto.totalAmountForeign,
        incoterm: dto.incoterm || 'FOB',
        delivery_port: dto.deliveryPort || null,
        payment_terms: dto.paymentTerms || null,
        exchange_rate_contract: dto.exchangeRateContract || null,
        advance_percentage: advPct ?? null,
        balance_percentage: balPct ?? null,
        status: 'draft',
        payment_status: 'unpaid',
        paid_amount_foreign: 0,
        items: dto.items ? JSON.stringify(dto.items) : '[]',
        notes: dto.notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateProformaInvoice(tenantId: string, id: string, dto: Partial<CreateProformaInvoiceDto>) {
    // INV-IMPORT-PROJECT-PROFORMA-GUARDS: a proforma freezes once
    // money moved (any payment) or its PO was issued. Post-approval
    // edits stay allowed while unpaid and PO-less: the established
    // workflow approves first, then links catalog products into the
    // items, then generates the PO.
    const current = await this.db
      .selectFrom('import_proforma_invoices')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();
    const paid = Number(current.paid_amount_foreign || 0) > 0 ||
      (current.payment_status && current.payment_status !== 'unpaid');
    const poIssued = current.po_status === 'issued' || !!current.po_number;
    if (poIssued) {
      throw new BadRequestException(
        'لا يمكن تعديل فاتورة مبدئية بعد إصدار أمر الشراء الخاص بها. [IMPORT_PROFORMA_FROZEN]',
      );
    }
    if (paid) {
      // The established workflow pays the proforma BEFORE its items
      // are linked to catalog products (the e2e simulation settles
      // the balance, then links items, then generates the PO), so an
      // items-only update stays allowed after payment. Every money
      // or identity field is frozen: changing the total after money
      // moved would silently diverge the payment record. The PO
      // generation re-validates the header total against the items,
      // so an items edit cannot corrupt the PO either.
      const moneyFieldsTouched =
        dto.piNumber !== undefined || dto.piDate !== undefined ||
        dto.currency !== undefined || dto.totalAmountForeign !== undefined ||
        dto.incoterm !== undefined || dto.deliveryPort !== undefined ||
        dto.paymentTerms !== undefined || dto.exchangeRateContract !== undefined ||
        dto.advancePercentage !== undefined || dto.balancePercentage !== undefined;
      if (moneyFieldsTouched) {
        throw new BadRequestException(
          'لا يمكن تعديل مبالغ أو بيانات فاتورة مبدئية بعد سداد أي دفعة؛ يُسمح فقط بربط الأصناف بالمنتجات. [IMPORT_PROFORMA_FROZEN]',
        );
      }
    }
    if (dto.piNumber && dto.piNumber !== current.pi_number) {
      const duplicate = await this.db
        .selectFrom('import_proforma_invoices')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('pi_number', '=', dto.piNumber)
        .executeTakeFirst();
      if (duplicate) {
        throw new BadRequestException(
          `رقم الفاتورة المبدئية ${dto.piNumber} مستخدم بالفعل في هذه المنشأة. [IMPORT_PROFORMA_DUPLICATE_NUMBER]`,
        );
      }
    }
    const updates: any = {};
    if (dto.piNumber) updates.pi_number = dto.piNumber;
    if (dto.piDate) updates.pi_date = dto.piDate;
    if (dto.currency) updates.currency = dto.currency;
    if (dto.totalAmountForeign !== undefined) updates.total_amount_foreign = dto.totalAmountForeign;
    if (dto.incoterm) updates.incoterm = dto.incoterm;
    if (dto.deliveryPort) updates.delivery_port = dto.deliveryPort;
    if (dto.paymentTerms) updates.payment_terms = dto.paymentTerms;
    if (dto.exchangeRateContract !== undefined) updates.exchange_rate_contract = dto.exchangeRateContract;
    if (dto.advancePercentage !== undefined) updates.advance_percentage = dto.advancePercentage;
    if (dto.balancePercentage !== undefined) updates.balance_percentage = dto.balancePercentage;
    if (dto.items) updates.items = JSON.stringify(dto.items);
    if (dto.notes !== undefined) updates.notes = dto.notes;

    return await this.db
      .updateTable('import_proforma_invoices')
      .set(updates)
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async approveProformaInvoice(tenantId: string, userId: number, id: string) {
    // INV-IMPORT-PROJECT-PROFORMA-GUARDS: approve only a draft with
    // at least one validated item. Feasibility-style items (name +
    // qty, no catalog productId yet) are valid — the catalog link
    // happens after approval. Maker-checker (approver != creator)
    // cannot be enforced: import_proforma_invoices has no
    // created_by column, so the creator is unknowable here; that
    // residual needs a migration and is recorded in the invariant.
    const current = await this.db
      .selectFrom('import_proforma_invoices')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();
    if (current.status !== 'draft') {
      throw new BadRequestException(
        'لا يمكن اعتماد فاتورة مبدئية ليست في حالة مسودة. [IMPORT_PROFORMA_NOT_DRAFT]',
      );
    }
    const rawItems = typeof current.items === 'string' ? JSON.parse(current.items || '[]') : (current.items || []);
    const hasValidItem = Array.isArray(rawItems) && rawItems.some((item: any) => {
      const qty = Number(item?.quantity ?? item?.qty);
      const name = String(item?.name ?? item?.productName ?? '').trim();
      return (Number.isFinite(qty) && qty > 0) || name.length > 0;
    });
    if (!hasValidItem) {
      throw new BadRequestException(
        'لا يمكن اعتماد فاتورة مبدئية بلا أصناف صالحة. [IMPORT_PROFORMA_NO_VALID_ITEMS]',
      );
    }
    return await this.db
      .updateTable('import_proforma_invoices')
      .set({
        status: 'approved',
        approved_by: userId,
        approved_at: sql`NOW()`,
      })
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async generatePoFromProforma(tenantId: string, userId: number, id: string) {
    // A Proforma is not an order: create the REAL purchasing PO and its stock lines atomically.
    return this.db.transaction().execute(async (trx) => {
      const pi = await trx.selectFrom('import_proforma_invoices').selectAll()
        .where('id', '=', id).where('tenant_id', '=', tenantId)
        .forUpdate().executeTakeFirstOrThrow();
      if (pi.po_status === 'issued' && pi.po_number) return pi;
      if (pi.status !== 'approved') throw new BadRequestException('يجب اعتماد الفاتورة المبدئية قبل إصدار أمر شراء.');
      let raw = typeof pi.items === 'string' ? JSON.parse(pi.items) : pi.items;

      // No auto-recovery: a proforma without usable items must fail
      // closed here. The old fallback first tried the linked project's
      // feasibility, then the tenant's most recently created project,
      // so a PO could be built from a different project's goods; and
      // its item mapping dropped productId, so the recovered lines
      // always failed validation and the transaction rolled back
      // anyway. Items are linked explicitly (updateProformaInvoice)
      // before conversion; nothing is borrowed.
      if (!Array.isArray(raw) || !raw.length) throw new BadRequestException('الفاتورة المبدئية لا تحتوي على أصناف قابلة للشراء.');
      // No invented rate: a foreign-currency proforma without a usable
      // contract rate must not be costed at a silent default (the old
      // fallback of 50 lived only in the draft PO's free-text notes, so
      // approving the draft posted costs nobody chose). The merchant
      // sets the contract rate on the proforma and converts again.
      const exchangeRate = (pi.currency || 'USD').toUpperCase() === 'EGP'
        ? 1 : Number(pi.exchange_rate_contract);
      if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
        throw new BadRequestException(
          `لا يمكن إصدار أمر شراء من الفاتورة المبدئية ${pi.pi_number} بلا سعر صرف تعاقدي صالح؛ حدد سعر الصرف التعاقدي (${pi.currency || 'USD'}) على الفاتورة المبدئية قبل التحويل. [IMPORT_EXCHANGE_RATE_REQUIRED]`,
        );
      }
      const supplier = await trx.selectFrom('suppliers')
        .select(['id', 'name', 'account_id']).where('tenant_id', '=', tenantId)
        .where('id', '=', pi.supplier_id).executeTakeFirstOrThrow();
      const scopeAccountId = String(supplier.account_id ?? '').trim() || tenantId;
      const lines: Array<{productId: number; name: string; quantity: number; unitCost: number; total: number}> = [];
      let foreignTotal = 0;
      for (let lineIdx = 0; lineIdx < raw.length; lineIdx++) {
        const item = raw[lineIdx];
        const lineLabel = String(item.productName ?? item.name ?? '').trim() || 'بلا اسم';
        const productId = Number(item.productId ?? item.product_id);
        const qty = Number(item.quantity ?? item.qty);
        const foreignUnitCost = Number(item.unitPriceForeign ?? item.factoryPriceUsd ?? item.unitPriceUsd);
        if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isFinite(qty) || qty <= 0 ||
          !Number.isFinite(foreignUnitCost) || foreignUnitCost < 0) {
          // I1-P1: the fail-closed error names the offending line
          // (index + name) so the merchant knows exactly which PI
          // line still needs a real inventory item linked. Never
          // silently skip the line or auto-match by name.
          throw new BadRequestException(`يجب ربط البند رقم ${lineIdx + 1} (${lineLabel}) من الـ Proforma بصنف حقيقي وتحديد الكمية وسعر الوحدة الأجنبي.`);
        }
        const product = await trx.selectFrom('products').select(['id', 'name'])
          .where('tenant_id', '=', tenantId).where('id', '=', productId).executeTakeFirst();
        if (!product) throw new BadRequestException(`البند رقم ${lineIdx + 1} (${lineLabel}) يشير إلى صنف غير موجود ضمن أصناف المنشأة.`);

        const unitCost = Number((foreignUnitCost * exchangeRate).toFixed(3));
        const total = Number((qty * unitCost).toFixed(3));
        lines.push({ productId, name: product.name, quantity: qty, unitCost, total });
        foreignTotal += qty * foreignUnitCost;
      }
      foreignTotal = Number(foreignTotal.toFixed(2));
      if (Math.abs(foreignTotal - Number(pi.total_amount_foreign)) > 0.02) {
        // Fail closed: a supplier-document discrepancy must be fixed on
        // the proforma itself, never silently overwritten. The header
        // total feeds the later paid-amount checks; overwriting it here
        // would launder the discrepancy into the payment chain.
        throw new BadRequestException(
          `إجمالي بنود الفاتورة المبدئية ${pi.pi_number} (${foreignTotal}) لا يطابق إجمالي الفاتورة (${pi.total_amount_foreign})؛ صحح الفاتورة المبدئية قبل إصدار أمر الشراء. [IMPORT_PROFORMA_TOTAL_MISMATCH]`,
        );
      }
      const subtotal = Number(lines.reduce((sum, item) => sum + item.total, 0).toFixed(3));
      const inserted = await trx.insertInto('purchase_orders').values({
        tenant_id: tenantId, account_id: scopeAccountId,
        order_number: `PO-TMP-${randomUUID()}`,
        supplier_id: supplier.id, supplier_name: supplier.name,
        subtotal, tax_amount: 0, discount_amount: 0, total_amount: subtotal,
        status: 'draft', notes: `أمر شراء وارد من Proforma ${pi.pi_number} - ${pi.currency} بسعر صرف ${exchangeRate}`,
        created_by: userId,
      }).returning('id').executeTakeFirstOrThrow();
      const orderNumber = formatDailyDocumentNumber('PO', inserted.id, new Date(), 4, await getTenantTimezone(this.db, tenantId));
      await trx.updateTable('purchase_orders').set({ order_number: orderNumber })
        .where('tenant_id', '=', tenantId).where('id', '=', inserted.id).execute();
      for (const item of lines) {
        await trx.insertInto('purchase_order_items').values({
          tenant_id: tenantId, account_id: scopeAccountId,
          purchase_order_id: inserted.id, product_id: item.productId,
          product_name: item.name, quantity: item.quantity, received_quantity: 0,
          unit_cost: item.unitCost, tax_rate: 0, discount: 0, total: item.total,
        }).execute();
      }
      return trx.updateTable('import_proforma_invoices').set({
        po_number: orderNumber, po_date: await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date()), po_status: 'issued',
      }).where('id', '=', id).where('tenant_id', '=', tenantId)
        .returningAll().executeTakeFirstOrThrow();
    });
  }

  // -------------------------------------------------------------
  // CUSTOMS BROKER REGISTRY & ADVANCE LIQUIDATION
  // -------------------------------------------------------------
  async listCustomsBrokers(tenantId: string) {
    const brokers = await this.db
      .selectFrom('import_customs_brokers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('name', 'asc')
      .execute();

    const advances = await this.db
      .selectFrom('import_broker_advances')
      .select(['broker_id', 'amount_egp', 'settled_amount_egp', 'remaining_amount_egp'])
      .where('tenant_id', '=', tenantId)
      .execute();

    const statsByBroker = new Map<string, { total: number; settled: number; remaining: number }>();
    for (const adv of advances) {
      const curr = statsByBroker.get(adv.broker_id) || { total: 0, settled: 0, remaining: 0 };
      curr.total += Number(adv.amount_egp || 0);
      curr.settled += Number(adv.settled_amount_egp || 0);
      curr.remaining += Number(adv.remaining_amount_egp || 0);
      statsByBroker.set(adv.broker_id, curr);
    }

    return brokers.map((b) => {
      const stats = statsByBroker.get(b.id) || { total: 0, settled: 0, remaining: 0 };
      let ports: string[] = [];
      try {
        ports = Array.isArray(b.customs_ports)
          ? (b.customs_ports as any)
          : typeof b.customs_ports === 'string'
            ? JSON.parse(b.customs_ports)
            : [];
      } catch {
        ports = [];
      }
      return {
        ...b,
        license_number: b.license_no,
        port_name: Array.isArray(ports) && ports.length > 0 ? ports.join('، ') : 'الإسكندرية / السخنة',
        total_advances_egp: Number(stats.total.toFixed(2)),
        total_liquidated_egp: Number(stats.settled.toFixed(2)),
        unliquidated_balance_egp: Number(stats.remaining.toFixed(2)),
      };
    });
  }

  async createCustomsBroker(tenantId: string, dto: CreateCustomsBrokerDto) {
    return await this.db
      .insertInto('import_customs_brokers')
      .values({
        tenant_id: tenantId,
        name: dto.name,
        license_no: dto.licenseNo || null,
        phone: dto.phone || null,
        email: dto.email || null,
        customs_ports: dto.customsPorts
          ? JSON.stringify(dto.customsPorts)
          : '["Alexandria", "Dekheila", "Ain Sokhna", "Port Said"]',
        tax_number: dto.taxNumber || null,
        commercial_registry: dto.commercialRegistry || null,
        is_active: true,
        notes: dto.notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateCustomsBroker(tenantId: string, id: string, dto: Partial<CreateCustomsBrokerDto>) {
    const updates: any = { updated_at: sql`NOW()` };
    if (dto.name) updates.name = dto.name;
    if (dto.licenseNo !== undefined) updates.license_no = dto.licenseNo;
    if (dto.phone !== undefined) updates.phone = dto.phone;
    if (dto.email !== undefined) updates.email = dto.email;
    if (dto.customsPorts) updates.customs_ports = JSON.stringify(dto.customsPorts);
    if (dto.taxNumber !== undefined) updates.tax_number = dto.taxNumber;
    if (dto.commercialRegistry !== undefined) updates.commercial_registry = dto.commercialRegistry;
    if (dto.notes !== undefined) updates.notes = dto.notes;

    return await this.db
      .updateTable('import_customs_brokers')
      .set(updates)
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async disburseBrokerAdvance(tenantId: string, userId: number, dto: DisburseBrokerAdvanceDto) {
    if (!Number.isFinite(Number(dto.amountEgp)) || Number(dto.amountEgp) <= 0) {
      throw new BadRequestException('مبلغ عهدة المخلص يجب أن يكون رقمًا موجبًا.');
    }
    // Broker payment method (INV-IMPORT-PAYMENT-METHODS): closed
    // enum, defaulting to bank transfer as before when absent.
    if (dto.paymentMethod !== undefined && dto.paymentMethod !== null && !isPaymentMethod(dto.paymentMethod)) {
      throw new BadRequestException(`طريقة دفع العهدة '${dto.paymentMethod}' غير مدعومة. [IMPORT_PAYMENT_METHOD_UNKNOWN]`);
    }
    return await this.db.transaction().execute(async (trx) => {
      if (dto.projectId) {
        const project = await trx.selectFrom('import_projects').select('id')
          .where('tenant_id', '=', tenantId).where('id', '=', dto.projectId).executeTakeFirst();
        if (!project) throw new BadRequestException('مشروع عهدة المخلص غير تابع للمنشأة.');
      }
      if (dto.shipmentId) {
        const shipment = await trx.selectFrom('import_shipments').select('project_id')
          .where('tenant_id', '=', tenantId).where('id', '=', dto.shipmentId).executeTakeFirst();
        if (!shipment || (dto.projectId && shipment.project_id && shipment.project_id !== dto.projectId)) {
          throw new BadRequestException('شحنة عهدة المخلص لا تطابق مشروع الاستيراد.');
        }
      }
      const broker = await trx
        .selectFrom('import_customs_brokers')
        .selectAll()
        .where('id', '=', dto.brokerId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirstOrThrow();

      const advance = await trx
        .insertInto('import_broker_advances')
        .values({
          tenant_id: tenantId,
          broker_id: dto.brokerId,
          project_id: dto.projectId ?? null,
          shipment_id: dto.shipmentId ?? null,
          advance_no: dto.advanceNo,
          amount_egp: dto.amountEgp,
          disbursement_date: dto.disbursementDate || await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date()),
          payment_method: dto.paymentMethod || 'bank_transfer',
          treasury_account_id: dto.treasuryAccountId ? Number(dto.treasuryAccountId) : null,
          status: 'active',
          settled_amount_egp: 0,
          remaining_amount_egp: dto.amountEgp,
          notes: dto.notes || null,
          created_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      {
        const assetAccId = await this.resolveTenantAccount(trx, tenantId, 'broker_advance');
        const bankAccId = await this.resolveTenantAccount(
          trx,
          tenantId,
          'bank',
          dto.treasuryAccountId ? Number(dto.treasuryAccountId) : null
        );

        const bankScope = await trx.selectFrom('accounting_accounts').select('account_id')
          .where('tenant_id', '=', tenantId).where('id', '=', bankAccId).executeTakeFirstOrThrow();
        await trx.insertInto('treasury_transactions').values({
          tenant_id: tenantId, account_id: bankScope.account_id,
          txn_type: 'import_broker_advance', amount: -Number(dto.amountEgp),
          note: `عهدة مخلص جمركي ${broker.name} - #${dto.advanceNo}`,
          reference_type: 'import_broker_advance', reference_id: Number(advance.serial_id),
          created_by: userId,
        }).execute();
        const posting = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
        await posting.postDomainJournal(trx, {
          sourceType: 'import_broker_advance',
          sourceId: Number(advance.serial_id),
          tenantId,
          accountId: tenantId,
          entryDate: advance.disbursement_date ? new Date(advance.disbursement_date as any) : new Date(),
          description: `صرف عهدة تخليص جمركي للمخلص ${broker.name} - إذن #${dto.advanceNo}`,
          branchId: null,
          locationId: null,
          createdBy: userId,
          postedBy: userId,
          lines: [
            {
              accountId: assetAccId,
              debit: Number(dto.amountEgp),
              credit: 0,
              description: `عهدة تخليص جمركي - ${broker.name} - إذن #${dto.advanceNo}`,
              partnerType: 'none',
              partnerId: null,
              branchId: null,
              locationId: null,
            },
            {
              accountId: bankAccId,
              debit: 0,
              credit: Number(dto.amountEgp),
              description: `صرف بنكي لعهدة مخلص جمركي #${dto.advanceNo}`,
              partnerType: 'none',
              partnerId: null,
              branchId: null,
              locationId: null,
            },
          ],
        });
      }

      return advance;
    });
  }

  async liquidateBrokerExpenses(tenantId: string, userId: number, dto: LiquidateBrokerExpenseDto) {
    if (!dto.advanceId) throw new BadRequestException('تسوية مصروف مخلص تتطلب عهدة أصلية موثقة.');
    if (!Number.isFinite(Number(dto.amountEgp)) || Number(dto.amountEgp) <= 0) {
      throw new BadRequestException('قيمة إيصال المخلص يجب أن تكون مبلغاً موجباً.');
    }
    return await this.db.transaction().execute(async (trx) => {
      // Serialize receipts for a single broker and reject duplicate evidence.
      const broker = await trx.selectFrom('import_customs_brokers').select('id')
        .where('tenant_id', '=', tenantId).where('id', '=', dto.brokerId)
        .forUpdate().executeTakeFirst();
      if (!broker) throw new BadRequestException('المخلص الجمركي غير تابع للمنشأة.');
      const repeatedReceipt = await trx.selectFrom('import_broker_expenses').select('id')
        .where('tenant_id', '=', tenantId).where('broker_id', '=', dto.brokerId)
        .where('receipt_no', '=', dto.receiptNo).executeTakeFirst();
      if (repeatedReceipt) throw new ConflictException('تم تسجيل رقم إيصال المخلص مسبقًا.');
      const advanceForValidation = await trx.selectFrom('import_broker_advances').selectAll()
        .where('tenant_id', '=', tenantId).where('id', '=', dto.advanceId)
        .forUpdate().executeTakeFirstOrThrow();
      if (advanceForValidation.broker_id !== dto.brokerId ||
          (advanceForValidation.project_id && dto.projectId && advanceForValidation.project_id !== dto.projectId) ||
          (advanceForValidation.shipment_id && dto.shipmentId && advanceForValidation.shipment_id !== dto.shipmentId)) {
        throw new BadRequestException('العهدة لا تتبع نفس المخلص أو مشروع / شحنة الإيصال.');
      }
      if (Number(dto.amountEgp) > Number(advanceForValidation.remaining_amount_egp || 0) + 0.001) {
        throw new BadRequestException('قيمة تسوية المخلص تتجاوز الرصيد المتبقي من العهدة.');
      }

      // Capitalisation routing (INV-IMPORT-BROKER-CAPITALISATION),
      // decided BEFORE any write. A capitalised expense reaches
      // the GL exactly once: folded into a shipment cost bucket
      // when no receipt has posted, or spread by revaluation when
      // the receipt has posted. A frozen legacy-review receipt
      // blocks both (resolve the review first). Without a
      // shipment there is nowhere to capitalise: fail closed
      // instead of silently expensing a capitalised cost.
      const wantsCapitalize = dto.isCapitalized ?? true;
      const vatAsset = dto.isRefundableVat ?? false;
      const effectiveShipmentId: string | null = dto.shipmentId ?? advanceForValidation.shipment_id ?? null;
      let capitalizationState: 'folded' | 'revalued' | 'expensed' | 'vat_asset';
      let lockedShipment: Awaited<ReturnType<ImportSalesService['lockShipment']>> | null = null;
      if (vatAsset) {
        capitalizationState = 'vat_asset';
      } else if (!wantsCapitalize) {
        capitalizationState = 'expensed';
      } else {
        if (!effectiveShipmentId) {
          throw new BadRequestException('مصروف مخلص مرسمل يتطلب شحنة مرتبطة (من الإيصال أو من العهدة)؛ بلا شحنة لا يوجد مكان ترسمل فيه التكلفة. [IMPORT_BROKER_EXPENSE_NO_SHIPMENT]');
        }
        lockedShipment = await this.lockShipment(trx, tenantId, effectiveShipmentId);
        if (lockedShipment.receipt && lockedShipment.receipt.state === 'legacy_review_required') {
          throw new BadRequestException('لا يمكن تسوية مصروف مخلص مرسمل على شحنة استلامها مجمد للمراجعة؛ سوِّ المراجعة المعتمدة أولاً ثم أعد التسوية. [IMPORT_BROKER_EXPENSE_LEGACY_RECEIPT]');
        }
        capitalizationState = lockedShipment.receipt?.state === 'posted' ? 'revalued' : 'folded';
      }
      const expense = await trx
        .insertInto('import_broker_expenses')
        .values({
          tenant_id: tenantId,
          broker_id: dto.brokerId,
          advance_id: dto.advanceId ?? null,
          project_id: dto.projectId ?? advanceForValidation.project_id ?? null,
          shipment_id: dto.shipmentId ?? advanceForValidation.shipment_id ?? null,
          receipt_no: dto.receiptNo,
          expense_date: dto.expenseDate || await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date()),
          // P9 (RC-9): payment_date had NO writer — the DB CURRENT_DATE
          // default filled the database server's day. The default is
          // dropped by migration 0328, so the app supplies the tenant
          // day here (same value as before, correct clock).
          payment_date: await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date()),
          category: dto.category,
          amount_egp: dto.amountEgp,
          is_capitalized: dto.isCapitalized ?? true,
          is_refundable_vat: dto.isRefundableVat ?? false,
          attachment_url: dto.attachmentUrl || null,
          // Maker-checker (INV-IMPORT-BROKER-CAPITALISATION): the
          // liquidator never verifies their own expense. Verification
          // is a separate approval-gated step (verifyBrokerExpense);
          // created_by records the liquidator so that step can
          // enforce the separation.
          is_verified: false,
          verified_by: null,
          verified_at: null,
          notes: dto.notes || null,
          created_by: userId,
          capitalization_state: capitalizationState,
          late_expense_event_id: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (dto.advanceId) {
        const adv = await trx
          .selectFrom('import_broker_advances')
          .selectAll()
          .where('id', '=', dto.advanceId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirstOrThrow();

        const newSettled = Number(adv.settled_amount_egp || 0) + Number(dto.amountEgp);
        const newRemaining = Math.max(0, Number(adv.amount_egp) - newSettled);
        const newStatus = newRemaining <= 0.01 ? 'settled' : 'partially_settled';

        await trx
          .updateTable('import_broker_advances')
          .set({
            settled_amount_egp: Number(newSettled.toFixed(2)),
            remaining_amount_egp: Number(newRemaining.toFixed(2)),
            status: newStatus,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', dto.advanceId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // Path execution: the advance settlement above is bookkeeping
      // only. The GL effect arrives exactly once, through the path
      // decided before the insert. The old lump-sum Dr-inventory
      // journal is gone: it inflated the inventory account without
      // touching any lot, WAC pool or landed cost, and it double-
      // counted whenever the same cost also sat in a shipment
      // cost bucket.
      const advanceAccountId = await this.resolveTenantAccount(trx, tenantId, 'broker_advance');
      if (capitalizationState === 'folded') {
        const bucketDecision = resolveBrokerCapitalizationBucket(dto.category, vatAsset);
        if (!bucketDecision.bucket) {
          throw new BadRequestException(`فئة مصروف المخلص (${dto.category}) بلا بند تكلفة شحنة قبل الاستلام؛ سجّلها بعد ترحيل الاستلام لتُرسمل عبر التسوية، أو كأصل ضريبي إن كانت ضريبة مستردة. [IMPORT_BROKER_EXPENSE_NO_BUCKET]`);
        }
        const bucket = bucketDecision.bucket;
        await trx.insertInto('import_broker_capitalizations').values({
          tenant_id: tenantId,
          broker_expense_id: expense.id,
          shipment_id: effectiveShipmentId as string,
          cost_bucket: bucket,
          amount_egp: Number(dto.amountEgp),
          state: 'folded',
          late_expense_event_id: null,
          created_by: userId,
        }).execute();
        // Fold the amount into the bucket itself: the receipt
        // journal will carry it into landed cost, and the bucket
        // floor in updateShipmentCosts prevents removing it
        // afterwards. The fold creates no expenses row and no
        // journal: the cost reaches the GL once, at receipt.
        await trx.updateTable('import_shipments')
          .set((eb) => ({ [bucket]: sql`coalesce(${eb.ref(bucket)}, 0) + ${Number(dto.amountEgp)}` }))
          .where('tenant_id', '=', tenantId)
          .where('id', '=', effectiveShipmentId as string)
          .execute();
      } else if (capitalizationState === 'revalued') {
        const revaluation = await this.applyImportCostRevaluation(
          trx, tenantId, userId,
          lockedShipment!.shipment, lockedShipment!.receipt,
          {
            amount: Number(dto.amountEgp),
            title: `تسوية مخلص (${dto.category}) - إيصال #${dto.receiptNo}`,
            note: dto.notes || null,
            credit: { kind: 'broker_advance', accountId: advanceAccountId },
            brokerExpenseId: expense.id,
          },
        );
        await trx.insertInto('import_broker_capitalizations').values({
          tenant_id: tenantId,
          broker_expense_id: expense.id,
          shipment_id: effectiveShipmentId as string,
          cost_bucket: null,
          amount_egp: Number(dto.amountEgp),
          state: 'revalued',
          late_expense_event_id: revaluation.lateExpenseEventId,
          created_by: userId,
        }).execute();
        await trx.updateTable('import_broker_expenses')
          .set({ late_expense_event_id: revaluation.lateExpenseEventId })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', expense.id)
          .execute();
      } else {
        // Period expense or VAT asset: the money is spent and the
        // advance is relieved now. Capitalised treatment never
        // reaches this branch.
        let debitRole: 'vat_receivable' | 'cogs' = 'cogs';
        if (vatAsset) debitRole = 'vat_receivable';
        const debitAccId = await this.resolveTenantAccount(trx, tenantId, debitRole);

        const posting = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
        await posting.postDomainJournal(trx, {
          sourceType: 'import_broker_expense',
          sourceId: Number(expense.serial_id),
          tenantId,
          accountId: tenantId,
          entryDate: expense.expense_date ? new Date(expense.expense_date as any) : new Date(),
          description: `تسوية مصروف تخليص جمركي (${dto.category}) بإيصال #${dto.receiptNo}`,
          branchId: null,
          locationId: null,
          createdBy: userId,
          postedBy: userId,
          lines: [
            {
              accountId: debitAccId,
              debit: Number(dto.amountEgp),
              credit: 0,
              description: `تسوية مصاريف تخليص - إيصال #${dto.receiptNo} (${dto.category})`,
              partnerType: 'none',
              partnerId: null,
              branchId: null,
              locationId: null,
            },
            {
              accountId: advanceAccountId,
              debit: 0,
              credit: Number(dto.amountEgp),
              description: `تخفيض عهدة المخلص الجمركي بإيصال #${dto.receiptNo}`,
              partnerType: 'none',
              partnerId: null,
              branchId: null,
              locationId: null,
            },
          ],
        });
      }

      return expense;
    });
  }

  /**
   * Maker-checker verification of a liquidated broker expense
   * (INV-IMPORT-BROKER-CAPITALISATION). The liquidator never
   * verifies their own expense: the consumer must differ from
   * the expense's created_by, and must present a single-use
   * approval token bound to this exact expense id and amount
   * ceiling (the decision-time self-approval block in
   * decideApprovalRequest is the second leg). Verification
   * changes no amount, no journal and no capitalisation: it only
   * attests that a second person reviewed the evidence.
   */
  async verifyBrokerExpense(tenantId: string, userId: number, expenseId: string, dto: VerifyBrokerExpenseDto) {
    if (!dto.approvalRequestId) {
      throw new BadRequestException('التحقق من مصروف مخلص يتطلب موافقة Maker-Checker معتمدة.');
    }
    return await this.db.transaction().execute(async (trx) => {
      const expense = await trx.selectFrom('import_broker_expenses').selectAll()
        .where('tenant_id', '=', tenantId).where('id', '=', expenseId)
        .forUpdate().executeTakeFirst();
      if (!expense) throw new BadRequestException('مصروف المخلص غير تابع للمنشأة.');
      if (expense.is_verified) {
        throw new ConflictException('تم التحقق من مصروف المخلص مسبقاً.');
      }
      if (expense.created_by !== null && expense.created_by !== undefined && Number(expense.created_by) === userId) {
        throw new BadRequestException('مبدأ الرقابة الثنائية (Maker-Checker): لا يجوز لمن سوّى المصروف التحقق منه بنفسه. [IMPORT_BROKER_EXPENSE_SELF_VERIFICATION]');
      }
      await this.verifyAndConsumeApprovalRequest(trx, tenantId, 'broker_expense_verification', expenseId, dto.approvalRequestId, {
        brokerExpenseId: expenseId,
        amount: Number(expense.amount_egp),
      });
      return await trx.updateTable('import_broker_expenses')
        .set({ is_verified: true, verified_by: userId, verified_at: new Date() })
        .where('tenant_id', '=', tenantId).where('id', '=', expenseId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async getCustomsBrokerStatement(tenantId: string, brokerId: string) {
    const broker = await this.db
      .selectFrom('import_customs_brokers')
      .selectAll()
      .where('id', '=', brokerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();

    const advances = await this.db
      .selectFrom('import_broker_advances')
      .selectAll()
      .where('broker_id', '=', brokerId)
      .where('tenant_id', '=', tenantId)
      .orderBy('disbursement_date', 'asc')
      .execute();

    const expenses = await this.db
      .selectFrom('import_broker_expenses')
      .selectAll()
      .where('broker_id', '=', brokerId)
      .where('tenant_id', '=', tenantId)
      .orderBy('expense_date', 'asc')
      .execute();

    const totalAdvances = advances.reduce((acc, a) => acc + Number(a.amount_egp || 0), 0);
    const totalExpenses = expenses.reduce((acc, e) => acc + Number(e.amount_egp || 0), 0);
    const netBalanceDue = totalAdvances - totalExpenses;

    return {
      broker,
      advances,
      expenses,
      totalAdvances: Number(totalAdvances.toFixed(2)),
      totalExpenses: Number(totalExpenses.toFixed(2)),
      netBalanceDue: Number(netBalanceDue.toFixed(2)),
    };
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

  // I6-E: replay-or-fail-closed for a duplicate deposit write. The
  // insert runs inside one transaction with the treasury row and
  // the JE, so a 23505 means nothing was written and the existing
  // row (if any) is the complete record. Same key + same payload
  // is a retry: return the existing deposit (no second JE, no
  // second treasury row). Same key + different payload is a key
  // collision: fail closed with a named conflict. No row under
  // the key means the 23505 came from the (tenant, shipment,
  // container) unique constraint instead — one deposit per
  // container per shipment is the standing rule — also a named
  // conflict, never a raw violation.
  private async replayContainerDepositOrThrow(
    tenantId: string,
    dto: RecordContainerDepositDto,
    effectiveKey: string,
    originalError: any,
  ): Promise<any> {
    const existing: any = await this.db
      .selectFrom('import_container_deposits')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('idempotency_key', '=', effectiveKey)
      .executeTakeFirst();
    if (existing) {
      const samePayload =
        Number(existing.deposit_amount_egp) === Number(dto.depositAmountEgp) &&
        String(existing.shipping_line) === String(dto.shippingLine) &&
        String(existing.container_no) === String(dto.containerNo) &&
        String(existing.shipment_id) === String(dto.shipmentId) &&
        this.dateKey(existing.expected_return_date) === this.dateKey(dto.expectedReturnDate);
      if (samePayload) return existing;
      throw new ConflictException(
        'يوجد تأمين حاوية مسجل بنفس مفتاح عدم التكرار لكن ببيانات مختلفة؛ راجع التأمينات المسجلة قبل إعادة الإرسال. [IMPORT_CONTAINER_DEPOSIT_DUPLICATE_KEY]',
      );
    }
    const sameContainer: any = await this.db
      .selectFrom('import_container_deposits')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', dto.shipmentId)
      .where('container_no', '=', dto.containerNo)
      .executeTakeFirst();
    if (sameContainer) {
      throw new ConflictException(
        'تم تسجيل تأمين لهذه الحاوية في هذه الشحنة بالفعل؛ لا يمكن تسجيل تأمين ثانٍ لنفس الحاوية. [IMPORT_CONTAINER_DEPOSIT_ALREADY_RECORDED]',
      );
    }
    throw originalError;
  }

  async recordContainerDeposit(tenantId: string, userId: number, dto: RecordContainerDepositDto) {
    if (!Number.isFinite(Number(dto.depositAmountEgp)) || Number(dto.depositAmountEgp) <= 0) {
      throw new BadRequestException('تأمين الحاوية يجب أن يكون مبلغاً موجباً.');
    }
    // I6-E — idempotency contract (decision recorded in the
    // migration header and the DTO): the key is OPTIONAL on the
    // DTO. A caller that sends idempotencyKey owns the retry
    // identity; a caller that does not (the live form sends
    // exactly the DTO fields and no key, after I3-D8 removed the
    // dead field) gets a server-derived key from the natural key
    // (shipment + container), which migration 0238 already makes
    // unique per tenant. Requiring a client key would break the
    // live form until a frontend package wires it; deriving it
    // server-side makes every retry safe today, and the optional
    // client key is the forward contract for per-submit keys.
    const suppliedKey = typeof dto.idempotencyKey === 'string' ? dto.idempotencyKey.trim() : '';
    if (dto.idempotencyKey !== undefined && (!suppliedKey || suppliedKey.length > 128)) {
      throw new BadRequestException(
        'مفتاح عدم تكرار التأمين يجب أن يكون نصاً غير فارغ لا يتجاوز 128 حرفاً. [IMPORT_CONTAINER_DEPOSIT_KEY_INVALID]',
      );
    }
    const effectiveKey = suppliedKey || `deposit:${dto.shipmentId}:${dto.containerNo}`;
    try {
      return await this.db.transaction().execute(async (trx) => {
      const shipment = await trx.selectFrom('import_shipments').select('project_id')
        .where('tenant_id', '=', tenantId).where('id', '=', dto.shipmentId).executeTakeFirst();
      if (dto.projectId) {
        const project = await trx.selectFrom('import_projects').select('id')
          .where('tenant_id', '=', tenantId).where('id', '=', dto.projectId).executeTakeFirst();
        if (!project) throw new BadRequestException('مشروع تأمين الحاوية غير تابع للمنشأة.');
      }
      if (!shipment || (dto.projectId && shipment.project_id && shipment.project_id !== dto.projectId)) {
        throw new BadRequestException('حاوية التأمين لا تتبع مشروع الاستيراد المحدد في المنشأة.');
      }
      const deposit = await trx
        .insertInto('import_container_deposits')
        .values({
          tenant_id: tenantId,
          project_id: dto.projectId ?? null,
          shipment_id: dto.shipmentId,
          container_no: dto.containerNo,
          shipping_line: dto.shippingLine,
          deposit_amount_egp: dto.depositAmountEgp,
          payment_date: dto.paymentDate || await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date()),
          expected_return_date: dto.expectedReturnDate,
          refund_status: 'pending',
          refunded_amount_egp: 0,
          deductions_amount_egp: 0,
          treasury_account_id: dto.treasuryAccountId ? Number(dto.treasuryAccountId) : null,
          notes: dto.notes || null,
          idempotency_key: effectiveKey,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      {
        const depositAssetAccId = await this.resolveTenantAccount(trx, tenantId, 'container_deposit');
        const bankAccId = await this.resolveTenantAccount(
          trx,
          tenantId,
          'bank',
          dto.treasuryAccountId ? Number(dto.treasuryAccountId) : null
        );

        const bankScope = await trx.selectFrom('accounting_accounts').select('account_id')
          .where('tenant_id', '=', tenantId).where('id', '=', bankAccId).executeTakeFirstOrThrow();
        await trx.insertInto('treasury_transactions').values({
          tenant_id: tenantId, account_id: bankScope.account_id,
          txn_type: 'import_container_deposit', amount: -Number(dto.depositAmountEgp),
          note: `تأمين حاوية ${dto.containerNo} للخط الملاحي ${dto.shippingLine}`,
          reference_type: 'import_container_deposit', reference_id: Number(deposit.serial_id),
          created_by: userId,
        }).execute();
        const posting = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
        await posting.postDomainJournal(trx, {
          sourceType: 'import_container_deposit',
          sourceId: Number(deposit.serial_id),
          tenantId,
          accountId: tenantId,
          entryDate: deposit.payment_date ? new Date(deposit.payment_date as any) : new Date(),
          description: `سداد تأمين حاوية #${dto.containerNo} للخط الملاحي ${dto.shippingLine}`,
          branchId: null,
          locationId: null,
          createdBy: userId,
          postedBy: userId,
          lines: [
            {
              accountId: depositAssetAccId,
              debit: Number(dto.depositAmountEgp),
              credit: 0,
              description: `تأمين حاوية مسترد - #${dto.containerNo}`,
              partnerType: 'none',
              partnerId: null,
              branchId: null,
              locationId: null,
            },
            {
              accountId: bankAccId,
              debit: 0,
              credit: Number(dto.depositAmountEgp),
              description: `صرف تأمين حاوية للتوكيل الملاحي`,
              partnerType: 'none',
              partnerId: null,
              branchId: null,
              locationId: null,
            },
          ],
        });
      }

      return deposit;
    });
    } catch (err: any) {
      if (this.isUniqueViolation(err)) {
        return await this.replayContainerDepositOrThrow(tenantId, dto, effectiveKey, err);
      }
      throw err;
    }
  }

  async recordContainerReturnAndRefund(
    tenantId: string,
    userId: number,
    depositId: string,
    dto: RecordContainerReturnRefundDto
  ) {
    return await this.db.transaction().execute(async (trx) => {
      const deposit = await trx
        .selectFrom('import_container_deposits')
        .selectAll()
        .where('id', '=', depositId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const requestKey = String(dto.idempotencyKey || '').trim();
      if (!requestKey || requestKey.length > 128) throw new BadRequestException('مفتاح عدم التكرار للاسترداد إلزامي.');
      const previousEvent = await trx.selectFrom('import_container_refund_events').select('id')
        .where('tenant_id', '=', tenantId).where('deposit_id', '=', depositId)
        .where('idempotency_key', '=', requestKey).executeTakeFirst();
      if (previousEvent) throw new ConflictException('طلب استرداد التأمين بنفس المفتاح تم تسجيله مسبقًا.');
      const prevRefunded = Number(deposit.refunded_amount_egp || 0);
      const prevDeductions = Number(deposit.deductions_amount_egp || 0);
      const totalDeposit = Number(deposit.deposit_amount_egp);
      const remainingDeposit = Number((totalDeposit - prevRefunded - prevDeductions).toFixed(2));

      if (deposit.refund_status === 'refunded' || deposit.refund_status === 'forfeited' || remainingDeposit <= 0.001) {
        throw new BadRequestException('تمت تسوية واسترداد تأمين هذه الحاوية بالكامل مسبقاً، ولا يمكن تكرار الاسترداد.');
      }

      const currentRefund = Number(dto.refundedAmountEgp);
      const currentDeductions = Number(dto.deductionsAmountEgp || 0);
      const callSettled = Number((currentRefund + currentDeductions).toFixed(2));

      if (callSettled <= 0) {
        throw new BadRequestException('يجب تحديد مبلغ استرداد أو خصم أكبر من الصفر لتسوية التأمين.');
      }

      if (callSettled > remainingDeposit + 0.01) {
        throw new BadRequestException(
          `مجموع الاسترداد والخصومات (${callSettled.toFixed(2)}) يتجاوز الرصيد المتبقي من التأمين الأصلي (${remainingDeposit.toFixed(2)}).`
        );
      }

      const newTotalRefunded = Number((prevRefunded + currentRefund).toFixed(2));
      const newTotalDeductions = Number((prevDeductions + currentDeductions).toFixed(2));
      const newRemaining = Number((totalDeposit - newTotalRefunded - newTotalDeductions).toFixed(2));

      let newStatus = 'partially_refunded';
      if (newRemaining <= 0.01) {
        newStatus = newTotalRefunded > 0 ? 'refunded' : 'forfeited';
      }

      const refundEvent = await trx.insertInto('import_container_refund_events').values({
        tenant_id: tenantId, deposit_id: depositId, idempotency_key: requestKey,
        refunded_amount_egp: currentRefund, deductions_amount_egp: currentDeductions,
        treasury_account_id: dto.treasuryAccountId ? Number(dto.treasuryAccountId) : null,
        created_by: userId, journal_entry_id: null,
      }).returning(['id', 'serial_id']).executeTakeFirstOrThrow();

      const updated = await trx
        .updateTable('import_container_deposits')
        .set({
          actual_return_date: dto.actualReturnDate,
          refund_status: newStatus,
          refunded_amount_egp: newTotalRefunded,
          deductions_amount_egp: newTotalDeductions,
          deduction_reason: dto.deductionReason || deposit.deduction_reason || null,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', depositId)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('import_shipments')
        .set({
          container_status: 'empty_returned',
          empty_returned_date: dto.actualReturnDate,
        })
        .where('id', '=', deposit.shipment_id)
        .where('tenant_id', '=', tenantId)
        .execute();

      const depositAssetAccId = await this.resolveTenantAccount(trx, tenantId, 'container_deposit');
      const bankAccId = await this.resolveTenantAccount(
        trx,
        tenantId,
        'bank',
        dto.treasuryAccountId ? Number(dto.treasuryAccountId) : null
      );
      const expenseAccId = await this.resolveTenantAccount(trx, tenantId, 'cogs');

      if (currentRefund > 0) {
        // Record actual receipt in treasury as well as the balanced GL journal; never create cash for penalties alone.
        const cashScope = await trx.selectFrom('accounting_accounts').select('account_id')
          .where('tenant_id', '=', tenantId).where('id', '=', bankAccId).executeTakeFirstOrThrow();
        await trx.insertInto('treasury_transactions').values({
          tenant_id: tenantId, account_id: cashScope.account_id, txn_type: 'import_container_refund',
          amount: currentRefund, note: `استرداد تأمين حاوية #${deposit.container_no}`,
          reference_type: 'import_container_refund', reference_id: Number(refundEvent.serial_id),
          return_document_id: null, branch_id: null, location_id: null, created_by: userId,
        }).execute();
      }

      const lines: any[] = [];
      if (currentRefund > 0) {
        lines.push({
          accountId: bankAccId,
          debit: currentRefund,
          credit: 0,
          description: `استرداد نقدي/بنكي لتأمين حاوية #${deposit.container_no}`,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      }
      if (currentDeductions > 0) {
        lines.push({
          accountId: expenseAccId,
          debit: currentDeductions,
          credit: 0,
          description: `غرامات تأخير/أضرار حاوية #${deposit.container_no} مخصومة من التأمين`,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      }
      if (callSettled > 0) {
        lines.push({
          accountId: depositAssetAccId,
          debit: 0,
          credit: callSettled,
          description: `تسوية وإقفال تأمين حاوية مستردة #${deposit.container_no}`,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      }

      const postingService = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const refundJournalEntryId = await postingService.postDomainJournal(trx, {
        sourceType: 'import_container_refund',
        sourceId: Number(refundEvent.serial_id),
        tenantId,
        accountId: tenantId,
        entryDate: new Date(dto.actualReturnDate as any),
        description: `تسوية واسترداد تأمين حاوية #${deposit.container_no} من الخط الملاحي (مبلغ مسوى: ${callSettled})`,
        branchId: null,
        locationId: null,
        createdBy: userId,
        postedBy: userId,
        lines,
      });
      await trx.updateTable('import_container_refund_events').set({ journal_entry_id: refundJournalEntryId })
        .where('id', '=', refundEvent.id).where('tenant_id', '=', tenantId).execute();

      return updated;
    });
  }

  async listContainerDeposits(tenantId: string, shipmentId?: string) {
    let q = this.db.selectFrom('import_container_deposits').selectAll().where('tenant_id', '=', tenantId);
    if (shipmentId) q = q.where('shipment_id', '=', shipmentId);
    return await q.orderBy('created_at', 'desc').execute();
  }

  // -------------------------------------------------------------
  // IN-TRANSIT CONTAINER PRE-ORDERS (حجز البضاعة العايمة قبل الوصول)
  // -------------------------------------------------------------
  // I6-E: replay-or-fail-closed for a duplicate preorder write.
  // Same key + same payload is a retry: return the existing
  // reservation (no second B/L capacity consumed, no second
  // advance JE). Same key + different payload is a key
  // collision: fail closed with a named conflict. No row under
  // the key means the 23505 came from elsewhere — rethrow.
  private async replayContainerPreorderOrThrow(
    tenantId: string,
    dto: CreateContainerPreorderDto,
    effectiveKey: string,
    originalError: any,
  ): Promise<any> {
    const existing: any = await this.db
      .selectFrom('import_container_preorders')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('idempotency_key', '=', effectiveKey)
      .executeTakeFirst();
    if (!existing) throw originalError;
    const samePayload =
      String(existing.shipment_id) === String(dto.shipmentId) &&
      Number(existing.customer_id) === Number(dto.customerId) &&
      Number(existing.product_id) === Number(dto.productId) &&
      Number(existing.reserved_quantity) === Number(dto.reservedQuantity) &&
      Number(existing.unit_price_egp) === Number(dto.unitPriceEgp) &&
      Number(existing.deposit_amount_egp) === Number(dto.depositAmountEgp || 0);
    if (samePayload) return existing;
    throw new ConflictException(
      'يوجد حجز بضاعة عايمة مسجل بنفس مفتاح عدم التكرار لكن ببيانات مختلفة؛ راجع الحجوزات المسجلة قبل إعادة الإرسال. [IMPORT_CONTAINER_PREORDER_DUPLICATE_KEY]',
    );
  }

  async createContainerPreorder(tenantId: string, userId: number, dto: CreateContainerPreorderDto) {
    // I6-E — idempotency contract, same shape as deposits: the key
    // is OPTIONAL on the DTO. A caller that sends idempotencyKey
    // owns the retry identity; a caller that does not (the live
    // form sends exactly the DTO fields and no key, after I4-D12
    // removed the dead field) gets a server-derived key from the
    // reservation identity — shipment + customer + product + qty +
    // unit price + deposit. A retry sends the identical payload,
    // so it replays; a genuinely different reservation gets a
    // different key. Known limit: two intentionally identical
    // reservations with no client key are indistinguishable from
    // a retry and the second returns the first; sending a client
    // key removes the ambiguity.
    const suppliedKey = typeof dto.idempotencyKey === 'string' ? dto.idempotencyKey.trim() : '';
    if (dto.idempotencyKey !== undefined && (!suppliedKey || suppliedKey.length > 128)) {
      throw new BadRequestException(
        'مفتاح عدم تكرار الحجز يجب أن يكون نصاً غير فارغ لا يتجاوز 128 حرفاً. [IMPORT_CONTAINER_PREORDER_KEY_INVALID]',
      );
    }
    const effectiveKey =
      suppliedKey ||
      `preorder:${dto.shipmentId}:${dto.customerId}:${dto.productId}:${Number(dto.reservedQuantity)}:${Number(dto.unitPriceEgp)}:${Number(dto.depositAmountEgp || 0)}`;
    try {
      return await this.db.transaction().execute(async (trx) => {
      const shipment = await trx
        .selectFrom('import_shipments')
        .selectAll()
        .where('id', '=', dto.shipmentId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // INV-IMPORT-FLOATING-RESERVATION: a floating-goods reservation is
      // a PRE-RECEIPT allotment of B/L capacity. Once the container has
      // arrived (status 'Arrived', which posts the receipt) or any
      // inventory receipt row exists for it, the goods are stock, not
      // floating goods: a new reservation is refused fail-closed.
      // Existing reservations stay convertible to a sale through
      // convertPreorderToSale, which is the post-arrival path.
      if (shipment.status === 'Arrived') {
        throw new BadRequestException('وصلت الحاوية وتم استلامها؛ لا يمكن تسجيل حجز بضاعة عايمة جديد بعد الوصول.');
      }
      const receiptRow = await trx
        .selectFrom('import_inventory_receipts')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', dto.shipmentId)
        .executeTakeFirst();
      if (receiptRow) {
        throw new BadRequestException('تم ترحيل استلام الحاوية للمخزون؛ لا يمكن تسجيل حجز بضاعة عايمة جديد بعد الاستلام.');
      }

      const itemRows = await trx
        .selectFrom('import_shipment_items')
        .select(['quantity', 'received_quantity'])
        .where('shipment_id', '=', dto.shipmentId)
        .where('product_id', '=', Number(dto.productId))
        .where('tenant_id', '=', tenantId)
        .execute();

      if (!itemRows.length) {
        throw new BadRequestException('هذا الصنف غير مدرج في هذه الشحنة.');
      }
      // The same SKU can be represented by several distinct shipment lines.
      const customer = await trx.selectFrom('customers').select('id')
        .where('tenant_id', '=', tenantId).where('id', '=', Number(dto.customerId)).executeTakeFirst();
      if (!customer) throw new BadRequestException('العميل المحدد لا ينتمي لهذه المنشأة.');
      if (dto.projectId && shipment.project_id && dto.projectId !== shipment.project_id) {
        throw new BadRequestException('مشروع الحجز لا يطابق مشروع الشحنة.');
      }
      const blQuantity = itemRows.reduce((sum, row) => sum + Number(row.received_quantity ?? row.quantity), 0);

      const existingOrders = await trx
        .selectFrom('import_container_preorders')
        .select('reserved_quantity')
        .where('shipment_id', '=', dto.shipmentId)
        .where('product_id', '=', Number(dto.productId))
        .where('tenant_id', '=', tenantId)
        .where('status', 'in', ['reserved', 'allocated', 'invoiced'])
        .execute();

      const alreadyReserved = existingOrders.reduce((acc, o) => acc + Number(o.reserved_quantity), 0);
      const requested = Number(dto.reservedQuantity);

      // Validate BEFORE the insert: the deposit rule used to be checked
      // after the insert (the throw rolled the transaction back, so no
      // row survived — but a fail-closed check belongs before the write).
      if (!Number.isFinite(requested) || requested <= 0) {
        throw new BadRequestException('الكمية المحجوزة يجب أن تكون أكبر من صفر.');
      }
      const totalPrice = Number((requested * Number(dto.unitPriceEgp)).toFixed(2));
      const depositAmount = Number(dto.depositAmountEgp || 0);
      if (!Number.isFinite(depositAmount) || depositAmount < 0 || depositAmount > totalPrice) {
        throw new BadRequestException('قيمة العربون يجب أن تكون موجبة ولا تتجاوز إجمالي قيمة الحجز.');
      }

      if (alreadyReserved + requested > blQuantity) {
        const freeToReserve = Math.max(0, blQuantity - alreadyReserved);
        throw new BadRequestException(
          `لا يمكن تجاوز كمية البوليصة: المتاح للحجز فقط (${freeToReserve}) وحدة من إجمالي (${blQuantity})، والمطلوب (${requested}).`
        );
      }

      const preorder = await trx
        .insertInto('import_container_preorders')
        .values({
          tenant_id: tenantId,
          preorder_no: `PRE-${randomUUID()}`,
          project_id: shipment.project_id ?? dto.projectId ?? null,
          shipment_id: dto.shipmentId,
          customer_id: Number(dto.customerId),
          product_id: Number(dto.productId),
          reserved_quantity: requested,
          unit_price_egp: dto.unitPriceEgp,
          total_price_egp: totalPrice,
          deposit_amount_egp: depositAmount,
          deposit_treasury_account_id: dto.depositTreasuryAccountId ? Number(dto.depositTreasuryAccountId) : null,
          status: 'reserved',
          expected_delivery_date: dto.expectedDeliveryDate || null,
          notes: dto.notes || null,
          created_by: userId,
          idempotency_key: effectiveKey,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (depositAmount > 0) {
        const bankAccId = await this.resolveTenantAccount(
          trx,
          tenantId,
          'bank',
          dto.depositTreasuryAccountId ? Number(dto.depositTreasuryAccountId) : null
        );
        const unearnedRevAccId = await this.resolveTenantAccount(trx, tenantId, 'customer_advance');

        const scope = await trx.selectFrom('accounting_accounts').select('account_id')
          .where('tenant_id', '=', tenantId).where('id', '=', bankAccId).executeTakeFirstOrThrow();
        await trx.insertInto('treasury_transactions').values({
          tenant_id: tenantId, account_id: scope.account_id,
          txn_type: 'import_customer_advance', amount: depositAmount,
          note: `عربون حجز حاوية #${preorder.preorder_no}`,
          reference_type: 'import_container_preorder',
          reference_id: Number(preorder.serial_id), created_by: userId,
        }).execute();
        const postingService = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
        await postingService.postDomainJournal(trx, {
          sourceType: 'import_container_preorder',
          sourceId: Number(preorder.serial_id),
          tenantId,
          accountId: tenantId,
          entryDate: new Date(),
          description: `عربون حجز بضاعة عايمة للعميل #${dto.customerId} - حجز #${preorder.preorder_no}`,
          branchId: null,
          locationId: null,
          createdBy: userId,
          postedBy: userId,
          lines: [
            {
              accountId: bankAccId,
              debit: depositAmount,
              credit: 0,
              description: `تحصيل عربون حجز بضاعة شحنة #${dto.shipmentId}`,
              partnerType: 'customer',
              partnerId: Number(dto.customerId),
              branchId: null,
              locationId: null,
            },
            {
              accountId: unearnedRevAccId,
              debit: 0,
              credit: depositAmount,
              description: `أمانات/عربونات عملاء غير محققة - حجز #${preorder.preorder_no}`,
              partnerType: 'customer',
              partnerId: Number(dto.customerId),
              branchId: null,
              locationId: null,
            },
          ],
        });
      }

      return preorder;
    });
    } catch (err: any) {
      if (this.isUniqueViolation(err)) {
        return await this.replayContainerPreorderOrThrow(tenantId, dto, effectiveKey, err);
      }
      throw err;
    }
  }

  async listContainerPreorders(tenantId: string, shipmentId?: string, customerId?: string) {
    let q = this.db
      .selectFrom('import_container_preorders as po')
      .leftJoin('customers as c', 'c.id', 'po.customer_id')
      .leftJoin('products as p', 'p.id', 'po.product_id')
      .selectAll('po')
      .select(['c.name as customer_name', 'p.name as product_name'])
      .where('po.tenant_id', '=', tenantId);
    if (shipmentId) q = q.where('po.shipment_id', '=', shipmentId);
    if (customerId) q = q.where('po.customer_id', '=', Number(customerId));
    return await q.orderBy('po.created_at', 'desc').execute();
  }

  /** Refunds are append-only GL source events; original deposits remain immutable. */
  async refundContainerPreorder(tenantId: string, userId: number, preorderId: string, dto: RefundImportPreorderDto) {
    return this.db.transaction().execute(async (trx) => {
      const preorder = await trx.selectFrom('import_container_preorders').selectAll()
        .where('tenant_id', '=', tenantId).where('id', '=', preorderId).forUpdate().executeTakeFirstOrThrow();
      if (preorder.status === 'invoiced' || preorder.status === 'cancelled') {
        throw new BadRequestException('لا يجوز رد عربون حجز مفوتر أو ملغى.');
      }
      const requestKey = String(dto.idempotencyKey || '').trim();
      if (!requestKey || requestKey.length > 128) throw new BadRequestException('مفتاح عدم تكرار الرد إلزامي.');
      const existing = await trx.selectFrom('import_preorder_refund_events').select('id')
        .where('tenant_id', '=', tenantId).where('preorder_id', '=', preorderId)
        .where('idempotency_key', '=', requestKey).executeTakeFirst();
      if (existing) throw new ConflictException('رد العربون بنفس المفتاح مسجل بالفعل.');
      const amount = Number(dto.amountEgp);
      const remaining = Number((Number(preorder.deposit_amount_egp || 0) - Number(preorder.refunded_amount_egp || 0)).toFixed(2));
      if (!Number.isFinite(amount) || amount <= 0 || Number(amount.toFixed(2)) !== amount || amount > remaining + 0.001) {
        throw new BadRequestException('مبلغ الرد أكبر من العربون المتبقي أو غير صالح.');
      }
      const preferred = Number(dto.treasuryAccountId || preorder.deposit_treasury_account_id || 0);
      const bankAccountId = await this.resolveTenantAccount(trx, tenantId, 'bank', preferred || undefined);
      const liabilityAccountId = await this.resolveTenantAccount(trx, tenantId, 'customer_advance');
      const bankScope = await trx.selectFrom('accounting_accounts').select('account_id')
        .where('tenant_id', '=', tenantId).where('id', '=', bankAccountId).executeTakeFirstOrThrow();
      const event = await trx.insertInto('import_preorder_refund_events').values({
        tenant_id: tenantId, preorder_id: preorderId, idempotency_key: requestKey,
        amount_egp: amount, treasury_account_id: bankAccountId, created_by: userId,
      }).returning(['id', 'serial_id']).executeTakeFirstOrThrow();
      await trx.insertInto('treasury_transactions').values({
        tenant_id: tenantId, account_id: bankScope.account_id,
        txn_type: 'import_customer_advance_refund', amount: -amount,
        note: `رد عربون حجز ${preorder.preorder_no}`,
        reference_type: 'import_preorder_refund', reference_id: Number(event.serial_id), created_by: userId,
      }).execute();
      const posting = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const journalId = await posting.postDomainJournal(trx, {
        sourceType: 'import_preorder_refund', sourceId: Number(event.serial_id),
        tenantId, accountId: bankScope.account_id,
        entryDate: new Date(), description: `رد عربون حجز ${preorder.preorder_no}`,
        branchId: null, locationId: null, createdBy: userId, postedBy: userId,
        lines: [
          { accountId: liabilityAccountId, debit: amount, credit: 0,
            description: 'تخفيض التزام العربون المسترد', partnerType: 'customer',
            partnerId: Number(preorder.customer_id), branchId: null, locationId: null },
          { accountId: bankAccountId, debit: 0, credit: amount,
            description: 'صرف رد عربون للعميل', partnerType: 'customer',
            partnerId: Number(preorder.customer_id), branchId: null, locationId: null },
        ],
      });
      await trx.updateTable('import_preorder_refund_events').set({ journal_entry_id: journalId })
        .where('tenant_id', '=', tenantId).where('id', '=', event.id).execute();
      const updated = await trx.updateTable('import_container_preorders').set({
        refunded_amount_egp: Number((Number(preorder.refunded_amount_egp || 0) + amount).toFixed(2)),
        updated_at: sql`NOW()`,
      }).where('tenant_id', '=', tenantId).where('id', '=', preorderId).returningAll().executeTakeFirstOrThrow();
      return { success: true, preorder: updated, refundEventId: event.id, journalEntryId: journalId };
    });
  }

  async cancelContainerPreorder(tenantId: string, preorderId: string, reason?: string) {
    return await this.db.transaction().execute(async (trx) => {
      const preorder = await trx
        .selectFrom('import_container_preorders')
        .selectAll()
        .where('id', '=', preorderId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (preorder.status === 'invoiced' || preorder.status === 'cancelled') {
        throw new BadRequestException('الحجز مفوتر أو ملغى بالفعل.');
      }
      if (Number(preorder.deposit_amount_egp || 0) - Number(preorder.refunded_amount_egp || 0) > 0.001) {
        throw new BadRequestException('لا يمكن إلغاء حجز بعربون قبل رد المبلغ وتسوية التزام العميل محاسبياً.');
      }

      return await trx
        .updateTable('import_container_preorders')
        .set({
          status: 'cancelled',
          notes: reason ? `${preorder.notes || ''} [سبب الإلغاء: ${reason}]` : preorder.notes,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', preorderId)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
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
    return await this.db.transaction().execute(async (trx) => {
      const preorder = await trx
        .selectFrom('import_container_preorders')
        .selectAll()
        .where('id', '=', preorderId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!preorder) throw new NotFoundException('حجز الحاوية غير موجود');
      if (preorder.status === 'invoiced') throw new BadRequestException('تم إصدار فاتورة لهذا الحجز مسبقاً');
      if (preorder.status === 'cancelled') throw new BadRequestException('الحجز ملغى ولا يمكن تحويله لفاتورة');

      const customer = await trx
        .selectFrom('customers')
        .select(['id', 'name', 'phone'])
        .where('id', '=', preorder.customer_id)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      const product = await trx
        .selectFrom('products')
        .select(['id', 'name', 'sku', 'account_id', 'cost_price'])
        .where('id', '=', preorder.product_id)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      const qty = Number(preorder.reserved_quantity);
      const unitPrice = Number(
        (preorder as any).unit_price_egp ?? (preorder as any).agreed_unit_price_egp ?? 0,
      );
      const total = Number((qty * unitPrice).toFixed(2));
      const depositAmount = Math.max(
        0,
        Number((Number(preorder.deposit_amount_egp || 0) - Number((preorder as any).refunded_amount_egp || 0)).toFixed(2)),
      );
      const appliedDeposit = Math.min(depositAmount, total);
      const balanceDue = Math.max(0, Number((total - appliedDeposit).toFixed(2)));

      // P10 guard (INV-IMPORT-PREARRIVAL-CONVERSION-GUARD): a container
      // preorder may only become a sale once the goods have physically
      // arrived AND been posted into stock. A receipt in state 'posted'
      // is the proof of arrival (the same test the late-expense and
      // broker paths already use); active lots for THIS shipment and
      // product whose remaining quantity covers the full preorder
      // quantity are the proof of allocation. Anything less fails
      // closed here, before any write — no stock deduction, no sale,
      // no journal, and no COGS credited against inventory that was
      // never debited. The preorder row is already locked above and
      // the lot rows are locked below, so a concurrent receipt
      // reversal (which zeroes lots and flips preorders back to
      // reserved) serialises against this check instead of racing it.
      const postedReceipt = await trx
        .selectFrom('import_inventory_receipts')
        .select(['id', 'state'])
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', preorder.shipment_id)
        .where('state', '=', 'posted')
        .forUpdate()
        .executeTakeFirst();
      if (!postedReceipt) {
        throw new BadRequestException(
          `لا يمكن تحويل الحجز إلى بيع قبل استلام مرحّل للشحنة: لا يوجد إيصال بحالة مرحّل. [IMPORT_PREORDER_CONVERSION_NO_POSTED_RECEIPT]`,
        );
      }
      const coveringLots = await trx
        .selectFrom('import_inventory_lots')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', preorder.shipment_id)
        .where('product_id', '=', preorder.product_id)
        .where('status', '=', 'active')
        .forUpdate()
        .orderBy('id')
        .execute();
      const allocatedQty = coveringLots.reduce(
        (sum, l) => sum + Number((l as any).remaining_quantity || 0),
        0,
      );
      if (allocatedQty + 0.0001 < qty) {
        throw new BadRequestException(
          `لا يمكن تحويل الحجز إلى بيع: الحصص المخصصة للشحنة (${allocatedQty}) أقل من كمية الحجز (${qty}). [IMPORT_PREORDER_CONVERSION_NOT_ALLOCATED]`,
        );
      }
      const lot = coveringLots[0];

      const branchId = dto.branchId || lot?.branch_id || 1;
      const locationId = dto.locationId || lot?.location_id || 1;

      // The P10 lot guard above proves this shipment's lots cover the
      // full quantity, so the deduction must never drive the location
      // balance negative: allowNegative is false, and a diverged
      // physical balance fails closed (INSUFFICIENT_STOCK) instead of
      // minting negative stock. The canonical delta result carries
      // the true scope before/after quantities stamped on the
      // movement row below.
      let stockDelta: { scopeBefore: number; scopeAfter: number } | null = null;
      if (product) {
        await lockStockProducts(trx as any, {
          tenantId,
          accountId: (product as any).account_id || tenantId,
          productIds: [Number(preorder.product_id)],
        });
        stockDelta = await applyStockDelta(trx as any, {
          tenantId,
          accountId: (product as any).account_id || tenantId,
          productId: Number(preorder.product_id),
          delta: -qty,
          branchId,
          locationId,
          allowNegative: false,
        });
      }

      // Create Sale Record
      const saleInsert = await trx
        .insertInto('sales')
        .values({
          customer_id: preorder.customer_id,
          customer_name: customer?.name || 'عميل حجز حاوية',
          customer_phone: customer?.phone || null,
          payment_type: appliedDeposit >= total ? 'cash' : (appliedDeposit > 0 ? 'split' : 'credit'),
          payment_channel: 'cash',
          subtotal: total,
          discount: 0,
          tax_rate: 0,
          tax_amount: 0,
          total: total,
          paid_amount: appliedDeposit,
          applied_amount: appliedDeposit,
          tendered_amount: appliedDeposit,
          change_amount: 0,
          status: 'posted',
          note: `فاتورة مبيعات محولة آلياً من حجز حاوية مسبق [حجز #${preorder.id.slice(0, 8)}] - دفعة مقدمة مسواة: ${appliedDeposit} ج.م`,
          branch_id: branchId,
          location_id: locationId,
          created_by: userId,
          tenant_id: tenantId,
          account_id: (product as any)?.account_id || tenantId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const saleId = Number(saleInsert.id);
      const docNo = `INV-IMP-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(saleId).padStart(4, '0')}`;
      await trx
        .updateTable('sales')
        .set({ doc_no: docNo, updated_at: sql`NOW()` })
        .where('id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .execute();

      // Insert Sale Item
      const saleItemInsert = await trx
        .insertInto('sale_items')
        .values({
          sale_id: saleId,
          product_id: preorder.product_id,
          product_name: product?.name || 'صنف مستورد',
          qty: qty,
          unit_price: unitPrice,
          line_total: total,
          net_unit_price: unitPrice,
          net_line_total: total,
          allocated_discount: 0,
          allocated_tax: 0,
          tenant_id: tenantId,
          account_id: (product as any)?.account_id || tenantId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      // Allocate from Import Lot to deplete remaining quantity and maintain project lineage
      const lotAllocation = await allocateSaleFromImportLots(trx, {
        tenantId,
        saleId,
        locationId,
        items: [
          {
            itemId: Number(saleItemInsert.id),
            productId: preorder.product_id,
            qty: qty,
            netUnitPrice: unitPrice,
            locationId,
          },
        ],
      });

      const saleAllocs = await trx
        .selectFrom('import_sale_allocations')
        .select(['quantity', 'unit_cost_egp'])
        .where('tenant_id', '=', tenantId)
        .where('sale_id', '=', saleId)
        .execute();

      // Cross-check: the helper's coverage must agree with the rows it just
      // wrote. Any disagreement is an internal inconsistency, not a costing
      // input to be averaged away — fail closed instead of posting a cost
      // built from two different pictures of the same allocation.
      const coverage = lotAllocation.items[0];
      if (!coverage) {
        throw new BadRequestException('IMPORT_SALE_ALLOCATION_MISSING: lot allocation returned no coverage for the converted sale item.');
      }
      const dbAllocatedQty = Number(saleAllocs.reduce((sum, a) => sum + Number(a.quantity || 0), 0).toFixed(4));
      if (Math.abs(dbAllocatedQty - coverage.allocatedQty) > 0.0001) {
        throw new BadRequestException(
          `IMPORT_SALE_ALLOCATION_MISMATCH: helper coverage (${coverage.allocatedQty}) disagrees with stored allocations (${dbAllocatedQty}) for sale ${saleId}; conversion refused rather than posting a reconciled cost.`,
        );
      }
      const allocCostEgp = saleAllocs.reduce(
        (acc, a) => acc + Number(a.quantity || 0) * Number(a.unit_cost_egp || 0),
        0,
      );
      // Shortfall top-up: uncovered units are costed at the shipment lot's
      // landed cost, else current WAC (products.cost_price). This preserves
      // the old fully-uncovered behaviour exactly (shortfall == qty, so the
      // total equals the old fallback) and generalises it to partial
      // coverage, where the old code silently dropped the uncovered units'
      // cost. The fallback lot here is shipment-scoped, not
      // location-scoped (same as before); WAC remains the GL basis for
      // ordinary POS sales and is the fallback of last resort here.
      const fallbackUnitCostEgp = Number(lot?.unit_landed_cost_egp || (product as any)?.cost_price || 0);
      const saleCost = calculateImportSaleCost({
        qty,
        allocatedQty: coverage.allocatedQty,
        allocCostEgp,
        fallbackUnitCostEgp,
      });
      const totalCostEgp = saleCost.totalCostEgp;
      const unitCostEgp = saleCost.unitCostEgp;

      // Guarantee, part 1: a stock-reducing sale (qty > 0) never completes
      // with stock decreased and no COGS/inventory pair. insertPostedJournal
      // rejects 0/0 lines (INVALID_JOURNAL_LINE), so a zero-cost pair cannot
      // be posted literally — the honest guarantee is fail-closed: when no
      // cost is knowable at all (no lot cost and WAC is 0), the whole
      // conversion rolls back and the preorder stays un-invoiced, instead
      // of the books silently diverging. A genuine zero-cost stock policy
      // needs an explicit, recorded override decision — not a silent
      // omission (see the note after the journal block).
      if (qty > 0 && totalCostEgp <= 0) {
        throw new BadRequestException(
          `IMPORT_SALE_ZERO_COST: cannot convert preorder ${preorder.id} — sale quantity ${qty} has no knowable cost ` +
          `(allocated ${coverage.allocatedQty} via lots, shortfall ${saleCost.shortfallQty}, ` +
          `fallback unit cost ${fallbackUnitCostEgp}). Set the lot landed cost or the product cost_price and retry.`,
        );
      }

      // The frozen unit cost is always recorded on the sale item, even when
      // it rounds to zero — the gate above, not this write, decides whether
      // the sale may complete. (Previously the write was skipped for a zero
      // unit cost, leaving a stale/default cost_price on the item.)
      await trx
        .updateTable('sale_items')
        .set({ cost_price: unitCostEgp } as any)
        .where('id', '=', saleItemInsert.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      if (product) {
        await trx
          .insertInto('stock_movements')
          .values({
            tenant_id: tenantId,
            account_id: (product as any).account_id || tenantId,
            product_id: preorder.product_id,
            branch_id: branchId,
            location_id: locationId,
            movement_type: 'sale',
            qty: -qty,
            before_qty: stockDelta?.scopeBefore ?? null,
            after_qty: stockDelta?.scopeAfter ?? null,
            unit_cost: unitCostEgp,
            reference_type: 'sale',
            reference_id: saleId,
            note: `صرف مخزني لتحويل حجز حاوية مسبق #${docNo}`,
            created_by: userId,
          } as any)
          .execute();
      }

      if (balanceDue > 0 && preorder.customer_id) {
        await trx
          .updateTable('customers')
          .set({
            balance: sql`COALESCE(balance, 0) + ${balanceDue}`,
          } as any)
          .where('id', '=', preorder.customer_id)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // Guarantee, part 2: the COGS pair is decoupled from the revenue
      // total. Previously the whole journal was gated on `total > 0`, so a
      // free sale (unit price 0) with a positive cost posted NO journal at
      // all — stock decreased, COGS never posted. Now the journal posts
      // whenever revenue or cost is positive; the revenue line is added
      // only when total > 0 (a 0/0 line would be rejected by
      // insertPostedJournal), and the COGS/inventory pair is unconditional
      // inside this block because the zero-cost throw above guarantees
      // totalCostEgp > 0 whenever this block is reached with qty > 0.
      if (total > 0 || totalCostEgp > 0) {
        const journalLines: Array<{
          accountId: number;
          debit: number;
          credit: number;
          description: string;
          partnerType: 'customer' | 'supplier' | 'none';
          partnerId: number | null;
          branchId: number | null;
          locationId: number | null;
        }> = [];

        if (appliedDeposit > 0) {
          const customerAdvanceAccId = await this.resolveTenantAccount(trx, tenantId, 'customer_advance');
          journalLines.push({
            accountId: customerAdvanceAccId,
            debit: appliedDeposit,
            credit: 0,
            description: `تسوية دفعة مقدمة حجز حاوية للفاتورة #${docNo}`,
            partnerType: preorder.customer_id ? 'customer' : 'none',
            partnerId: preorder.customer_id ? Number(preorder.customer_id) : null,
            branchId,
            locationId,
          });
        }

        if (balanceDue > 0) {
          const receivableAccId = await this.resolveTenantAccount(trx, tenantId, 'receivable');
          journalLines.push({
            accountId: receivableAccId,
            debit: balanceDue,
            credit: 0,
            description: `استحقاق عميل فاتورة مبيعات حجز حاوية #${docNo}`,
            partnerType: preorder.customer_id ? 'customer' : 'none',
            partnerId: preorder.customer_id ? Number(preorder.customer_id) : null,
            branchId,
            locationId,
          });
        }

        if (total > 0) {
          const revenueAccId = await this.resolveTenantAccount(trx, tenantId, 'sales_revenue');
          journalLines.push({
            accountId: revenueAccId,
            debit: 0,
            credit: total,
            description: `إيراد مبيعات تحويل حجز حاوية #${docNo}`,
            partnerType: preorder.customer_id ? 'customer' : 'none',
            partnerId: preorder.customer_id ? Number(preorder.customer_id) : null,
            branchId,
            locationId,
          });
        }

        const cogsAccId = await this.resolveTenantAccount(trx, tenantId, 'cogs');
        const inventoryAccId = await this.resolveTenantAccount(trx, tenantId, 'inventory');
        journalLines.push(
          {
            accountId: cogsAccId,
            debit: totalCostEgp,
            credit: 0,
            description: `تكلفة البضاعة المباعة لحجز الحاوية #${docNo}`,
            partnerType: 'none',
            partnerId: null,
            branchId,
            locationId,
          },
          {
            accountId: inventoryAccId,
            debit: 0,
            credit: totalCostEgp,
            description: `تخفيض المخزون المستورد لحجز الحاوية #${docNo}`,
            partnerType: 'none',
            partnerId: null,
            branchId,
            locationId,
          },
        );

        const posting = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
        await posting.postDomainJournal(trx, {
          sourceType: 'sale',
          sourceId: saleId,
          tenantId,
          accountId: (product as any)?.account_id || tenantId,
          entryDate: new Date(),
          description: `فاتورة مبيعات حجز حاوية مستوردة #${docNo}`,
          branchId,
          locationId,
          createdBy: userId,
          postedBy: userId,
          lines: journalLines,
        });
      }

      // NOTE (deliberate non-change): if you later need genuinely zero-cost
      // stock to convert successfully, do NOT reintroduce a silent skip.
      // Add an explicit `allowZeroCost` flag to ConvertPreorderToSaleDto,
      // record the override on the sale note and the stock-movement note,
      // and accept that the journal will still carry no COGS pair — because
      // insertPostedJournal rejects 0/0 lines. The override must be a
      // recorded business decision, not a default.

      // Update preorder status
      const updatedPreorder = await trx
        .updateTable('import_container_preorders')
        .set({
          status: 'invoiced',
          sale_invoice_id: saleId,
          notes: `${preorder.notes || ''} [تم التحويل لفاتورة مبيعات #${docNo} برقم معرف ${saleId}]`.trim(),
          updated_at: sql`NOW()`,
        } as any)
        .where('id', '=', preorderId)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        preorder: updatedPreorder,
        saleId,
        docNo,
        total,
        settledDeposit: appliedDeposit,
        balanceDue,
      };
    });
  }

  async getContainerAutopsySheet(tenantId: string, shipmentId: string) {
    const shipment = await this.db
      .selectFrom('import_shipments as s')
      .leftJoin('import_projects as p', 'p.id', 's.project_id')
      .leftJoin('suppliers as sup', 'sup.id', 's.supplier_id')
      .selectAll('s')
      .select(['p.title as project_title', 'p.project_no', 'sup.name as supplier_name'])
      .where('s.id', '=', shipmentId)
      .where('s.tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();

    const items = await this.db
      .selectFrom('import_shipment_items as i')
      .leftJoin('products as pr', 'pr.id', 'i.product_id')
      .selectAll('i')
      .select(['pr.name as product_name', 'pr.sku', 'pr.barcode'])
      .where('i.shipment_id', '=', shipmentId)
      .where('i.tenant_id', '=', tenantId)
      .execute();

    const preorders = await this.db
      .selectFrom('import_container_preorders as po')
      .leftJoin('customers as c', 'c.id', 'po.customer_id')
      .selectAll('po')
      .select(['c.name as customer_name'])
      .where('po.shipment_id', '=', shipmentId)
      .where('po.tenant_id', '=', tenantId)
      .execute();

    const lots = await this.db
      .selectFrom('import_inventory_lots')
      .selectAll()
      .where('shipment_id', '=', shipmentId)
      .where('tenant_id', '=', tenantId)
      .execute();

    const brokerExpenses = await this.db
      .selectFrom('import_broker_expenses')
      .selectAll()
      .where('shipment_id', '=', shipmentId)
      .where('tenant_id', '=', tenantId)
      .execute();

    const deposits = await this.db
      .selectFrom('import_container_deposits')
      .selectAll()
      .where('shipment_id', '=', shipmentId)
      .where('tenant_id', '=', tenantId)
      .execute();

    // Exchange rate (INV-IMPORT-FX-RESOLVER, F1): the arrival rate is
    // authoritative, then the pricing rate. When neither is recorded,
    // the rate resolves live through resolveFxRate for USD — the
    // denomination of the factory/shipping figures below — and fails
    // closed when no rate is registered, instead of inventing 50.
    // The source is labelled (exchangeRateSource) so every EGP
    // figure below is visibly live-resolved when no shipment rate
    // exists (INV-IMPORT-PROFIT-HONESTY).
    const arrivalRate = Number(shipment.exchange_rate_at_arrival);
    const pricingRate = Number(shipment.pricing_exchange_rate);
    const exchangeRateSource =
      Number.isFinite(arrivalRate) && arrivalRate > 0
        ? 'arrival'
        : Number.isFinite(pricingRate) && pricingRate > 0
          ? 'pricing'
          : 'live';
    const exRate =
      exchangeRateSource === 'arrival'
        ? arrivalRate
        : exchangeRateSource === 'pricing'
          ? pricingRate
          : await resolveFxRate(this.db, tenantId, 'USD');
    // Nothing is assumed anymore: the rate is either recorded on the
    // shipment or live-registered. The flag stays in the response so
    // existing consumers keep their shape.
    const exchangeRateAssumed = false;
    const factoryTotalUsd = items.reduce((acc, i) => acc + Number(i.quantity) * Number(i.factory_unit_price_usd), 0);
    const factoryTotalEgp = factoryTotalUsd * exRate;
    // Factory cost on the B/L (ordered) quantity is what the
    // shipment fields describe; the received-quantity basis is
    // the cost of the goods that physically arrived, and the two
    // differ exactly by the shortage. Both are reported, labelled.
    const factoryTotalReceivedUsd = items.reduce(
      (acc, i) => acc + Number(i.received_quantity ?? i.quantity) * Number(i.factory_unit_price_usd),
      0,
    );
    const factoryTotalReceivedEgp = factoryTotalReceivedUsd * exRate;
    const shippingEgp = Number(shipment.shipping_cost_usd || 0) * exRate;
    const customsEgp = Number(shipment.customs_cost_egp || 0);
    const transportEgp = Number(shipment.internal_transport_cost_egp || 0);
    const demurrageEgp = Number(shipment.actual_demurrage_fees || 0);
    const lateExpensesEgp = Number(shipment.late_expenses_total_egp || 0);
    // INV-IMPORT-LANDED-COST-DUTY-VAT: the open estimate must carry
    // the same duty/VAT breakdown as the receipt — duty on CIF
    // (goods + freight + insurance at the arrival rate), VAT on
    // (CIF + duty), intermediates unrounded, exactly like the
    // landed-cost engine. Without them the sheet contradicted its
    // own posted value for any shipment with rates (estimate
    // 900.00 vs posted 1,107.60 for the trial goods). Rates and
    // insurance default to 0, so unrated shipments are unchanged.
    const insuranceEgp = Number(shipment.insurance_cost_usd || 0) * exRate;
    const cifEgp = factoryTotalEgp + shippingEgp + insuranceEgp;
    const dutyEgp = cifEgp * (Number(shipment.customs_duty_rate_percent || 0) / 100);
    const vatEgp = (cifEgp + dutyEgp) * (Number(shipment.vat_rate_percent || 0) / 100);

    const totalLandedCostEgp =
      factoryTotalEgp + shippingEgp + customsEgp + transportEgp + demurrageEgp + lateExpensesEgp + insuranceEgp + dutyEgp + vatEgp;

    // Frozen vs open figures (INV-IMPORT-PROFIT-HONESTY). The
    // posted receipt journal is frozen evidence: its inventory
    // line is the landed value that actually reached the GL. The
    // shipment-field total above is an open estimate until the
    // receipt posts. Broker expenses are broken down by the path
    // each one took, so a capitalised cost is never presented as
    // a period expense and an expensed cost is never presented
    // as landed cost.
    const postedReceipt = await this.db
      .selectFrom('import_inventory_receipts')
      .select(['id', 'state'])
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', shipmentId)
      .where('state', '=', 'posted')
      .executeTakeFirst();
    let postedLandedValueEgp: number | null = null;
    if (postedReceipt) {
      // Receipt ids are BIGSERIAL in production (migration 0230);
      // a non-numeric id can never match a journal source_id.
      const receiptIdNum = Number(postedReceipt.id);
      const receiptJournal: any = Number.isFinite(receiptIdNum)
        ? await this.db
            .selectFrom('journal_entries')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('source_type', '=', 'import_inventory_receipt')
            .where('source_id', '=', receiptIdNum)
            .where('status', '=', 'posted')
            .executeTakeFirst()
        : undefined;
      if (receiptJournal) {
        // Read-path set sum (same acceptance set as the posting
        // resolver): a missing inventory role account leaves the
        // frozen value null instead of breaking the sheet.
        const inventoryAccountIds = await this.eligibleRoleAccountIds(this.db as any, tenantId, 'inventory');
        const invLines: any[] = inventoryAccountIds.length
          ? await this.db
              .selectFrom('journal_entry_lines')
              .select(['debit', 'credit'])
              .where('journal_entry_id', '=', Number(receiptJournal.id))
              .where('account_id', 'in', inventoryAccountIds)
              .execute()
          : [];
        postedLandedValueEgp = Number(
          invLines.reduce((sum, l) => sum + Number(l.debit || 0) - Number(l.credit || 0), 0).toFixed(2),
        );
      }
    }
    const brokerByState = new Map<string, { count: number; amountEgp: number }>();
    let brokerVerifiedCount = 0;
    let brokerUnverifiedCount = 0;
    for (const e of brokerExpenses) {
      const state = String((e as any).capitalization_state || 'unknown');
      const slot = brokerByState.get(state) || { count: 0, amountEgp: 0 };
      slot.count += 1;
      slot.amountEgp = Number((slot.amountEgp + Number((e as any).amount_egp || 0)).toFixed(2));
      brokerByState.set(state, slot);
      if ((e as any).is_verified) brokerVerifiedCount += 1;
      else brokerUnverifiedCount += 1;
    }
    const brokerLinks: any[] = await this.db
      .selectFrom('import_broker_capitalizations')
      .select(['state', 'amount_egp'])
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', shipmentId)
      .execute();
    const brokerCapitalisedInLandedEgp = Number(
      brokerLinks
        .filter((l) => ['folded', 'consumed', 'revalued'].includes(String(l.state)))
        .reduce((sum, l) => sum + Number(l.amount_egp || 0), 0)
        .toFixed(2),
    );
    const brokerExpensedEgp = Number((brokerByState.get('expensed')?.amountEgp || 0).toFixed(2));

    const allocations = await this.db
      .selectFrom('import_sale_allocations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', shipmentId)
      .execute();

    let actualInvoicedSalesEgp = 0;
    let actualAllocatedCogsEgp = 0;
    let actualAllocatedUnits = 0;

    for (const alloc of allocations) {
      const q = Number(alloc.quantity);
      const isNegative = alloc.allocation_type === 'reversal' || alloc.allocation_type === 'return' || alloc.allocation_type === 'cancellation';
      const absQty = Math.abs(q);
      const effectiveQty = isNegative ? -absQty : absQty;
      const unitSalePrice = Number(alloc.unit_sale_price_egp || 0);
      const unitCost = Number(alloc.unit_cost_egp || 0);

      actualAllocatedUnits += effectiveQty;
      actualInvoicedSalesEgp += effectiveQty * unitSalePrice;
      actualAllocatedCogsEgp += effectiveQty * unitCost;
    }

    // Invoiced bookings are already included in invoiced sales. Refunded deposits are
    // not liabilities, and cancelled/refunded bookings must not inflate cash held.
    const openBookings = preorders.filter((p) => p.status === 'reserved' || p.status === 'allocated');
    const preordersTotalRevenue = openBookings
      .reduce((acc, p) => acc + Number(p.total_price_egp), 0);
    const preordersDepositsCollected = openBookings
      .reduce((acc, p) => acc + Math.max(0, Number(p.deposit_amount_egp) - Number(p.refunded_amount_egp || 0)), 0);
    const preordersDepositsRefunded = preorders
      .reduce((acc, p) => acc + Number(p.refunded_amount_egp || 0), 0);

    let totalUnitsShipped = 0;
    let totalUnitsReceived = 0;
    for (const item of items) {
      totalUnitsShipped += Number(item.quantity);
      totalUnitsReceived += Number(item.received_quantity ?? item.quantity);
    }

    const totalRemainingUnits = lots.reduce((acc, l) => acc + Number(l.remaining_quantity), 0);
    const totalSoldUnits = actualAllocatedUnits > 0 ? actualAllocatedUnits : Math.max(0, totalUnitsReceived - totalRemainingUnits);

    const unsoldStockLandedValueEgp = lots.reduce(
      (acc, l) => acc + Number(l.remaining_quantity) * Number(l.unit_landed_cost_egp),
      0
    );

    const avgCostPerUnit = totalUnitsReceived > 0 ? totalLandedCostEgp / totalUnitsReceived : 0;
    const cogsSoldUnitsEgp = actualAllocatedCogsEgp > 0 ? actualAllocatedCogsEgp : totalSoldUnits * avgCostPerUnit;
    // Gross trading margin, never "net profit": operating costs,
    // expensed broker costs, FX variance, shortage expense and
    // deposit deductions are all excluded from this figure. The
    // project profit report (INV-IMPORT-PROFIT-HONESTY) is the
    // place those posted costs land.
    const realizedGrossTradingMarginEgp = actualInvoicedSalesEgp > 0 ? actualInvoicedSalesEgp - cogsSoldUnitsEgp : 0;
    const roiPercentage = totalLandedCostEgp > 0 ? (realizedGrossTradingMarginEgp / totalLandedCostEgp) * 100 : 0;

    const pendingDeposits = deposits.filter((d) => d.refund_status === 'pending');
    const totalPendingDepositEgp = pendingDeposits.reduce((acc, d) => acc + Number(d.deposit_amount_egp), 0);

    // I2-D6: the lots row must NOT divide by quantity again.
    // import_shipment_items.landed_cost_egp stores the PER-UNIT
    // landed cost (the landed-cost engine's landedCostEgp =
    // totalItemLandedCostEgp / effectiveQty; the receipt lots and
    // every other consumer read it as the unit cost). The modal
    // used to divide it by the received quantity a second time
    // and show the stored value as the line total, so the trial
    // container read 9.00 / 90.00 instead of 90.00 / 900.00.
    // The autopsy therefore carries both figures explicitly: the
    // stored per-unit value, and the line total on the RECEIVED
    // quantity (unit x received — the landed value of the goods
    // that physically arrived). The stored value is untouched.
    const autopsyItems = items.map((item) => {
      const receivedQty = Number(item.received_quantity ?? item.quantity);
      const unitLandedCostEgp = Number(item.landed_cost_egp || 0);
      return {
        ...item,
        unit_landed_cost_egp: unitLandedCostEgp,
        total_landed_cost_egp: roundMoney(unitLandedCostEgp * receivedQty, currencyMoneyDigits('EGP')),
      };
    });

    // I2-D6: the P&L status reads the container's ACTUAL status.
    // Real container_status values (migration 2040000000238):
    // on_water, port_arrived, customs_cleared,
    // warehouse_received, empty_returned.
    // I8-E (R6): container_status is never updated when the
    // shipment status moves — the only writer sets
    // 'empty_returned', so the column keeps its 'on_water'
    // default for a container that has already arrived, and the
    // sheet read "في البحر" for MSCU-TEST-001 although the
    // shipment status is Arrived (list: تم الوصول للمخزن).
    // The shipment status is the authoritative arrival state,
    // so a NON-INFORMATIVE container_status — NULL, the
    // 'on_water' default, or the legacy 'arrived' fallback —
    // is resolved from it. An explicit value
    // (warehouse_received, port_arrived, customs_cleared,
    // empty_returned) — or an unknown one, which keeps the
    // honest fallback below (D6) — is never overridden.
    const containerStatusLabels: Record<string, string> = {
      on_water: 'في البحر',
      port_arrived: 'وصلت إلى الميناء',
      customs_cleared: 'تم التخليص الجمركي',
      warehouse_received: 'تم الوصول للمخزن',
      empty_returned: 'تم تسليم الفارغ والمطابقة',
      arrived: 'تم الوصول',
    };
    const statusDerivedContainerStatus: Record<string, string> = {
      Arrived: 'warehouse_received',
      'In Customs': 'port_arrived',
      Pending: 'on_water',
    };
    const rawContainerStatus = shipment.container_status as string | null | undefined;
    const containerStatus =
      rawContainerStatus && !['on_water', 'arrived'].includes(rawContainerStatus)
        ? rawContainerStatus
        : statusDerivedContainerStatus[shipment.status as string] || rawContainerStatus || 'arrived';
    const containerStatusLabel = containerStatusLabels[containerStatus] || 'حالة غير معروفة';

    return {
      basis: {
        exchangeRateSource,
        exchangeRateAssumed,
        factoryTotalBasis: 'bill_of_lading_quantity',
        landedCostBasis: postedLandedValueEgp !== null ? 'posted_receipt_journal' : 'shipment_field_estimates',
        postedReceipt: postedReceipt !== undefined && postedReceipt !== null,
        marginBasis:
          'gross_trading_margin_excluding_operating_costs_broker_expensed_fx_variance_shortage_and_deposit_deductions',
        liabilityBasis: 'deposits_held_for_open_bookings_net_of_refunds',
      },
      operational: {
        shipmentId,
        containerNumber: shipment.container_number,
        billOfLading: shipment.bill_of_lading,
        carrierName: shipment.carrier_name,
        containerSize: shipment.container_size,
        freightType: shipment.freight_type,
        portOfLoading: shipment.port_of_loading,
        portOfDischarge: shipment.port_of_discharge,
        containerStatus,
        containerStatusLabel,
        arrivalDate: shipment.arrival_date,
        unstuffingDate: shipment.unstuffing_date,
        emptyReturnedDate: shipment.empty_returned_date,
        projectTitle: shipment.project_title,
        projectNo: shipment.project_no,
        supplierName: shipment.supplier_name,
        totalUnitsShipped,
        totalUnitsReceived,
        totalSoldUnits,
        totalRemainingUnits,
      },
      landedCosts: {
        exchangeRate: exRate,
        exchangeRateSource,
        exchangeRateAssumed,
        factoryTotalUsd: Number(factoryTotalUsd.toFixed(2)),
        factoryTotalEgp: Number(factoryTotalEgp.toFixed(2)),
        factoryTotalBasis: 'bill_of_lading_quantity',
        factoryTotalReceivedUsd: Number(factoryTotalReceivedUsd.toFixed(2)),
        factoryTotalReceivedEgp: Number(factoryTotalReceivedEgp.toFixed(2)),
        shippingEgp: Number(shippingEgp.toFixed(2)),
        customsEgp: Number(customsEgp.toFixed(2)),
        transportEgp: Number(transportEgp.toFixed(2)),
        demurrageEgp: Number(demurrageEgp.toFixed(2)),
        lateExpensesEgp: Number(lateExpensesEgp.toFixed(2)),
        insuranceEgp: roundMoney(insuranceEgp, currencyMoneyDigits('EGP')),
        dutyEgp: roundMoney(dutyEgp, currencyMoneyDigits('EGP')),
        vatEgp: roundMoney(vatEgp, currencyMoneyDigits('EGP')),
        totalLandedCostEgp: Number(totalLandedCostEgp.toFixed(2)),
        landedCostBasis: postedLandedValueEgp !== null ? 'posted_receipt_journal' : 'shipment_field_estimates',
        postedLandedValueEgp,
        avgCostPerUnitEgp: Number(avgCostPerUnit.toFixed(4)),
      },
      salesAndInventory: {
        invoicedSalesEgp: Number(actualInvoicedSalesEgp.toFixed(2)),
        grossSalesEgp: Number(actualInvoicedSalesEgp.toFixed(2)),
        inTransitPreordersRevenue: Number(preordersTotalRevenue.toFixed(2)),
        depositsCollectedEgp: Number(preordersDepositsCollected.toFixed(2)),
        refundedPreorderDepositsEgp: Number(preordersDepositsRefunded.toFixed(2)),
        unearnedPreorderLiabilityEgp: Number(preordersDepositsCollected.toFixed(2)),
        liabilityBasis: 'deposits_held_for_open_bookings_net_of_refunds',
        unsoldStockLandedValueEgp: Number(unsoldStockLandedValueEgp.toFixed(2)),
        lotsCount: lots.length,
      },
      profitability: {
        cogsSoldUnitsEgp: Number(cogsSoldUnitsEgp.toFixed(2)),
        realizedGrossTradingMarginEgp: Number(realizedGrossTradingMarginEgp.toFixed(2)),
        marginBasis:
          'gross_trading_margin_excluding_operating_costs_broker_expensed_fx_variance_shortage_and_deposit_deductions',
        roiPercentage: Number(roiPercentage.toFixed(2)),
        roiBasis: 'gross_trading_margin_divided_by_estimated_total_landed_cost',
      },
      inTransitPreorders: {
        totalBookingsEgp: Number(preordersTotalRevenue.toFixed(2)),
        depositsCollectedEgp: Number(preordersDepositsCollected.toFixed(2)),
        unearnedLiabilityEgp: Number(preordersDepositsCollected.toFixed(2)),
        preordersCount: preorders.length,
      },
      liabilities: {
        pendingContainerDepositsCount: pendingDeposits.length,
        totalPendingDepositEgp: Number(totalPendingDepositEgp.toFixed(2)),
        brokerExpensesCount: brokerExpenses.length,
        brokerExpensesByState: Object.fromEntries(brokerByState),
        brokerVerifiedCount,
        brokerUnverifiedCount,
        brokerCapitalisedInLandedEgp,
        brokerExpensedEgp,
      },
      items: autopsyItems,
      lots,
      preorders,
    };
  }

  // -------------------------------------------------------------
  // FX TREASURY DESK
  // -------------------------------------------------------------
  async recordFxAcquisition(tenantId: string, userId: number, dto: RecordFxAcquisitionDto) {
    const foreignAmount = Number(dto.foreignAmount);
    if (!Number.isFinite(foreignAmount) || foreignAmount <= 0) {
      throw new BadRequestException('مبالغ تدبير العملة يجب أن تكون أرقاماً موجبة صحيحة.');
    }
    if (dto.egpCost !== undefined && dto.egpCost !== null) {
      const suppliedCost = Number(dto.egpCost);
      if (!Number.isFinite(suppliedCost) || suppliedCost <= 0) {
        throw new BadRequestException('مبالغ تدبير العملة يجب أن تكون أرقاماً موجبة صحيحة.');
      }
    }
    // Currency is stored normalised: 'usd' and 'USD' are one
    // currency, never two portfolio buckets.
    const currency = String(dto.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException('عملة تدبير العملة يجب أن تكون رمزاً من ثلاثة أحرف (مثال: USD). [IMPORT_FX_CURRENCY_INVALID]');
    }
    const acquisitionDate = dto.acquisitionDate || await resolveBusinessDateKey(this.db, tenantId, new Date());
    return await this.db.transaction().execute(async (trx) => {
      // INV-IMPORT-FX-TREASURY-LIVE-RATE (I4-D7): the rate is NEVER
      // derived from the user-entered amounts — it resolves live
      // through the shared resolver (resolveFxRate), failing closed
      // when no rate is registered for the currency. The amounts are
      // the RESULT of the rate: the EGP cost is foreignAmount x live
      // rate, and a caller-supplied cost or rate must agree with the
      // live rate (cost within one piastre, rate within 0.0001) or
      // the acquisition rejects with IMPORT_FX_RATE_MISMATCH.
      const liveRate = await resolveFxRate(trx as any, tenantId, currency);
      const liveRate4dp = Number(liveRate.toFixed(4));
      if (dto.exchangeRate !== undefined && dto.exchangeRate !== null) {
        const supplied = Number(dto.exchangeRate);
        if (!Number.isFinite(supplied) || supplied <= 0 || Math.abs(supplied - liveRate4dp) > 0.0001) {
          throw new BadRequestException(`سعر الصرف المرسل (${supplied}) لا يطابق سعر الصرف الحي المسجل (${liveRate4dp})؛ حدّث السعر المسجل أولاً أو صحح السعر. [IMPORT_FX_RATE_MISMATCH]`);
        }
      }
      const expectedEgpCost = roundMoney(foreignAmount * liveRate, currencyMoneyDigits('EGP'));
      let egpCost = expectedEgpCost;
      if (dto.egpCost !== undefined && dto.egpCost !== null) {
        const suppliedCost = Number(dto.egpCost);
        if (Math.abs(suppliedCost - expectedEgpCost) > 0.01) {
          throw new BadRequestException(`تكلفة الجنيه المرسلة (${suppliedCost}) لا تطابق السعر الحي المسجل (${liveRate4dp} × ${foreignAmount} = ${expectedEgpCost})؛ صحح المبالغ أو حدّث السعر المسجل. [IMPORT_FX_RATE_MISMATCH]`);
        }
      }
      // Optional transfer link: the transfer must belong to this
      // tenant and its currency must match the acquisition. The
      // link is attribution only — it never settles the transfer.
      let transferId: number | null = null;
      if (dto.transferId !== undefined && dto.transferId !== null) {
        transferId = Number(dto.transferId);
        if (!Number.isSafeInteger(transferId) || transferId <= 0) {
          throw new BadRequestException('معرف الحوالة المرتبطة بتدبير العملة غير صالح.');
        }
        const payment: any = await trx.selectFrom('supplier_payments').select(['id', 'currency'])
          .where('tenant_id', '=', tenantId).where('id', '=', transferId).executeTakeFirst();
        if (!payment) throw new BadRequestException('الحوالة المرتبطة بتدبير العملة غير تابعة للمنشأة.');
        if (String(payment.currency || '').trim().toUpperCase() !== currency) {
          throw new BadRequestException(`عملة الحوالة المرتبطة (${payment.currency}) لا تطابق عملة التدبير (${currency}). [IMPORT_FX_TRANSFER_CURRENCY_MISMATCH]`);
        }
      }
      // Destination: the cash/bank account receiving the foreign
      // currency. Source: the EGP account paid from. Both resolve
      // through the bank role (never a silent default account),
      // and moving money from an account to itself is meaningless.
      const destinationAccountId = await this.resolveTenantAccount(trx, tenantId, 'bank', dto.bankAccountId ? Number(dto.bankAccountId) : null);
      const sourceAccountId = await this.resolveTenantAccount(trx, tenantId, 'bank', dto.sourceAccountId ? Number(dto.sourceAccountId) : null);
      if (sourceAccountId === destinationAccountId) {
        throw new BadRequestException('حساب مصدر تدبير العملة يجب أن يختلف عن حساب الوجهة؛ حدد حساب المصدر (sourceAccountId) صراحة. [IMPORT_FX_SAME_ACCOUNT]');
      }
      const acquisition: any = await trx
        .insertInto('import_fx_acquisitions')
        .values({
          tenant_id: tenantId,
          currency,
          foreign_amount: dto.foreignAmount,
          egp_cost: egpCost,
          effective_exchange_rate: liveRate4dp,
          acquisition_date: acquisitionDate,
          source: dto.source || 'bank',
          bank_account_id: destinationAccountId,
          notes: dto.notes || null,
          supplier_payment_id: transferId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const serialId = Number(acquisition.serial_id);
      if (!Number.isSafeInteger(serialId)) {
        throw new BadRequestException('تدبير العملة يتطلب تشغيل الترحيل 0287 أولاً (الرقم المسلسل لربط القيد). [IMPORT_FX_SERIAL_MISSING]');
      }
      // Balanced treasury movement: the EGP value leaves the
      // source account and enters the destination account, in
      // the same transaction as the acquisition record.
      const posting = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const journalEntryId = await posting.postDomainJournal(trx, {
        sourceType: 'import_fx_acquisition',
        sourceId: serialId,
        tenantId,
        accountId: tenantId,
        entryDate: new Date(acquisitionDate),
        description: `تدبير عملة ${currency} ${foreignAmount} بسعر ${liveRate4dp} (تكلفة ${egpCost} ج.م)`,
        branchId: null,
        locationId: null,
        createdBy: userId,
        postedBy: userId,
        lines: [
          {
            accountId: destinationAccountId,
            debit: egpCost,
            credit: 0,
            description: `استلام ${currency} ${foreignAmount} - تدبير عملة`,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
          {
            accountId: sourceAccountId,
            debit: 0,
            credit: egpCost,
            description: `سداد تكلفة تدبير ${currency} ${foreignAmount}`,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
        ],
      });
      // Treasury legs mirror the journal in EGP book value, so
      // the cash/bank balances and the GL agree.
      const scopes = await trx.selectFrom('accounting_accounts').select(['id', 'account_id'])
        .where('tenant_id', '=', tenantId).where('id', 'in', [sourceAccountId, destinationAccountId]).execute();
      const scopeById = new Map(scopes.map((s) => [Number(s.id), s.account_id]));
      await trx.insertInto('treasury_transactions').values([
        {
          tenant_id: tenantId, account_id: scopeById.get(destinationAccountId) || tenantId,
          txn_type: 'import_fx_acquisition', amount: egpCost,
          note: `تدبير عملة: استلام ${foreignAmount} ${currency}`,
          reference_type: 'import_fx_acquisition', reference_id: serialId, created_by: userId,
        },
        {
          tenant_id: tenantId, account_id: scopeById.get(sourceAccountId) || tenantId,
          txn_type: 'import_fx_acquisition', amount: -egpCost,
          note: `تدبير عملة: سداد ${egpCost} ج.م مقابل ${foreignAmount} ${currency}`,
          reference_type: 'import_fx_acquisition', reference_id: serialId, created_by: userId,
        },
      ]).execute();
      await trx.updateTable('import_fx_acquisitions').set({ journal_entry_id: journalEntryId })
        .where('tenant_id', '=', tenantId).where('id', '=', acquisition.id).execute();
      return { ...acquisition, journal_entry_id: journalEntryId };
    });
  }

  async getFxPortfolio(tenantId: string) {
    const records = await this.db
      .selectFrom('import_fx_acquisitions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('acquisition_date', 'desc')
      .execute();

    const byCurrency: Record<string, { totalForeign: number; totalEgp: number; weightedAvgRate: number }> = {};
    for (const r of records) {
      // Legacy rows may store 'usd' where new rows store 'USD':
      // group case-insensitively so one currency is one bucket.
      const key = String(r.currency || '').trim().toUpperCase();
      if (!byCurrency[key]) {
        byCurrency[key] = { totalForeign: 0, totalEgp: 0, weightedAvgRate: 0 };
      }
      byCurrency[key].totalForeign += Number(r.foreign_amount);
      byCurrency[key].totalEgp += Number(r.egp_cost);
    }

    for (const curr of Object.keys(byCurrency)) {
      const data = byCurrency[curr];
      data.weightedAvgRate = data.totalForeign > 0 ? Number((data.totalEgp / data.totalForeign).toFixed(4)) : 0;
    }

    return {
      portfolio: byCurrency,
      transactions: records,
    };
  }

  // -------------------------------------------------------------
  // UNIFIED DOCUMENT CENTER
  // -------------------------------------------------------------
  async createImportDocument(tenantId: string, userId: number, dto: CreateImportDocumentDto) {
    return await this.db
      .insertInto('import_documents')
      .values({
        tenant_id: tenantId,
        project_id: dto.projectId ?? null,
        shipment_id: dto.shipmentId ?? null,
        document_type: dto.documentType,
        file_name: dto.fileName,
        file_url: dto.fileUrl,
        file_size_bytes: dto.fileSizeBytes || 0,
        mime_type: dto.mimeType || 'application/pdf',
        issue_date: dto.issueDate || null,
        expiry_date: dto.expiryDate || null,
        is_verified: false,
        notes: dto.notes || null,
        created_by: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listImportDocuments(tenantId: string, projectId?: string, shipmentId?: string) {
    let q = this.db.selectFrom('import_documents').selectAll().where('tenant_id', '=', tenantId);
    if (projectId) q = q.where('project_id', '=', projectId);
    if (shipmentId) q = q.where('shipment_id', '=', shipmentId);
    return await q.orderBy('created_at', 'desc').execute();
  }

  // -------------------------------------------------------------
  // MAKER-CHECKER GOVERNANCE WORKFLOW
  // -------------------------------------------------------------
  async createApprovalRequest(tenantId: string, userId: number, dto: CreateApprovalRequestDto) {
    if (dto.actionType === 'partner_distribution') {
      const payload = dto.requestPayload;
      if (!payload || payload.partnerId !== dto.referenceId || !payload.projectId || !Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) {
        throw new BadRequestException('اعتماد صرف الأرباح يتطلب الشريك والمشروع وسقف مبلغ موجب ومطابقة المرجع.');
      }
    }
    if (dto.actionType === 'large_transfer') {
      const payload = dto.requestPayload;
      const payloadCurrency = String(payload?.currency || '').trim().toUpperCase();
      if (!payload || !Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0 || !/^[A-Z]{3}$/.test(payloadCurrency)) {
        throw new BadRequestException('اعتماد الحوالة الكبيرة يتطلب سقف مبلغ موجباً وعملة صالحة من ثلاثة أحرف.');
      }
      if (payload.supplierId !== undefined && String(payload.supplierId) !== String(dto.referenceId)) {
        throw new BadRequestException('اعتماد الحوالة الكبيرة يتطلب مطابقة المورد للمرجع.');
      }
      if (payload.proformaInvoiceId !== undefined && !String(payload.proformaInvoiceId).trim()) {
        throw new BadRequestException('اعتماد الحوالة الكبيرة يتطلب معرف فاتورة مبدئية غير فارغ عند تحديده.');
      }
      if (payload.projectId !== undefined && !String(payload.projectId).trim()) {
        throw new BadRequestException('اعتماد الحوالة الكبيرة يتطلب معرف مشروع غير فارغ عند تحديده.');
      }
      if (payload.paymentMethod !== undefined && !isPaymentMethod(payload.paymentMethod)) {
        throw new BadRequestException('اعتماد الحوالة الكبيرة يتطلب طريقة دفع صالحة عند تحديدها.');
      }
    }
    if (dto.actionType === 'import_receipt_reversal' || dto.actionType === 'import_legacy_receipt_review') {
      const payload = dto.requestPayload;
      if (!payload || payload.shipmentId !== dto.referenceId || !String(payload.receiptId || '').trim()) {
        throw new BadRequestException('اعتماد عكس/مراجعة الاستلام يتطلب ربط الشحنة وسند الاستلام بالمرجع نفسه.');
      }
    }
    if (dto.actionType === 'broker_expense_verification') {
      const payload = dto.requestPayload;
      if (!payload || String(payload.brokerExpenseId || '') !== String(dto.referenceId) || !Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) {
        throw new BadRequestException('اعتماد التحقق من مصروف مخلص يتطلب ربط المصروف بالمرجع نفسه وسقف مبلغ موجب.');
      }
    }
    if (dto.actionType === 'sourcing_trip_expense') {
      const payload = dto.requestPayload;
      if (!payload || String(payload.tripId || '') !== String(dto.referenceId) || !Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0 || !Number.isFinite(Number(payload.supplierId)) || Number(payload.supplierId) <= 0) {
        throw new BadRequestException('اعتماد ترحيل مصروف رحلة يتطلب ربط الرحلة بالمرجع نفسه وسقف مبلغ موجباً ومورداً مستحقاً.');
      }
    }
    return await this.db
      .insertInto('import_approval_requests')
      .values({
        tenant_id: tenantId,
        module: 'import',
        action_type: dto.actionType,
        reference_id: dto.referenceId,
        requested_by: userId,
        status: 'pending',
        request_payload: dto.requestPayload ? JSON.stringify(dto.requestPayload) : '{}',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listApprovalRequests(tenantId: string, status?: string) {
    let q = this.db.selectFrom('import_approval_requests').selectAll().where('tenant_id', '=', tenantId);
    if (status) q = q.where('status', '=', status);
    return await q.orderBy('created_at', 'desc').execute();
  }

  async decideApprovalRequest(tenantId: string, userId: number, requestId: string, dto: DecideApprovalRequestDto) {
    return await this.db.transaction().execute(async (trx) => {
      const req = await trx
        .selectFrom('import_approval_requests')
        .selectAll()
        .where('id', '=', requestId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (req.requested_by === userId) {
        throw new BadRequestException('مبدأ الرقابة الثنائية (Maker-Checker): لا يجوز للمستخدم الذي أنشأ الطلب اعتماده بنفسه.');
      }

      if (req.status !== 'pending') {
        throw new BadRequestException('تم البت في هذا الطلب مسبقاً.');
      }

      return await trx
        .updateTable('import_approval_requests')
        .set({
          status: dto.decision,
          approved_by: userId,
          decided_at: new Date(),
          rejection_reason: dto.rejectionReason || dto.decisionNotes || dto.comments || null,
        })
        .where('id', '=', requestId)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
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
    const events: Array<{
      kind: string;
      ref: string;
      label: string;
      state: string;
      projectId: string | null;
      shipmentId: string | null;
      amountEgp: number | null;
      amountForeign: number | null;
      currency: string | null;
      journalEntryNo: string | null;
      journalMatched: boolean | null;
      createdAt: any;
    }> = [];
    const num = (v: any): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    let projectsQ = this.db.selectFrom('import_projects').selectAll().where('tenant_id', '=', tenantId);
    if (projectId) projectsQ = projectsQ.where('id', '=', projectId);
    const projects = await projectsQ.orderBy('created_at', 'asc').execute();
    for (const p of projects) {
      events.push({
        kind: 'project', ref: String(p.project_no || p.id), label: String(p.title || ''),
        state: String(p.status || ''), projectId: String(p.id), shipmentId: null,
        amountEgp: num((p as any).allocated_capital), amountForeign: null, currency: String((p as any).budget_currency || '') || null,
        journalEntryNo: null, journalMatched: null, createdAt: (p as any).created_at,
      });
    }

    let piQ = this.db.selectFrom('import_proforma_invoices').selectAll().where('tenant_id', '=', tenantId);
    if (projectId) piQ = piQ.where('project_id', '=', projectId);
    const pis = await piQ.orderBy('created_at', 'asc').execute();
    for (const pi of pis) {
      events.push({
        kind: 'proforma_invoice', ref: String(pi.pi_number || pi.id), label: '',
        state: String(pi.status || ''),
        projectId: pi.project_id ? String(pi.project_id) : null, shipmentId: null,
        amountEgp: null, amountForeign: num(pi.total_amount_foreign), currency: String(pi.currency || '') || null,
        journalEntryNo: null, journalMatched: null, createdAt: (pi as any).created_at,
      });
    }

    let shipQ = this.db.selectFrom('import_shipments').selectAll().where('tenant_id', '=', tenantId);
    if (projectId) shipQ = shipQ.where('project_id', '=', projectId);
    const shipments = await shipQ.orderBy('created_at', 'asc').execute();
    const shipmentIds = shipments.map((s) => String(s.id));
    for (const s of shipments) {
      events.push({
        kind: 'shipment', ref: String(s.container_number || s.id), label: String(s.bill_of_lading || ''),
        state: String(s.status || ''), projectId: s.project_id ? String(s.project_id) : null,
        shipmentId: String(s.id), amountEgp: null, amountForeign: null, currency: null,
        journalEntryNo: null, journalMatched: null, createdAt: (s as any).created_at,
      });
    }

    // Receipt tie-out: the receipt row carries its journal; the
    // journal row carries the posted state. A receipt is "matched"
    // only when BOTH are posted — a posted receipt with no journal,
    // or a journal that is not posted, is an open tie-out, never a
    // silent 100% match.
    let receiptQ = this.db
      .selectFrom('import_inventory_receipts as r')
      .leftJoin('journal_entries as je', 'je.id', 'r.journal_entry_id')
      .leftJoin('import_shipments as s', 's.id', 'r.shipment_id')
      .select([
        'r.id as receipt_id', 'r.shipment_id as shipment_id', 'r.state as state',
        'r.journal_entry_id as journal_entry_id', 'r.created_at as created_at',
        'je.entry_no as entry_no', 'je.status as journal_status',
        's.project_id as project_id', 's.container_number as container_number',
      ])
      .where('r.tenant_id', '=', tenantId);
    if (projectId) receiptQ = receiptQ.where('s.project_id', '=', projectId);
    else if (shipmentIds.length > 0) receiptQ = receiptQ.where('r.shipment_id', 'in', shipmentIds);
    const receipts = await receiptQ.orderBy('r.created_at', 'asc').execute();
    for (const r of receipts as any[]) {
      const matched = r.state === 'posted' && r.journal_entry_id != null && r.journal_status === 'posted';
      events.push({
        kind: 'receipt', ref: `#${r.receipt_id}`, label: String(r.container_number || ''),
        state: String(r.state || ''), projectId: r.project_id ? String(r.project_id) : null,
        shipmentId: r.shipment_id ? String(r.shipment_id) : null,
        amountEgp: null, amountForeign: null, currency: null,
        journalEntryNo: r.entry_no ? String(r.entry_no) : null, journalMatched: matched,
        createdAt: r.created_at,
      });
    }

    // Supplier payments are linked to the import flow only through
    // their proforma invoice (the same join recordForeignTransfer
    // uses to prove payment coverage). supplier_payments carries no
    // project_id: inventing one would attribute a payment to the
    // wrong project, so unlinked payments are not traced here.
    const payments = await this.db
      .selectFrom('supplier_payments as sp')
      .innerJoin('import_proforma_invoices as pi', 'pi.id', 'sp.proforma_invoice_id')
      .select([
        'sp.id as payment_id', 'sp.doc_no as doc_no', 'sp.amount as amount',
        'sp.amount_foreign as amount_foreign', 'sp.currency as currency',
        'sp.created_at as created_at', 'pi.project_id as project_id',
        'pi.pi_number as pi_number',
      ])
      .where('sp.tenant_id', '=', tenantId)
      .$if(!!projectId, (eb) => eb.where('pi.project_id', '=', projectId as string))
      .orderBy('sp.created_at', 'asc')
      .execute();
    for (const pay of payments as any[]) {
      events.push({
        kind: 'supplier_payment', ref: String(pay.doc_no || `#${pay.payment_id}`),
        label: String(pay.pi_number || ''), state: 'paid',
        projectId: pay.project_id ? String(pay.project_id) : null, shipmentId: null,
        amountEgp: num(pay.amount), amountForeign: num(pay.amount_foreign),
        currency: String(pay.currency || '') || null,
        journalEntryNo: null, journalMatched: null, createdAt: pay.created_at,
      });
    }

    let payoutQ = this.db.selectFrom('import_partner_project_payouts').selectAll().where('tenant_id', '=', tenantId);
    if (projectId) payoutQ = payoutQ.where('project_id', '=', projectId);
    const payouts = await payoutQ.orderBy('created_at', 'asc').execute();
    for (const po of payouts) {
      events.push({
        kind: 'partner_payout', ref: `#${po.id}`, label: '',
        state: 'paid', projectId: String(po.project_id), shipmentId: null,
        amountEgp: num(po.amount_egp), amountForeign: null, currency: null,
        journalEntryNo: null, journalMatched: null, createdAt: (po as any).created_at,
      });
    }

    const approvals = await this.listApprovalRequests(tenantId);
    for (const a of approvals as any[]) {
      if (projectId) {
        let payload: any = {};
        try {
          payload = typeof a.request_payload === 'string' ? JSON.parse(a.request_payload || '{}') : (a.request_payload || {});
        } catch { payload = {}; }
        // The project binding is the payload's projectId when the
        // approval carries one (partner_distribution, project_closure,
        // large_transfer); otherwise the approval has no project and
        // does not belong to one project's trace.
        const boundProject = payload.projectId ? String(payload.projectId) : null;
        if (boundProject !== String(projectId)) continue;
      }
      events.push({
        kind: 'approval_request', ref: `#${String(a.id).slice(0, 8)}`, label: String(a.action_type || ''),
        state: String(a.status || ''), projectId: null, shipmentId: null,
        amountEgp: null, amountForeign: null, currency: null,
        journalEntryNo: null, journalMatched: null, createdAt: a.created_at,
      });
    }

    events.sort((x, y) => {
      const tx = x.createdAt ? new Date(x.createdAt).getTime() : 0;
      const ty = y.createdAt ? new Date(y.createdAt).getTime() : 0;
      return tx - ty;
    });

    const byKind = (kind: string) => events.filter((e) => e.kind === kind);
    const counts = {
      projects: byKind('project').length,
      proformaInvoices: byKind('proforma_invoice').length,
      proformaInvoicesApproved: byKind('proforma_invoice').filter((e) => e.state === 'approved').length,
      shipments: byKind('shipment').length,
      shipmentsArrived: byKind('shipment').filter((e) => e.state === 'Arrived').length,
      receipts: byKind('receipt').length,
      receiptsPosted: byKind('receipt').filter((e) => e.state === 'posted').length,
      receiptsMatched: byKind('receipt').filter((e) => e.journalMatched === true).length,
      supplierPayments: byKind('supplier_payment').length,
      partnerPayouts: byKind('partner_payout').length,
      approvalsPending: byKind('approval_request').filter((e) => e.state === 'pending').length,
      approvalsApproved: byKind('approval_request').filter((e) => e.state === 'approved').length,
      approvalsRejected: byKind('approval_request').filter((e) => e.state === 'rejected').length,
      approvalsExecuted: byKind('approval_request').filter((e) => e.state === 'executed').length,
    };
    return { events, counts };
  }

  async listProjectProfitAttribution(tenantId: string, startDate: string | Date, endDate: string | Date) {
    // Attribution rows are report/display values: round them through
    // the canonical rounder at the tenant's book digits (never a
    // hardcoded toFixed(2) — the architecture guard dispositions
    // every toFixed(2) site in this file).
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const projects = await this.db
      .selectFrom('import_projects')
      .select(['id', 'project_no', 'title', 'status'])
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'asc')
      .execute();
    const start = typeof startDate === 'string' ? startDate : startDate.toISOString().slice(0, 10);
    const end = typeof endDate === 'string' ? endDate : endDate.toISOString().slice(0, 10);
    const rows: any[] = [];
    for (const p of projects) {
      const report = await this.generatePeriodProfitReport(tenantId, start, end, String(p.id));
      const shipments = await this.db
        .selectFrom('import_shipments')
        .select(['id', 'container_number', 'status'])
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', String(p.id))
        .orderBy('created_at', 'asc')
        .execute();
      const shipmentRows: any[] = [];
      for (const s of shipments) {
        const items = await this.db
          .selectFrom('import_shipment_items')
          .select(['received_quantity', 'quantity', 'landed_cost_egp'])
          .where('tenant_id', '=', tenantId)
          .where('shipment_id', '=', String(s.id))
          .execute();
        let receivedQuantity = 0;
        let landedCostEgp = 0;
        for (const it of items) {
          const qty = Number(it.received_quantity ?? it.quantity ?? 0);
          receivedQuantity += qty;
          landedCostEgp += qty * Number(it.landed_cost_egp || 0);
        }
        const allocs = await this.db
          .selectFrom('import_sale_allocations')
          .select(['quantity', 'unit_sale_price_egp', 'unit_cost_egp', 'allocation_type'])
          .where('tenant_id', '=', tenantId)
          .where('shipment_id', '=', String(s.id))
          .execute();
        let salesRevenueEgp = 0;
        let salesCostEgp = 0;
        for (const al of allocs) {
          const qty = Number(al.quantity || 0);
          const sign = al.allocation_type === 'return' || al.allocation_type === 'cancellation' || al.allocation_type === 'reversal' ? -1 : 1;
          salesRevenueEgp += sign * qty * Number(al.unit_sale_price_egp || 0);
          salesCostEgp += sign * qty * Number(al.unit_cost_egp || 0);
        }
        shipmentRows.push({
          shipmentId: String(s.id),
          containerNumber: String(s.container_number || ''),
          status: String(s.status || ''),
          receivedQuantity: Number(receivedQuantity.toFixed(4)),
          landedCostEgp: roundMoney(landedCostEgp, digits),
          salesRevenueEgp: roundMoney(salesRevenueEgp, digits),
          salesCostEgp: roundMoney(salesCostEgp, digits),
        });
      }
      rows.push({
        ...report.data,
        projectId: String(p.id),
        projectNo: String(p.project_no || ''),
        title: String(p.title || ''),
        status: String(p.status || ''),
        shipments: shipmentRows,
      });
    }
    const total = await this.generatePeriodProfitReport(tenantId, start, end);
    return { startDate: start, endDate: end, projects: rows, total: total.data };
  }

  // -------------------------------------------------------------
  // RECONCILIATION ENGINE & EXCEPTIONS CENTER
  // -------------------------------------------------------------
  async runImportReconciliationScan(tenantId: string) {
    const exceptions: any[] = [];

    const staleAdvances = await this.db
      .selectFrom('import_broker_advances')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'active')
      .execute();

    const today = new Date();
    for (const adv of staleAdvances) {
      // A fresh, not-yet-liquidated broker advance is a normal operation, not an exception.
      const disbursedOn = new Date(String(adv.disbursement_date));
      const ageDays = Number.isFinite(disbursedOn.getTime())
        ? (today.getTime() - disbursedOn.getTime()) / (24 * 60 * 60 * 1000) : 0;
      if (Number(adv.remaining_amount_egp) > 0 && ageDays > 30) {
        exceptions.push({
          tenant_id: tenantId,
          exception_type: 'broker_advance_mismatch',
          severity: 'high',
          project_id: adv.project_id,
          shipment_id: adv.shipment_id,
          discrepancy_amount_egp: adv.remaining_amount_egp,
          details: JSON.stringify({
            advanceNo: adv.advance_no,
            brokerId: adv.broker_id,
            remaining: adv.remaining_amount_egp,
          }),
          status: 'open',
        });
      }
    }

    const pendingDeposits = await this.db
      .selectFrom('import_container_deposits')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('refund_status', '=', 'pending')
      .execute();

    const todayStr = await resolveBusinessDateKey(this.db, tenantId, new Date());
    for (const dep of pendingDeposits) {
      if (dep.expected_return_date && (dep.expected_return_date as any) < todayStr) {
        exceptions.push({
          tenant_id: tenantId,
          exception_type: 'container_deposit_overdue',
          severity: 'critical',
          project_id: dep.project_id,
          shipment_id: dep.shipment_id,
          discrepancy_amount_egp: dep.deposit_amount_egp,
          details: JSON.stringify({
            containerNo: dep.container_no,
            shippingLine: dep.shipping_line,
            expectedDate: dep.expected_return_date,
          }),
          status: 'open',
        });
      }
    }

    const existingOpen = await this.db.selectFrom('import_reconciliation_exceptions')
      .select(['exception_type', 'shipment_id', 'project_id', 'details'])
      .where('tenant_id', '=', tenantId).where('status', '=', 'open').execute();
    let insertedCount = 0;
    for (const ex of exceptions) {
      const duplicate = existingOpen.some((row: any) =>
        row.exception_type === ex.exception_type &&
        row.shipment_id === ex.shipment_id && row.project_id === ex.project_id &&
        JSON.stringify(row.details) === JSON.stringify(typeof ex.details === 'string' ? JSON.parse(ex.details) : ex.details));
      if (duplicate) continue;
      await this.db.insertInto('import_reconciliation_exceptions').values(ex).execute();
      existingOpen.push({ exception_type: ex.exception_type, shipment_id: ex.shipment_id, project_id: ex.project_id, details: JSON.parse(ex.details) });
      insertedCount++;
    }

    return {
      scannedAt: new Date(),
      exceptionsFoundCount: insertedCount,
      exceptions,
    };
  }

  async listReconciliationExceptions(tenantId: string, status?: string) {
    let q = this.db.selectFrom('import_reconciliation_exceptions').selectAll().where('tenant_id', '=', tenantId);
    if (status) q = q.where('status', '=', status);
    return await q.orderBy('created_at', 'desc').execute();
  }

  async resolveReconciliationException(tenantId: string, userId: number, exceptionId: string, dto: ResolveExceptionDto) {
    return await this.db
      .updateTable('import_reconciliation_exceptions')
      .set({
        status: 'resolved',
        resolved_by: userId,
        resolution_notes: dto.resolutionNotes,
        resolved_at: new Date(),
      })
      .where('id', '=', exceptionId)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
