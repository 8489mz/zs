import { useQuery } from '@tanstack/react-query';
import { storefrontApi } from '@/features/storefront';
import { posApi } from '@/features/pos/api/pos.api';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';

/**
 * INV-REST-KIOSK-NO-FICTION (R-B4): the kiosk resolves its store slug from
 * the caller's candidates only — the first non-empty one wins. There is NO
 * default slug: an empty or unknown slug resolves to null and the caller
 * must fail closed (never serve another tenant's menu). The old default
 * ('almhnds') and the silent fallback chain ('almhnds' -> 'default' -> POS
 * catalog) are removed.
 */
export function resolveKioskSlug(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const slug = String(candidate || '').trim().toLowerCase();
    if (slug) return slug;
  }
  return null;
}

/**
 * INV-REST-FNB-TRUTH-2 (R-I11): the kiosk menu EXCLUDES 86'd items
 * entirely — never greyed-out: a greyed-out item on a
 * customer-facing menu invites confusion and support calls, and the
 * kitchen toggles 86 precisely to stop orders. Ids match across
 * number/string shapes (the catalog carries numeric ids, the 86
 * list may carry either). The server still rejects any 86'd line at
 * createOnlineOrder, so a stale menu can never place the order.
 */
export function filterKioskMenuItems<T extends { id: number | string }>(
  items: T[],
  eightySixedIds?: Array<number | string> | null,
): T[] {
  if (!eightySixedIds || eightySixedIds.length === 0) return items;
  const blocked = new Set(eightySixedIds.map((id) => String(id)));
  return items.filter((item) => !blocked.has(String(item.id)));
}

export type KioskPaymentStatus = 'paid' | 'unpaid' | 'pending';

export interface KioskConfirmationItem {
  productId: number;
  name: string;
  price: number;
  qty: number;
}

export interface KioskConfirmation {
  orderNumber: string;
  /** The SERVER's recorded total for the order (totalAmount from the createOrder response) — never the kiosk's raw sum. */
  total: number;
  diningMode: string;
  tableNumber?: string;
  items: KioskConfirmationItem[];
  placedAt: string;
  paymentStatus: KioskPaymentStatus;
  paymentMethodLabel: string;
  authCode?: string;
  rrn?: string;
}

/**
 * INV-REST-KIOSK-ORDER-TRUTH (R-I56): the kiosk never invents a customer
 * phone. The page collects no phone by default — `guestPhone` starts empty
 * and has no fallback — so a missing phone resolves to `undefined` and the
 * order is sent without one. The old fallback ('01000000000') was a
 * format-valid Egyptian number, so it sailed through every server check
 * and every kiosk order was recorded against a number nobody owns.
 */
export function resolveKioskCustomerPhone(raw: string | null | undefined): string | undefined {
  const phone = String(raw || '').trim();
  return phone ? phone : undefined;
}

/**
 * INV-REST-KIOSK-ORDER-TRUTH (R-I56): the same phone rule the server
 * enforces (assertValidCustomerPhone): an Egyptian mobile is 11 digits
 * starting 010/011/012/015, anything else is 7–16 digits. The fake
 * '01000000000' is format-valid by this rule — that is exactly why the
 * fix is to never SEND it (see resolveKioskCustomerPhone), not to
 * validate it away here.
 */
export function isValidKioskCustomerPhone(raw: string | null | undefined): boolean {
  const cleaned = String(raw || '').replace(/[^0-9+]/g, '');
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (cleaned.startsWith('01') || cleaned.length === 11) {
    return /^01[0125]\d{8}$/.test(digitsOnly);
  }
  return digitsOnly.length >= 7 && digitsOnly.length <= 16;
}

/**
 * INV-REST-KIOSK-ORDER-TRUTH (idempotency): one key per finalize attempt.
 * The page keeps the key for the whole attempt (including its retries) and
 * generates a fresh one for the next attempt, so a retried finalize replays
 * the same order instead of creating a second one. The server already
 * dedupes on idempotencyKey (pre-check + in-transaction replay); the kiosk
 * simply never sent one.
 */
export function newKioskIdempotencyKey(): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
  return `kiosk-${uuid}`;
}

/**
 * INV-REST-KIOSK-ORDER-TRUTH (R-I54 + idempotency): the single place the
 * kiosk order payload is built. The customer phone passes through exactly
 * as typed (or is absent — never the fake fallback), the idempotency key
 * passes through when the caller holds one, and the takeaway mapping
 * (orderType 'delivery' + fulfillmentType 'pickup') is unchanged.
 */
