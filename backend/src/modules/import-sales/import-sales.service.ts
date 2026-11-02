import { randomUUID } from 'crypto';
import { Injectable, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException, Inject, Optional } from '@nestjs/common';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../accounting/accounting-tenant-foundation.service';
import { Kysely, sql, Transaction, Selectable, Updateable } from 'kysely';
import { Database, ImportShipmentTable, ImportShipmentItemTable } from '../../database/database.types';
import { calculateImportLandedCosts, groupImportReceipts, requireImportNumber } from './import-inventory-cost.engine';
import { revalueStockCost, valueStockReceipt } from '../accounting/inventory-valuation';
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
  ProcessLateExpenseDto,
  CalculateCustomsTaxDto,
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
} from './dto/import-sales.dto';
import { allocateSaleFromImportLots, calculateImportSaleCost } from './helpers/import-lot-allocation.helper';
import { applyStockDelta, lockStockProducts } from '../../common/utils/location-stock-ledger';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { calculateImportFeasibility, FeasibilityCalculationResult } from './engines/import-feasibility.engine';
import { EGYPT_CUSTOMS_TARIFFS, TARIFF_SECTORS } from './data/egypt-customs-tariffs.data';
import {
  calculateLandedCostBreakdown,
  calculateDemurrageRisk,
  calculateLateExpenseAllocation,
} from './engines/import-landed-cost.engine';

