import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';

export class ListFieldReturnsSlice {
  constructor(private readonly db: Kysely<Database>) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Lists field returns for admin review and auditing.
   */
  async listFieldReturns(
    tenantId: string,
    filters: { status?: string; repId?: number; tripId?: number; customerId?: number } = {},
  ) {
    let q = this.anyDb
      .selectFrom('van_field_returns as vfr')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'vfr.rep_id')
      .leftJoin('customers as c', 'c.id', 'vfr.customer_id')
      .leftJoin('sales as s', 's.id', 'vfr.sale_id')
      .leftJoin('users as u', 'u.id', 'vfr.approved_by')
      .select([
        'vfr.id',
        'vfr.doc_no as docNo',
        'vfr.trip_id as tripId',
        'vfr.rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        'vfr.customer_id as customerId',
        sql<string>`coalesce(c.name, '')`.as('customerName'),
        'vfr.sale_id as saleId',
        sql<string>`coalesce(s.doc_no, '')`.as('saleDocNo'),
        'vfr.status',
        'vfr.return_reason as returnReason',
        'vfr.refund_method as refundMethod',
        sql<number>`cast(vfr.total_amount as numeric)`.as('totalAmount'),
        'vfr.items_json as itemsJson',
        'vfr.notes',
        'vfr.rejection_reason as rejectionReason',
        sql<string>`coalesce(u.username, '')`.as('approvedByName'),
        'vfr.approved_at as approvedAt',
        'vfr.created_at as createdAt',
      ])
      .where('vfr.tenant_id', '=', tenantId);

    if (filters.status) q = q.where('vfr.status', '=', filters.status);
    if (filters.repId) q = q.where('vfr.rep_id', '=', filters.repId);
    if (filters.tripId) q = q.where('vfr.trip_id', '=', filters.tripId);
    if (filters.customerId) q = q.where('vfr.customer_id', '=', filters.customerId);

    const rows = await q.orderBy('vfr.id', 'desc').limit(100).execute();

    return rows.map((r: any) => ({
      ...r,
      totalAmount: Number(r.totalAmount || 0),
      items: typeof r.itemsJson === 'string' ? JSON.parse(r.itemsJson) : r.itemsJson || [],
    }));
  }
}
