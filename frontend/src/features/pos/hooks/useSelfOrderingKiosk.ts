import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { storefrontApi } from '@/features/storefront';
import { posApi } from '@/features/pos/api/pos.api';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';
import type { ModifierGroup } from '@/shared/api/addons.api';
/* The page types its picker state from the hook (pages must not import
 * the api layer directly — composition check). */
export type { ModifierGroup };
import {
  buildGroupModifierSelection,
  type GroupModifierSelection,
} from '@/features/pos/components/pos-cart-panel/group-modifier-mapping';
import { calcCartLineTotal, calcModifiersTotal } from '@/features/pos/lib/pos-modifier-totals';

export type { GroupModifierSelection };
export { buildGroupModifierSelection };

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

/**
 * INV-REST-KIOSK-MODIFIER-UI (R7-B2): the kiosk cart model with modifiers.
 * A cart line's identity is its product PLUS its chosen options — the same
 * product with different extras is a SEPARATE line, never merged into one
 * (the old model merged by productId only, so two different modifier
 * choices of one product collapsed into a single line). The key sorts the
 * option ids, so the same pick in a different tap order is still the same
 * line; an option's qty rides in the key too, so "extra cheese x1" and
 * "extra cheese x2" stay separate lines.
 */
export interface KioskCartLineLike {
  productId: number;
  price: number;
  qty: number;
  modifiers?: GroupModifierSelection[] | null;
}

export function kioskCartLineKey(
  productId: number,
  modifiers?: GroupModifierSelection[] | null,
): string {
  const parts = (modifiers || [])
    .filter((m) => Number(m.optionId || 0) > 0)
    .map((m) => `${Number(m.optionId)}:${Number(m.qty || 1)}`)
    .sort();
  return `${Number(productId)}|${parts.join(',')}`;
}

/** Per-unit price of one cart line: base price + the selected modifiers. */
export function kioskCartLineUnitPrice(line: KioskCartLineLike): number {
  return Number(line.price || 0) + calcModifiersTotal(line.modifiers);
}

/** Whole-cart total: Σ qty × (base + modifiers), the same formula the
 * backend charges (R-B8 pos-modifier-totals), so the total the customer
 * confirms against already includes their paid extras. */
export function kioskCartTotal(cart: KioskCartLineLike[]): number {
  return (cart || []).reduce((sum, line) => sum + calcCartLineTotal(line), 0);
}

/** Add one line: merge into the existing line with the SAME identity
 * (qty + 1), otherwise append a new line. */
export function addKioskCartLine<T extends KioskCartLineLike>(cart: T[], line: T): T[] {
  const key = kioskCartLineKey(line.productId, line.modifiers);
  const idx = cart.findIndex((item) => kioskCartLineKey(item.productId, item.modifiers) === key);
  if (idx === -1) return [...cart, line];
  const next = [...cart];
  next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
  return next;
}

/** Replace one line's modifiers (edit-in-review / edit-in-tray). When the
 * new selection collides with ANOTHER line of the same product, the two
 * lines merge (the edited line's qty moves into the other line) instead
 * of leaving two identical lines behind. */
export function updateKioskCartLineModifiers<T extends KioskCartLineLike>(
  cart: T[],
  lineKey: string,
  modifiers: GroupModifierSelection[],
): T[] {
  const idx = cart.findIndex((item) => kioskCartLineKey(item.productId, item.modifiers) === lineKey);
  if (idx === -1) return cart;
  const edited = { ...cart[idx], modifiers };
  const newKey = kioskCartLineKey(edited.productId, edited.modifiers);
  const collision = cart.findIndex(
    (item, i) => i !== idx && kioskCartLineKey(item.productId, item.modifiers) === newKey,
  );
  if (collision === -1) {
    const next = [...cart];
    next[idx] = edited;
    return next;
  }
  return cart
    .map((item, i) => {
      if (i === collision) return { ...item, qty: item.qty + edited.qty };
      if (i === idx) return null;
      return item;
    })
    .filter(Boolean) as T[];
}

