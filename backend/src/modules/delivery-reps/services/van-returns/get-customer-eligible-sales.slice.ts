import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import {
  currencyMoneyDigits,
  roundMoney,
  type MoneyDigits,
} from '../../../accounting/engines/money-minor-units.engine';

export type GetCustomerEligibleSalesBoundDeps = {
  computeAlreadyReturnedQtyBySaleItem(tenantId: string, saleIds: number[]): Promise<Map<number, number>>;
};

export class GetCustomerEligibleSalesSlice {
  private readonly bound: GetCustomerEligibleSalesBoundDeps;

  constructor(
    private readonly db: Kysely<Database>,
    bound: GetCustomerEligibleSalesBoundDeps,
  ) {
    this.bound = bound;
  }

  private get anyDb(): any {
    return this.db as any;
  }

  private computeAlreadyReturnedQtyBySaleItem(tenantId: string, saleIds: number[]): Promise<Map<number, number>> {
    return this.bound.computeAlreadyReturnedQtyBySaleItem(tenantId, saleIds);
  }

  /**
   * Fetches recent sales for a customer with eligible items and their calculated net unit prices.
   * When `repId` is provided (from the driver portal), strictly isolates to sales owned by that rep.
   */
  async getCustomerEligibleSales(tenantId: string, customerId: number, repId?: number) {
    // Book digits resolved once (D4): the derived net unit price below
    // rounds at book digits, never a hardcoded 2dp.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    let query = this.anyDb
      .selectFrom('sales as s')
      .leftJoin('van_sales_trips as vt', (join: any) =>
        join.onRef('vt.id', '=', 's.van_trip_id').onRef('vt.tenant_id', '=', 's.tenant_id'),
      )
      .select([
        's.id',
        's.doc_no as docNo',
        's.created_at as createdAt',
        sql<number>`cast(coalesce(s.total, 0) as numeric)`.as('total'),
        sql<number>`cast(coalesce(s.discount, 0) as numeric)`.as('discount'),
        // INV-VAN-RETURN-REFUND-METHOD-DEFAULT: the return form
        // defaults the settlement from the source invoice's payment
        // type — without this the form hardcoded 'credit' and a
        // return against a cash invoice was refused by the server.
        's.payment_type as paymentType',
      ])
      .where('s.customer_id', '=', customerId)
      .where('s.tenant_id', '=', tenantId)
      .where('s.status', '=', 'posted');

    if (repId !== undefined && repId !== null && Number(repId) > 0) {
      query = query.where(sql<boolean>`coalesce(s.delivery_rep_id, vt.rep_id) = ${Number(repId)}`);
    }

    const sales = await query.orderBy('s.id', 'desc').limit(20).execute();

    if (!sales.length) return [];

    const saleIds = sales.map((s: any) => Number(s.id));
    const items = await this.anyDb
      .selectFrom('sale_items as si')
      .innerJoin('products as p', 'p.id', 'si.product_id')
      .select([
        'si.id as saleItemId',
        'si.sale_id as saleId',
        'si.product_id as productId',
        'si.product_name as productName',
        sql<number>`cast(coalesce(si.qty, 0) as numeric)`.as('soldQty'),
        sql<number>`cast(coalesce(si.unit_price, 0) as numeric)`.as('unitPrice'),
        sql<number>`cast(coalesce(si.line_total, 0) as numeric)`.as('lineTotal'),
        // INV-VAN-FIELD-RETURN-CARTON-QTY: the return form and the
        // approval need the sale unit — without it a carton return
        // posts its raw qty as pieces.
        sql<number>`cast(coalesce(si.unit_multiplier, 1) as numeric)`.as('unitMultiplier'),
        sql<string>`coalesce(si.unit_name, 'قطعة')`.as('unitName'),
      ])
      .where('si.sale_id', 'in', saleIds)
      .where('si.tenant_id', '=', tenantId)
      .execute();

    const returnedQtyBySaleItem = await this.computeAlreadyReturnedQtyBySaleItem(tenantId, saleIds);

    const itemsBySale = new Map<number, any[]>();
    for (const it of items) {
      const sid = Number(it.saleId);
      const soldQty = Number(it.soldQty || 0);
      const lineTotal = Number(it.lineTotal || 0);
      const netUnitPrice = soldQty > 0 ? roundMoney(lineTotal / soldQty, moneyDigits) : 0;
      const alreadyReturned = returnedQtyBySaleItem.get(Number(it.saleItemId)) || 0;
      const remainingReturnableQty = Math.max(0, soldQty - alreadyReturned);

      const entry = {
        saleItemId: Number(it.saleItemId),
        productId: Number(it.productId),
        productName: it.productName,
        soldQty,
        alreadyReturnedQty: alreadyReturned,
        remainingReturnableQty,
        unitPrice: Number(it.unitPrice || 0),
        netUnitPrice,
        unitMultiplier: Number(it.unitMultiplier || 1),
        unitName: String(it.unitName || 'قطعة'),
      };

      if (!itemsBySale.has(sid)) itemsBySale.set(sid, []);
      itemsBySale.get(sid)!.push(entry);
    }

    return sales.map((s: any) => ({
      id: Number(s.id),
      docNo: s.docNo || `#${s.id}`,
      createdAt: String(s.createdAt),
      total: Number(s.total || 0),
      discount: Number(s.discount || 0),
      // INV-VAN-RETURN-REFUND-METHOD-DEFAULT: '' for a legacy NULL
      // payment_type — the form treats any non-'credit' as cash.
      paymentType: String(s.paymentType || ''),
      items: itemsBySale.get(Number(s.id)) || [],
    }));
  }
}
