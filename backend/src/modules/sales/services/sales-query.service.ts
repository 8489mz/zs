import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { mapHeldSalesRows, mapSaleRows, filterSales, paginateRows, summarizeSales } from '../helpers/sales-query.helper';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { SalesAuthorizationService } from './sales-authorization.service';

@Injectable()
export class SalesQueryService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly authz: SalesAuthorizationService,
  ) {}

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const { tenantId } = requireTenantScope(auth);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}`
      : sql<boolean>`tenant_id = ${tenantId}`;
  }

  private async fetchSaleBaseRows(auth: AuthContext, query?: Record<string, unknown>): Promise<{ rows: Array<Record<string, unknown>>, totalItems: number, nextCursor: string | null }> {
    const search = typeof query?.search === 'string' ? query.search.trim() : (typeof query?.q === 'string' ? query.q.trim() : '');
    const numericId = Number(search);
    const hasNumericId = Number.isInteger(numericId) && numericId > 0;
    
    const filter = String(query?.paymentChannel || query?.filter || query?.view || 'all').toLowerCase();
    const cashier = String(query?.cashier || query?.createdBy || 'all').trim();
    const cashierLower = cashier.toLowerCase();
    
    const page = Math.max(1, Number(query?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query?.pageSize || 30)));
    const lastSeenId = Number(query?.lastSeenId || query?.lastId || query?.cursor || 0);

    let qb = this.db
      .selectFrom('sales as s')
      .leftJoin('customers as c', (j) => j.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 's.tenant_id'))
      .leftJoin('branches as b', (j) => j.onRef('b.id', '=', 's.branch_id').onRef('b.tenant_id', '=', 's.tenant_id'))
      .leftJoin('stock_locations as l', (j) => j.onRef('l.id', '=', 's.location_id').onRef('l.tenant_id', '=', 's.tenant_id'))
      .leftJoin('users as u', (j) => j.onRef('u.id', '=', 's.created_by').onRef('u.tenant_id', '=', 's.tenant_id'))
      .leftJoin('delivery_representatives as dr', (j) => j.onRef('dr.id', '=', 's.delivery_rep_id').onRef('dr.tenant_id', '=', 's.tenant_id'))
      .select([
        's.id', 's.doc_no', 's.customer_id', 'c.name as customer_name_ref', 'c.phone as customer_phone_ref', 'c.address as customer_address_ref', 's.customer_name', 's.customer_phone', 's.customer_address', 's.payment_type', 's.payment_channel',
        's.subtotal', 's.discount', 's.tax_rate', 's.tax_amount', 's.prices_include_tax', 's.total', 's.paid_amount', 's.tendered_amount', 's.change_amount', 's.store_credit_used', 's.delivery_fee',
        's.status', 's.note', 's.table_number', 's.order_type', 's.branch_id', 's.location_id', 's.created_by as created_by_id', 's.created_at', 'b.name as branch_name', 'l.name as location_name', 'u.username as created_by_name', 'u.username as created_by_username',
        's.delivery_rep_id', 'dr.name as delivery_rep_name',
        sql<number>`COUNT(*) OVER()`.as('total_count'),
        sql<number>`COALESCE(SUM(s.total) OVER(), 0)`.as('agg_total_sales'),
        sql<number>`COALESCE(SUM(CASE WHEN s.payment_type = 'cash' OR s.payment_channel = 'cash' THEN s.total ELSE 0 END) OVER(), 0)`.as('agg_cash_total'),
        sql<number>`COALESCE(SUM(CASE WHEN s.payment_type = 'credit' OR s.payment_channel = 'credit' THEN s.total ELSE 0 END) OVER(), 0)`.as('agg_credit_total'),
        sql<number>`COALESCE(SUM(CASE WHEN s.status = 'cancelled' THEN 1 ELSE 0 END) OVER(), 0)`.as('agg_cancelled_count'),
        sql<number>`COALESCE(SUM(CASE WHEN s.created_at >= CURRENT_DATE THEN 1 ELSE 0 END) OVER(), 0)`.as('agg_today_sales_count'),
        sql<number>`COALESCE(SUM(CASE WHEN s.created_at >= CURRENT_DATE THEN s.total ELSE 0 END) OVER(), 0)`.as('agg_today_sales_total')
      ])
      .where(this.tenantPredicate(auth, 's'));

    if (search) {
      const cleanSearch = search.replace(/[-\/_.\s]/g, '');
      qb = qb.where((eb) => {
        const clauses: any[] = [
          eb('s.doc_no', 'ilike', `%${search}%`),
          sql<boolean>`REPLACE(REPLACE(s.doc_no, '-', ''), '/', '') ILIKE ${'%' + cleanSearch + '%'}`,
          eb('c.name', 'ilike', `%${search}%`),
          eb('c.phone', 'ilike', `%${search}%`),
          eb('s.customer_name', 'ilike', `%${search}%`),
          eb('s.customer_phone', 'ilike', `%${search}%`),
          eb('s.note', 'ilike', `%${search}%`),
        ];
        if (hasNumericId && search.length <= 6) {
          clauses.push(eb('s.id', '=', numericId));
        }
        return eb.or(clauses);
      });
    }

    if (filter !== 'all') {
      if (filter === 'cash') {
        qb = qb.where((eb) => eb.or([eb('s.payment_channel', '=', 'cash'), eb.and([eb('s.payment_type', '=', 'cash'), eb('s.payment_channel', 'is', null)])]));
      } else if (filter === 'card') {
        qb = qb.where('s.payment_channel', '=', 'card');
      } else if (filter === 'credit') {
        qb = qb.where((eb) => eb.or([eb('s.payment_type', '=', 'credit'), eb('s.payment_channel', '=', 'credit')]));
      } else if (filter === 'wallet' || filter === 'instapay' || filter === 'mixed') {
        qb = qb.where('s.payment_channel', '=', filter);
      } else if (filter === 'cancelled') {
        qb = qb.where('s.status', '=', 'cancelled');
      }
    }

    if (cashierLower !== 'all') {
      qb = qb.where((eb) => eb.or([
        sql<boolean>`CAST(s.created_by AS TEXT) = ${cashier}`,
        eb('u.username', '=', cashierLower)
      ]));
    }

    if (lastSeenId > 0) {
      qb = qb.where('s.id', '<', lastSeenId);
    }

    const rows = await qb
      .orderBy('s.id', 'desc')
      .limit(pageSize)
      .offset(lastSeenId > 0 ? 0 : (page - 1) * pageSize)
      .execute() as unknown as Array<Record<string, unknown>>;
      
    const totalItems = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const nextCursor = rows.length === pageSize ? String(rows[rows.length - 1].id) : null;
    return { rows, totalItems, nextCursor };
  }

  private mapSaleShells(sales: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    return sales.map((sale) => ({
      id: String(sale.id),
      docNo: sale.doc_no || `Z-${sale.id}`,
      createdById: sale.created_by_id ? String(sale.created_by_id) : '',
      customerId: sale.customer_id ? String(sale.customer_id) : '',
      customerName: sale.customer_name_ref || sale.customer_name || 'عميل نقدي',
      customerPhone: sale.customer_phone || sale.customer_phone_ref || '',
      customerAddress: sale.customer_address || sale.customer_address_ref || '',
      paymentType: sale.payment_type || 'cash',
      paymentChannel: sale.payment_channel || 'cash',
      subTotal: Number(sale.subtotal || 0),
      discount: Number(sale.discount || 0),
      deliveryFee: Number(sale.delivery_fee || 0),
      taxRate: Number(sale.tax_rate || 0),
      taxAmount: Number(sale.tax_amount || 0),
      pricesIncludeTax: Boolean(sale.prices_include_tax),
      total: Number(sale.total || 0),
      paidAmount: Number(sale.paid_amount || 0),
      tenderedAmount: Number(sale.tendered_amount || 0),
      changeAmount: Number(sale.change_amount || 0),
      storeCreditUsed: Number(sale.store_credit_used || 0),
      status: sale.status || 'posted',
      note: sale.note || '',
      tableNumber: sale.table_number || '',
      orderType: sale.order_type || 'takeaway',
      deliveryRepId: sale.delivery_rep_id || null,
      deliveryRepName: sale.delivery_rep_name || null,
      delivery_rep_name: sale.delivery_rep_name || null,
      createdBy: sale.created_by_name || sale.created_by_username || '',
      createdByUsername: sale.created_by_username || '',
      date: sale.created_at,
      branchId: sale.branch_id ? String(sale.branch_id) : '',
      locationId: sale.location_id ? String(sale.location_id) : '',
      branchName: sale.branch_name || '',
      locationName: sale.location_name || '',
      items: [],
      payments: [],
    }));
  }

  private async hydrateSales(sales: Array<Record<string, unknown>>, auth: AuthContext): Promise<Array<Record<string, unknown>>> {
    const saleIds = sales.map((sale) => Number(sale.id)).filter((id) => Number.isFinite(id) && id > 0);
    if (!saleIds.length) return [];

    const [items, payments, linkedReturns] = await Promise.all([
      this.db
        .selectFrom('sale_items')
        .select(['id', 'sale_id', 'product_id', 'product_name', 'product_name_en', 'qty', 'unit_price', 'line_total', 'net_line_total', 'allocated_tax', 'unit_name', 'unit_multiplier', 'cost_price', 'price_type', 'modifiers', 'serials'])
        .where('sale_id', 'in', saleIds)
        .where(this.tenantPredicate(auth))
        .orderBy('sale_id', 'asc')
        .orderBy('id', 'asc')
        .execute(),
      this.db
        .selectFrom('sale_payments')
        .select(['id', 'sale_id', 'payment_channel', 'amount'])
        .where('sale_id', 'in', saleIds)
        .where(this.tenantPredicate(auth))
        .orderBy('sale_id', 'asc')
        .orderBy('id', 'asc')
        .execute(),
      this.db
        .selectFrom('return_documents')
        .select(['id', 'doc_no', 'invoice_id', 'total', 'created_at', 'settlement_mode', 'refund_method'])
        .where('invoice_id', 'in', saleIds)
        .where('return_type', '=', 'sale')
        .where(this.tenantPredicate(auth))
        .orderBy('id', 'desc')
        .execute(),
    ]);

    const canViewCostPrice = auth.role === 'super_admin'
      || auth.role === 'admin'
      || (auth.permissions && (auth.permissions.includes('canViewProfit') || auth.permissions.includes('reports') || auth.permissions.includes('purchases')));

    return mapSaleRows(
      sales,
      items as unknown as Array<Record<string, unknown>>,
      payments as unknown as Array<Record<string, unknown>>,
      Boolean(canViewCostPrice),
      linkedReturns as unknown as Array<Record<string, unknown>>,
    );
  }

  async listSales(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    this.authz.assertCanViewSales(auth);

    const { rows: baseSales, totalItems, nextCursor } = await this.fetchSaleBaseRows(auth, query);
    const shells = this.mapSaleShells(baseSales);
    const firstRow = (baseSales[0] || {}) as Record<string, unknown>;
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const baseSummary = summarizeSales(shells, digits);
    const summary = {
      ...baseSummary,
      totalItems,
      totalSales: baseSales.length > 0 ? roundMoney(Number(firstRow.agg_total_sales || 0), digits) : 0,
      todaySalesCount: baseSales.length > 0 ? Number(firstRow.agg_today_sales_count || 0) : 0,
      todaySalesTotal: baseSales.length > 0 ? roundMoney(Number(firstRow.agg_today_sales_total || 0), digits) : 0,
      cashTotal: baseSales.length > 0 ? roundMoney(Number(firstRow.agg_cash_total || 0), digits) : 0,
      creditTotal: baseSales.length > 0 ? roundMoney(Number(firstRow.agg_credit_total || 0), digits) : 0,
      cancelledCount: baseSales.length > 0 ? Number(firstRow.agg_cancelled_count || 0) : 0,
    };
    
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 30)));
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const rangeStart = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
    const rangeEnd = totalItems > 0 ? Math.min(page * pageSize, totalItems) : 0;

    const hydratedSales = await this.hydrateSales(baseSales, auth);

    return {
      sales: hydratedSales,
      pagination: { page, pageSize, totalItems, totalPages, rangeStart, rangeEnd, nextCursor },
      summary,
      scope,
    };
  }

  async getSaleById(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    this.authz.assertCanViewSales(auth);

    const sale = await this.db
      .selectFrom('sales as s')
      .leftJoin('customers as c', (j) => j.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 's.tenant_id'))
      .leftJoin('branches as b', (j) => j.onRef('b.id', '=', 's.branch_id').onRef('b.tenant_id', '=', 's.tenant_id'))
      .leftJoin('stock_locations as l', (j) => j.onRef('l.id', '=', 's.location_id').onRef('l.tenant_id', '=', 's.tenant_id'))
      .leftJoin('users as u', (j) => j.onRef('u.id', '=', 's.created_by').onRef('u.tenant_id', '=', 's.tenant_id'))
      .leftJoin('delivery_representatives as dr', (j) => j.onRef('dr.id', '=', 's.delivery_rep_id').onRef('dr.tenant_id', '=', 's.tenant_id'))
      .select([
        's.id', 's.doc_no', 's.customer_id', 'c.name as customer_name_ref', 'c.phone as customer_phone_ref', 'c.address as customer_address_ref', 's.customer_name', 's.customer_phone', 's.customer_address', 's.payment_type', 's.payment_channel',
        's.subtotal', 's.discount', 's.tax_rate', 's.tax_amount', 's.prices_include_tax', 's.total', 's.paid_amount', 's.tendered_amount', 's.change_amount', 's.store_credit_used', 's.delivery_fee',
        's.status', 's.note', 's.table_number', 's.order_type', 's.branch_id', 's.location_id', 's.created_by as created_by_id', 's.created_at', 'b.name as branch_name', 'l.name as location_name', 'u.username as created_by_name', 'u.username as created_by_username',
        's.delivery_rep_id', 'dr.name as delivery_rep_name',
      ])
      .where('s.id', '=', id)
      .where(this.tenantPredicate(auth, 's'))
      .executeTakeFirst();

    if (!sale) throw new AppError('Sale not found', 'SALE_NOT_FOUND', 404);

    const [mappedSale] = await this.hydrateSales([sale as unknown as Record<string, unknown>], auth);
    return { sale: mappedSale, scope };
  }

  async listHeldSales(auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const canManageHeldSales = this.authz.canManageHeldSales(auth);
    const ownerUserId = this.authz.heldSaleOwnerUserId(auth);
    const rows = await this.db
      .selectFrom('held_sales as hs')
      .leftJoin('customers as c', 'c.id', 'hs.customer_id')
      .select([
        'hs.id', 'hs.customer_id', 'hs.payment_type', 'hs.payment_channel', 'hs.paid_amount', 'hs.cash_amount', 'hs.card_amount',
        'hs.discount', 'hs.note', 'hs.search', 'hs.table_number', 'hs.order_type', 'hs.price_type', 'hs.branch_id', 'hs.location_id', 'hs.created_by', 'hs.created_at', 'c.name as customer_name',
      ])
      .where(this.tenantPredicate(auth, 'hs'))
      .$if(!canManageHeldSales, (qb) => qb.where('hs.created_by', '=', ownerUserId ?? -1))
      .orderBy('hs.id', 'desc')
      .execute();

    const heldSaleIds = rows
      .map((row) => Number(row.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0);
    const items = heldSaleIds.length
      ? await this.db
        .selectFrom('held_sale_items')
        .select(['id', 'held_sale_id', 'product_id', 'product_name', 'qty', 'unit_price', 'unit_name', 'unit_multiplier', 'price_type', 'modifiers', 'notes'])
        .where('held_sale_id', 'in', heldSaleIds)
        .where(this.tenantPredicate(auth))
        .orderBy('held_sale_id', 'asc')
        .orderBy('id', 'asc')
        .execute()
      : [];

    return {
      heldSales: mapHeldSalesRows(
        rows as unknown as Array<Record<string, unknown>>,
        items as unknown as Array<Record<string, unknown>>,
      ),
      scope,
    };
  }
}
