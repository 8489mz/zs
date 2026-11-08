import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { UpsertCustomerDto } from './dto/upsert-customer.dto';
import { UpsertSupplierDto } from './dto/upsert-supplier.dto';
import { buildCustomerSearchPredicate, buildSupplierSearchPredicate, calculatePagination, mapCustomerRow, mapSupplierRow, parsePartnersListQuery } from './helpers/partners-listing.helper';
import { generatePhoneSearchVariants } from '../../core/utils/phone-utils';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';
import { getCustomerRepBalancesMap } from '../delivery-reps/services/van-common.util';
import { extractCustomerVisitDays } from '../delivery-reps/van-routes-schedule.util';
import { AccountingPostingService } from '../accounting/accounting-posting.service';

@Injectable()
export class PartnersService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private tenantId(actor: AuthContext): string {
    return requireTenantScope(actor).tenantId;
  }

  private accountId(actor: AuthContext): string {
    return requireTenantScope(actor).accountId;
  }

  private tenantPredicate(actor: AuthContext, alias?: string) {
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${this.tenantId(actor)}`
      : sql<boolean>`tenant_id = ${this.tenantId(actor)}`;
  }

  private tenantFields(actor: AuthContext) {
    return { tenant_id: this.tenantId(actor), account_id: this.accountId(actor) };
  }

  private async customerNameExists(name: string, actor: AuthContext, excludeId?: number): Promise<boolean> {
    const row = await this.db
      .selectFrom('customers')
      .select(['id'])
      .where('is_active', '=', true)
      .where(sql`LOWER(name)`, '=', name.toLowerCase())
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    return Boolean(row && (!excludeId || Number(row.id) !== excludeId));
  }

  private async findCustomerByPhone(phone: string, actor: AuthContext, excludeId?: number): Promise<{ id: number; name: string; phone: string } | null> {
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

  private buildDuplicatePhoneWarning(existing: { id: number; name: string; phone: string }): Record<string, unknown> {
    return {
      message: `هذا الهاتف مسجل بالفعل للعميل ${existing.name}`,
      existingCustomer: { id: String(existing.id), name: existing.name, phone: existing.phone },
    };
  }

  private async supplierNameExists(name: string, actor: AuthContext, excludeId?: number): Promise<boolean> {
    const row = await this.db
      .selectFrom('suppliers')
      .select(['id'])
      .where('is_active', '=', true)
      .where(sql`LOWER(name)`, '=', name.toLowerCase())
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    return Boolean(row && (!excludeId || Number(row.id) !== excludeId));
  }

  private async addCustomerOpeningBalance(customerId: number, amount: number, actor: AuthContext, db: Kysely<Database>): Promise<void> {
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

  private async addSupplierOpeningBalance(supplierId: number, amount: number, actor: AuthContext, db: Kysely<Database>): Promise<void> {
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
        customers: rows.map((row) => mapCustomerRow(row, repBalancesMap.get(Number(row.id))?.repBalances)),
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
      customers: rows.map((row) => mapCustomerRow(row, repBalancesMap.get(Number(row.id))?.repBalances)),
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

  private extractCustomerAddresses(
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

  async addCustomerAddress(id: number, newAddress: string, actor: AuthContext): Promise<{ ok: boolean; addresses: string[] }> {
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

  async deleteCustomerAddress(id: number, addressToDelete: string, actor: AuthContext): Promise<{ ok: boolean; addresses: string[] }> {
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
      newMainAddress = (meta.addresses && meta.addresses[0]) ? meta.addresses[0] : '';
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
      .select(['id', 'balance', 'credit_limit', 'store_credit_balance', 'customer_type', 'loyalty_points'])
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
        .innerJoin('sales as s', (join) => join.onRef('s.id', '=', 'rd.invoice_id').onRef('s.tenant_id', '=', 'rd.tenant_id'))
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
      lastSaleAt: salesSummary?.last_sale_at || null,
      totalSalesAmount: Number(salesSummary?.total_sales_amount || 0),
      invoiceCount: Number(salesSummary?.invoice_count || 0),
      averageInvoice: Number(salesSummary?.average_invoice || 0),
      returnCount: Number(returnsSummary?.return_count || 0),
    };
  }

  async lookupCustomerDeliveryProfile(phoneQuery: string, actor: AuthContext): Promise<Record<string, unknown>> {
    const raw = String(phoneQuery || '').trim();
    const digits = raw.replace(/\D/g, '');
    const isTextSearch = /[^\d\s\-+()]/.test(raw);

    if ((isTextSearch && raw.length < 2) || (!isTextSearch && digits.length < 4)) {
      return {
        found: false,
        query: raw,
        phone: raw,
        message: 'Search query too short',
        matchedCustomers: [],
        addresses: [],
        recentOrders: [],
      };
    }

    const variants = digits ? generatePhoneSearchVariants(raw) : [];
    const searchTerms = Array.from(new Set([raw, digits, ...variants])).filter(Boolean);

    const customers = await this.db
      .selectFrom('customers')
      .selectAll()
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .where((eb) => {
        const clauses: any[] = [];
        if (raw.length >= 2) {
          clauses.push(eb('name', 'ilike', `%${raw}%`));
        }
        for (const term of searchTerms) {
          clauses.push(eb('phone', '=', term));
          clauses.push(eb('phone', 'like', `%${term}%`));
        }
        if (digits.length >= 4) {
          clauses.push(sql<boolean>`REPLACE(REPLACE(phone, '-', ''), ' ', '') LIKE ${'%' + digits + '%'}`);
        }
        return eb.or(clauses);
      })
      .limit(10)
      .execute();

    if (customers.length === 0) {
      return {
        found: false,
        query: raw,
        phone: raw,
        matchedCustomers: [],
        addresses: [],
        recentOrders: [],
      };
    }

    const isSingleMatch = customers.length === 1;
    const isExactPhoneMatch = Boolean(digits && digits.length >= 10 && customers[0].phone && customers[0].phone.replace(/\D/g, '') === digits);

    if (isSingleMatch || isExactPhoneMatch) {
      const primaryCustomer = customers[0];
      const fullProfile = await this.getCustomerDeliveryProfile(Number(primaryCustomer.id), actor);
      return {
        ...fullProfile,
        isExactMatch: true,
        matchedCustomers: customers.map((c) => ({
          id: String(c.id),
          name: c.name,
          phone: c.phone || '',
          address: c.address || '',
          customerType: c.customer_type || 'cash',
          balance: Number(c.balance || 0),
          loyaltyPoints: Number(c.loyalty_points || 0),
        })),
      };
    }

    // Multiple candidates found
    return {
      found: false,
      isMultipleMatches: true,
      query: raw,
      phone: raw,
      matchedCustomers: customers.map((c) => ({
        id: String(c.id),
        name: c.name,
        phone: c.phone || '',
        address: c.address || '',
        customerType: c.customer_type || 'cash',
        balance: Number(c.balance || 0),
        loyaltyPoints: Number(c.loyalty_points || 0),
      })),
      addresses: [],
      recentOrders: [],
    };
  }

  async getCustomerDeliveryProfile(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const customer = await this.db
      .selectFrom('customers')
      .selectAll()
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

    const [salesSummary, rawAddresses, recentSales] = await Promise.all([
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
        .execute(),
      this.db
        .selectFrom('sales as s')
        .leftJoin('branches as b', (join) => join.onRef('b.id', '=', 's.branch_id').onRef('b.tenant_id', '=', 's.tenant_id'))
        .select([
          's.id', 's.doc_no', 's.total', 's.subtotal', 's.discount', 's.tax_amount',
          's.delivery_fee', 's.order_type', 's.customer_address', 's.note', 's.created_at',
          'b.name as branch_name',
        ])
        .where('s.customer_id', '=', id)
        .where('s.status', '=', 'posted')
        .where(this.tenantPredicate(actor, 's'))
        .orderBy('s.id', 'desc')
        .limit(5)
        .execute(),
    ]);

    const saleIds = recentSales.map((s) => Number(s.id));
    const saleItems = saleIds.length > 0 ? await this.db
      .selectFrom('sale_items')
      .select(['id', 'sale_id', 'product_id', 'product_name', 'qty', 'unit_price', 'line_total', 'unit_name', 'unit_multiplier', 'modifiers', 'notes'])
      .where('sale_id', 'in', saleIds)
      .where(this.tenantPredicate(actor))
      .orderBy('id', 'asc')
      .execute() : [];

    const recentOrders = recentSales.map((sale) => {
      const items = saleItems.filter((it) => Number(it.sale_id) === Number(sale.id)).map((it) => {
        let parsedModifiers: any[] = [];
        if (typeof it.modifiers === 'string') {
          try {
            parsedModifiers = JSON.parse(it.modifiers || '[]');
          } catch {
            parsedModifiers = [];
          }
        } else if (Array.isArray(it.modifiers)) {
          parsedModifiers = it.modifiers;
        }

        return {
          id: Number(it.id),
          productId: String(it.product_id || ''),
          name: String(it.product_name || ''),
          qty: Number(it.qty || 1),
          unitPrice: Number(it.unit_price || 0),
          lineTotal: Number(it.line_total || 0),
          unitName: String(it.unit_name || ''),
          unitMultiplier: Number(it.unit_multiplier || 1),
          modifiers: parsedModifiers,
          notes: String(it.notes || ''),
        };
      });

      return {
        id: Number(sale.id),
        docNo: String(sale.doc_no || `S-${sale.id}`),
        total: Number(sale.total || 0),
        subtotal: Number(sale.subtotal || 0),
        discount: Number(sale.discount || 0),
        deliveryFee: Number(sale.delivery_fee || 0),
        orderType: String(sale.order_type || 'delivery'),
        customerAddress: String(sale.customer_address || ''),
        note: String(sale.note || ''),
        createdAt: sale.created_at,
        branchName: String(sale.branch_name || ''),
        items,
      };
    });

    let parsedMetadata: any = {};
    if (typeof customer.metadata === 'string') {
      try {
        parsedMetadata = JSON.parse(customer.metadata);
      } catch {
        parsedMetadata = {};
      }
    } else if (customer.metadata && typeof customer.metadata === 'object') {
      parsedMetadata = customer.metadata;
    }

    const addresses = this.extractCustomerAddresses(customer.address, parsedMetadata, rawAddresses);

    return {
      found: true,
      customer: {
        id: String(customer.id),
        name: customer.name,
        phone: customer.phone || '',
        address: customer.address || '',
        customerType: customer.customer_type || 'cash',
        balance: Number(customer.balance || 0),
        creditLimit: Number(customer.credit_limit || 0),
        storeCreditBalance: Number(customer.store_credit_balance || 0),
        loyaltyPoints: Number(customer.loyalty_points || 0),
        companyName: customer.company_name || '',
        taxNumber: customer.tax_number || '',
        notes: String(parsedMetadata.notes || parsedMetadata.remarks || ''),
        preferences: String(parsedMetadata.preferences || ''),
      },
      addresses,
      recentOrders,
      stats: {
        totalSalesAmount: Number(salesSummary?.total_sales_amount || 0),
        invoiceCount: Number(salesSummary?.invoice_count || 0),
        averageInvoice: Number(salesSummary?.average_invoice || 0),
        lastSaleAt: salesSummary?.last_sale_at || null,
      },
    };
  }

  async createCustomer(payload: UpsertCustomerDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Customer name is required', 'CUSTOMER_NAME_REQUIRED', 400);
    if (await this.customerNameExists(name, actor)) throw new AppError('Customer already exists', 'CUSTOMER_EXISTS', 400);
    const phone = String(payload.phone || '').trim();

    const inserted = await this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('customers')
        .values({
          name,
          phone,
          address: String(payload.address || '').trim(),
          balance: 0,
          customer_type: ['vip', 'credit', 'wholesale'].includes(payload.type as string) ? (payload.type as any) : 'cash',
          credit_limit: Number(payload.creditLimit || 0),
          store_credit_balance: Number(payload.storeCreditBalance || 0),
          company_name: String(payload.companyName || '').trim(),
          tax_number: String(payload.taxNumber || '').trim(),
          metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
          is_active: true,
          ...this.tenantFields(actor),
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.addCustomerOpeningBalance(Number(inserted.id), Number(payload.balance || 0), actor, trx);

      const customerCode = `C-${String(inserted.id).padStart(4, '0')}`;
      const initialMeta: any = {
        ...(payload.metadata || {}),
        customer_code: customerCode,
        code: customerCode,
      };
      if (initialMeta.visit_day !== undefined || initialMeta.visit_days !== undefined) {
        const { visitDays, visitDay } = extractCustomerVisitDays(initialMeta);
        initialMeta.visit_days = visitDays;
        initialMeta.visit_day = visitDay;
      }
      await (trx as any)
        .updateTable('customers')
        .set({ metadata: JSON.stringify(initialMeta) })
        .where('id', '=', (inserted as any).id)
        .where('tenant_id', '=', actor.tenantId)
        .execute();

      return inserted;
    });

    const customerCode = `C-${String(inserted.id).padStart(4, '0')}`;
    await this.audit.log('إضافة عميل', `تم إضافة العميل ${name} [${customerCode}] بواسطة ${actor.username}`, actor);

    const listing = await this.listCustomers({}, actor);
    const duplicate = await this.findCustomerByPhone(phone, actor, Number(inserted.id));
    return { ok: true, id: String(inserted.id), customers: listing.customers, ...(duplicate ? { phoneWarning: this.buildDuplicatePhoneWarning(duplicate) } : {}) };
  }

  async updateCustomer(id: number, payload: UpsertCustomerDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const existing = await this.db
      .selectFrom('customers')
      .select(['id', 'balance', 'store_credit_balance'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!existing) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Customer name is required', 'CUSTOMER_NAME_REQUIRED', 400);
    if (await this.customerNameExists(name, actor, id)) throw new AppError('Customer already exists', 'CUSTOMER_EXISTS', 400);
    const phone = String(payload.phone || '').trim();

    const requestedBalance = Number(payload.balance ?? existing.balance ?? 0);
    if (Math.abs(Number(existing.balance || 0) - requestedBalance) > 0.0001) {
      throw new AppError('Balance cannot be edited from customer form; use opening balance/import/reconcile flow', 'CUSTOMER_BALANCE_EDIT_FORBIDDEN', 400);
    }

    const requestedStoreCredit = Number(payload.storeCreditBalance ?? existing.store_credit_balance ?? 0);
    if (Math.abs(Number(existing.store_credit_balance || 0) - requestedStoreCredit) > 0.0001) {
      throw new AppError('Store credit cannot be edited from customer form', 'CUSTOMER_CREDIT_EDIT_FORBIDDEN', 400);
    }

    let metaToSave: any = payload.metadata ? { ...payload.metadata } : null;
    if (metaToSave && typeof metaToSave === 'object') {
      if (metaToSave.visit_day !== undefined || metaToSave.visit_days !== undefined) {
        const { visitDays, visitDay } = extractCustomerVisitDays(metaToSave);
        metaToSave.visit_days = visitDays;
        metaToSave.visit_day = visitDay;
      }
    }

    await this.db
      .updateTable('customers')
      .set({
        name,
        phone,
        address: String(payload.address || '').trim(),
        customer_type: ['vip', 'credit', 'wholesale'].includes(payload.type as string) ? (payload.type as any) : 'cash',
        credit_limit: Number(payload.creditLimit || 0),
        company_name: String(payload.companyName || '').trim(),
        tax_number: String(payload.taxNumber || '').trim(),
        metadata: metaToSave ? JSON.stringify(metaToSave) : null,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();

    await this.audit.log('تعديل عميل', `تم تحديث العميل #${id} بواسطة ${actor.username}`, actor);
    const listing = await this.listCustomers({}, actor);
    const duplicate = await this.findCustomerByPhone(phone, actor, id);
    return { ok: true, customers: listing.customers, ...(duplicate ? { phoneWarning: this.buildDuplicatePhoneWarning(duplicate) } : {}) };
  }

  async deleteCustomer(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const customer = await this.db
      .selectFrom('customers')
      .select(['id', 'balance', 'store_credit_balance'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
    if (Math.abs(Number(customer.balance || 0)) > 0.0001) throw new AppError('Customer has outstanding balance', 'CUSTOMER_HAS_BALANCE', 400);
    if (Math.abs(Number(customer.store_credit_balance || 0)) > 0.0001) throw new AppError('Customer has store credit balance', 'CUSTOMER_HAS_CREDIT', 400);

    const [salesCount, paymentCount, ledgerCount] = await Promise.all([
      this.db.selectFrom('sales').select((eb) => eb.fn.countAll<number>().as('count')).where('customer_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow(),
      this.db.selectFrom('customer_payments').select((eb) => eb.fn.countAll<number>().as('count')).where('customer_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow(),
      this.db.selectFrom('customer_ledger').select((eb) => eb.fn.countAll<number>().as('count')).where('customer_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow(),
    ]);

    if (Number(salesCount.count || 0) || Number(paymentCount.count || 0) || Number(ledgerCount.count || 0)) {
      throw new AppError('Customer has financial history and cannot be deleted', 'CUSTOMER_HAS_HISTORY', 400);
    }

    await this.db.deleteFrom('product_customer_prices').where('customer_id', '=', id).where(this.tenantPredicate(actor)).execute();
    await this.db.updateTable('customers').set({ is_active: false, updated_at: sql`NOW()` }).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
    await this.audit.log('حذف عميل', `تم تعطيل العميل #${id} بواسطة ${actor.username}`, actor);

    const listing = await this.listCustomers({}, actor);
    return { ok: true, customers: listing.customers };
  }

  async listSuppliers(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    const { page, pageSize, q, filter, isUnpagedDefault } = parsePartnersListQuery(query);

    let listQuery = this.db.selectFrom('suppliers').selectAll().where('is_active', '=', true).where(this.tenantPredicate(actor));
    let countQuery = this.db.selectFrom('suppliers').select((eb) => eb.fn.countAll<number>().as('count')).where('is_active', '=', true).where(this.tenantPredicate(actor));
    let summaryQuery = this.db.selectFrom('suppliers').select((eb) => [
      eb.fn.countAll<number>().as('total_suppliers'),
      sql<number>`coalesce(sum(balance), 0)`.as('total_balance'),
      sql<number>`coalesce(sum(case when trim(notes) <> '' then 1 else 0 end), 0)`.as('with_notes'),
    ]).where('is_active', '=', true).where(this.tenantPredicate(actor));

    const searchPredicate = buildSupplierSearchPredicate(q);
    if (searchPredicate) {
      listQuery = listQuery.where(searchPredicate);
      countQuery = countQuery.where(searchPredicate);
      summaryQuery = summaryQuery.where(searchPredicate);
    }

    if (filter === 'balance' || filter === 'debt') {
      listQuery = listQuery.where('balance', '>', 0);
      countQuery = countQuery.where('balance', '>', 0);
      summaryQuery = summaryQuery.where('balance', '>', 0);
    } else if (filter === 'withNotes') {
      const notesPredicate = sql<boolean>`trim(notes) <> ''`;
      listQuery = listQuery.where(notesPredicate);
      countQuery = countQuery.where(notesPredicate);
      summaryQuery = summaryQuery.where(notesPredicate);
    }

    if (isUnpagedDefault) {
      const rows = await listQuery.orderBy('id', 'asc').execute();
      return { suppliers: rows.map((row) => mapSupplierRow(row)) };
    }

    const [rows, countRow, summaryRow] = await Promise.all([
      listQuery.orderBy('id', 'asc').limit(pageSize).offset((page - 1) * pageSize).execute(),
      countQuery.executeTakeFirstOrThrow(),
      summaryQuery.executeTakeFirstOrThrow(),
    ]);

    const totalItems = Number(countRow.count || 0);

    return {
      suppliers: rows.map((row) => mapSupplierRow(row)),
      pagination: calculatePagination(page, pageSize, totalItems),
      summary: {
        totalSuppliers: Number(summaryRow.total_suppliers || 0),
        totalBalance: Number(summaryRow.total_balance || 0),
        withNotes: Number(summaryRow.with_notes || 0),
      },
    };
  }

  async createSupplier(payload: UpsertSupplierDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Supplier name is required', 'SUPPLIER_NAME_REQUIRED', 400);
    if (await this.supplierNameExists(name, actor)) throw new AppError('Supplier already exists', 'SUPPLIER_EXISTS', 400);

    const inserted = await this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('suppliers')
        .values({
          name,
          phone: String(payload.phone || '').trim(),
          address: String(payload.address || '').trim(),
          balance: 0,
          notes: String(payload.notes || '').trim(),
          metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
          is_active: true,
          ...this.tenantFields(actor),
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.addSupplierOpeningBalance(Number(inserted.id), Number(payload.balance || 0), actor, trx);
      return inserted;
    });
    await this.audit.log('إضافة مورد', `تم إضافة المورد ${name} بواسطة ${actor.username}`, actor);

    const listing = await this.listSuppliers({}, actor);
    return { ok: true, suppliers: listing.suppliers, id: inserted.id, supplier: { id: inserted.id, name } };
  }

  async updateSupplier(id: number, payload: UpsertSupplierDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const existing = await this.db
      .selectFrom('suppliers')
      .select(['id', 'balance'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!existing) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);

    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Supplier name is required', 'SUPPLIER_NAME_REQUIRED', 400);
    if (await this.supplierNameExists(name, actor, id)) throw new AppError('Supplier already exists', 'SUPPLIER_EXISTS', 400);

    const requestedBalance = Number(payload.balance ?? existing.balance ?? 0);
    if (Math.abs(Number(existing.balance || 0) - requestedBalance) > 0.0001) {
      throw new AppError('Balance cannot be edited from supplier form; use opening balance/import/reconcile flow', 'SUPPLIER_BALANCE_EDIT_FORBIDDEN', 400);
    }

    await this.db
      .updateTable('suppliers')
      .set({
        name,
        phone: String(payload.phone || '').trim(),
        address: String(payload.address || '').trim(),
        notes: String(payload.notes || '').trim(),
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();

    await this.audit.log('تعديل مورد', `تم تحديث المورد #${id} بواسطة ${actor.username}`, actor);
    const listing = await this.listSuppliers({}, actor);
    return { ok: true, suppliers: listing.suppliers };
  }

  async deleteSupplier(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const supplier = await this.db
      .selectFrom('suppliers')
      .select(['id', 'balance'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!supplier) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);
    if (Math.abs(Number(supplier.balance || 0)) > 0.0001) throw new AppError('Supplier has outstanding balance', 'SUPPLIER_HAS_BALANCE', 400);

    const [purchaseCount, paymentCount, ledgerCount] = await Promise.all([
      this.db.selectFrom('purchases').select((eb) => eb.fn.countAll<number>().as('count')).where('supplier_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow(),
      this.db.selectFrom('supplier_payments').select((eb) => eb.fn.countAll<number>().as('count')).where('supplier_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow(),
      this.db.selectFrom('supplier_ledger').select((eb) => eb.fn.countAll<number>().as('count')).where('supplier_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow(),
    ]);

    if (Number(purchaseCount.count || 0) || Number(paymentCount.count || 0) || Number(ledgerCount.count || 0)) {
      throw new AppError('Supplier has financial history and cannot be deleted', 'SUPPLIER_HAS_HISTORY', 400);
    }

    await this.db.updateTable('suppliers').set({ is_active: false, updated_at: sql`NOW()` }).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
    await this.audit.log('حذف مورد', `تم تعطيل المورد #${id} بواسطة ${actor.username}`, actor);

    const listing = await this.listSuppliers({}, actor);
    return { ok: true, suppliers: listing.suppliers };
  }

  async listContacts(partnerType: string, partnerId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const contacts = await this.db
      .selectFrom('partner_contacts')
      .selectAll()
      .where('partner_type', '=', partnerType)
      .where('partner_id', '=', partnerId)
      .where(this.tenantPredicate(actor))
      .execute();
    return { ok: true, contacts };
  }

  async createContact(partnerType: string, partnerId: number, payload: any, actor: AuthContext): Promise<Record<string, unknown>> {
    const [id] = await this.db
      .insertInto('partner_contacts')
      .values({
        partner_type: partnerType,
        partner_id: partnerId,
        name: payload.name,
        phone: payload.phone || null,
        email: payload.email || null,
        ...this.tenantFields(actor),
      } as any)
      .returning(['id'])
      .execute();
      
    return this.listContacts(partnerType, partnerId, actor);
  }

  async listAddresses(partnerType: string, partnerId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const addresses = await this.db
      .selectFrom('partner_addresses')
      .selectAll()
      .where('partner_type', '=', partnerType)
      .where('partner_id', '=', partnerId)
      .where(this.tenantPredicate(actor))
      .execute();
    return { ok: true, addresses };
  }

  async createAddress(partnerType: string, partnerId: number, payload: any, actor: AuthContext): Promise<Record<string, unknown>> {
    const [id] = await this.db
      .insertInto('partner_addresses')
      .values({
        partner_type: partnerType,
        partner_id: partnerId,
        label: payload.label,
        city: payload.city || null,
        address_line: payload.addressLine || null,
        ...this.tenantFields(actor),
      } as any)
      .returning(['id'])
      .execute();
      
    return this.listAddresses(partnerType, partnerId, actor);
  }

  async adjustCustomerLoyaltyPoints(
    id: number,
    pointsChange: number,
    actionType: 'earn' | 'redeem' | 'manual_adjust',
    notes: string | undefined,
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
    const customer = await this.db
      .selectFrom('customers')
      .select(['id', 'name', 'loyalty_points'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

    const currentPoints = Number(customer.loyalty_points || 0);
    const newBalance = Math.max(0, Number((currentPoints + pointsChange).toFixed(2)));

    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('customers')
        .set({ loyalty_points: newBalance, updated_at: now } as any)
        .where('id', '=', id)
        .where(this.tenantPredicate(actor))
        .execute();

      await trx
        .insertInto('customer_loyalty_logs')
        .values({
          tenant_id: this.tenantId(actor),
          account_id: this.accountId(actor),
          customer_id: id,
          points_change: pointsChange,
          balance_after: newBalance,
          action_type: actionType,
          sale_id: null,
          notes: notes?.trim() || null,
          created_at: now,
        } as any)
        .execute();
    });

    await this.audit.log(
      'تعديل نقاط الولاء',
      `تم تعديل نقاط العميل ${customer.name} بمقدار (${pointsChange > 0 ? `+${pointsChange}` : pointsChange}) ليصبح الرصيد ${newBalance} بواسطة ${actor.username}`,
      actor,
    );

    return { ok: true, customerId: id, previousBalance: currentPoints, balance: newBalance };
  }

  async getCustomerLoyaltyHistory(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const logs = await this.db
      .selectFrom('customer_loyalty_logs')
      .selectAll()
      .where('customer_id', '=', id)
      .where(this.tenantPredicate(actor))
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();

    return { ok: true, logs };
  }

  async getInactiveCustomersMarketing(daysInactive = 30, actor: AuthContext): Promise<Record<string, unknown>> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - daysInactive);

    const customers = await this.db
      .selectFrom('customers as c')
      .leftJoin('sales as s', (join) =>
        join.onRef('s.customer_id', '=', 'c.id').on('s.status', '=', 'posted'),
      )
      .select([
        'c.id',
        'c.name',
        'c.phone',
        'c.balance',
        'c.loyalty_points',
        sql<Date>`max(s.created_at)`.as('last_sale_at'),
        sql<number>`count(s.id)`.as('total_sales_count'),
      ])
      .where('c.is_active', '=', true)
      .where(this.tenantPredicate(actor, 'c'))
      .groupBy(['c.id', 'c.name', 'c.phone', 'c.balance', 'c.loyalty_points'])
      .having((eb) =>
        eb.or([
          sql<boolean>`max(s.created_at) is null`,
          sql<boolean>`max(s.created_at) < ${thresholdDate}`,
        ]),
      )
      .orderBy(sql`max(s.created_at) asc nulls first`)
      .limit(150)
      .execute();

    return {
      ok: true,
      count: customers.length,
      daysInactive,
      customers: customers.map((c) => ({
        id: String(c.id),
        name: c.name,
        phone: c.phone || '',
        balance: Number(c.balance || 0),
        loyaltyPoints: Number(c.loyalty_points || 0),
        lastSaleAt: c.last_sale_at || null,
        totalSalesCount: Number(c.total_sales_count || 0),
      })),
    };
  }
}
