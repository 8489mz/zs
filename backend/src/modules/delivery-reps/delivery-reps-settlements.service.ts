/**
 * DeliveryRepsSettlementsService — slice S3 of the delivery-reps split.
 * Pure move of the settlement methods from DeliveryRepsService: the
 * private shift lookup plus settleOrder, settlePartialOrder and
 * settleAllOrders. No behavior change: bodies are byte-identical
 * apart from trailing whitespace stripped on moved lines.
 * Deps: database + audit + posting + finance + the two kernel helpers,
 * bound from the facade and stored under their original names, plus
 * the delivery-fee-mode helper bound from the facade the same way.
 * The facade keeps thin public delegates with the original signatures.
 */

import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { SalesFinanceService } from '../sales/services/sales-finance.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../common/errors/app-error';
import { Database } from '../../database/database.types';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';

export interface DeliveryRepsSettlementsDeps {
  db: Kysely<Database>;
  audit: AuditService;
  accountingPosting: AccountingPostingService;
  salesFinance: SalesFinanceService;
  tenantPredicate: (actor: AuthContext) => RawBuilder<boolean>;
  tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
  getDeliveryFeeMode: (trx: Kysely<Database>, actor: AuthContext) => Promise<'freelance_courier' | 'store_fleet'>;
}

