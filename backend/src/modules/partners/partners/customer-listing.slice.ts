import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../database/database.types';
import { buildCustomerSearchPredicate, calculatePagination, mapCustomerRow, parsePartnersListQuery } from '../helpers/partners-listing.helper';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { getCustomerRepBalancesMap } from '../../delivery-reps/services/van-common.util';

export interface CustomerListingSliceBoundDeps {
  tenantPredicate(actor: AuthContext, alias?: string);
  tenantId(actor: AuthContext): string;
}

export class CustomerListingSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: CustomerListingSliceBoundDeps,
  ) {}

  private tenantPredicate(actor: AuthContext, alias?: string) { return this.bound.tenantPredicate(actor, alias); }
  private tenantId(actor: AuthContext): string { return this.bound.tenantId(actor); }

  async listCustomers(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    const { page, pageSize, q, filter, isUnpagedDefault } = parsePartnersListQuery(query);

    let listQuery = this.db.selectFrom('customers').selectAll().where('is_active', '=', true).where(this.tenantPredicate(actor));
    let countQuery = this.db.selectFrom('customers').select((eb) => eb.fn.countAll<number>().as('count')).where('is_active', '=', true).where(this.tenantPredicate(actor));
    let summaryQuery = this.db.selectFrom('customers').select((eb) => [
      eb.fn.countAll<number>().as('total_customers'),
      sql<number>`coalesce(sum(balance), 0)`.as('total_balance'),
      sql<number>`coalesce(sum(credit_limit), 0)`.as('total_credit'),
      sql<number>`coalesce(sum(case when customer_type = 'vip' then 1 else 0 end), 0)`.as('vip_count'),
    ]).where('is_active', '=', true).where(this.tenantPredicate(actor));

    const searchPredicate = buildCustomerSearchPredicate(q);
    if (searchPredicate) {
      listQuery = listQuery.where(searchPredicate);
      countQuery = countQuery.where(searchPredicate);
      summaryQuery = summaryQuery.where(searchPredicate);
    }

    if (filter === 'debt') {
      listQuery = listQuery.where('balance', '>', 0);
      countQuery = countQuery.where('balance', '>', 0);
      summaryQuery = summaryQuery.where('balance', '>', 0);
    } else if (filter === 'vip') {
      listQuery = listQuery.where('customer_type', '=', 'vip');
      countQuery = countQuery.where('customer_type', '=', 'vip');
      summaryQuery = summaryQuery.where('customer_type', '=', 'vip');
    } else if (filter === 'cash') {
      listQuery = listQuery.where('customer_type', '=', 'cash');
      countQuery = countQuery.where('customer_type', '=', 'cash');
      summaryQuery = summaryQuery.where('customer_type', '=', 'cash');
    }

    if (isUnpagedDefault) {
      const rows = await listQuery.orderBy('id', 'asc').execute();
      const customerIds = rows.map((r) => Number(r.id));
      const customerTotalBalances: Record<number, number> = {};
      for (const r of rows) customerTotalBalances[Number(r.id)] = Number(r.balance || 0);
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, this.tenantId(actor)));
      const repBalancesMap = await getCustomerRepBalancesMap(this.db as any, this.tenantId(actor), {
        customerIds,
        customerTotalBalances,
        moneyDigits,
      });
      return {
        customers: rows.map((row) => mapCustomerRow(row, repBalancesMap.get(Number(row.id))?.repBalances, repBalancesMap.get(Number(row.id))?.unassignedBalance)),
      };
    }

    const [rows, countRow, summaryRow] = await Promise.all([
      listQuery.orderBy('id', 'asc').limit(pageSize).offset((page - 1) * pageSize).execute(),
      countQuery.executeTakeFirstOrThrow(),
      summaryQuery.executeTakeFirstOrThrow(),
    ]);

    const customerIds = rows.map((r) => Number(r.id));
    const customerTotalBalances: Record<number, number> = {};
    for (const r of rows) customerTotalBalances[Number(r.id)] = Number(r.balance || 0);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, this.tenantId(actor)));
    const repBalancesMap = await getCustomerRepBalancesMap(this.db as any, this.tenantId(actor), {
      customerIds,
      customerTotalBalances,
      moneyDigits,
    });

    const totalItems = Number(countRow.count || 0);

    return {
      customers: rows.map((row) => mapCustomerRow(row, repBalancesMap.get(Number(row.id))?.repBalances, repBalancesMap.get(Number(row.id))?.unassignedBalance)),
      pagination: calculatePagination(page, pageSize, totalItems),
      summary: {
        totalCustomers: Number(summaryRow.total_customers || 0),
        totalBalance: Number(summaryRow.total_balance || 0),
        totalCredit: Number(summaryRow.total_credit || 0),
        vipCount: Number(summaryRow.vip_count || 0),
      },
    };
  }

  async getCustomerAddresses(id: number, actor: AuthContext): Promise<string[]> {
    const customer = await this.db
      .selectFrom('customers')
      .select(['id', 'address', 'metadata', 'phone'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!customer) return [];

    const salesAddresses = await this.db
      .selectFrom('sales')
      .select('customer_address')
      .where((eb) => {
        const conds: any[] = [eb('customer_id', '=', id)];
        if (customer.phone) {
          conds.push(eb('customer_phone', '=', customer.phone));
        }
        return eb.or(conds);
      })
      .where(this.tenantPredicate(actor))
      .where('customer_address', 'is not', null)
      .where('customer_address', '!=', '')
      .distinct()
      .limit(20)
      .execute();

    return this.extractCustomerAddresses(customer.address, customer.metadata, salesAddresses);
  }

  extractCustomerAddresses(
    customerAddress: string | null | undefined,
    metadata: any,
    rawSalesAddresses: Array<{ customer_address: string | null }>,
  ): string[] {
    const addressesSet = new Set<string>();

    // 1. Split customer.address by newlines or delimiters
    if (customerAddress && typeof customerAddress === 'string') {
      const rawLines = customerAddress.split(/[\r\n]+/);
      for (const line of rawLines) {
        const subparts = line.split(/[;|]/);
        for (const p of subparts) {
          const trimmed = p.replace(/^[0-9]+[-.)]\s*/, '').trim();
          if (trimmed.length >= 2) {
            addressesSet.add(trimmed);
          }
        }
      }
    }

    // 2. Metadata addresses array / delivery_addresses
    let metaObj = metadata;
    if (typeof metaObj === 'string') {
      try {
        metaObj = JSON.parse(metaObj);
      } catch {
        metaObj = {};
      }
    }
    if (metaObj && typeof metaObj === 'object') {
      const metaAddresses = metaObj.addresses || metaObj.delivery_addresses || metaObj.address_list || [];
      if (Array.isArray(metaAddresses)) {
        for (const addr of metaAddresses) {
          const trimmed = String(addr || '').trim();
          if (trimmed.length >= 2) {
            addressesSet.add(trimmed);
          }
        }
      } else if (typeof metaAddresses === 'string') {
        const lines = metaAddresses.split(/[\r\n]+/);
        for (const l of lines) {
          const trimmed = l.trim();
          if (trimmed.length >= 2) {
            addressesSet.add(trimmed);
          }
        }
      }
    }

    // 3. Raw sales addresses
    for (const r of rawSalesAddresses) {
      const addr = String(r.customer_address || '').trim();
      if (addr.length >= 2) {
        addressesSet.add(addr);
      }
    }

    return Array.from(addressesSet);
  }
}