export function buildKioskOrderPayload(
  orderPayload: {
    customerName?: string;
    customerPhone?: string;
    orderType?: string;
    tableNumber?: string;
    notes?: string;
    paymentMethod?: string;
    items?: Array<{ productId: number; qty?: number; quantity?: number; notes?: string }>;
    idempotencyKey?: string;
  },
  cleanSlug: string | null,
): Record<string, unknown> {
  // INV-REST-KIOSK-NO-FICTION: an order without a known store slug must
  // fail here, never post to a hardcoded fallback store.
  if (!cleanSlug) {
    throw new Error('لا يمكن إرسال الطلب: الكشك غير مرتبط بمتجر معروف.');
  }
  return {
    customerName:
      orderPayload.customerName ||
      (orderPayload.orderType === 'dine_in'
        ? `عميل طاولة ${orderPayload.tableNumber || ''}`.trim()
        : 'طلب كشك استلام سفري'),
    customerPhone: resolveKioskCustomerPhone(orderPayload.customerPhone),
    orderType: orderPayload.orderType === 'takeaway' ? 'delivery' : 'dine_in',
    fulfillmentType: orderPayload.orderType === 'takeaway' ? 'pickup' : 'dine_in',
    tableNumber: orderPayload.tableNumber ? String(orderPayload.tableNumber) : undefined,
    customerNotes: orderPayload.notes,
    paymentMethod: orderPayload.paymentMethod || 'card',
    idempotencyKey: String(orderPayload.idempotencyKey || '').trim() || undefined,
    items: (orderPayload.items || []).map((item) => ({
      productId: item.productId,
      quantity: item.qty || item.quantity || 1,
      notes: item.notes,
    })),
  };
}

/**
 * INV-REST-KIOSK-ORDER-TRUTH: the kiosk shows the server's refusal
 * verbatim only when the refusal names the closed shift — a customer at
 * a closed restaurant must know retrying will not help and should go to
 * the counter instead. Every other failure keeps the generic visible
 * error from R2-A (the server's other messages are validation or network
 * noise the customer cannot act on).
 */
export function resolveKioskOrderErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message && message.includes('وردية مفتوحة')) return message;
  return 'تعذّر إرسال الطلب إلى النظام. تحقق من الاتصال وحاول مرة أخرى.';
}

/**
 * INV-REST-KIOSK-ORDER-TRUTH (R-I54): the confirmation shows the SERVER's
 * recorded total for the order — the totalAmount the server computed from
 * its own prices and offers — never the kiosk's raw sum. A confirmation
 * exists ONLY on a real server order number AND a finite server total; a
 * success response carrying no total is treated exactly like a failure.
 */
export function resolveKioskFinalizeOutcome(input: {
  failed: boolean;
  serverOrderNumber?: string | null;
  serverTotal?: number | null;
  diningModeLabel: string;
  tableNumber?: string;
  items: KioskConfirmationItem[];
  placedAt: string;
  paymentStatus: KioskPaymentStatus;
  paymentMethodLabel: string;
  authCode?: string;
  rrn?: string;
}): { status: 'confirmed'; confirmation: KioskConfirmation } | { status: 'failed' } {
  const orderNumber = String(input.serverOrderNumber || '').trim();
  if (input.failed || !orderNumber) return { status: 'failed' };
  // The confirmation total is the server's recorded total. A missing or
  // non-numeric total means the server never recorded the order properly.
  if (!Number.isFinite(input.serverTotal)) return { status: 'failed' };
  return {
    status: 'confirmed',
    confirmation: {
      orderNumber,
      total: input.serverTotal as number,
      diningMode: input.diningModeLabel,
      tableNumber: input.tableNumber,
      items: [...input.items],
      placedAt: input.placedAt,
      paymentStatus: input.paymentStatus,
      paymentMethodLabel: input.paymentMethodLabel,
      authCode: input.authCode,
      rrn: input.rrn,
    },
  };
}

export interface KioskConfirmationCopy {
  tone: KioskPaymentStatus;
  heroTitle: string;
  heroNote: string;
  badgeText: string;
  printLabel: string;
  receiptTitle: string;
  receiptBody: string;
  receiptFooter: string;
}

/**
 * INV-REST-KIOSK-NO-FICTION (R-B2): the words on the ticket. 'pending' is a
 * third, honest state — the customer claims a QR transfer, the server still
 * holds payment_status 'pending', and the ticket says the transfer awaits
 * verification by the cashier. It never says PAID and never says "pay at the
 * counter" either: the counter must verify the transfer, not take a second
 * payment. 'paid' is reserved for a verified approval (card terminal).
 */
