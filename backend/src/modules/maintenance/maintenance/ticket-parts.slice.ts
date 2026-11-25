import { Kysely } from '../../../database/kysely';
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
import { applyStockDelta } from '../../../common/utils/location-stock-ledger';
import { AddTicketPartDto } from '../dto/update-ticket-status.dto';

export class TicketPartsSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly accountingPosting: AccountingPostingService,
    private readonly accountingFoundation: AccountingTenantFoundationService,
  ) {}

  async addPart(ticketId: number, payload: AddTicketPartDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const ticket = await trx
        .selectFrom('maintenance_tickets')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', ticketId)
        .forUpdate()
        .executeTakeFirst();

      if (!ticket) {
        throw new AppError('تذكرة الصيانة غير موجودة', 'TICKET_NOT_FOUND', 404);
      }

      let targetLocationId = payload.locationId ?? (ticket.location_id ? Number(ticket.location_id) : null);
      let targetBranchId = ticket.branch_id ? Number(ticket.branch_id) : null;
      const deductQty = Number(payload.qty);

      if (ticket.status === 'delivered' || ticket.status === 'cancelled' || ticket.status === 'unrepairable') {
        throw new AppError('Cannot issue parts to a closed maintenance ticket', 'MAINTENANCE_CLOSED', 409);
      }

      // No location anywhere (no payload location, no ticket location):
      // the operator picked from GLOBAL stock, so deduct from the
      // location that actually holds the units instead of failing
      // against the empty unassigned balance. One location must cover
      // the whole qty (never split across locations, never invent
      // stock); when the ticket has a branch, only that branch's rows
      // are candidates, so another branch's stock is never consumed.
      // applyStockDelta still re-checks under its own locks, so a
      // concurrent consumption fails closed with INSUFFICIENT_STOCK.
      if (targetLocationId === null) {
        let candidatesQuery = trx
          .selectFrom('product_location_stock')
          .select(['location_id', 'branch_id', 'qty', 'reserved_qty'])
          .where('tenant_id', '=', scope.tenantId)
          .where('account_id', '=', scope.accountId)
          .where('product_id', '=', payload.productId)
          .where('location_id', 'is not', null);
        if (ticket.branch_id != null) {
          candidatesQuery = candidatesQuery.where('branch_id', '=', Number(ticket.branch_id));
        }
        const candidates = await candidatesQuery.execute();
        const covering = candidates
          .map((row) => ({
            locationId: Number(row.location_id),
            branchId: row.branch_id == null ? null : Number(row.branch_id),
            available: Number(row.qty || 0) - Number(row.reserved_qty || 0),
          }))
          .filter((row) => row.available >= deductQty)
          .sort((a, b) => b.available - a.available || a.locationId - b.locationId);
        const best = covering[0];
        if (best) {
          targetLocationId = best.locationId;
          targetBranchId = best.branchId ?? targetBranchId;
        }
      }

      // Branchless ticket + a real location: the location row itself
      // knows its branch. Derive it here instead of passing null:
      // updateBalanceQty treats an explicitly-passed null as "overwrite
      // the row's branch_id with null", so a null branch on this call
      // would NULL the location row's branch_id and a later
      // branch-restricted resolution would miss the row and falsely
      // report INSUFFICIENT_STOCK. Never overrides an explicit ticket
      // branch_id; when the location row carries no branch (or no row
      // exists yet) the branch stays null, which is harmless — the
      // ledger only overwrites when the passed value differs.
      if (targetLocationId !== null && targetBranchId === null) {
        const locationRow = await trx
          .selectFrom('product_location_stock')
          .select('branch_id')
          .where('tenant_id', '=', scope.tenantId)
          .where('account_id', '=', scope.accountId)
          .where('product_id', '=', payload.productId)
          .where('location_id', '=', targetLocationId)
          .executeTakeFirst();
        if (locationRow?.branch_id != null) {
          targetBranchId = Number(locationRow.branch_id);
        }
      }
      const partRes = await trx
        .insertInto('maintenance_ticket_parts')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          ticket_id: ticketId,
          product_id: payload.productId,
          product_name: payload.productName.trim(),
          qty: deductQty,
          unit_cost: payload.unitCost ?? 0,
          unit_price: payload.unitPrice,
          location_id: targetLocationId,
        })
        .returning('id')
        .executeTakeFirst();

      const stockChange = await applyStockDelta(trx, {
        productId: payload.productId,
        delta: -deductQty,
        branchId: targetBranchId,
        locationId: targetLocationId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        errorCode: 'INSUFFICIENT_STOCK',
        errorMessage: `الرصيد غير كافٍ لصرف قطعة الغيار ${payload.productName.trim()}`,
      });

      const product = await trx
        .selectFrom('products')
        .select('cost_price')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', payload.productId)
        .executeTakeFirstOrThrow();
      const unitCost = Number(product.cost_price);
      const stockValue = roundMoney(
        unitCost * deductQty,
        currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId)),
      );
      if (!Number.isFinite(stockValue) || unitCost < 0) {
        throw new AppError('Maintenance stock cost is invalid', 'MAINTENANCE_STOCK_COST_INVALID', 422);
      }
      await trx
        .updateTable('maintenance_ticket_parts')
        .set({ unit_cost: unitCost })
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', Number(partRes?.id))
        .execute();
      const movement = await trx
        .insertInto('stock_movements')
        .values({
          product_id: payload.productId,
          movement_type: 'maintenance_consumption',
          qty: -deductQty,
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          reason: 'صرف قطعة غيار لتذكرة صيانة',
          note: `تذكرة صيانة #${ticketId} - قطعة: ${payload.productName.trim()}`,
          reference_type: 'maintenance_ticket',
          reference_id: ticketId,
          unit_cost: unitCost,
          total_cost: stockValue,
          branch_id: targetBranchId,
          location_id: targetLocationId,
          created_by: auth.userId ? Number(auth.userId) : null,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();
      if (stockValue > 0) {
        await postMaintenanceJournal(
          trx,
          this.accountingFoundation,
          this.accountingPosting,
          auth,
          'maintenance_part_issue',
          Number(movement.id),
          targetBranchId,
          targetLocationId,
          [
            { code: '5100', debit: stockValue, description: 'Maintenance part consumption cost' },
            { code: '1140', credit: stockValue, description: 'Inventory consumed on maintenance job' },
          ],
        );
      }

      let newFinalCost = Number(ticket.final_cost || 0);
      if (newFinalCost === 0 && Number(ticket.expected_cost || 0) === 0) {
        const addedAmount = deductQty * Number(payload.unitPrice);
        newFinalCost = addedAmount;
        await trx
          .updateTable('maintenance_tickets')
          .set({ final_cost: newFinalCost, updated_at: new Date() })
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', ticketId)
          .execute();
      }

      return { partId: String(partRes?.id), newFinalCost };
    });

    return { ok: true, partId: result.partId, newFinalCost: result.newFinalCost };
  }

  async removePart(ticketId: number, partId: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      const ticket = await trx
        .selectFrom('maintenance_tickets')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', ticketId)
        .forUpdate()
        .executeTakeFirst();

      if (!ticket) {
        throw new AppError('تذكرة الصيانة غير موجودة', 'TICKET_NOT_FOUND', 404);
      }

      const part = await trx
        .selectFrom('maintenance_ticket_parts')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('ticket_id', '=', ticketId)
        .where('id', '=', partId)
        .executeTakeFirst();

      if (!part) {
        throw new AppError('قطعة الغيار غير موجودة بالتذكرة', 'PART_NOT_FOUND', 404);
      }
      if (ticket.status === 'delivered') {
        throw new AppError(
          'Delivered maintenance parts require a formal reversal',
          'MAINTENANCE_REVERSAL_REQUIRED',
          409,
        );
      }

      await trx
        .deleteFrom('maintenance_ticket_parts')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', partId)
        .execute();

      const returnQty = Number(part.qty);
      const targetLocationId = part.location_id
        ? Number(part.location_id)
        : ticket.location_id
          ? Number(ticket.location_id)
          : null;
      let targetBranchId = ticket.branch_id ? Number(ticket.branch_id) : null;

      // Same branch derivation as addPart (see there): a branchless
      // ticket returning stock to a real location must pass the
      // location row's branch, or updateBalanceQty NULLs the row's
      // branch_id and a later branch-restricted issue falsely reports
      // INSUFFICIENT_STOCK. Never overrides an explicit ticket branch.
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

      const stockChange = await applyStockDelta(trx, {
        productId: Number(part.product_id),
        delta: returnQty,
        branchId: targetBranchId,
        locationId: targetLocationId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        allowNegative: true,
      });

      const stockValue = roundMoney(
        Number(part.unit_cost) * returnQty,
        currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId)),
      );
      if (!Number.isFinite(stockValue) || Number(part.unit_cost) < 0) {
        throw new AppError('Historical part cost is invalid', 'MAINTENANCE_STOCK_COST_INVALID', 422);
      }
      // A return restores inventory at its historical consumed cost, not the
      // current price of any later purchases; refresh WAC under product lock.
      await valueStockReceipt(
        trx,
        scope.tenantId,
        Number(part.product_id),
        stockChange.globalAfter,
        returnQty,
        stockValue,
      );
      const movement = await trx
        .insertInto('stock_movements')
        .values({
          product_id: Number(part.product_id),
          movement_type: 'maintenance_return',
          qty: returnQty,
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          reason: 'إلغاء صرف قطعة غيار من تذكرة صيانة',
          note: `إلغاء من تذكرة صيانة #${ticketId}`,
          unit_cost: Number(part.unit_cost),
          total_cost: stockValue,
          reference_type: 'maintenance_ticket',
          reference_id: ticketId,
          branch_id: targetBranchId,
          location_id: targetLocationId,
          created_by: auth.userId ? Number(auth.userId) : null,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();
      if (stockValue > 0) {
        await postMaintenanceJournal(
          trx,
          this.accountingFoundation,
          this.accountingPosting,
          auth,
          'maintenance_part_return',
          Number(movement.id),
          targetBranchId,
          targetLocationId,
          [
            { code: '1140', debit: stockValue, description: 'Returned maintenance spare part inventory' },
            { code: '5100', credit: stockValue, description: 'Reverse maintenance part cost' },
          ],
        );
      }
    });

    return { ok: true };
  }
}