/**
 * INV-REST-KIOSK-MODIFIER-UI (R7-B2): the client-side mirror of the
 * server's R4-C group rules (validateModifierGroupRules). A mandatory
 * group needs at least max(1, min) picks; an optional group may be
 * skipped entirely, but once picked it must reach its min; a
 * single-select group takes at most one; every group caps at its max.
 * The count is the number of picked OPTIONS in the group — an option's
 * qty never counts as extra picks, exactly like the server. Returns the
 * first broken rule as a specific Arabic message, or null when the
 * selection satisfies every group. The server still re-validates (422),
 * so this is the customer's early, specific error — never the only gate.
 */
export function validateKioskModifierSelection(
  groups: ModifierGroup[],
  selections: GroupModifierSelection[],
): string | null {
  for (const group of groups || []) {
    if (group.isActive === false) continue;
    const count = (selections || []).filter((m) => Number(m.groupId) === Number(group.id)).length;
    const min = Math.max(0, Math.floor(Number(group.minSelections || 0)));
    const max =
      String(group.selectionType || '') === 'single'
        ? 1
        : Number(group.maxSelections) > 0
          ? Math.floor(Number(group.maxSelections))
          : Number.MAX_SAFE_INTEGER;
    if (group.isMandatory && count < Math.max(1, min)) {
      return `يرجى اختيار ${group.name} — هذه المجموعة إلزامية`;
    }
    if (count > 0 && count < min) {
      return `يرجى اختيار ${min} على الأقل من مجموعة "${group.name}"`;
    }
    if (count > max) {
      return `الحد الأقصى للاختيار في مجموعة "${group.name}" هو ${max === 1 ? 1 : group.maxSelections}`;
    }
  }
  return null;
}

/**
 * INV-REST-FNB-TRUTH-2 (R-I11): the kiosk's 86 list lives in the feature
 * hook, never in the page (pages must go through hooks — the composition
 * check). 86'd items never reach the kiosk menu — excluded entirely,
 * not greyed-out. No branch is known on the public kiosk, so the
 * tenant-wide list applies (a branch-scoped 86 hides the item here
 * too; the kitchen toggles 86 precisely to stop orders). If the fetch
 * fails the menu stays unfiltered and the server still rejects any
 * 86'd line at createOnlineOrder, so a stale menu can never place
 * the order.
 */
export function useKiosk86Items(currentSlug: string | null | undefined): Array<number | string> {
  const { data: items86 = [] } = useQuery({
    queryKey: ['pos-86-items-kiosk', currentSlug],
    queryFn: () => restaurantAdvancedFnbApi.get86Items(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  // INV-REST-KIOSK-MENU-SCALE (T10-B): the mapped ids are memoized on
  // the query data — the old code mapped a NEW array on every render,
  // so the 10 s clock tick busted the page's products/filteredProducts
  // memos and reconciled the whole menu grid again on every tick.
  return useMemo(() => items86.map((item) => item.product_id), [items86]);
}

/**
 * INV-REST-KIOSK-MENU-SCALE (T10-B): the kiosk menu is ONE server page
 * at a time — never the whole catalog. The trial tenant holds 10,000
 * products; fetching and rendering them all as cards in one pass froze
 * the tab, and the clock tick re-rendered them every 10 s.
 *
 * KIOSK_CATALOG_PAGE_SIZE (50) is the page the hook asks the server
 * for (server max 200) and the hard cap on the rendered window:
 * boundKioskMenuWindow slices any page down to it, so even a server
 * that ignored pageSize could never hand the grid more than one page.
 * kioskMenuTotalPages turns the server's totalCount into the page
 * count the pager shows.
 */
export const KIOSK_CATALOG_PAGE_SIZE = 50;

export function boundKioskMenuWindow<T>(items: T[], limit: number = KIOSK_CATALOG_PAGE_SIZE): T[] {
  if (!items || items.length === 0) return [];
  return items.length <= limit ? items : items.slice(0, limit);
}

export function kioskMenuTotalPages(totalCount: number, pageSize: number = KIOSK_CATALOG_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, Math.floor(Number(totalCount) || 0)) / Math.max(1, pageSize)));
}

