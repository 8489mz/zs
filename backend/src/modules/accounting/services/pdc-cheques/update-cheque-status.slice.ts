import { tenantBaseCurrency } from '../../accounting-currency';
import { resolveBusinessDateKey } from '../../engines/accounting-date.engine';
import { assertPdcTransition, pdcBookAmount } from '../../engines/pdc-transition.engine';
import { pdcCurrencySnapshot } from '../../pdc-currency';
import { currencyMoneyDigits, toMinorUnits, type MoneyDigits } from '../../engines/money-minor-units.engine';
import { lockAccountingPeriod } from '../../accounting-period-lock';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from '../../../../database/database.types';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../../accounting-posting.service';
import type { UpdateChequeStatusDto, PdcChequeRecord } from './pdc-cheques.types';

export interface UpdateChequeStatusBoundDeps {
  toMoney(value: unknown, digits: MoneyDigits): number;
  formatDate(date: any): string;
  syncCustomerSubLedger(trx: any, auth: AuthContext, customerId: number, amount: number, entryType: string, note: string, chequeId: number): Promise<void>;
  syncSupplierSubLedger(trx: any, auth: AuthContext, supplierId: number, amount: number, entryType: string, note: string, chequeId: number): Promise<void>;
}

export class UpdateChequeStatusSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly accountingPostingService: AccountingPostingService,
    private readonly bound: UpdateChequeStatusBoundDeps,
  ) {}

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private formatDate(date: any): string {
    return this.bound.formatDate(date);
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
    return this.bound.syncCustomerSubLedger(trx, auth, customerId, amount, entryType, note, chequeId);
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
    return this.bound.syncSupplierSubLedger(trx, auth, supplierId, amount, entryType, note, chequeId);
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
      const today = await resolveBusinessDateKey(trx, tenantId, new Date());
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
      const updateFields: Record<string, any> = {
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
}
