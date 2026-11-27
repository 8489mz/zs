import { Kysely, sql } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { formatDailyDocumentNumber } from '../../../../common/utils/document-number.util';
import { getTenantTimezone, normalizePgDateOnly, todayTenantDate } from '../../../../common/utils/tenant-timezone.util';
import { reserveLocationStock } from '../../../../common/utils/location-stock-ledger';
import { sortItemsByProductId } from '../van-common.util';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import {
  currencyMoneyDigits,
  roundMoney,
  type MoneyDigits,
} from '../../../accounting/engines/money-minor-units.engine';
import type { CreatePreSalesOrderDto, CreatePreSalesOrderResult } from './van-pre-sales-types';

export class CreatePreSalesOrderSlice {
  private get anyDb(): any {
    return this.db;
  }

  constructor(
    private readonly db: Kysely<Database>,
    private readonly resolveDefaultWarehouseLocationId: (
      tenantId: string,
      preferredLocationId?: number,
      productIds?: number[],
    ) => Promise<number | null>,
  ) {}

  /**
   * Rep books a Pre-Sales order from warehouse catalog, reserving inventory atomically.
   */
  async createPreSalesOrder(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: CreatePreSalesOrderDto,
  ): Promise<CreatePreSalesOrderResult> {
    if (!payload.items || !payload.items.length) {
      throw new AppError('يجب تحديد صنف واحد على الأقل لحجز الطلبية', 'EMPTY_PRESALE_ITEMS', 400);
    }

    // Resolve or create customer
    let customerId: number | null = payload.customerId ? Number(payload.customerId) : null;
    let customerName = (payload.customerName || '').trim() || 'عميل تجزئة ميداني';

    if (payload.paymentMethod === 'credit' && !customerId && !payload.customerName) {
      throw new AppError('الطلبيات الآجلة تتطلب تحديد اسم العميل', 'CREDIT_REQUIRES_CUSTOMER', 400);
    }

    // INV-VAN-PRE-SALES-CUSTOMER-ATTRIBUTION: when the rep picked an
    // existing customer, resolve the name (and phone/address) from the
    // tenant-scoped customer row — otherwise the order is stored
    // under the generic default 'عميل تجزئة ميداني' and no read path
    // can attribute it (every read selects the denormalized
    // so.customer_name). The row is authoritative for an existing
    // customer; the default survives only when no row is found.
    // Phone/address come from the row only when the payload omits
    // them.
    let customerPhone = payload.customerPhone || null;
    let customerAddress = payload.customerAddress || null;
    if (customerId) {
      const byId = await this.anyDb
        .selectFrom('customers')
        .select(['id', 'name', 'phone', 'address'])
        .where('id', '=', customerId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (byId) {
        customerName = byId.name;
        if (!customerPhone) customerPhone = byId.phone || null;
        if (!customerAddress) customerAddress = byId.address || null;
      }
    }

    if (!customerId && payload.customerName?.trim()) {
      const existing = await this.anyDb
        .selectFrom('customers')
        .select(['id', 'name'])
        .where('name', '=', payload.customerName.trim())
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (existing) {
        customerId = Number(existing.id);
        customerName = existing.name;
      } else {
        const [created] = await this.anyDb
          .insertInto('customers')
          .values({
            name: payload.customerName.trim(),
            phone: payload.customerPhone || null,
            address: payload.customerAddress || null,
            is_active: true,
            tenant_id: tenantId,
            account_id: accountId,
          })
          .returning(['id', 'name'])
          .execute();
        customerId = Number(created.id);
        customerName = created.name;
      }
    }

    // Resolve warehouse location consistently using smart resolution
    const productIdsForLookup = payload.items.map((it: any) => Number(it.productId)).filter((id: number) => id > 0);
    let warehouseLocId = payload.warehouseLocationId ? Number(payload.warehouseLocationId) : 0;
    if (!warehouseLocId) {
      const resolved = await this.resolveDefaultWarehouseLocationId(tenantId, undefined, productIdsForLookup);
      if (resolved) warehouseLocId = resolved;
    }

    let orderId = 0;
    let finalOrderNumber = '';
    let totalAmount = 0;
    let grossSubtotalAmount = 0;
    let totalDiscountAmount = 0;

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx;
      // Book digits resolved once on THIS transaction handle (D4):
      // every derived pre-sale price/total below rounds at book digits.
      const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      const sortedItems = sortItemsByProductId(payload.items);
      const productIds = sortedItems.map((it) => Number(it.productId));

      // Fetch active offers for these products — the offer day is
      // the TENANT day (P7, single-server-clock rule).
      const nowIso = todayTenantDate(await getTenantTimezone(trx, tenantId));
      const offers = await trxAny
        .selectFrom('product_offers')
        .select([
          'product_id',
          'offer_type',
          'value',
          'min_qty',
          'start_date',
          'end_date',
          'bogo_buy_qty',
          'bogo_get_qty',
          'bogo_discount_percent',
        ])
        .where('product_id', 'in', productIds)
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .execute();

      const offersByProduct = new Map<number, any[]>();
      for (const off of offers) {
        const pid = Number(off.product_id);
        const start = normalizePgDateOnly(off.start_date);
        const end = normalizePgDateOnly(off.end_date);
        if ((!start || start <= nowIso) && (!end || end >= nowIso)) {
          if (!offersByProduct.has(pid)) offersByProduct.set(pid, []);
          offersByProduct.get(pid)!.push(off);
        }
      }

      const preparedOrderItems: any[] = [];

      for (const item of sortedItems) {
        const pid = Number(item.productId);
        const qty = Number(item.qty ?? item.quantity ?? 0);
        if (qty <= 0) continue;

        // Canonical Lock: Lock product row first
        const prod = await trxAny
          .selectFrom('products')
          .select([
            'id',
            'name',
            'cost_price',
            'retail_price',
            'wholesale_price',
            'credit_price',
            'consumer_price',
            'stock_qty',
            'reserved_qty',
          ])
          .where('id', '=', pid)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!prod) {
          throw new AppError(`الصنف رقم #${pid} غير موجود في الكتالوج`, 'PRODUCT_NOT_FOUND', 404);
        }

        const rawMultiplier = item.unitMultiplier ?? (item as any).multiplier ?? 1;
        const multiplier = Number(rawMultiplier) > 0 ? Number(rawMultiplier) : 1;
        const totalBaseQty = Number((qty * multiplier).toFixed(3));
        const availableStock = Math.max(0, Number(prod.stock_qty || 0) - Number(prod.reserved_qty || 0));

        if (availableStock < totalBaseQty) {
          throw new AppError(
            `رصيد المخزن المتاح للصنف "${prod.name}" لا يكفي. المتاح للحجز: ${availableStock}، المطلوب: ${totalBaseQty}`,
            'INSUFFICIENT_WAREHOUSE_STOCK',
            400,
          );
        }

        // Determine baseline list price (Credit Price is official catalog baseline):
        const creditBasePrice =
          prod.credit_price != null && Number(prod.credit_price) > 0
            ? Number(prod.credit_price) * multiplier
            : Number(prod.retail_price || 0) * multiplier;

        const cashBasePrice = Number(prod.retail_price || 0) * multiplier;
        const listPrice = Math.max(creditBasePrice, cashBasePrice);

        const isCredit = payload.paymentMethod === 'credit';
        // When cash: grant cash discount equal to difference between list/credit price and cash price
        const cashDiscountPerUnit = isCredit ? 0 : Math.max(0, roundMoney(listPrice - cashBasePrice, moneyDigits));

        let unitPrice = isCredit ? listPrice : item.unitPrice ? Number(item.unitPrice) : cashBasePrice;
        let pricingTierType: 'cash' | 'credit' | 'offer' = isCredit ? 'credit' : 'cash';
        let unitOfferSavings = 0;

        // Check applicable offers
        const activeOffers = offersByProduct.get(pid) || [];
        const getMinQty = (o: any) =>
          o.offer_type === 'bogo'
            ? Number(o.bogo_buy_qty || 1) + Number(o.bogo_get_qty || 1)
            : Math.max(1, Number(o.min_qty || 1));
        const matchingOffer = activeOffers
          .filter((off) => totalBaseQty >= getMinQty(off))
          .sort((a, b) => getMinQty(b) - getMinQty(a))[0];

        if (matchingOffer && !item.unitPrice) {
          const offerVal = Number(matchingOffer.value || 0);
          if (matchingOffer.offer_type === 'percent' && offerVal > 0) {
            unitPrice = Math.max(0, roundMoney(unitPrice * (1 - offerVal / 100), moneyDigits));
            pricingTierType = 'offer';
            unitOfferSavings = Math.max(0, roundMoney(listPrice - unitPrice, moneyDigits));
          } else if (matchingOffer.offer_type === 'fixed' && offerVal > 0) {
            unitPrice = Math.max(0, roundMoney(unitPrice - offerVal * multiplier, moneyDigits));
            pricingTierType = 'offer';
            unitOfferSavings = Math.max(0, roundMoney(listPrice - unitPrice, moneyDigits));
          } else if (matchingOffer.offer_type === 'price' && offerVal > 0) {
            unitPrice = roundMoney(offerVal * multiplier, moneyDigits);
            pricingTierType = 'offer';
            unitOfferSavings = Math.max(0, roundMoney(listPrice - unitPrice, moneyDigits));
          } else if (matchingOffer.offer_type === 'bundle' && offerVal > 0) {
            const minQ = Math.max(1, Number(matchingOffer.min_qty || 1));
            const bundles = Math.floor(qty / minQ);
            const rem = qty % minQ;
            const bundleTotal = bundles * offerVal + rem * listPrice;
            unitPrice = roundMoney(bundleTotal / qty, moneyDigits);
            pricingTierType = 'offer';
            unitOfferSavings = Math.max(0, roundMoney(listPrice - unitPrice, moneyDigits));
          } else if (matchingOffer.offer_type === 'bogo') {
            const buyQ = Math.max(1, Number(matchingOffer.bogo_buy_qty || 1));
            const getQ = Math.max(1, Number(matchingOffer.bogo_get_qty || 1));
            const discPct = Math.min(
              100,
              Math.max(0, Number(matchingOffer.bogo_discount_percent ?? (offerVal || 100))),
            );
            const cycle = buyQ + getQ;
            if (qty >= cycle) {
              const fullCycles = Math.floor(qty / cycle);
              const rem = qty % cycle;
              const freeUnits = fullCycles * getQ + Math.max(0, rem - buyQ);
              const discAmt = freeUnits * listPrice * (discPct / 100);
              const netTot = Math.max(0, qty * listPrice - discAmt);
              unitPrice = roundMoney(netTot / qty, moneyDigits);
              pricingTierType = 'offer';
              unitOfferSavings = Math.max(0, roundMoney(listPrice - unitPrice, moneyDigits));
            }
          }
        }

        const lineGrossTotal = roundMoney(listPrice * qty, moneyDigits);
        const lineNetTotal = roundMoney(unitPrice * qty, moneyDigits);
        const lineDiscount = Math.max(0, roundMoney(lineGrossTotal - lineNetTotal, moneyDigits));

        grossSubtotalAmount += lineGrossTotal;
        totalDiscountAmount += lineDiscount;
        totalAmount += lineNetTotal;

        const consumerPrice =
          prod.consumer_price != null && Number(prod.consumer_price) > 0
            ? roundMoney(Number(prod.consumer_price) * multiplier, moneyDigits)
            : null;

        preparedOrderItems.push({
          productId: pid,
          productName: prod.name,
          unitName: item.unitName || 'قطعة',
          quantity: qty,
          unitMultiplier: multiplier,
          totalBaseQty,
          listPrice,
          unitPrice,
          consumerPrice,
          pricingTierType,
          unitOfferSavings,
          cashDiscountPerUnit,
          lineDiscount,
          lineTotal: lineNetTotal,
        });
      }

      // Atomically reserve inventory at location and product level
      await reserveLocationStock(trx, {
        tenantId,
        accountId,
        locationId: warehouseLocId > 0 ? warehouseLocId : null,
        items: preparedOrderItems.map((item) => ({
          productId: item.productId,
          qty: item.totalBaseQty,
        })),
      });

      // Generate order number SO-YYMMDD-XXXX
      const tempOrderNo = `TMP-SO-${Date.now()}`;
      const [insertedOrder] = await trxAny
        .insertInto('sales_orders')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          order_number: tempOrderNo,
          customer_id: customerId,
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_address: customerAddress,
          branch_id: null,
          warehouse_location_id: warehouseLocId > 0 ? warehouseLocId : null,
          rep_id: repId,
          order_source: 'pre_sales_rep',
          payment_terms: payload.paymentMethod,
          subtotal: roundMoney(grossSubtotalAmount, moneyDigits),
          discount_amount: roundMoney(totalDiscountAmount, moneyDigits),
          tax_amount: 0,
          total_amount: roundMoney(totalAmount, moneyDigits),
          status: 'pending_approval',
          notes: payload.notes || null,
          delivery_date: payload.deliveryDate ? new Date(payload.deliveryDate) : null,
          created_by: null,
          created_at: sql`NOW()`,
          updated_at: sql`NOW()`,
        })
        .returning(['id'])
        .execute();

      orderId = Number(insertedOrder.id);
      finalOrderNumber = formatDailyDocumentNumber(
        'SO',
        orderId,
        new Date(),
        4,
        await getTenantTimezone(trx, tenantId),
      );

      await trxAny
        .updateTable('sales_orders')
        .set({ order_number: finalOrderNumber })
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .execute();

      for (const poi of preparedOrderItems) {
        await trxAny
          .insertInto('sales_order_items')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            sales_order_id: orderId,
            product_id: poi.productId,
            product_name: poi.productName,
            unit_name: poi.unitName,
            unit_multiplier: poi.unitMultiplier,
            quantity: poi.quantity,
            reserved_quantity: poi.totalBaseQty,
            delivered_quantity: 0,
            unit_price: poi.unitPrice,
            consumer_price: poi.consumerPrice,
            pricing_tier_type: poi.pricingTierType,
            unit_offer_savings: poi.unitOfferSavings,
            discount: poi.lineDiscount,
            total: poi.lineTotal,
            created_at: sql`NOW()`,
          })
          .execute();
      }
    });

    return {
      ok: true,
      orderId,
      orderNumber: finalOrderNumber,
      totalAmount,
      itemsCount: payload.items.length,
    };
  }
}
