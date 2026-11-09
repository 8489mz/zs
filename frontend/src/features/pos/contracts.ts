import type { PosItem } from '@/features/pos/types/pos.types';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';

export type PaymentType = 'cash' | 'credit';
export type PaymentChannel = 'cash' | 'card' | 'wallet' | 'instapay' | 'credit' | 'mixed';

export interface PosPaymentInput {
  paymentChannel: 'cash' | 'card' | 'wallet' | 'instapay';
  amount: number;
}

export interface CreatePosSaleInput {
  cart: PosItem[];
  customerId: string;
  customerPhone?: string;
  customerAddress?: string;
  paymentType: PaymentType;
  paymentChannel: PaymentChannel;
  discount: number;
  deliveryFee: number;
  note: string;
  paidAmount: number;
  tenderedAmount: number;
  loyaltyPointsRedeemed?: number;
  payments: PosPaymentInput[];
  taxRate: number;
  pricesIncludeTax: boolean;
  expectedTotal: number;
  managerPin?: string;
  branchId?: string | null;
  locationId?: string | null;
  source?: 'pos' | 'dashboard';
  orderType?: string;
  tableNumber?: string | null;
  deliveryRepId?: string | number | null;
  collectionStatus?: string | null;
  deliveryFeeMode?: 'freelance_courier' | 'store_fleet' | string | null;
  /**
   * O62: set when this cart was loaded from a storefront order. The server uses it to re-approve
   * that order's own coupon discount and line prices, so a cashier without canDiscount is not asked
   * for a manager PIN just to bill an order the store already priced.
   */
  onlineOrderId?: number;
  terminalId?: string | null;
  /**
   * INV-REST-PAID-GATES-2 (R4-D, I24 follow-up): the persistent
   * per-browser POS terminal code (localStorage zs_pos_terminal_code,
   * e.g. T4A2) — which register this sale came from. NOT the EDC
   * terminalId above: that identifies the card machine, this one the
   * POS browser. Sent on the online submit (handleSubmit) and the
   * offline sync; the server stores it as pos_terminal_code.
   */
  terminalCode?: string;
  terminalAuthCode?: string | null;
  /**
   * INV-REST-PAID-GATES-2 (R4-D, I40): the amount the payment terminal
   * actually approved for this sale. The backend pins the posted card
   * leg to it (422 TERMINAL_AMOUNT_MISMATCH on drift); a missing or
   * zero value leaves the sale unpinned (manual-auth-code path, M26).
   */
  terminalApprovedAmount?: number;
  terminalRrn?: string | null;
  cardScheme?: string | null;
  cardLastFour?: string | null;
  diningCourse?: 'appetizer' | 'main' | 'dessert' | 'beverage' | string | null;
  pagerNumber?: string | null;
  serviceCharge?: number;
  guestCount?: number;
  guestCheckPrintedAt?: string | null;
  tipAmount?: number;
}

// INV-FE1-FRONTEND-BOOK-DIGITS: every money field of the sale POST
// payload (line prices, discount, delivery fee, service charge, tip,
// payment amounts) rounds at the tenant's book digits — global
// system currency, set from tenant settings at boot; the builders
// carry no settings object. The old getCurrencyDecimals + toFixed
// path missed JOD/TND/IQD/LYD (3dp) and disagreed with backend
// roundMoney on float-edge values (e.g. 2.675).
function normalizeMoney(value: number) {
  return roundMoneyValue(Number(value || 0), currencyMoneyDigits(getGlobalSystemCurrency()));
}

function normalizeCustomerId(value: string) {
  return String(value || '').trim();
}

function normalizeCartQty(item: PosItem) {
  const qty = Number(item.qty || 0);
  if (item.isWeighted === true) return Number(Math.max(0.001, qty).toFixed(3));
  return Math.max(1, Math.round(qty));
}

/*
 * The sale DTOs (SaleItemDto / HeldSaleItemDto) have no nameEn / name_en field and the
 * request validation pipe runs with forbidNonWhitelisted, so sending either key makes
 * the server reject the whole payload with a 400 VALIDATION_ERROR. The English name
 * is display-only (cart, kitchen ticket); strip both keys before any server payload.
 */
export function stripSaleItemNameFields<T extends object>(items: T[]): T[] {
  return items.map((item) => {
    const copy = { ...(item as Record<string, unknown>) };
    delete copy.nameEn;
    delete copy.name_en;
    return copy as T;
  });
}

