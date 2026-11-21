import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { generatePhoneSearchVariants } from '../../../core/utils/phone-utils';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import type { RawBuilder } from 'kysely';

export interface CustomerOpeningBalancesSliceBoundDeps {
  tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
  tenantId: (actor: AuthContext) => string;
  tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
}

export class CustomerOpeningBalancesSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
    private readonly bound: CustomerOpeningBalancesSliceBoundDeps,
  ) {}

  private tenantPredicate(actor: AuthContext, alias?: string) {
    return this.bound.tenantPredicate(actor, alias);
  }

  private tenantId(actor: AuthContext): string {
    return this.bound.tenantId(actor);
  }

  private tenantFields(actor: AuthContext) {
    return this.bound.tenantFields(actor);
  }

  async customerNameExists(name: string, actor: AuthContext, excludeId?: number): Promise<boolean> {
    const row = await this.db
      .selectFrom('customers')
      .select(['id'])
      .where('is_active', '=', true)
      .where(sql`LOWER(name)`, '=', name.toLowerCase())
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    return Boolean(row && (!excludeId || Number(row.id) !== excludeId));
  }

  async findCustomerByPhone(phone: string, actor: AuthContext, excludeId?: number): Promise<{ id: number; name: string; phone: string } | null> {
    const trimmed = String(phone || '').trim();
    if (!trimmed) return null;
    const variants = generatePhoneSearchVariants(trimmed);
    let query = this.db
      .selectFrom('customers')
      .select(['id', 'name', 'phone'])
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .where('phone', 'in', variants);
    if (excludeId) query = query.where('id', '!=', excludeId);
    const row = await query.orderBy('id', 'asc').executeTakeFirst();
    if (!row) return null;
    return { id: Number(row.id), name: row.name, phone: row.phone || '' };
  }

  buildDuplicatePhoneWarning(existing: { id: number; name: string; phone: string }): Record<string, unknown> {
    return {
      message: `هذا الهاتف مسجل بالفعل للعميل ${existing.name}`,
      existingCustomer: { id: String(existing.id), name: existing.name, phone: existing.phone },
    };
  }

  async supplierNameExists(name: string, actor: AuthContext, excludeId?: number): Promise<boolean> {
    const row = await this.db
      .selectFrom('suppliers')
      .select(['id'])
      .where('is_active', '=', true)
      .where(sql`LOWER(name)`, '=', name.toLowerCase())
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    return Boolean(row && (!excludeId || Number(row.id) !== excludeId));
  }

  async addCustomerOpeningBalance(customerId: number, amount: number, actor: AuthContext, db: Kysely<Database>): Promise<void> {
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(db, this.tenantId(actor)));
    const openingBalance = roundMoney(Number(amount || 0), moneyDigits);
    if (Math.abs(openingBalance) <= 0.0001) return;

    await db.insertInto('customer_ledger').values({
      customer_id: customerId,
      entry_type: 'opening_balance',
      amount: openingBalance,
      balance_after: openingBalance,
      note: 'رصيد افتتاحي',
      reference_type: 'customer',
      reference_id: customerId,
      created_by: actor.userId,
      branch_id: null,
      location_id: null,
      ...this.tenantFields(actor),
    }).execute();

    await db.updateTable('customers').set({ balance: openingBalance, updated_at: sql`NOW()` }).where('id', '=', customerId).where(this.tenantPredicate(actor)).execute();

    await this.accountingPosting.postCustomerOpeningBalance(db, customerId, openingBalance, actor);
  }

  async addSupplierOpeningBalance(supplierId: number, amount: number, actor: AuthContext, db: Kysely<Database>): Promise<void> {
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(db, this.tenantId(actor)));
    const openingBalance = roundMoney(Number(amount || 0), moneyDigits);
    if (Math.abs(openingBalance) <= 0.0001) return;

    await db.insertInto('supplier_ledger').values({
      supplier_id: supplierId,
      entry_type: 'opening_balance',
      amount: openingBalance,
      balance_after: openingBalance,
      note: 'رصيد افتتاحي',
      reference_type: 'supplier',
      reference_id: supplierId,
      created_by: actor.userId,
      branch_id: null,
      location_id: null,
      ...this.tenantFields(actor),
    }).execute();

    await db.updateTable('suppliers').set({ balance: openingBalance, updated_at: sql`NOW()` }).where('id', '=', supplierId).where(this.tenantPredicate(actor)).execute();

    await this.accountingPosting.postSupplierOpeningBalance(db, supplierId, openingBalance, actor);
  }
}
