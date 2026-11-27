import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { Kysely, Transaction, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';

type DbOrTx = Kysely<Database> | Transaction<Database>;

@Injectable()
export class PurchasesFinanceService {
  async assertNoBlockingThreeWayMatch(queryable: DbOrTx, supplierId: number, tenantId: string): Promise<void> {
    const blocking = await queryable
      .selectFrom('purchases')
      .select(['doc_no', 'three_way_match_status'])
      .where('tenant_id', '=', tenantId)
      .where('supplier_id', '=', supplierId)
      .where('status', '!=', 'cancelled')
      .where((eb) =>
        eb.or([
          eb('three_way_match_status', 'in', [
            'quantity_mismatch',
            'price_mismatch',
            'tolerance_exceeded',
            'unmatched_grn',
            'service_rejected',
          ]),
          eb.and([
            eb.or([eb('po_id', 'is not', null), eb('grn_id', 'is not', null)]),
            eb.or([eb('three_way_match_status', 'is', null), eb('three_way_match_status', '=', 'unmatched')]),
          ]),
        ]),
      )
      .limit(1)
      .executeTakeFirst();
    if (blocking) {
      throw new AppError(
        `لا يمكن السداد: فاتورة المورد رقم (${blocking.doc_no || '—'}) لم تجتز المطابقة الثلاثية (الحالة: ${blocking.three_way_match_status}).`,
        'THREE_WAY_MATCH_BLOCKING',
        400,
      );
    }
  }

  private tenantScope(actor: AuthContext) {
    return requireTenantScope(actor);
  }

  private tenantPredicate(actor: AuthContext) {
    const scope = this.tenantScope(actor);
    return sql<boolean>`tenant_id = ${scope.tenantId}`;
  }

  private tenantFields(actor: AuthContext) {
    const scope = this.tenantScope(actor);
    return { tenant_id: scope.tenantId, account_id: scope.accountId };
  }

  async addSupplierLedgerEntry(
    queryable: DbOrTx,
    supplierId: number,
    amount: number,
    entryType: string,
    note: string,
    referenceType: string,
    referenceId: number,
    actor: AuthContext,
    branchId: number | null,
    locationId: number | null,
  ): Promise<void> {
    const updatedSupplier = await queryable
      .updateTable('suppliers')
      .set({ balance: sql`COALESCE(balance, 0) + ${amount}`, updated_at: sql`NOW()` })
      .where('id', '=', supplierId)
      .where(this.tenantPredicate(actor))
      .returning(['balance'])
      .executeTakeFirstOrThrow();
    const balanceAfter = Number(updatedSupplier.balance);
    await queryable
      .insertInto('supplier_ledger')
      .values({
        supplier_id: supplierId,
        entry_type: entryType,
        amount,
        balance_after: balanceAfter,
        note,
        reference_type: referenceType,
        reference_id: referenceId,
        branch_id: branchId,
        location_id: locationId,
        created_by: actor.userId,
        ...this.tenantFields(actor),
      })
      .execute();
  }

  async addCustomerLedgerEntry(
    queryable: DbOrTx,
    customerId: number,
    amount: number,
    note: string,
    referenceType: string,
    referenceId: number,
    actor: AuthContext,
    branchId: number | null,
    locationId: number | null,
  ): Promise<void> {
    const updatedCustomer = await queryable
      .updateTable('customers')
      .set({ balance: sql`COALESCE(balance, 0) + ${amount}`, updated_at: sql`NOW()` })
      .where('id', '=', customerId)
      .where(this.tenantPredicate(actor))
      .returning(['balance'])
      .executeTakeFirstOrThrow();
    const balanceAfter = Number(updatedCustomer.balance);
    await queryable
      .insertInto('customer_ledger')
      .values({
        customer_id: customerId,
        entry_type: 'customer_payment',
        amount,
        balance_after: balanceAfter,
        note,
        reference_type: referenceType,
        reference_id: referenceId,
        branch_id: branchId,
        location_id: locationId,
        created_by: actor.userId,
        ...this.tenantFields(actor),
      })
      .execute();
  }

  async addTreasuryTransaction(
    queryable: DbOrTx,
    txnType: string,
    amount: number,
    note: string,
    referenceType: string,
    referenceId: number,
    actor: AuthContext,
    branchId: number | null,
    locationId: number | null,
    paymentChannel: 'cash' | 'bank' | 'card' | 'wallet' | 'instapay' = 'cash',
  ): Promise<void> {
    await queryable
      .insertInto('treasury_transactions')
      .values({
        txn_type: txnType,
        amount,
        payment_channel: paymentChannel,
        note,
        reference_type: referenceType,
        reference_id: referenceId,
        branch_id: branchId,
        location_id: locationId,
        created_by: actor.userId,
        ...this.tenantFields(actor),
      })
      .execute();
  }
}
