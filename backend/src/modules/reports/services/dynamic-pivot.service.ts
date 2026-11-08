import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { ExecuteDynamicPivotDto, SavePivotTemplateDto } from '../dto/dynamic-pivot.dto';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import {
  buildDynamicPivotMatrix,
  type PivotResult,
} from '../engines/pivot-aggregation.engine';

@Injectable()
export class DynamicPivotService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  /**
   * Executes dynamic multidimensional pivot aggregation across datasets
   */
  async executePivot(
    auth: AuthContext,
    dto: ExecuteDynamicPivotDto,
  ): Promise<PivotResult> {
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    let records: Array<Record<string, any>> = [];

    if (dto.dataset === 'sales') {
      const needsItemLevel =
        dto.rowDimension === 'category' ||
        dto.colDimension === 'category' ||
        dto.rowDimension === 'product' ||
        dto.colDimension === 'product';

      if (needsItemLevel) {
        // Query at sale item level
        let query = (this.db as any)
          .selectFrom('sale_items as si')
          .innerJoin('sales as s', (j: any) => j.onRef('s.id', '=', 'si.sale_id').onRef('s.tenant_id', '=', 'si.tenant_id'))
          .leftJoin('products as p', (j: any) => j.onRef('p.id', '=', 'si.product_id').onRef('p.tenant_id', '=', 'si.tenant_id'))
          .leftJoin('categories as cat', (j: any) => j.onRef('cat.id', '=', 'p.category_id').onRef('cat.tenant_id', '=', 'p.tenant_id'))
          .leftJoin('branches as b', (j: any) => j.onRef('b.id', '=', 's.branch_id').onRef('b.tenant_id', '=', 's.tenant_id'))
          .leftJoin('customers as c', (j: any) => j.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 's.tenant_id'))
          .leftJoin('users as u', (j: any) => j.onRef('u.id', '=', 's.created_by').onRef('u.tenant_id', '=', 's.tenant_id'))
          .select([
            sql`to_char(s.created_at, 'YYYY-MM')`.as('date_month'),
            sql`to_char(s.created_at, 'YYYY-MM-DD')`.as('date_day'),
            'b.name as branch',
            'c.name as customer',
            'u.display_name as rep',
            's.payment_type as payment_type',
            'p.name as product',
            'cat.name as category',
            sql<number>`(coalesce(si.net_line_total, si.line_total) - coalesce((
              select sum(ri.line_total - coalesce(ri.allocated_tax, 0))
              from return_items ri join return_documents rd
                on rd.id = ri.return_document_id and rd.tenant_id = ri.tenant_id
              where ri.tenant_id = si.tenant_id and ri.sale_item_id = si.id
                and rd.return_type = 'sale' and rd.invoice_id = s.id), 0))`.as('total_amount'),
            sql<number>`(coalesce(si.net_line_total, si.line_total) - coalesce(si.cost_price, 0) * si.qty
              - coalesce((select sum(ri.line_total - coalesce(ri.allocated_tax, 0) -
                ri.qty * coalesce(ri.cost_price, si.cost_price, 0))
                from return_items ri join return_documents rd
                  on rd.id = ri.return_document_id and rd.tenant_id = ri.tenant_id
                where ri.tenant_id = si.tenant_id and ri.sale_item_id = si.id
                  and rd.return_type = 'sale' and rd.invoice_id = s.id), 0))`.as('net_profit'),
            sql<number>`(si.qty - coalesce((select sum(ri.qty)
              from return_items ri join return_documents rd
                on rd.id = ri.return_document_id and rd.tenant_id = ri.tenant_id
              where ri.tenant_id = si.tenant_id and ri.sale_item_id = si.id
                and rd.return_type = 'sale' and rd.invoice_id = s.id), 0))`.as('quantity'),
          ])
          .where('s.tenant_id', '=', tenantId)
          .where('si.tenant_id', '=', tenantId)
          .where('s.status', '=', 'posted');

        if (dto.dateFrom) query = query.where('s.created_at', '>=', new Date(dto.dateFrom));
        if (dto.dateTo) {
          const to = new Date(dto.dateTo);
          to.setHours(23, 59, 59, 999);
          query = query.where('s.created_at', '<=', to);
        }
        if (dto.branchId) query = query.where('s.branch_id', '=', dto.branchId);

        records = await query.limit(10001).execute();
        if (records.length > 10000) throw new BadRequestException('التقرير يحتوي على أكثر من 10,000 سجل؛ يرجى تضييق الفترة حتى لا تظهر نتائج جزئية.');
      } else {
        // Query at sale header level
        let query = (this.db as any)
          .selectFrom('sales as s')
          .leftJoin('branches as b', (j: any) => j.onRef('b.id', '=', 's.branch_id').onRef('b.tenant_id', '=', 's.tenant_id'))
          .leftJoin('customers as c', (j: any) => j.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 's.tenant_id'))
          .leftJoin('users as u', (j: any) => j.onRef('u.id', '=', 's.created_by').onRef('u.tenant_id', '=', 's.tenant_id'))
          .select([
            sql`to_char(s.created_at, 'YYYY-MM')`.as('date_month'),
            sql`to_char(s.created_at, 'YYYY-MM-DD')`.as('date_day'),
            'b.name as branch',
            'c.name as customer',
            'u.display_name as rep',
            's.payment_type as payment_type',
            's.order_type as order_type',
            's.status as status',
            sql<number>`(s.total - coalesce((select sum(rd.total) from return_documents rd where rd.tenant_id = s.tenant_id and rd.return_type = 'sale' and rd.invoice_id = s.id), 0))`.as('total_amount'),
            sql<number>`COALESCE(s.paid_amount, 0)`.as('paid_amount'),
            sql<number>`(s.total - coalesce(s.tax_amount, 0) - coalesce(s.delivery_fee, 0) - coalesce(s.tip_amount, 0)
              - coalesce((select sum(si.qty * coalesce(si.cost_price, 0))
                 from sale_items si where si.tenant_id = s.tenant_id and si.sale_id = s.id), 0)
              - coalesce((select sum(ri.line_total - coalesce(ri.allocated_tax, 0) -
                ri.qty * coalesce(ri.cost_price, 0))
                from return_documents rd join return_items ri
                  on ri.return_document_id = rd.id and ri.tenant_id = rd.tenant_id
                where rd.tenant_id = s.tenant_id and rd.return_type = 'sale' and rd.invoice_id = s.id), 0))`.as('net_profit'),
            sql<number>`1`.as('quantity'),
          ])
          .where('s.tenant_id', '=', tenantId)
          .where('s.status', '=', 'posted');

        if (dto.dateFrom) query = query.where('s.created_at', '>=', new Date(dto.dateFrom));
        if (dto.dateTo) {
          const to = new Date(dto.dateTo);
          to.setHours(23, 59, 59, 999);
          query = query.where('s.created_at', '<=', to);
        }
        if (dto.branchId) query = query.where('s.branch_id', '=', dto.branchId);

        records = await query.limit(10001).execute();
        if (records.length > 10000) throw new BadRequestException('التقرير يحتوي على أكثر من 10,000 سجل؛ يرجى تضييق الفترة حتى لا تظهر نتائج جزئية.');
      }
    } else if (dto.dataset === 'purchases') {
      let query = (this.db as any)
        .selectFrom('purchases as p')
        .leftJoin('suppliers as sup', (j: any) => j.onRef('sup.id', '=', 'p.supplier_id').onRef('sup.tenant_id', '=', 'p.tenant_id'))
        .leftJoin('branches as b', (j: any) => j.onRef('b.id', '=', 'p.branch_id').onRef('b.tenant_id', '=', 'p.tenant_id'))
        .select([
          sql`to_char(p.created_at, 'YYYY-MM')`.as('date_month'),
          sql`to_char(p.created_at, 'YYYY-MM-DD')`.as('date_day'),
          'sup.name as supplier',
          'b.name as branch',
          'p.status as status',
          sql<number>`p.total`.as('total_amount'),
          sql<number>`0`.as('net_profit'),
          sql<number>`1`.as('quantity'),
        ])
        .where('p.tenant_id', '=', tenantId)
        .where('p.status', '=', 'posted');

      if (dto.dateFrom) query = query.where('p.created_at', '>=', new Date(dto.dateFrom));
      if (dto.dateTo) {
        const to = new Date(dto.dateTo);
        to.setHours(23, 59, 59, 999);
        query = query.where('p.created_at', '<=', to);
      }

      records = await query.limit(10001).execute();
        if (records.length > 10000) throw new BadRequestException('التقرير يحتوي على أكثر من 10,000 سجل؛ يرجى تضييق الفترة حتى لا تظهر نتائج جزئية.');
    } else if (dto.dataset === 'inventory') {
      let query = (this.db as any)
        .selectFrom('product_location_stock as pls')
        .innerJoin('products as p', (j: any) => j.onRef('p.id', '=', 'pls.product_id').onRef('p.tenant_id', '=', 'pls.tenant_id'))
        .leftJoin('categories as cat', (j: any) => j.onRef('cat.id', '=', 'p.category_id').onRef('cat.tenant_id', '=', 'p.tenant_id'))
        .leftJoin('stock_locations as loc', (j: any) => j.onRef('loc.id', '=', 'pls.location_id').onRef('loc.tenant_id', '=', 'pls.tenant_id'))
        .select([
          'loc.name as branch',
          'cat.name as category',
          'p.name as product',
          sql<number>`(pls.qty * COALESCE(p.cost_price, 0))`.as('total_amount'),
          sql<number>`pls.qty`.as('quantity'),
        ])
        .where('pls.tenant_id', '=', tenantId);

      records = await query.limit(10001).execute();
        if (records.length > 10000) throw new BadRequestException('التقرير يحتوي على أكثر من 10,000 سجل؛ يرجى تضييق الفترة حتى لا تظهر نتائج جزئية.');
    } else if (dto.dataset === 'expenses') {
      let query = (this.db as any)
        .selectFrom('expenses as e')
        .leftJoin('branches as b', (j: any) => j.onRef('b.id', '=', 'e.branch_id').onRef('b.tenant_id', '=', 'e.tenant_id'))
        .select([
          sql`to_char(e.expense_date, 'YYYY-MM')`.as('date_month'),
          sql`to_char(e.expense_date, 'YYYY-MM-DD')`.as('date_day'),
          'b.name as branch',
          'e.title as category',
          'e.note as description',
          sql<number>`e.amount`.as('total_amount'),
          sql<number>`0`.as('net_profit'),
          sql<number>`1`.as('quantity'),
        ])
        .where('e.tenant_id', '=', tenantId);

      if (dto.dateFrom) query = query.where('e.expense_date', '>=', new Date(dto.dateFrom));
      if (dto.dateTo) {
        const to = new Date(dto.dateTo);
        to.setHours(23, 59, 59, 999);
        query = query.where('e.expense_date', '<=', to);
      }

      records = await query.limit(10001).execute();
        if (records.length > 10000) throw new BadRequestException('التقرير يحتوي على أكثر من 10,000 سجل؛ يرجى تضييق الفترة حتى لا تظهر نتائج جزئية.');
    }

    return buildDynamicPivotMatrix({
      records,
      rowDimension: dto.rowDimension,
      colDimension: dto.colDimension,
      metric: dto.metric,
      digits: currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId)),
    });
  }

  /**
   * Retrieves saved custom report templates
   */
  async getSavedTemplates(auth: AuthContext, dataset?: string): Promise<any[]> {
    const scope = requireTenantScope(auth);
    let query = (this.db as any)
      .selectFrom('custom_bi_pivot_reports')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId);

    if (dataset) {
      query = query.where('dataset', '=', dataset);
    }

    return query.orderBy('is_favorite', 'desc').orderBy('name', 'asc').execute();
  }

  /**
   * Saves a pivot template for rapid reuse
   */
  async saveTemplate(auth: AuthContext, dto: SavePivotTemplateDto): Promise<{ success: boolean; id: string }> {
    const scope = requireTenantScope(auth);
    const id = `bi_${randomUUID()}`;

    await (this.db as any)
      .insertInto('custom_bi_pivot_reports')
      .values({
        id,
        tenant_id: scope.tenantId,
        name: dto.name,
        description: dto.description || null,
        dataset: dto.dataset,
        row_dimension: dto.rowDimension,
        col_dimension: dto.colDimension || null,
        metric: dto.metric,
        date_from: dto.dateFrom || null,
        date_to: dto.dateTo || null,
        filters: dto.filters ? JSON.stringify(dto.filters) : null,
        created_by: auth.userId || null,
        is_favorite: Boolean(dto.isFavorite),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    return { success: true, id };
  }

  /**
   * Deletes a saved pivot report template
   */
  async deleteTemplate(auth: AuthContext, templateId: string): Promise<{ success: boolean }> {
    const scope = requireTenantScope(auth);

    const existing = await (this.db as any)
      .selectFrom('custom_bi_pivot_reports')
      .select('id')
      .where('id', '=', templateId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('Template not found');
    }

    await (this.db as any)
      .deleteFrom('custom_bi_pivot_reports')
      .where('id', '=', templateId)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    return { success: true };
  }
}
