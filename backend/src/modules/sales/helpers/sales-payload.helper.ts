import { AppError } from '../../../common/errors/app-error';
import { NormalizedSalePayload, UpsertSaleDto } from '../dto/upsert-sale.dto';

type FlexibleSalePayload = UpsertSaleDto & {
  customer_id?: number | string | null;
  customer?: { id?: number | string | null } | null;
};

function resolveCustomerId(payload: FlexibleSalePayload): number | null {
  const direct = payload.customerId ?? payload.customer_id ?? payload.customer?.id ?? null;
  const numeric = Number(direct || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function assertCreditSaleCustomer(paymentType: 'cash' | 'credit', customerId: number | null): void {
  if (paymentType !== 'credit') return;
  if (customerId) return;
  throw new AppError('Credit sale requires a selected customer', 'CREDIT_SALE_REQUIRES_CUSTOMER', 400);
}

export function normalizeSalePayload(payload: UpsertSaleDto): NormalizedSalePayload {
  const flexiblePayload = payload as FlexibleSalePayload;
  const paymentType = payload.paymentType === 'credit' || payload.paymentChannel === 'credit' ? 'credit' : 'cash';
  const customerId = resolveCustomerId(flexiblePayload);

  assertCreditSaleCustomer(paymentType, customerId);

  const requestedPaymentChannel = payload.paymentChannel === 'card'
    ? 'card'
    : payload.paymentChannel === 'wallet'
      ? 'wallet'
      : payload.paymentChannel === 'instapay'
        ? 'instapay'
        : payload.paymentChannel === 'mixed'
          ? 'mixed'
          : 'cash';

  const normalizedPayments = (Array.isArray(payload.payments) ? payload.payments : [])
    .map((entry) => ({
      paymentChannel: (
        entry.paymentChannel === 'card'
          ? 'card'
          : entry.paymentChannel === 'wallet'
            ? 'wallet'
            : entry.paymentChannel === 'instapay'
              ? 'instapay'
              : 'cash'
      ) as 'cash' | 'card' | 'wallet' | 'instapay',
      amount: Number(entry.amount || 0),
    }));

  // Guard against stale POS state: if the cashier selected "فيزا" but the
  // payment input still arrived as a single cash line, trust the explicit
  // selected channel and keep the sale out of the cash drawer.
  const correctedPayments = (
    ['card', 'wallet', 'instapay'].includes(requestedPaymentChannel)
    && normalizedPayments.length > 0
    && normalizedPayments.every((entry) => entry.paymentChannel === 'cash')
      ? normalizedPayments.map((entry) => ({
        ...entry,
        paymentChannel: requestedPaymentChannel as 'card' | 'wallet' | 'instapay',
      }))
      : normalizedPayments
  );

  const fallbackChannel = requestedPaymentChannel === 'card'
    ? 'card'
    : requestedPaymentChannel === 'wallet'
      ? 'wallet'
      : requestedPaymentChannel === 'instapay'
        ? 'instapay'
        : 'cash';
  // If both type and channel are explicitly 'credit', the entire invoice is on credit;
  // any residual cash lines from form defaults are stripped.
  // When a partial tender is provided on a credit sale, POS provides a non-credit channel (mixed/cash).
  const payments = (paymentType === 'credit' && payload.paymentChannel === 'credit')
    ? []
    : correctedPayments.filter((entry) => entry.amount > 0);
  const paymentChannel: 'cash' | 'card' | 'wallet' | 'instapay' | 'mixed' | 'credit' = paymentType === 'credit'
    ? (payments.length ? (payments.length > 1 ? 'mixed' : (payments[0]?.paymentChannel || 'credit')) : 'credit')
    : (requestedPaymentChannel === 'mixed'
      ? (payments.length ? 'mixed' : fallbackChannel)
      : (payments.length > 1 ? 'mixed' : (payments[0]?.paymentChannel || fallbackChannel)));

  return {
    customerId,
    paymentType,
    paymentChannel,
    discount: Number(payload.discount || 0),
    deliveryFee: Number(payload.deliveryFee || 0),
    serviceCharge: Number(payload.serviceCharge || 0),
    tipAmount: Number(payload.tipAmount || 0),
    // R5-A (INV-REST-TOTALS-TRUTH-2, R-I53): the displayed total, for
    // createSale's cross-check. Null when the caller never sent one.
    expectedTotal: Number(payload.expectedTotal || 0) > 0 ? Number(payload.expectedTotal) : null,
    guestCount: Math.max(1, Number(payload.guestCount || 1)),
    taxRate: Number(payload.taxRate || 0),
    pricesIncludeTax: Boolean(payload.pricesIncludeTax),
    storeCreditUsed: Number(payload.storeCreditUsed || 0),
    loyaltyPointsRedeemed: Math.max(0, Number(payload.loyaltyPointsRedeemed || 0)),
    note: String(payload.note || '').trim(),
    managerPin: String(payload.managerPin || '').trim(),
    branchId: payload.branchId ? Number(payload.branchId) : null,
    locationId: payload.locationId ? Number(payload.locationId) : null,
    source: payload.source === 'pos' ? 'pos' : 'dashboard',
    payments,
    tenderedAmount: Number(payload.tenderedAmount || 0),
    tableNumber: typeof payload.tableNumber === 'string' ? payload.tableNumber.trim() : null,
    orderType: typeof payload.orderType === 'string' ? payload.orderType.trim() : null,
    diningCourse: typeof payload.diningCourse === 'string' ? payload.diningCourse.trim() : null,
    pagerNumber: typeof (payload as any).pagerNumber === 'string' ? (payload as any).pagerNumber.trim() : null,
    terminalId: payload.terminalId ? String(payload.terminalId).trim() : null,
    // INV-REST-PAID-GATES-2 (R4-D, I24 follow-up): the per-browser POS
    // terminal code. Read via `as any`: the UpsertSaleDto field is
    // R4-B's (offline-sync path); this passthrough carries the online
    // submit's code into `normalized` so the sales insert can store
    // it as pos_terminal_code. The EDC terminalId above is a different
    // field (the card machine), not this one.
    terminalCode: typeof (payload as any).terminalCode === 'string' && (payload as any).terminalCode.trim()
      ? (payload as any).terminalCode.trim()
      : null,
    terminalAuthCode: payload.terminalAuthCode ? String(payload.terminalAuthCode).trim() : null,
    terminalApprovedAmount: Number(payload.terminalApprovedAmount || 0) > 0 ? Number(payload.terminalApprovedAmount) : null,
    terminalRrn: payload.terminalRrn ? String(payload.terminalRrn).trim() : null,
    cardScheme: payload.cardScheme ? String(payload.cardScheme).trim() : null,
    cardLastFour: payload.cardLastFour ? String(payload.cardLastFour).trim() : null,
    items: payload.items
      .map((item) => ({
        productId: Number(item.productId || 0),
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined,
        qty: Number((item as any).qty ?? (item as any).quantity ?? 0),
        price: Number((item as any).price ?? (item as any).unitPrice ?? 0),
        originalPrice: item.originalPrice != null && Number(item.originalPrice) > 0 ? Number(item.originalPrice) : undefined,
        offerDiscount: item.offerDiscount != null && Number(item.offerDiscount) > 0 ? Number(item.offerDiscount) : undefined,
        // INV-CONVERSION-LINE-DISCOUNTS-PRESERVED: the per-line total
        // discount survives normalization. A negative or non-finite
        // value is invalid here (same SALE_ITEM_INVALID class as the
        // other item checks below); the gross-vs-discount bound is
        // enforced by buildPreparedSaleItem. The legacy per-item
        // `discount` field is deliberately NOT read: storefront and
        // van conversions still send it, and mapping it would silently
        // change their totals.
        lineDiscount: item.lineDiscount != null ? Number(item.lineDiscount) : undefined,
        offerName: item.offerName ? String(item.offerName).trim() : undefined,
        unitName: String(item.unitName || 'قطعة').trim() || 'قطعة',
        unitMultiplier: Number(item.unitMultiplier ?? 1),
        priceType: (item.priceType === 'wholesale' ? 'wholesale' : 'retail') as 'retail' | 'wholesale',
        notes: String(item.notes || '').trim(),
        modifiers: item.modifiers || [],
        serials: Array.isArray(item.serials) ? item.serials : undefined,
      }))
      .map((item) => {
        // Never silently drop a sales line: that would book a partial invoice and
        // deduct stock for fewer items than the cashier/customer submitted.
        if (!Number.isInteger(item.productId) || item.productId <= 0 ||
            !Number.isFinite(item.qty) || item.qty <= 0 ||
            !Number.isFinite(item.price) || item.price < 0 ||
            !Number.isFinite(item.unitMultiplier) || item.unitMultiplier <= 0 ||
            (item.lineDiscount !== undefined && (!Number.isFinite(item.lineDiscount) || item.lineDiscount < 0))) {
          throw new AppError('تحتوي الفاتورة على صنف أو كمية أو سعر غير صالح', 'SALE_ITEM_INVALID', 400);
        }
        return item;
      }),
  };
}