function normalizeCart(items: PosItem[]) {
  return items.map((item) => ({
    productId: item.productId,
    name: item.name,
    qty: normalizeCartQty(item),
    unitName: item.unitName,
    unitMultiplier: Number.isFinite(Number(item.unitMultiplier)) && Number(item.unitMultiplier) > 0 ? Number(item.unitMultiplier) : 1,
    price: normalizeMoney(Number(item.price || 0)),
    originalPrice: item.originalPrice ? normalizeMoney(Number(item.originalPrice)) : undefined,
    offerDiscount: item.offerDiscount ? normalizeMoney(Number(item.offerDiscount)) : undefined,
    offerName: item.offerName || undefined,
    priceType: item.priceType,
    notes: item.notes,
    modifiers: item.modifiers,
    ...(item.serials && item.serials.length > 0 ? { serials: item.serials } : {}),
  }));
}

export function validatePosSaleInput(input: CreatePosSaleInput) {
  if (!input.cart.length) throw new Error('أضف صنفًا واحدًا على الأقل');
  if (input.cart.some((item) => !item.productId)) throw new Error('توجد عناصر غير صالحة داخل السلة');
  if (input.cart.some((item) => Number(item.qty || 0) <= 0)) throw new Error('كمية الصنف يجب أن تكون أكبر من صفر');
  for (const item of input.cart) {
    if (!item.trackSerials) continue;
    const count = Number(item.qty) * Number(item.unitMultiplier || 1);
    const serials = (item.serials || []).map((serial) => serial.trim().toLowerCase());
    if (!Number.isInteger(count) || serials.length !== count || new Set(serials).size !== serials.length || serials.some((serial) => !serial)) {
      throw new Error(`امسح سيريالاً فريداً لكل قطعة من ${item.name}`);
    }
  }
  if (input.paymentType === 'credit' && !normalizeCustomerId(input.customerId)) throw new Error('اختر العميل أولًا في حالة البيع الآجل');
  if (input.paymentType === 'cash' && input.paymentChannel === 'credit') throw new Error('لا يمكن استخدام قناة آجل مع بيع نقدي');
  if (Number(input.discount || 0) < 0) throw new Error('الخصم لا يمكن أن يكون سالبًا');
  // INV-REST-PAID-GATES-2 (R4-D, I39): negative legs and amounts are
  // rejected here, before any > 0 filter can silently drop them — the
  // submit path used to drop a negative leg and post the rest as if it
  // never existed.
  if ((input.payments || []).some((entry) => Number(entry.amount || 0) < 0)) throw new Error('مبالغ الدفع لا يمكن أن تكون سالبة');
  if (Number(input.deliveryFee || 0) < 0) throw new Error('رسوم التوصيل لا يمكن أن تكون سالبة');
  if (Number(input.tipAmount || 0) < 0) throw new Error('الإكرامية لا يمكن أن تكون سالبة');
  if (Number(input.serviceCharge || 0) < 0) throw new Error('رسوم الخدمة لا يمكن أن تكون سالبة');
  if (Number(input.tenderedAmount || 0) < 0) throw new Error('المبلغ المستلم لا يمكن أن يكون سالبًا');
  // I44: a zero total is not a sale (the 100%-discount case). The old
  // check only rejected a negative total.
  if (Number(input.expectedTotal || 0) <= 0) throw new Error('إجمالي الفاتورة غير صالح');
  const cartLineSubtotal = input.cart.reduce((sum, item) => sum + calcCartLineTotal(item), 0);
  if (Number(input.discount || 0) > cartLineSubtotal) throw new Error('الخصم أكبر من إجمالي الأصناف');
  // I42: a dine-in sale must name its table.
  if (input.orderType === 'dine_in' && !String(input.tableNumber || '').trim()) throw new Error('اختر طاولة أولًا لطلبات الصالة');
  const isCodDelivery = input.orderType === 'delivery' && input.collectionStatus === 'cod';
  const paymentsTotal = (input.payments || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  // I28: no silent partial credit — an underpaid cash sale with a
  // customer is rejected unless the cashier explicitly chose credit.
  // (The old isPartialCreditWithCustomer exemption let it through.)
  if (input.paymentType !== 'credit' && !isCodDelivery && paymentsTotal < Number(input.expectedTotal || 0)) {
    throw new Error('المبلغ المدفوع أقل من إجمالي الفاتورة');
  }
  // I43: an unpaid COD delivery must have a customer to carry the
  // debt. A COD delivery WITH a customer, or one already paid in
  // full, passes.
  if (isCodDelivery && paymentsTotal < Number(input.expectedTotal || 0) && !normalizeCustomerId(input.customerId)) {
    throw new Error('الدليفري غير المسدد يحتاج عميلًا مسجلًا');
  }
  // I40: when the terminal approved an amount, the card leg must equal
  // it — a leg edited after approval cannot post for a different amount.
  const approvedAmount = Number(input.terminalApprovedAmount || 0);
  if (input.terminalAuthCode && approvedAmount > 0) {
    const cardLegTotal = (input.payments || [])
      .filter((entry) => entry.paymentChannel === 'card')
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    if (Math.abs(cardLegTotal - approvedAmount) > 0.0001) {
      throw new Error('المبلغ المعتمد من الماكينة لا يطابق مبلغ البطاقة');
    }
  }

  const nonCashTotal = (input.payments || [])
    .filter(p => p.paymentChannel !== 'cash')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  if (nonCashTotal > Number(input.expectedTotal || 0)) {
    throw new Error('لا يمكن دفع مبلغ أكبر من إجمالي الفاتورة باستخدام طرق الدفع الإلكترونية');
  }
}

function normalizePaymentsCapped(payments: PosPaymentInput[], expectedTotal: number) {
  const result: Array<{ paymentChannel: 'cash' | 'card' | 'wallet' | 'instapay'; amount: number }> = [];
  let remainingTotal = Number(expectedTotal || 0);

  // Process non-cash first
  for (const p of payments.filter(p => p.paymentChannel !== 'cash')) {
    const amountToApply = Math.min(Number(p.amount || 0), remainingTotal);
    if (amountToApply > 0) {
      result.push({ 
        paymentChannel: p.paymentChannel as 'card' | 'wallet' | 'instapay', 
        amount: normalizeMoney(amountToApply) 
      });
      remainingTotal -= amountToApply;
    }
  }

  // Process cash
  for (const p of payments.filter(p => p.paymentChannel === 'cash')) {
    if (remainingTotal <= 0) break;
    const amountToApply = Math.min(Number(p.amount || 0), remainingTotal);
    if (amountToApply > 0) {
      result.push({ 
        paymentChannel: 'cash', 
        amount: normalizeMoney(amountToApply) 
      });
      remainingTotal -= amountToApply;
    }
  }

  return result;
}

export function buildPosSalePayload(input: CreatePosSaleInput) {
  validatePosSaleInput(input);

  const customerId = normalizeCustomerId(input.customerId);
  return {
    customerId: customerId || null,
    customerPhone: input.customerPhone || undefined,
    customerAddress: input.customerAddress || undefined,
    paymentType: input.paymentType,
    paymentChannel: input.paymentChannel,
    discount: normalizeMoney(Number(input.discount || 0)),
    deliveryFee: normalizeMoney(Number(input.deliveryFee || 0)),
    note: String(input.note || '').trim(),
    payments: normalizePaymentsCapped(input.payments || [], input.expectedTotal),
    tenderedAmount: Number(input.tenderedAmount || 0),
    storeCreditUsed: 0,
    loyaltyPointsRedeemed: Number(input.loyaltyPointsRedeemed || 0),
    taxRate: normalizeMoney(Number(input.taxRate || 0)),
    ...(String(input.managerPin || '').trim() ? { managerPin: String(input.managerPin || '').trim() } : {}),
    pricesIncludeTax: Boolean(input.pricesIncludeTax),
    branchId: input.branchId || null,
    locationId: input.locationId || null,
    source: input.source || 'pos',
    orderType: input.orderType || 'direct',
    deliveryFeeMode: input.deliveryFeeMode || 'freelance_courier',
    ...(Number(input.onlineOrderId) > 0 ? { onlineOrderId: Number(input.onlineOrderId) } : {}),
    collectionStatus: input.collectionStatus || (input.orderType === 'delivery' ? 'cod' : null),
    ...(input.deliveryRepId && Number(input.deliveryRepId) > 0 ? {
      deliveryRepId: Number(input.deliveryRepId),
    } : {}),
    ...(input.tableNumber ? { tableNumber: input.tableNumber } : {}),
    ...(input.diningCourse ? { diningCourse: input.diningCourse } : {}),
    ...(input.pagerNumber ? { pagerNumber: input.pagerNumber } : {}),
    ...(input.terminalId ? { terminalId: input.terminalId } : {}),
    ...(input.terminalCode ? { terminalCode: input.terminalCode } : {}),
    ...(input.terminalAuthCode ? { terminalAuthCode: input.terminalAuthCode } : {}),
    ...(Number(input.terminalApprovedAmount) > 0 ? { terminalApprovedAmount: Number(input.terminalApprovedAmount) } : {}),
    ...(input.terminalRrn ? { terminalRrn: input.terminalRrn } : {}),
    ...(input.cardScheme ? { cardScheme: input.cardScheme } : {}),
    ...(input.cardLastFour ? { cardLastFour: input.cardLastFour } : {}),
    ...(Number(input.serviceCharge) > 0 ? { serviceCharge: normalizeMoney(Number(input.serviceCharge)) } : {}),
    ...(Number(input.guestCount) > 0 ? { guestCount: Math.max(1, Math.round(Number(input.guestCount))) } : {}),
    ...(input.guestCheckPrintedAt ? { guestCheckPrintedAt: input.guestCheckPrintedAt } : {}),
    ...(Number(input.tipAmount) > 0 ? { tipAmount: normalizeMoney(Number(input.tipAmount)) } : {}),
    items: normalizeCart(input.cart)
  };
}

export function buildLegacyPosSalePayload(input: CreatePosSaleInput) {
  validatePosSaleInput(input);

  const customerId = normalizeCustomerId(input.customerId);
  const normalizedItems = normalizeCart(input.cart);
  const positivePayments = normalizePaymentsCapped(input.payments || [], input.expectedTotal);
  const uniqueChannels = Array.from(new Set(positivePayments.map((entry) => entry.paymentChannel)));
  const simplePaymentChannel: PaymentChannel =
    input.paymentType === 'credit'
      ? 'credit'
      : uniqueChannels.length > 1
        ? 'mixed'
        : uniqueChannels[0] === 'instapay'
          ? 'instapay'
          : uniqueChannels[0] === 'wallet'
            ? 'wallet'
            : uniqueChannels[0] === 'card'
              ? 'card'
              : 'cash';

  return {
    customerId: customerId || null,
    paymentType: input.paymentType,
    paymentChannel: simplePaymentChannel,
    discount: normalizeMoney(Number(input.discount || 0)),
    loyaltyPointsRedeemed: Number(input.loyaltyPointsRedeemed || 0),
    deliveryFee: normalizeMoney(Number(input.deliveryFee || 0)),
    deliveryFeeMode: input.deliveryFeeMode || 'freelance_courier',
    note: String(input.note || '').trim(),
    tenderedAmount: Number(input.tenderedAmount || 0),
    taxRate: normalizeMoney(Number(input.taxRate || 0)),
    ...(String(input.managerPin || '').trim() ? { managerPin: String(input.managerPin || '').trim() } : {}),
    pricesIncludeTax: Boolean(input.pricesIncludeTax),
    branchId: input.branchId || null,
    locationId: input.locationId || null,
    source: input.source || 'pos',
    orderType: input.orderType || 'direct',
    collectionStatus: input.collectionStatus || (input.orderType === 'delivery' ? 'cod' : null),
    ...(Number(input.onlineOrderId) > 0 ? { onlineOrderId: Number(input.onlineOrderId) } : {}),
    ...(input.pagerNumber ? { pagerNumber: input.pagerNumber } : {}),
    ...(input.deliveryRepId && Number(input.deliveryRepId) > 0 ? {
      deliveryRepId: Number(input.deliveryRepId),
    } : {}),
    ...(Number(input.serviceCharge) > 0 ? { serviceCharge: normalizeMoney(Number(input.serviceCharge)) } : {}),
    ...(Number(input.guestCount) > 0 ? { guestCount: Math.max(1, Math.round(Number(input.guestCount))) } : {}),
    ...(Number(input.tipAmount) > 0 ? { tipAmount: normalizeMoney(Number(input.tipAmount)) } : {}),
    items: normalizedItems.map((item) => ({
      productId: item.productId,
      qty: item.qty,
      unitName: item.unitName,
      unitMultiplier: item.unitMultiplier,
      price: item.price,
      priceType: item.priceType,
      notes: item.notes,
      modifiers: item.modifiers
    }))
  };
}

/* R4-C I51: buildMinimalPosSalePayload is DELETED, not fixed. It mapped
 * items to {productId, qty, price, unitName, unitMultiplier} only —
 * dropping modifiers, discount, deliveryFee, taxRate, serviceCharge,
 * tipAmount, payments, tenderedAmount, tableNumber and orderType — so a
 * modifier sale retried through it posted at base price. The retry path
 * is dead at this base (pos.api createSale throws on a 400 before any
 * retry when an idempotency key is present, and every live caller
 * passes one), so deleting it changes no live behaviour; the surviving
 * retry leg is buildLegacyPosSalePayload, which preserves modifiers
 * and the sale terms. */
