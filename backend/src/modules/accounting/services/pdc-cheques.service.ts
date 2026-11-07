import { tenantBaseCurrency } from '../accounting-currency';
import { assertPdcTransition, pdcBookAmount } from '../engines/pdc-transition.engine';
import { pdcCurrencySnapshot } from '../pdc-currency';
import { currencyMoneyDigits, roundMoney, toMinorUnits, type MoneyDigits } from '../engines/money-minor-units.engine';
import { lockAccountingPeriod } from '../accounting-period-lock';
import { Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../accounting-posting.service';

export interface PdcChequeRecord {
  id: number;
  tenant_id: string;
  account_id: number | null;
  type: 'receivable' | 'payable';
  cheque_number: string;
  bank_name: string;
  branch_name: string | null;
  drawer_name: string | null;
  partner_type: string;
  partner_id: number | null;
  partner_name: string;
  amount: number;
  currency: string;
  issue_date: string;
  due_date: string;
  status: string;
  deposit_bank_id: number | null;
  deposit_date: string | null;
  cleared_date: string | null;
  bounced_date: string | null;
  bounced_reason: string | null;
  bounced_fee: number;
  flagged_rate_variance: boolean;
  registered_exchange_rate: number | null;
  endorsed_to_supplier_id: number | null;
  endorsed_to_supplier_name: string | null;
  journal_entry_id: number | null;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface PdcChequesFilter {
  type?: 'receivable' | 'payable';
  status?: string;
  search?: string;
  dueFrom?: string;
  dueTo?: string;
  partnerId?: number;
  bankName?: string;
  page?: number;
  limit?: number;
}

export interface PdcChequesStats {
  receivables: {
    totalCount: number;
    totalAmount: number;
    inSafeCount: number;
    inSafeAmount: number;
    underCollectionCount: number;
    underCollectionAmount: number;
    collectedCount: number;
    collectedAmount: number;
    bouncedCount: number;
    bouncedAmount: number;
    dueSoonCount: number;
    dueSoonAmount: number;
    overdueCount: number;
    overdueAmount: number;
  };
  payables: {
    totalCount: number;
    totalAmount: number;
    issuedCount: number;
    issuedAmount: number;
    clearedCount: number;
    clearedAmount: number;
    bouncedCount: number;
    bouncedAmount: number;
    dueSoonCount: number;
    dueSoonAmount: number;
    overdueCount: number;
    overdueAmount: number;
  };
}

export interface CreatePdcChequeDto {
  type: 'receivable' | 'payable';
  chequeNumber: string;
  bankName: string;
  branchName?: string;
  drawerName?: string;
  partnerType?: string;
  partnerId?: number;
  partnerName: string;
  amount: number;
  currency?: string;
  exchangeRate?: number;
  issueDate: string;
  dueDate: string;
  depositBankId?: number;
  notes?: string;
  status?: string;
}

export interface UpdateChequeStatusDto {
  action: 'deposit' | 'collect' | 'clear' | 'bounce' | 'endorse' | 'return' | 'cancel' | 'restore_to_safe';
  actionDate?: string;
  settlementExchangeRate?: number;
  depositBankId?: number;
  bouncedReason?: string;
  bouncedFee?: number;
  endorsedToSupplierId?: number;
  endorsedToSupplierName?: string;
  notes?: string;
}

@Injectable()
export class PdcChequesService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPostingService: AccountingPostingService,
  ) {}

  private toMoney(value: unknown, digits: MoneyDigits): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? roundMoney(n, digits) : 0;
  }

  private formatDate(date: any): string {
    if (!date) return '';
    if (typeof date === 'string') return date.substring(0, 10);
    if (date instanceof Date) return date.toISOString().substring(0, 10);
    return String(date).substring(0, 10);
  }

  /**
   * List cheques with comprehensive filtering and pagination
   */
  async listCheques(
    authContext: AuthContext,
    filters: PdcChequesFilter = {},
  ): Promise<{ data: PdcChequeRecord[]; total: number; page: number; limit: number }> {
    const tenantId = String(authContext.tenantId || '');
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const page = Math.max(1, Number(filters.page || 1));
    const limit = Math.min(100, Math.max(1, Number(filters.limit || 25)));
    const offset = (page - 1) * limit;

    let baseQuery = (this.db as any)
      .selectFrom('accounting_cheques')
      .where('tenant_id', '=', tenantId);

    if (filters.type) {
      baseQuery = baseQuery.where('type', '=', filters.type);
    }

    if (filters.status) {
      baseQuery = baseQuery.where('status', '=', filters.status);
    }

    if (filters.search && filters.search.trim()) {
      const term = `%${filters.search.trim()}%`;
      baseQuery = baseQuery.where((eb: any) =>
        eb.or([
          eb('cheque_number', 'ilike', term),
          eb('partner_name', 'ilike', term),
          eb('bank_name', 'ilike', term),
          eb('drawer_name', 'ilike', term),
        ]),
      );
    }

    if (filters.dueFrom) {
      baseQuery = baseQuery.where('due_date', '>=', filters.dueFrom);
    }

    if (filters.dueTo) {
      baseQuery = baseQuery.where('due_date', '<=', filters.dueTo);
    }

    if (filters.partnerId) {
      baseQuery = baseQuery.where('partner_id', '=', filters.partnerId);
    }

    if (filters.bankName) {
      baseQuery = baseQuery.where('bank_name', '=', filters.bankName);
    }

    // Count total
    const countResult = await baseQuery
      .select((eb: any) => eb.fn.count('id').as('count'))
      .executeTakeFirst();
    const total = Number(countResult?.count || 0);

    // Fetch records
    const rawRows = await baseQuery
      .selectAll()
      .orderBy('due_date', 'asc')
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    const data: PdcChequeRecord[] = rawRows.map((r: any) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      account_id: r.account_id,
      type: r.type,
      cheque_number: r.cheque_number,
      bank_name: r.bank_name,
      branch_name: r.branch_name,
      drawer_name: r.drawer_name,
      partner_type: r.partner_type,
      partner_id: r.partner_id,
      partner_name: r.partner_name,
      amount: this.toMoney(r.amount, currencyMoneyDigits(r.currency || 'EGP')),
      currency: r.currency || 'EGP',
      issue_date: this.formatDate(r.issue_date),
      due_date: this.formatDate(r.due_date),
      status: r.status,
      deposit_bank_id: r.deposit_bank_id,
      deposit_date: r.deposit_date ? this.formatDate(r.deposit_date) : null,
      cleared_date: r.cleared_date ? this.formatDate(r.cleared_date) : null,
      bounced_date: r.bounced_date ? this.formatDate(r.bounced_date) : null,
      bounced_reason: r.bounced_reason,
      bounced_fee: this.toMoney(r.bounced_fee, bookDigits),
      flagged_rate_variance: Boolean(r.flagged_rate_variance),
      registered_exchange_rate: r.registered_exchange_rate == null ? null : Number(r.registered_exchange_rate),
      endorsed_to_supplier_id: r.endorsed_to_supplier_id,
      endorsed_to_supplier_name: r.endorsed_to_supplier_name,
      journal_entry_id: r.journal_entry_id,
      notes: r.notes,
      created_by: r.created_by,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : '',
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : '',
    }));

    return { data, total, page, limit };
  }

  /**
   * Get high-level KPI stats for Cheques Portfolio
   */
  async getStats(authContext: AuthContext): Promise<PdcChequesStats> {
    const tenantId = String(authContext.tenantId || '');
    const today = new Date().toISOString().substring(0, 10);
    const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

    const rows = await (this.db as any)
      .selectFrom('accounting_cheques')
      .where('tenant_id', '=', tenantId)
      .select([
        'type',
        'status',
        'amount', 'base_amount', 'currency',
        'due_date',
      ])
      .execute();

    const stats: PdcChequesStats = {
      receivables: {
        totalCount: 0,
        totalAmount: 0,
        inSafeCount: 0,
        inSafeAmount: 0,
        underCollectionCount: 0,
        underCollectionAmount: 0,
        collectedCount: 0,
        collectedAmount: 0,
        bouncedCount: 0,
        bouncedAmount: 0,
        dueSoonCount: 0,
        dueSoonAmount: 0,
        overdueCount: 0,
        overdueAmount: 0,
      },
      payables: {
        totalCount: 0,
        totalAmount: 0,
        issuedCount: 0,
        issuedAmount: 0,
        clearedCount: 0,
        clearedAmount: 0,
        bouncedCount: 0,
        bouncedAmount: 0,
        dueSoonCount: 0,
        dueSoonAmount: 0,
        overdueCount: 0,
        overdueAmount: 0,
      },
    };

    const base = await tenantBaseCurrency(this.db, tenantId);
    const baseDigits = currencyMoneyDigits(base);
    if (rows.some((r: any) => r.base_amount == null && r.currency !== base)) throw new BadRequestException('إحصاءات الحافظة تتطلب مطابقة الشيكات الأجنبية القديمة أولاً.');
    for (const r of rows) {
      const amount = this.toMoney(r.base_amount ?? r.amount, baseDigits);
      const dueDate = this.formatDate(r.due_date);
      const isReceivable = r.type === 'receivable';

      if (isReceivable) {
        stats.receivables.totalCount += 1;
        stats.receivables.totalAmount = this.toMoney(stats.receivables.totalAmount + amount, baseDigits);

        if (r.status === 'in_safe') {
          stats.receivables.inSafeCount += 1;
          stats.receivables.inSafeAmount = this.toMoney(stats.receivables.inSafeAmount + amount, baseDigits);
        } else if (r.status === 'under_collection') {
          stats.receivables.underCollectionCount += 1;
          stats.receivables.underCollectionAmount = this.toMoney(stats.receivables.underCollectionAmount + amount, baseDigits);
        } else if (r.status === 'collected') {
          stats.receivables.collectedCount += 1;
          stats.receivables.collectedAmount = this.toMoney(stats.receivables.collectedAmount + amount, baseDigits);
        } else if (r.status === 'bounced') {
          stats.receivables.bouncedCount += 1;
          stats.receivables.bouncedAmount = this.toMoney(stats.receivables.bouncedAmount + amount, baseDigits);
        }

        const isSettled = ['collected', 'cancelled', 'returned', 'endorsed'].includes(r.status);
        if (!isSettled) {
          if (dueDate < today) {
            stats.receivables.overdueCount += 1;
            stats.receivables.overdueAmount = this.toMoney(stats.receivables.overdueAmount + amount, baseDigits);
          } else if (dueDate >= today && dueDate <= in7Days) {
            stats.receivables.dueSoonCount += 1;
            stats.receivables.dueSoonAmount = this.toMoney(stats.receivables.dueSoonAmount + amount, baseDigits);
          }
        }
      } else {
        // Payable
        stats.payables.totalCount += 1;
        stats.payables.totalAmount = this.toMoney(stats.payables.totalAmount + amount, baseDigits);

        if (r.status === 'issued') {
          stats.payables.issuedCount += 1;
          stats.payables.issuedAmount = this.toMoney(stats.payables.issuedAmount + amount, baseDigits);
        } else if (r.status === 'cleared') {
          stats.payables.clearedCount += 1;
          stats.payables.clearedAmount = this.toMoney(stats.payables.clearedAmount + amount, baseDigits);
        } else if (r.status === 'bounced') {
          stats.payables.bouncedCount += 1;
          stats.payables.bouncedAmount = this.toMoney(stats.payables.bouncedAmount + amount, baseDigits);
        }

        const isSettled = ['cleared', 'cancelled'].includes(r.status);
        if (!isSettled) {
          if (dueDate < today) {
            stats.payables.overdueCount += 1;
            stats.payables.overdueAmount = this.toMoney(stats.payables.overdueAmount + amount, baseDigits);
          } else if (dueDate >= today && dueDate <= in7Days) {
            stats.payables.dueSoonCount += 1;
            stats.payables.dueSoonAmount = this.toMoney(stats.payables.dueSoonAmount + amount, baseDigits);
          }
        }
      }
    }

    return stats;
  }

  /**
   * Register a new cheque (Receivable or Payable)
   */
  async createCheque(authContext: AuthContext, dto: CreatePdcChequeDto): Promise<PdcChequeRecord> {
    const tenantId = String(authContext.tenantId || '');

    if (!dto.chequeNumber || !dto.chequeNumber.trim()) {
      throw new BadRequestException('رقم الشيك مطلوب');
    }
    if (!dto.bankName || !dto.bankName.trim()) {
      throw new BadRequestException('اسم البنك مطلوب');
    }
    if (!dto.partnerName || !dto.partnerName.trim()) {
      throw new BadRequestException('اسم العميل / المورد مطلوب');
    }
    // Currency first: amount precision is judged in the CHEQUE's currency,
    // not in hard-coded cents. A USD cheque is 2dp even for a KWD tenant;
    // a KWD cheque is 3dp even when the old *100 check would have passed
    // its face amount. pdcCurrencySnapshot re-validates the same rule
    // inside the transaction; this fail-fast check keeps the error at the
    // DTO boundary, before the period lock and the insert.
    const requestedCurrency = String(dto.currency || await tenantBaseCurrency(this.db, tenantId)).trim().toUpperCase();
    const amount = Number(dto.amount);
    let amountIsMinorExact = Number.isFinite(amount) && amount > 0;
    try { if (amountIsMinorExact) toMinorUnits(amount, currencyMoneyDigits(requestedCurrency)); } catch { amountIsMinorExact = false; }
    if (!amountIsMinorExact) {
      throw new BadRequestException('مبلغ الشيك يجب أن يكون أكبر من صفر');
    }
    if (!dto.issueDate || !dto.dueDate) {
      throw new BadRequestException('تاريخ التحرير وتاريخ الاستحقاق مطلوبان');
    }

    for (const day of [dto.issueDate, dto.dueDate]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(new Date(day).getTime()) || new Date(day).toISOString().slice(0, 10) !== day) throw new BadRequestException('تاريخ الشيك غير صالح.');
    }
    if (dto.dueDate < dto.issueDate) throw new BadRequestException('الاستحقاق يسبق تحرير الشيك.');
    const type = dto.type === 'payable' ? 'payable' : 'receivable';
    const defaultStatus = type === 'receivable' ? 'in_safe' : 'issued';
    const status = dto.status || defaultStatus;
    if (status !== defaultStatus) throw new BadRequestException('الشيك الجديد يبدأ من حالة الاستلام أو الإصدار فقط.');
    const partnerType = type === 'receivable' ? 'customer' : 'supplier';
    if (dto.partnerType && dto.partnerType !== partnerType) throw new BadRequestException('نوع الشريك لا يطابق نوع الشيك.');

    return this.db.transaction().execute(async (trx: any) => {
      await lockAccountingPeriod(trx, tenantId);
      if (!dto.partnerId) {
        const matches = await trx.selectFrom(type === 'receivable' ? 'customers' : 'suppliers').select('id').where('tenant_id', '=', tenantId).where('name', '=', dto.partnerName.trim()).where('is_active', '=', true).limit(2).execute();
        if (matches.length !== 1) throw new BadRequestException('يجب اختيار عميل أو مورد مسجل وفريد؛ الاسم وحده لا يكفي لربط الشيك.');
        dto = { ...dto, partnerId: Number(matches[0].id) };
      }
      if (dto.partnerId && !await trx.selectFrom(type === 'receivable' ? 'customers' : 'suppliers').select('id').where('tenant_id', '=', tenantId).where('id', '=', Number(dto.partnerId)).executeTakeFirst()) throw new BadRequestException('الشريك لا يتبع المنشأة.');
      if (dto.depositBankId && !await trx.selectFrom('accounting_accounts').select('id').where('tenant_id', '=', tenantId).where('id', '=', dto.depositBankId).where('is_active', '=', true).where('is_cash_bank', '=', true).where('code', 'not in', ['1121', '1122']).executeTakeFirst()) throw new BadRequestException('حساب البنك لا يتبع المنشأة أو غير صالح.');
      const currency = requestedCurrency;
      const snapshot = await pdcCurrencySnapshot(trx, tenantId, currency, amount, dto.exchangeRate);
      const inserted = await trx
        .insertInto('accounting_cheques')
        .values({
          tenant_id: tenantId,
          type,
          cheque_number: dto.chequeNumber.trim(),
          bank_name: dto.bankName.trim(),
          branch_name: dto.branchName?.trim() || null,
          drawer_name: dto.drawerName?.trim() || null,
          partner_type: dto.partnerType || (type === 'receivable' ? 'customer' : 'supplier'),
          partner_id: dto.partnerId || null,
          partner_name: dto.partnerName.trim(),
          amount: amount,
          currency,
          ...snapshot,
          issue_date: dto.issueDate,
          due_date: dto.dueDate,
          status,
          deposit_bank_id: dto.depositBankId || null,
          notes: dto.notes?.trim() || null,
          created_by: authContext.userId ? Number(authContext.userId) : null,
        } as any)
        .returningAll()
        .executeTakeFirstOrThrow();

      let journalEntryId: number | null = null;
      if (type === 'receivable' && status === 'in_safe') {
        const postRes = await this.accountingPostingService.postPdcChequeReceive(trx, inserted.id, authContext);
        if (postRes.posted && postRes.journalEntryId) {
          journalEntryId = postRes.journalEntryId;
          await trx
            .updateTable('accounting_cheques')
            .set({ journal_entry_id: journalEntryId })
            .where('id', '=', inserted.id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
        if (inserted.partner_id) {
          await this.syncCustomerSubLedger(
            trx,
            authContext,
            Number(inserted.partner_id),
            -snapshot.base_amount,
            'cheque_received',
            `استلام شيك قبض #${dto.chequeNumber}`,
            inserted.id,
          );
        }
      } else if (type === 'payable' && status === 'issued') {
        const postRes = await this.accountingPostingService.postPdcChequeIssue(trx, inserted.id, authContext);
        if (postRes.posted && postRes.journalEntryId) {
          journalEntryId = postRes.journalEntryId;
          await trx
            .updateTable('accounting_cheques')
            .set({ journal_entry_id: journalEntryId })
            .where('id', '=', inserted.id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
        if (inserted.partner_id) {
          await this.syncSupplierSubLedger(
            trx,
            authContext,
            Number(inserted.partner_id),
            -snapshot.base_amount,
            'cheque_issued',
            `إصدار شيك دفع #${dto.chequeNumber}`,
            inserted.id,
          );
        }
      }

      // The face amount is shaped in the CHEQUE's currency; the bounce
      // fee is a book amount (validated and posted at book digits).
      const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      return {
        id: inserted.id,
        tenant_id: inserted.tenant_id,
        account_id: inserted.account_id,
        type: inserted.type,
        cheque_number: inserted.cheque_number,
        bank_name: inserted.bank_name,
        branch_name: inserted.branch_name,
        drawer_name: inserted.drawer_name,
        partner_type: inserted.partner_type,
        partner_id: inserted.partner_id,
        partner_name: inserted.partner_name,
        amount: this.toMoney(inserted.amount, currencyMoneyDigits(currency)),
        currency: inserted.currency,
        issue_date: this.formatDate(inserted.issue_date),
        due_date: this.formatDate(inserted.due_date),
        status: inserted.status,
        deposit_bank_id: inserted.deposit_bank_id,
        deposit_date: inserted.deposit_date ? this.formatDate(inserted.deposit_date) : null,
        cleared_date: inserted.cleared_date ? this.formatDate(inserted.cleared_date) : null,
        bounced_date: inserted.bounced_date ? this.formatDate(inserted.bounced_date) : null,
        bounced_reason: inserted.bounced_reason,
        bounced_fee: this.toMoney(inserted.bounced_fee, bookDigits),
        endorsed_to_supplier_id: inserted.endorsed_to_supplier_id,
        endorsed_to_supplier_name: inserted.endorsed_to_supplier_name,
        flagged_rate_variance: Boolean(inserted.flagged_rate_variance),
        registered_exchange_rate: inserted.registered_exchange_rate == null ? null : Number(inserted.registered_exchange_rate),
        journal_entry_id: journalEntryId,
        notes: inserted.notes,
        created_by: inserted.created_by,
        created_at: inserted.created_at ? new Date(inserted.created_at).toISOString() : '',
        updated_at: inserted.updated_at ? new Date(inserted.updated_at).toISOString() : '',
      };
    });
  }

  /**
   * Transition cheque status along the collection/payment lifecycle
   */
  async updateChequeStatus(
    authContext: AuthContext,
    id: number,
    actionDto: UpdateChequeStatusDto,
  ): Promise<PdcChequeRecord> {
    const tenantId = String(authContext.tenantId || '');

    return this.db.transaction().execute(async (trx: any) => {
      await lockAccountingPeriod(trx, tenantId);
      const existing = await trx
        .selectFrom('accounting_cheques')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .selectAll()
        .forUpdate()
        .executeTakeFirst();

      if (!existing) {
        throw new NotFoundException('الشيك غير موجود');
      }

      if (actionDto.depositBankId && !await trx.selectFrom('accounting_accounts').select('id').where('tenant_id', '=', tenantId).where('id', '=', actionDto.depositBankId).where('is_active', '=', true).where('is_cash_bank', '=', true).where('code', 'not in', ['1121', '1122']).executeTakeFirst()) throw new BadRequestException('حساب البنك لا يتبع المنشأة أو غير صالح.');
      if (actionDto.action === 'endorse') {
        let supplierId = actionDto.endorsedToSupplierId;
        if (!supplierId && actionDto.endorsedToSupplierName) {
          const matches = await trx.selectFrom('suppliers').select('id').where('tenant_id', '=', tenantId).where('name', '=', actionDto.endorsedToSupplierName.trim()).where('is_active', '=', true).limit(2).execute();
          if (matches.length === 1) supplierId = Number(matches[0].id);
        }
        if (!supplierId || !await trx.selectFrom('suppliers').select('id').where('tenant_id', '=', tenantId).where('id', '=', supplierId).executeTakeFirst()) throw new BadRequestException('يجب تحديد مورد مسجل من نفس المنشأة للتظهير.');
        actionDto = { ...actionDto, endorsedToSupplierId: supplierId };
      }
      try { assertPdcTransition(existing.type, existing.status, actionDto.action); } catch (error) { throw new BadRequestException((error as Error).message); }
      if (existing.base_amount == null) {
        const base = await tenantBaseCurrency(trx, tenantId);
        if (existing.currency !== base) throw new BadRequestException('الشيك الأجنبي القديم يحتاج مطابقة وتصحيح القيمة الدفترية أولاً.');
        existing.base_amount = Number(existing.amount);
        await trx.updateTable('accounting_cheques').set({ base_amount: existing.base_amount, exchange_rate: 1, base_currency: existing.currency }).where('tenant_id', '=', tenantId).where('id', '=', id).execute();
      }
      const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      const bookAmount = pdcBookAmount(existing, bookDigits);
      const today = new Date().toISOString().substring(0, 10);
      const actionDate = actionDto.actionDate || today;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(actionDate) || !Number.isFinite(new Date(actionDate).getTime()) || new Date(actionDate).toISOString().slice(0, 10) !== actionDate) throw new BadRequestException('تاريخ إجراء الشيك غير صالح.');
      if (actionDate < this.formatDate(existing.last_action_date || existing.issue_date)) throw new BadRequestException('تاريخ الإجراء يسبق آخر حركة مثبتة للشيك.');
      if (actionDto.bouncedFee != null && (!Number.isFinite(Number(actionDto.bouncedFee)) || Number(actionDto.bouncedFee) < 0)) throw new BadRequestException('عمولة الارتداد غير صالحة.');
      // The bounce fee is stored raw on the cheque row and posted as a
      // book amount; a sub-minor fee would silently diverge the two.
      // Strict, like treasury transfers and expenses: reject, don't round.
      if (actionDto.bouncedFee != null) {
        try { toMinorUnits(Number(actionDto.bouncedFee), bookDigits); } catch { throw new BadRequestException('عمولة الارتداد يجب أن تطابق دقة العملة.'); }
      }
      let settlementBase = bookAmount;
      let settlementSnapshot: { flagged_rate_variance: boolean; registered_exchange_rate: number | null } | null = null;
      if (['collect', 'clear'].includes(actionDto.action)) {
        const snapshot = await pdcCurrencySnapshot(trx, tenantId, existing.currency, Number(existing.amount), actionDto.settlementExchangeRate);
        settlementBase = snapshot.base_amount;
        // A settlement re-rates the cheque, so the variance flag and
        // its reference rate follow the settlement snapshot — a clean
        // settlement rate clears a flag set at creation.
        settlementSnapshot = { flagged_rate_variance: snapshot.flagged_rate_variance, registered_exchange_rate: snapshot.registered_exchange_rate };
      }
      const settlementUpdate: Record<string, any> = { last_action_date: actionDate, settlement_base_amount: settlementBase, posting_sequence: sql`posting_sequence + 1` };
      if (settlementSnapshot) {
        settlementUpdate.flagged_rate_variance = settlementSnapshot.flagged_rate_variance;
        settlementUpdate.registered_exchange_rate = settlementSnapshot.registered_exchange_rate;
      }
      await trx.updateTable('accounting_cheques').set(settlementUpdate).where('tenant_id', '=', tenantId).where('id', '=', id).execute();
      let updateFields: Record<string, any> = {
        updated_at: sql`CURRENT_TIMESTAMP`,
      };

      let nextJournalId = existing.journal_entry_id;

      switch (actionDto.action) {
        case 'deposit':
          if (existing.type !== 'receivable') {
            throw new BadRequestException('الإيداع برسم التحصيل متاح فقط لأوراق القبض');
          }
          if (['collected', 'cleared', 'cancelled', 'endorsed'].includes(existing.status)) {
            throw new BadRequestException('لا يمكن إيداع شيك مسوى أو ملغى بالفعل');
          }
          updateFields.status = 'under_collection';
          updateFields.deposit_date = actionDate;
          if (actionDto.depositBankId) {
            updateFields.deposit_bank_id = actionDto.depositBankId;
          }
          break;

        case 'collect':
          if (existing.type !== 'receivable') {
            throw new BadRequestException('التحصيل متاح فقط لأوراق القبض');
          }
          if (['collected', 'cleared', 'cancelled', 'endorsed'].includes(existing.status)) {
            throw new BadRequestException('لا يمكن تحصيل شيك مسوى أو ملغى بالفعل');
          }
          updateFields.status = 'collected';
          updateFields.cleared_date = actionDate;
          if (actionDto.depositBankId) {
            updateFields.deposit_bank_id = actionDto.depositBankId;
          }
          break;

        case 'clear':
          if (existing.type !== 'payable') {
            throw new BadRequestException('الصرف متاح فقط لأوراق الدفع');
          }
          if (['cleared', 'cancelled'].includes(existing.status)) {
            throw new BadRequestException('لا يمكن صرف شيك مسوى أو ملغى بالفعل');
          }
          updateFields.status = 'cleared';
          updateFields.cleared_date = actionDate;
          break;

        case 'bounce':
          if (['cancelled', 'returned'].includes(existing.status)) {
            throw new BadRequestException('لا يمكن ارتداد شيك ملغى أو مرتجع');
          }
          updateFields.status = 'bounced';
          updateFields.bounced_date = actionDate;
          updateFields.bounced_reason = actionDto.bouncedReason || 'رفض بنكي / عدم كفاية الرصيد';
          updateFields.bounced_fee = actionDto.bouncedFee ? Number(actionDto.bouncedFee) : 0;
          break;

        case 'endorse':
          if (existing.type !== 'receivable') {
            throw new BadRequestException('التظهير متاح فقط لأوراق القبض');
          }
          if (existing.status !== 'in_safe') {
            throw new BadRequestException('التظهير متاح فقط للشيكات الموجودة بالخزينة');
          }
          if (!actionDto.endorsedToSupplierName && !actionDto.endorsedToSupplierId) {
            throw new BadRequestException('يجب تحديد المورد المراد تظهير الشيك إليه');
          }
          updateFields.status = 'endorsed';
          updateFields.endorsed_to_supplier_id = actionDto.endorsedToSupplierId || null;
          updateFields.endorsed_to_supplier_name = actionDto.endorsedToSupplierName || null;
          break;

        case 'return':
          if (['collected', 'cleared', 'endorsed'].includes(existing.status)) {
            throw new BadRequestException('لا يمكن رد شيك تم تحصيله أو صرفه أو تظهيره');
          }
          updateFields.status = 'returned';
          if (actionDto.notes) {
            updateFields.notes = existing.notes
              ? `${existing.notes} | سبب الرد: ${actionDto.notes}`
              : `سبب الرد: ${actionDto.notes}`;
          }
          break;

        case 'cancel':
          if (['collected', 'cleared', 'endorsed'].includes(existing.status)) {
            throw new BadRequestException('لا يمكن إلغاء شيك تم تحصيله أو صرفه أو تظهيره');
          }
          updateFields.status = 'cancelled';
          break;

        case 'restore_to_safe':
          if (['collected', 'cleared', 'endorsed'].includes(existing.status)) {
            throw new BadRequestException('لا يمكن إعادة شيك مسوى للخزينة');
          }
          updateFields.status = existing.type === 'receivable' ? 'in_safe' : 'issued';
          updateFields.deposit_bank_id = null;
          updateFields.deposit_date = null;
          updateFields.cleared_date = null;
          updateFields.bounced_date = null;
          break;

        default:
          throw new BadRequestException('إجراء غير مدعوم');
      }

      if (actionDto.notes && actionDto.action !== 'return') {
        updateFields.notes = existing.notes
          ? `${existing.notes} | ${actionDto.notes}`
          : actionDto.notes;
      }

      // Execute GL posting for financial state transitions
      if (actionDto.action === 'deposit') {
        const postRes = await this.accountingPostingService.postPdcChequeDeposit(trx, id, authContext);
        if (postRes.posted && postRes.journalEntryId) {
          nextJournalId = postRes.journalEntryId;
          updateFields.journal_entry_id = nextJournalId;
        }
        // Deposit must post: advancing to under_collection without a journal
        // leaves the cheque in the wrong custody account in the GL.
        if (!postRes.journalEntryId) throw new BadRequestException('إيداع الشيك لم ينتج قيداً محاسبياً؛ لم يتم تغيير الحالة.');
      } else if (actionDto.action === 'collect') {
        const postRes = await this.accountingPostingService.postPdcChequeCollect(trx, id, actionDto.depositBankId || null, authContext);
        if (postRes.posted && postRes.journalEntryId) {
          nextJournalId = postRes.journalEntryId;
          updateFields.journal_entry_id = nextJournalId;
        }
        if (!postRes.journalEntryId) throw new BadRequestException('تحصيل الشيك لم ينتج قيداً محاسبياً؛ لم يتم تغيير الحالة.');
      } else if (actionDto.action === 'clear') {
        const postRes = await this.accountingPostingService.postPdcChequeClear(trx, id, actionDto.depositBankId || null, authContext);
        if (postRes.posted && postRes.journalEntryId) {
          nextJournalId = postRes.journalEntryId;
          updateFields.journal_entry_id = nextJournalId;
        }
        if (!postRes.journalEntryId) throw new BadRequestException('صرف الشيك لم ينتج قيداً محاسبياً؛ لم يتم تغيير الحالة.');
      } else if (actionDto.action === 'bounce') {
        if (existing.type === 'receivable') {
          const postRes = await this.accountingPostingService.postPdcChequeBounce(
            trx,
            id,
            actionDto.bouncedFee ? Number(actionDto.bouncedFee) : 0,
            actionDto.depositBankId || null,
            authContext,
          );
          if (postRes.posted && postRes.journalEntryId) {
            nextJournalId = postRes.journalEntryId;
            updateFields.journal_entry_id = nextJournalId;
          }
          // The subledger sync below must never run without the bounce
          // journal: that pairing is exactly the GL/subledger divergence.
          if (!postRes.journalEntryId) throw new BadRequestException('ارتداد الشيك لم ينتج قيداً محاسبياً؛ لم يتم تغيير الحالة.');
          if (existing.partner_id) {
            await this.syncCustomerSubLedger(
              trx,
              authContext,
              Number(existing.partner_id),
              bookAmount,
              'cheque_bounced',
              `ارتداد شيك قبض #${existing.cheque_number}`,
              id,
            );
          }
        } else {
          const postRes = await this.accountingPostingService.postPdcChequePayableBounce(trx, id, authContext);
          if (postRes.posted && postRes.journalEntryId) {
            nextJournalId = postRes.journalEntryId;
            updateFields.journal_entry_id = nextJournalId;
          }
          if (!postRes.journalEntryId) throw new BadRequestException('ارتداد شيك الدفع لم ينتج قيداً محاسبياً؛ لم يتم تغيير الحالة.');
          if (existing.partner_id) {
            await this.syncSupplierSubLedger(
              trx,
              authContext,
              Number(existing.partner_id),
              bookAmount,
              'cheque_bounced',
              `ارتداد شيك دفع #${existing.cheque_number}`,
              id,
            );
          }
        }
      } else if (actionDto.action === 'endorse') {
        const postRes = await this.accountingPostingService.postPdcChequeEndorse(
          trx,
          id,
          actionDto.endorsedToSupplierId || null,
          authContext,
        );
        if (postRes.posted && postRes.journalEntryId) {
          nextJournalId = postRes.journalEntryId;
          updateFields.journal_entry_id = nextJournalId;
        }
        // The supplier subledger sync below must never run without the
        // endorse journal.
        if (!postRes.journalEntryId) throw new BadRequestException('تظهير الشيك لم ينتج قيداً محاسبياً؛ لم يتم تغيير الحالة.');
        if (actionDto.endorsedToSupplierId) {
          await this.syncSupplierSubLedger(
            trx,
            authContext,
            Number(actionDto.endorsedToSupplierId),
            -bookAmount,
            'cheque_endorsed',
            `سداد بتظهير شيك قبض #${existing.cheque_number}`,
            id,
          );
        }
      } else if (actionDto.action === 'cancel' || actionDto.action === 'return') {
        // Reverse earlier posted receipt/issue journal ONLY if not already bounced (ZS-047)
        if (existing.journal_entry_id && existing.status !== 'bounced') {
          const postRes = await this.accountingPostingService.postPdcChequeCancelOrReturn(
            trx,
            id,
            actionDto.action,
            authContext,
          );
          if (postRes.posted && postRes.journalEntryId) {
            nextJournalId = postRes.journalEntryId;
            updateFields.journal_entry_id = nextJournalId;
          }
          if (existing.type === 'receivable' && existing.partner_id) {
            await this.syncCustomerSubLedger(
              trx,
              authContext,
              Number(existing.partner_id),
              bookAmount,
              'cheque_returned',
              `رد/إلغاء شيك قبض #${existing.cheque_number}`,
              id,
            );
          } else if (existing.type === 'payable' && existing.partner_id) {
            await this.syncSupplierSubLedger(
              trx,
              authContext,
              Number(existing.partner_id),
              bookAmount,
              'cheque_returned',
              `رد/إلغاء شيك دفع #${existing.cheque_number}`,
              id,
            );
          }
        }
      } else if (actionDto.action === 'restore_to_safe') {
        // Reverse earlier bounce effect or deposit effect when restoring to safe (ZS-048)
        if (existing.status === 'bounced' || existing.status === 'under_collection') {
          const postRes = await this.accountingPostingService.postPdcChequeRestore(
            trx,
            id,
            existing.status,
            authContext,
          );
          if (postRes.posted && postRes.journalEntryId) {
            nextJournalId = postRes.journalEntryId;
            updateFields.journal_entry_id = nextJournalId;
          }
        }
        if (existing.status === 'bounced') {
          if (existing.type === 'receivable' && existing.partner_id) {
            await this.syncCustomerSubLedger(
              trx,
              authContext,
              Number(existing.partner_id),
              -bookAmount,
              'cheque_restored',
              `استعادة شيك مرتد إلى الخزينة #${existing.cheque_number}`,
              id,
            );
          } else if (existing.type === 'payable' && existing.partner_id) {
            await this.syncSupplierSubLedger(
              trx,
              authContext,
              Number(existing.partner_id),
              -bookAmount,
              'cheque_restored',
              `إعادة إدراج شيك مرتد بالخزينة #${existing.cheque_number}`,
              id,
            );
          }
        }
      }

      const updated = await trx
        .updateTable('accounting_cheques')
        .set(updateFields)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        id: updated.id,
        tenant_id: updated.tenant_id,
        account_id: updated.account_id,
        type: updated.type,
        cheque_number: updated.cheque_number,
        bank_name: updated.bank_name,
        branch_name: updated.branch_name,
        drawer_name: updated.drawer_name,
        partner_type: updated.partner_type,
        partner_id: updated.partner_id,
        partner_name: updated.partner_name,
        amount: this.toMoney(updated.amount, currencyMoneyDigits(updated.currency)),
        currency: updated.currency,
        issue_date: this.formatDate(updated.issue_date),
        due_date: this.formatDate(updated.due_date),
        status: updated.status,
        deposit_bank_id: updated.deposit_bank_id,
        deposit_date: updated.deposit_date ? this.formatDate(updated.deposit_date) : null,
        cleared_date: updated.cleared_date ? this.formatDate(updated.cleared_date) : null,
        bounced_date: updated.bounced_date ? this.formatDate(updated.bounced_date) : null,
        bounced_reason: updated.bounced_reason,
        bounced_fee: this.toMoney(updated.bounced_fee, bookDigits),
        endorsed_to_supplier_id: updated.endorsed_to_supplier_id,
        endorsed_to_supplier_name: updated.endorsed_to_supplier_name,
        flagged_rate_variance: Boolean(updated.flagged_rate_variance),
        registered_exchange_rate: updated.registered_exchange_rate == null ? null : Number(updated.registered_exchange_rate),
        journal_entry_id: updated.journal_entry_id,
        notes: updated.notes,
        created_by: updated.created_by,
        created_at: updated.created_at ? new Date(updated.created_at).toISOString() : '',
        updated_at: updated.updated_at ? new Date(updated.updated_at).toISOString() : '',
      };
    });
  }

  private async syncCustomerSubLedger(
    trx: any,
    auth: AuthContext,
    customerId: number,
    amount: number,
    entryType: string,
    note: string,
    chequeId: number,
  ): Promise<void> {
    const tenantId = String(auth.tenantId || '');
    const accountId = String(auth.accountId || tenantId);
    const updated = await trx
      .updateTable('customers')
      .set({
        balance: sql`COALESCE(balance, 0) + ${amount}`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .returning(['balance'])
      .executeTakeFirst();

    if (!updated) throw new BadRequestException('الشريك لا يتبع المنشأة؛ تم إلغاء العملية بالكامل.');

    const chequeDate = await trx.selectFrom('accounting_cheques').select(['last_action_date', 'issue_date']).where('tenant_id', '=', tenantId).where('id', '=', chequeId).executeTakeFirstOrThrow();
    await trx
      .insertInto('customer_ledger')
      .values({
        customer_id: customerId,
        entry_type: entryType,
        amount: amount,
        // Exact returned balance, never re-rounded: the partner balance
        // is a SQL increment of book-digit amounts, and balance_after
        // must equal it (partner-subledger precedent). toFixed(2)
        // diverged by up to 0.005 on 3-decimal tenants.
        balance_after: Number(updated.balance),
        note: note,
        reference_type: 'pdc_cheque',
        reference_id: chequeId,
        created_at: new Date(chequeDate.last_action_date || chequeDate.issue_date),
        created_by: auth.userId ? Number(auth.userId) : null,
        branch_id: null,
        location_id: null,
        tenant_id: tenantId,
        account_id: accountId,
      })
      .execute();
  }

  private async syncSupplierSubLedger(
    trx: any,
    auth: AuthContext,
    supplierId: number,
    amount: number,
    entryType: string,
    note: string,
    chequeId: number,
  ): Promise<void> {
    const tenantId = String(auth.tenantId || '');
    const accountId = String(auth.accountId || tenantId);
    const updated = await trx
      .updateTable('suppliers')
      .set({
        balance: sql`COALESCE(balance, 0) + ${amount}`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', supplierId)
      .where('tenant_id', '=', tenantId)
      .returning(['balance'])
      .executeTakeFirst();

    if (!updated) throw new BadRequestException('الشريك لا يتبع المنشأة؛ تم إلغاء العملية بالكامل.');

    const chequeDate = await trx.selectFrom('accounting_cheques').select(['last_action_date', 'issue_date']).where('tenant_id', '=', tenantId).where('id', '=', chequeId).executeTakeFirstOrThrow();
    await trx
      .insertInto('supplier_ledger')
      .values({
        supplier_id: supplierId,
        entry_type: entryType,
        amount: amount,
        // Exact returned balance, never re-rounded: see the customer
        // sync above (partner-subledger precedent).
        balance_after: Number(updated.balance),
        note: note,
        reference_type: 'pdc_cheque',
        reference_id: chequeId,
        created_at: new Date(chequeDate.last_action_date || chequeDate.issue_date),
        created_by: auth.userId ? Number(auth.userId) : null,
        branch_id: null,
        location_id: null,
        tenant_id: tenantId,
        account_id: accountId,
      })
      .execute();
  }

  /**
   * Delete cheque record (safe guards prevent deleting settled cheques or cheques with financial postings)
   */
  async deleteCheque(authContext: AuthContext, id: number): Promise<{ success: boolean }> {
    const tenantId = String(authContext.tenantId || '');

    return this.db.transaction().execute(async (trx: any) => {
      const existing = await trx
        .selectFrom('accounting_cheques')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .selectAll()
        .forUpdate()
        .executeTakeFirst();

      if (!existing) {
        throw new NotFoundException('الشيك غير موجود');
      }

      if (['collected', 'cleared', 'endorsed'].includes(existing.status)) {
        throw new BadRequestException('لا يمكن حذف شيك تم تحصيله أو صرفه أو تظهيره، يمكنك إلغاؤه بدلاً من ذلك');
      }

      if (existing.journal_entry_id) {
        throw new BadRequestException('لا يمكن حذف شيك له قيود محاسبية مسجلة، قم بإلغاء الشيك للحفاظ على التسلسل المالي');
      }

      await trx
        .deleteFrom('accounting_cheques')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .execute();

      return { success: true };
    });
  }
}

