import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import {
  currencyMoneyDigits,
  roundMoney,
  type MoneyDigits,
} from '../../../accounting/engines/money-minor-units.engine';
import { generateDailySequenceNumber, resolveRepLinkedUserId } from '../van-common.util';
import { offlineSaleTimestamps } from '../../../cash-drawer/helpers/cash-drawer.helper';
import { validateVanOfflineCreatedAt } from '../../van-offline-timestamps.helper';
import { VanFraudRadarService } from '../van-fraud-radar.service';
import { AuditService, AUDIT_EVENT_CODES } from '../../../../core/audit/audit.service';

export type SubmitFieldReturnBoundDeps = {
  computeAlreadyReturnedQtyBySaleItem(tenantId: string, saleIds: number[]): Promise<Map<number, number>>;
  resolveSaleRefundLegs(
    q: any,
    tenantId: string,
    sale: {
      id: number;
      payment_type?: string | null;
      total?: unknown;
      paid_amount?: unknown;
      store_credit_used?: unknown;
      customer_id?: number | null;
    },
    moneyDigits: MoneyDigits,
    opts: {
      excludeReturnId?: number | null;
      priorReturns?: Array<{ id?: unknown; refund_method?: string | null; total_amount?: unknown }> | null;
    },
  ): Promise<{ paymentMethod: string; cashRemaining: number; creditRemaining: number }>;
  assertRefundMethodCoveredByLegs(
    legs: { paymentMethod: string; cashRemaining: number; creditRemaining: number },
    refundMethod: 'credit' | 'cash',
    totalAmount: number,
    moneyDigits: MoneyDigits,
  ): void;
};

export class SubmitFieldReturnSlice {
  private readonly bound: SubmitFieldReturnBoundDeps;

  constructor(
    private readonly db: Kysely<Database>,
    bound: SubmitFieldReturnBoundDeps,
    private readonly fraudRadar?: VanFraudRadarService,
    private readonly audit?: AuditService,
  ) {
    this.bound = bound;
  }

  private get anyDb(): any {
    return this.db as any;
  }

  private async computeAlreadyReturnedQtyBySaleItem(tenantId: string, saleIds: number[]): Promise<Map<number, number>> {
    return this.bound.computeAlreadyReturnedQtyBySaleItem(tenantId, saleIds);
  }

  private async resolveSaleRefundLegs(
    q: any,
    tenantId: string,
    sale: {
      id: number;
      payment_type?: string | null;
      total?: unknown;
      paid_amount?: unknown;
      store_credit_used?: unknown;
      customer_id?: number | null;
    },
    moneyDigits: MoneyDigits,
    opts: {
      excludeReturnId?: number | null;
      priorReturns?: Array<{ id?: unknown; refund_method?: string | null; total_amount?: unknown }> | null;
    } = {},
  ): Promise<{ paymentMethod: string; cashRemaining: number; creditRemaining: number }> {
    return this.bound.resolveSaleRefundLegs(q, tenantId, sale, moneyDigits, opts);
  }