/** Server-side menu filter: category and search travel to the server
 * as categoryId/q — the browser never holds the whole catalog to
 * filter it. 'all' means no category filter. */
export interface KioskMenuFilter {
  categoryId?: number | 'all';
  search?: string;
}

export type KioskPaymentStatus = 'paid' | 'unpaid' | 'pending';

export interface KioskConfirmationItem {
  productId: number;
  name: string;
  price: number;
  qty: number;
  /** Modifiers picked on this line, so the ticket/receipt shows them. */
  modifiers?: Array<{ name: string; qty?: number; price?: number }>;
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
 *
 * INV-REST-KIOSK-MODIFIER-UI (R7-B2): a line's picked modifiers travel
 * with it (the server re-prices them from server truth — the client
 * price is never trusted). A line with no modifiers omits the field
 * entirely, so a modifier-less order is byte-identical to before.
 */
export function buildKioskOrderPayload(
  orderPayload: {
    customerName?: string;
    customerPhone?: string;
    orderType?: string;
    tableNumber?: string;
    notes?: string;
    paymentMethod?: string;
    items?: Array<{
      productId: number;
      qty?: number;
      quantity?: number;
      notes?: string;
      modifiers?: GroupModifierSelection[];
    }>;
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
      modifiers:
        item.modifiers && item.modifiers.length > 0 ? item.modifiers : undefined,
    })),
  };
}

/**
 * INV-REST-KIOSK-ERROR-TRUTH (T1): the kiosk shows the server's business
 * refusal verbatim — a 400/422 ApiError carrying a real message (not
 * entitled, pickup disabled, product unavailable, out of stock, modifier
 * contract) is the server's answer, never a network failure, and the
 * customer must see the real reason. The closed-shift refusal stays
 * verbatim as before (it is a 400 too, but it also passes through as a
 * plain Error with no status). The generic error is kept ONLY for
 * genuine network/timeout/unknown errors: no usable message, a
 * network/timeout ApiError (status 0/408), a plain network-flavoured
 * error, or a non-business status (401/500/...). A 400/422 whose message
 * is only http.ts's own fallback ('تعذر تنفيذ العملية المطلوبة.') means
 * the server sent nothing usable, so it is generic too.
 */
const KIOSK_ORDER_GENERIC_ERROR =
  'تعذّر إرسال الطلب إلى النظام. تحقق من الاتصال وحاول مرة أخرى.';
const HTTP_FALLBACK_MESSAGE = 'تعذر تنفيذ العملية المطلوبة.';
const NETWORK_MESSAGE_MARKERS = [
  'network error',
  'failed to fetch',
  'fetch failed',
  'networkerror',
  'تعذر الاتصال بالخادم',
  'انتهت مهلة الطلب',
];

export function resolveKioskOrderErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  if (message && message.includes('وردية مفتوحة')) return message;
  if (!message) return KIOSK_ORDER_GENERIC_ERROR;
  const record = (error ?? {}) as { status?: unknown; code?: unknown; name?: unknown };
  const status = typeof record.status === 'number' ? record.status : null;
  const code = typeof record.code === 'string' ? record.code.toLowerCase() : '';
  const name = typeof record.name === 'string' ? record.name.toLowerCase() : '';
  // Genuine network/timeout failures are generic — never dressed up as
  // a business refusal. http.ts throws these as ApiError(status 0,
  // code 'network_error') and ApiError(status 408, code 'timeout').
  if (status === 0 || status === 408 || code === 'network_error' || code === 'timeout' || name === 'aborterror') {
    return KIOSK_ORDER_GENERIC_ERROR;
  }
  const lowered = message.toLowerCase();
  if (NETWORK_MESSAGE_MARKERS.some((marker) => lowered.includes(marker))) {
    return KIOSK_ORDER_GENERIC_ERROR;
  }
  // A business refusal: 400/422 with a real server message.
  if ((status === 400 || status === 422) && message !== HTTP_FALLBACK_MESSAGE) {
    return message;
  }
  return KIOSK_ORDER_GENERIC_ERROR;
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

