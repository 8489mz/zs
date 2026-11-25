import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';

export class ComputeAlreadyReturnedQtyBySaleItemSlice {
  constructor(private readonly db: Kysely<Database>) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Sums qty already claimed against each sale_item by a pending or approved field return, so a
   * driver can't return more of a line than was actually sold — across separate return requests,
   * not just within one.
   */
  async computeAlreadyReturnedQtyBySaleItem(tenantId: string, saleIds: number[]): Promise<Map<number, number>> {
    const returnedQtyBySaleItem = new Map<number, number>();
    if (!saleIds.length) return returnedQtyBySaleItem;

    const existingReturns = await this.anyDb
      .selectFrom('van_field_returns')
      .select(['sale_id', 'items_json', 'status'])
      .where('sale_id', 'in', saleIds)
      .where('tenant_id', '=', tenantId)
      .where(sql<boolean>`status in ('approved', 'pending_approval')`)
      .execute();

    for (const ret of existingReturns) {
      const parsedItems = typeof ret.items_json === 'string' ? JSON.parse(ret.items_json) : ret.items_json || [];
      for (const it of parsedItems) {
        if (it.saleItemId) {
          const sid = Number(it.saleItemId);
          returnedQtyBySaleItem.set(sid, (returnedQtyBySaleItem.get(sid) || 0) + Number(it.qty || 0));
        }
      }
    }
    return returnedQtyBySaleItem;
  }
}
