import { BadRequestException } from '@nestjs/common';
import { sql } from 'kysely';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';

export class SyncSubLedgersSlice {
  constructor() {}

  async syncCustomerSubLedger(
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

    const chequeDate = await trx
      .selectFrom('accounting_cheques')
      .select(['last_action_date', 'issue_date'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', chequeId)
      .executeTakeFirstOrThrow();
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

  async syncSupplierSubLedger(
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

    const chequeDate = await trx
      .selectFrom('accounting_cheques')
      .select(['last_action_date', 'issue_date'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', chequeId)
      .executeTakeFirstOrThrow();
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
}
