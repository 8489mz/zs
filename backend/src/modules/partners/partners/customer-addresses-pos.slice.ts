import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { type RawBuilder } from 'kysely';

export interface CustomerAddressesPosSliceBoundDeps {
  tenantPredicate(actor: AuthContext, alias?: string): RawBuilder<boolean>;
  tenantId(actor: AuthContext): string;
  getCustomerAddresses(id: number, actor: AuthContext): Promise<string[]>;
}

export class CustomerAddressesPosSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: CustomerAddressesPosSliceBoundDeps,
  ) {}

  private tenantPredicate(actor: AuthContext, alias?: string): RawBuilder<boolean> {
    return this.bound.tenantPredicate(actor, alias);
  }

  private tenantId(actor: AuthContext): string {
    return this.bound.tenantId(actor);
  }

  private async getCustomerAddresses(id: number, actor: AuthContext): Promise<string[]> {
    return this.bound.getCustomerAddresses(id, actor);
  }
  async addCustomerAddress(
    id: number,
    newAddress: string,
    actor: AuthContext,
  ): Promise<{ ok: boolean; addresses: string[] }> {
    const trimmed = String(newAddress || '').trim();
    if (!trimmed) throw new AppError('Address is required', 'ADDRESS_REQUIRED', 400);

    const customer = await this.db
      .selectFrom('customers')
      .selectAll()
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

    let meta: any = {};
    if (typeof customer.metadata === 'string') {
      try {
        meta = JSON.parse(customer.metadata);
      } catch {
        meta = {};
      }
    } else if (customer.metadata && typeof customer.metadata === 'object') {
      meta = { ...customer.metadata };
    }

    const currentList: string[] = Array.isArray(meta.addresses) ? [...meta.addresses] : [];
    if (!currentList.includes(trimmed)) {
      currentList.unshift(trimmed);
    }
    meta.addresses = currentList;

    const baseAddress = customer.address && customer.address.trim() ? customer.address : trimmed;

    await this.db
      .updateTable('customers')
      .set({
        address: baseAddress,
        metadata: JSON.stringify(meta),
        updated_at: sql`NOW()`,
      })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();

    const addresses = await this.getCustomerAddresses(id, actor);
    return { ok: true, addresses };
  }

  async deleteCustomerAddress(
    id: number,
    addressToDelete: string,
    actor: AuthContext,
  ): Promise<{ ok: boolean; addresses: string[] }> {
    const target = String(addressToDelete || '').trim();
    if (!target) throw new AppError('Address to delete is required', 'ADDRESS_REQUIRED', 400);

    const customer = await this.db
      .selectFrom('customers')
      .selectAll()
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

    let meta: any = {};
    if (typeof customer.metadata === 'string') {
      try {
        meta = JSON.parse(customer.metadata);
      } catch {
        meta = {};
      }
    } else if (customer.metadata && typeof customer.metadata === 'object') {
      meta = { ...customer.metadata };
    }

    if (Array.isArray(meta.addresses)) {
      meta.addresses = meta.addresses.filter((a: string) => String(a).trim() !== target);
    }

    let newMainAddress = customer.address || '';
    if (newMainAddress.trim() === target) {
      newMainAddress = meta.addresses && meta.addresses[0] ? meta.addresses[0] : '';
    }

    await this.db
      .updateTable('customers')
      .set({
        address: newMainAddress,
        metadata: JSON.stringify(meta),
        updated_at: sql`NOW()`,
      })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();

    const addresses = await this.getCustomerAddresses(id, actor);
    return { ok: true, addresses };
  }

  async getCustomerPosSummary(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const customer = await this.db
      .selectFrom('customers')
      .select([
        'id',
        'balance',
        'credit_limit',
        'store_credit_balance',
        'customer_type',
        'price_list_id',
        'loyalty_points',
      ])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

    const [salesSummary, returnsSummary] = await Promise.all([
      this.db
        .selectFrom('sales')
        .select([
          sql<number>`coalesce(sum(total), 0)`.as('total_sales_amount'),
          sql<number>`count(*)`.as('invoice_count'),
          sql<number>`coalesce(avg(total), 0)`.as('average_invoice'),
          sql<Date>`max(created_at)`.as('last_sale_at'),
        ])
        .where('customer_id', '=', id)
        .where('status', '=', 'posted')
        .where(this.tenantPredicate(actor))
        .executeTakeFirst(),
      this.db
        .selectFrom('return_documents as rd')
        .innerJoin('sales as s', (join) =>
          join.onRef('s.id', '=', 'rd.invoice_id').onRef('s.tenant_id', '=', 'rd.tenant_id'),
        )
        .select(sql<number>`count(*)`.as('return_count'))
        .where('rd.return_type', '=', 'sale')
        .where('s.customer_id', '=', id)
        .where(this.tenantPredicate(actor, 's'))
        .where(this.tenantPredicate(actor, 'rd'))
        .executeTakeFirst(),
    ]);

    const balance = Number(customer.balance || 0);
    const creditLimit = Number(customer.credit_limit || 0);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, this.tenantId(actor)));

    return {
      customerId: String(customer.id),
      balance,
      creditLimit,
      remainingCredit: creditLimit > 0 ? roundMoney(creditLimit - balance, moneyDigits) : null,
      storeCreditBalance: Number(customer.store_credit_balance || 0),
      loyaltyPoints: Number(customer.loyalty_points || 0),
      customerType: customer.customer_type || 'cash',
      // INV-VAN-PRICE-LIST-WIRING: the assigned list id, so the POS
      // can show which list prices this customer (and the sale path
      // resolves the same assignment server-side).
      priceListId: customer.price_list_id != null ? Number(customer.price_list_id) : null,
      lastSaleAt: salesSummary?.last_sale_at || null,
      totalSalesAmount: Number(salesSummary?.total_sales_amount || 0),
      invoiceCount: Number(salesSummary?.invoice_count || 0),
      averageInvoice: Number(salesSummary?.average_invoice || 0),
      returnCount: Number(returnsSummary?.return_count || 0),
    };
  }
}
