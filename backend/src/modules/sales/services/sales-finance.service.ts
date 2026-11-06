import { Inject, Injectable } from '@nestjs/common';
import { Kysely, Transaction, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

type DbOrTx = Kysely<Database> | Transaction<Database>;

@Injectable()
export class SalesFinanceService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private tenantScope(auth: AuthContext) {
    return requireTenantScope(auth);
  }

  private tenantPredicate(auth: AuthContext) {
    const scope = this.tenantScope(auth);
    return sql<boolean>`tenant_id = ${scope.tenantId}`;
  }

  private tenantFields(auth: AuthContext) {
    const scope = this.tenantScope(auth);
    return { tenant_id: scope.tenantId, account_id: scope.accountId };
  }

  async createCustomerLedgerEntry(
    queryable: DbOrTx,
    customerId: number,
    amount: number,
    note: string,
    referenceId: number,
    auth: AuthContext,
  ): Promise<void> {
    if (!Number.isFinite(amount)) throw new AppError('Invalid customer ledger amount', 'INVALID_AMOUNT', 400);
    const customer = await queryable.selectFrom('customers')
      .select(['id', 'balance', 'credit_limit', 'is_credit_blocked'])
      .where('id', '=', customerId)
      .where(this.tenantPredicate(auth))
      .forUpdate()
      .executeTakeFirst();
    if (!customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
    if (amount > 0) {
      if (customer.is_credit_blocked) throw new AppError('Customer credit is blocked', 'CUSTOMER_CREDIT_BLOCKED', 400);
      if (Number(customer.credit_limit || 0) > 0
        && Number(customer.balance || 0) + amount > Number(customer.credit_limit) + 0.001) {
        throw new AppError('Customer credit limit exceeded', 'CUSTOMER_CREDIT_LIMIT', 400);
      }
    }
    const updatedCustomer = await queryable
      .updateTable('customers')
      .set({ balance: sql`COALESCE(balance, 0) + ${amount}`, updated_at: sql`NOW()` })
      .where('id', '=', customerId)
      .where(this.tenantPredicate(auth))
      .where(sql<boolean>`(${amount}::numeric <= 0 OR (NOT COALESCE(is_credit_blocked, FALSE)
        AND (COALESCE(credit_limit, 0) <= 0 OR COALESCE(balance, 0) + ${amount} <= credit_limit + 0.001)))`)
      .returning(['balance'])
      .executeTakeFirst();
    if (!updatedCustomer) throw new AppError('Customer credit limit exceeded', 'CUSTOMER_CREDIT_LIMIT', 400);
    const nextBalance = roundMoney(Number(updatedCustomer.balance),
      currencyMoneyDigits(await tenantBaseCurrency(queryable, this.tenantScope(auth).tenantId)));
    await queryable
      .insertInto('customer_ledger')
      .values({
        customer_id: customerId,
        entry_type: amount >= 0 ? 'sale_credit' : 'sale_cancel_restore',
        amount,
        balance_after: Number(nextBalance),
        note,
        reference_type: 'sale',
        reference_id: referenceId,
        created_by: auth.userId,
        ...this.tenantFields(auth),
      } as any)
      .execute();
  }

  /**
   * INV-CUSTOMER-SUPPLIER-STATEMENTS: post one customer-ledger leg with
   * an explicit entry type and NO credit-limit gate. The caller must
   * have already validated the NET effect against the limit (or the
   * legs net to zero, as a fully-settled sale's +charge / -settlement
   * pair does). This exists because createCustomerLedgerEntry refuses
   * any positive amount that would push the balance over the limit --
   * correct for a new debt, but wrong for the charge leg of a sale
   * that is settled in the same transaction: a cash/card sale must
   * never be blocked by the credit limit.
   */
  async addCustomerLedgerLeg(
    queryable: DbOrTx,
    customerId: number,
    amount: number,
    entryType: string,
    note: string,
    referenceType: string,
    referenceId: number,
    auth: AuthContext,
  ): Promise<void> {
    if (!Number.isFinite(amount)) throw new AppError('Invalid customer ledger amount', 'INVALID_AMOUNT', 400);
    const updatedCustomer = await queryable
      .updateTable('customers')
      .set({ balance: sql`COALESCE(balance, 0) + ${amount}`, updated_at: sql`NOW()` })
      .where('id', '=', customerId)
      .where(this.tenantPredicate(auth))
      .returning(['balance'])
      .executeTakeFirstOrThrow();
    const nextBalance = roundMoney(Number(updatedCustomer.balance),
      currencyMoneyDigits(await tenantBaseCurrency(queryable, this.tenantScope(auth).tenantId)));
    await queryable
      .insertInto('customer_ledger')
      .values({
        customer_id: customerId,
        entry_type: entryType,
        amount,
        balance_after: Number(nextBalance),
        note,
        reference_type: referenceType,
        reference_id: referenceId,
        created_by: auth.userId,
        ...this.tenantFields(auth),
      } as any)
      .execute();
  }

  async addTreasuryTransaction(
    queryable: DbOrTx,
    amount: number,
    note: string,
    saleId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
    cashierShiftId?: number | null,
  ): Promise<void> {
    await queryable
      .insertInto('treasury_transactions')
      .values({
        txn_type: amount >= 0 ? 'sale' : 'sale_cancel_restore',
        amount,
        note,
        reference_type: cashierShiftId ? 'cashier_shift' : 'sale',
        reference_id: cashierShiftId || saleId,
        created_by: auth.userId,
        branch_id: branchId,
        location_id: locationId,
        ...this.tenantFields(auth),
      } as any)
      .execute();
  }

  async addCustomerPaymentLedgerEntry(
    queryable: DbOrTx,
    customerId: number,
    amount: number,
    note: string,
    referenceType: string,
    referenceId: number,
    auth: AuthContext,
    branchId?: number | null,
    locationId?: number | null,
  ): Promise<void> {
    const updatedCustomer = await queryable
      .updateTable('customers')
      .set({ balance: sql`COALESCE(balance, 0) + ${amount}`, updated_at: sql`NOW()` })
      .where('id', '=', customerId)
      .where(this.tenantPredicate(auth))
      .returning(['balance'])
      .executeTakeFirstOrThrow();
    const nextBalance = roundMoney(Number(updatedCustomer.balance),
      currencyMoneyDigits(await tenantBaseCurrency(queryable, this.tenantScope(auth).tenantId)));
    await queryable
      .insertInto('customer_ledger')
      .values({
        customer_id: customerId,
        entry_type: 'customer_payment',
        amount,
        balance_after: Number(nextBalance),
        note,
        reference_type: referenceType,
        reference_id: referenceId,
        branch_id: branchId || null,
        location_id: locationId || null,
        created_by: auth.userId,
        ...this.tenantFields(auth),
      } as any)
      .execute();
  }

  async addTreasuryPaymentTransaction(
    queryable: DbOrTx,
    txnType: string,
    amount: number,
    note: string,
    referenceType: string,
    referenceId: number,
    auth: AuthContext,
    branchId?: number | null,
    locationId?: number | null,
  ): Promise<void> {
    await queryable
      .insertInto('treasury_transactions')
      .values({
        txn_type: txnType,
        amount,
        note,
        reference_type: referenceType,
        reference_id: referenceId,
        created_by: auth.userId,
        branch_id: branchId || null,
        location_id: locationId || null,
        ...this.tenantFields(auth),
      } as any)
      .execute();
  }
}
