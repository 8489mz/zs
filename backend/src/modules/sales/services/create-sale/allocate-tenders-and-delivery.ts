import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import { formatCreditLimitExceededMessage } from '../credit-limit-message';
import {
  allocateSaleTenders,
  shouldSuppressTenderFallback,
  type SaleTenderChannel,
} from '../../engines/sale-tender.engine';
import { assertPosSubmitGates } from '../../engines/pos-submit-gates.engine';
import { validateOfflineCreatedAt } from '../../../cash-drawer/helpers/cash-drawer.helper';
import type { CreateSaleContext, CreateSaleDeps } from './create-sale-types';

export class AllocateTendersAndDeliveryService {
  constructor(private readonly authz: CreateSaleDeps['authz']) {}

  /**
   * Phase 4 — POS shift gates, COD tender inference, tender allocation,
   * remaining debt, credit checks, the delivery block, payment type,
   * submit gates, fee mode and offline fields. Facade L1156-1413.
   */
  async allocateTendersAndDelivery(ctx: CreateSaleContext): Promise<void> {
    const {
      trx,
      scope,
      normalized,
      payload,
      auth,
      settingsMap,
      total,
      collectibleTotal,
      customer,
      subtotal,
      effectiveDiscount,
      belowFloorItems,
      floorApproval,
      moneyDigits,
    } = ctx;
    if (normalized.source === 'pos') {
      // INV-REST-SHIFT-CLOSE-CONTROL (I23): the POS gate honours
      // requireCashierShiftForSales — tenants that run without
      // shifts (wholesale/van/contracting/maritime, where the
      // setting is forced false) are no longer told shifts are
      // off while sales still demand one. Missing setting fails
      // closed to demanding a shift.
      const hasOpenShift = await this.authz.hasOpenCashierShiftForSale(trx, auth, normalized.branchId, settingsMap);
      if (!hasOpenShift)
        throw new AppError('Open cashier shift is required before posting a POS sale', 'OPEN_SHIFT_REQUIRED', 400);
    } else if (
      normalized.paymentType !== 'credit' &&
      (normalized.payments.some((entry) => entry.paymentChannel === 'cash') || normalized.paymentChannel === 'cash')
    ) {
      // INV-ADMIN-CASH-SALE-SHIFT-REQUIRED: every cash receipt
      // needs an open shift, regardless of role. Admins used to be
      // exempt here, so a back-office cash sale wrote GL cash with
      // no shift attribution and surfaced as a false overage at
      // close. Admins can hold shifts (openCashierShift exempts
      // them from branch assignment), so this never deadlocks.
      // The setting-aware gate applies here too: a tenant that
      // runs without shifts must not be blocked on a cash sale.
      const hasOpenShift = await this.authz.hasOpenCashierShiftForSale(trx, auth, normalized.branchId, settingsMap);
      if (!hasOpenShift)
        throw new AppError('Open cashier shift is required before posting a cash sale', 'OPEN_SHIFT_REQUIRED', 400);
    }

    // INV-REST-COD-TENDER-TRUTH (R7-D): a no-legs COD delivery must
    // post as an unpaid receivable (paid 0), never as fully-paid
    // cash. The status is read off the raw payload here:
    // normalizeSalePayload never carries collectionStatus into
    // `normalized`, so this is the only place the allocation can
    // see it. Computed BEFORE allocateSaleTenders: the fallback
    // fires inside the allocation, and the isCod derivation below
    // reads the post-allocation paidAmount.
    const suppressTenderFallback = shouldSuppressTenderFallback({
      orderType: normalized.orderType,
      collectionStatus: (payload as any).collectionStatus,
      paymentType: normalized.paymentType,
    });
    // INV-REST-COD-COLLECTION-TRUTH (T11-D, D-T11-1): a delivery
    // WITH a courier rep must never infer prepaid from full payment
    // alone. An absent collectionStatus + a courier means the
    // courier collects: the cash legs that rode in on the default
    // cash channel are NOT money in hand, so they are withheld
    // from the tender allocation (paid 0, COD receivable, rep
    // custody) instead of posting a cash leg that settlement then
    // refuses (paid_amount > 0.009). Prepaid needs an explicit
    // prepaid status or an online-channel leg (wallet/instapay) —
    // a verifiable gateway receipt. Card legs are kept as declared
    // (bank money, not cash in hand). Non-courier deliveries,
    // credit sales and explicit statuses keep the existing
    // inference exactly. The rep id is parsed here only; the
    // delivery block below still validates that the rep exists.
    const rawCollectionStatusForTender = String((payload as any).collectionStatus || '').trim();
    const tenderCourierRepId = Number((payload as any).deliveryRepId || 0);
    const hasOnlineChannelTender = normalized.payments.some(
      (entry) => entry.paymentChannel === 'wallet' || entry.paymentChannel === 'instapay',
    );
    const inferCodFromCourier =
      String(normalized.orderType || '').trim() === 'delivery' &&
      !rawCollectionStatusForTender &&
      normalized.paymentType !== 'credit' &&
      Number.isFinite(tenderCourierRepId) &&
      tenderCourierRepId > 0 &&
      !hasOnlineChannelTender;
    const strippedCashLegs =
      inferCodFromCourier && normalized.payments.some((entry) => entry.paymentChannel === 'cash');
    const tenderPayments = inferCodFromCourier
      ? normalized.payments.filter((entry) => entry.paymentChannel !== 'cash')
      : normalized.payments;
    const tenderAllocation = allocateSaleTenders({
      paymentType: normalized.paymentType,
      payments: tenderPayments,
      collectibleTotal,
      fallbackChannel: (['card', 'wallet', 'instapay'].includes(normalized.paymentChannel)
        ? normalized.paymentChannel
        : 'cash') as SaleTenderChannel,
      tenderedCash: strippedCashLegs ? 0 : normalized.tenderedAmount,
      digits: moneyDigits,
      suppressFallback: suppressTenderFallback,
    });
    const payments = tenderAllocation.payments;
    const paidAmount = tenderAllocation.appliedAmount;
    // INV-REST-COD-UNPAID-POST-TRUTH (T12-H1, D-T12-H1): an
    // explicit-'cod' delivery carrying a declared cash leg that
    // covers the FULL total is REFUSED, never silently stripped —
    // a declared cash leg is money the cashier says is in hand,
    // while COD means the courier collects it at the door; both
    // cannot be true. The refusal fires only on the genuine
    // contradiction (paid in full): a PARTIAL cash leg posts
    // exactly as typed (cash in hand now, remainder COD — see
    // restaurant-paid-gates.spec.ts test 19), and the T11-D
    // absent-status strip above stays as-is. The frontend gate
    // fix makes the normal COD path send no cash leg at all, so
    // this backstop fires only on a stale or foreign caller. The
    // specific code + message reach the cashier verbatim through
    // getSubmitSaleErrorMessage (pos-submit-error.ts). T13-N1
    // (INV-REST-COD-DELIVERY-ONLY): delivery-only — the
    // contradiction exists only when a courier collects at the
    // door; a takeaway/dine-in sale carrying a stray 'cod' status
    // posts its cash leg normally. The message names the آجل path
    // explicitly: the old "غيّر حالة التحصيل" invited a status
    // change that then blocked the 0-cash attempt (Trial 5, J2).
    const hasDeclaredCashLeg = normalized.payments.some(
      (entry) => entry.paymentChannel === 'cash' && Number(entry.amount || 0) > 0,
    );
    if (
      String(normalized.orderType || '').trim() === 'delivery' &&
      rawCollectionStatusForTender === 'cod' &&
      hasDeclaredCashLeg &&
      paidAmount + 0.0001 >= collectibleTotal
    ) {
      throw new AppError(
        'الدليفري بنظام الدفع عند الاستلام لا يقبل مبلغًا نقديًا يغطي الإجمالي كاملًا: النقد المعلن يعني أن المبلغ في الخزينة، بينما COD يعني أن المندوب سيحصّله عند التسليم. صحّح المبلغ النقدي أو حوّل العملية إلى آجل صراحةً.',
        'SALE_COD_CASH_LEG_CONTRADICTION',
        400,
      );
    }
    const remainingDebt = roundMoney(Math.max(0, collectibleTotal - paidAmount), moneyDigits);
    const isDelivery = String(normalized.orderType || '').trim() === 'delivery';

    if (remainingDebt > 0 && (customer || !isDelivery)) {
      if (!customer) throw new AppError('الدين المتبقي يتطلب عميلاً مسجلاً', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);
      if (customer.is_credit_blocked) {
        throw new AppError(
          `تم تعليق البيع الآجل لهذا العميل بقرار تحصيل: ${customer.credit_block_reason || 'متأخرات غير مسددة'}`,
          'CUSTOMER_CREDIT_BLOCKED',
          400,
        );
      }
      const nextBalance = Number(customer.balance || 0) + remainingDebt;
      if (Number(customer.credit_limit || 0) > 0 && nextBalance > Number(customer.credit_limit || 0) + 0.001) {
        throw new AppError(
          formatCreditLimitExceededMessage({
            creditLimit: Number(customer.credit_limit || 0),
            currentBalance: Number(customer.balance || 0),
            requestedAmount: remainingDebt,
            digits: moneyDigits,
          }),
          'CUSTOMER_CREDIT_LIMIT',
          400,
        );
      }
    }

    if (normalized.storeCreditUsed > 0) {
      if (!customer) throw new AppError('Store credit requires a customer', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);
      if (normalized.storeCreditUsed > Number(customer.store_credit_balance || 0) + 0.0001) {
        throw new AppError('Store credit exceeds available balance', 'STORE_CREDIT_EXCEEDED', 400);
      }
    }
    let deliveryRepId: number | null = null;
    let deliveryStatus: string | null = null;
    let collectionStatus: string | null = null;
    let resolvedDeliveryFeeMode: 'freelance_courier' | 'store_fleet' =
      (payload as any).deliveryFeeMode === 'store_fleet'
        ? 'store_fleet'
        : (payload as any).deliveryFeeMode === 'freelance_courier'
          ? 'freelance_courier'
          : (null as any);

    if (isDelivery) {
      const rawRepId = (payload as any).deliveryRepId;
      const parsedRepId = rawRepId ? Number(rawRepId) : 0;
      const rawCollectionStatus = (payload as any).collectionStatus;
      const isCod = rawCollectionStatus === 'cod' || (!rawCollectionStatus && paidAmount + 0.0001 < collectibleTotal);

      if (isCod && (!parsedRepId || Number.isNaN(parsedRepId) || parsedRepId <= 0)) {
        throw new AppError(
          'يجب اختيار مندوب التوصيل لطلبات الدليفري لتسجيل عهدة التحصيل عليه',
          'DELIVERY_REP_REQUIRED',
          400,
        );
      }

      if (parsedRepId && !Number.isNaN(parsedRepId) && parsedRepId > 0) {
        const rep = await trx
          .selectFrom('delivery_representatives')
          .select(['id', 'name', 'rep_type', 'is_active'])
          .where('id', '=', parsedRepId)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();
        if (!rep) {
          throw new AppError('مندوب التوصيل المختار غير موجود', 'DELIVERY_REP_NOT_FOUND', 400);
        }
        if (rep.is_active === false) {
          throw new AppError('مندوب التوصيل المختار غير نشط', 'DELIVERY_REP_INACTIVE', 400);
        }
        deliveryRepId = parsedRepId;
        if (!resolvedDeliveryFeeMode && rep.rep_type === 'store_fleet') {
          resolvedDeliveryFeeMode = 'store_fleet';
        }
      }

      deliveryStatus = (payload as any).deliveryStatus || 'pending';
      const hasUnpaidAmount = paidAmount + 0.0001 < collectibleTotal;
      if (rawCollectionStatus && !['cod', 'prepaid_by_rep', 'prepaid_online'].includes(rawCollectionStatus)) {
        throw new AppError('حالة تحصيل الدليفري غير صالحة', 'DELIVERY_COLLECTION_STATUS_INVALID', 400);
      }
      // INV-REST-COD-COLLECTION-TRUTH (T11-D, D-T11-1): the
      // courier inference above already withheld the cash legs, so
      // a courier delivery with no stated status lands here unpaid
      // — it is COD, never prepaid_online, even when the tender
      // arrived fully paid in cash. An online-channel tender keeps
      // prepaid_online (see the inference above).
      // INV-REP-COD-CASH-CHANNEL (M11, C6, PD4): the same rule
      // extends to a delivery with NO rep — a fully-paid tender
      // carrying a declared cash leg and no online-channel leg
      // is cash in hand, not an online payment, so it is COD,
      // never prepaid_online: no order without a gateway receipt
      // is treated as an online payment. A card-only tender keeps
      // the old fallback (bank money with a terminal trail,
      // outside the decided cash scope), and an online-channel
      // leg still proves prepaid_online. The rep-required gate
      // above is untouched: this shape is fully paid, so it never
      // trips it, and the sale posts with collection_status 'cod'
      // and its cash leg intact (postSale still debits 1110 from
      // the legs; the drawer treats COD cash as out for delivery,
      // exactly as for an explicit COD with a declared cash leg).
      // It also stops the phantom courier-fee cash_out below: with
      // no rep there is no courier to pay from the drawer.
      collectionStatus =
        rawCollectionStatus ||
        (inferCodFromCourier
          ? 'cod'
          : hasUnpaidAmount
            ? 'cod'
            : hasDeclaredCashLeg && !hasOnlineChannelTender
              ? 'cod'
              : 'prepaid_online');
    }

    const isCodDelivery =
      isDelivery &&
      (collectionStatus === 'cod' || collectionStatus === 'pending' || paidAmount + 0.0001 < collectibleTotal);
    // INV-REST-PAID-GATES-2 (R4-D, I28, D-R4D-1/D-R4D-4): no silent
    // flip for POS sales — an underpaid cash sale with a customer is
    // rejected by the INVALID_PAID_AMOUNT throw below instead of
    // being reclassified as credit. Non-POS conversions keep the old
    // flip (deposit-carrying and guest COD conversions).
    const isPartialCredit =
      normalized.source !== 'pos' && Boolean(normalized.customerId) && paidAmount + 0.0001 < collectibleTotal;
    const effectivePaymentType = isPartialCredit || normalized.paymentType === 'credit' ? 'credit' : 'cash';
    if (effectivePaymentType !== 'credit' && !isCodDelivery && paidAmount + 0.0001 < collectibleTotal) {
      throw new AppError('Paid amount cannot be less than invoice total', 'INVALID_PAID_AMOUNT', 400);
    }
    // INV-REST-PAID-GATES-2 (R4-D): POS-only submit gates — zero
    // total, dine-in without a table, unpaid remainder without a
    // customer (the COD hole: the :1631 block above still exempts
    // deliveries, so this is the enforcement point for POS), and
    // the terminal-approved-amount pin. Runs on the allocated legs,
    // so the pinned card leg is the one that posts. Non-POS sources
    // return early inside the helper.
    assertPosSubmitGates({
      source: normalized.source,
      customerId: normalized.customerId,
      paidAmount,
      collectibleTotal,
      total,
      orderType: normalized.orderType,
      collectionStatus,
      tableNumber: normalized.tableNumber,
      cardAmount: payments.find((entry) => entry.paymentChannel === 'card')?.amount ?? 0,
      terminalApprovedAmount: normalized.terminalApprovedAmount,
      terminalAuthCode: normalized.terminalAuthCode,
      discount: effectiveDiscount,
      subtotal,
    });

    const finalTenderedAmount = tenderAllocation.tenderedAmount;
    const changeAmount = tenderAllocation.changeAmount;

    if (!resolvedDeliveryFeeMode) {
      const deliveryFeeModeVal = settingsMap.get('deliveryFeeMode');
      if (deliveryFeeModeVal && String(deliveryFeeModeVal).includes('store_fleet')) {
        resolvedDeliveryFeeMode = 'store_fleet';
      } else {
        resolvedDeliveryFeeMode = 'freelance_courier';
      }
    }

    const offlineDocNo = String(payload.offlineDocNo || '').trim();
    // INV-REST-SHIFT-CLOSE-CONTROL (I26): an offline sale keeps
    // its ORIGINAL timestamp (savedAt) as created_at, so it lands
    // in the shift whose window actually held it instead of the
    // next shift's. An invalid timestamp rejects outright — never
    // silently clamped to sync time.
    const offlineCreatedAt = validateOfflineCreatedAt(payload.offlineCreatedAt);
    // INV-REST-SHIFT-CLOSE-CONTROL (I24): the POS station code,
    // stored on the sale so its cash attributes to its station's
    // shift. Read off the DTO directly: normalizeSalePayload
    // does not carry it, and this is the only read site.
    const posTerminalCode = String(payload.terminalCode || '').trim() || null;
    ctx.payments = payments;
    ctx.paidAmount = paidAmount;
    ctx.remainingDebt = remainingDebt;
    ctx.isDelivery = isDelivery;
    ctx.deliveryRepId = deliveryRepId;
    ctx.deliveryStatus = deliveryStatus;
    ctx.collectionStatus = collectionStatus;
    ctx.resolvedDeliveryFeeMode = resolvedDeliveryFeeMode;
    ctx.isCodDelivery = isCodDelivery;
    ctx.effectivePaymentType = effectivePaymentType;
    ctx.finalTenderedAmount = finalTenderedAmount;
    ctx.changeAmount = changeAmount;
    ctx.offlineDocNo = offlineDocNo;
    ctx.offlineCreatedAt = offlineCreatedAt;
    ctx.posTerminalCode = posTerminalCode;
  }
}