export function kioskConfirmationCopy(
  paymentStatus: KioskPaymentStatus,
  details: { totalText: string; paymentMethodLabel: string },
  t: (key: string, fallback: string) => string,
): KioskConfirmationCopy {
  if (paymentStatus === 'paid') {
    return {
      tone: 'paid',
      heroTitle: t('pos.self_ordering_kiosk_page.s10', 'تم استلام ودفع طلبك بنجاح!'),
      heroNote: t('pos.self_ordering_kiosk_page.s11', 'طلبك أُرسل لشاشات المطبخ ويتم تجهيزه الآن بكل عناية'),
      badgeText: `${t('pos.self_ordering_kiosk_page.s14', 'مدفوع بالكامل •')} ${details.paymentMethodLabel}`,
      printLabel: t('pos.self_ordering_kiosk_page.s20', 'طباعة إيصال الطلب والنداء'),
      receiptTitle: t('pos.self_ordering_kiosk_page.s28', '*** طلب مدفوع بالكامل - PAID ***'),
      receiptBody: `${t('pos.self_ordering_kiosk_page.s29', 'طريقة الدفع:')} ${details.paymentMethodLabel}`,
      receiptFooter: t('pos.self_ordering_kiosk_page.s34', 'شكراً لزيارتكم! يرجى الانتظار حتى مناداة رقمك على الشاشة.'),
    };
  }
  if (paymentStatus === 'pending') {
    return {
      tone: 'pending',
      heroTitle: t('pos.self_ordering_kiosk_page.s124', 'تم تسجيل طلبك — التحويل قيد التأكيد'),
      heroNote: `${t('pos.self_ordering_kiosk_page.s125', 'أرسلت تحويلاً بقيمة')} ${details.totalText} ${t('pos.self_ordering_kiosk_page.s126', '— اعرض هذه التذكرة للكاشير للتأكد من وصول التحويل قبل بدء التحضير')}`,
      badgeText: t('pos.self_ordering_kiosk_page.s127', 'بانتظار تأكيد التحويل • اعرض التذكرة للكاشير'),
      printLabel: t('pos.self_ordering_kiosk_page.s128', 'طباعة تذكرة بانتظار التأكيد'),
      receiptTitle: t('pos.self_ordering_kiosk_page.s129', '*** بانتظار تأكيد التحويل - PENDING ***'),
      receiptBody: t('pos.self_ordering_kiosk_page.s130', 'اعرض هذه التذكرة للكاشير للتأكد من وصول التحويل قبل بدء التحضير'),
      receiptFooter: t('pos.self_ordering_kiosk_page.s131', 'تحويلك قيد التأكيد — اعرض التذكرة للكاشير قبل بدء التحضير.'),
    };
  }
  return {
    tone: 'unpaid',
    heroTitle: t('pos.self_ordering_kiosk_page.s7', 'تم تسجيل طلبك بنجاح!'),
    heroNote: `${t('pos.self_ordering_kiosk_page.s8', 'تذكرتك غير مدفوعة حالياً • يرجى أخذ التذكرة والتوجه لكاونتر الكاشير لسداد')} ${details.totalText} ${t('pos.self_ordering_kiosk_page.s9', '(نقداً أو بالفيزا) لتأكيد الطلب وبدء تحضيره فوراً')}`,
    badgeText: t('pos.self_ordering_kiosk_page.s13', 'تذكرة غير مدفوعة • يلزم السداد لدى الكاشير'),
    printLabel: t('pos.self_ordering_kiosk_page.s19', 'طباعة تذكرة السداد لدى الكاشير'),
    receiptTitle: t('pos.self_ordering_kiosk_page.s25', '*** تذكرة غير مدفوعة - UNPAID ***'),
    receiptBody: `${t('pos.self_ordering_kiosk_page.s26', 'يرجى التوجه للكاشير لسداد')} ${details.totalText} ${t('pos.self_ordering_kiosk_page.s27', '(نقداً أو بالبطاقة البنكية)')}`,
    receiptFooter: t('pos.self_ordering_kiosk_page.s33', 'يرجى سداد هذه التذكرة لدى الكاشير لتأكيد طلبك وبدء تحضيره في المطبخ.'),
  };
}

export function useSelfOrderingKiosk(storeSlug: string | null | undefined) {
  const cleanSlug = resolveKioskSlug([storeSlug]);

  const { data: catalogData, isLoading: isCatalogLoading } = useQuery({
    queryKey: ['kiosk-catalog', cleanSlug ?? ''],
    queryFn: async () => {
      // INV-REST-KIOSK-NO-FICTION: no slug means no store, so no menu —
      // fail closed. And exactly one catalog attempt: the requested store
      // only. A failed or empty catalog stays empty; there is no fallback
      // chain to another tenant's menu or to the POS catalog.
      if (!cleanSlug) return { categories: [], products: [] };
      try {
        const cat = await storefrontApi.getCatalog(cleanSlug);
        if (cat && cat.products && cat.products.length > 0) return cat;
      } catch {
        // fall through to the empty catalog below
      }
      return { categories: [], products: [] };
    },
    staleTime: 60_000,
  });

  const checkUpsell = async (productId: number) => {
    try {
      const rules = await restaurantAdvancedFnbApi.getUpsellRecommendations(productId);
      return rules || [];
    } catch {
      return [];
    }
  };

  const createOrder = async (orderPayload: any) => {
    const payload = buildKioskOrderPayload(orderPayload, cleanSlug);
    return await storefrontApi.createOrder(cleanSlug as string, payload as any);
  };

  const listTerminals = async () => {
    try {
      const res = await posApi.listTerminals();
      return res?.data || [];
    } catch {
      return [];
    }
  };

  const initiateTerminalCharge = async (payload: { terminalId?: string; amount: number; invoiceReference?: string }) => {
    return await posApi.initiateTerminalCharge(payload);
  };

  return {
    catalogData,
    isCatalogLoading,
    checkUpsell,
    createOrder,
    listTerminals,
    initiateTerminalCharge,
  };
}