export function useSelfOrderingKiosk(storeSlug: string | null | undefined, menuFilter: KioskMenuFilter = {}) {
  const cleanSlug = resolveKioskSlug([storeSlug]);
  const categoryId =
    menuFilter.categoryId === 'all' || menuFilter.categoryId === undefined
      ? undefined
      : Number(menuFilter.categoryId);
  const search = String(menuFilter.search || '').trim();

  // INV-REST-KIOSK-MENU-SCALE (T10-B): search is debounced 300 ms so
  // typing a word fires one server query, not one per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // The menu page. A new slug, category or search restarts at page 1 —
  // page 3 of "all" is meaningless once the filter changes.
  const [catalogPage, setCatalogPage] = useState(1);
  useEffect(() => {
    setCatalogPage(1);
  }, [cleanSlug, categoryId, debouncedSearch]);

  const { data: catalogData, isLoading: isCatalogLoading } = useQuery({
    queryKey: ['kiosk-catalog-page', cleanSlug ?? '', catalogPage, categoryId ?? 0, debouncedSearch],
    queryFn: async () => {
      const emptyPage = {
        categories: [],
        products: [],
        page: 1,
        pageSize: KIOSK_CATALOG_PAGE_SIZE,
        totalCount: 0,
        hasMore: false,
      };
      // INV-REST-KIOSK-NO-FICTION: no slug means no store, so no menu —
      // fail closed. And exactly one catalog attempt: the requested store
      // only. A failed or empty catalog stays empty; there is no fallback
      // chain to another tenant's menu or to the POS catalog.
      if (!cleanSlug) return emptyPage;
      try {
        const cat = await storefrontApi.getCatalogPage(cleanSlug, {
          page: catalogPage,
          pageSize: KIOSK_CATALOG_PAGE_SIZE,
          categoryId,
          q: debouncedSearch || undefined,
        });
        if (cat && cat.products) {
          return {
            ...cat,
            products: boundKioskMenuWindow(cat.products),
            totalCount: Number(cat.totalCount ?? 0),
            hasMore: Boolean(cat.hasMore),
          };
        }
      } catch {
        // fall through to the empty catalog below
      }
      return emptyPage;
    },
    staleTime: 60_000,
    // Paging keeps the previous page visible while the next loads.
    placeholderData: keepPreviousData,
  });

  const checkUpsell = async (productId: number) => {
    try {
      const rules = await restaurantAdvancedFnbApi.getUpsellRecommendations(productId);
      return rules || [];
    } catch {
      return [];
    }
  };

  /*
   * INV-REST-KIOSK-MODIFIER-UI (R7-B2): the kiosk's modifier data comes
   * ONLY from the public storefront endpoint (slug-scoped, no auth
   * token) — never from the authenticated addonsApi, which the public
   * kiosk cannot call. A failed fetch resolves to NO groups, and the
   * page then adds the product plain (base behaviour): a kiosk that
   * cannot reach the modifier data must still sell the base product,
   * never block the customer on a read it cannot prove. The server
   * still enforces the group rules on any line that DOES carry
   * modifiers, so a missed fetch can never post a broken selection.
   */
  const getProductModifiers = async (productId: number): Promise<ModifierGroup[]> => {
    if (!cleanSlug) return [];
    try {
      const res = await storefrontApi.getProductModifiers(cleanSlug, productId);
      return res?.groups || [];
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
    // INV-REST-KIOSK-MENU-SCALE (T10-B): the page the grid renders.
    // catalogData.products holds at most KIOSK_CATALOG_PAGE_SIZE cards;
    // catalogTotalCount is the server's total for the current filter,
    // so the pager (not the rendered list) says how big the menu is.
    catalogPage,
    setCatalogPage,
    catalogTotalCount: Number(catalogData?.totalCount ?? 0),
    catalogHasMore: Boolean(catalogData?.hasMore),
    checkUpsell,
    getProductModifiers,
    createOrder,
    listTerminals,
    initiateTerminalCharge,
  };
}
