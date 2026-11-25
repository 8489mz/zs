import { tenantBaseCurrency } from '../../accounting-currency';
import { pdcCurrencySnapshot } from '../../pdc-currency';
import { currencyMoneyDigits, toMinorUnits, type MoneyDigits } from '../../engines/money-minor-units.engine';
import { lockAccountingPeriod } from '../../accounting-period-lock';
import { BadRequestException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { Database } from '../../../../database/database.types';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../../accounting-posting.service';
import type { CreatePdcChequeDto, PdcChequeRecord } from './pdc-cheques.types';

export interface CreateChequeBoundDeps {
  toMoney(value: unknown, digits: MoneyDigits): number;
  formatDate(date: any): string;
  syncCustomerSubLedger(
    trx: any,
    auth: AuthContext,
    customerId: number,
    amount: number,
    entryType: string,
    note: string,
    chequeId: number,
  ): Promise<void>;
  syncSupplierSubLedger(
    trx: any,
    auth: AuthContext,
    supplierId: number,
    amount: number,
    entryType: string,
    note: string,
    chequeId: number,
  ): Promise<void>;
}

export class CreateChequeSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly accountingPostingService: AccountingPostingService,
    private readonly bound: CreateChequeBoundDeps,
  ) {}

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private formatDate(date: any): string {
    return this.bound.formatDate(date);
  }

  private syncCustomerSubLedger(
    trx: any,
    auth: AuthContext,
    customerId: number,
    amount: number,
    entryType: string,
    note: string,
    chequeId: number,
  ): Promise<void> {
    return this.bound.syncCustomerSubLedger(trx, auth, customerId, amount, entryType, note, chequeId);
  }

  private syncSupplierSubLedger(
    trx: any,
    auth: AuthContext,
    supplierId: number,
    amount: number,
    entryType: string,
    note: string,
    chequeId: number,
  ): Promise<void> {
    return this.bound.syncSupplierSubLedger(trx, auth, supplierId, amount, entryType, note, chequeId);
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
    const requestedCurrency = String(dto.currency || (await tenantBaseCurrency(this.db, tenantId)))
      .trim()
      .toUpperCase();
    const amount = Number(dto.amount);
    let amountIsMinorExact = Number.isFinite(amount) && amount > 0;
    try {
      if (amountIsMinorExact) toMinorUnits(amount, currencyMoneyDigits(requestedCurrency));
    } catch {
      amountIsMinorExact = false;
    }
    if (!amountIsMinorExact) {
      throw new BadRequestException('مبلغ الشيك يجب أن يكون أكبر من صفر');
    }
    if (!dto.issueDate || !dto.dueDate) {
      throw new BadRequestException('تاريخ التحرير وتاريخ الاستحقاق مطلوبان');
    }

    for (const day of [dto.issueDate, dto.dueDate]) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isFinite(new Date(day).getTime()) ||
        new Date(day).toISOString().slice(0, 10) !== day
      )
        throw new BadRequestException('تاريخ الشيك غير صالح.');
    }
    if (dto.dueDate < dto.issueDate) throw new BadRequestException('الاستحقاق يسبق تحرير الشيك.');
    const type = dto.type === 'payable' ? 'payable' : 'receivable';
    const defaultStatus = type === 'receivable' ? 'in_safe' : 'issued';
    const status = dto.status || defaultStatus;
    if (status !== defaultStatus) throw new BadRequestException('الشيك الجديد يبدأ من حالة الاستلام أو الإصدار فقط.');
    const partnerType = type === 'receivable' ? 'customer' : 'supplier';
    if (dto.partnerType && dto.partnerType !== partnerType)
      throw new BadRequestException('نوع الشريك لا يطابق نوع الشيك.');

    return this.db.transaction().execute(async (trx: any) => {
      await lockAccountingPeriod(trx, tenantId);
      if (!dto.partnerId) {
        const matches = await trx
          .selectFrom(type === 'receivable' ? 'customers' : 'suppliers')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('name', '=', dto.partnerName.trim())
          .where('is_active', '=', true)
          .limit(2)
          .execute();
        if (matches.length !== 1)
          throw new BadRequestException('يجب اختيار عميل أو مورد مسجل وفريد؛ الاسم وحده لا يكفي لربط الشيك.');
        dto = { ...dto, partnerId: Number(matches[0].id) };
      }
      if (
        dto.partnerId &&
        !(await trx
          .selectFrom(type === 'receivable' ? 'customers' : 'suppliers')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', Number(dto.partnerId))
          .executeTakeFirst())
      )
        throw new BadRequestException('الشريك لا يتبع المنشأة.');
      if (
        dto.depositBankId &&
        !(await trx
          .selectFrom('accounting_accounts')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', dto.depositBankId)
          .where('is_active', '=', true)
          .where('is_cash_bank', '=', true)
          .where('code', 'not in', ['1121', '1122'])
          .executeTakeFirst())
      )
        throw new BadRequestException('حساب البنك لا يتبع المنشأة أو غير صالح.');
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
        registered_exchange_rate:
          inserted.registered_exchange_rate == null ? null : Number(inserted.registered_exchange_rate),
        journal_entry_id: journalEntryId,
        notes: inserted.notes,
        created_by: inserted.created_by,
        created_at: inserted.created_at ? new Date(inserted.created_at).toISOString() : '',
        updated_at: inserted.updated_at ? new Date(inserted.updated_at).toISOString() : '',
      };
    });
  }
}
