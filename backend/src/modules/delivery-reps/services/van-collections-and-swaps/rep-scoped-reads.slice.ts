import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import {
  assertRepRouteForSale as assertRepRouteForSaleShared,
  listCustomerServingRepIds as listCustomerServingRepIdsShared,
} from '../../../../common/utils/rep-route-gate';
import type { VanCollectionsAndSwapsDeps } from './van-collections-and-swaps.types';

export class RepScopedReadsSlice {
  constructor(private readonly deps: VanCollectionsAndSwapsDeps) {}

  private get anyDb(): any {
    return this.deps.db;
  }

  /**
   * INV-DRIVER-PORTAL-REP-SCOPED-READS: rep scoping for driver-portal
   * reads. The trip row owns the read: a rep may only read trip data for
   * trips whose rep_id is his own. Staff callers pass no repId and skip
   * the check (the supervisor view behind a staff session).
   */
  async assertTripOwnedByRep(tenantId: string, tripId: number, repId: number): Promise<void> {
    const trip = await this.anyDb
      .selectFrom('van_sales_trips')
      .select(['id', 'rep_id'])
      .where('id', '=', tripId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!trip) {
      throw new AppError('الرحلة غير موجودة', 'TRIP_NOT_FOUND', 404);
    }
    if (Number(trip.rep_id) !== Number(repId)) {
      throw new AppError('غير مصرح لك بالاطلاع على بيانات رحلة مندوب آخر', 'FORBIDDEN', 403);
    }
  }

  /**
   * INV-REP-SCOPED-CUSTOMER-READS (H7/D1+D14): the customer ids this rep
   * has served. One canonical definition, shared by the read scope
   * (getActiveTrip / getDriverTodayItinerary) and the read gate below:
   * a field visit on one of his trips, a pre-sale order assigned to
   * him, or a delivered sale carrying his delivery_rep_id. There is no
   * static customer-to-rep assignment in the schema, so history is the
   * association — plus the explicit metadata assignment, which the
   * callers check separately via extractAssignedRepIds.
   */
  async listRepServedCustomerIds(tenantId: string, repId: number): Promise<Set<number>> {
    const ids = new Set<number>();
    const collect = (rows: any[]): void => {
      for (const row of rows || []) {
        const id = Number(row.customer_id ?? row.customerId);
        if (Number.isInteger(id) && id > 0) ids.add(id);
      }
    };
    const [visits, orders, sales] = await Promise.all([
      this.anyDb
        .selectFrom('van_field_visits')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .execute(),
      this.anyDb
        .selectFrom('sales_orders')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .execute(),
      this.anyDb
        .selectFrom('sales')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('delivery_rep_id', '=', repId)
        .execute(),
    ]);
    collect(visits);
    collect(orders);
    collect(sales);
    return ids;
  }

  /**
   * INV-DRIVER-PORTAL-REP-SCOPED-READS: a rep may read a customer's
   * field statement and last sold prices only when the codebase already
   * records him serving that customer: a field visit on one of his
   * trips, a pre-sale order assigned to him, or a delivered sale
   * carrying his delivery_rep_id. There is no static customer-to-rep
   * assignment in the schema, so history is the association. Staff
   * callers pass no repId and skip the check.
   */
  async assertRepServedCustomer(tenantId: string, repId: number, customerId: number): Promise<void> {
    const served = await this.listRepServedCustomerIds(tenantId, repId);
    if (served.has(Number(customerId))) return;
    throw new AppError('غير مصرح لك بالاطلاع على بيانات عميل لا يتبع لك', 'FORBIDDEN', 403);
  }

  /**
   * F3 (trial problem 3): the reps who have served ONE customer, the
   * transpose of listRepServedCustomerIds — same three evidence rows,
   * filtered by customer instead of by rep. Shared with the sale
   * gate below and with the POS gate (which imports the shared
   * module directly); the slice stays the canonical home.
   */
  async listCustomerServingRepIds(tenantId: string, customerId: number): Promise<Set<number>> {
    return listCustomerServingRepIdsShared(this.anyDb, tenantId, customerId);
  }

  /**
   * F3 (trial problem 3): the route gate for a sale. Refuses ONLY a
   * customer served by a DIFFERENT rep (non-empty serving set not
   * containing this rep) with CUSTOMER_NOT_ON_REP_ROUTE (403). A
   * customer with NO history anywhere (empty set) is allowed — the
   * first sale creates the association — and the rep's own served
   * customer is allowed. Deliberately NOT assertRepServedCustomer:
   * that predicate refuses any unserved customer, which would make
   * new-customer sales impossible. The supervisor-PIN override lives
   * in the callers (each path verifies its PIN through its own
   * existing override channel).
   */
  async assertRepRouteForSale(tenantId: string, repId: number, customerId: number): Promise<void> {
    return assertRepRouteForSaleShared(this.anyDb, tenantId, repId, customerId);
  }

  async listTripDamagedSwaps(tenantId: string, tripId: number, repId?: number) {
    if (repId != null) {
      await this.assertTripOwnedByRep(tenantId, tripId, repId);
    }
    return this.anyDb
      .selectFrom('van_damaged_swaps as vds')
      .leftJoin('products as dp', 'dp.id', 'vds.damaged_product_id')
      .leftJoin('products as rp', 'rp.id', 'vds.replacement_product_id')
      .leftJoin('customers as c', 'c.id', 'vds.customer_id')
      .select([
        'vds.id',
        'vds.trip_id as tripId',
        'vds.rep_id as repId',
        'vds.customer_id as customerId',
        sql<string>`coalesce(c.name, 'عميل ميداني')`.as('customerName'),
        'vds.damaged_product_id as damagedProductId',
        sql<string>`coalesce(dp.name, 'صنف تالف')`.as('damagedProductName'),
        sql<number>`cast(vds.damaged_qty as numeric)`.as('damagedQty'),
        'vds.damage_reason as damageReason',
        'vds.replacement_product_id as replacementProductId',
        sql<string>`coalesce(rp.name, 'صنف بديل')`.as('replacementProductName'),
        sql<number>`cast(vds.replacement_qty as numeric)`.as('replacementQty'),
        sql<number>`cast(vds.price_difference as numeric)`.as('priceDifference'),
        'vds.notes',
        'vds.created_at as createdAt',
      ])
      .where('vds.trip_id', '=', tripId)
      .where('vds.tenant_id', '=', tenantId)
      .orderBy('vds.id', 'desc')
      .execute();
  }
}
