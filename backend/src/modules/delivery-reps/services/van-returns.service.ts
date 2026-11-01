import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { moveVanStock, sortItemsByProductId, generateDailySequenceNumber } from './van-common.util';
import { VanFraudRadarService } from './van-fraud-radar.service';

@Injectable()
export class VanReturnsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
    private readonly fraudRadar?: VanFraudRadarService,
  ) {}

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
      const parsedItems = typeof ret.items_json === 'string' ? JSON.parse(ret.items_json) : (ret.items_json || []);
      for (const it of parsedItems) {
        if (it.saleItemId) {
          const sid = Number(it.saleItemId);
          returnedQtyBySaleItem.set(sid, (returnedQtyBySaleItem.get(sid) || 0) + Number(it.qty || 0));
        }
      }
    }
    return returnedQtyBySaleItem;
  }

  /**
   * Fetches recent sales for a customer with eligible items and their calculated net unit prices.
   * When `repId` is provided (from the driver portal), strictly isolates to sales owned by that rep.
   */
  async getCustomerEligibleSales(tenantId: string, customerId: number, repId?: number) {
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
      ])
      .where('s.customer_id', '=', customerId)
      .where('s.tenant_id', '=', tenantId)
      .where('s.status', '=', 'posted');

    if (repId !== undefined && repId !== null && Number(repId) > 0) {
      query = query.where(sql<boolean>`coalesce(s.delivery_rep_id, vt.rep_id) = ${Number(repId)}`);
    }

    const sales = await query
      .orderBy('s.id', 'desc')
      .limit(20)
      .execute();

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
      const netUnitPrice = soldQty > 0 ? Number((lineTotal / soldQty).toFixed(2)) : 0;
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
      items: itemsBySale.get(Number(s.id)) || [],
    }));
  }

  /**
   * Submits a field return request by the driver, recorded with 'pending_approval'
   * until approved by warehouse manager/admin.
   */
  async submitFieldReturn(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId: number;
      saleId?: number | null;
      returnReason: 'damaged' | 'expired' | 'manufacturing_defect' | 'stagnant' | 'order_mismatch' | 'customer_request';
      refundMethod?: 'credit' | 'cash';
      items: {
        productId: number;
        qty: number;
        unitPrice: number;
        saleItemId?: number;
      }[];
      notes?: string;
    },
  ) {
    if (!payload.items || !payload.items.length) {
      throw new AppError('يجب تحديد صنف واحد على الأقل للمرتجع', 'EMPTY_RETURN_ITEMS', 400);
    }

    const trip = await this.anyDb
      .selectFrom('van_sales_trips')
      .select(['id', 'status', 'van_location_id', 'cash_collected'])
      .where('id', '=', payload.tripId)
      .where('tenant_id', '=', tenantId)
      .where('rep_id', '=', repId)
      .executeTakeFirst();
    if (!trip || trip.status !== 'open') {
      throw new AppError('رحلة التوزيع المحددة مغلقة أو غير صالحة', 'INVALID_TRIP', 400);
    }

    const cust = await this.anyDb
      .selectFrom('customers')
      .select(['id', 'name'])
      .where('id', '=', payload.customerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!cust) throw new AppError('العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);

    let totalAmount = 0;
    for (const item of payload.items) {
      const q = Number(item.qty || 0);
      const p = Number(item.unitPrice || 0);
      if (q <= 0) {
        throw new AppError('كمية المرتجع يجب أن تكون أكبر من صفر', 'INVALID_RETURN_QTY', 400);
      }
      if (p < 0) {
        throw new AppError('سعر المرتجع غير صالح', 'INVALID_RETURN_PRICE', 400);
      }
      totalAmount += q * p;
    }
    totalAmount = Number(totalAmount.toFixed(2));

    // If saleId is linked, validate against original invoice lines and rep isolation
    if (payload.saleId) {
      const sale = await this.anyDb
        .selectFrom('sales as s')
        .leftJoin('van_sales_trips as vt', (join: any) =>
          join.onRef('vt.id', '=', 's.van_trip_id').onRef('vt.tenant_id', '=', 's.tenant_id'),
        )
        .select([
          's.id',
          's.doc_no',
          's.customer_id',
          sql<number | null>`coalesce(s.delivery_rep_id, vt.rep_id)`.as('resolved_rep_id'),
        ])
        .where('s.id', '=', payload.saleId)
        .where('s.tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!sale) throw new AppError('الفاتورة الأصلية غير موجودة', 'SALE_NOT_FOUND', 404);
      if (Number(sale.customer_id) !== Number(payload.customerId)) {
        await this.fraudRadar?.recordSuspicionEvent({
          tenantId,
          accountId,
          repId,
          tripId: payload.tripId,
          customerId: payload.customerId,
          customerName: cust.name,
          eventCode: 'VAN_SUSPICION_FRAUDULENT_RETURN',
          severity: 'high',
          titleAr: 'محاولة مرتجع على فاتورة تخص عميلاً آخر',
          detailsAr: `حاول المندوب رفع مرتجع للعميل "${cust.name}" مربوطاً بفاتورة #${sale.doc_no || sale.id} تخص عميلاً آخر.`,
          attemptedAmount: totalAmount,
          referenceType: 'sale',
          referenceId: Number(payload.saleId),
        });
        throw new AppError('الفاتورة المحددة لا تخص هذا العميل', 'SALE_CUSTOMER_MISMATCH', 400);
      }
      if (sale.resolved_rep_id != null && Number(sale.resolved_rep_id) !== Number(repId)) {
        await this.fraudRadar?.recordSuspicionEvent({
          tenantId,
          accountId,
          repId,
          tripId: payload.tripId,
          customerId: payload.customerId,
          customerName: cust.name,
          eventCode: 'VAN_SUSPICION_FRAUDULENT_RETURN',
          severity: 'critical',
          titleAr: 'محاولة مرتجع عابر للمناديب على فاتورة زميل آخر',
          detailsAr: `حاول المندوب عمل مرتجع بقيمة ${totalAmount} ج.م للعميل "${cust.name}" على فاتورة (#${sale.doc_no || sale.id}) تخص مندوباً آخر (#${sale.resolved_rep_id}).`,
          attemptedAmount: totalAmount,
          referenceType: 'sale',
          referenceId: Number(payload.saleId),
        });
        throw new AppError(
          'لا يمكن عمل مرتجع على فاتورة تخص مندوباً آخر — عهد وحسابات كل مندوب معزولة تماماً',
          'SALE_REP_MISMATCH',
          403,
        );
      }

      const saleLines = await this.anyDb
        .selectFrom('sale_items')
        .selectAll()
        .where('sale_id', '=', payload.saleId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const alreadyReturnedBySaleItem = await this.computeAlreadyReturnedQtyBySaleItem(tenantId, [Number(payload.saleId)]);

      for (const item of payload.items) {
        const line = item.saleItemId
          ? saleLines.find((sl: any) => Number(sl.id) === Number(item.saleItemId))
          : saleLines.find((sl: any) => Number(sl.product_id) === Number(item.productId));
        if (!line) {
          await this.fraudRadar?.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerId: payload.customerId,
            customerName: cust.name,
            eventCode: 'VAN_SUSPICION_FRAUDULENT_RETURN',
            severity: 'high',
            titleAr: 'محاولة رد صنف غير مدرج في الفاتورة الأصلية',
            detailsAr: `حاول المندوب رد الصنف #${item.productId} على الفاتورة #${sale.doc_no || sale.id} وهو غير موجود بها.`,
            attemptedAmount: totalAmount,
            referenceType: 'sale',
            referenceId: Number(payload.saleId),
          });
          throw new AppError(`الصنف #${item.productId} لم يتم العثور عليه في الفاتورة الأصلية`, 'ITEM_NOT_IN_SALE', 400);
        }
        const soldQty = Number(line.qty || 0);
        const lineTotal = Number(line.line_total || 0);
        const netUnit = soldQty > 0 ? Number((lineTotal / soldQty).toFixed(2)) : 0;
        if (Number(item.unitPrice) > netUnit + 0.05) {
          await this.fraudRadar?.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerId: payload.customerId,
            customerName: cust.name,
            eventCode: 'VAN_SUSPICION_FRAUDULENT_RETURN',
            severity: 'critical',
            titleAr: 'تلاعب بتضخيم سعر المرتجع فوق السعر الصافي للبيع',
            detailsAr: `حاول المندوب رد الصنف "${line.product_name || item.productId}" بسعر (${item.unitPrice} ج.م) أعلى من سعر بيعه الصافي بعد الخصم (${netUnit} ج.م) لتضخيم رصيد العميل أو سحب كاش إضافي.`,
            attemptedAmount: totalAmount,
            referenceType: 'sale',
            referenceId: Number(payload.saleId),
          });
          throw new AppError(`سعر المرتجع (${item.unitPrice}) يتجاوز السعر الصافي بعد الخصم بالفاتورة الأصلية (${netUnit})`, 'RETURN_PRICE_EXCEEDS_NET', 400);
        }

        const alreadyReturned = alreadyReturnedBySaleItem.get(Number(line.id)) || 0;
        const remainingReturnableQty = Number((soldQty - alreadyReturned).toFixed(3));
        if (Number(item.qty) > remainingReturnableQty + 0.001) {
          await this.fraudRadar?.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerId: payload.customerId,
            customerName: cust.name,
            eventCode: 'VAN_SUSPICION_FRAUDULENT_RETURN',
            severity: 'high',
            titleAr: 'محاولة رد كمية تتجاوز المباع في الفاتورة',
            detailsAr: `حاول المندوب رد كمية (${item.qty}) من الصنف "${line.product_name || item.productId}" بينما المتبقي القابل للرد (${Math.max(0, remainingReturnableQty)}).`,
            attemptedAmount: totalAmount,
            referenceType: 'sale',
            referenceId: Number(payload.saleId),
          });
          throw new AppError(
            `الكمية المطلوب ردها (${item.qty}) تتجاوز المتبقي القابل للرد من الفاتورة الأصلية (${Math.max(0, remainingReturnableQty)}) — بيع ${soldQty}، مرتجع سابقاً ${alreadyReturned}`,
            'RETURN_QTY_EXCEEDS_SOLD',
            400,
          );
        }
      }
    } else {
      // Unlinked return (no saleId provided):
      // Must still verify against the rep's actual historical sales to this customer and catalog price ceiling!
      const repCustomerSales = await this.anyDb
        .selectFrom('sales as s')
        .leftJoin('van_sales_trips as vt', (join: any) =>
          join.onRef('vt.id', '=', 's.van_trip_id').onRef('vt.tenant_id', '=', 's.tenant_id'),
        )
        .select(['s.id'])
        .where('s.customer_id', '=', payload.customerId)
        .where('s.tenant_id', '=', tenantId)
        .where('s.status', '=', 'posted')
        .where(sql<boolean>`coalesce(s.delivery_rep_id, vt.rep_id) = ${Number(repId)}`)
        .execute();

      const repSaleIds = repCustomerSales.map((s: any) => Number(s.id));
      if (!repSaleIds.length) {
        await this.fraudRadar?.recordSuspicionEvent({
          tenantId,
          accountId,
          repId,
          tripId: payload.tripId,
          customerId: payload.customerId,
          customerName: cust.name,
          eventCode: 'VAN_SUSPICION_FRAUDULENT_RETURN',
          severity: 'critical',
          titleAr: 'محاولة مرتجع وهمي بدون سابقة مبيعات للمندوب مع العميل',
          detailsAr: `حاول المندوب رفع مرتجع بدون رقم فاتورة بقيمة ${totalAmount} ج.م للعميل "${cust.name}" رغم عدم وجود أي مبيعات سابقة لهذا المندوب مع العميل.`,
          attemptedAmount: totalAmount,
        });
        throw new AppError(
          'لا يمكن تسجيل مرتجع بدون فاتورة لعميل لم يسبق لهذا المندوب البيع له',
          'NO_REP_SALES_HISTORY_FOR_RETURN',
          403,
        );
      }

      const soldLines = await this.anyDb
        .selectFrom('sale_items')
        .select(['product_id', 'product_name', 'qty', 'line_total'])
        .where('sale_id', 'in', repSaleIds)
        .where('tenant_id', '=', tenantId)
        .execute();

      const existingCustomerReturns = await this.anyDb
        .selectFrom('van_field_returns')
        .select(['items_json'])
        .where('customer_id', '=', payload.customerId)
        .where('rep_id', '=', repId)
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`status in ('approved', 'pending_approval')`)
        .execute();

      const returnedByProduct = new Map<number, number>();
      for (const retRow of existingCustomerReturns) {
        const parsed = typeof retRow.items_json === 'string' ? JSON.parse(retRow.items_json) : (retRow.items_json || []);
        for (const it of parsed) {
          const pid = Number(it.productId);
          returnedByProduct.set(pid, (returnedByProduct.get(pid) || 0) + Number(it.qty || 0));
        }
      }

      for (const item of payload.items) {
        const pid = Number(item.productId);
        const matchingLines = soldLines.filter((sl: any) => Number(sl.product_id) === pid);
        const totalSoldQty = matchingLines.reduce((sum: number, sl: any) => sum + Number(sl.qty || 0), 0);
        const maxNetUnitPrice = matchingLines.reduce((maxP: number, sl: any) => {
          const q = Number(sl.qty || 0);
          const netU = q > 0 ? Number((Number(sl.line_total || 0) / q).toFixed(2)) : 0;
          return Math.max(maxP, netU);
        }, 0);

        const alreadyRet = returnedByProduct.get(pid) || 0;
        const remainingQty = Number((totalSoldQty - alreadyRet).toFixed(3));

        if (totalSoldQty <= 0 || Number(item.qty) > remainingQty + 0.001) {
          await this.fraudRadar?.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerId: payload.customerId,
            customerName: cust.name,
            eventCode: 'VAN_SUSPICION_FRAUDULENT_RETURN',
            severity: 'critical',
            titleAr: 'محاولة مرتجع غير مربوط بفاتورة يتجاوز مبيعات المندوب للعميل',
            detailsAr: `حاول المندوب رد كمية (${item.qty}) من الصنف #${pid} للعميل "${cust.name}" بدون فاتورة بينما المتبقي القابل للرد من سجل مبيعاته هو (${Math.max(0, remainingQty)}).`,
            attemptedAmount: totalAmount,
          });
          throw new AppError(
            `الكمية المطلوب ردها (${item.qty}) للصنف #${pid} تتجاوز إجمالي ما باعه هذا المندوب للعميل صافي المرتجعات السابقة (${Math.max(0, remainingQty)})`,
            'RETURN_QTY_EXCEEDS_SOLD',
            400,
          );
        }

        if (Number(item.unitPrice) > maxNetUnitPrice + 0.05) {
          await this.fraudRadar?.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerId: payload.customerId,
            customerName: cust.name,
            eventCode: 'VAN_SUSPICION_FRAUDULENT_RETURN',
            severity: 'critical',
            titleAr: 'تلاعب بتضخيم سعر المرتجع فوق أعلى سعر بيع صافي للعميل',
            detailsAr: `حاول المندوب رد الصنف #${pid} بسعر (${item.unitPrice} ج.م) أعلى من السعر الصافي الذي بيع به للعميل (${maxNetUnitPrice} ج.م).`,
            attemptedAmount: totalAmount,
          });
          throw new AppError(
            `سعر المرتجع (${item.unitPrice}) يتجاوز السعر الصافي الذي بيع به الصنف للعميل (${maxNetUnitPrice})`,
            'RETURN_PRICE_EXCEEDS_NET',
            400,
          );
        }
      }
    }

    if ((payload.refundMethod || 'credit') === 'cash') {
      const currentTripCash = Number(trip.cash_collected || 0);
      if (totalAmount > currentTripCash + 0.01) {
        await this.fraudRadar?.recordSuspicionEvent({
          tenantId,
          accountId,
          repId,
          tripId: payload.tripId,
          customerId: payload.customerId,
          customerName: cust.name,
          eventCode: 'VAN_SUSPICION_FRAUDULENT_RETURN',
          severity: 'high',
          titleAr: 'محاولة صرف مرتجع نقدي يتجاوز النقدية المحصلة بالرحلة',
          detailsAr: `حاول المندوب تسجيل مرتجع نقدي بقيمة (${totalAmount} ج.م) بينما إجمالي النقدية بعهدته في الرحلة (${currentTripCash} ج.م).`,
          attemptedAmount: totalAmount,
        });
        throw new AppError(
          `رصيد النقدية المحصلة بعهدة المندوب بالرحلة (${currentTripCash} ج.م) لا يكفي لصرف مرتجع نقدي فوري بقيمة (${totalAmount} ج.م)`,
          'INSUFFICIENT_REP_CASH_FOR_REFUND',
          400,
        );
      }
    }

    // INV-SEQUENCE-NUMBER-FAIL-CLOSED: the insert, the locked MAX+1
    // numbering, and the rename run in one transaction. Validation
    // reads above stay outside; only the numbering unit is atomic.
    const created = await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      const tempDocNo = `TMP-VRET-${Date.now()}`;
      const [inserted] = await trxAny
        .insertInto('van_field_returns')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          doc_no: tempDocNo,
          trip_id: payload.tripId,
          rep_id: repId,
          customer_id: payload.customerId,
          sale_id: payload.saleId || null,
          status: 'pending_approval',
          return_reason: payload.returnReason,
          refund_method: payload.refundMethod || 'credit',
          total_amount: totalAmount,
          items_json: JSON.stringify(payload.items),
          notes: payload.notes || null,
        })
        .returning(['id'])
        .execute();

      const returnId = Number(inserted.id);
      const docNo = await generateDailySequenceNumber(trxAny, this.db, 'van_field_returns', 'doc_no', 'VRET', tenantId);
      await trxAny
        .updateTable('van_field_returns')
        .set({ doc_no: docNo })
        .where('id', '=', returnId)
        .where('tenant_id', '=', tenantId)
        .execute();

      return { returnId, docNo };
    });

    return {
      ok: true,
      returnDocNo: created.docNo,
      returnId: created.returnId,
      status: 'pending_approval',
      totalAmount,
    };
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
      items: typeof r.itemsJson === 'string' ? JSON.parse(r.itemsJson) : (r.itemsJson || []),
    }));
  }

  /**
   * Approves a pending field return, crediting the customer and moving stock.
   */
  async approveFieldReturn(tenantId: string, accountId: string, returnId: number, approvedByUserId: number) {
    return this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      const ret = await trxAny
        .selectFrom('van_field_returns')
        .selectAll()
        .where('id', '=', returnId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!ret) throw new AppError('طلب المرتجع غير موجود', 'RETURN_NOT_FOUND', 404);
      if (ret.status !== 'pending_approval') {
        throw new AppError(`طلب المرتجع تمت معالجته بالفعل بحالة (${ret.status})`, 'RETURN_ALREADY_PROCESSED', 400);
      }

      // Lock the trip row first: approval-time provenance re-validation
      // below reads the rep's sales and other returns, and this lock
      // serializes concurrent approvals for the same trip (and against
      // settleTrip, which takes the same lock) so two approvals cannot
      // both pay out against the same remaining quantity.
      const lockedTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id', 'status'])
        .where('id', '=', ret.trip_id)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedTrip || lockedTrip.status !== 'open') {
        throw new AppError('رحلة التوزيع المحددة مغلقة أو غير صالحة', 'INVALID_TRIP', 400);
      }

      const trip = await trxAny
        .selectFrom('van_sales_trips as vt')
        .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
        .select(['vt.id', 'vt.van_location_id', 'vt.source_warehouse_id', 'vt.cash_collected', 'van.branch_id as vanBranchId'])
        .where('vt.id', '=', ret.trip_id)
        .where('vt.tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!trip) throw new AppError('رحلة التوزيع المربوطة بالمرتجع غير صالحة', 'INVALID_TRIP', 400);

      const items = typeof ret.items_json === 'string' ? JSON.parse(ret.items_json) : (ret.items_json || []);
      const totalAmount = Number(ret.total_amount || 0);
      const isDamaged = ret.return_reason === 'damaged' || ret.return_reason === 'expired';
      const branchId = trip.vanBranchId ? Number(trip.vanBranchId) : null;
      const refundMethod: 'credit' | 'cash' = (ret as any).refund_method === 'cash' ? 'cash' : 'credit';

      if (refundMethod === 'cash') {
        // Custody guard (van F5): this check runs inside the transaction
        // on the trip row freshly re-read AFTER the FOR UPDATE lock
        // above, so a concurrent approval waits for the lock and then
        // sees the first approval's committed deduction — two cash
        // refunds can never both pay out against the same balance
        // (the deduction below is a relative SQL update, exact under
        // the lock). The tolerance is one minor unit of the tenant's
        // book currency, never a hardcoded 0.01 — 0.01 is ten minor
        // units on a 3-decimal tenant and let a refund overdraw the
        // rep's custody by up to that much, even sequentially.
        const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
        const tolerance = 1 / 10 ** moneyDigits;
        const repCash = Number(trip.cash_collected || 0);
        if (totalAmount > repCash + tolerance) {
          throw new AppError(
            `رصيد النقدية المحصلة بعهدة المندوب بالرحلة (${repCash} ج.م) لا يكفي لاعتماد مرتجع نقدي بقيمة (${totalAmount} ج.م)`,
            'INSUFFICIENT_REP_CASH_FOR_REFUND',
            400,
          );
        }
      }

      // APPROVAL-TIME PROVENANCE RE-VALIDATION (van F3): submit-time
      // checks run outside any transaction, so the basis they verified
      // can evaporate before approval — the sale edited down or
      // cancelled, another return approved first, or the trip settled.
      // Approval trusts nothing from submission: it re-reads the
      // current sales/returns state inside this transaction (under
      // the trip lock above) and fails closed, leaving the request
      // pending_approval for a human to reject or re-examine. No
      // fraud-radar event is recorded here: a changed basis is often
      // a legitimate edit, not an attempted fraud.
      const returnItems = (items || []).map((i: any) => ({ ...i, productId: Number(i.productId) }));
      if (ret.sale_id) {
        const sale = await trxAny
          .selectFrom('sales as s')
          .leftJoin('van_sales_trips as vt', (join: any) =>
            join.onRef('vt.id', '=', 's.van_trip_id').onRef('vt.tenant_id', '=', 's.tenant_id'),
          )
          .select([
            's.id',
            's.status',
            's.customer_id',
            sql<number | null>`coalesce(s.delivery_rep_id, vt.rep_id)`.as('resolved_rep_id'),
          ])
          .where('s.id', '=', ret.sale_id)
          .where('s.tenant_id', '=', tenantId)
          .executeTakeFirst();
        if (!sale) throw new AppError('الفاتورة الأصلية غير موجودة', 'SALE_NOT_FOUND', 404);
        if (sale.status !== 'posted') {
          throw new AppError('الفاتورة الأصلية غير مرحّلة أو تم إلغاؤها بعد تقديم المرتجع', 'RETURN_SALE_NOT_POSTED', 400);
        }
        if (Number(sale.customer_id) !== Number(ret.customer_id)) {
          throw new AppError('الفاتورة المحددة لا تخص هذا العميل', 'SALE_CUSTOMER_MISMATCH', 400);
        }
        if (sale.resolved_rep_id != null && Number(sale.resolved_rep_id) !== Number(ret.rep_id)) {
          throw new AppError(
            'لا يمكن عمل مرتجع على فاتورة تخص مندوباً آخر — عهد وحسابات كل مندوب معزولة تماماً',
            'SALE_REP_MISMATCH',
            403,
          );
        }
        const saleLines = await trxAny
          .selectFrom('sale_items')
          .selectAll()
          .where('sale_id', '=', ret.sale_id)
          .where('tenant_id', '=', tenantId)
          .execute();
        const priorReturns = await trxAny
          .selectFrom('van_field_returns')
          .select(['id', 'items_json'])
          .where('sale_id', '=', ret.sale_id)
          .where('tenant_id', '=', tenantId)
          .where(sql<boolean>`status in ('approved', 'pending_approval')`)
          .execute();
        const alreadyReturnedBySaleItem = new Map<number, number>();
        for (const prior of priorReturns) {
          // Exclude this return itself: it is pending_approval and
          // would otherwise count its own quantity against itself.
          if (Number(prior.id) === Number(returnId)) continue;
          const parsed = typeof prior.items_json === 'string' ? JSON.parse(prior.items_json) : (prior.items_json || []);
          for (const it of parsed) {
            if (it.saleItemId) {
              const sid = Number(it.saleItemId);
              alreadyReturnedBySaleItem.set(sid, (alreadyReturnedBySaleItem.get(sid) || 0) + Number(it.qty || 0));
            }
          }
        }
        for (const item of returnItems) {
          const line = item.saleItemId
            ? saleLines.find((sl: any) => Number(sl.id) === Number(item.saleItemId))
            : saleLines.find((sl: any) => Number(sl.product_id) === Number(item.productId));
          if (!line) {
            throw new AppError(`الصنف #${item.productId} لم يتم العثور عليه في الفاتورة الأصلية`, 'ITEM_NOT_IN_SALE', 400);
          }
          const soldQty = Number(line.qty || 0);
          const lineTotal = Number(line.line_total || 0);
          const netUnit = soldQty > 0 ? Number((lineTotal / soldQty).toFixed(2)) : 0;
          if (Number(item.unitPrice) > netUnit + 0.05) {
            throw new AppError(
              `سعر المرتجع (${item.unitPrice}) يتجاوز السعر الصافي بعد الخصم بالفاتورة الأصلية (${netUnit})`,
              'RETURN_PRICE_EXCEEDS_NET',
              400,
            );
          }
          const alreadyReturned = alreadyReturnedBySaleItem.get(Number(line.id)) || 0;
          const remainingReturnableQty = Number((soldQty - alreadyReturned).toFixed(3));
          if (Number(item.qty) > remainingReturnableQty + 0.001) {
            throw new AppError(
              `الكمية المطلوب ردها (${item.qty}) تتجاوز المتبقي القابل للرد من الفاتورة الأصلية (${Math.max(0, remainingReturnableQty)}) — بيع ${soldQty}، مرتجع سابقاً ${alreadyReturned}`,
              'RETURN_QTY_EXCEEDS_SOLD',
              400,
            );
          }
        }
      } else {
        const repCustomerSales = await trxAny
          .selectFrom('sales as s')
          .leftJoin('van_sales_trips as vt', (join: any) =>
            join.onRef('vt.id', '=', 's.van_trip_id').onRef('vt.tenant_id', '=', 's.tenant_id'),
          )
          .select(['s.id'])
          .where('s.customer_id', '=', ret.customer_id)
          .where('s.tenant_id', '=', tenantId)
          .where('s.status', '=', 'posted')
          .where(sql<boolean>`coalesce(s.delivery_rep_id, vt.rep_id) = ${Number(ret.rep_id)}`)
          .execute();
        const repSaleIds = repCustomerSales.map((s: any) => Number(s.id));
        if (!repSaleIds.length) {
          throw new AppError(
            'لا يمكن تسجيل مرتجع بدون فاتورة لعميل لم يسبق لهذا المندوب البيع له',
            'NO_REP_SALES_HISTORY_FOR_RETURN',
            403,
          );
        }
        const soldLines = await trxAny
          .selectFrom('sale_items')
          .select(['product_id', 'product_name', 'qty', 'line_total'])
          .where('sale_id', 'in', repSaleIds)
          .where('tenant_id', '=', tenantId)
          .execute();
        const existingCustomerReturns = await trxAny
          .selectFrom('van_field_returns')
          .select(['id', 'items_json'])
          .where('customer_id', '=', ret.customer_id)
          .where('rep_id', '=', ret.rep_id)
          .where('tenant_id', '=', tenantId)
          .where(sql<boolean>`status in ('approved', 'pending_approval')`)
          .execute();
        const returnedByProduct = new Map<number, number>();
        for (const retRow of existingCustomerReturns) {
          if (Number(retRow.id) === Number(returnId)) continue;
          const parsed = typeof retRow.items_json === 'string' ? JSON.parse(retRow.items_json) : (retRow.items_json || []);
          for (const it of parsed) {
            const pid = Number(it.productId);
            returnedByProduct.set(pid, (returnedByProduct.get(pid) || 0) + Number(it.qty || 0));
          }
        }
        for (const item of returnItems) {
          const pid = Number(item.productId);
          const matchingLines = soldLines.filter((sl: any) => Number(sl.product_id) === pid);
          const totalSoldQty = matchingLines.reduce((sum: number, sl: any) => sum + Number(sl.qty || 0), 0);
          const maxNetUnitPrice = matchingLines.reduce((maxP: number, sl: any) => {
            const q = Number(sl.qty || 0);
            const netU = q > 0 ? Number((Number(sl.line_total || 0) / q).toFixed(2)) : 0;
            return Math.max(maxP, netU);
          }, 0);
          const alreadyRet = returnedByProduct.get(pid) || 0;
          const remainingQty = Number((totalSoldQty - alreadyRet).toFixed(3));
          if (totalSoldQty <= 0 || Number(item.qty) > remainingQty + 0.001) {
            throw new AppError(
              `الكمية المطلوب ردها (${item.qty}) للصنف #${pid} تتجاوز إجمالي ما باعه هذا المندوب للعميل صافي المرتجعات السابقة (${Math.max(0, remainingQty)})`,
              'RETURN_QTY_EXCEEDS_SOLD',
              400,
            );
          }
          if (Number(item.unitPrice) > maxNetUnitPrice + 0.05) {
            throw new AppError(
              `سعر المرتجع (${item.unitPrice}) يتجاوز السعر الصافي الذي بيع به الصنف للعميل (${maxNetUnitPrice})`,
              'RETURN_PRICE_EXCEEDS_NET',
              400,
            );
          }
        }
      }

      let targetLocationId = Number(trip.van_location_id);
      if (isDamaged) {
        const damagedLoc = await trxAny
          .selectFrom('stock_locations')
          .select(['id'])
          .where('tenant_id', '=', tenantId)
          .where('location_type', '=', 'damaged')
          .executeTakeFirst();
        if (damagedLoc?.id) targetLocationId = Number(damagedLoc.id);
      }

      const itemsWithCost: { productId: number; qty: number; costPrice: number }[] = [];
      const sortedReturnItems: any[] = sortItemsByProductId(
        (items || []).map((i: any) => ({ ...i, productId: Number(i.productId) })),
      );
      for (const item of sortedReturnItems) {
        const pid = Number(item.productId);
        const qty = Number(item.qty || 0);
        const price = Number(item.unitPrice || 0);
        if (qty <= 0) continue;

        // CANONICAL LOCK ORDER: Lock products first!
        const prod = await trxAny
          .selectFrom('products')
          .select(['cost_price'])
          .where('id', '=', pid)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        await moveVanStock(trx, {
          productId: pid,
          delta: qty,
          locationId: targetLocationId,
          tenantId,
          accountId,
          userId: approvedByUserId,
          movementType: 'van_sale_return',
          note: `مرتجع عميل معتمد (${ret.doc_no}) - سبب: ${ret.return_reason}`,
          referenceType: 'van_field_return',
          referenceId: returnId,
          skipGlobalUpdate: false,
          unitCost: price,
        });

        itemsWithCost.push({ productId: pid, qty, costPrice: Number(prod?.cost_price || 0) });
      }

      if (refundMethod === 'credit') {
        const updatedCust = await trxAny
          .updateTable('customers')
          .set({ balance: sql`COALESCE(balance, 0) - ${totalAmount}`, updated_at: sql`NOW()` })
          .where('id', '=', ret.customer_id)
          .where('tenant_id', '=', tenantId)
          .returning(['balance'])
          .executeTakeFirst();
        const balanceAfter = Number(updatedCust?.balance || 0);

        await trxAny
          .insertInto('customer_ledger')
          .values({
            customer_id: ret.customer_id,
            entry_type: 'return',
            amount: -totalAmount,
            balance_after: balanceAfter,
            note: `مرتجع بضاعة ميداني معتمد (#${ret.doc_no}) - خصم من الحساب`,
            reference_type: 'van_field_return',
            reference_id: returnId,
            van_trip_id: ret.trip_id,
            tenant_id: tenantId,
            account_id: accountId,
            created_by: approvedByUserId,
          })
          .execute();
      } else {
        // Immediate Cash Refund from Van: deduct from cash_collected and track cash_refunds
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            cash_refunds: sql`COALESCE(cash_refunds, 0) + ${totalAmount}`,
            cash_collected: sql`cash_collected - ${totalAmount}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', ret.trip_id)
          .where('tenant_id', '=', tenantId)
          .execute();

        const currentCust = await trxAny
          .selectFrom('customers')
          .select(['balance'])
          .where('id', '=', ret.customer_id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        const balanceAfter = Number(currentCust?.balance || 0);

        await trxAny
          .insertInto('customer_ledger')
          .values({
            customer_id: ret.customer_id,
            entry_type: 'return',
            amount: 0,
            balance_after: balanceAfter,
            note: `مرتجع بضاعة نقدي فوري مسدد من عهدة المندوب (#${ret.doc_no}) بقيمة ${totalAmount}`,
            reference_type: 'van_field_return',
            reference_id: returnId,
            van_trip_id: ret.trip_id,
            tenant_id: tenantId,
            account_id: accountId,
            created_by: approvedByUserId,
          })
          .execute();
      }

      await trxAny
        .updateTable('van_sales_trips')
        .set({
          returns_amount: sql`returns_amount + ${totalAmount}`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', ret.trip_id)
        .where('tenant_id', '=', tenantId)
        .execute();

      await trxAny
        .updateTable('van_field_returns')
        .set({
          status: 'approved',
          approved_by: approvedByUserId,
          approved_at: sql`NOW()`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', returnId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const auth: AuthContext = {
        userId: approvedByUserId,
        sessionId: 'van-field-return-approval',
        username: 'admin',
        role: 'admin',
        permissions: ['accounting'],
        tenantId,
        accountId,
      };
      await this.accountingPosting.postVanFieldReturn(
        trx,
        returnId,
        {
          customerId: Number(ret.customer_id),
          totalAmount,
          refundMethod,
          items: itemsWithCost,
          branchId,
          locationId: targetLocationId,
        },
        auth,
      );

      return { ok: true, returnId, status: 'approved' };
    });
  }

  /**
   * Rejects a pending field return with a reason.
   */
  async rejectFieldReturn(tenantId: string, returnId: number, rejectionReason: string, rejectedByUserId: number) {
    const ret = await this.anyDb
      .selectFrom('van_field_returns')
      .select(['id', 'status'])
      .where('id', '=', returnId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!ret) throw new AppError('طلب المرتجع غير موجود', 'RETURN_NOT_FOUND', 404);
    if (ret.status !== 'pending_approval') {
      throw new AppError(`طلب المرتجع تمت معالجته بالفعل بحالة (${ret.status})`, 'RETURN_ALREADY_PROCESSED', 400);
    }

    await this.anyDb
      .updateTable('van_field_returns')
      .set({
        status: 'rejected',
        rejection_reason: rejectionReason || 'تم الرفض بواسطة الإدارة',
        approved_by: rejectedByUserId,
        approved_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', returnId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, returnId, status: 'rejected' };
  }
}
