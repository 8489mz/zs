import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { AuditService } from '../../../core/audit/audit.service';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { postMaintenanceJournal } from '../maintenance-accounting';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, toMinorUnits } from '../../accounting/engines/money-minor-units.engine';
import { UpsertMaintenanceTicketDto } from '../dto/upsert-maintenance-ticket.dto';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { findSoldSerialSaleId } from './maintenance-helpers';

export class CreateTicketSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly accountingFoundation: AccountingTenantFoundationService,
  ) {}

  async createTicket(payload: UpsertMaintenanceTicketDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const advance = Number(payload.advancePayment || 0);
    if (!Number.isFinite(advance) || advance < 0 || !Number.isFinite(Number(payload.finalCost ?? payload.expectedCost ?? 0)) ||
        Number(payload.finalCost ?? payload.expectedCost ?? 0) < 0 || payload.status === 'delivered') {
      throw new AppError('Invalid maintenance payment or initial state', 'MAINTENANCE_FINANCIAL_STATE_INVALID', 422);
    }
    // An advance larger than the ticket total can never settle at delivery
    // (delivery requires finalCost >= advance), so intake rejects it now
    // instead of bricking the ticket. The total is the final cost when set,
    // otherwise the estimate; an advance with no estimate at all also rejects.
    const ticketTotal = Number(payload.finalCost ?? payload.expectedCost ?? 0);
    if (advance > ticketTotal) {
      throw new AppError(
        `Maintenance advance ${advance} exceeds ticket total ${ticketTotal}; the advance cannot be larger than the ticket total`,
        'MAINTENANCE_ADVANCE_EXCEEDS_ESTIMATE',
        422,
      );
    }
    const advanceDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    try {
      toMinorUnits(advance, advanceDigits);
      toMinorUnits(Number(payload.finalCost ?? payload.expectedCost ?? 0), advanceDigits);
    } catch {
      throw new AppError('Maintenance amounts exceed tenant currency precision', 'MAINTENANCE_CURRENCY_PRECISION_INVALID', 422);
    }
    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const tempTicketNo = `TMP-ZM-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      // Link the ticket to the sale this device was sold under, when
      // the serial matches a SOLD serial (review P2-1: sale_id was a
      // dead column nothing ever wrote). Unknown / unsold serials
      // leave sale_id null silently — the device may come from
      // elsewhere and intake must never fail on it.
      const serial = payload.serialNumber?.trim();
      const saleId = serial ? await findSoldSerialSaleId(trx, scope.tenantId, serial) : null;

      const inserted = await trx
        .insertInto('maintenance_tickets')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          ticket_no: tempTicketNo,
          customer_id: payload.customerId ?? null,
          customer_name: (payload.customerName || (payload as any).name || 'عميل نقدي').trim(),
          customer_phone: (payload.customerPhone || (payload as any).phone || '').trim(),
          device_brand: payload.deviceBrand?.trim() ?? null,
          device_model: (payload.deviceModel || (payload as any).model || 'جهاز عام').trim(),
          serial_number: payload.serialNumber?.trim() ?? null,
          passcode: payload.passcode?.trim() ?? null,
          problem_description: (payload.problemDescription || (payload as any).customerProblem || (payload as any).problem || 'صيانة عامة').trim(),
          device_condition: payload.deviceCondition?.trim() ?? null,
          expected_cost: payload.expectedCost ?? 0,
          final_cost: payload.finalCost ?? payload.expectedCost ?? 0,
          advance_payment: payload.advancePayment ?? 0,
          status: payload.status ?? 'received',
          technician_id: payload.technicianId ?? null,
          technician_name: payload.technicianName?.trim() ?? null,
          technician_notes: payload.technicianNotes?.trim() ?? null,
          branch_id: payload.branchId ?? null,
          location_id: payload.locationId ?? null,
          sale_id: saleId,
          warranty_days: payload.warrantyDays ?? 30,
          received_at: new Date(),
        } as any)
        .returning('id')
        .executeTakeFirst();

      if (!inserted?.id) {
        throw new AppError('تعذر إنشاء تذكرة الصيانة', 'CREATE_TICKET_FAILED', 400);
      }

      const ticketId = Number(inserted.id);
      const ticketNo = formatDailyDocumentNumber('ZM', ticketId, new Date(), 4, await getTenantTimezone(trx, scope.tenantId));

      await trx
        .updateTable('maintenance_tickets')
        .set({ ticket_no: ticketNo })
        .where('id', '=', ticketId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      // If advance payment was made, record cash-in to treasury atomically
      if (payload.advancePayment && Number(payload.advancePayment) > 0) {
        await trx
          .insertInto('treasury_transactions')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            txn_type: 'revenue',
            amount: Number(payload.advancePayment),
            note: `عربون صيانة تذكرة ${ticketNo} - العميل: ${(payload.customerName || '').trim()}`,
            reference_type: 'maintenance_ticket',
            reference_id: ticketId,
            branch_id: payload.branchId ?? null,
            location_id: payload.locationId ?? null,
            created_by: auth.userId ? Number(auth.userId) : null,
          })
          .execute();
        await postMaintenanceJournal(trx, this.accountingFoundation, this.accountingPosting, auth,
          'maintenance_advance', ticketId, payload.branchId ?? null, payload.locationId ?? null, [
            { code: '1110', debit: advance, description: 'Cash received as maintenance customer advance' },
            { code: '2150', credit: advance, description: 'Unearned maintenance customer advance' },
          ]);
      }

      return { id: String(ticketId), ticketNo };
    });

    await this.audit.log('إنشاء تذكرة صيانة', `تم إنشاء تذكرة صيانة ${result.ticketNo} للعميل ${payload.customerName}`, auth);
    return { ok: true, id: result.id, ticketNo: result.ticketNo };
  }
}
