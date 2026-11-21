import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { evaluateDamagedSwap } from '../../van-trip-reconciliation.engine';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, type MoneyDigits } from '../../../accounting/engines/money-minor-units.engine';
import type { VanCollectionsAndSwapsDeps } from './van-collections-and-swaps.types';

export class ExecuteDamagedSwapSlice {
  constructor(private readonly deps: VanCollectionsAndSwapsDeps) {}

  private get anyDb(): any {
    return this.deps.db as any;
  }

  /**
   * Instant Field Damaged / Broken Goods Swap (استبدال التالف والمعيب الفوري في الميدان).
   * Swaps damaged/crushed/expired goods on the spot from the vehicle.
   * Decrements replacement product stock from van, increments damaged stock in van,
   * calculates any price variance, and updates customer balance if customer has an account.
   */
  async executeDamagedSwap(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId?: number;
      damagedProductId: number;
      damagedQty: number;
      damageReason?: string;
      replacementProductId: number;
      replacementQty: number;
      notes?: string;
      clientTxId?: string;
    },
  ): Promise<{
    ok: boolean;
    swapId: number;
    damagedProductName: string;
    replacementProductName: string;
    damagedQty: number;
    replacementQty: number;
    priceDifference: number;
    messageAr: string;
  }> {
    // INV-VAN-DAMAGED-SWAP-JOURNAL-QUARANTINE: idempotent replay
    // BEFORE the trip-open check — a retry may arrive after the trip
    // closed, and it must return the original swap, not INVALID_TRIP.
    if (payload.clientTxId) {
      const prior = await this.findSwapByClientTxId(this.anyDb, tenantId, payload.tripId, payload.clientTxId);
      if (prior) return this.buildDamagedSwapResult(this.anyDb, tenantId, prior);
    }

    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .select(['vt.id', 'vt.status', 'vt.van_location_id', 'vt.source_warehouse_id'])
      .where('vt.id', '=', payload.tripId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.rep_id', '=', repId)
      .executeTakeFirst();

    if (!trip || trip.status !== 'open') {
      throw new AppError('رحلة التوزيع المحددة مغلقة أو تمت تصفيتها، ولا يمكن تسجيل استبدال عليها', 'INVALID_TRIP', 400);
    }

    // Resolved on the pool handle BEFORE the transaction: the journal
    // posts on the tx handle, and a pool read inside an open PGlite
    // transaction waits forever on the single connection.
    const systemAuth = await this.deps.resolveSystemAuthContext(tenantId, accountId);

    const damagedPid = Number(payload.damagedProductId);
    const replacementPid = Number(payload.replacementProductId);
    const damagedQty = Number(payload.damagedQty || 0);
    const replacementQty = Number(payload.replacementQty || 0);

    if (damagedQty <= 0 || replacementQty <= 0) {
      throw new AppError('كمية التالف وكمية البديل يجب أن تكون أكبر من الصفر', 'INVALID_QUANTITY', 400);
    }

    let createdSwapId = 0;
    let damagedProdName = '';
    let replacementProdName = '';
    let priceDiff = 0;
    // Set inside the transaction when the in-tx replay check finds the
    // original swap (race window between the pre-tx check and this tx).
    let replayedSwap: any = null;

    await this.deps.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      // Book digits resolved once on THIS transaction handle (D4).
      const bookDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));

      // Lock the trip row FIRST: it serializes concurrent swaps and
      // retries on this trip, so the in-tx idempotency check below
      // cannot race a twin transaction (a FOR UPDATE read that finds
      // zero rows locks nothing — the trip row always exists here).
      const lockedTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id', 'status', 'van_location_id', 'source_warehouse_id'])
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedTrip || lockedTrip.status !== 'open') {
        throw new AppError('رحلة التوزيع المحددة مغلقة أو تمت تصفيتها، ولا يمكن تسجيل استبدال عليها', 'INVALID_TRIP', 400);
      }
      if (payload.clientTxId) {
        const priorInTx = await this.findSwapByClientTxId(trxAny, tenantId, payload.tripId, payload.clientTxId);
        if (priorInTx) {
          replayedSwap = priorInTx;
          return;
        }
      }
      const vanLocationId = Number(lockedTrip.van_location_id);

      // Canonical Lock Order: sort product IDs ascending to prevent deadlock
      const sortedProductIds = [damagedPid, replacementPid].sort((a, b) => a - b);
      const lockedProds = await trxAny
        .selectFrom('products')
        .select(['id', 'name', 'retail_price', 'wholesale_price', 'cost_price'])
        .where('id', 'in', sortedProductIds)
        .where('tenant_id', '=', tenantId)
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();

      const damagedProd = lockedProds.find((p: any) => Number(p.id) === damagedPid);
      const replacementProd = lockedProds.find((p: any) => Number(p.id) === replacementPid);

      if (!damagedProd) throw new AppError(`الصنف التالف #${damagedPid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);
      if (!replacementProd) throw new AppError(`الصنف البديل #${replacementPid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);

      damagedProdName = damagedProd.name || `صنف #${damagedPid}`;
      replacementProdName = replacementProd.name || `صنف #${replacementPid}`;

      // Check current van stock for replacement product
      const vanStockRow = await trxAny
        .selectFrom('product_location_stock')
        .select([sql<number>`cast(coalesce(qty, 0) as numeric)`.as('qty')])
        .where('location_id', '=', vanLocationId)
        .where('product_id', '=', replacementPid)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      const availableVanStock = Number(vanStockRow?.qty || 0);

      const damagedPrice = Number(damagedProd.retail_price || damagedProd.wholesale_price || 0);
      const replacementPrice = Number(replacementProd.retail_price || replacementProd.wholesale_price || 0);

      const evalResult = evaluateDamagedSwap({
        damagedProductId: damagedPid,
        damagedQty,
        damagedUnitPrice: damagedPrice,
        damageReason: payload.damageReason || 'تالف / كسر أثناء التوزيع',
        replacementProductId: replacementPid,
        replacementQty,
        replacementUnitPrice: replacementPrice,
        availableVanStockQty: availableVanStock,
        moneyDigits: bookDigits,
      });

      if (!evalResult.allowed) {
        throw new AppError(evalResult.errorMessageAr || 'تعذر إتمام عملية الاستبدال', evalResult.reasonCode || 'SWAP_REJECTED', 400);
      }

      priceDiff = evalResult.priceDifference;

      // INV-VAN-DAMAGED-SWAP-JOURNAL-QUARANTINE: the damaged qty must
      // NOT return to sellable van stock — mirror the returns path
      // (postVanFieldReturn isDamaged leg / van-returns.service.ts),
      // which routes damaged items to the tenant's damaged location.
      // Fail closed when the tenant has none: silently leaving the
      // damaged qty sellable in the van is worse than refusing the
      // swap. The van itself is never a quarantine target.
      const damagedLoc = await trxAny
        .selectFrom('stock_locations')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('location_type', '=', 'damaged')
        .where('id', '!=', vanLocationId)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      if (!damagedLoc?.id) {
        throw new AppError('لا يوجد موقع تالف مسجّل لهذا النشاط — سجّل موقع مخزون تالف قبل تنفيذ الاستبدال حتى لا يعود التالف مخزوناً قابلاً للبيع', 'SWAP_REJECTED', 400);
      }
      const damagedLocationId = Number(damagedLoc.id);
      const vanLocRow = await trxAny
        .selectFrom('stock_locations')
        .select(['branch_id'])
        .where('id', '=', vanLocationId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const branchId = vanLocRow?.branch_id ? Number(vanLocRow.branch_id) : null;

      // Deduct replacement stock from van
      await this.deps.moveVanStock(trx, {
        productId: replacementPid,
        delta: -replacementQty,
        locationId: vanLocationId,
        tenantId,
        accountId,
        userId: null,
        movementType: 'van_swap_out',
        note: `استبدال تالف فوري - صرف البديل (${replacementProdName})`,
        referenceType: 'van_sales_trip',
        referenceId: Number(trip.id),
        skipGlobalUpdate: false,
        unitCost: Number(replacementProd.cost_price || 0),
      });

      // Receive damaged stock into the QUARANTINE (damaged) location —
      // never back into the van as sellable stock.
      await this.deps.moveVanStock(trx, {
        productId: damagedPid,
        delta: damagedQty,
        locationId: damagedLocationId,
        tenantId,
        accountId,
        userId: null,
        movementType: 'van_swap_damaged_in',
        note: `استبدال تالف فوري - استلام التالف (${damagedProdName}) إلى موقع التالف [${payload.damageReason || 'كسر/تالف'}]`,
        referenceType: 'van_sales_trip',
        referenceId: Number(trip.id),
        skipGlobalUpdate: false,
        unitCost: Number(damagedProd.cost_price || 0),
      });

      // Record swap row in van_damaged_swaps FIRST: the journal and the
      // ledger row both key on the swap id, never on the trip id.
      const inserted = await trxAny
        .insertInto('van_damaged_swaps')
        .values({
          trip_id: payload.tripId,
          rep_id: repId,
          customer_id: payload.customerId || null,
          damaged_product_id: damagedPid,
          damaged_qty: damagedQty,
          damage_reason: payload.damageReason || 'تالف / كسر أثناء التوزيع',
          replacement_product_id: replacementPid,
          replacement_qty: replacementQty,
          price_difference: priceDiff,
          notes: payload.clientTxId
            ? `${payload.notes || ''} [tx:${payload.clientTxId}]`.trim()
            : payload.notes || null,
          tenant_id: tenantId,
          account_id: accountId,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      createdSwapId = Number(inserted.id);

      // If price difference exists and customer is specified, record difference in customer ledger
      if (priceDiff !== 0 && payload.customerId) {
        const custRecord = await trxAny
          .selectFrom('customers')
          .select(['id', 'balance'])
          .where('id', '=', payload.customerId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (custRecord) {
          const updatedCust = await trxAny
            .updateTable('customers')
            .set({
              balance: sql`coalesce(balance, 0) + ${priceDiff}`,
              updated_at: sql`NOW()`,
            })
            .where('id', '=', payload.customerId)
            .where('tenant_id', '=', tenantId)
            .returning(['balance'])
            .executeTakeFirst();

          await trxAny
            .insertInto('customer_ledger')
            .values({
              customer_id: payload.customerId,
              // 'sale_credit' mislabels this row as a credit sale (trip
              // counters read sale_credit rows as sales); a swap price
              // adjustment is its own kind, and its GL mirror is the
              // 1130 leg of the van_damaged_swap journal below.
              entry_type: 'swap_price_adjustment',
              amount: priceDiff,
              balance_after: Number(updatedCust?.balance || 0),
              note: `فارق سعر استبدال تالف #${createdSwapId}: ${replacementProdName} بدلاً من ${damagedProdName}`,
              reference_type: 'van_swap',
              reference_id: createdSwapId,
              van_trip_id: payload.tripId,
              tenant_id: tenantId,
              account_id: accountId,
            })
            .execute();
        }
      }

      // The balanced GL journal for the whole swap — same transaction
      // as the stock moves, so a failure anywhere rolls everything
      // back together. The journal's 1130 leg mirrors the ledger row
      // above; with no customer there is no receivable leg to mirror.
      await this.deps.accountingPosting.postVanDamagedSwap(
        trx,
        createdSwapId,
        {
          damagedQty,
          damagedUnitCost: Number(damagedProd.cost_price || 0),
          replacementQty,
          replacementUnitCost: Number(replacementProd.cost_price || 0),
          priceDifference: priceDiff,
          customerId: payload.customerId || null,
          branchId,
          locationId: vanLocationId,
          damagedLocationId,
        },
        systemAuth,
      );
    });

    // A twin transaction won the race and this tx replayed: return the
    // original swap, never a second execution.
    if (replayedSwap) {
      return this.buildDamagedSwapResult(this.anyDb, tenantId, replayedSwap);
    }

    return {
      ok: true,
      swapId: createdSwapId,
      damagedProductName: damagedProdName,
      replacementProductName: replacementProdName,
      damagedQty,
      replacementQty,
      priceDifference: priceDiff,
      messageAr: this.damagedSwapMessageAr(damagedQty, damagedProdName, replacementQty, replacementProdName, priceDiff),
    };
  }

  /**
   * Idempotency lookup for damaged swaps. There is no client_tx_id
   * column on van_damaged_swaps (migration 0315 deliberately adds
   * none): the `[tx:clientTxId]` tag in notes is the durable key, the
   * same pattern recordFieldSale uses for sales. `strpos` (not LIKE)
   * makes the match exact — a clientTxId containing LIKE wildcards
   * cannot match a different swap. Callers serialize on the trip row
   * FOR UPDATE before the in-transaction check, so the check is the
   * atomic guard; the swap journal's unique (source_type, source_id)
   * is the second backstop.
   */
  private async findSwapByClientTxId(db: any, tenantId: string, tripId: number, clientTxId: string): Promise<any> {
    const tag = `[tx:${clientTxId}]`;
    return db
      .selectFrom('van_damaged_swaps')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('trip_id', '=', tripId)
      .where(sql<boolean>`strpos(coalesce(notes, ''), ${tag}) > 0`)
      .orderBy('id', 'asc')
      .executeTakeFirst();
  }

  private damagedSwapMessageAr(
    damagedQty: number,
    damagedProdName: string,
    replacementQty: number,
    replacementProdName: string,
    priceDiff: number,
  ): string {
    const diffNote = priceDiff > 0
      ? ` وفارق سعر مستحق على العميل قدره ${priceDiff.toFixed(2)} ج.م`
      : priceDiff < 0
      ? ` وفارق سعر مستحق لصالح العميل قدره ${Math.abs(priceDiff).toFixed(2)} ج.م`
      : ' (استبدال متكافئ 1 لـ 1 بدون فارق سعري)';
    return `تم استبدال ${damagedQty} من (${damagedProdName}) بـ ${replacementQty} من (${replacementProdName}) بنجاح${diffNote}`;
  }

  private async buildDamagedSwapResult(db: any, tenantId: string, row: any): Promise<{
    ok: boolean;
    swapId: number;
    damagedProductName: string;
    replacementProductName: string;
    damagedQty: number;
    replacementQty: number;
    priceDifference: number;
    messageAr: string;
  }> {
    const prodRows = await db
      .selectFrom('products')
      .select(['id', 'name'])
      .where('id', 'in', [Number(row.damaged_product_id), Number(row.replacement_product_id)])
      .where('tenant_id', '=', tenantId)
      .execute();
    const byId = new Map(prodRows.map((p: any) => [Number(p.id), p.name]));
    const damagedQty = Number(row.damaged_qty || 0);
    const replacementQty = Number(row.replacement_qty || 0);
    const priceDifference = Number(row.price_difference || 0);
    const damagedProdName = String(byId.get(Number(row.damaged_product_id)) || `صنف #${Number(row.damaged_product_id)}`);
    const replacementProdName = String(byId.get(Number(row.replacement_product_id)) || `صنف #${Number(row.replacement_product_id)}`);
    return {
      ok: true,
      swapId: Number(row.id),
      damagedProductName: damagedProdName,
      replacementProductName: replacementProdName,
      damagedQty,
      replacementQty,
      priceDifference,
      messageAr: this.damagedSwapMessageAr(damagedQty, damagedProdName, replacementQty, replacementProdName, priceDifference),
    };
  }
}
