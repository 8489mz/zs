import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { generatePhoneSearchVariants } from '../../../core/utils/phone-utils';
import { type RawBuilder } from 'kysely';

export interface CustomerDeliveryProfileSliceBoundDeps {
  tenantPredicate(actor: AuthContext, alias?: string): RawBuilder<boolean>;
  extractCustomerAddresses(
    customerAddress: string | null | undefined,
    metadata: any,
    rawSalesAddresses: Array<{ customer_address: string | null }>,
  ): string[];
}

export class CustomerDeliveryProfileSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: CustomerDeliveryProfileSliceBoundDeps,
  ) {}

  private tenantPredicate(actor: AuthContext, alias?: string): RawBuilder<boolean> {
    return this.bound.tenantPredicate(actor, alias);
  }

  private extractCustomerAddresses(
    customerAddress: string | null | undefined,
    metadata: any,
    rawSalesAddresses: Array<{ customer_address: string | null }>,
  ): string[] {
    return this.bound.extractCustomerAddresses(customerAddress, metadata, rawSalesAddresses);
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
    const isExactPhoneMatch = Boolean(
      digits && digits.length >= 10 && customers[0].phone && customers[0].phone.replace(/\D/g, '') === digits,
    );

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
        .leftJoin('branches as b', (join) =>
          join.onRef('b.id', '=', 's.branch_id').onRef('b.tenant_id', '=', 's.tenant_id'),
        )
        .select([
          's.id',
          's.doc_no',
          's.total',
          's.subtotal',
          's.discount',
          's.tax_amount',
          's.delivery_fee',
          's.order_type',
          's.customer_address',
          's.note',
          's.created_at',
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
    const saleItems =
      saleIds.length > 0
        ? await this.db
            .selectFrom('sale_items')
            .select([
              'id',
              'sale_id',
              'product_id',
              'product_name',
              'qty',
              'unit_price',
              'line_total',
              'unit_name',
              'unit_multiplier',
              'modifiers',
              'notes',
            ])
            .where('sale_id', 'in', saleIds)
            .where(this.tenantPredicate(actor))
            .orderBy('id', 'asc')
            .execute()
        : [];

    const recentOrders = recentSales.map((sale) => {
      const items = saleItems
        .filter((it) => Number(it.sale_id) === Number(sale.id))
        .map((it) => {
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
}
