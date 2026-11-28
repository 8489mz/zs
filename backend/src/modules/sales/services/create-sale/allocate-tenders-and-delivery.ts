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
import { parseAntiTheftSettingsFromMap } from '../../../../common/utils/anti-theft-settings.util';
import { authorizeManagerSecret } from '../../../../common/utils/manager-approval';
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
    const offlineDocNo = ctx.offlineDocNo ?? String(payload.offlineDocNo || '').trim();
    const offlineCreatedAt =
      ctx.offlineCreatedAt !== undefined ? ctx.offlineCreatedAt : validateOfflineCreatedAt(payload.offlineCreatedAt);
    const posTerminalCode = ctx.posTerminalCode ?? (String(payload.terminalCode || '').trim() || null);
    const isOfflineSyncSale = Boolean(ctx.isOfflineSyncSale || (offlineDocNo && offlineCreatedAt));

    const hasHistoricalShiftWindowForOfflineSale = async (): Promise<boolean> => {
      if (!isOfflineSyncSale || !offlineCreatedAt) return false;
      const lowerBound = new Date(offlineCreatedAt.getTime() + 5 * 60 * 1000).toISOString();
      const upperBound = new Date(offlineCreatedAt.getTime() - 5 * 60 * 1000).toISOString();
      const matched = await sql<{ id?: number }>`
        select id from cashier_shifts
        where tenant_id = ${scope.tenantId}
          and (opened_by = ${auth.userId} or (${posTerminalCode}::text is not null and terminal_code = ${posTerminalCode}))
          and created_at <= ${lowerBound}::timestamptz
          and (closed_at is null or closed_at >= ${upperBound}::timestamptz)
        limit 1
      `.execute(trx);
      return Boolean(matched.rows?.[0]?.id);
    };

    if (normalized.source === 'pos') {
      // INV-REST-SHIFT-CLOSE-CONTROL (I23): the POS gate honours
      // requireCashierShiftForSales — tenants that run without
      // shifts (wholesale/van/contracting/maritime, where the
      // setting is forced false) are no longer told shifts are
      // off while sales still demand one. Missing setting fails
      // closed to demanding a shift.
      const hasOpenShift = await this.authz.hasOpenCashierShiftForSale(trx, auth, normalized.branchId, settingsMap);
      if (!hasOpenShift && !(await hasHistoricalShiftWindowForOfflineSale()))
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
      if (!hasOpenShift && !(await hasHistoricalShiftWindowForOfflineSale()))
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
      collectionStatus: payload.collectionStatus,
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
    const rawCollectionStatusForTender = String(payload.collectionStatus || '').trim();
    const tenderCourierRepId = Number(payload.deliveryRepId || 0);
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
      payload.deliveryFeeMode === 'store_fleet'
        ? 'store_fleet'
        : payload.deliveryFeeMode === 'freelance_courier'
          ? 'freelance_courier'
          : (null as any);

    if (isDelivery) {
      const rawRepId = payload.deliveryRepId;
      const parsedRepId = rawRepId ? Number(rawRepId) : 0;
      const rawCollectionStatus = payload.collectionStatus;
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
          .select(['id', 'name', 'rep_type', 'is_active', 'max_cash_custody_limit'])
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

        // INV-LOSS-PREVENTION-DELIVERY-CUSTODY:
        // 1) Time-Based Overdue Custody Gate (Option A: e.g. 20 hours): blocks assigning new delivery orders
        //    to a rep who still holds an unsettled COD order older than `deliveryOverdueHours` (with manager override).
        // 2) Optional Per-Rep / Global Cash Cap Gate: enforced ONLY when explicitly set > 0 (default 0 = open).
        if (isCod) {
          const antiTheftCfg = parseAntiTheftSettingsFromMap(settingsMap);
          const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
          let managerOverrideVerified = false;
          const verifyOverrideOrThrow = async (message: string, code: string) => {
            if (managerOverrideVerified) return;
            const overridePin = String(payload.managerPin || '').trim();
            if (!overridePin) {
              throw new AppError(message, code, 403);
            }
            await authorizeManagerSecret(trx, auth, overridePin);
            managerOverrideVerified = true;
          };

          if (antiTheftCfg.blockOverdueDeliveryRep && !isAdmin) {
            const overdueHours = Math.max(1, Number(antiTheftCfg.deliveryOverdueHours || 20));
            const overdueCutoff = new Date(Date.now() - overdueHours * 3_600_000);
            const overdueRow = await trx
              .selectFrom('sales')
              .select([
                sql<number>`COUNT(*)`.as('overdue_count'),
                sql<number>`COALESCE(SUM(GREATEST(0, total - COALESCE(paid_amount, 0))), 0)`.as('overdue_cash'),
                sql<Date | null>`MIN(created_at)`.as('oldest_at'),
              ])
              .where('tenant_id', '=', scope.tenantId)
              .where('delivery_rep_id', '=', parsedRepId)
              .where('status', '!=', 'cancelled')
              .where('created_at', '<=', overdueCutoff)
              .where((eb) =>
                eb.and([
                  eb.or([eb('driver_cash_settled', 'is', null), eb('driver_cash_settled', '=', false)]),
                  eb.or([eb('delivery_status', 'is', null), eb('delivery_status', '!=', 'settled')]),
                  eb.or([eb('collection_status', 'is', null), eb('collection_status', '!=', 'prepaid_online')]),
                ]),
              )
              .executeTakeFirst();
            const overdueCount = Number(overdueRow?.overdue_count || 0);
            if (overdueCount > 0) {
              const overdueCash = roundMoney(Number(overdueRow?.overdue_cash || 0), moneyDigits);
              const ageHours = overdueRow?.oldest_at
                ? Math.round((Date.now() - new Date(overdueRow.oldest_at).getTime()) / 3_600_000)
                : overdueHours;
              await verifyOverrideOrThrow(
                `لا يمكن إسناد أوردر جديد للمندوب (${rep.name}): لديه ${overdueCount} طلب غير مسوّى بعهدة متأخرة منذ ${ageHours} ساعة (تجاوز حد ${overdueHours} ساعة) بإجمالي ${overdueCash}. يجب تسوية العهدة القديمة أولاً أو إدخال اعتماد المدير.`,
                'DELIVERY_REP_OVERDUE_CUSTODY_BLOCKED',
              );
            }
          }

          const repOwnCap = rep.max_cash_custody_limit != null ? Number(rep.max_cash_custody_limit) : 0;
          const effectiveCustodyCap = repOwnCap > 0 ? repOwnCap : antiTheftCfg.defaultDeliveryCustodyCap;
          if (effectiveCustodyCap > 0 && !isAdmin) {
            const unsettledRow = await trx
              .selectFrom('sales')
              .select(sql<number>`COALESCE(SUM(GREATEST(0, total - COALESCE(paid_amount, 0))), 0)`.as('unsettled_cash'))
              .where('tenant_id', '=', scope.tenantId)
              .where('delivery_rep_id', '=', parsedRepId)
              .where('status', '!=', 'cancelled')
              .where((eb) =>
                eb.and([
                  eb.or([eb('driver_cash_settled', 'is', null), eb('driver_cash_settled', '=', false)]),
                  eb.or([eb('delivery_status', 'is', null), eb('delivery_status', '!=', 'settled')]),
                  eb.or([eb('collection_status', 'is', null), eb('collection_status', '!=', 'prepaid_online')]),
                ]),
              )
              .executeTakeFirst();
            const currentUnsettled = roundMoney(Number(unsettledRow?.unsettled_cash || 0), moneyDigits);
            const projectedCustody = roundMoney(currentUnsettled + remainingDebt, moneyDigits);
            if (projectedCustody > effectiveCustodyCap + 0.001) {
              await verifyOverrideOrThrow(
                `عهدة المندوب (${rep.name}) وصلت للحد الأقصى المسموح (${effectiveCustodyCap}). العهدة الحالية غير المصفّاة: ${currentUnsettled} + الطلب الحالي: ${remainingDebt}. يجب تصفية العهدة أولاً أو إدخال اعتماد المدير.`,
                'DELIVERY_CUSTODY_CAP_EXCEEDED',
              );
            }
          }
        }
      }

      deliveryStatus = payload.deliveryStatus || 'pending';
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

    // INV-LOSS-PREVENTION-ELECTRONIC-REF: when strict electronic payment reference is enabled,
    // prevent cashiers from booking cash sales as InstaPay/wallet/manual card to hide drawer cash.
    if (normalized.source === 'pos' && auth.role !== 'admin' && auth.role !== 'super_admin') {
      const antiTheftCfg = parseAntiTheftSettingsFromMap(settingsMap);
      if (antiTheftCfg.requireElectronicPaymentRef) {
        const hasManualElectronicLeg = payments.some(
          (entry) =>
            (entry.paymentChannel === 'instapay' ||
              entry.paymentChannel === 'wallet' ||
              (entry.paymentChannel === 'card' && !normalized.terminalAuthCode)) &&
            Number(entry.amount || 0) > 0.0001,
        );
        if (hasManualElectronicLeg) {
          const refText = String(
            (payload as any).transferReference || normalized.terminalAuthCode || (payload as any).terminalRrn || '',
          ).trim();
          if (refText.length < 3) {
            throw new AppError(
              'يجب إدخال رقم مرجع التحويل أو إيصال البطاقة (3 خانات على الأقل) لإتمام الدفع الإلكتروني (درع منع السرقة مفعّل).',
              'ELECTRONIC_PAYMENT_REF_REQUIRED',
              400,
            );
          }
        }
      }
    }

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
    ctx.isOfflineSyncSale = isOfflineSyncSale;
  }
}
