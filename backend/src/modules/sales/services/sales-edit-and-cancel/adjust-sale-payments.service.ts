import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { TransactionHelper } from '../../../../database/helpers/transaction.helper';
import { AppError } from '../../../../common/errors/app-error';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../../core/audit/audit.service';
import { AdjustSalePaymentsDto } from '../../dto/adjust-sale-payments.dto';
import { assertSaleNotZatcaSigned } from '../../../tax-integration/services/zatca/zatca-invoice-status';
import { diffContributions, tripSaleContribution } from '../../../../common/utils/van-trip-counters.engine';
import { currencyMoneyDigits, roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { AccountingPostingService } from '../../../accounting/accounting-posting.service';
import { SalesAuthorizationService } from '../sales-authorization.service';
import { SalesFinanceService } from '../sales-finance.service';
import { SalesQueryService } from '../sales-query.service';
import {
  calculateCollectibleTotal,
  calculateRemainingDebt,
  paidAmountExceedsRecordedPayments,
  resolvePostedSalePaymentChannel,
} from '../../helpers/sales-write.helper';
import { formatCreditLimitExceededMessage } from '../credit-limit-message';
import { lockOpenTripRow, applyTripCounterDelta } from './sales-edit-and-cancel-types';
import type { PreparedWasteAndShiftRefreshService } from './prepared-waste-and-shift-refresh.service';

export class AdjustSalePaymentsService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly authz: SalesAuthorizationService,
    private readonly finance: SalesFinanceService,
    private readonly query: SalesQueryService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly refreshClosedShiftForPostCloseChange: PreparedWasteAndShiftRefreshService['refreshClosedShiftForPostCloseChange'],
  ) {}

  /**
   * INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: the ONLY writer of
   * sale_payments after posting, besides the original sale insert.
   *
   * updateSale never touches the legs anymore, so a money correction
   * comes here: the caller sends the COMPLETE new leg set, a reason,
   * and a manager PIN (non-admins). The method replaces the legs, moves
   * the sale row's money fields to match, mirrors updateSale's
   * customer-ledger / treasury / trip-counter deltas, and reuses
   * postSaleEdit — the same reversal helper updateSale uses — so the
   * old journal is reversed and one new sale_edit journal is posted
   * in the same transaction. No second journal path exists.
   *
   * Validation: the new legs must not overpay the collectible total
   * (an overpaid journal would not balance); underpayment is allowed
   * and stays a receivable, exactly as in updateSale. Same-channel
   * legs are merged into one row, like the tender allocation does.
   *
   * Interaction (recorded): the posted journal is a sale_edit journal,
   * so this consumes the sale's single-edit allowance — a later
   * updateSale is refused with SALE_EDIT_ALREADY_APPLIED. Item edits
   * must come BEFORE the payment adjustment, or the sale must be
   * re-created. Multiple adjustments in a row work (each reverses the
   * latest active journal).
   */
  async adjustSalePayments(
    saleId: number,
    payload: AdjustSalePaymentsDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const reason = String(payload?.reason || '').trim();
    const managerPin = String(payload?.managerPin || '').trim();
    if (!reason) throw new AppError('سبب تعديل الدفعات مطلوب.', 'PAYMENT_ADJUSTMENT_REASON_REQUIRED', 400);
    const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
    if (!isAdmin && !managerPin)
      throw new AppError('رمز اعتماد المدير مطلوب قبل تعديل دفعات الفاتورة.', 'MANAGER_AUTH_REQUIRED', 400);
    if (!isAdmin || managerPin) await this.authz.authorizeDiscountOverride(managerPin, auth, this.db);

    const validChannels = ['cash', 'card', 'wallet', 'instapay'] as const;
    const mergedLegs = new Map<string, number>();
    for (const leg of payload.payments || []) {
      const channel = String(leg?.paymentChannel || '').trim();
      const amount = Number(leg?.amount || 0);
      if (!validChannels.includes(channel as (typeof validChannels)[number])) {
        throw new AppError(`قناة دفع غير صالحة (${channel || 'غير مسجلة'})`, 'INVALID_PAYMENT_CHANNEL', 400);
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new AppError('مبلغ الدفعة يجب أن يكون أكبر من صفر', 'INVALID_PAYMENT_AMOUNT', 400);
      }
      mergedLegs.set(channel, (mergedLegs.get(channel) || 0) + amount);
    }
    const newLegs = [...mergedLegs.entries()].map(([paymentChannel, amount]) => ({
      paymentChannel: paymentChannel as 'cash' | 'card' | 'wallet' | 'instapay',
      amount,
    }));

    let postCloseEdit = false;
    let postCloseShiftId: number | null = null;
    let remainingReceivable = 0;
    await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const sale = await trx
        .selectFrom('sales')
        .selectAll()
        .where('id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();
      if (!sale) throw new AppError('الفاتورة غير موجودة.', 'SALE_NOT_FOUND', 404);
      if (sale.exchange_return_id)
        throw new AppError('فاتورة استبدال مترابطة؛ استخدم مرتجعاً بدلاً من تعديلها', 'EXCHANGE_IMMUTABLE', 422);
      if (sale.status !== 'posted')
        throw new AppError('لا يمكن تعديل دفعات فاتورة غير مرحّلة أو ملغاة.', 'SALE_EDIT_STATUS_FORBIDDEN', 400);
      assertSaleNotZatcaSigned(sale.zatca_status);
      // One-edit allowance: this posts a sale_edit journal, exactly
      // like updateSale — a second money edit of the same sale is
      // refused here too, not silently stacked.
      const existingEditedJournal = await trx
        .selectFrom('journal_entries')
        .select(['id'])
        .where('source_type', '=', 'sale_edit')
        .where('source_id', '=', saleId)
        .where('status', 'in', ['draft', 'posted'])
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (existingEditedJournal) {
        throw new AppError(
          'تم تعديل هذه الفاتورة سابقًا. أنشئ فاتورة جديدة بدلًا من إعادة التعديل.',
          'SALE_EDIT_ALREADY_APPLIED',
          400,
        );
      }
      // A later receipt stays attached to the original debt (same guard
      // as updateSale): changing the legs under it would orphan it.
      const laterAllocation = await trx
        .selectFrom('payment_allocations')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('invoice_type', '=', 'sale')
        .where('invoice_id', '=', saleId)
        .limit(1)
        .executeTakeFirst();
      if (laterAllocation) {
        throw new AppError(
          'الفاتورة عليها سند قبض مخصص؛ يلزم مستند تصحيح بدلاً من تعديلها',
          'SALE_EDIT_HAS_LATER_PAYMENTS',
          422,
        );
      }
      const currentPayments = await trx
        .selectFrom('sale_payments')
        .select(['amount', 'payment_channel'])
        .where('sale_id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      if (
        currentPayments.length > 0 &&
        paidAmountExceedsRecordedPayments(currentPayments, sale.paid_amount, moneyDigits)
      ) {
        throw new AppError(
          'الفاتورة عليها تحصيلات إضافية لا يمكن عكسها بتعديل الدفعات',
          'SALE_EDIT_PAYMENT_RECONCILIATION_REQUIRED',
          409,
        );
      }
      if (currentPayments.length === 0 && Number(sale.paid_amount || 0) > 0 && sale.payment_channel === 'mixed') {
        throw new AppError(
          'لا يمكن تعديل دفعات فاتورة قديمة ذات سداد مختلط دون تفاصيل وسائل الدفع',
          'SALE_EDIT_PAYMENT_RECONCILIATION_REQUIRED',
          409,
        );
      }

      // Post-close shift handling, same as updateSale: an OPEN shift
      // belonging to another cashier still blocks the change; a closed
      // original shift is refreshed below (never restated).
      const shiftBase = trx
        .selectFrom('cashier_shifts')
        .select(['id', 'opened_by', 'status'])
        .where('tenant_id', '=', scope.tenantId)
        .where('opened_by', '=', Number(sale.created_by || 0))
        .where('created_at', '<=', sale.created_at)
        .where((eb) => eb.or([eb('closed_at', 'is', null), eb('closed_at', '>=', sale.created_at)]));
      const originalShift = await (
        sale.branch_id == null
          ? shiftBase.where('branch_id', 'is', null)
          : shiftBase.where('branch_id', '=', sale.branch_id)
      )
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirst();
      postCloseEdit = originalShift ? String(originalShift.status || '') !== 'open' : false;
      postCloseShiftId = postCloseEdit && originalShift ? Number(originalShift.id) : null;
      if (originalShift && !postCloseEdit && Number(originalShift.opened_by) !== auth.userId) {
        throw new AppError(
          'لا يمكن تعديل دفعات فاتورة تخص وردية مقفولة أو وردية كاشير آخر؛ استخدم مستند مرتجع أو تسوية',
          'SALE_EDIT_ORIGINAL_SHIFT_LOCKED',
          422,
        );
      }

      const tripId = Number(sale.van_trip_id || 0) || null;
      const tripOpen = tripId ? await lockOpenTripRow(trx, scope.tenantId, tripId) : false;

      const collectibleTotal = calculateCollectibleTotal(
        Number(sale.total || 0),
        Number(sale.store_credit_used || 0),
        moneyDigits,
      );
      const newPaid = roundMoney(
        newLegs.reduce((sum, leg) => sum + leg.amount, 0),
        moneyDigits,
      );
      const paymentTolerance = 1 / 10 ** moneyDigits;
      if (newPaid > collectibleTotal + paymentTolerance) {
        throw new AppError(
          `مجموع الدفعات الجديدة (${newPaid}) يتجاوز إجمالي الفاتورة المستحق (${collectibleTotal}) — لا يمكن تسجيل دفعة أكبر من الفاتورة`,
          'SALE_PAYMENT_ADJUSTMENT_OVERPAID',
          400,
        );
      }
      remainingReceivable = roundMoney(Math.max(0, collectibleTotal - newPaid), moneyDigits);

      const customer = sale.customer_id
        ? await trx
            .selectFrom('customers')
            .select(['id', 'name', 'balance', 'credit_limit', 'is_credit_blocked'])
            .where('id', '=', Number(sale.customer_id))
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .forUpdate()
            .executeTakeFirst()
        : null;
      if (remainingReceivable > 0 && customer) {
        if (
          Number(customer.balance || 0) + remainingReceivable > Number(customer.credit_limit || 0) + 0.001 &&
          Number(customer.credit_limit || 0) > 0
        ) {
          throw new AppError(
            formatCreditLimitExceededMessage({
              creditLimit: Number(customer.credit_limit || 0),
              currentBalance: Number(customer.balance || 0),
              requestedAmount: remainingReceivable,
              digits: moneyDigits,
            }),
            'CUSTOMER_CREDIT_LIMIT',
            400,
          );
        }
        if (customer.is_credit_blocked)
          throw new AppError('Customer credit is blocked', 'CUSTOMER_CREDIT_BLOCKED', 400);
      }

      // Reverse the OLD money side, exactly like updateSale: the old
      // receivable (if any) and the old cash treasury legs.
      const oldPaid = currentPayments.length
        ? currentPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
        : Number(sale.paid_amount || 0);
      const oldDebt = calculateRemainingDebt(collectibleTotal, oldPaid, moneyDigits);
      if (sale.customer_id && oldDebt > 0) {
        await this.finance.createCustomerLedgerEntry(
          trx,
          sale.customer_id,
          -oldDebt,
          `عكس تعديل دفعات فاتورة بيع S-${saleId}`,
          saleId,
          auth,
        );
      }
      for (const payment of currentPayments) {
        if (payment.payment_channel !== 'cash') continue;
        await this.finance.addTreasuryTransaction(
          trx,
          -Number(payment.amount || 0),
          `عكس تعديل دفعات فاتورة بيع S-${saleId}`,
          saleId,
          auth,
          sale.branch_id,
          sale.location_id,
        );
      }

      // Replace the legs: the only deleteFrom/insert of sale_payments
      // outside the original sale insert in the whole codebase.
      await trx
        .deleteFrom('sale_payments')
        .where('sale_id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      for (const leg of newLegs) {
        await trx
          .insertInto('sale_payments')
          .values({
            sale_id: saleId,
            payment_channel: leg.paymentChannel,
            amount: roundMoney(leg.amount, moneyDigits),
            applied_amount: roundMoney(leg.amount, moneyDigits),
            tendered_amount: roundMoney(leg.amount, moneyDigits),
            change_amount: 0,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          })
          .execute();
      }

      // The sale row follows the new legs: the type flips to 'credit'
      // only when a receivable remains (mirroring updateSale's partial-
      // credit flip); otherwise the stored type stays. The channel is
      // re-derived from the new legs only when the channel mix actually
      // changed — otherwise the stored channel stays (a 'mixed' or
      // split-sale channel must not collapse to a single leg's channel
      // just because the amounts moved).
      const newPaymentType = remainingReceivable > paymentTolerance ? 'credit' : String(sale.payment_type || 'cash');
      const oldChannels = new Set(currentPayments.map((p) => String(p.payment_channel || '')));
      const newChannels = new Set(newLegs.map((l) => l.paymentChannel));
      const channelsChanged =
        oldChannels.size !== newChannels.size || [...newChannels].some((c) => !oldChannels.has(c));
      const newPaymentChannel =
        remainingReceivable > paymentTolerance || channelsChanged
          ? resolvePostedSalePaymentChannel(
              newPaymentType === 'credit' ? 'credit' : 'cash',
              newLegs.map((leg) => ({ paymentChannel: leg.paymentChannel as 'cash' | 'card' | 'wallet' | 'instapay' })),
            )
          : String(sale.payment_channel || 'cash');
      await trx
        .updateTable('sales')
        .set({
          payment_type: newPaymentType,
          payment_channel: newPaymentChannel,
          paid_amount: newPaid,
          applied_amount: newPaid,
          tendered_amount: newPaid,
          change_amount: 0,
          updated_at: sql`NOW()`,
        } as any)
        .where('id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      // Post the NEW money side, mirroring updateSale.
      if (customer && remainingReceivable > 0) {
        await this.finance.createCustomerLedgerEntry(
          trx,
          customer.id,
          remainingReceivable,
          `تعديل دفعات فاتورة بيع S-${saleId} (متبقي آجل)`,
          saleId,
          auth,
        );
      } else if (customer && remainingReceivable === 0) {
        const settled = roundMoney(collectibleTotal - remainingReceivable, moneyDigits);
        if (settled > 0) {
          await this.finance.addCustomerLedgerLeg(
            trx,
            customer.id,
            settled,
            'sale_paid',
            `تعديل دفعات فاتورة بيع S-${saleId}`,
            'sale',
            saleId,
            auth,
          );
          await this.finance.addCustomerPaymentLedgerEntry(
            trx,
            customer.id,
            -settled,
            `سداد تعديل دفعات فاتورة بيع S-${saleId}`,
            'sale',
            saleId,
            auth,
            sale.branch_id,
            sale.location_id,
          );
        }
      }
      for (const leg of newLegs) {
        if (leg.paymentChannel !== 'cash') continue;
        await this.finance.addTreasuryTransaction(
          trx,
          leg.amount,
          `تعديل دفعات فاتورة بيع S-${saleId}`,
          saleId,
          auth,
          sale.branch_id,
          sale.location_id,
        );
      }

      // The trip counters move with the legs, same delta as updateSale.
      if (tripOpen && tripId) {
        let oldLedgerCredit: number | null = null;
        if (String(sale.payment_channel || '').toLowerCase() === 'mixed') {
          const ledgerRow = await trx
            .selectFrom('customer_ledger')
            .select('amount')
            .where('reference_type', '=', 'sale')
            .where('reference_id', '=', saleId)
            .where('entry_type', '=', 'sale_credit')
            .where('tenant_id', '=', scope.tenantId)
            .orderBy('id', 'desc')
            .executeTakeFirst();
          oldLedgerCredit = ledgerRow ? Number(ledgerRow.amount || 0) : null;
        }
        const oldContribution = tripSaleContribution({
          total: sale.total,
          paidAmount: sale.paid_amount,
          paymentChannel: sale.payment_channel,
          payments: currentPayments,
          ledgerCreditAmount: oldLedgerCredit ?? undefined,
        });
        const newContribution = tripSaleContribution({
          total: sale.total,
          paidAmount: newPaid,
          paymentChannel: newPaymentChannel,
          payments: newLegs.map((leg) => ({ amount: leg.amount, payment_channel: leg.paymentChannel })),
        });
        await applyTripCounterDelta(trx, scope.tenantId, tripId, diffContributions(newContribution, oldContribution));
      }

      if (postCloseEdit) {
        await trx
          .insertInto('pos_audit_events')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            event_type: 'sale_payment_adjustment_post_close',
            user_id: auth.userId,
            sale_id: saleId,
            product_id: null,
            amount: Number(sale.total || 0),
            reason,
            metadata: { postClose: true, originalShiftId: postCloseShiftId, managerApproved: true },
          })
          .execute();
      }

      // Reuse the existing reversal helper — no second journal path.
      await this.accountingPosting.postSaleEdit(trx, saleId, auth, reason);

      if (postCloseEdit && postCloseShiftId) {
        await this.refreshClosedShiftForPostCloseChange(trx, postCloseShiftId, saleId, 'edit', reason, auth);
      }
    });

    await this.audit.log(
      'تعديل دفعات فاتورة بيع',
      `تم تعديل دفعات الفاتورة S-${saleId} بواسطة ${auth.username} | السبب: ${reason}${postCloseEdit ? ` | تعديل بعد إغلاق الوردية الأصلية #${postCloseShiftId}` : ''}`,
      auth,
    );
    const sale = await this.query.getSaleById(saleId, auth);
    return { ok: true, sale: sale.sale, remainingReceivable };
  }
}