@Injectable()
export class ImportSalesService {
  private readonly inventoryDb: Kysely<Database>;
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<any>,
    @Optional() @Inject(AccountingPostingService) private readonly accountingPosting?: AccountingPostingService,
  ) {
    this.inventoryDb = db;
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
      if (role === 'broker_advance') {
        if (account.is_cash_bank || account.is_inventory || account.is_payable) return false;
        if (['1110', '1120', '1140', '1100'].includes(account.code)) return false;
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
      broker_advance: ['1130', '1181', '1230'],
      container_deposit: ['1180', '1182', '1240'],
      customer_advance: ['2130', '2120'],
      vat_receivable: ['1160', '1150'],
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
   * Helper to verify and consume a Maker-Checker approval request for sensitive actions
   */
  private async verifyAndConsumeApprovalRequest(
    trx: any,
    tenantId: string,
    actionType: string,
    referenceId: string,
    approvalRequestId?: string,
    expectedDetails?: { amount?: number; projectId?: string; partnerId?: string }
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

    return await this.db.transaction().execute(async (trx) => {
      // Serialize creation / percentage edits across all partners of this tenant.
      await trx.selectFrom('tenants').select('id')
        .where('id', '=', tenantId).forUpdate().executeTakeFirstOrThrow();

      const existing = await trx.selectFrom('import_partners')
        .select(sql<number>`coalesce(sum(profit_share_percentage), 0)`.as('total_percentage'))
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (Number(existing?.total_percentage || 0) + cleanPercentage > 100.001) {
        throw new BadRequestException('مجموع نسب الشركاء سيتجاوز 100%.');
      }

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

        const existing = await trx.selectFrom('import_partners')
          .select(sql<number>`coalesce(sum(profit_share_percentage), 0)`.as('total_percentage'))
          .where('tenant_id', '=', tenantId)
          .where('id', '!=', id)
          .executeTakeFirst();
        const otherTotal = Number(existing?.total_percentage || 0);
        if (otherTotal + Number(percentage) > 100.001) {
          throw new BadRequestException(`مجموع نسب الشركاء سيتجاوز 100% (باقي الشركاء: ${otherTotal}%).`);
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
    let query = this.db
      .selectFrom('import_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc');

    if (status) {
      query = query.where('status', '=', status);
    }

    const projects = await query.execute();

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

    return projects.map((p) => ({
      ...p,
      shipmentCount: countByProject.get(String(p.id)) || 0,
    }));
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

    return {
      ...project,
      shipments,
      qcInspections,
      sourcingTrips,
      aciRecords,
      partners,
    };
  }

  async createProject(tenantId: string, dto: CreateImportProjectDto) {
    return await this.db.transaction().execute(async (trx) => {
      const todayCount = await trx
        .selectFrom('import_projects')
        .select(sql<number>`count(*)`.as('count'))
        .where('tenant_id', '=', tenantId)
        .where('created_at', '>=', sql`CURRENT_DATE`)
        .executeTakeFirst();

      const seq = Number(todayCount?.count || 0) + 1;
      const projectNo = dto.projectNo || formatDailyDocumentNumber('IMP', seq);

      const project = await trx
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
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (dto.partners && Array.isArray(dto.partners) && dto.partners.length > 0) {
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
            await trx
              .insertInto('import_project_partners')
              .values({
                tenant_id: tenantId,
                project_id: project.id,
                partner_id: partnerId,
                capital_share_amount: Number(p.capitalShare || 0),
                profit_percentage: Number(p.profitPercentage || 0),
                is_active: true,
                effective_from: new Date().toISOString().slice(0, 10),
              })
              .onConflict((oc) =>
                oc.columns(['tenant_id', 'project_id', 'partner_id']).doUpdateSet({
                  capital_share_amount: Number(p.capitalShare || 0),
                  profit_percentage: Number(p.profitPercentage || 0),
                  is_active: true,
                  effective_from: new Date().toISOString().slice(0, 10),
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
    const payload: any = { updated_at: sql`NOW()` };
    if (dto.title !== undefined) payload.title = dto.title.trim();
    if (dto.targetMarket !== undefined) payload.target_market = dto.targetMarket;
    if (dto.countryOrigin !== undefined) payload.country_origin = dto.countryOrigin;
    if (dto.countryDestination !== undefined) payload.country_destination = dto.countryDestination;
    if (dto.budgetCurrency !== undefined) payload.budget_currency = dto.budgetCurrency;
    if (dto.allocatedCapital !== undefined) payload.allocated_capital = dto.allocatedCapital;
    if (dto.targetRoiPercentage !== undefined) payload.target_roi_percentage = dto.targetRoiPercentage;
    if (dto.status !== undefined) payload.status = dto.status;
    if (dto.feasibilityData !== undefined) payload.feasibility_data = JSON.stringify(dto.feasibilityData);
    if (dto.notes !== undefined) payload.notes = dto.notes;

    return await this.db
      .updateTable('import_projects')
      .set(payload)
      .where('id', '=', projectId)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  calculateFeasibility(dto: CalculateFeasibilityDto): FeasibilityCalculationResult {
    return calculateImportFeasibility(dto);
  }

  // ==========================================
  // 3. CHINA SOURCING & QC INSPECTIONS
  // ==========================================

  async createChinaSupplier(tenantId: string, userId: string | number, dto: CreateChinaSupplierDto) {
    const name = String(dto.name || '').trim();
    if (!name) {
      throw new BadRequestException('اسم المصنع أو المورد الدولي مطلوب');
    }

    return await this.db.transaction().execute(async (trx) => {
      // Check if supplier name exists in this tenant
      const existing = await trx
        .selectFrom('suppliers')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where(sql`LOWER(name)`, '=', name.toLowerCase())
        .executeTakeFirst();

      let supplierId: number;
      if (existing) {
        supplierId = Number(existing.id);
      } else {
        const address = String(dto.address || (dto.city ? `${dto.city}, ${dto.province || 'China'}` : 'China')).trim();
        const inserted = await trx
          .insertInto('suppliers')
          .values({
            name,
            phone: String(dto.phone || '').trim(),
            address,
            balance: 0,
            notes: String(dto.notes || '').trim(),
            metadata: JSON.stringify({ is_international: true, country: 'China' }),
            is_active: true,
            tenant_id: tenantId,
          } as any)
          .returning('id')
          .executeTakeFirstOrThrow();
        supplierId = Number(inserted.id);
      }

      // Check existing meta
      const existingMeta = await trx
        .selectFrom('import_suppliers_meta')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('supplier_id', '=', supplierId)
        .executeTakeFirst();

      const bankDetails = {
        beneficiaryName: dto.bankBeneficiary || '',
        bankName: dto.bankName || '',
        swiftCode: dto.bankSwift || '',
        ibanOrAccount: dto.bankAccount || '',
      };

      const hasBank = Boolean(dto.bankName && dto.bankSwift);

      if (existingMeta) {
        await trx
          .updateTable('import_suppliers_meta')
          .set({
            chinese_name: dto.chineseName || null,
            city: dto.city || null,
            province: dto.province || null,
            moq_description: dto.moqDescription || null,
            production_lead_time_days: dto.productionLeadTimeDays ?? 30,
            verified_bank_details: JSON.stringify(bankDetails),
            incoterms_accepted: JSON.stringify(dto.incotermsAccepted || ['FOB', 'EXW', 'CIF']),
            qc_rating: 5.0,
            audit_status: hasBank ? 'verified' : 'unverified',
            verified_at: hasBank ? new Date() : null,
            verified_by: hasBank ? Number(userId) : null,
            verification_notes: hasBank ? 'تم توثيق الحساب البنكي رسمياً أثناء تسجيل المصنع' : null,
            notes: dto.notes || null,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', existingMeta.id)
          .execute();
      } else {
        await trx
          .insertInto('import_suppliers_meta')
          .values({
            tenant_id: tenantId,
            supplier_id: supplierId,
            chinese_name: dto.chineseName || null,
            city: dto.city || null,
            province: dto.province || null,
            moq_description: dto.moqDescription || null,
            production_lead_time_days: dto.productionLeadTimeDays ?? 30,
            verified_bank_details: JSON.stringify(bankDetails),
            incoterms_accepted: JSON.stringify(dto.incotermsAccepted || ['FOB', 'EXW', 'CIF']),
            qc_rating: 5.0,
            quality_certifications: JSON.stringify([]),
            audit_status: hasBank ? 'verified' : 'unverified',
            verified_at: hasBank ? new Date() : null,
            verified_by: hasBank ? Number(userId) : null,
            verification_notes: hasBank ? 'تم توثيق الحساب البنكي رسمياً أثناء تسجيل المصنع' : null,
            notes: dto.notes || null,
          } as any)
          .execute();
      }

      return {
        ok: true,
        supplierId,
        name,
        chineseName: dto.chineseName,
        city: dto.city,
      };
    });
  }

  async listChinaSuppliers(tenantId: string) {
    return await this.db
      .selectFrom('suppliers')
      .leftJoin('import_suppliers_meta', (join) =>
        join
          .onRef('import_suppliers_meta.supplier_id', '=', 'suppliers.id')
          .onRef('import_suppliers_meta.tenant_id', '=', 'suppliers.tenant_id')
      )
      .select([
        'suppliers.id',
        'suppliers.name',
        'suppliers.phone',
        'suppliers.balance',
        'import_suppliers_meta.chinese_name',
        'import_suppliers_meta.city',
        'import_suppliers_meta.province',
        'import_suppliers_meta.moq_description',
        'import_suppliers_meta.production_lead_time_days',
        'import_suppliers_meta.verified_bank_details',
        'import_suppliers_meta.incoterms_accepted',
        'import_suppliers_meta.qc_rating',
        'import_suppliers_meta.quality_certifications',
        'import_suppliers_meta.audit_status',
        'import_suppliers_meta.verified_at',
        'import_suppliers_meta.verified_by',
        'import_suppliers_meta.verification_notes',
        'import_suppliers_meta.notes as import_notes',
      ])
      .where('suppliers.tenant_id', '=', tenantId)
      .orderBy('suppliers.name', 'asc')
      .execute();
  }

  async upsertSupplierImportMeta(tenantId: string, supplierId: string, dto: UpsertSupplierMetaDto) {
    const sId = Number(supplierId);
    return await this.db.transaction().execute(async (trx) => {
      const supplier = await trx
        .selectFrom('suppliers')
        .select('id')
        .where('id', '=', sId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!supplier) {
        throw new NotFoundException('المورد غير موجود بالمنشأة.');
      }

      const existing = await trx
        .selectFrom('import_suppliers_meta')
        .select(['id', 'audit_status'])
        .where('tenant_id', '=', tenantId)
        .where('supplier_id', '=', sId)
        .executeTakeFirst();

      // Newly added bank accounts must be 'unverified' by default until formally audited
      const auditStatus = dto.auditStatus && existing?.audit_status === 'verified'
        ? dto.auditStatus
        : 'unverified';

      const payload: any = {
        chinese_name: dto.chineseName,
        city: dto.city,
        province: dto.province,
        moq_description: dto.moqDescription,
        production_lead_time_days: dto.productionLeadTimeDays ?? 30,
        verified_bank_details: dto.verifiedBankDetails ? JSON.stringify(dto.verifiedBankDetails) : '{}',
        incoterms_accepted: dto.incotermsAccepted ? JSON.stringify(dto.incotermsAccepted) : JSON.stringify(['FOB', 'EXW', 'CIF']),
        qc_rating: dto.qcRating ?? 5.0,
        quality_certifications: dto.qualityCertifications ? JSON.stringify(dto.qualityCertifications) : '[]',
        audit_status: auditStatus,
        notes: dto.notes,
        updated_at: sql`NOW()`,
      };

      if (existing) {
        return await trx
          .updateTable('import_suppliers_meta')
          .set(payload)
          .where('id', '=', existing.id)
          .where('tenant_id', '=', tenantId)
          .returningAll()
          .executeTakeFirstOrThrow();
      } else {
        return await trx
          .insertInto('import_suppliers_meta')
          .values({
            tenant_id: tenantId,
            supplier_id: sId,
            ...payload,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }
    });
  }

  async verifySupplierBankDetails(
    tenantId: string,
    userId: number,
    supplierId: string,
    verificationNotes?: string
  ) {
    const sId = Number(supplierId);
    return await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('import_suppliers_meta')
        .selectAll()
        .where('supplier_id', '=', sId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!existing) {
        throw new NotFoundException('بيانات المورد غير مسجلة.');
      }

      await trx
        .updateTable('import_suppliers_meta')
        .set({
          audit_status: 'verified',
          verified_at: new Date(),
          verified_by: userId,
          verification_notes: verificationNotes || 'تم التحقق والاعتماد رسمياً للحساب البنكي للمورد.',
          updated_at: sql`NOW()`,
        })
        .where('supplier_id', '=', sId)
        .where('tenant_id', '=', tenantId)
        .execute();

      return { success: true, message: 'تم اعتماد وتوثيق الحساب البنكي للمورد بنجاح.' };
    });
  }

  async listSourcingTrips(tenantId: string, projectId?: string) {
    let query = this.db
      .selectFrom('import_sourcing_trips')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('start_date', 'desc');

    if (projectId) {
      query = query.where('project_id', '=', projectId);
    }

    return await query.execute();
  }

  async createSourcingTrip(tenantId: string, dto: CreateSourcingTripDto) {
    return await this.db
      .insertInto('import_sourcing_trips')
      .values({
        tenant_id: tenantId,
        project_id: dto.projectId,
        trip_title: dto.tripTitle.trim(),
        destination_city: dto.destinationCity.trim(),
        start_date: dto.startDate,
        end_date: dto.endDate,
        budget_egp: dto.budgetEgp || 0,
        actual_cost_egp: dto.actualCostEgp || 0,
        notes: dto.notes,
        findings: dto.findings ? JSON.stringify(dto.findings) : '{}',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listQcInspections(tenantId: string, projectId?: string, shipmentId?: string) {
    let query = this.db
      .selectFrom('import_qc_inspections')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('inspection_date', 'desc');

    if (projectId) query = query.where('project_id', '=', projectId);
    if (shipmentId) query = query.where('shipment_id', '=', shipmentId);

    return await query.execute();
  }

  async createQcInspection(tenantId: string, dto: CreateQcInspectionDto) {
    return await this.db
      .insertInto('import_qc_inspections')
      .values({
        tenant_id: tenantId,
        project_id: dto.projectId,
        shipment_id: dto.shipmentId,
        stage: dto.stage,
        inspection_date: dto.inspectionDate,
        inspector_name: dto.inspectorName,
        sample_size: dto.sampleSize || 0,
        passed_quantity: dto.passedQuantity || 0,
        failed_quantity: dto.failedQuantity || 0,
        defect_notes: dto.defectNotes,
        status: dto.status || 'passed',
        report_file_url: dto.reportFileUrl,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateQcInspection(tenantId: string, id: string, dto: Partial<CreateQcInspectionDto>) {
    const payload: any = {};
    if (dto.stage !== undefined) payload.stage = dto.stage;
    if (dto.inspectionDate !== undefined) payload.inspection_date = dto.inspectionDate;
    if (dto.inspectorName !== undefined) payload.inspector_name = dto.inspectorName;
    if (dto.sampleSize !== undefined) payload.sample_size = dto.sampleSize;
    if (dto.passedQuantity !== undefined) payload.passed_quantity = dto.passedQuantity;
    if (dto.failedQuantity !== undefined) payload.failed_quantity = dto.failedQuantity;
    if (dto.defectNotes !== undefined) payload.defect_notes = dto.defectNotes;
    if (dto.status !== undefined) payload.status = dto.status;
    if (dto.reportFileUrl !== undefined) payload.report_file_url = dto.reportFileUrl;

    return await this.db
      .updateTable('import_qc_inspections')
      .set(payload)
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ==========================================
  // 4. EGYPT COMPLIANCE & ACI / CUSTOMS TARIFFS
  // ==========================================

  async getAciCompliance(tenantId: string, targetId: string) {
    return await this.db
      .selectFrom('import_aci_compliance')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where((eb) => eb.or([eb('id', '=', targetId), eb('shipment_id', '=', targetId), eb('project_id', '=', targetId)]))
      .executeTakeFirst();
  }

  async upsertAciCompliance(tenantId: string, dto: UpsertAciComplianceDto) {
    return await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('import_aci_compliance')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where((eb) =>
          eb.or([
            eb('acid_number', '=', dto.acidNumber),
            ...(dto.shipmentId ? [eb('shipment_id', '=', dto.shipmentId)] : []),
          ])
        )
        .executeTakeFirst();

      const payload: any = {
        project_id: dto.projectId,
        shipment_id: dto.shipmentId,
        acid_number: dto.acidNumber.trim(),
        acid_issue_date: dto.acidIssueDate,
        acid_expiry_date: dto.acidExpiryDate,
        cargox_document_id: dto.cargoxDocumentId,
        importer_tax_number: dto.importerTaxNumber,
        exporter_id: dto.exporterId,
        status: dto.status || 'pending',
        compliance_checklist: dto.complianceChecklist ? JSON.stringify(dto.complianceChecklist) : '{}',
        notes: dto.notes,
      };

      if (existing) {
        return await trx
          .updateTable('import_aci_compliance')
          .set(payload)
          .where('id', '=', existing.id)
          .where('tenant_id', '=', tenantId)
          .returningAll()
          .executeTakeFirstOrThrow();
      } else {
        return await trx
          .insertInto('import_aci_compliance')
          .values({
            tenant_id: tenantId,
            ...payload,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }
    });
  }

  listTariffSectors() {
    return TARIFF_SECTORS;
  }

  async syncOfficialTariffs(tenantId: string) {
    for (const item of EGYPT_CUSTOMS_TARIFFS) {
      await this.db
        .insertInto('import_customs_tariffs')
        .values({
          tenant_id: tenantId,
          hs_code: item.hs_code,
          description_ar: item.description_ar,
          description_en: item.description_en || null,
          duty_rate_percent: item.duty_rate_percent,
          vat_rate_percent: item.vat_rate_percent,
          inspection_fees_percent: item.inspection_fees_percent,
          regulatory_body: item.regulatory_body || 'GOEIC',
          sector: item.sector,
          category_ar: item.category_ar,
          official_source: item.official_source,
          is_official: true,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'hs_code']).doUpdateSet({
            description_ar: item.description_ar,
            description_en: item.description_en || null,
            duty_rate_percent: item.duty_rate_percent,
            vat_rate_percent: item.vat_rate_percent,
            inspection_fees_percent: item.inspection_fees_percent,
            regulatory_body: item.regulatory_body || 'GOEIC',
            sector: item.sector,
            category_ar: item.category_ar,
            official_source: item.official_source,
            is_official: true,
          })
        )
        .execute();
    }
    return { success: true, count: EGYPT_CUSTOMS_TARIFFS.length };
  }

  async listCustomsTariffs(tenantId: string, search?: string, sector?: string) {
    const existingCount = await this.db
      .selectFrom('import_customs_tariffs')
      .where('tenant_id', '=', tenantId)
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();

    if (Number(existingCount?.cnt || 0) < 15) {
      await this.syncOfficialTariffs(tenantId);
    }

    let query = this.db
      .selectFrom('import_customs_tariffs')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (sector && sector !== 'all') {
      query = query.where('sector', '=', sector);
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb('hs_code', 'like', s),
          eb('description_ar', 'like', s),
          eb('description_en', 'like', s),
          eb('category_ar', 'like', s),
        ])
      );
    }

    return await query.orderBy('hs_code', 'asc').execute();
  }

  async calculateCustomsTax(
    tenantId: string,
    hsCode: string,
    cifValueEgp: number,
    overrides?: { overrideDutyRatePercent?: number; overrideVatRatePercent?: number }
  ) {
    const tariff = await this.db
      .selectFrom('import_customs_tariffs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('hs_code', '=', hsCode)
      .executeTakeFirst();

    const isOfficial = Boolean(tariff && (tariff as any).is_official);
    const isDocumented = isOfficial;
    let dutyRate = 0;
    let vatRate = 0;
    let inspRate = 0;
    let source = '';

    if (tariff && isOfficial) {
      dutyRate = Number(tariff.duty_rate_percent) / 100;
      vatRate = Number(tariff.vat_rate_percent) / 100;
      inspRate = Number(tariff.inspection_fees_percent || 0) / 100;
      source = (tariff as any).official_source || 'مصلحة الجمارك المصرية (بند رسمي موثق)';
    } else if (tariff && !isOfficial) {
      dutyRate = Number(tariff.duty_rate_percent) / 100;
      vatRate = Number(tariff.vat_rate_percent) / 100;
      inspRate = Number(tariff.inspection_fees_percent || 0) / 100;
      source = 'تعريفة تقديرية غير رسمية (تتطلب مراجعة مستخلص جمركي)';
    } else if (
      overrides &&
      (overrides.overrideDutyRatePercent !== undefined || overrides.overrideVatRatePercent !== undefined)
    ) {
      dutyRate = Math.max(0, Number(overrides.overrideDutyRatePercent || 0)) / 100;
      vatRate = Math.max(0, Number(overrides.overrideVatRatePercent || 0)) / 100;
      inspRate = 0;
      source = 'تقدير يدوي مؤقت من المستخدم (غير رسمي)';
    } else {
      return {
        hsCode,
        isDocumentedTariff: false,
        isOfficialTariff: false,
        message: 'البند الجمركي غير مسجل بالتعريفة الرسمية المعتمدة. يلزم إدخال النسبة المعتمدة يدوياً.',
        cifValueEgp: Number(cifValueEgp || 0),
        customsDuty: 0,
        inspectionFees: 0,
        vatAmount: 0,
        totalCustomsDues: 0,
        dutyRatePercent: 0,
        vatRatePercent: 0,
      };
    }

    const cif = Math.max(0, Number(cifValueEgp) || 0);
    const customsDuty = cif * dutyRate;
    const inspectionFees = cif * inspRate;
    const vatBase = cif + customsDuty + inspectionFees;
    const vatAmount = vatBase * vatRate;
    const totalCustomsDues = customsDuty + inspectionFees + vatAmount;

    return {
      hsCode,
      isDocumentedTariff: isDocumented,
      isOfficialTariff: isOfficial,
      source,
      description: tariff?.description_ar || 'بند جمركي غير مسجل بالتعريفة الرسمية',
      regulatoryBody: tariff?.regulatory_body || 'غير محدد',
      cifValueEgp: Number(cif.toFixed(2)),
      customsDuty: Number(customsDuty.toFixed(2)),
      inspectionFees: Number(inspectionFees.toFixed(2)),
      vatAmount: Number(vatAmount.toFixed(2)),
      totalCustomsDues: Number(totalCustomsDues.toFixed(2)),
      dutyRatePercent: Number((dutyRate * 100).toFixed(2)),
      vatRatePercent: Number((vatRate * 100).toFixed(2)),
    };
  }

  // ==========================================
  // 5. SHIPMENTS & INVENTORY ATOMIC RECEIPTS
  // ==========================================

  async listShipments(tenantId: string) {
    const rows = await this.db
      .selectFrom('import_shipments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc')
      .execute();
      
    const stats = {
      sea: rows.filter(r => r.status === 'Pending').length,
      customs: rows.filter(r => r.status === 'In Customs').length,
      arrived: rows.filter(r => r.status === 'Arrived').length,
    };
    
    return { rows, stats };
  }

  async createShipment(tenantId: string, dto: CreateShipmentDto) {
    if (dto.supplierId) {
      const supplier = await this.db.selectFrom('suppliers').select('id')
        .where('tenant_id', '=', tenantId).where('id', '=', Number(dto.supplierId)).executeTakeFirst();
      if (!supplier) throw new BadRequestException('المورد لا ينتمي لهذه المنشأة.');
    }
    if (dto.projectId) {
      const project = await this.db.selectFrom('import_projects').select(['id', 'status'])
        .where('tenant_id', '=', tenantId).where('id', '=', dto.projectId).executeTakeFirst();
      if (!project || project.status === 'closed') throw new BadRequestException('مشروع الاستيراد غير متاح لهذه المنشأة.');
    }
    const result = await this.db
      .insertInto('import_shipments')
      .values({
        tenant_id: tenantId,
        container_number: dto.containerNumber,
        arrival_date: dto.arrivalDate,
        shipped_date: dto.shippingDate,
        supplier_id: dto.supplierId ? Number(dto.supplierId) : null,
        bill_of_lading: dto.billOfLading,
        project_id: dto.projectId,
        freight_type: dto.freightType,
        container_size: dto.containerSize,
        port_of_loading: dto.portOfLoading,
        port_of_discharge: dto.portOfDischarge,
        cbm_volume: dto.cbmVolume,
        gross_weight_kg: dto.grossWeightKg,
        carrier_name: dto.carrierName,
        free_demurrage_days: dto.freeDemurrageDays,
        demurrage_start_date: dto.demurrageStartDate,
        demurrage_rate_per_day: dto.demurrageRatePerDay,
        customs_declaration_no: dto.customsDeclarationNo,
        vat_refundable_egp: dto.vatRefundableEgp,
        is_consolidated: dto.isConsolidated,
        cost_allocation_method: dto.costAllocationMethod,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return result;
  }

  async getShipmentById(tenantId: string, id: string) {
    const shipment = await this.db
      .selectFrom('import_shipments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!shipment) throw new NotFoundException('Shipment not found');

    const items = await this.db
      .selectFrom('import_shipment_items')
      .leftJoin('products', 'products.id', 'import_shipment_items.product_id')
      .select([
        'import_shipment_items.id',
        'import_shipment_items.product_id',
        'import_shipment_items.quantity',
        'import_shipment_items.factory_unit_price_usd',
        'import_shipment_items.allocated_overhead_egp',
        'import_shipment_items.landed_cost_egp',
        'import_shipment_items.received_quantity',
        'import_shipment_items.target_retail_margin',
        'import_shipment_items.target_wholesale_margin',
        'import_shipment_items.shortage_handling_method',
        'import_shipment_items.created_at',
        'products.name as product_name',
      ])
      .where('import_shipment_items.tenant_id', '=', tenantId)
      .where('import_shipment_items.shipment_id', '=', id)
      .orderBy('import_shipment_items.created_at', 'asc')
      .execute();

    const receipt = await this.inventoryDb.selectFrom('import_inventory_receipts')
      .select(['id', 'state', 'posted_at', 'review_reason', 'journal_entry_id'])
      .where('tenant_id', '=', tenantId).where('shipment_id', '=', id).executeTakeFirst();

    const demurrageRisk = calculateDemurrageRisk({
      arrivalDate: shipment.arrival_date,
      demurrageStartDate: shipment.demurrage_start_date,
      freeDays: Number(shipment.free_demurrage_days ?? 14),
      ratePerDayUsd: Number(shipment.demurrage_rate_per_day ?? 50),
      exchangeRate: Number(shipment.exchange_rate_at_arrival || 1),
      status: shipment.container_status === 'empty_returned' ? 'empty_returned' : (shipment.status || 'Pending'),
    });

    return { ...shipment, items, inventory_receipt: receipt ?? null, demurrageRisk };
  }

  async addShipmentItem(tenantId: string, shipmentId: string, dto: AddShipmentItemDto) {
    return this.inventoryDb.transaction().execute(async (trx) => {
      const state = await this.lockShipment(trx, tenantId, shipmentId);
      this.assertShipmentEditable(state);
      const productId = requireImportNumber(dto.productId, 'الصنف', 1);
      if (!Number.isSafeInteger(productId)) throw new BadRequestException('معرف الصنف غير صالح');
      const product = await trx.selectFrom('products').select('id')
        .where('tenant_id', '=', tenantId).where('id', '=', productId).executeTakeFirst();
      if (!product) throw new NotFoundException('الصنف غير موجود في المنشأة');
      requireImportNumber(dto.quantity, 'الكمية', 1);
      requireImportNumber(dto.factoryUnitPriceUsd, 'سعر المصنع');
      if (!Number.isInteger(dto.quantity)) throw new BadRequestException('الكمية يجب أن تكون عددًا صحيحًا');
      const item = await trx.insertInto('import_shipment_items').values({
        tenant_id: tenantId, shipment_id: shipmentId, product_id: productId,
        quantity: dto.quantity, factory_unit_price_usd: dto.factoryUnitPriceUsd,
        gross_weight_kg_unit: requireImportNumber(dto.unitWeightKg ?? 0, 'وزن الوحدة'),
        cbm_unit: requireImportNumber(dto.unitCbm ?? 0, 'حجم الوحدة'),
      }).returningAll().executeTakeFirstOrThrow();
      await this.calculateLandedCostInTransaction(trx, state.shipment);
      return trx.selectFrom('import_shipment_items').selectAll()
        .where('tenant_id', '=', tenantId).where('id', '=', item.id).executeTakeFirstOrThrow();
    });
  }

  async importProjectItemsToShipment(tenantId: string, userId: number, shipmentId: string) {
    return this.inventoryDb.transaction().execute(async (trx) => {
      const state = await this.lockShipment(trx, tenantId, shipmentId);
      this.assertShipmentEditable(state);
      const { shipment } = state;

      if (!shipment.project_id) {
        throw new BadRequestException('هذه الحاوية غير مربوطة بمشروع استيراد. يرجى ربطها بالمشروع أولاً.');
      }

      const project = await trx
        .selectFrom('import_projects')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', shipment.project_id)
        .executeTakeFirst();

      if (!project) {
        throw new NotFoundException('مشروع الاستيراد المرتبط بالحاوية غير موجود.');
      }

      const feas = typeof project.feasibility_data === 'string'
        ? JSON.parse(project.feasibility_data || '{}')
        : (project.feasibility_data || {});

      const items = Array.isArray(feas.items) && feas.items.length > 0
        ? feas.items
        : (Array.isArray((project as any).items) ? (project as any).items : []);

      if (items.length === 0) {
        throw new BadRequestException('دراسة جدوى المشروع لا تحتوي على أصناف مسجلة لاستيرادها.');
      }

      const existingItems = await trx
        .selectFrom('import_shipment_items')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', shipmentId)
        .execute();

      if (existingItems.length > 0) {
        throw new BadRequestException('الحاوية تحتوي بالفعل على أصناف مسجلة. قم بحذفها أولاً أو أضف الأصناف يدوياً لمنع التكرار.');
      }

      let scopeAccountId = tenantId;
      const rawShipmentSupplier = (shipment as any)?.supplier_id;
      if (rawShipmentSupplier) {
        const sup = await trx.selectFrom('suppliers').select('account_id')
          .where('tenant_id', '=', tenantId).where('id', '=', Number(rawShipmentSupplier)).executeTakeFirst();
        if (sup?.account_id) scopeAccountId = sup.account_id;
      }

      let categoryId: number | null = null;
      const categoryName = 'قطع غيار شاحنات ونقل ثقيل';
      let cat = await trx
        .selectFrom('product_categories')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('name', '=', categoryName)
        .executeTakeFirst();
      if (!cat) {
        cat = await trx
          .insertInto('product_categories')
          .values({
            tenant_id: tenantId,
            account_id: scopeAccountId,
            name: categoryName,
            is_active: true,
          } as any)
          .returning('id')
          .executeTakeFirst();
      }
      if (cat) categoryId = Number(cat.id);

      const rawSupplierId = (project as any)?.supplier_id || rawShipmentSupplier || feas?.supplierId || null;
      const projectSupplierId = rawSupplierId ? Number(rawSupplierId) : null;

      const defaultOems: Record<string, string> = {
        'طقم تيل فرامل وبطانات مكابح شاحنات وتريلات ثقيلة': 'WG9100440030',
        'طقم بستم وشنابر محرك ديزل 6 سلندر شاحنات نقل ثقيل': 'VG1560030010',
        'طقم دبرياج كامل (ديسك + اسطوانة + بلية) شاحنات نقل ثقيل': 'WG9114160010',
        'شواحن توربينية (تيربو) لمحركات شاحنات النقل الثقيل والديزل': 'VG1560118227',
        'فلاتر زيت وفلاتر وقود ديزل (جاز) لشاحنات وسيارات النقل': 'VG61000070005',
        'إطارات هوائية سلك جديدة للشاحنات والمقطورات (315/80R22.5 و 295/80R22.5)': 'TYR-31580R225',
        'سوست ورقية مصفحة متعددة الطبقات (ستست ورق وحديد شاحنات ومقطورات)': 'AZ9725520278',
        'محركات ديزل جديدة كاملة مخصصة لسيارات النقل والشاحنات التجارية': 'WD615.47-ENG',
        'فوانيس أمامية وخلفية وكشافات ضباب ولمبات إشارة للشاحنات والتريلات': 'WG9719720001',
        'مولدات كهرباء وشحن بطاريات (دينامو شاحنات 24V و 12V)': 'VG1560090012',
        'مواتير بادئ الحركة (مارش شاحنات ديزل 24V و 12V)': 'VG1560090001',
      };

      const exchangeRate = Number(shipment.exchange_rate_at_arrival || feas.exchangeRateCommercial || 50);

      const insertedItems: any[] = [];
      let itemIndex = 0;
      for (const it of items) {
        itemIndex++;
        const itemName = String(it.name || it.productName || '').trim();
        const qty = Math.max(1, Math.round(Number(it.qty ?? it.quantity ?? 1)));
        const foreignPrice = Number(it.factoryPriceUsd ?? it.unitPriceForeign ?? it.unitPriceUsd ?? 0);
        const weightKg = Number(it.unitWeightKg || 0);
        const cbm = Number(it.unitCbm || 0);

        const oemNumber = it.oemNumber || it.partNumber || it.part_number || defaultOems[itemName] || `TRK-OEM-${String(itemIndex).padStart(4, '0')}`;
        const sku = it.sku || oemNumber || `TRK-${project.project_no?.replace('IMP-', '') || '2610'}-${String(itemIndex).padStart(3, '0')}`;
        const barcode = it.barcode || `200${String(project.project_no || '').replace(/\D/g, '').slice(-4)}${String(itemIndex).padStart(4, '0')}`;
        const metadata = {
          oemNumber,
          partNumber: oemNumber,
          carBrand: it.brand || it.carBrand || 'شاحنات نقل ثقيل (HOWO / Shacman / Weichai)',
          carModel: it.model || it.carModel || 'ديزل تجاري',
          carYearFrom: it.carYearFrom || 2018,
          carYearTo: it.carYearTo || 2026,
          origin: 'الصين',
          projectNo: project.project_no,
          containerNo: shipment.container_number,
          importedAt: new Date().toISOString(),
        };

        let productId = Number(it.productId ?? it.product_id);
        let product: any = null;

        if (Number.isSafeInteger(productId) && productId > 0) {
          product = await trx
            .selectFrom('products')
            .selectAll()
            .where('tenant_id', '=', tenantId)
            .where('id', '=', productId)
            .executeTakeFirst();
        }

        if (!product && itemName) {
          product = await trx
            .selectFrom('products')
            .selectAll()
            .where('tenant_id', '=', tenantId)
            .where(sql`LOWER(name)`, '=', itemName.toLowerCase())
            .executeTakeFirst();

          if (!product) {
            const estimatedCost = Number((foreignPrice * exchangeRate).toFixed(3));
            product = await trx
              .insertInto('products')
              .values({
                tenant_id: tenantId,
                account_id: scopeAccountId,
                name: itemName,
                sku,
                barcode,
                supplier_id: projectSupplierId,
                category_id: categoryId,
                cost_price: estimatedCost,
                retail_price: Number((estimatedCost * 1.35).toFixed(3)),
                wholesale_price: Number((estimatedCost * 1.2).toFixed(3)),
                stock_qty: 0,
                min_stock_qty: 0,
                notes: `صنف استيراد من مشروع ${project.project_no} - حاوية ${shipment.container_number}`,
                is_active: true,
                item_kind: 'standard',
                item_type: 'product',
                track_serials: false,
                reserved_qty: 0,
                metadata,
                catalog_updated_at: new Date(),
              } as any)
              .returning(['id', 'name'])
              .executeTakeFirstOrThrow();
          } else {
            await trx
              .updateTable('products')
              .set({
                supplier_id: projectSupplierId || undefined,
                category_id: categoryId || undefined,
                sku: (product as any).sku || sku,
                barcode: (product as any).barcode || barcode,
                notes: `صنف استيراد من مشروع ${project.project_no} - حاوية ${shipment.container_number}`,
                metadata: {
                  ...((product.metadata && typeof product.metadata === 'object') ? product.metadata : {}),
                  ...metadata,
                },
                catalog_updated_at: new Date(),
              } as any)
              .where('id', '=', Number(product.id))
              .where('tenant_id', '=', tenantId)
              .execute();
          }
          productId = Number(product.id);
        }

        if (productId) {
          const inserted = await trx
            .insertInto('import_shipment_items')
            .values({
              tenant_id: tenantId,
              shipment_id: shipmentId,
              product_id: productId,
              quantity: qty,
              factory_unit_price_usd: foreignPrice,
              gross_weight_kg_unit: weightKg,
              cbm_unit: cbm,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          insertedItems.push(inserted);
        }
      }

      await this.calculateLandedCostInTransaction(trx, state.shipment);

      return {
        success: true,
        importedCount: insertedItems.length,
        items: insertedItems,
      };
    });
  }

  async updateShipmentCosts(tenantId: string, userId: number, shipmentId: string, dto: UpdateShipmentCostsDto) {
    await this.inventoryDb.transaction().execute(async (trx) => {
      const state = await this.lockShipment(trx, tenantId, shipmentId);
      const { shipment, receipt } = state;
      const numericFields = [
        ['shippingCostUsd', 'shipping_cost_usd'], ['customsCostEgp', 'customs_cost_egp'],
        ['internalTransportCostEgp', 'internal_transport_cost_egp'],
        ['exchangeRateAtArrival', 'exchange_rate_at_arrival'],
      ] as const;
      const payload: Updateable<ImportShipmentTable> = {};
      let financialChange = false;
      for (const [input, column] of numericFields) {
        if (dto[input] !== undefined) {
          const value = requireImportNumber(dto[input], input, input === 'exchangeRateAtArrival' ? Number.MIN_VALUE : 0);
          const scale = input === 'exchangeRateAtArrival' ? 4 : 2;
          if (value !== Number(value.toFixed(scale))) throw new BadRequestException(`دقة غير صالحة: ${input}`);
          payload[column] = value;
          if (value !== Number(shipment[column])) financialChange = true;
        }
      }
      if (dto.status !== undefined) {
        if (!['Pending', 'In Customs', 'Arrived'].includes(dto.status)) throw new BadRequestException('حالة الشحنة غير صالحة');
        payload.status = dto.status;
      }
      if (dto.pricingExchangeRate !== undefined) payload.pricing_exchange_rate = requireImportNumber(dto.pricingExchangeRate, 'سعر صرف التسعير', Number.MIN_VALUE);
      if (dto.shippedDate !== undefined) payload.shipped_date = dto.shippedDate;
      if (dto.etaDate !== undefined) payload.eta_date = dto.etaDate;
      if (dto.clearanceDate !== undefined) payload.clearance_date = dto.clearanceDate;
      if (dto.projectId !== undefined) {
        if (dto.projectId) {
          const matchingProject = await trx.selectFrom('import_projects').select('id')
            .where('tenant_id', '=', tenantId).where('id', '=', dto.projectId).executeTakeFirst();
          if (!matchingProject) throw new BadRequestException('مشروع الاستيراد غير موجود في هذه المنشأة.');
        }
        payload.project_id = dto.projectId || null;
      }
      if (dto.freightType !== undefined) payload.freight_type = dto.freightType;
      if (dto.containerSize !== undefined) payload.container_size = dto.containerSize;
      if (dto.portOfLoading !== undefined) payload.port_of_loading = dto.portOfLoading;
      if (dto.portOfDischarge !== undefined) payload.port_of_discharge = dto.portOfDischarge;
      if (dto.cbmVolume !== undefined) payload.cbm_volume = dto.cbmVolume;
      if (dto.grossWeightKg !== undefined) payload.gross_weight_kg = dto.grossWeightKg;
      if (dto.carrierName !== undefined) payload.carrier_name = dto.carrierName;
      if (dto.freeDemurrageDays !== undefined) payload.free_demurrage_days = dto.freeDemurrageDays;
      if (dto.demurrageStartDate !== undefined) payload.demurrage_start_date = dto.demurrageStartDate;
      if (dto.demurrageRatePerDay !== undefined) payload.demurrage_rate_per_day = dto.demurrageRatePerDay;
      if (dto.actualDemurrageFees !== undefined) payload.actual_demurrage_fees = dto.actualDemurrageFees;
      if (dto.customsDeclarationNo !== undefined) payload.customs_declaration_no = dto.customsDeclarationNo;
      if (dto.vatRefundableEgp !== undefined) payload.vat_refundable_egp = dto.vatRefundableEgp;
      if (dto.isConsolidated !== undefined) payload.is_consolidated = dto.isConsolidated;
      if (dto.costAllocationMethod !== undefined) payload.cost_allocation_method = dto.costAllocationMethod;

      const expenseInputs = [
        [dto.shippingAccountId, shipment.shipping_expense_id, shipment.shipping_cost_usd],
        [dto.customsAccountId, shipment.customs_expense_id, shipment.customs_cost_egp],
        [dto.transportAccountId, shipment.transport_expense_id, shipment.internal_transport_cost_egp],
      ] as const;
      // Replaying an identical posted request is a no-op, including its expense selections.
      if (receipt?.state === 'posted') {
        // Valuation and provenance become immutable when the inventory receipt is posted.
        const frozenFields: Array<[keyof UpdateShipmentCostsDto, keyof ImportShipmentTable]> = [
          ['actualDemurrageFees','actual_demurrage_fees'], ['vatRefundableEgp','vat_refundable_egp'],
          ['costAllocationMethod','cost_allocation_method'], ['projectId','project_id'],
          ['freightType','freight_type'], ['containerSize','container_size'],
          ['portOfLoading','port_of_loading'], ['portOfDischarge','port_of_discharge'],
          ['cbmVolume','cbm_volume'], ['grossWeightKg','gross_weight_kg'],
          ['carrierName','carrier_name'], ['freeDemurrageDays','free_demurrage_days'],
          ['demurrageStartDate','demurrage_start_date'], ['demurrageRatePerDay','demurrage_rate_per_day'],
          ['customsDeclarationNo','customs_declaration_no'], ['isConsolidated','is_consolidated'],
        ];
        for (const [input, column] of frozenFields) {
          const submitted = dto[input];
          const stored = shipment[column];
          const unchanged = typeof submitted === 'number' && Number.isFinite(Number(stored))
            ? submitted === Number(stored)
            : String(submitted ?? '') === String(stored ?? '');
          if (submitted !== undefined && !unchanged) {
            this.assertShipmentEditable(state);
          }
          delete (payload as any)[column];
        }
        for (const [accountId, expenseId, cost] of expenseInputs) {
          if (accountId === undefined) continue;
          if (expenseId === null && Number(cost) === 0) continue;
          const expense = expenseId === null ? undefined : await trx.selectFrom('expenses').select('account_id')
            .where('tenant_id', '=', tenantId).where('id', '=', expenseId).executeTakeFirst();
          if (accountId !== expense?.account_id) financialChange = true;
        }
        if (financialChange || (dto.status !== undefined && dto.status !== 'Arrived')) {
          this.assertShipmentEditable(state);
        }
        // Only tracking dates and sales-pricing inputs can change after receipt.
        delete payload.shipping_cost_usd;
        delete payload.customs_cost_egp;
        delete payload.internal_transport_cost_egp;
        delete payload.exchange_rate_at_arrival;
        delete payload.status;
      } else {
        this.assertShipmentEditable(state);
        const handleExpense = async (cost: number, accountId: string | undefined, existingId: number | null, title: string) => {
          if (!accountId || cost <= 0) return existingId;
          if (existingId !== null) {
            await trx.updateTable('expenses').set({ amount: cost, account_id: accountId })
              .where('tenant_id', '=', tenantId).where('id', '=', existingId).execute();
            return existingId;
          }
          const expense = await trx.insertInto('expenses').values({
            tenant_id: tenantId, account_id: accountId, title: `${title} للحاوية ${shipment.container_number}`,
            amount: cost, expense_date: new Date().toISOString().slice(0, 10), created_by: userId,
            note: '', branch_id: null, location_id: null,
          }).returning('id').executeTakeFirstOrThrow();
          return expense.id;
        };
        if (dto.shippingCostUsd !== undefined || dto.shippingAccountId !== undefined) {
          payload.shipping_expense_id = await handleExpense(
            Number(dto.shippingCostUsd ?? shipment.shipping_cost_usd ?? 0) * requireImportNumber(dto.exchangeRateAtArrival ?? shipment.exchange_rate_at_arrival, 'سعر الصرف', Number.MIN_VALUE),
            dto.shippingAccountId, shipment.shipping_expense_id, 'مصاريف شحن');
        }
        if (dto.customsCostEgp !== undefined || dto.customsAccountId !== undefined) {
          payload.customs_expense_id = await handleExpense(Number(dto.customsCostEgp ?? shipment.customs_cost_egp ?? 0), dto.customsAccountId, shipment.customs_expense_id, 'مصاريف جمارك');
        }
        if (dto.internalTransportCostEgp !== undefined || dto.transportAccountId !== undefined) {
          payload.transport_expense_id = await handleExpense(Number(dto.internalTransportCostEgp ?? shipment.internal_transport_cost_egp ?? 0), dto.transportAccountId, shipment.transport_expense_id, 'مصاريف نقل داخلي');
        }
      }
      const updated = Object.keys(payload).length ? await trx.updateTable('import_shipments').set(payload)
        .where('tenant_id', '=', tenantId).where('id', '=', shipmentId).returningAll().executeTakeFirstOrThrow() : shipment;
      if (!receipt) {
        await this.calculateLandedCostInTransaction(trx, updated);
        if (dto.status === 'Arrived') await this.postShipmentToInventory(trx, tenantId, shipmentId, userId, dto.receiptLocationId);
      }
    });
    return this.getShipmentById(tenantId, shipmentId);
  }

  /** Caller holds the shipment lock; status, costs, receipt and stock commit together. */
  private async postShipmentToInventory(trx: Transaction<Database>, tenantId: string, shipmentId: string, userId: number, receiptLocationId?: number) {
    // No warehouse can be inferred safely from an unlocated import receipt.
    if (!Number.isSafeInteger(receiptLocationId) || Number(receiptLocationId) <= 0) {
      throw new BadRequestException('يجب تحديد مخزن الاستلام الحقيقي (receiptLocationId) قبل ترحيل الحاوية؛ يمنع إنشاء باتشات بلا موقع.');
    }
    const receivingLocation = await trx.selectFrom('stock_locations').select(['id', 'tenant_id'])
      .where('id', '=', Number(receiptLocationId)).where('tenant_id', '=', tenantId).executeTakeFirst();
    if (!receivingLocation) throw new BadRequestException('مخزن استلام الحاوية غير موجود في المنشأة.');
    const shipment = await trx.selectFrom('import_shipments').selectAll().where('tenant_id', '=', tenantId).where('id', '=', shipmentId).executeTakeFirstOrThrow();
    const items = await trx.selectFrom('import_shipment_items').selectAll()
      .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId).execute();
    if (!items.length) throw new BadRequestException('لا يمكن استلام شحنة بدون أصناف');
    // Never silently allocate more pre-sold stock than the physically received quantity.
    const receivedByProduct = new Map<number, number>();
    for (const item of items) {
      const id = Number(item.product_id);
      const received = Number(item.received_quantity ?? item.quantity);
      receivedByProduct.set(id, (receivedByProduct.get(id) || 0) + received);
    }
    const reserved = await trx.selectFrom('import_container_preorders')
      .select(['product_id', 'reserved_quantity'])
      .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId)
      .where('status', '=', 'reserved').execute();
    const bookedByProduct = new Map<number, number>();
    for (const booking of reserved) {
      const id = Number(booking.product_id);
      bookedByProduct.set(id, (bookedByProduct.get(id) || 0) + Number(booking.reserved_quantity));
    }
    for (const [id, qty] of bookedByProduct) {
      if (qty > (receivedByProduct.get(id) || 0) + 0.0001) {
        throw new BadRequestException(`الحجز المسبق للصنف ${id} يتجاوز الكمية المستلمة فعلياً، يجب معالجة العجز والحجوزات قبل الترحيل.`);
      }
    }
    const groups = groupImportReceipts(items.map((item) => ({ ...this.costLine(item), landedCost: Number(item.landed_cost_egp) })));
    const products = await trx.selectFrom('products').select(['id', 'account_id'])
      .where('tenant_id', '=', tenantId).where('id', 'in', groups.map((group) => group.productId))
      .orderBy('id', 'asc').execute();
    if (products.length !== groups.length) throw new NotFoundException('أحد أصناف الشحنة غير موجود في المنشأة');
    const accountByProduct = new Map(products.map((product) => [Number(product.id), product.account_id]));
    // Lock ALL products, across accounts, in global ID order before touching any location.
    for (const product of products) {
      await lockStockProducts(trx, { tenantId, accountId: product.account_id, productIds: [Number(product.id)] });
    }
    const receipt = await trx.insertInto('import_inventory_receipts').values({
      tenant_id: tenantId, shipment_id: shipmentId, state: 'posted', review_reason: null,
      posted_at: new Date(), created_by: userId,
    }).returning('id').executeTakeFirstOrThrow();
    for (const group of groups) {
      const accountId = accountByProduct.get(group.productId);
      if (!accountId) throw new BadRequestException('حساب الصنف غير صالح');
      if (group.quantity > 0) {
        const stock = await applyStockDelta(trx, {
          tenantId, accountId, productId: group.productId, delta: group.quantity, allowNegative: true,
          locationId: Number(receiptLocationId), disableAutoDrain: true,
        });
        // globalBefore is a cached product counter. globalAfter is reconciled by the ledger
        // from locked location balances (including its legacy unassigned-stock policy).
        // INV-WAC-SINGLE-WRITER: the one writer blends the receipt
        // through the canonical engine. The product row is locked by
        // lockStockProducts above, so the writer's read cannot miss
        // it; id is the global primary key, so the old account_id
        // predicate on the write was vestigial.
        await valueStockReceipt(trx, tenantId, group.productId, stock.globalAfter, group.quantity, group.value);
        await trx.insertInto('stock_movements').values({
          tenant_id: tenantId, account_id: accountId, product_id: group.productId,
          movement_type: 'import_receipt', qty: group.quantity, before_qty: stock.scopeBefore, after_qty: stock.scopeAfter,
          unit_cost: Number((group.value / group.quantity).toFixed(6)), total_cost: Number(group.value.toFixed(4)),
          reason: 'استلام شحنة استيراد', note: `شحنة استيراد #${shipmentId}`,
          reference_type: 'import_inventory_receipt', reference_id: receipt.id, import_receipt_id: receipt.id,
          created_by: userId, branch_id: null, location_id: Number(receiptLocationId),
        }).execute();
      }
      if (group.shortageExpense > 0) {
        await trx.insertInto('expenses').values({
          tenant_id: tenantId, account_id: accountId,
          title: `خسائر نواقص حاوية (تسوية عجز) - صنف ${group.productId}`,
          amount: Number(group.shortageExpense.toFixed(2)), expense_date: new Date().toISOString().slice(0, 10),
          note: `شحنة استيراد #${shipmentId} - سند استلام ${receipt.id}`,
          created_by: userId, branch_id: null, location_id: null,
        }).execute();
      }
    }

    for (const item of items) {
      const receivedQty = Number(item.received_quantity ?? item.quantity);
      const unitLandedCost = Number(Number(item.landed_cost_egp || 0).toFixed(4));
      const cleanContainer = (shipment.container_number || 'CONT').replace(/[^a-zA-Z0-9]/g, '');
      const lotNumber = 'LOT-' + cleanContainer.slice(0, 25) + '-' + item.product_id + '-' + item.id;

      await trx
        .insertInto('import_inventory_lots')
        .values({
          tenant_id: tenantId,
          lot_number: lotNumber,
          project_id: shipment.project_id || null,
          shipment_id: shipmentId,
          shipment_item_id: item.id,
          product_id: Number(item.product_id),
          location_id: Number(receiptLocationId),
          initial_quantity: receivedQty,
          remaining_quantity: receivedQty,
          unit_landed_cost_egp: unitLandedCost,
          status: 'active',
          receipt_date: new Date().toISOString().slice(0, 10),
        } as any)
        .execute();
    }

    // --- ACCOUNTING: Double-entry journal for inventory receipt ---
    // DR: Inventory (at total landed cost of all received goods)
    // DR: Shortage Expense (if any items had shortage_handling_method = 'expense')
    // CR: Accounts Payable / Supplier (total)
    const totalInventoryValue = Number(groups.reduce((sum, g) => sum + g.value, 0).toFixed(2));
    const totalShortageExpense = Number(groups.reduce((sum, g) => sum + g.shortageExpense, 0).toFixed(2));
    const totalCreditPayable = Number((totalInventoryValue + totalShortageExpense).toFixed(2));

    if (totalCreditPayable > 0) {
      const postingService = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const inventoryAccountId = await this.resolveTenantAccount(trx, tenantId, 'inventory');
      const payableAccountId = await this.resolveTenantAccount(trx, tenantId, 'payable');

      const journalLines: Array<{
        accountId: number; description: string;
        debit: number; credit: number;
        partnerType: 'supplier' | 'none'; partnerId: number | null;
        branchId: null; locationId: null;
      }> = [];

      // DR: Inventory (landed cost value of physically received goods)
      if (totalInventoryValue > 0) {
        journalLines.push({
          accountId: inventoryAccountId,
          description: `استلام مخزون استيراد - حاوية ${shipment.container_number || shipmentId}`,
          debit: totalInventoryValue,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      }

      // DR: Shortage Expense (shortages handled as expense, not capitalized)
      if (totalShortageExpense > 0) {
        const cogsAccountId = await this.resolveTenantAccount(trx, tenantId, 'cogs');
        journalLines.push({
          accountId: cogsAccountId,
          description: `خسائر نواقص حاوية (تسوية عجز) - حاوية ${shipment.container_number || shipmentId}`,
          debit: totalShortageExpense,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      }

      let effectiveReceiptSupplierId = (shipment as any)?.supplier_id ? Number((shipment as any).supplier_id) : null;
      if (!effectiveReceiptSupplierId && shipment.project_id) {
        const proj = await trx
          .selectFrom('import_projects')
          .select('feasibility_data')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', shipment.project_id)
          .executeTakeFirst();
        const f = typeof proj?.feasibility_data === 'string' ? JSON.parse(proj.feasibility_data) : (proj?.feasibility_data || {});
        if (f?.supplierId) effectiveReceiptSupplierId = Number(f.supplierId);
      }
      if (!effectiveReceiptSupplierId) {
        const anySup = await trx
          .selectFrom('suppliers')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .orderBy('id', 'asc')
          .limit(1)
          .executeTakeFirst();
        if (anySup) effectiveReceiptSupplierId = Number(anySup.id);
      }
      if (!effectiveReceiptSupplierId) {
        const defaultSup = await trx
          .insertInto('suppliers')
          .values({
            tenant_id: tenantId,
            name: 'مورد استيراد عام / توكيلات شحن',
            phone: '',
            address: '',
            balance: 0,
            is_active: true,
          } as any)
          .returning('id')
          .executeTakeFirst();
        if (defaultSup) effectiveReceiptSupplierId = Number(defaultSup.id);
      }

      // CR: Accounts Payable / Supplier
      journalLines.push({
        accountId: payableAccountId,
        description: `استحقاق مورد استيراد - حاوية ${shipment.container_number || shipmentId}`,
        debit: 0,
        credit: totalCreditPayable,
        partnerType: effectiveReceiptSupplierId ? 'supplier' : 'none',
        partnerId: effectiveReceiptSupplierId ? Number(effectiveReceiptSupplierId) : null,
        branchId: null,
        locationId: null,
      });

      const journalEntryId = await postingService.postDomainJournal(trx, {
        sourceType: 'import_inventory_receipt',
        sourceId: Number(receipt.id),
        tenantId,
        accountId: tenantId,
        entryDate: new Date(),
        description: `قيد استلام مخزون استيراد - حاوية ${shipment.container_number || shipmentId} (سند استلام #${receipt.id})`,
        branchId: null,
        locationId: null,
        createdBy: userId,
        postedBy: userId,
        lines: journalLines,
      });

      await trx.updateTable('import_inventory_receipts')
        .set({ journal_entry_id: journalEntryId })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', receipt.id)
        .execute();
    }

    await trx
      .updateTable('import_container_preorders')
      .set({ status: 'allocated' })
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', shipmentId)
      .where('status', '=', 'reserved')
      .execute();
  }

  async calculateLandedCost(tenantId: string, shipmentId: string) {
    return this.inventoryDb.transaction().execute(async (trx) => {
      const state = await this.lockShipment(trx, tenantId, shipmentId);
      this.assertShipmentEditable(state);
      return this.calculateLandedCostInTransaction(trx, state.shipment);
    });
  }

  private async calculateLandedCostInTransaction(
    trx: Transaction<Database>,
    shipment: Selectable<ImportShipmentTable>
  ) {
    const items = await trx
      .selectFrom('import_shipment_items')
      .selectAll()
      .where('tenant_id', '=', shipment.tenant_id)
      .where('shipment_id', '=', shipment.id)
      .execute();

    if (!items.length) {
      return { success: true, message: 'لا توجد أصناف بالشحنة' };
    }

    const rate = requireImportNumber(shipment.exchange_rate_at_arrival, 'سعر الصرف', Number.MIN_VALUE);
    const method = (shipment.cost_allocation_method as 'value' | 'weight' | 'cbm') || 'value';

    if (method === 'weight' && items.some((item) => Number(item.gross_weight_kg_unit || 0) <= 0)) {
      throw new BadRequestException('يلزم تحديد وزن الوحدة لكل صنف قبل التوزيع بالوزن.');
    }
    if (method === 'cbm' && items.some((item) => Number(item.cbm_unit || 0) <= 0)) {
      throw new BadRequestException('يلزم تحديد CBM الوحدة لكل صنف قبل التوزيع بالحجم.');
    }
    const breakdown = calculateLandedCostBreakdown({
      items: items.map((item) => ({
        id: item.id,
        productId: Number(item.product_id),
        quantity: Number(item.quantity),
        receivedQuantity: item.received_quantity !== null && item.received_quantity !== undefined ? Number(item.received_quantity) : Number(item.quantity),
        factoryUnitPriceUsd: Number(item.factory_unit_price_usd),
        unitWeightKg: Number(item.gross_weight_kg_unit || 0),
        unitCbm: Number(item.cbm_unit || 0),
        shortageHandlingMethod: (item.shortage_handling_method as any) || 'capitalize',
      })),
      exchangeRate: rate,
      shippingCostUsd: Number(shipment.shipping_cost_usd ?? 0),
      customsCostEgp: Number(shipment.customs_cost_egp ?? 0),
      internalTransportCostEgp: Number(shipment.internal_transport_cost_egp ?? 0),
      demurrageFeesEgp: Number(shipment.actual_demurrage_fees ?? 0),
      vatRefundableEgp: Number(shipment.vat_refundable_egp ?? 0),
      vatIsRefundable: true,
      allocationMethod: method,
    });

    for (const line of breakdown.items) {
      await trx
        .updateTable('import_shipment_items')
        .set({
          allocated_overhead_egp: line.unitOverheadEgp,
          landed_cost_egp: line.landedCostEgp,
        })
        .where('tenant_id', '=', shipment.tenant_id)
        .where('shipment_id', '=', shipment.id)
        .where('id', '=', line.id)
        .execute();
    }

    return {
      success: true,
      message: 'تم إعادة احتساب التكلفة الفعلية وتوزيع الأعباء بنجاح وفق محرك Landed Cost المعتمد',
      breakdown,
    };
  }

  async processLateShipmentExpense(
    tenantId: string,
    userId: number,
    shipmentId: string,
    dto: ProcessLateExpenseDto
  ) {
    return await this.inventoryDb.transaction().execute(async (trx) => {
      const state = await this.lockShipment(trx, tenantId, shipmentId);
      const { shipment, receipt } = state;
      if (!receipt || receipt.state !== 'posted') {
        throw new BadRequestException('لا يمكن تسجيل مصروفات متأخرة إلا بعد استلام الشحنة وترحيل المخزون.');
      }

      const items = await trx
        .selectFrom('import_shipment_items')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', shipmentId)
        .execute();

      if (!items.length) {
        throw new BadRequestException('الشحنة لا تحتوي على أصناف.');
      }

      let totalReceivedQty = 0;
      for (const item of items) {
        totalReceivedQty += Number(item.received_quantity ?? item.quantity);
      }

      const productIds = items.map((i) => Number(i.product_id));
      const products = await trx
        .selectFrom('products')
        .select(['id', 'cost_price', 'account_id'])
        .where('tenant_id', '=', tenantId)
        .where('id', 'in', productIds)
        .execute();

      for (const p of products.sort((a, b) => Number(a.id) - Number(b.id))) {
        await lockStockProducts(trx, { tenantId, accountId: p.account_id, productIds: [Number(p.id)] });
      }

      // Calculate item weights/shares for fair expense distribution across shipment items
      const itemBaseCosts = items.map((it) => {
        const qty = Number(it.quantity || 1);
        const unitUsd = Number(it.factory_unit_price_usd || 0);
        return qty * unitUsd;
      });
      const totalShipmentBaseUsd = itemBaseCosts.reduce((sum, v) => sum + v, 0);

      let totalLateCogs = 0;
      let totalLateInventory = 0;
      let totalSoldUnits = 0;
      let totalOnHandUnits = 0;

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const pId = Number(item.product_id);
        const itemReceivedQty = Number(item.received_quantity ?? item.quantity);
        if (!Number.isFinite(itemReceivedQty) || itemReceivedQty <= 0) {
          throw new UnprocessableEntityException('لا يمكن تحميل مصروف متأخر على بند ليس له كمية مستلمة.');
        }

        // Query remaining stock specifically for this shipment's lots (IAS 2 compliance)
        const lotRow = await trx
          .selectFrom('import_inventory_lots')
          .select([
            sql<number>`count(*)`.as('lot_count'),
            sql<number>`coalesce(sum(remaining_quantity), 0)`.as('total_remaining'),
          ])
          .where('tenant_id', '=', tenantId)
          .where('shipment_id', '=', shipmentId)
          .where('shipment_item_id', '=', item.id)
          .executeTakeFirst();

        let itemOnHandQty = 0;
        if (lotRow && Number(lotRow.lot_count) > 0) {
          itemOnHandQty = Math.min(itemReceivedQty, Math.max(0, Number(lotRow.total_remaining)));
        } else {
          throw new UnprocessableEntityException('لا يمكن تسوية المصروف المتأخر دون باتش استيراد موثق للبند.');
        }

        const itemSoldQty = Math.max(0, itemReceivedQty - itemOnHandQty);

        totalOnHandUnits += itemOnHandQty;
        totalSoldUnits += itemSoldQty;

        // Share of late expense allocated to this item
        const itemShare = totalShipmentBaseUsd > 0
          ? itemBaseCosts[idx] / totalShipmentBaseUsd
          : itemReceivedQty / Math.max(1, totalReceivedQty);
        const itemLateExpense = dto.lateExpenseAmount * itemShare;

        const itemCogsAdj = (itemSoldQty / itemReceivedQty) * itemLateExpense;
        const itemInventoryAdj = (itemOnHandQty / itemReceivedQty) * itemLateExpense;

        totalLateCogs += itemCogsAdj;
        totalLateInventory += itemInventoryAdj;

        // Lot-specific landed cost increase for this shipment's container lot
        const lotUnitCostIncrease = itemOnHandQty > 0 ? itemInventoryAdj / itemOnHandQty : 0;

        // Query total company-wide on-hand stock for this product across all locations
        // to maintain exact Weighted Average Cost (WAC) and General Ledger inventory reconciliation (IAS 2)
        const totalCompanyStockRow = await trx
          .selectFrom('product_location_stock')
          .select([sql<number>`coalesce(sum(qty), 0)`.as('total_qty')])
          .where('tenant_id', '=', tenantId)
          .where('product_id', '=', pId)
          .executeTakeFirst();
        const totalCompanyStock = Math.max(itemOnHandQty, Number(totalCompanyStockRow?.total_qty || 0));
        const wacUnitCostIncrease = totalCompanyStock > 0 ? itemInventoryAdj / totalCompanyStock : 0;

        // INV-STOCK-POOL-REVALUATION: the pool revaluation writer
        // spreads the inventory adjustment over the company-wide
        // on-hand stock. The SQL-increment form is gone: under the
        // product lock held above, read-primitive-write is equally
        // safe, and the rounding policy is now the primitive's
        // round-the-result instead of rounding the increase first.
        // The lot and shipment-item increments below stay SQL-atomic
        // deliberately: no lot lock is held in this flow.
        if (wacUnitCostIncrease > 0) {
          await revalueStockCost(trx, tenantId, pId, totalCompanyStock, itemInventoryAdj);
        }

        if (lotUnitCostIncrease > 0) {
          await trx
            .updateTable('import_inventory_lots')
            .set((eb) => ({
              unit_landed_cost_egp: sql`${eb.ref('unit_landed_cost_egp')} + ${Number(lotUnitCostIncrease.toFixed(6))}`,
              updated_at: sql`NOW()`,
            }))
            .where('tenant_id', '=', tenantId)
            .where('shipment_id', '=', shipmentId)
            .where('shipment_item_id', '=', item.id)
            .execute();
        }

        await trx
          .updateTable('import_shipment_items')
          .set((eb) => ({
            landed_cost_egp: sql`${eb.ref('landed_cost_egp')} + ${Number((itemLateExpense / itemReceivedQty).toFixed(6))}`,
          }))
          .where('tenant_id', '=', tenantId)
          .where('id', '=', item.id)
          .execute();
      }

      totalLateCogs = Number(totalLateCogs.toFixed(2));
      totalLateInventory = Number((dto.lateExpenseAmount - totalLateCogs).toFixed(2));

      // Resolve accounts dynamically from COA / Accounting Settings
      const cogsAccountId = await this.resolveTenantAccount(trx, tenantId, 'cogs', dto.accountId ? Number(dto.accountId) : null);
      const inventoryAccountId = await this.resolveTenantAccount(trx, tenantId, 'inventory');
      const payableAccountId = await this.resolveTenantAccount(trx, tenantId, 'payable', dto.payableAccountId ? Number(dto.payableAccountId) : null);

      let expenseId: number | null = null;
      if (totalLateCogs > 0) {
        const exp = await trx
          .insertInto('expenses')
          .values({
            tenant_id: tenantId,
            account_id: String(cogsAccountId),
            title: `${dto.title} (تسوية تكلفة متأخرة على مبيعات سابقة) - حاوية ${shipment.container_number}`,
            amount: totalLateCogs,
            expense_date: new Date().toISOString().slice(0, 10),
            created_by: userId,
            note: dto.note || `تم تحميل ${totalSoldUnits} وحدة مباعة بقيمة ${totalLateCogs} ج.م`,
            branch_id: null,
            location_id: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        expenseId = exp.id;
      }

      // Every late expense has a proper source document, including inventory-only capitalization.
      const lateExpenseDocument = await trx.insertInto('import_late_expense_events').values({
        tenant_id: tenantId, shipment_id: shipmentId,
        title: dto.title, total_amount_egp: dto.lateExpenseAmount,
        inventory_amount_egp: totalLateInventory, cogs_amount_egp: totalLateCogs,
        created_by: userId, journal_entry_id: null,
      }).returning('id').executeTakeFirstOrThrow();
      const postingService = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const lines: any[] = [];
      if (totalLateCogs > 0) {
        lines.push({
          accountId: cogsAccountId,
          description: `تسوية تكلفة مبيعات سابقة لمصروف متأخر - حاوية ${shipment.container_number}`,
          debit: totalLateCogs,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      }
      if (totalLateInventory > 0) {
        lines.push({
          accountId: inventoryAccountId,
          description: `رسملة مصروف متأخر على المخزون المتبقي - حاوية ${shipment.container_number}`,
          debit: totalLateInventory,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      }
      let effectiveExpenseSupplierId = (shipment as any)?.supplier_id ? Number((shipment as any).supplier_id) : null;
      if (!effectiveExpenseSupplierId && shipment.project_id) {
        const proj = await trx
          .selectFrom('import_projects')
          .select('feasibility_data')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', shipment.project_id)
          .executeTakeFirst();
        const f = typeof proj?.feasibility_data === 'string' ? JSON.parse(proj.feasibility_data) : (proj?.feasibility_data || {});
        if (f?.supplierId) effectiveExpenseSupplierId = Number(f.supplierId);
      }
      if (!effectiveExpenseSupplierId) {
        const anySup = await trx
          .selectFrom('suppliers')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .orderBy('id', 'asc')
          .limit(1)
          .executeTakeFirst();
        if (anySup) effectiveExpenseSupplierId = Number(anySup.id);
      }
      if (!effectiveExpenseSupplierId) {
        const defaultSup = await trx
          .insertInto('suppliers')
          .values({
            tenant_id: tenantId,
            name: 'مورد استيراد عام / توكيلات شحن',
            phone: '',
            address: '',
            balance: 0,
            is_active: true,
          } as any)
          .returning('id')
          .executeTakeFirst();
        if (defaultSup) effectiveExpenseSupplierId = Number(defaultSup.id);
      }

      lines.push({
        accountId: payableAccountId,
        description: `استحقاق مصروف متأخر - حاوية ${shipment.container_number}`,
        debit: 0,
        credit: Number(dto.lateExpenseAmount.toFixed(2)),
        partnerType: effectiveExpenseSupplierId ? 'supplier' : 'none',
        partnerId: effectiveExpenseSupplierId ? Number(effectiveExpenseSupplierId) : null,
        branchId: null,
        locationId: null,
      });

      const journalEntryId = await postingService.postDomainJournal(trx, {
        sourceType: 'import_late_expense',
        sourceId: Number(lateExpenseDocument.id),
        tenantId,
        accountId: tenantId,
        entryDate: new Date(),
        description: `تسوية مصروف استيراد متأخر - حاوية ${shipment.container_number} (${dto.title})`,
        branchId: null,
        locationId: null,
        createdBy: userId,
        postedBy: userId,
        lines,
      });

      await trx.updateTable('import_late_expense_events').set({ journal_entry_id: journalEntryId })
        .where('tenant_id', '=', tenantId).where('id', '=', lateExpenseDocument.id).execute();

      await trx
        .updateTable('import_shipments')
        .set((eb) => ({
          late_expenses_total_egp: sql`coalesce(late_expenses_total_egp, 0) + ${dto.lateExpenseAmount}`,
          late_cogs_adjustment_egp: sql`coalesce(late_cogs_adjustment_egp, 0) + ${totalLateCogs}`,
          late_inventory_adjustment_egp: sql`coalesce(late_inventory_adjustment_egp, 0) + ${totalLateInventory}`,
        }))
        .where('tenant_id', '=', tenantId)
        .where('id', '=', shipmentId)
        .execute();

      return {
        success: true,
        message: 'تمت معالجة المصروف المتأخر وتوزيعه محاسبياً بين تكلفة البضاعة المباعة والمخزون المتبقي بنجاح.',
        allocation: {
          lateExpenseAmount: dto.lateExpenseAmount,
          lateCogsAdjustmentEgp: totalLateCogs,
          lateInventoryAdjustmentEgp: totalLateInventory,
          soldQuantity: totalSoldUnits,
          onHandQuantity: totalOnHandUnits,
          journalEntryId,
        },
        cogsExpenseId: expenseId,
      };
    });
  }

  async generatePeriodProfitReport(
    tenantId: string,
    startDate: string | Date,
    endDate: string | Date,
    projectId?: string,
    executor?: any
  ) {
    const qb = (executor || this.db) as Kysely<Database>;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (typeof endDate === 'string' && !endDate.includes('T')) {
      end.setHours(23, 59, 59, 999);
    }

    let projectProductIds: number[] = [];
    let projectShipmentIds: string[] = [];

    if (projectId) {
      const shipments = await qb
        .selectFrom('import_shipments')
        .select(['id', 'shipping_expense_id', 'customs_expense_id', 'transport_expense_id'])
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .execute();

      projectShipmentIds = shipments.map((s) => s.id);

      if (projectShipmentIds.length > 0) {
        const items = await qb
          .selectFrom('import_shipment_items')
          .select('product_id')
          .where('tenant_id', '=', tenantId)
          .where('shipment_id', 'in', projectShipmentIds)
          .execute();

        projectProductIds = [...new Set(items.map((i) => Number(i.product_id)))];
      }
    }

    let totalRevenue = 0;
    let totalCost = 0;
    let totalDiscounts = 0;
    let returnRevenue = 0;
    let returnCost = 0;
    let profitAttributionVerified = false;
    let attributionStatus = 'UNVERIFIED_SOURCE';

    if (projectId) {
      // 1. Query exact lot allocations for this project
      const lotAllocations = await qb
        .selectFrom('import_sale_allocations')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .where('created_at', '>=', start)
        .where('created_at', '<=', end)
        .execute();

      // Check if this project has traceable inventory lots
      const projectLotsCount = await qb
        .selectFrom('import_inventory_lots')
        .select(sql<number>`count(*)`.as('c'))
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      const hasLots = Number(projectLotsCount?.c || 0) > 0;

      if (lotAllocations.length > 0) {
        let grossRevenue = 0;
        let grossCost = 0;
        let cancelledRevenue = 0;
        let cancelledCost = 0;

        for (const alloc of lotAllocations) {
          const q = Number(alloc.quantity);
          const price = Number(alloc.unit_sale_price_egp || 0);
          const cost = Number(alloc.unit_cost_egp || 0);
          const absQty = Math.abs(q);

          if (alloc.allocation_type === 'return') {
            returnRevenue += absQty * price;
            returnCost += absQty * cost;
          } else if (alloc.allocation_type === 'cancellation' || alloc.allocation_type === 'reversal') {
            cancelledRevenue += absQty * price;
            cancelledCost += absQty * cost;
          } else {
            grossRevenue += absQty * price;
            grossCost += absQty * cost;
          }
        }
        totalRevenue = grossRevenue - cancelledRevenue;
        totalCost = grossCost - cancelledCost;
        // A partial set of lot allocations is not proof that every sale has provenance.
        const candidateLines = projectProductIds.length
          ? await qb.selectFrom('sale_items as si').innerJoin('sales as sa', 'sa.id', 'si.sale_id')
              .select(['si.id', 'si.qty']).where('sa.tenant_id', '=', tenantId)
              .where('sa.status', '!=', 'cancelled')
              .where('sa.created_at', '>=', start).where('sa.created_at', '<=', end)
              .where('si.product_id', 'in', projectProductIds).execute()
          : [];
        const saleItemIds = candidateLines.map((l) => Number(l.id));
        const allSaleAllocations = saleItemIds.length
          ? await qb.selectFrom('import_sale_allocations')
              .select(['sale_item_id', 'quantity'])
              .where('tenant_id', '=', tenantId).where('allocation_type', '=', 'sale')
              .where('sale_item_id', 'in', saleItemIds).execute()
          : [];
        const allocated = new Map<number, number>();
        for (const al of allSaleAllocations) {
          const key = Number(al.sale_item_id);
          allocated.set(key, (allocated.get(key) || 0) + Number(al.quantity));
        }
        const incomplete = candidateLines.some((l) => (allocated.get(Number(l.id)) || 0) + 0.0001 < Number(l.qty));
        profitAttributionVerified = !incomplete;
        attributionStatus = incomplete ? 'INCOMPLETE_SALE_LOT_ALLOCATION' : 'VERIFIED_LOT_ALLOCATIONS';
      } else if (hasLots) {
        // Zero allocation records are not proof of zero POS sales.
        const possibleSale = projectProductIds.length
          ? await qb.selectFrom('sale_items as si').innerJoin('sales as sa', 'sa.id', 'si.sale_id')
              .select('si.sale_id').where('sa.tenant_id', '=', tenantId)
              .where('sa.status', '!=', 'cancelled')
              .where('sa.created_at', '>=', start).where('sa.created_at', '<=', end)
              .where('si.product_id', 'in', projectProductIds).executeTakeFirst()
          : null;
        totalRevenue = 0;
        totalCost = 0;
        returnRevenue = 0;
        returnCost = 0;
        profitAttributionVerified = !possibleSale;
        attributionStatus = possibleSale ? 'UNVERIFIED_SOURCE' : 'NO_SALES_RECORDED';
      } else {
        // Fallback: Check if project items have any provisional sales (legacy non-lotted projects only)
        const projectItems = projectShipmentIds.length > 0
          ? await qb
              .selectFrom('import_shipment_items')
              .select(['product_id', 'received_quantity', 'quantity', 'landed_cost_egp'])
              .where('tenant_id', '=', tenantId)
              .where('shipment_id', 'in', projectShipmentIds)
              .execute()
          : [];

        const productSources = new Map<number, { receivedQty: number; unitCost: number }>();
        for (const item of projectItems) {
          const pId = Number(item.product_id);
          const qty = Number(item.received_quantity ?? item.quantity ?? 0);
          const cost = Number(item.landed_cost_egp || 0);
          const existing = productSources.get(pId);
          if (existing) {
            const totalQ = existing.receivedQty + qty;
            const weightedCost = totalQ > 0 ? (existing.receivedQty * existing.unitCost + qty * cost) / totalQ : cost;
            productSources.set(pId, { receivedQty: totalQ, unitCost: weightedCost });
          } else {
            productSources.set(pId, { receivedQty: qty, unitCost: cost });
          }
        }

        if (projectProductIds.length > 0) {
          const salesRows = await qb
            .selectFrom('sales')
            .innerJoin('sale_items', 'sale_items.sale_id', 'sales.id')
            .select([
              'sale_items.product_id',
              'sale_items.qty',
              'sale_items.line_total',
              'sale_items.allocated_discount',
            ])
            .where('sales.tenant_id', '=', tenantId)
            .where('sales.status', '!=', 'cancelled')
            .where('sales.created_at', '>=', start)
            .where('sales.created_at', '<=', end)
            .where('sale_items.product_id', 'in', projectProductIds)
            .orderBy('sales.created_at', 'asc')
            .execute();

          const remainingSource = new Map<number, number>();
          for (const [pId, src] of productSources.entries()) {
            remainingSource.set(pId, src.receivedQty);
          }

          for (const row of salesRows) {
            const pId = Number(row.product_id);
            const avail = remainingSource.get(pId) || 0;
            if (avail > 0) {
              const soldFromProject = Math.min(Number(row.qty), avail);
              const ratio = Number(row.qty) > 0 ? soldFromProject / Number(row.qty) : 1;
              totalRevenue += Number(row.line_total) * ratio;
              totalDiscounts += Number(row.allocated_discount || 0) * ratio;
              totalCost += soldFromProject * (productSources.get(pId)?.unitCost || 0);
              remainingSource.set(pId, avail - soldFromProject);
            }
          }

          const returnRows = await qb
            .selectFrom('return_documents')
            .innerJoin('return_items', 'return_items.return_document_id', 'return_documents.id')
            .select([
              'return_items.product_id',
              'return_items.qty',
              'return_items.line_total',
            ])
            .where('return_documents.tenant_id', '=', tenantId)
            .where('return_documents.return_type', '=', 'sale')
            .where('return_documents.created_at', '>=', start)
            .where('return_documents.created_at', '<=', end)
            .where('return_items.product_id', 'in', projectProductIds)
            .execute();

          for (const rRow of returnRows) {
            const pId = Number(rRow.product_id);
            const src = productSources.get(pId);
            if (src) {
              returnRevenue += Number(rRow.line_total);
              returnCost += Number(rRow.qty) * src.unitCost;
            }
          }
        }

        if (totalRevenue === 0 && returnRevenue === 0) {
          profitAttributionVerified = true;
          attributionStatus = 'NO_SALES_RECORDED';
        } else {
          profitAttributionVerified = false;
          attributionStatus = 'UNVERIFIED_SOURCE';
        }
      }
    } else {
      profitAttributionVerified = true;
      attributionStatus = 'COMPANY_WIDE';
      // General company-wide period report
      const salesData = await qb
        .selectFrom('sales')
        .innerJoin('sale_items', 'sale_items.sale_id', 'sales.id')
        .select([
          sql<number>`coalesce(sum(sale_items.line_total), 0)`.as('total_revenue'),
          sql<number>`coalesce(sum(sale_items.qty * sale_items.cost_price), 0)`.as('total_cost'),
          sql<number>`coalesce(sum(sale_items.allocated_discount), 0)`.as('total_discount'),
        ])
        .where('sales.tenant_id', '=', tenantId)
        .where('sales.status', '!=', 'cancelled')
        .where('sales.created_at', '>=', start)
        .where('sales.created_at', '<=', end)
        .executeTakeFirst();

      totalRevenue = Number(salesData?.total_revenue || 0);
      totalCost = Number(salesData?.total_cost || 0);
      totalDiscounts = Number(salesData?.total_discount || 0);

      const returnData = await qb
        .selectFrom('return_documents')
        .innerJoin('return_items', 'return_items.return_document_id', 'return_documents.id')
        .select([
          sql<number>`coalesce(sum(return_items.line_total), 0)`.as('return_revenue'),
          sql<number>`coalesce(sum(return_items.qty * return_items.cost_price), 0)`.as('return_cost'),
        ])
        .where('return_documents.tenant_id', '=', tenantId)
        .where('return_documents.return_type', '=', 'sale')
        .where('return_documents.created_at', '>=', start)
        .where('return_documents.created_at', '<=', end)
        .executeTakeFirst();

      returnRevenue = Number(returnData?.return_revenue || 0);
      returnCost = Number(returnData?.return_cost || 0);
    }

    const netSalesRevenue = totalRevenue - totalDiscounts - returnRevenue;
    const netCogs = totalCost - returnCost;
    const grossProfit = netSalesRevenue - netCogs;

    let totalExpenses = 0;

    if (projectId) {
      const sourcingExpenses = await qb
        .selectFrom('import_sourcing_trips')
        .select([sql<number>`coalesce(sum(actual_cost_egp), 0)`.as('total_sourcing')])
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .where('start_date', '>=', start.toISOString().slice(0, 10))
        .where('start_date', '<=', end.toISOString().slice(0, 10))
        .executeTakeFirst();

      const lateCogsExp = projectShipmentIds.length
        ? await qb.selectFrom('import_late_expense_events')
            .select([sql<number>`coalesce(sum(cogs_amount_egp), 0)`.as('total_late_cogs')])
            .where('tenant_id', '=', tenantId)
            .where('shipment_id', 'in', projectShipmentIds)
            .where('created_at', '>=', start).where('created_at', '<=', end)
            .executeTakeFirst()
        : null;

      totalExpenses = Number(sourcingExpenses?.total_sourcing || 0) + Number(lateCogsExp?.total_late_cogs || 0);
    } else {
      const shipmentExpenseIds = await qb
        .selectFrom('import_shipments')
        .select(['shipping_expense_id', 'customs_expense_id', 'transport_expense_id'])
        .where('tenant_id', '=', tenantId)
        .execute();

      const excludedExpenseIds = new Set<number>();
      for (const s of shipmentExpenseIds) {
        if (s.shipping_expense_id) excludedExpenseIds.add(Number(s.shipping_expense_id));
        if (s.customs_expense_id) excludedExpenseIds.add(Number(s.customs_expense_id));
        if (s.transport_expense_id) excludedExpenseIds.add(Number(s.transport_expense_id));
      }

      let expensesQuery = qb
        .selectFrom('expenses')
        .select([sql<number>`coalesce(sum(amount), 0)`.as('total_expenses')])
        .where('tenant_id', '=', tenantId)
        .where('expense_date', '>=', start)
        .where('expense_date', '<=', end)
        .where((eb) =>
          eb.and([
            eb('title', 'not like', 'حوالة خارجية%'),
            eb('title', 'not like', 'صرف أرباح الشريك%'),
          ])
        );

      if (excludedExpenseIds.size > 0) {
        expensesQuery = expensesQuery.where('id', 'not in', Array.from(excludedExpenseIds));
      }

      const expensesData = await expensesQuery.executeTakeFirst();
      totalExpenses = Number(expensesData?.total_expenses || 0);
    }

    const netProfitPool = grossProfit - totalExpenses;

    let partners: any[] = [];
    if (projectId) {
      partners = await qb
        .selectFrom('import_project_partners')
        .innerJoin('import_partners', 'import_partners.id', 'import_project_partners.partner_id')
        .select([
          'import_partners.id',
          'import_partners.name',
          'import_project_partners.profit_percentage as profit_share_percentage',
          'import_partners.withdrawn_profit',
        ])
        .where('import_project_partners.tenant_id', '=', tenantId)
        .where('import_project_partners.project_id', '=', projectId)
        .where('import_project_partners.is_active', '=', true)
        .execute();
    }

    if (!projectId && partners.length === 0) {
      partners = await qb
        .selectFrom('import_partners')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .execute();
    }

    const paidForProject = projectId
      ? await qb.selectFrom('import_partner_project_payouts')
          .select(['partner_id', sql<number>`coalesce(sum(amount_egp), 0)`.as('paid')])
          .where('tenant_id', '=', tenantId).where('project_id', '=', projectId)
          .groupBy('partner_id').execute()
      : [];
    const payoutMap = new Map(paidForProject.map((v) => [String(v.partner_id), Number(v.paid)]));
    const partnerShares = partners.map((p) => {
      const percentage = Number(p.profit_share_percentage) || 0;
      const shareAmount = netProfitPool > 0 ? (netProfitPool * percentage) / 100 : 0;
      const withdrawn = projectId ? (payoutMap.get(String(p.id)) || 0) : (Number(p.withdrawn_profit) || 0);
      return {
        partnerId: p.id,
        name: p.name,
        percentage,
        shareAmount: Number(shareAmount.toFixed(2)),
        withdrawnProfit: Number(withdrawn.toFixed(2)),
        currentBalance: Number((shareAmount - withdrawn).toFixed(2)),
      };
    });

    return {
      success: true,
      message: projectId ? 'تم تجميع أرباح مشروع الاستيراد بنجاح' : 'تم تجميع أرباح الشراكة العامة بنجاح',
      data: {
        projectId: projectId || null,
        profitAttributionVerified,
        attributionStatus,
        grossSalesRevenue: Number(totalRevenue.toFixed(2)),
        salesDiscounts: Number(totalDiscounts.toFixed(2)),
        salesReturnsRevenue: Number(returnRevenue.toFixed(2)),
        netSalesRevenue: Number(netSalesRevenue.toFixed(2)),
        totalRevenue: Number(netSalesRevenue.toFixed(2)),
        grossCogs: Number(totalCost.toFixed(2)),
        returnsCogs: Number(returnCost.toFixed(2)),
        netCogs: Number(netCogs.toFixed(2)),
        totalCost: Number(netCogs.toFixed(2)),
        grossProfit: Number(grossProfit.toFixed(2)),
        operatingExpenses: Number(totalExpenses.toFixed(2)),
        totalExpenses: Number(totalExpenses.toFixed(2)),
        netProfitPool: Number(netProfitPool.toFixed(2)),
        partnerShares,
      },
    };
  }

  async listForeignTransfers(tenantId: string) {
    const rows = await this.db
      .selectFrom('supplier_payments')
      .leftJoin('suppliers', 'suppliers.id', 'supplier_payments.supplier_id')
      .select([
        'supplier_payments.id',
        'supplier_payments.doc_no',
        'supplier_payments.amount',
        'supplier_payments.amount_foreign',
        'supplier_payments.currency',
        'supplier_payments.exchange_rate',
        'supplier_payments.payment_date',
        'supplier_payments.note',
        'supplier_payments.created_at',
        'suppliers.name as supplier_name',
      ])
      .where('supplier_payments.tenant_id', '=', tenantId)
      .where('supplier_payments.doc_no', 'like', 'FT-%')
      .orderBy('supplier_payments.created_at', 'desc')
      .execute();

    return rows.map((r) => {
      const foreignAmount = r.amount_foreign != null ? Number(r.amount_foreign) : null;
      const egpAmount = Number(r.amount);
      const effectiveRate = r.exchange_rate ? Number(r.exchange_rate) : (foreignAmount && foreignAmount > 0 ? Number((egpAmount / foreignAmount).toFixed(2)) : null);
      const dateVal = r.payment_date || r.created_at;

      return {
        id: r.id,
        docNo: r.doc_no,
        doc_no: r.doc_no,
        amountForeign: foreignAmount,
        amount_foreign: foreignAmount,
        amountEgp: egpAmount,
        amount_egp: egpAmount,
        amount: foreignAmount != null ? foreignAmount : egpAmount,
        currency: r.currency || 'USD',
        exchangeRate: effectiveRate,
        exchange_rate: effectiveRate,
        paymentDate: dateVal,
        payment_date: dateVal,
        requiresLegacyReconciliation: foreignAmount == null,
        supplierName: r.supplier_name || '—',
        supplier_name: r.supplier_name || '—',
        notes: r.note || '',
        note: r.note || '',
        createdAt: r.created_at,
        created_at: r.created_at,
      };
    });
  }

  async recordForeignTransfer(tenantId: string, userId: number, dto: RecordForeignTransferDto) {
    const {
      supplierId,
      amountEgp,
      amountForeign,
      currency,
      exchangeRateContract,
      proformaInvoiceId,
      notes,
      projectId,
      bankAccountId: reqBankAccountId,
      approvalRequestId,
    } = dto;
    const sId = Number(supplierId);

    const cleanEgp = Number(amountEgp);
    const cleanForeign = Number(amountForeign);
    const requestKey = (dto.idempotencyKey || '').trim();

    if (!requestKey || requestKey.length > 128) {
      throw new BadRequestException('مفتاح عدم تكرار الحوالة (Idempotency Key) إلزامي ويجب ألا يتجاوز 128 حرفًا.');
    }

    if (!Number.isFinite(cleanEgp) || cleanEgp <= 0 || !Number.isFinite(cleanForeign) || cleanForeign <= 0) {
      throw new BadRequestException('مبالغ الحوالة بالجنيه والعملة الأجنبية يجب أن تكون أكبر من الصفر.');
    }

    return await this.db.transaction().execute(async (trx) => {
      // Maker-Checker approval check
      if (approvalRequestId || cleanForeign >= 100000) {
        if (!approvalRequestId && cleanForeign >= 100000) {
          throw new BadRequestException('الحوالات الكبرى (100,000 فأكثر) تتطلب اعتماداً ثنائياً مسبقاً (Maker-Checker).');
        }
        await this.verifyAndConsumeApprovalRequest(
          trx,
          tenantId,
          'large_transfer',
          String(sId),
          approvalRequestId
        );
      }

      const supplier = await trx
        .selectFrom('suppliers')
        .select(['id', 'name', 'account_id', 'balance'])
        .where('id', '=', sId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // 1. Proforma Invoice Integrity Checks (Supplier, Project, Currency, Overpayment, Duplicate)
      if (proformaInvoiceId) {
        const pi = await trx
          .selectFrom('import_proforma_invoices')
          .selectAll()
          .where('id', '=', proformaInvoiceId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!pi) {
          throw new BadRequestException('الفاتورة المبدئية المحددة غير موجودة أو لا تنتمي لهذه المنشأة.');
        }

        if (Number(pi.supplier_id) !== sId) {
          throw new BadRequestException(
            `الفاتورة المبدئية (${pi.pi_number}) تخص مورداً آخر وليست للمورد المحدد.`
          );
        }

        if (projectId && pi.project_id && projectId !== pi.project_id) {
          throw new BadRequestException(
            `الفاتورة المبدئية (${pi.pi_number}) مرتبطة بمشروع استيراد آخر.`
          );
        }

        const piCurrency = (pi.currency || 'USD').toUpperCase();
        const transferCurrency = (currency || 'USD').toUpperCase();
        if (piCurrency !== transferCurrency) {
          throw new BadRequestException(
            `عملة الحوالة (${transferCurrency}) لا تطابق عملة الفاتورة المبدئية (${piCurrency}).`
          );
        }

        if (pi.payment_status === 'paid' && Number(pi.paid_amount_foreign || 0) >= Number(pi.total_amount_foreign || 0)) {
          throw new BadRequestException(
            `الفاتورة المبدئية (${pi.pi_number}) مسددة بالكامل بالفعل ولا يمكن سداد دفعات إضافية عليها.`
          );
        }

        const totalForeign = Number(pi.total_amount_foreign || 0);
        const alreadyPaidForeign = Number(pi.paid_amount_foreign || 0);
        const remainingForeign = Math.max(0, totalForeign - alreadyPaidForeign);
        if (cleanForeign > remainingForeign + 0.0001) {
          throw new BadRequestException(
            `مبلغ الحوالة (${cleanForeign.toFixed(2)} ${transferCurrency}) يتجاوز المتبقي غير المسدد للفاتورة المبدئية (${remainingForeign.toFixed(2)} ${transferCurrency}).`
          );
        }

        const newPaid = alreadyPaidForeign + cleanForeign;
        const newStatus = newPaid >= totalForeign - 0.0001 ? 'paid' : 'partially_paid';

        await trx
          .updateTable('import_proforma_invoices')
          .set({ paid_amount_foreign: newPaid, payment_status: newStatus })
          .where('id', '=', proformaInvoiceId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // 2. Database-Backed Idempotency Protection
      const existingPayment = await trx
        .selectFrom('supplier_payments')
        .select(['id', 'doc_no', 'created_at'])
        .where('tenant_id', '=', tenantId)
        .where('idempotency_key', '=', requestKey)
        .executeTakeFirst();

      if (existingPayment) {
        throw new ConflictException(
          `تم تنفيذ هذا الطلب مسبقاً برقم (${existingPayment.doc_no})؛ تم منع إعادة التنفيذ بواسطة مفتاح عدم التكرار (Idempotency Key).`
        );
      }

      // 3. Resolve Real Accounts from Chart of Accounts / Accounting Settings
      const supplierApAccountId = await this.resolveTenantAccount(trx, tenantId, 'payable');
      const bankAccountId = await this.resolveTenantAccount(trx, tenantId, 'bank', reqBankAccountId);
      const bankScope = await trx
        .selectFrom('accounting_accounts')
        .select('account_id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bankAccountId)
        .executeTakeFirstOrThrow();

      // 4. Exact Base Currency (EGP) Accounting Entries without mixing foreign units
      const effectiveRateContract = exchangeRateContract && exchangeRateContract > 0
        ? exchangeRateContract
        : (cleanEgp / cleanForeign);
      const contractValue = Number((cleanForeign * effectiveRateContract).toFixed(2));
      const actualEgp = Number(cleanEgp.toFixed(2));
      const forexVarianceEgp = Number((actualEgp - contractValue).toFixed(2));

      let paymentInsert;
      try {
        paymentInsert = await trx
          .insertInto('supplier_payments')
          .values({
            tenant_id: tenantId,
            account_id: supplier.account_id || tenantId,
            supplier_id: supplier.id,
            amount: -contractValue,
            amount_foreign: cleanForeign,
            note: `حوالة استيراد خارجية${notes ? ' - ' + notes : ''} [تدبير عملة: ${actualEgp} ج.م]`,
            created_by: userId,
            payment_date: (dto as any).transferDate || new Date().toISOString().slice(0, 10),
            currency: currency || 'USD',
            exchange_rate: actualEgp / cleanForeign,
            forex_variance_egp: forexVarianceEgp,
            proforma_invoice_id: proformaInvoiceId || null,
            idempotency_key: requestKey,
          } as any)
          .returning('id')
          .executeTakeFirstOrThrow();
      } catch (err: any) {
        if (err?.code === '23505' || String(err?.message || '').includes('idx_supplier_payments_tenant_idempotency')) {
          throw new ConflictException(
            'تم تنفيذ حوالة متزامنة بنفس مفتاح عدم التكرار (Idempotency Key).'
          );
        }
        throw err;
      }

      const paymentId = paymentInsert.id;

      await trx
        .updateTable('supplier_payments')
        .set({ doc_no: `FT-${paymentId}` })
        .where('id', '=', paymentId)
        .where('tenant_id', '=', tenantId)
        .execute();

      await trx
        .insertInto('treasury_transactions')
        .values({
          tenant_id: tenantId,
          account_id: bankScope.account_id,
          txn_type: 'supplier_payment',
          amount: -actualEgp,
          note: `تدبير عملة: حوالة خارجية إلى ${supplier.name} (${cleanForeign} ${currency || 'USD'})` +
            (forexVarianceEgp !== 0 ? ` [فروق صرف: ${forexVarianceEgp.toFixed(2)} ج.م]` : ''),
          reference_type: 'supplier_payment',
          reference_id: paymentId,
          created_by: userId,
        })
        .execute();

      // The shared supplier ledger and suppliers.balance are BASE-CURRENCY EGP.
      // The original foreign-currency units belong only in amount_foreign / Proforma.
      const currentSupplierBalance = Number(supplier.balance || 0);
      const newSupplierBalance = currentSupplierBalance - contractValue;

      await trx
        .insertInto('supplier_ledger')
        .values({
          tenant_id: tenantId,
          account_id: supplier.account_id ? String(supplier.account_id) : tenantId,
          supplier_id: supplier.id,
          entry_type: 'payment',
          amount: -contractValue,
          balance_after: newSupplierBalance,
          note: `حوالة خارجية FT-${paymentId} (${cleanForeign} ${currency || 'USD'})` +
            (forexVarianceEgp !== 0 ? ` [فروق صرف: ${forexVarianceEgp.toFixed(2)} ج.م]` : ''),
          reference_type: 'supplier_payment',
          reference_id: paymentId,
          return_document_id: null,
          branch_id: null,
          location_id: null,
          created_by: userId,
        })
        .execute();

      await trx
        .updateTable('suppliers')
        .set((eb) => ({
          balance: sql`${eb.ref('balance')} - ${contractValue}`,
        }))
        .where('id', '=', sId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const postingService = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const lines: any[] = [
        // Line 1: Debit Supplier Accounts Payable in EGP (relieve debt at contract rate)
        {
          accountId: supplierApAccountId,
          description: `سداد مديونية مورد خارجي - ${supplier.name} (${cleanForeign} ${currency || 'USD'})`,
          debit: contractValue,
          credit: 0,
          partnerType: 'supplier',
          partnerId: supplier.id,
          branchId: null,
          locationId: null,
        },
      ];

      // Line 2: Realized Forex Variance in EGP (Debit if Loss, Credit if Gain)
      // Resolved dynamically only if variance actually exists
      if (forexVarianceEgp > 0.001) {
        lines.push({
          accountId: await this.resolveTenantAccount(trx, tenantId, 'forex_loss'),
          description: `فروق سعر صرف محققة (خسارة) على حوالة FT-${paymentId}`,
          debit: forexVarianceEgp,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      } else if (forexVarianceEgp < -0.001) {
        lines.push({
          accountId: await this.resolveTenantAccount(trx, tenantId, 'forex_gain'),
          description: `فروق سعر صرف محققة (أرباح) على حوالة FT-${paymentId}`,
          debit: 0,
          credit: Math.abs(forexVarianceEgp),
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        });
      }

      // Line 3: Credit Bank account for actual cash paid in base currency (EGP)
      lines.push({
        accountId: bankAccountId,
        description: `تدبير عملة وخروج نقدية بنكية لحوالة FT-${paymentId}`,
        debit: 0,
        credit: actualEgp,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });

      const jeId = await postingService.postDomainJournal(trx, {
        sourceType: 'supplier_payment',
        sourceId: paymentId,
        tenantId,
        accountId: supplier.account_id || tenantId,
        entryDate: new Date(),
        description: `سداد مورد خارجي وحوالة أجنبية FT-${paymentId} - ${supplier.name} (${cleanForeign} ${currency || 'USD'})`,
        branchId: null,
        locationId: null,
        createdBy: userId,
        postedBy: userId,
        lines,
      });

      return {
        success: true,
        paymentId,
        docNo: `FT-${paymentId}`,
        forexVarianceEgp,
        journalEntryId: jeId,
        bankAccountId,
        supplierApAccountId,
      };
    });
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
      const approved = await trx.selectFrom('import_approval_requests').select('request_payload')
        .where('tenant_id', '=', tenantId).where('id', '=', approvalRequestId).executeTakeFirstOrThrow();
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
    dto: { type: 'DEPOSIT' | 'WITHDRAWAL'; amount: number; date: string; note?: string; accountId?: string }
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

      const ledgerInsert = await trx
        .insertInto('import_partner_ledger')
        .values({
          tenant_id: tenantId,
          partner_id: partnerId,
          type: dto.type,
          amount: cleanAmount,
          transaction_date: dto.date,
          note: dto.note || '',
          created_by: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

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
    return this.inventoryDb.transaction().execute(async (trx) => {
      const parent = await trx.selectFrom('import_shipment_items').select('shipment_id')
        .where('tenant_id', '=', tenantId).where('id', '=', itemId).executeTakeFirst();
      if (!parent) throw new NotFoundException('بند الشحنة غير موجود');
      // Do not lock an item before its parent; every edit/post uses the same ordering.
      const state = await this.lockShipment(trx, tenantId, parent.shipment_id);
      const item = await trx.selectFrom('import_shipment_items').selectAll()
        .where('tenant_id', '=', tenantId).where('shipment_id', '=', parent.shipment_id)
        .where('id', '=', itemId).executeTakeFirstOrThrow();
      const payload: Updateable<ImportShipmentItemTable> = {};
      const stockEdit = dto.receivedQuantity !== undefined || dto.shortageHandlingMethod !== undefined ||
        dto.unitWeightKg !== undefined || dto.unitCbm !== undefined;
      if (stockEdit) {
        this.assertShipmentEditable(state);
        if (dto.receivedQuantity !== undefined) payload.received_quantity = requireImportNumber(dto.receivedQuantity, 'الكمية المستلمة');
        if (dto.shortageHandlingMethod !== undefined) payload.shortage_handling_method = dto.shortageHandlingMethod;
        if (dto.unitWeightKg !== undefined) payload.gross_weight_kg_unit = requireImportNumber(dto.unitWeightKg, 'وزن الوحدة');
        if (dto.unitCbm !== undefined) payload.cbm_unit = requireImportNumber(dto.unitCbm, 'حجم الوحدة');
      }
      if (dto.targetRetailMargin !== undefined) payload.target_retail_margin = requireImportNumber(dto.targetRetailMargin, 'هامش التجزئة');
      if (dto.targetWholesaleMargin !== undefined) payload.target_wholesale_margin = requireImportNumber(dto.targetWholesaleMargin, 'هامش الجملة');
      if (Object.keys(payload).length) {
        await trx.updateTable('import_shipment_items').set(payload)
          .where('tenant_id', '=', tenantId).where('shipment_id', '=', item.shipment_id).where('id', '=', itemId).execute();
        if (stockEdit) await this.calculateLandedCostInTransaction(trx, state.shipment);
      }
      return { success: true };
    });
  }

  async applySuggestedPrices(tenantId: string, shipmentId: string) {
    return await this.db.transaction().execute(async (trx) => {
      const items = await trx
        .selectFrom('import_shipment_items')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', shipmentId)
        .execute();

      const shipment = await trx
        .selectFrom('import_shipments')
        .select(['exchange_rate_at_arrival', 'pricing_exchange_rate'])
        .where('id', '=', shipmentId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!shipment) throw new NotFoundException('الشحنة غير موجودة');

      const arrivalRate = Number(shipment?.exchange_rate_at_arrival) || 1;
      const pricingRate = Number(shipment?.pricing_exchange_rate) || arrivalRate;

      // INV-IMPORT-APPLY-PRICES-NO-WAC-OVERWRITE: lock every touched
      // product row FOR UPDATE in global ID order, grouped by its own
      // account scope (the canonical lockStockProducts helper), before
      // any price write. This function must never write cost_price
      // (the blended WAC) and never overwrite catalog identity
      // (supplier/category); only retail/wholesale selling prices move.
      if (items.length) {
        const products = await trx
          .selectFrom('products')
          .select(['id', 'account_id'])
          .where('tenant_id', '=', tenantId)
          .where('id', 'in', items.map((item) => Number(item.product_id)))
          .orderBy('id', 'asc')
          .execute();
        const idsByAccount = new Map<string, number[]>();
        for (const product of products) {
          const accountId = String(product.account_id);
          const ids = idsByAccount.get(accountId) || [];
          ids.push(Number(product.id));
          idsByAccount.set(accountId, ids);
        }
        for (const [accountId, productIds] of idsByAccount) {
          await lockStockProducts(trx as any, { tenantId, accountId, productIds });
        }
      }

      let updatedCount = 0;
      for (const item of items) {
        const cost = Number(item.landed_cost_egp || 0);

        // If pricing rate is different, adjust the base cost for pricing
        const unitUsd = Number(item.factory_unit_price_usd || 0);
        const pricingCostEgp = cost + (unitUsd * (pricingRate - arrivalRate));

        const updateData: any = {
          catalog_updated_at: new Date(),
        };

        if (item.target_retail_margin !== null && Number(item.target_retail_margin) > 0) {
          const rMargin = Number(item.target_retail_margin) / 100;
          updateData.retail_price = Number((pricingCostEgp * (1 + rMargin)).toFixed(2));
        }

        if (item.target_wholesale_margin !== null && Number(item.target_wholesale_margin) > 0) {
          const wMargin = Number(item.target_wholesale_margin) / 100;
          updateData.wholesale_price = Number((pricingCostEgp * (1 + wMargin)).toFixed(2));
        }

        if (Object.keys(updateData).length > 0) {
          await trx
            .updateTable('products')
            .set(updateData)
            .where('id', '=', Number(item.product_id))
            .where('tenant_id', '=', tenantId)
            .execute();

          updatedCount++;
        }
      }
      return { success: true, updatedCount };
    });
  }



  async getImportCommandCenterMetrics(tenantId: string) {
    const partnerCapital = await this.db
      .selectFrom('import_partner_ledger')
      .select([
        sql<number>`coalesce(sum(case when type = 'DEPOSIT' then amount else 0 end), 0)`.as('total_deposits'),
        sql<number>`coalesce(sum(case when type = 'WITHDRAWAL' then amount else 0 end), 0)`.as('total_withdrawals'),
      ])
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const netPaidInCapital = Math.max(
      0,
      Number(partnerCapital?.total_deposits || 0) - Number(partnerCapital?.total_withdrawals || 0)
    );

    const shipmentExpenses = await this.db
      .selectFrom('import_shipments')
      .innerJoin('expenses', (join) =>
        join.on((eb) =>
          eb.or([
            eb('expenses.id', '=', eb.ref('import_shipments.shipping_expense_id')),
            eb('expenses.id', '=', eb.ref('import_shipments.customs_expense_id')),
            eb('expenses.id', '=', eb.ref('import_shipments.transport_expense_id')),
          ])
        )
      )
      .select([sql<number>`coalesce(sum(expenses.amount), 0)`.as('total_shipment_costs')])
      .where('import_shipments.tenant_id', '=', tenantId)
      .executeTakeFirst();

    const transferOutflows = await this.db
      .selectFrom('treasury_transactions')
      .select([sql<number>`coalesce(sum(abs(amount)), 0)`.as('total_transfers')])
      .where('tenant_id', '=', tenantId)
      .where('txn_type', '=', 'supplier_payment')
      .where('reference_type', '=', 'supplier_payment')
      .executeTakeFirst();

    const sourcingTripCosts = await this.db
      .selectFrom('import_sourcing_trips')
      .select([sql<number>`coalesce(sum(actual_cost_egp), 0)`.as('total_trips')])
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const deployedCapital =
      Number(shipmentExpenses?.total_shipment_costs || 0) +
      Number(transferOutflows?.total_transfers || 0) +
      Number(sourcingTripCosts?.total_trips || 0);

    const availableCapital = Math.max(0, netPaidInCapital - deployedCapital);

    const projectRows = await this.db
      .selectFrom('import_projects')
      .select(['status', sql<number>`count(*)`.as('count')])
      .where('tenant_id', '=', tenantId)
      .groupBy('status')
      .execute();

    const projectCounts: Record<string, number> = {};
    for (const r of projectRows) {
      projectCounts[r.status || 'unknown'] = Number(r.count || 0);
    }

    const shipmentRows = await this.db
      .selectFrom('import_shipments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .execute();

    let inTransitCount = 0;
    let inCustomsCount = 0;
    let arrivedCount = 0;

    for (const s of shipmentRows) {
      if (s.status === 'Arrived') arrivedCount++;
      else if (s.status === 'In Customs') inCustomsCount++;
      else inTransitCount++;
    }

    const foreignDebts = await this.db
      .selectFrom('suppliers')
      .leftJoin('import_suppliers_meta', 'import_suppliers_meta.supplier_id', 'suppliers.id')
      .select([
        'suppliers.id',
        'suppliers.name',
        'suppliers.balance',
        'import_suppliers_meta.audit_status',
      ])
      .where('suppliers.tenant_id', '=', tenantId)
      .where('suppliers.balance', '>', 0)
      .execute();

    const openProformas = await this.db
      .selectFrom('import_proforma_invoices')
      .select(['supplier_id', 'total_amount_foreign', 'paid_amount_foreign', 'currency'])
      .where('tenant_id', '=', tenantId)
      .where('status', '!=', 'cancelled')
      .where('payment_status', '!=', 'paid')
      .execute();

    const unpaidProformaBySupplier = new Map<number, number>();
    let unpaidProformaForeign = 0;
    for (const pi of openProformas) {
      const rem = Math.max(0, Number(pi.total_amount_foreign || 0) - Number(pi.paid_amount_foreign || 0));
      unpaidProformaForeign += rem;
      if (pi.supplier_id) {
        const sId = Number(pi.supplier_id);
        unpaidProformaBySupplier.set(sId, (unpaidProformaBySupplier.get(sId) || 0) + rem);
      }
    }

    const supplierLiabilities = foreignDebts.map((s) => ({
      supplierId: s.id,
      supplierName: s.name,
      balance: Number(s.balance || 0),
      balanceEgp: Number(s.balance || 0),
      unpaidForeignUsd: Number((unpaidProformaBySupplier.get(Number(s.id)) || 0).toFixed(2)),
      currency: 'EGP',
      isBankVerified: s.audit_status === 'verified',
    }));

    const totalDebtEgp = foreignDebts.reduce((sum, s) => sum + Number(s.balance || 0), 0);
    const totalDebtForeign = Number((unpaidProformaForeign > 0 ? unpaidProformaForeign : totalDebtEgp).toFixed(2));

    const demurrageAlerts: any[] = [];
    for (const s of shipmentRows.filter((r) => r.status !== 'Arrived')) {
      const risk = calculateDemurrageRisk({
        arrivalDate: s.arrival_date,
        demurrageStartDate: s.demurrage_start_date,
        freeDays: Number(s.free_demurrage_days ?? 14),
        ratePerDayUsd: Number(s.demurrage_rate_per_day ?? 50),
        exchangeRate: Number(s.exchange_rate_at_arrival || 1),
        status: s.container_status === 'empty_returned' ? 'empty_returned' : (s.status || 'Pending'),
      });
      if (risk.isOverdue || (risk.daysRemaining !== null && risk.daysRemaining <= 3)) {
        demurrageAlerts.push({
          shipmentId: s.id,
          containerNumber: s.container_number,
          status: s.status,
          ...risk,
        });
      }
    }

    const aciExpiring = await this.db
      .selectFrom('import_aci_compliance')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', 'not in', ['approved', 'expired'])
      .where('acid_expiry_date', 'is not', null)
      .where('acid_expiry_date', '<=', sql`CURRENT_DATE + INTERVAL '14 days'`)
      .execute();

    const monthStart = new Date();
    monthStart.setDate(1);
    const profitReport = await this.generatePeriodProfitReport(tenantId, monthStart, new Date());

    return {
      capital: {
        totalCapital: Number(netPaidInCapital.toFixed(2)),
        deployedCapital: Number(deployedCapital.toFixed(2)),
        availableCapital: Number(availableCapital.toFixed(2)),
      },
      pipeline: {
        projects: projectCounts,
        shipments: {
          inTransit: inTransitCount,
          inCustoms: inCustomsCount,
          arrived: arrivedCount,
          total: shipmentRows.length,
        },
      },
      liabilities: {
        totalDebtForeign,
        totalDebtEgp: Number(totalDebtEgp.toFixed(2)),
        unpaidProformaUsd: Number(unpaidProformaForeign.toFixed(2)),
        supplierLiabilities,
      },
      alerts: {
        demurrageAlerts,
        aciExpiring,
      },
      performance: profitReport.data,
    };
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
            effective_from: new Date().toISOString().slice(0, 10),
          })
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'project_id', 'partner_id']).doUpdateSet({
              capital_share_amount: Number(p.capitalShare || 0),
              profit_percentage: Number(p.profitPercentage || 0),
              is_active: true,
              effective_from: new Date().toISOString().slice(0, 10),
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
    const commRate = Number(dto.exchangeRate || 50) > 0 ? Number(dto.exchangeRate || 50) : 50;
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
        inquiry_date: dto.inquiryDate || new Date().toISOString().slice(0, 10),
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
      const quote = await trx
        .selectFrom('import_quotations')
        .selectAll()
        .where('id', '=', quotationId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirstOrThrow();

      if (quote.project_id) {
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
        request_date: dto.requestDate || new Date().toISOString().slice(0, 10),
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
      const advPercent = dto.advancePaymentPercentage || 30;
      const balPercent = 100 - advPercent;
      const advanceUsd = (totalFactoryUsd * advPercent) / 100;
      const balanceUsd = (totalFactoryUsd * balPercent) / 100;

      const cashFlowSchedule = [
        {
          stage: 'T0_Contract_Advance',
          milestone: 'دفعة مقدمة للمصنع عند توقيع العقد (30%)',
          amountUsd: advanceUsd,
          amountEgp: advanceUsd * commRate,
          dueDaysFromStart: 0,
        },
        {
          stage: 'T1_Pre_Shipment_Balance',
          milestone: 'سداد رصيد المصنع بعد فحص الجودة وقبل الشحن (70%)',
          amountUsd: balanceUsd,
          amountEgp: balanceUsd * commRate,
          dueDaysFromStart: 30,
        },
        {
          stage: 'T2_Freight_And_Insurance',
          milestone: 'سداد نولون الشحن البحري والتأمين عند إصدار البوليصة',
          amountUsd: Number(feas.internationalShippingUsd || 0) + Number(feas.insuranceUsd || 0),
          amountEgp: (Number(feas.internationalShippingUsd || 0) + Number(feas.insuranceUsd || 0)) * commRate,
          dueDaysFromStart: 40,
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
        },
        {
          stage: 'T4_Inland_Transport',
          milestone: 'النولون البري ونقل الحاويات إلى المخازن',
          amountUsd: 0,
          amountEgp: Number(feas.internalTransportEgp || 0),
          dueDaysFromStart: 60,
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
            pi_date: new Date().toISOString().slice(0, 10),
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
        advance_percentage: dto.advancePercentage || 30.0,
        balance_percentage: dto.balancePercentage || 70.0,
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

      // Auto-recovery fallback: If items array contains empty objects or is invalid, recover from linked project feasibility
      const hasValidItems = Array.isArray(raw) && raw.length > 0 && raw.some((it: any) => it && (Number(it.quantity ?? it.qty) > 0 || String(it.productName ?? it.name ?? '').trim()));
      if (!hasValidItems) {
        let feasItems: any[] | null = null;
        if (pi.project_id) {
          const proj = await trx
            .selectFrom('import_projects')
            .select(['feasibility_data'])
            .where('id', '=', pi.project_id)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();
          if (proj?.feasibility_data) {
            const feas = typeof proj.feasibility_data === 'string' ? JSON.parse(proj.feasibility_data) : proj.feasibility_data;
            if (Array.isArray(feas?.items) && feas.items.length > 0) feasItems = feas.items;
          }
        }
        if (!feasItems) {
          const anyProj = await trx
            .selectFrom('import_projects')
            .select(['feasibility_data'])
            .where('tenant_id', '=', tenantId)
            .where('feasibility_data', 'is not', null)
            .orderBy('created_at', 'desc')
            .execute();
          for (const p of anyProj) {
            const feas = typeof p.feasibility_data === 'string' ? JSON.parse(p.feasibility_data) : p.feasibility_data;
            if (Array.isArray(feas?.items) && feas.items.length > 0) {
              feasItems = feas.items;
              break;
            }
          }
        }
        if (feasItems && feasItems.length > 0) {
          raw = feasItems.map((it: any) => ({
            productName: it.name || it.productName || 'صنف استيراد',
            quantity: Number(it.qty ?? it.quantity ?? 1),
            unitPriceForeign: Number(it.factoryPriceUsd ?? it.unitPriceForeign ?? 0),
            hsCode: it.hsCode || '',
          }));
          await trx
            .updateTable('import_proforma_invoices')
            .set({ items: JSON.stringify(raw) })
            .where('id', '=', id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
      }

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
      for (const item of raw) {
        const productId = Number(item.productId ?? item.product_id);
        const qty = Number(item.quantity ?? item.qty);
        const foreignUnitCost = Number(item.unitPriceForeign ?? item.factoryPriceUsd ?? item.unitPriceUsd);
        if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isFinite(qty) || qty <= 0 ||
          !Number.isFinite(foreignUnitCost) || foreignUnitCost < 0) {
          throw new BadRequestException('يجب ربط كل بند من الـ Proforma بصنف حقيقي وتحديد الكمية وسعر الوحدة الأجنبي.');
        }
        const product = await trx.selectFrom('products').select(['id', 'name'])
          .where('tenant_id', '=', tenantId).where('id', '=', productId).executeTakeFirst();
        if (!product) throw new BadRequestException('صنف Proforma غير موجود ضمن أصناف المنشأة.');

        const unitCost = Number((foreignUnitCost * exchangeRate).toFixed(3));
        const total = Number((qty * unitCost).toFixed(3));
        lines.push({ productId, name: product.name, quantity: qty, unitCost, total });
        foreignTotal += qty * foreignUnitCost;
      }
      foreignTotal = Number(foreignTotal.toFixed(2));
      if (Math.abs(foreignTotal - Number(pi.total_amount_foreign)) > 0.02) {
        // Synchronize header total with lines total seamlessly
        await trx
          .updateTable('import_proforma_invoices')
          .set({ total_amount_foreign: foreignTotal })
          .where('id', '=', id)
          .where('tenant_id', '=', tenantId)
          .execute();
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
      const orderNumber = formatDailyDocumentNumber('PO', inserted.id);
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
        po_number: orderNumber, po_date: new Date().toISOString().slice(0, 10), po_status: 'issued',
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
          disbursement_date: dto.disbursementDate || new Date().toISOString().slice(0, 10),
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
      const expense = await trx
        .insertInto('import_broker_expenses')
        .values({
          tenant_id: tenantId,
          broker_id: dto.brokerId,
          advance_id: dto.advanceId ?? null,
          project_id: dto.projectId ?? advanceForValidation.project_id ?? null,
          shipment_id: dto.shipmentId ?? advanceForValidation.shipment_id ?? null,
          receipt_no: dto.receiptNo,
          expense_date: dto.expenseDate || new Date().toISOString().slice(0, 10),
          category: dto.category,
          amount_egp: dto.amountEgp,
          is_capitalized: dto.isCapitalized ?? true,
          is_refundable_vat: dto.isRefundableVat ?? false,
          attachment_url: dto.attachmentUrl || null,
          is_verified: true,
          verified_by: userId,
          verified_at: new Date(),
          notes: dto.notes || null,
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

      {
        const creditAccId = await this.resolveTenantAccount(trx, tenantId, 'broker_advance');
        let debitRole: 'vat_receivable' | 'inventory' | 'cogs' = 'cogs';
        if (dto.isRefundableVat) debitRole = 'vat_receivable';
        else if (dto.isCapitalized) debitRole = 'inventory';
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
              accountId: creditAccId,
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
  async recordContainerDeposit(tenantId: string, userId: number, dto: RecordContainerDepositDto) {
    if (!Number.isFinite(Number(dto.depositAmountEgp)) || Number(dto.depositAmountEgp) <= 0) {
      throw new BadRequestException('تأمين الحاوية يجب أن يكون مبلغاً موجباً.');
    }
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
          payment_date: dto.paymentDate || new Date().toISOString().slice(0, 10),
          expected_return_date: dto.expectedReturnDate,
          refund_status: 'pending',
          refunded_amount_egp: 0,
          deductions_amount_egp: 0,
          treasury_account_id: dto.treasuryAccountId ? Number(dto.treasuryAccountId) : null,
          notes: dto.notes || null,
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
  async createContainerPreorder(tenantId: string, userId: number, dto: CreateContainerPreorderDto) {
    return await this.db.transaction().execute(async (trx) => {
      const shipment = await trx
        .selectFrom('import_shipments')
        .selectAll()
        .where('id', '=', dto.shipmentId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

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

      if (alreadyReserved + requested > blQuantity) {
        const freeToReserve = Math.max(0, blQuantity - alreadyReserved);
        throw new BadRequestException(
          `لا يمكن تجاوز كمية البوليصة: المتاح للحجز فقط (${freeToReserve}) وحدة من إجمالي (${blQuantity})، والمطلوب (${requested}).`
        );
      }

      const totalPrice = Number((requested * Number(dto.unitPriceEgp)).toFixed(2));
      const depositAmount = Number(dto.depositAmountEgp || 0);

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
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (!Number.isFinite(depositAmount) || depositAmount < 0 || depositAmount > totalPrice) {
        throw new BadRequestException('قيمة العربون يجب أن تكون موجبة ولا تتجاوز إجمالي قيمة الحجز.');
      }
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

      const lot = await trx
        .selectFrom('import_inventory_lots')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', preorder.shipment_id)
        .where('product_id', '=', preorder.product_id)
        .where('status', '=', 'active')
        .forUpdate()
        .executeTakeFirst();

      const branchId = dto.branchId || lot?.branch_id || 1;
      const locationId = dto.locationId || lot?.location_id || 1;

      if (product) {
        await lockStockProducts(trx as any, {
          tenantId,
          accountId: (product as any).account_id || tenantId,
          productIds: [Number(preorder.product_id)],
        });
        await applyStockDelta(trx as any, {
          tenantId,
          accountId: (product as any).account_id || tenantId,
          productId: Number(preorder.product_id),
          delta: -qty,
          branchId,
          locationId,
          allowNegative: true,
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

    const exRate = Number(shipment.exchange_rate_at_arrival || shipment.pricing_exchange_rate || 50);
    const factoryTotalUsd = items.reduce((acc, i) => acc + Number(i.quantity) * Number(i.factory_unit_price_usd), 0);
    const factoryTotalEgp = factoryTotalUsd * exRate;
    const shippingEgp = Number(shipment.shipping_cost_usd || 0) * exRate;
    const customsEgp = Number(shipment.customs_cost_egp || 0);
    const transportEgp = Number(shipment.internal_transport_cost_egp || 0);
    const demurrageEgp = Number(shipment.actual_demurrage_fees || 0);
    const lateExpensesEgp = Number(shipment.late_expenses_total_egp || 0);

    const totalLandedCostEgp =
      factoryTotalEgp + shippingEgp + customsEgp + transportEgp + demurrageEgp + lateExpensesEgp;

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
    const realizedNetProfitEgp = actualInvoicedSalesEgp > 0 ? actualInvoicedSalesEgp - cogsSoldUnitsEgp : 0;
    const roiPercentage = totalLandedCostEgp > 0 ? (realizedNetProfitEgp / totalLandedCostEgp) * 100 : 0;

    const pendingDeposits = deposits.filter((d) => d.refund_status === 'pending');
    const totalPendingDepositEgp = pendingDeposits.reduce((acc, d) => acc + Number(d.deposit_amount_egp), 0);

    return {
      operational: {
        shipmentId,
        containerNumber: shipment.container_number,
        billOfLading: shipment.bill_of_lading,
        carrierName: shipment.carrier_name,
        containerSize: shipment.container_size,
        freightType: shipment.freight_type,
        portOfLoading: shipment.port_of_loading,
        portOfDischarge: shipment.port_of_discharge,
        containerStatus: shipment.container_status || 'arrived',
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
        factoryTotalUsd: Number(factoryTotalUsd.toFixed(2)),
        factoryTotalEgp: Number(factoryTotalEgp.toFixed(2)),
        shippingEgp: Number(shippingEgp.toFixed(2)),
        customsEgp: Number(customsEgp.toFixed(2)),
        transportEgp: Number(transportEgp.toFixed(2)),
        demurrageEgp: Number(demurrageEgp.toFixed(2)),
        lateExpensesEgp: Number(lateExpensesEgp.toFixed(2)),
        totalLandedCostEgp: Number(totalLandedCostEgp.toFixed(2)),
        avgCostPerUnitEgp: Number(avgCostPerUnit.toFixed(4)),
      },
      salesAndInventory: {
        invoicedSalesEgp: Number(actualInvoicedSalesEgp.toFixed(2)),
        grossSalesEgp: Number(actualInvoicedSalesEgp.toFixed(2)),
        inTransitPreordersRevenue: Number(preordersTotalRevenue.toFixed(2)),
        depositsCollectedEgp: Number(preordersDepositsCollected.toFixed(2)),
        refundedPreorderDepositsEgp: Number(preordersDepositsRefunded.toFixed(2)),
        unearnedPreorderLiabilityEgp: Number(preordersDepositsCollected.toFixed(2)),
        unsoldStockLandedValueEgp: Number(unsoldStockLandedValueEgp.toFixed(2)),
        lotsCount: lots.length,
      },
      profitability: {
        cogsSoldUnitsEgp: Number(cogsSoldUnitsEgp.toFixed(2)),
        realizedNetProfitEgp: Number(realizedNetProfitEgp.toFixed(2)),
        roiPercentage: Number(roiPercentage.toFixed(2)),
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
      },
      items,
      lots,
      preorders,
    };
  }

  // -------------------------------------------------------------
  // FX TREASURY DESK
  // -------------------------------------------------------------
  async recordFxAcquisition(tenantId: string, userId: number, dto: RecordFxAcquisitionDto) {
    const foreignAmount = Number(dto.foreignAmount);
    const egpCost = Number(dto.egpCost);
    if (!Number.isFinite(foreignAmount) || foreignAmount <= 0 ||
        !Number.isFinite(egpCost) || egpCost <= 0) {
      throw new BadRequestException('مبالغ تدبير العملة يجب أن تكون أرقاماً موجبة صحيحة.');
    }
    const bankId = dto.bankAccountId ? Number(dto.bankAccountId) : null;
    if (bankId !== null) {
      // This log is informational; still never allow linking a bank belonging to another tenant.
      await this.resolveTenantAccount(this.db, tenantId, 'bank', bankId);
    }
    const effectiveRate = egpCost / foreignAmount;
    return await this.db
      .insertInto('import_fx_acquisitions')
      .values({
        tenant_id: tenantId,
        currency: dto.currency,
        foreign_amount: dto.foreignAmount,
        egp_cost: dto.egpCost,
        effective_exchange_rate: Number(effectiveRate.toFixed(4)),
        acquisition_date: dto.acquisitionDate || new Date().toISOString().slice(0, 10),
        source: dto.source || 'bank',
        bank_account_id: bankId,
        notes: dto.notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
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
      if (!byCurrency[r.currency]) {
        byCurrency[r.currency] = { totalForeign: 0, totalEgp: 0, weightedAvgRate: 0 };
      }
      byCurrency[r.currency].totalForeign += Number(r.foreign_amount);
      byCurrency[r.currency].totalEgp += Number(r.egp_cost);
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

    const todayStr = new Date().toISOString().slice(0, 10);
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
