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

export type KioskPaymentStatus = 'paid' | 'unpaid' | 'pending';

export interface KioskConfirmationItem {
  productId: number;
  name: string;
  price: number;
  qty: number;
}

export interface KioskConfirmation {
  orderNumber: string;
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
 * INV-REST-KIOSK-NO-FICTION (R-B1): the single decision for what a finalize
 * attempt produces. A confirmation exists ONLY when the server answered with
 * a real order number. A failed request — or a success response carrying no
 * order number — produces NO confirmation: no invented K-XXXX ticket and no
 * carried-over 'paid' the server never saw. The caller renders the failure
 * state and lets the customer retry.
 */
export function resolveKioskFinalizeOutcome(input: {
  failed: boolean;
  serverOrderNumber?: string | null;
  total: number;
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
  return {
    status: 'confirmed',
    confirmation: {
      orderNumber,
      total: input.total,
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
    // INV-REST-KIOSK-NO-FICTION: an order without a known store slug must
    // fail here, never post to a hardcoded fallback store.
    const slugToUse = resolveKioskSlug([cleanSlug]);
    if (!slugToUse) {
      throw new Error('لا يمكن إرسال الطلب: الكشك غير مرتبط بمتجر معروف.');
    }
    const payload = {
      customerName:
        orderPayload.customerName ||
        (orderPayload.orderType === 'dine_in'
          ? `عميل طاولة ${orderPayload.tableNumber || ''}`.trim()
          : 'طلب كشك استلام سفري'),
      customerPhone: orderPayload.customerPhone || '01000000000',
      orderType: orderPayload.orderType === 'takeaway' ? 'delivery' : 'dine_in',
      fulfillmentType: orderPayload.orderType === 'takeaway' ? 'pickup' : 'dine_in',
      tableNumber: orderPayload.tableNumber ? String(orderPayload.tableNumber) : undefined,
      customerNotes: orderPayload.notes,
      paymentMethod: orderPayload.paymentMethod || 'card',
      items: (orderPayload.items || []).map((item: any) => ({
        productId: item.productId,
        quantity: item.qty || item.quantity || 1,
        notes: item.notes,
      })),
    };
    return await storefrontApi.createOrder(slugToUse, payload as any);
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
