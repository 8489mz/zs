import { Kysely } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { postMaintenanceJournal } from '../maintenance-accounting';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, toMinorUnits } from '../../accounting/engines/money-minor-units.engine';
import { UpdateTicketStatusDto } from '../dto/update-ticket-status.dto';
import { computeWarrantyEnd, resolveQuoteFields, assertInProgressQuoteAllowed } from './maintenance-helpers';

export interface UpdateTicketStatusSliceBoundDeps {
  isExactMaintenanceSettlement: (remaining: number, advance: number, total: number, digits: 2 | 3) => boolean;
}

export class UpdateTicketStatusSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly accountingFoundation: AccountingTenantFoundationService,
    private readonly bound: UpdateTicketStatusSliceBoundDeps,
  ) {}

  private isExactMaintenanceSettlement(remaining: number, advance: number, total: number, digits: 2 | 3): boolean {
    return this.bound.isExactMaintenanceSettlement(remaining, advance, total, digits);
  }

  async updateTicketStatus(id: number, payload: UpdateTicketStatusDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const existing = await this.tx.runInTransaction(this.db, async (trx) => {
      const ticket = await trx
        .selectFrom('maintenance_tickets')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();

      if (!ticket) {
        throw new AppError('تذكرة الصيانة غير موجودة', 'TICKET_NOT_FOUND', 404);
      }

      // The ticket row lock serializes delivery retries and cash collection.
      if (ticket.delivered_at && (payload.status !== 'delivered' ||
          payload.finalCost !== undefined || payload.collectedAmount !== undefined)) {
        throw new AppError('Delivered maintenance cannot be revised', 'MAINTENANCE_REVERSAL_REQUIRED', 409);
      }
      if (payload.collectedAmount !== undefined && (!Number.isFinite(Number(payload.collectedAmount)) || Number(payload.collectedAmount) < 0)) {
        throw new AppError('Invalid maintenance collection', 'INVALID_MAINTENANCE_COLLECTION', 400);
      }
      if (payload.finalCost !== undefined && (!Number.isFinite(Number(payload.finalCost)) || Number(payload.finalCost) < 0)) {
        throw new AppError('Invalid maintenance final cost', 'INVALID_MAINTENANCE_COST', 400);
      }
      if (ticket.status === 'delivered' &&
          (payload.status !== 'delivered' ||
           (payload.finalCost !== undefined && Number(payload.finalCost) !== Number(ticket.final_cost)) ||
           (payload.collectedAmount !== undefined && Number(payload.collectedAmount) > 0))) {
        throw new AppError('Delivered maintenance cannot be rebooked without reversal', 'MAINTENANCE_REVERSAL_REQUIRED', 409);
      }
      const terminal = ['cancelled', 'unrepairable'];
      if (terminal.includes(ticket.status) && payload.status !== ticket.status) {
        throw new AppError('Cancelled maintenance cannot be reopened without a new source document',
          'MAINTENANCE_REVERSAL_REQUIRED', 409);
      }
      if (payload.refundAdvance && (!terminal.includes(payload.status) ||
          payload.finalCost !== undefined || payload.collectedAmount !== undefined ||
          Number(ticket.advance_payment || 0) <= 0)) {
        throw new AppError('Explicit cash refund is valid only when cancelling a ticket with an advance',
          'MAINTENANCE_REFUND_STATE_INVALID', 422);
      }
      if (terminal.includes(payload.status) && ticket.status !== payload.status) {
        const part = await trx.selectFrom('maintenance_ticket_parts').select('id')
          .where('tenant_id', '=', scope.tenantId).where('ticket_id', '=', id).executeTakeFirst();
        if (part || (Number(ticket.advance_payment || 0) > 0 && !payload.refundAdvance)) {
          throw new AppError('Return all consumed parts and explicitly refund cash advance before cancellation',
            'MAINTENANCE_REVERSAL_REQUIRED', 409);
        }
      }
      if (payload.refundAdvance && ticket.status === payload.status) {
        // A repeated cancellation is an idempotent acknowledgement only when
        // the first refund was actually committed, not merely a status change.
        const previousRefund = await trx.selectFrom('treasury_transactions').select('id')
          .where('tenant_id', '=', scope.tenantId).where('reference_type', '=', 'maintenance_advance_refund')
          .where('reference_id', '=', id).executeTakeFirst();
        if (!previousRefund) throw new AppError('Historical cancellation has no verified refund',
          'MAINTENANCE_REFUND_RECONCILIATION_REQUIRED', 409);
      }
      // Diagnosis / quote (review P2-5): the technician records the
      // finding + quoted cost during 'inspecting' on this same call,
      // and the customer approval is an explicit flag — never inferred
      // from the status change. Moving to in_progress needs an approved
      // quote whenever a quoted cost exists; quick jobs with no quote
      // proceed without approval.
      const quote = resolveQuoteFields(
        payload,
        ticket,
        auth.userId ? Number(auth.userId) : null,
      );
      assertInProgressQuoteAllowed(payload.status, ticket.status, quote.effectiveQuotedCost, quote.effectiveApproved);
      const updates: Record<string, any> = {
        status: payload.status,
        updated_at: new Date(),
      };
      Object.assign(updates, quote.updates);

      if (payload.finalCost !== undefined) {
        updates.final_cost = payload.finalCost;
      }
      if (payload.technicianNotes !== undefined) {
        updates.technician_notes = payload.technicianNotes;
      }
      if (payload.status === 'repaired' && !ticket.repaired_at) {
        // First repair sets the warranty clock: repaired_at +
        // the then-current warranty_days. Editing warrantyDays
        // before repair is picked up automatically (read here, not
        // at intake); a later repair transition never recomputes.
        const repairedAt = new Date();
        updates.repaired_at = repairedAt;
        updates.warranty_end = computeWarrantyEnd(repairedAt, Number(ticket.warranty_days ?? 30));
      }
      if (payload.status === 'delivered' && !ticket.delivered_at) {
        updates.delivered_at = new Date();
      }

      await trx
        .updateTable('maintenance_tickets')
        .set(updates)
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', id)
        .execute();

      // The explicit cash-only cancellation returns a cash advance and reverses
      // its unearned-revenue liability under the same ticket lock and DB transaction.
      // Tickets with issued parts must first use the existing costed return path.
      if (payload.refundAdvance && terminal.includes(payload.status) && ticket.status !== payload.status) {
        const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
        const advance = Number(ticket.advance_payment || 0);
        const sourceReceipt = await trx.selectFrom('treasury_transactions')
          .select(['id', 'amount', 'txn_type'])
          .where('tenant_id', '=', scope.tenantId)
          .where('reference_type', '=', 'maintenance_ticket').where('reference_id', '=', id)
          .execute();
        const sourceJournal = await trx.selectFrom('journal_entries').select('id')
          .where('tenant_id', '=', scope.tenantId).where('source_type', '=', 'maintenance_advance')
          .where('source_id', '=', id).where('status', '=', 'posted')
          .where('reversed_by_entry_id', 'is', null).executeTakeFirst();
        const priorRefund = await trx.selectFrom('treasury_transactions').select('id')
          .where('tenant_id', '=', scope.tenantId)
          .where('reference_type', '=', 'maintenance_advance_refund').where('reference_id', '=', id)
          .executeTakeFirst();
        if (sourceReceipt.length !== 1 || sourceReceipt[0].txn_type !== 'revenue' ||
            toMinorUnits(Number(sourceReceipt[0].amount), digits) !== toMinorUnits(advance, digits) ||
            !sourceJournal || priorRefund) {
          throw new AppError('Cannot refund an unverified or already-refunded maintenance advance',
            'MAINTENANCE_REFUND_RECONCILIATION_REQUIRED', 409);
        }
        await trx.insertInto('treasury_transactions').values({
          tenant_id: scope.tenantId, account_id: scope.accountId,
          txn_type: 'expense', amount: -advance, payment_channel: 'cash',
          note: `رد عربون صيانة تذكرة ${ticket.ticket_no} بعد الإلغاء`,
          reference_type: 'maintenance_advance_refund', reference_id: id,
          branch_id: ticket.branch_id ? Number(ticket.branch_id) : null,
          location_id: ticket.location_id ? Number(ticket.location_id) : null,
          created_by: auth.userId ? Number(auth.userId) : null,
        }).execute();
        await postMaintenanceJournal(trx, this.accountingFoundation, this.accountingPosting, auth,
          'maintenance_advance_refund', id,
          ticket.branch_id ? Number(ticket.branch_id) : null,
          ticket.location_id ? Number(ticket.location_id) : null, [
            { code: '2150', debit: advance, description: 'Refund previously unearned maintenance advance' },
            { code: '1110', credit: advance, description: 'Cash refund of maintenance customer advance' },
          ]);
      }

      // When status changes to delivered, collect remaining balance into treasury
      if (payload.status === 'delivered' && ticket.status !== 'delivered') {
        const finalCost = payload.finalCost !== undefined ? Number(payload.finalCost) : Number(ticket.final_cost || ticket.expected_cost || 0);
        const advance = Number(ticket.advance_payment || 0);
        const remaining = payload.collectedAmount !== undefined
          ? Number(payload.collectedAmount)
          : Math.max(0, finalCost - advance);
        // A final agreed amount below the advance already collected is a
        // distinct, specific failure: the ticket can never settle, and the
        // operator must fix the amount (or refund) instead of seeing the
        // generic exact-settlement message. Checked before the generic
        // settlement check below so the specific code always wins.
        if (finalCost < advance) {
          throw new AppError(
            `Maintenance final cost ${finalCost} is below the advance already collected ${advance}; the final agreed amount cannot be less than the advance`,
            'MAINTENANCE_FINAL_BELOW_ADVANCE',
            422,
          );
        }
        if (!Number.isFinite(finalCost) || !Number.isFinite(advance) ||
            !Number.isFinite(remaining) || finalCost < 0 ||
            remaining < 0 || !this.isExactMaintenanceSettlement(remaining, advance, finalCost, currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId)))) {
          throw new AppError('Maintenance delivery must settle its full balance; refund/credit requires a separate flow',
            'MAINTENANCE_SETTLEMENT_MISMATCH', 422);
        }
        const nonCash = ['card', 'wallet', 'instapay'].includes(payload.paymentMethod || '');
        if (remaining > 0) {
          await trx
            .insertInto('treasury_transactions')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              txn_type: 'revenue',
              amount: remaining,
              payment_channel: nonCash ? payload.paymentMethod as 'card' | 'wallet' | 'instapay' : 'cash',
              note: `تحصيل صيانة وتسليم جهاز ${ticket.ticket_no} - العميل: ${ticket.customer_name}`,
              reference_type: 'maintenance_ticket',
              reference_id: Number(ticket.id),
              branch_id: ticket.branch_id ? Number(ticket.branch_id) : null,
              location_id: ticket.location_id ? Number(ticket.location_id) : null,
              created_by: auth.userId ? Number(auth.userId) : null,
            })
            .execute();
        }
        if (finalCost > 0) {
          await postMaintenanceJournal(trx, this.accountingFoundation, this.accountingPosting, auth,
            'maintenance_delivery', id,
            ticket.branch_id ? Number(ticket.branch_id) : null,
            ticket.location_id ? Number(ticket.location_id) : null, [
              { code: '2150', debit: advance, description: 'Apply maintenance customer advance' },
              { code: nonCash ? '1120' : '1110', debit: remaining, description: 'Maintenance final settlement' },
              { code: '4200', credit: finalCost, description: 'Earned maintenance service revenue' },
            ]);
        }
      }

      return ticket;
    });

    const statusLabels: Record<string, string> = {
      received: 'تم الاستلام',
      inspecting: 'قيد الفحص والتسعير',
      in_progress: 'قيد الصيانة والإصلاح',
      waiting_parts: 'بانتظار قطع الغيار',
      repaired: 'تم الإصلاح وجاهز للتسليم',
      delivered: 'تم التسليم للعميل',
      unrepairable: 'غير قابل للإصلاح',
      cancelled: 'ملغاة',
      canceled: 'ملغاة',
    };
    const statusLabel = statusLabels[payload.status] || payload.status;
    await this.audit.log('تحديث حالة التذكرة', `تم تغيير حالة التذكرة ${existing.ticket_no} إلى "${statusLabel}"`, auth);
    return { ok: true };
  }
}
