import { AppError } from '../../../common/errors/app-error';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { VanFieldSalesService } from '../services/van-field-sales.service';
import type {
  ExecuteFieldSaleInternalPayload,
  ExecuteFieldSalePayload,
  ExecuteFieldSaleResult,
} from './van-sales-types';

export class FieldSaleService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly getFieldSales: () => VanFieldSalesService,
    private readonly inFlightSalePromises: Map<string, Promise<any>>,
    private readonly recentSalesCache: Map<string, { result: any; timestamp: number }>,
    // Lazy getter for the FACADE's executeFieldSaleInternal (resolved at
    // call time): specs mock that method on the facade instance after
    // construction, and the mock must win over this slice's own method.
    private readonly getExecuteFieldSaleInternal: () => (
      repId: number,
      tenantId: string,
      accountId: string,
      payload: ExecuteFieldSaleInternalPayload,
    ) => Promise<ExecuteFieldSaleResult>,
  ) {}

  private get anyDb(): any {
    return this.db;
  }

  /**
   * Executes a direct field sale in the street from van stock (Cash or Credit).
   */
  async executeFieldSale(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: ExecuteFieldSalePayload,
  ): Promise<ExecuteFieldSaleResult> {
    if (!payload.items || !payload.items.length) {
      throw new AppError('يجب تحديد صنف واحد على الأقل لإصدار الفاتورة', 'EMPTY_SALE_ITEMS', 400);
    }

    const txKey = payload.clientTxId ? `${tenantId}:${payload.tripId}:${payload.clientTxId}` : null;
    const sortedItems = [...payload.items].sort((a, b) => a.productId - b.productId);
    const itemsSig = sortedItems.map((it) => `${it.productId}:${it.qty}:${it.unitPrice ?? 0}`).join('|');
    const fingerprintKey = `${tenantId}:${payload.tripId}:${repId}:${payload.customerId || 'walkin'}:${itemsSig}`;

    // 1. In-flight Promise Deduplication: Await concurrent request and return its result
    if (txKey && this.inFlightSalePromises.has(txKey)) {
      return await this.inFlightSalePromises.get(txKey)!;
    }
    if (this.inFlightSalePromises.has(fingerprintKey)) {
      return await this.inFlightSalePromises.get(fingerprintKey)!;
    }

    // 2. Recent In-Memory Cache Deduplication (< 30s for txKey only).
    // INV-VAN-DEDUP-DISTINGUISHING-KEY: a COMPLETED sale is never
    // returned from a fingerprint-keyed cache. The fingerprint
    // (tenant+trip+rep+customer+items signature) identifies a basket,
    // not a submission: two genuinely identical baskets sold seconds
    // apart are two sales. Only the client-supplied clientTxId key
    // (txKey) caches a completed result, backed by the durable
    // [tx:clientTxId] database check below. Concurrent keyless
    // duplicates are still collapsed by the in-flight promise map
    // (step 1), and the 4-second multiset database backstop (step 4)
    // is unchanged.
    const nowMs = Date.now();
    if (txKey && this.recentSalesCache.has(txKey)) {
      const entry = this.recentSalesCache.get(txKey)!;
      if (nowMs - entry.timestamp < 30000) return entry.result;
    }

    // Register promise IMMEDIATELY (synchronously) before any await call
    const salePromise = (async () => {
      // 3. Database Idempotency Check via [tx:clientTxId]
      if (payload.clientTxId) {
        const existingSale = await this.anyDb
          .selectFrom('sales')
          .select(['id', 'doc_no', 'total', 'payment_type'])
          .where('tenant_id', '=', tenantId)
          .where('van_trip_id', '=', payload.tripId)
          .where('note', 'like', `%[tx:${payload.clientTxId}]%`)
          .executeTakeFirst();

        if (existingSale) {
          return {
            ok: true,
            saleId: Number(existingSale.id),
            docNo: existingSale.doc_no,
            total: Number(existingSale.total),
            paymentMethod: existingSale.payment_type || payload.paymentMethod,
            customerName: payload.customerName || 'عميل نقدي ميداني',
            itemsCount: payload.items.length,
            cashPaid: 0,
            creditOwed: 0,
          };
        }
      }

      // 4. Database Rapid-Fire Duplicate Check (within last 4 seconds for identical trip, rep, customer, and items count)
      const fourSecondsAgo = new Date(Date.now() - 4000);
      const recentDbSale = await this.anyDb
        .selectFrom('sales')
        .select(['id', 'doc_no', 'total', 'payment_type'])
        .where('tenant_id', '=', tenantId)
        .where('van_trip_id', '=', payload.tripId)
        .where('delivery_rep_id', '=', repId)
        .where('customer_id', payload.customerId ? '=' : 'is', payload.customerId ? Number(payload.customerId) : null)
        .where('created_at', '>=', fourSecondsAgo)
        .orderBy('id', 'desc')
        .executeTakeFirst();

      if (recentDbSale) {
        // The backstop must match the fingerprint, not just the line
        // count: comparing only the count merged a genuinely different
        // sale (different products, same number of lines) into the
        // recent one and reported it as created with cashPaid 0. Compare
        // the product/quantity multiset instead. Prices are deliberately
        // excluded: the server may adjust stored unit prices (tiers,
        // offers), so comparing stored prices against raw payload prices
        // would miss true double-taps whose prices were adjusted on the
        // first write; the in-process fingerprint layers already cover
        // the price dimension.
        const dbItems = await this.anyDb
          .selectFrom('sale_items')
          .select(['product_id', 'qty'])
          .where('sale_id', '=', Number(recentDbSale.id))
          .where('tenant_id', '=', tenantId)
          .execute();
        const dbItemsSig = [...dbItems]
          .sort((a: any, b: any) => Number(a.product_id) - Number(b.product_id))
          .map((row: any) => `${Number(row.product_id)}:${Number(row.qty)}`)
          .join('|');
        const payloadItemsSig = sortedItems.map((it) => `${Number(it.productId)}:${Number(it.qty)}`).join('|');
        if (dbItemsSig === payloadItemsSig) {
          return {
            ok: true,
            saleId: Number(recentDbSale.id),
            docNo: recentDbSale.doc_no,
            total: Number(recentDbSale.total),
            paymentMethod: recentDbSale.payment_type || payload.paymentMethod,
            customerName: payload.customerName || 'عميل نقدي ميداني',
            itemsCount: payload.items.length,
            cashPaid: 0,
            creditOwed: 0,
          };
        }
      }

      // 5. Execute internal sale — through the facade method (see ctor):
      // a spec mock on the facade instance must intercept this call.
      return await this.getExecuteFieldSaleInternal()(repId, tenantId, accountId, payload);
    })();

    if (txKey) this.inFlightSalePromises.set(txKey, salePromise);
    this.inFlightSalePromises.set(fingerprintKey, salePromise);

    try {
      const result = await salePromise;
      const ts = Date.now();
      // INV-VAN-DEDUP-DISTINGUISHING-KEY: cache the completed result
      // under the clientTxId key only — never under the fingerprint
      // key (see step 2 above).
      if (txKey) this.recentSalesCache.set(txKey, { result, timestamp: ts });

      if (this.recentSalesCache.size > 200) {
        const threshold = ts - 60000;
        for (const [k, v] of this.recentSalesCache.entries()) {
          if (v.timestamp < threshold) this.recentSalesCache.delete(k);
        }
      }
      return result;
    } finally {
      if (txKey) this.inFlightSalePromises.delete(txKey);
      this.inFlightSalePromises.delete(fingerprintKey);
    }
  }

  async executeFieldSaleInternal(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: ExecuteFieldSaleInternalPayload,
  ) {
    return this.getFieldSales().executeFieldSaleInternal(repId, tenantId, accountId, payload);
  }
}
