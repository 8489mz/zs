import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { UpsertMaintenanceTicketDto } from '../dto/upsert-maintenance-ticket.dto';
import { isFinancialTicketChange, buildNonFinancialTicketUpdate } from './maintenance-helpers';

export class UpdateTicketSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
  ) {}

  async updateTicket(id: number, payload: UpsertMaintenanceTicketDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const ticketNo = await this.tx.runInTransaction(this.db, async (trx) => {
      const existing = await trx
        .selectFrom('maintenance_tickets')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();

      if (!existing) {
        throw new AppError('تذكرة الصيانة غير موجودة', 'TICKET_NOT_FOUND', 404);
      }

      // D-M2-1: delivered tickets stay FULLY frozen — any edit needs
      // the reversal flow, exactly as before.
      if (existing.status === 'delivered') {
        throw new AppError(
          'Posted maintenance ticket requires settlement document',
          'MAINTENANCE_REVERSAL_REQUIRED',
          409,
        );
      }
      // Financial fields still require the reversal flow when the
      // payload tries to CHANGE them versus the stored ticket.
      if (isFinancialTicketChange(payload, existing)) {
        throw new AppError(
          'Posted ticket amounts and status require an audited reversal flow',
          'MAINTENANCE_REVERSAL_REQUIRED',
          409,
        );
      }
      // Non-financial corrections (name/phone, brand/model, serial,
      // problem, condition, technician, branch/location, warrantyDays)
      // are allowed even after an advance was taken or parts issued —
      // the old blanket block made even a phone-number typo
      // unfixable (review P2-2). Omitted fields keep stored values.
      await trx
        .updateTable('maintenance_tickets')
        .set(buildNonFinancialTicketUpdate(payload, existing))
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', id)
        .execute();

      return existing.ticket_no;
    });

    await this.audit.log('تعديل تذكرة صيانة', `تم تحديث بيانات تذكرة الصيانة ${ticketNo}`, auth);
    return { ok: true };
  }
}