@Injectable()
export class DeliveryRepsSettlementsService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly salesFinance: SalesFinanceService;
  private readonly tenantPredicate: (actor: AuthContext) => RawBuilder<boolean>;
  private readonly tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
  private readonly getDeliveryFeeMode: (
    trx: Kysely<Database>,
    actor: AuthContext,
  ) => Promise<'freelance_courier' | 'store_fleet'>;

  constructor(deps: DeliveryRepsSettlementsDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.salesFinance = deps.salesFinance;
    this.tenantPredicate = deps.tenantPredicate;
    this.tenantFields = deps.tenantFields;
    this.getDeliveryFeeMode = deps.getDeliveryFeeMode;
  }

  private async findOwnOpenShift(
    trx: Kysely<Database>,
    actor: AuthContext,
  ): Promise<{ id: number; branchId: number | null; locationId: number | null } | null> {
    const shift = await trx
      .selectFrom('cashier_shifts')
      .select(['id', 'branch_id', 'location_id'])
      .where('opened_by', '=', actor.userId)
      .where('status', '=', 'open')
      .where(this.tenantPredicate(actor))
      .orderBy('id', 'desc')
      .executeTakeFirst();

    if (!shift || !shift.id) return null;
    return {
      id: Number(shift.id),
      branchId: shift.branch_id ? Number(shift.branch_id) : null,
      locationId: shift.location_id ? Number(shift.location_id) : null,
    };
  }

  async settleOrder(
    saleId: number,
    actor: AuthContext,
    payload?: {
      signatureDataUrl?: string;
      proofPhotoUrl?: string;
      gpsLat?: number;
      gpsLng?: number;
      notes?: string;
      countedCashAmount?: number;
    },
  ): Promise<Record<string, unknown>> {
    let settlementSummary: { countedCash: number; expectedCash: number; variance: number } | null = null;
    await this.db.transaction().execute(async (trx) => {
      const sale = await trx
        .selectFrom('sales')
        .select([
          'id',
          'total',
          'delivery_fee',
          'delivery_fee_mode',
          'delivery_status',
          'delivery_rep_id',
          'collection_status',
          'customer_id',
          'paid_amount',
          'status',
          'order_type',
        ])
        .where('id', '=', saleId)
        .where(this.tenantPredicate(actor))
        .forUpdate()
        .executeTakeFirst();

      if (!sale) throw new AppError('Order not found', 'ORDER_NOT_FOUND', 404);
      if (!sale.delivery_rep_id) throw new AppError('Order is not assigned to a delivery rep', 'NOT_ASSIGNED', 400);
      if (sale.delivery_status === 'settled') throw new AppError('Order is already settled', 'ALREADY_SETTLED', 400);
      if (sale.status === 'cancelled' || sale.order_type !== 'delivery') {
        throw new AppError('Only active delivery orders may be settled', 'DELIVERY_SETTLEMENT_INVALID_ORDER', 409);
      }
      const isCourierCash = sale.collection_status === 'cod';
      // INV-REP-PREPAID-SHIFT-TREASURY (M6/A7): a rep-prepaid
      // delivery is cash the rep holds, not cash in the till — the
      // sale posted as paid at creation ("المبلغ مع المندوب"), so
      // the rep hands the money over at settlement exactly like a
      // COD courier. It settles through the same treasury-row path
      // below, but posts NO settlement journal and NO customer
      // ledger leg: the sale already booked Dr 1110 at creation
      // and the customer receivable is already zero.
      const isPrepaidByRep = sale.collection_status === 'prepaid_by_rep';
      if (isCourierCash && Number(sale.paid_amount || 0) > 0.009) {
        // The current GL posting contract expects the entire invoice as an
        // outstanding receivable. Refuse partially paid orders until reconciled.
        throw new AppError(
          'طلب الدليفري محصل جزئياً ويتطلب تسوية منفصلة قبل إقفال عهدة المندوب',
          'DELIVERY_PARTIAL_PAYMENT_RECONCILIATION_REQUIRED',
          409,
        );
      }
      // INV-SF-SINGLE-SETTLE-COUNTED-CASH (D-SF-01): a counted
      // cash amount is validated up front, before any write. It
      // must be a non-negative number; a positive counted amount
      // on an order with no cash to settle (prepaid_online and
      // other non-cash statuses) fails closed instead of being
      // silently ignored (a zero amount on such an order is a
      // no-op and is ignored). A rep-prepaid order DOES have cash
      // to settle — the rep holds it — so counted cash applies to
      // it exactly like COD.
      if (payload?.countedCashAmount !== undefined && payload?.countedCashAmount !== null) {
        const rawCounted = Number(payload.countedCashAmount);
        if (!Number.isFinite(rawCounted) || rawCounted < 0) {
          throw new AppError('Counted cash amount must be a non-negative number', 'SETTLEMENT_AMOUNT_INVALID', 400);
        }
        if (!isCourierCash && !isPrepaidByRep && rawCounted > 0) {
          throw new AppError(
            'Counted cash applies only to cash-on-delivery and rep-prepaid orders',
            'DELIVERY_SETTLEMENT_COUNTED_CASH_NOT_APPLICABLE',
            400,
          );
        }
      }

      let shiftId: number | null = null;
      let branchId: number | null = null;
      let locationId: number | null = null;

      // INV-REP-PREPAID-SHIFT-TREASURY (M6/A7): a COD courier and a
      // rep-prepaid rep both hand cash over at settlement, so both
      // take this branch: the receiving shift is found, the cash
      // due is computed, and a cash_in treasury row credits the
      // receiving shift. The two differ only in WHAT the rep owes
      // and in the GL: a COD rep owes the remaining receivable,
      // and the settlement journal clears it (Dr 1110 / Cr 1130);
      // a rep-prepaid rep owes the PAID amount he holds (the
      // customer receivable is already zero — the sale posted as
      // paid at creation), and the settlement posts NO journal and
      // NO customer ledger leg: posting one would fail the
      // fee-reconciliation gate (fee = 0 - 0, never the remaining
      // fee) and double-book the cash Dr 1110 already holds.
      // A counted amount that differs from the book cash due is
      // reported as variance; for a rep-prepaid order the variance
      // is a drawer variance at close (no 7200/7100 leg exists for
      // it — the GL booked the full cash at creation).
      if (isCourierCash || isPrepaidByRep) {
        const openShift = await this.findOwnOpenShift(trx, actor);
        if (!openShift) throw new AppError('لا بد من فتح وردية أولاً لاستلام الفلوس من المندوب', 'NO_OPEN_SHIFT', 400);
        shiftId = openShift.id;
        branchId = openShift.branchId;
        locationId = openShift.locationId;

        // R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F2: settle the
        // REMAINING amounts, not the original sale row. A prior
        // return already reversed part of the receivable (and
        // relieved part of the fee), so total - originalFee fails
        // closed in postDeliveryRepSettlement, and crediting the
        // full total would over-credit 1130. The basis is the
        // single source of truth shared with the posting gate.
        const basis = await this.accountingPosting.deliverySettlementBasis(trx, saleId, actor);
        const deliveryFeeMode = sale.delivery_fee_mode || (await this.getDeliveryFeeMode(trx, actor));
        const remainingFee = deliveryFeeMode === 'store_fleet' ? 0 : basis.remainingFee;
        const { tenantId: settleTenantId } = requireTenantScope(actor);
        const settleDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, settleTenantId));
        const cashDue = isPrepaidByRep
          ? roundMoney(Math.max(0, Number(sale.paid_amount || 0) - remainingFee), settleDigits)
          : roundMoney(Math.max(0, basis.remainingReceivable - remainingFee), settleDigits);
        // INV-SF-SINGLE-SETTLE-COUNTED-CASH (D-SF-01): the cash
        // the rep actually handed over, counted by the cashier.
        // When no counted amount is supplied (older clients, the
        // driver mobile page) it defaults to the book cash due,
        // preserving the old behaviour exactly. A counted amount
        // is never silently replaced by the book amount: for a COD
        // order a shortage is booked to 7200 and an overage to
        // 7100 by postDeliveryRepSettlement, and the receivable is
        // cleared by cash received + variance, never by unreceived
        // cash. For a rep-prepaid order the variance is reported
        // and surfaces as drawer variance at close — no 7200/7100
        // leg is booked, because the GL booked the full cash at
        // creation (see the branch comment above).
        const countedCash =
          payload?.countedCashAmount !== undefined && payload?.countedCashAmount !== null
            ? roundMoney(Number(payload.countedCashAmount), settleDigits)
            : null;
        const settledCashAmount = countedCash ?? cashDue;
        const settlementVariance = roundMoney(settledCashAmount - cashDue, settleDigits);
        settlementSummary = { countedCash: settledCashAmount, expectedCash: cashDue, variance: settlementVariance };

        if (settledCashAmount > 0) {
          const repRow = sale.delivery_rep_id
            ? await trx
                .selectFrom('delivery_representatives')
                .select(['name'])
                .where('id', '=', Number(sale.delivery_rep_id))
                .where(this.tenantPredicate(actor))
                .executeTakeFirst()
            : null;
          const repLabel = repRow?.name
            ? `${repRow.name} (#${sale.delivery_rep_id})`
            : `مندوب #${sale.delivery_rep_id}`;
          const varianceNote =
            settlementVariance < 0
              ? ` (عجز ${roundMoney(Math.abs(settlementVariance), settleDigits)} ج)`
              : settlementVariance > 0
                ? ` (زيادة ${settlementVariance} ج)`
                : '';
          await trx
            .insertInto('treasury_transactions')
            .values({
              txn_type: 'cash_in',
              amount: settledCashAmount,
              note: `تسوية أوردر دليفري رقم #${saleId} من ${repLabel}${remainingFee > 0 && deliveryFeeMode === 'freelance_courier' ? ` (مخصوماً منها ${remainingFee} ج رسوم المندوب)` : ''}${varianceNote}`,
              reference_type: 'cashier_shift',
              reference_id: shiftId,
              branch_id: branchId,
              location_id: locationId,
              created_by: actor.userId,
              ...this.tenantFields(actor),
            })
            .execute();
        }

        // D-SF-02 (INV-SF-COD-CUSTODY-GL): the receivable left the
        // customer's books at dispatch (custody transfer), so the
        // settle must not credit the customer ledger again — it
        // would drive the balance negative. A sale settled without
        // dispatch keeps the old credit. COD ONLY: a rep-prepaid
        // sale has no receivable left to clear and no custody leg
        // to credit — its GL was fully posted at creation.
        if (isCourierCash) {
          if (
            sale.customer_id &&
            basis.remainingReceivable > 0 &&
            !(await this.accountingPosting.hasDeliveryCustodyReclassification(trx, saleId, actor))
          ) {
            await this.salesFinance.createCustomerLedgerEntry(
              trx,
              sale.customer_id,
              -basis.remainingReceivable,
              `تسديد من مندوب للأوردر #${saleId}`,
              saleId,
              actor,
            );
          }

          await this.accountingPosting.postDeliveryRepSettlement(trx, saleId, cashDue, branchId, locationId, actor, {
            countedCash: settledCashAmount,
          });
        }
      }

      const updateData: Record<string, any> = {
        delivery_status: 'settled',
        settled_at: sql`NOW()`,
        settled_by: actor.userId,
        updated_at: sql`NOW()`,
      };
      if (payload?.signatureDataUrl) updateData.delivery_signature = payload.signatureDataUrl;
      if (payload?.proofPhotoUrl) updateData.delivery_photo_url = payload.proofPhotoUrl;
      if (payload?.gpsLat !== undefined && payload?.gpsLat !== null) updateData.delivery_gps_lat = payload.gpsLat;
      if (payload?.gpsLng !== undefined && payload?.gpsLng !== null) updateData.delivery_gps_lng = payload.gpsLng;
      if (payload?.notes) updateData.delivery_notes = payload.notes;

      await trx
        .updateTable('sales')
        .set(updateData)
        .where('id', '=', saleId)
        .where(this.tenantPredicate(actor))
        .execute();

      await trx
        .updateTable('online_orders')
        .set({
          status: 'delivered',
          updated_at: sql`NOW()`,
        })
        .where('sale_id', '=', saleId)
        .where(this.tenantPredicate(actor))
        .where('status', '!=', 'cancelled')
        .execute();
    });

    await this.audit.log('تسوية طلب توصيل', `تمت تسوية الطلب #${saleId} بواسطة ${actor.username}`, actor);
    return { ok: true, ...(settlementSummary ? settlementSummary : {}) };
  }

  /**
   * INV-REP-PARTIAL-COD-SETTLEMENT (M13/C9): the escape path for a
   * partially-paid COD order. settleOrder refuses such an order
   * (DELIVERY_PARTIAL_PAYMENT_RECONCILIATION_REQUIRED) because its
   * GL contract expects the whole invoice as an outstanding
   * receivable — but deliverySettlementBasis already nets the paid
   * amount out of the remaining receivable, so the remainder is
   * exactly what the rep still owes. This endpoint settles that
   * remainder through the SAME legs as the single-order COD path:
   * the delivered (counted) cash enters the drawer, the difference
   * against the book remainder is a shortage (Dr 7200) or an
   * overage (Cr 7100) via postDeliveryRepSettlement, and the
   * receivable is cleared by cash received + variance. The 409 in
   * settleOrder / settleAllOrders stays for every case this
   * endpoint does not cover: a batch containing a partial order
   * still refuses — settle each partial order here first.
   */
  async settlePartialOrder(
    saleId: number,
    actor: AuthContext,
    payload?: {
      signatureDataUrl?: string;
      proofPhotoUrl?: string;
      gpsLat?: number;
      gpsLng?: number;
      notes?: string;
      countedCashAmount?: number;
    },
  ): Promise<Record<string, unknown>> {
    let settlementSummary: { countedCash: number; expectedCash: number; variance: number } | null = null;
    await this.db.transaction().execute(async (trx) => {
      const sale = await trx
        .selectFrom('sales')
        .select([
          'id',
          'total',
          'delivery_fee',
          'delivery_fee_mode',
          'delivery_status',
          'delivery_rep_id',
          'collection_status',
          'customer_id',
          'paid_amount',
          'status',
          'order_type',
        ])
        .where('id', '=', saleId)
        .where(this.tenantPredicate(actor))
        .forUpdate()
        .executeTakeFirst();

      if (!sale) throw new AppError('Order not found', 'ORDER_NOT_FOUND', 404);
      if (!sale.delivery_rep_id) throw new AppError('Order is not assigned to a delivery rep', 'NOT_ASSIGNED', 400);
      if (sale.delivery_status === 'settled') throw new AppError('Order is already settled', 'ALREADY_SETTLED', 400);
      if (sale.status === 'cancelled' || sale.order_type !== 'delivery') {
        throw new AppError('Only active delivery orders may be settled', 'DELIVERY_SETTLEMENT_INVALID_ORDER', 409);
      }
      // This endpoint exists ONLY for the partial-payment case: a
      // COD order with a positive paid amount. Anything else is
      // settled through the standard path (or is not a COD order
      // at all) — failing closed here keeps the two endpoints'
      // contracts disjoint instead of letting this one silently
      // become a second settleOrder.
      if (sale.collection_status !== 'cod') {
        throw new AppError(
          'Only partially-paid cash-on-delivery orders may be settled through the partial settlement',
          'DELIVERY_PARTIAL_SETTLEMENT_NOT_APPLICABLE',
          409,
        );
      }
      if (Number(sale.paid_amount || 0) <= 0.009) {
        throw new AppError(
          'Order has no partial payment; use the standard settlement',
          'DELIVERY_PARTIAL_SETTLEMENT_NOT_APPLICABLE',
          409,
        );
      }
      // Same counted-cash validation as the single-order path
      // (D-SF-01): a non-negative number, and it applies here
      // because the order IS a COD order with cash to settle.
      if (payload?.countedCashAmount !== undefined && payload?.countedCashAmount !== null) {
        const rawCounted = Number(payload.countedCashAmount);
        if (!Number.isFinite(rawCounted) || rawCounted < 0) {
          throw new AppError('Counted cash amount must be a non-negative number', 'SETTLEMENT_AMOUNT_INVALID', 400);
        }
      }

      const openShift = await this.findOwnOpenShift(trx, actor);
      if (!openShift) throw new AppError('لا بد من فتح وردية أولاً لاستلام الفلوس من المندوب', 'NO_OPEN_SHIFT', 400);
      const shiftId = openShift.id;
      const branchId = openShift.branchId;
      const locationId = openShift.locationId;

      // The remainder comes from deliverySettlementBasis — the
      // single source of truth — never from gross total: the basis
      // already subtracts the partial payment (and any prior
      // return relief) from the remaining receivable.
      const basis = await this.accountingPosting.deliverySettlementBasis(trx, saleId, actor);
      const deliveryFeeMode = sale.delivery_fee_mode || (await this.getDeliveryFeeMode(trx, actor));
      const remainingFee = deliveryFeeMode === 'store_fleet' ? 0 : basis.remainingFee;
      const { tenantId: settleTenantId } = requireTenantScope(actor);
      const settleDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, settleTenantId));
      const cashDue = roundMoney(Math.max(0, basis.remainingReceivable - remainingFee), settleDigits);
      const countedCash =
        payload?.countedCashAmount !== undefined && payload?.countedCashAmount !== null
          ? roundMoney(Number(payload.countedCashAmount), settleDigits)
          : null;
      const settledCashAmount = countedCash ?? cashDue;
      const settlementVariance = roundMoney(settledCashAmount - cashDue, settleDigits);
      settlementSummary = { countedCash: settledCashAmount, expectedCash: cashDue, variance: settlementVariance };

      if (settledCashAmount > 0) {
        const repRow = sale.delivery_rep_id
          ? await trx
              .selectFrom('delivery_representatives')
              .select(['name'])
              .where('id', '=', Number(sale.delivery_rep_id))
              .where(this.tenantPredicate(actor))
              .executeTakeFirst()
          : null;
        const repLabel = repRow?.name ? `${repRow.name} (#${sale.delivery_rep_id})` : `مندوب #${sale.delivery_rep_id}`;
        const varianceNote =
          settlementVariance < 0
            ? ` (عجز ${roundMoney(Math.abs(settlementVariance), settleDigits)} ج)`
            : settlementVariance > 0
              ? ` (زيادة ${settlementVariance} ج)`
              : '';
        await trx
          .insertInto('treasury_transactions')
          .values({
            txn_type: 'cash_in',
            amount: settledCashAmount,
            note: `تسوية جزئية لأوردر دليفري رقم #${saleId} من ${repLabel}${remainingFee > 0 && deliveryFeeMode === 'freelance_courier' ? ` (مخصوماً منها ${remainingFee} ج رسوم المندوب)` : ''}${varianceNote}`,
            reference_type: 'cashier_shift',
            reference_id: shiftId,
            branch_id: branchId,
            location_id: locationId,
            created_by: actor.userId,
            ...this.tenantFields(actor),
          })
          .execute();
      }

      // D-SF-02 (INV-SF-COD-CUSTODY-GL): same as settleOrder —
      // the receivable left the customer's books at dispatch, so
      // the settle must not credit the customer ledger again.
      if (
        sale.customer_id &&
        basis.remainingReceivable > 0 &&
        !(await this.accountingPosting.hasDeliveryCustodyReclassification(trx, saleId, actor))
      ) {
        await this.salesFinance.createCustomerLedgerEntry(
          trx,
          sale.customer_id,
          -basis.remainingReceivable,
          `تسديد من مندوب للأوردر #${saleId}`,
          saleId,
          actor,
        );
      }

      await this.accountingPosting.postDeliveryRepSettlement(trx, saleId, cashDue, branchId, locationId, actor, {
        countedCash: settledCashAmount,
      });

      const updateData: Record<string, any> = {
        delivery_status: 'settled',
        settled_at: sql`NOW()`,
        settled_by: actor.userId,
        updated_at: sql`NOW()`,
      };
      if (payload?.signatureDataUrl) updateData.delivery_signature = payload.signatureDataUrl;
      if (payload?.proofPhotoUrl) updateData.delivery_photo_url = payload.proofPhotoUrl;
      if (payload?.gpsLat !== undefined && payload?.gpsLat !== null) updateData.delivery_gps_lat = payload.gpsLat;
      if (payload?.gpsLng !== undefined && payload?.gpsLng !== null) updateData.delivery_gps_lng = payload.gpsLng;
      if (payload?.notes) updateData.delivery_notes = payload.notes;

      await trx
        .updateTable('sales')
        .set(updateData)
        .where('id', '=', saleId)
        .where(this.tenantPredicate(actor))
        .execute();

      await trx
        .updateTable('online_orders')
        .set({
          status: 'delivered',
          updated_at: sql`NOW()`,
        })
        .where('sale_id', '=', saleId)
        .where(this.tenantPredicate(actor))
        .where('status', '!=', 'cancelled')
        .execute();
    });

    await this.audit.log(
      'تسوية جزئية لطلب توصيل',
      `تمت التسوية الجزئية للطلب #${saleId} بواسطة ${actor.username}`,
      actor,
    );
    return { ok: true, ...(settlementSummary ? settlementSummary : {}) };
  }

  async settleAllOrders(
    repId: number,
    expectedAmount: number,
    actor: AuthContext,
    countedCashAmount?: number,
  ): Promise<Record<string, unknown>> {
    // INV-SETTLE-ALL-CONFIRMATION-COUNTED-CASH (B5): the
    // expectedAmount is the confirmation gate — the only proof the
    // cash handed over matches the books — so it must be present
    // and numeric BEFORE any write. At base the gate read
    // `actualTotal - undefined` = NaN and `NaN > 0.01` is false,
    // so omitting the field settled a short batch as if it had
    // matched. A counted amount, when supplied, is validated the
    // same way as the single-order path (D-SF-01).
    const rawExpected = Number(expectedAmount);
    if (expectedAmount === undefined || expectedAmount === null || !Number.isFinite(rawExpected) || rawExpected < 0) {
      throw new AppError('Expected settlement amount must be a non-negative number', 'SETTLEMENT_AMOUNT_INVALID', 400);
    }
    if (countedCashAmount !== undefined && countedCashAmount !== null) {
      const rawCounted = Number(countedCashAmount);
      if (!Number.isFinite(rawCounted) || rawCounted < 0) {
        throw new AppError('Counted cash amount must be a non-negative number', 'SETTLEMENT_AMOUNT_INVALID', 400);
      }
    }
    const result = await this.db.transaction().execute(async (trx) => {
      const openShift = await this.findOwnOpenShift(trx, actor);
      if (!openShift) throw new AppError('لا بد من فتح وردية أولاً لاستلام الفلوس من المندوب', 'NO_OPEN_SHIFT', 400);

      const unsettledOrders = await trx
        .selectFrom('sales')
        .select(['id', 'total', 'customer_id', 'delivery_fee', 'delivery_fee_mode', 'paid_amount', 'collection_status'])
        .where('delivery_rep_id', '=', repId)
        // INV-REP-PREPAID-SHIFT-TREASURY (M6/A7): the batch settles
        // rep-prepaid orders too — a rep-prepaid rep hands cash
        // over exactly like a COD courier, and leaving the orders
        // out of the batch left them unsettleable in bulk (the
        // single-order path was the only way, and it wrote no
        // treasury row either). prepaid_online stays out: the
        // gateway already holds that money, no rep handover exists.
        .where('collection_status', 'in', ['cod', 'prepaid_by_rep'])
        .where('order_type', '=', 'delivery')
        .where('status', '!=', 'cancelled')
        .where((eb) => eb.or([eb('delivery_status', '!=', 'settled'), eb('delivery_status', 'is', null)]))
        .where(this.tenantPredicate(actor))
        .orderBy('id', 'asc')
        .limit(201)
        .forUpdate()
        .execute();

      if (unsettledOrders.length > 200) {
        throw new AppError(
          'Too many unsettled orders for one settlement; settle a smaller batch',
          'SETTLEMENT_BATCH_TOO_LARGE',
          409,
        );
      }

      if (unsettledOrders.length === 0) {
        throw new AppError('No unsettled orders found for this representative', 'NO_ORDERS', 400);
      }

      // COD ONLY: a partially-paid COD order cannot settle through
      // this path (the GL contract expects the entire invoice as an
      // outstanding receivable). A rep-prepaid order is paid by
      // definition — a positive paid_amount is its normal shape,
      // not a partial payment — so the gate must not fire on it.
      if (
        unsettledOrders.some((order) => order.collection_status === 'cod' && Number(order.paid_amount || 0) > 0.009)
      ) {
        throw new AppError(
          'بعض طلبات المندوب مدفوعة جزئياً وتتطلب تسوية منفصلة',
          'DELIVERY_PARTIAL_PAYMENT_RECONCILIATION_REQUIRED',
          409,
        );
      }
      const defaultMode = await this.getDeliveryFeeMode(trx, actor);
      // Cash due is money: round at the tenant's book digits. Currency
      // resolves on the transaction handle (never the pool) inside the
      // open transaction; the old 2-decimal cut dropped a 3-decimal tenant's
      // fils before the amount was posted to treasury.
      const { tenantId } = requireTenantScope(actor);
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      // R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F2: cash due is the
      // REMAINING receivable minus the REMAINING fee per order
      // (deliverySettlementBasis, shared with the posting gate) —
      // a prior return already reversed part of each order's
      // receivable and relieved part of its fee. The basis is read
      // up front so the AMOUNT_MISMATCH pre-check and the per-order
      // posts below agree on the same numbers.
      const basisByOrderId = new Map<number, { remainingReceivable: number; remainingFee: number }>();
      for (const order of unsettledOrders) {
        basisByOrderId.set(
          Number(order.id),
          await this.accountingPosting.deliverySettlementBasis(trx, Number(order.id), actor),
        );
      }
      const cashDue = (order: (typeof unsettledOrders)[number]) => {
        const basis = basisByOrderId.get(Number(order.id))!;
        if (String(order.collection_status || '') === 'prepaid_by_rep') {
          // INV-REP-PREPAID-SHIFT-TREASURY (M6/A7): the rep holds
          // the PAID amount (the remaining receivable is already
          // zero), minus the remaining courier fee he keeps — the
          // same paid-minus-fee shape as the single-order path.
          return Math.max(0, roundMoney(Number(order.paid_amount || 0) - basis.remainingFee, moneyDigits));
        }
        return (order.delivery_fee_mode || defaultMode) === 'store_fleet'
          ? basis.remainingReceivable
          : Math.max(0, roundMoney(basis.remainingReceivable - basis.remainingFee, moneyDigits));
      };
      const actualTotal = roundMoney(
        unsettledOrders.reduce((sum, order) => sum + cashDue(order), 0),
        moneyDigits,
      );

      // B5 secondary: the tolerance is the tenant's book tolerance
      // (10^-moneyDigits — the same tolerance the posting service
      // uses), not a hardcoded 0.01: on a 3-decimal tenant the old
      // 0.01 let a 0.005 mismatch through.
      const tolerance = 10 ** -moneyDigits;
      if (Math.abs(actualTotal - rawExpected) > tolerance) {
        throw new AppError(
          `مبلغ التسوية (${rawExpected}) لا يتطابق مع إجمالي المطلوب من المندوب (${actualTotal}).`,
          'AMOUNT_MISMATCH',
          400,
        );
      }

      // INV-SETTLE-ALL-CONFIRMATION-COUNTED-CASH (C7): the cash
      // the rep actually handed over, counted by the cashier.
      // When no counted amount is supplied it defaults to the book
      // total, preserving the old behaviour exactly. A counted
      // amount is never silently replaced by the book amount: the
      // difference is a shortage (Dr 7200) or an overage (Cr 7100)
      // booked by postDeliveryRepSettlement for the COD orders in
      // the batch, exactly like the single-order path. (A
      // rep-prepaid order's share of the variance surfaces as
      // drawer variance at close — its GL booked the full cash at
      // creation.) The batch total is allocated across the
      // orders in id order (each order counted up to its own cash
      // due; any overage beyond every due lands on the last order),
      // so the per-order counted amounts always sum to the counted
      // total and no order is ever counted negative.
      const totalCounted =
        countedCashAmount !== undefined && countedCashAmount !== null
          ? roundMoney(Number(countedCashAmount), moneyDigits)
          : actualTotal;
      const totalVariance = roundMoney(totalCounted - actualTotal, moneyDigits);
      const countedByOrderId = new Map<number, number>();
      let remainingCounted = totalCounted;
      for (const order of unsettledOrders) {
        const due = cashDue(order);
        const take = roundMoney(Math.min(due, remainingCounted), moneyDigits);
        countedByOrderId.set(Number(order.id), take);
        remainingCounted = roundMoney(remainingCounted - take, moneyDigits);
      }
      if (remainingCounted > 0) {
        const lastId = Number(unsettledOrders[unsettledOrders.length - 1].id);
        countedByOrderId.set(lastId, roundMoney((countedByOrderId.get(lastId) ?? 0) + remainingCounted, moneyDigits));
      }

      const saleIds = unsettledOrders.map((o) => o.id);

      const repRow = await trx
        .selectFrom('delivery_representatives')
        .select(['name'])
        .where('id', '=', repId)
        .where(this.tenantPredicate(actor))
        .executeTakeFirst();
      const repLabel = repRow?.name ? `${repRow.name} (#${repId})` : `مندوب #${repId}`;

      // R7-A F2: no cash row when the batch hands over nothing
      // (every order fully returned) — a zero treasury row is noise.
      // The drawer rises by the cash actually counted, not the book
      // total: unreceived cash is never booked as received.
      const varianceNote =
        totalVariance < 0
          ? ` (عجز ${roundMoney(Math.abs(totalVariance), moneyDigits)} ج)`
          : totalVariance > 0
            ? ` (زيادة ${totalVariance} ج)`
            : '';
      if (totalCounted > 0) {
        await trx
          .insertInto('treasury_transactions')
          .values({
            txn_type: 'cash_in',
            amount: totalCounted,
            note: `تسوية أوردرات دليفري (${saleIds.length} أوردر) من ${repLabel}${varianceNote}`,
            reference_type: 'cashier_shift',
            reference_id: openShift.id,
            branch_id: openShift.branchId,
            location_id: openShift.locationId,
            created_by: actor.userId,
            ...this.tenantFields(actor),
          })
          .execute();
      }

      for (const order of unsettledOrders) {
        // INV-REP-PREPAID-SHIFT-TREASURY (M6/A7): the GL legs below
        // are COD ONLY, exactly like the single-order path — a
        // rep-prepaid order's GL was fully posted at creation, and
        // its cash reaches the drawer through the single batch
        // treasury row above. Posting a settlement journal for it
        // would fail the fee-reconciliation gate and double-book
        // the cash. The counted allocation for it is simply unused.
        if (String(order.collection_status || '') !== 'cod') continue;
        const basis = basisByOrderId.get(Number(order.id))!;
        // D-SF-02 (INV-SF-COD-CUSTODY-GL): same as settleOrder —
        // the receivable already left the customer's books at
        // dispatch, so the batch settle must not credit the
        // customer ledger again.
        if (
          order.customer_id &&
          basis.remainingReceivable > 0 &&
          !(await this.accountingPosting.hasDeliveryCustodyReclassification(trx, Number(order.id), actor))
        ) {
          await this.salesFinance.createCustomerLedgerEntry(
            trx,
            order.customer_id,
            -basis.remainingReceivable,
            `تسديد من مندوب للأوردر #${order.id}`,
            order.id,
            actor,
          );
        }
        await this.accountingPosting.postDeliveryRepSettlement(
          trx,
          order.id,
          cashDue(order),
          openShift.branchId,
          openShift.locationId,
          actor,
          { countedCash: countedByOrderId.get(Number(order.id)) ?? cashDue(order) },
        );
      }

      await trx
        .updateTable('sales')
        .set({
          delivery_status: 'settled',
          settled_at: sql`NOW()`,
          settled_by: actor.userId,
          updated_at: sql`NOW()`,
        })
        .where('id', 'in', saleIds)
        .where(this.tenantPredicate(actor))
        .execute();

      await trx
        .updateTable('online_orders')
        .set({
          status: 'delivered',
          updated_at: sql`NOW()`,
        })
        .where('sale_id', 'in', saleIds)
        .where(this.tenantPredicate(actor))
        .where('status', '!=', 'cancelled')
        .execute();

      return {
        settledCount: saleIds.length,
        totalAmount: actualTotal,
        countedCash: totalCounted,
        expectedCash: actualTotal,
        variance: totalVariance,
      };
    });

    await this.audit.log(
      'تسوية كل الطلبات',
      `تمت تسوية ${result.settledCount} طلب للمندوب #${repId} بواسطة ${actor.username}`,
      actor,
    );
    return {
      ok: true,
      settledCount: result.settledCount,
      totalAmount: result.totalAmount,
      countedCash: result.countedCash,
      expectedCash: result.expectedCash,
      variance: result.variance,
    };
  }
}
