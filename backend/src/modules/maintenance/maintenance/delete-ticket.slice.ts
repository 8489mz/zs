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
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { valueStockReceipt } from '../../accounting/inventory-valuation';
import { recordStockMovement } from '../../../common/utils/stock-movement-writer';

export class DeleteTicketSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly accountingFoundation: AccountingTenantFoundationService,
  ) {}

  async deleteTicket(id: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const partsCount = await this.tx.runInTransaction(this.db, async (trx) => {
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

      const historicalMovement = await trx
        .selectFrom('stock_movements')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('reference_type', '=', 'maintenance_ticket')
        .where('reference_id', '=', id)
        .executeTakeFirst();
      const cashMovement = await trx
        .selectFrom('treasury_transactions')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('reference_type', '=', 'maintenance_ticket')
        .where('reference_id', '=', id)
        .executeTakeFirst();
      if (Number(ticket.advance_payment) > 0 || ticket.status === 'delivered' || cashMovement) {
        throw new AppError(
          'لا يمكن حذف تذكرة صيانة مسلّمة أو تم تحصيل مبالغ مالية لها؛ يجب عمل تسوية أو إلغاء مالي',
          'MAINTENANCE_REVERSAL_REQUIRED',
          409,
        );
      }
      const parts = await trx
        .selectFrom('maintenance_ticket_parts')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('ticket_id', '=', id)
        .execute();

      for (const part of parts) {
        const returnQty = Number(part.qty);
        const targetLocationId = part.location_id
          ? Number(part.location_id)
          : ticket.location_id
            ? Number(ticket.location_id)
            : null;
        let targetBranchId = ticket.branch_id ? Number(ticket.branch_id) : null;

        // Same branch derivation as addPart (see there): deleting a
        // branchless ticket returns each part to its location, and a
        // null branch here would NULL the location row's branch_id
        // via updateBalanceQty. Never overrides an explicit ticket branch.
        if (targetLocationId !== null && targetBranchId === null) {
          const locationRow = await trx
            .selectFrom('product_location_stock')
            .select('branch_id')
            .where('tenant_id', '=', scope.tenantId)
            .where('account_id', '=', scope.accountId)
            .where('product_id', '=', Number(part.product_id))
            .where('location_id', '=', targetLocationId)
            .executeTakeFirst();
          if (locationRow?.branch_id != null) {
            targetBranchId = Number(locationRow.branch_id);
          }
        }

        // Phase 1 A9 (INV-PHASE1-A9-REMAINING-WRITER): the return goes
        // through the row-writer first, then valueStockReceipt uses the
        // returned globalAfter — same transaction, so a throw still
        // rolls the row back. moneyDigits resolves once and feeds both
        // the stockValue computation and the writer; the writer's total
        // is the same roundMoney(unit_cost * returnQty, moneyDigits).
        const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
        const stockValue = roundMoney(Number(part.unit_cost || 0) * returnQty, moneyDigits);
        const movement = await recordStockMovement(trx, {
          productId: Number(part.product_id),
          delta: returnQty,
          branchId: targetBranchId,
          locationId: targetLocationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          allowNegative: true,
          movementType: 'maintenance_return',
          referenceType: 'maintenance_ticket',
          referenceId: id,
          reason: 'إلغاء تذكرة صيانة - إرجاع قطع الغيار للمخزون',
          note: `حذف تذكرة صيانة #${id} - قطعة: ${part.product_name}`,
          unitCost: Number(part.unit_cost || 0),
          moneyDigits,
          createdBy: auth.userId ? Number(auth.userId) : null,
        });
        if (stockValue > 0) {
          await valueStockReceipt(
            trx,
            scope.tenantId,
            Number(part.product_id),
            movement.globalAfter,
            returnQty,
            stockValue,
          );
        }

        if (stockValue > 0) {
          await postMaintenanceJournal(
            trx,
            this.accountingFoundation,
            this.accountingPosting,
            auth,
            'maintenance_part_return',
            movement.movementId,
            targetBranchId,
            targetLocationId,
            [
              {
                code: '1140',
                debit: stockValue,
                description: 'Returned maintenance spare part inventory on ticket deletion',
              },
              { code: '5100', credit: stockValue, description: 'Reverse maintenance part cost on ticket deletion' },
            ],
          );
        }
      }

      await trx
        .deleteFrom('maintenance_ticket_parts')
        .where('tenant_id', '=', scope.tenantId)
        .where('ticket_id', '=', id)
        .execute();

      await trx
        .deleteFrom('maintenance_tickets')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', id)
        .execute();

      return parts.length;
    });

    await this.audit.log(
      'حذف تذكرة صيانة',
      `تم حذف تذكرة الصيانة #${id} واسترجاع ${partsCount} قطعة غيار إلى المخزون`,
      auth,
    );
    return { ok: true };
  }
}