  private assertRefundMethodCoveredByLegs(
    legs: { paymentMethod: string; cashRemaining: number; creditRemaining: number },
    refundMethod: 'credit' | 'cash',
    totalAmount: number,
    moneyDigits: MoneyDigits,
  ): void {
    return this.bound.assertRefundMethodCoveredByLegs(legs, refundMethod, totalAmount, moneyDigits);
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
        // INV-VAN-FIELD-RETURN-CARTON-QTY: carried for the form's own
        // unit display; the approval never trusts it — it reads the
        // multiplier from the DB sale line.
        unitMultiplier?: number;
        unitName?: string;
      }[];
      notes?: string;
      // INV-VAN-OFFLINE-TIMESTAMPS: the instant the return was made
      // offline (outbox createdAt, ISO with offset). Absent on the
      // online path.
      offlineCreatedAt?: string;
    },
  ) {
    // INV-VAN-OFFLINE-TIMESTAMPS: the gate runs first, before any
    // read — a tampered or stale offline stamp fails fast.
    const offlineCreatedAt = validateVanOfflineCreatedAt(payload.offlineCreatedAt);

    // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: every NEW field return must
    // name its original sale. Historical rows keep sale_id NULL (no
    // NOT NULL constraint — they still exist), but no new return may be
    // recorded unlinked: the leg check below can only run against a
    // sale, and an unlinked refund has no payment legs to match.
    // Refused before any other validation; nothing is written.
    if (payload.saleId == null || Number(payload.saleId) <= 0) {
      throw new AppError(
        'المرتجع الميداني يتطلب ربطه بالفاتورة الأصلية — اختر الفاتورة من قائمة فواتير العميل',
        'RETURN_REQUIRES_SALE_ID',
        400,
      );
    }
    if (!payload.items || !payload.items.length) {
      throw new AppError('يجب تحديد صنف واحد على الأقل للمرتجع', 'EMPTY_RETURN_ITEMS', 400);
    }

    // Book digits resolved once, before the transaction below opens
    // (D4): the return total and net-unit caps below round at book digits.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));

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
    totalAmount = roundMoney(totalAmount, moneyDigits);

    // The sale is mandatory (guard above): validate against the original invoice lines and rep isolation
    let linkedSale: any = null;
    const sale = await this.anyDb
      .selectFrom('sales as s')
      .leftJoin('van_sales_trips as vt', (join: any) =>
        join.onRef('vt.id', '=', 's.van_trip_id').onRef('vt.tenant_id', '=', 's.tenant_id'),
      )
      .select([
        's.id',
        's.doc_no',
        's.customer_id',
        's.payment_type',
        's.total',
        's.paid_amount',
        's.store_credit_used',
        sql<number | null>`coalesce(s.delivery_rep_id, vt.rep_id)`.as('resolved_rep_id'),
      ])
      .where('s.id', '=', payload.saleId)
      .where('s.tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!sale) throw new AppError('الفاتورة الأصلية غير موجودة', 'SALE_NOT_FOUND', 404);
    linkedSale = sale;
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

    const alreadyReturnedBySaleItem = await this.computeAlreadyReturnedQtyBySaleItem(tenantId, [
      Number(payload.saleId),
    ]);

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
      const netUnit = soldQty > 0 ? roundMoney(lineTotal / soldQty, moneyDigits) : 0;
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
        throw new AppError(
          `سعر المرتجع (${item.unitPrice}) يتجاوز السعر الصافي بعد الخصم بالفاتورة الأصلية (${netUnit})`,
          'RETURN_PRICE_EXCEEDS_NET',
          400,
        );
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

    // INV-VAN-RETURN-METHOD-MATCH: the refund method must match the
    // original sale's payment legs — cash-paid portions refund in
    // cash only, credit-owed portions as credit only, each leg only
    // up to what that leg paid (net of prior returns on the sale).
    // The custody check above runs first on purpose: a cash refund
    // that also exceeds the rep's held cash keeps its existing
    // INSUFFICIENT_REP_CASH_FOR_REFUND refusal.
    // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: unconditional now — every
    // new return is linked (guard above), so the guard must not survive
    // as a dead branch a later change could re-open.
    const legs = await this.resolveSaleRefundLegs(this.anyDb, tenantId, linkedSale, moneyDigits, {});
    this.assertRefundMethodCoveredByLegs(legs, payload.refundMethod || 'credit', totalAmount, moneyDigits);

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
          sale_id: Number(payload.saleId),
          status: 'pending_approval',
          return_reason: payload.returnReason,
          refund_method: payload.refundMethod || 'credit',
          total_amount: totalAmount,
          items_json: JSON.stringify(payload.items),
          notes: payload.notes || null,
          // INV-VAN-OFFLINE-TIMESTAMPS: an offline return keeps its
          // original instant as created_at and carries the server
          // receipt instant as received_at. Online: the spread is
          // empty and the column defaults apply.
          ...offlineSaleTimestamps(offlineCreatedAt),
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

      // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the submission
      // itself is the money action (it reserves the refund); the
      // approval writes its own row when it happens. In this same
      // transaction, so a rolled-back submission leaves no audit
      // trace and a committed one always has it. The actor is the
      // submitting rep's linked login, or null with the rep named in
      // the details when the rep has no linked login. The
      // function-check guards harnesses that pass a `{}` audit stub.
      if (this.audit && typeof this.audit.logWithExecutor === 'function') {
        const actorUserId = await resolveRepLinkedUserId(trxAny, tenantId, repId);
        const repRow = await trxAny
          .selectFrom('delivery_representatives')
          .select(['name'])
          .where('id', '=', Number(repId))
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        const repName = repRow?.name ? String(repRow.name).trim() : `مندوب #${Number(repId)}`;
        await this.audit.logWithExecutor(
          trx,
          'تقديم مرتجع ميداني',
          `قدّم المندوب ${repName} (#${Number(repId)}) مرتجعاً ميدانياً ${docNo} للعميل #${Number(payload.customerId)} من الرحلة #${Number(payload.tripId)} بقيمة ${totalAmount} (${payload.refundMethod || 'credit'}) بانتظار الاعتماد`,
          { userId: actorUserId, tenantId, accountId },
          { eventCode: AUDIT_EVENT_CODES.VAN_FIELD_RETURN_SUBMITTED },
        );
      }

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
}
