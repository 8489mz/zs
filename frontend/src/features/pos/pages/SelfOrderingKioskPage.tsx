import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';
import { DisplayLanguageToggle } from '@/shared/components/DisplayLanguageToggle';
import { useIsolatedDisplayLanguage } from '@/features/pos/hooks/useIsolatedDisplayLanguage';
import { formatCurrency } from '@/lib/format';
import { toast } from '@/shared/components/system-alert';
import {
  UtensilsIcon,
  ShoppingBagIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  PlusCircleIcon,
  CreditCardIcon,
  PrinterIcon,
  XIcon,
  SearchIcon,
  Trash2Icon,
  ReceiptIcon,
  RefreshCwIcon,
  QrCodeIcon,
  AlertCircleIcon,
  AlertTriangleIcon,
  ClockIcon,
} from '@/shared/components/icons/AppIcons';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { PosSmartUpsellModal } from '@/features/pos/components/pos-workspace/PosSmartUpsellModal';
import {
  useSelfOrderingKiosk,
  resolveKioskSlug,
  filterKioskMenuItems,
  kioskMenuTotalPages,
  useKiosk86Items,
  resolveKioskFinalizeOutcome,
  kioskConfirmationCopy,
  newKioskIdempotencyKey,
  isValidKioskCustomerPhone,
  resolveKioskOrderErrorMessage,
  kioskCartLineKey,
  kioskCartTotal,
  addKioskCartLine,
  updateKioskCartLineModifiers,
  type GroupModifierSelection,
  type ModifierGroup,
  type KioskConfirmationItem,
  type KioskPaymentStatus,
} from '@/features/pos/hooks/useSelfOrderingKiosk';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import { KioskModifierPickerModal } from '@/features/pos/components/kiosk/KioskModifierPickerModal';
import { getStoreHostSlug } from '@/lib/store-public-url';
import { HardwareBridgeClient } from '@/features/pos/lib/hardware-bridge-client';

interface KioskCartItem {
  productId: number;
  name: string;
  price: number;
  qty: number;
  notes?: string;
  imageUrl?: string;
  categoryName?: string;
  /* INV-REST-KIOSK-MODIFIER-UI (R7-B2): the line's picked modifiers and
   * its identity (product + sorted option ids). Two lines of the same
   * product with different extras are separate lines. */
  modifiers?: GroupModifierSelection[];
  lineKey: string;
}

/**
 * محرك صور الوجبات الذكي:
 * يربط كل تصنيف ووجبة بصورة فوتوغرافية احترافية عالية الدقة والشهية،
 * بحيث تكون الصورة هي البطل الرئيسي للكارت (تشغل 70% من المساحة).
 */
function getSmartProductImage(product: any): string {
  if (
    product.imageUrl &&
    typeof product.imageUrl === 'string' &&
    (product.imageUrl.startsWith('http://') || product.imageUrl.startsWith('https://') || product.imageUrl.startsWith('/'))
  ) {
    return product.imageUrl;
  }

  const name = String(product.name || '').toLowerCase();
  const cat = String(product.categoryName || '').toLowerCase();

  // مشويات وكفتة
  if (name.includes('كفت') || name.includes('مشو') || cat.includes('فحم') || cat.includes('مشو') || name.includes('كباب')) {
    return 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=500&q=80';
  }
  // حواوشي وفطائر
  if (name.includes('حواوش') || name.includes('فطير')) {
    return 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=500&q=80';
  }
  // شاورما وصواريخ ومارين
  if (name.includes('صاروخ') || name.includes('شاورما') || name.includes('رول') || name.includes('مارين')) {
    return 'https://images.unsplash.com/photo-1561651823-34feb02250e4?w=500&q=80';
  }
  // مكرونات وباستا
  if (name.includes('مكرون') || name.includes('باستا') || cat.includes('مكرون')) {
    return 'https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=500&q=80';
  }
  // شيش ودجاج وبانيه وزنجر واستربس
  if (name.includes('شيش') || name.includes('فراخ') || name.includes('دجاج') || name.includes('بانية') || name.includes('زنجر') || name.includes('استربس')) {
    return 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=500&q=80';
  }
  // فرايز وبطاطس
  if (name.includes('فرايز') || name.includes('بطاطس') || cat.includes('فرايز')) {
    return 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&q=80';
  }
  // برجر
  if (name.includes('برجر') || name.includes('burger')) {
    return 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&q=80';
  }
  // بيتزا
  if (name.includes('بيتزا') || name.includes('pizza')) {
    return 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=500&q=80';
  }
  // مشروبات ومياه
  if (name.includes('بيبسي') || name.includes('كولا') || name.includes('عصير') || name.includes('مشروب') || name.includes('ماء') || cat.includes('مشروب')) {
    return 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500&q=80';
  }
  // حلويات
  if (name.includes('حلو') || name.includes('كيك') || name.includes('شوكولات') || name.includes('ايس كريم') || name.includes('سودا')) {
    return 'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=500&q=80';
  }
  // هواتف وآيفون (لمتجر الأجهزة)
  if (name.includes('آيفون') || name.includes('iphone')) {
    return 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=500&q=80';
  }
  if (name.includes('هاتف') || name.includes('سامسونج') || name.includes('أوبو') || name.includes('انفينيكس') || name.includes('ريلمي') || cat.includes('هواتف')) {
    return 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=500&q=80';
  }
  if (name.includes('شاحن') || name.includes('باور بانك') || name.includes('كابل') || name.includes('سماعة') || cat.includes('إكسسوار')) {
    return 'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=500&q=80';
  }

  // وجبة رئيسية فاخرة افتراضية
  return 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=500&q=80';
}

export function SelfOrderingKioskPage() {
  const { currentLang, toggleLanguage } = useIsolatedDisplayLanguage('kiosk_ui_lang');
  const { t: __t } = useTranslation();
  const { slug: routeSlug } = useParams<{ slug?: string }>();
  const [searchParams] = useSearchParams();
  const querySlug = searchParams.get('store') || searchParams.get('slug');
  const tenant = useAuthStore((s: any) => s.tenant);
  const hostSlug = getStoreHostSlug();
  const localSlug = typeof localStorage !== 'undefined' ? localStorage.getItem('zs_last_company_code') : null;

  // INV-REST-KIOSK-NO-FICTION: the kiosk serves exactly the store its URL,
  // tenant, host or device points at — nothing else. No hardcoded default
  // slug and no mapping of one tenant onto another tenant's menu: an
  // unknown/missing slug resolves to null and the kiosk fails closed.
  const initialSlug = resolveKioskSlug([routeSlug, querySlug, tenant?.slug, hostSlug, localSlug]);
  const [currentSlug, setCurrentSlug] = useState<string | null>(initialSlug);

  // The brand is the tenant's own business name; never a hardcoded
  // restaurant name for a store this kiosk may not be.
  const storeDisplayName = tenant?.businessName || 'المتجر الذكي';

  const [diningMode, setDiningMode] = useState<'dine_in' | 'takeaway' | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<KioskCartItem[]>([]);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [tableNumber, setTableNumber] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestNotes, setGuestNotes] = useState('');
  const [paymentChoice, setPaymentChoice] = useState<'card_terminal' | 'qr_mobile' | 'cash_counter'>('card_terminal');
  const [currentTime, setCurrentTime] = useState<string>('');
  const [orderConfirmedData, setOrderConfirmedData] = useState<{
    orderNumber: string;
    total: number;
    diningMode: string;
    tableNumber?: string;
    /* The confirmation receipt holds the hook's confirmation items
     * (name/qty/price/modifiers) — not cart lines: lineKey is cart
     * identity and means nothing once the order is placed. */
    items?: KioskConfirmationItem[];
    placedAt?: string;
    paymentStatus: KioskPaymentStatus;
    paymentMethodLabel: string;
    authCode?: string;
    rrn?: string;
  } | null>(null);
  const [resetCountdown, setResetCountdown] = useState<number>(15);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // INV-REST-KIOSK-NO-FICTION: a failed finalize keeps a visible error and
  // the last attempt, so the customer can retry instead of receiving an
  // invented confirmation.
  const [orderError, setOrderError] = useState<string | null>(null);
  const [lastFinalizeOpts, setLastFinalizeOpts] = useState<{
    paymentMethod: 'card' | 'qr_mobile' | 'cash';
    paymentStatus: KioskPaymentStatus;
    paymentLabel: string;
    authCode?: string;
    rrn?: string;
  } | null>(null);

  // INV-REST-KIOSK-ORDER-TRUTH: one idempotency key per finalize attempt.
  // The first finalize of an attempt generates it; every retry of THAT
  // attempt reuses it, so the server replays the same order instead of
  // creating a second one. A ref (not state) holds it so two rapid
  // finalizes cannot generate two different keys. It is cleared on
  // success, on full reset, and whenever the order itself changes (cart,
  // mode, table, phone, notes) — a changed order is a new attempt and
  // must never replay the old one.
  const attemptIdempotencyKeyRef = useRef<string | null>(null);
  useEffect(() => {
    attemptIdempotencyKeyRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, diningMode, tableNumber, guestPhone, guestNotes]);

  // حالة ماكينة الدفع بالكشك (Terminal State)
  const [isTerminalModalOpen, setIsTerminalModalOpen] = useState(false);
  const [terminalStep, setTerminalStep] = useState<'connecting' | 'waiting_card' | 'approved' | 'declined' | 'offline_error'>('connecting');
  const [terminalMessage, setTerminalMessage] = useState('');
  const [terminalCountdown, setTerminalCountdown] = useState(60);
  const [activeTransactionId, setActiveTransactionId] = useState('');

  // حالة الدفع برمز QR بالهاتف (Dynamic QR State)
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrCountdown, setQrCountdown] = useState(120);
  const [qrRef, setQrRef] = useState('');

  // Smart Upsell state
  const [upsellModalOpen, setUpsellModalOpen] = useState(false);
  const [upsellTriggerItem, setUpsellTriggerItem] = useState<{ id: number; name: string } | null>(null);
  const [upsellRules, setUpsellRules] = useState<any[]>([]);

  // INV-REST-KIOSK-MODIFIER-UI (R7-B2): the modifier picker state. When a
  // product has linked groups, tapping it opens the picker instead of
  // adding the base product straight away; `editingLineKey` marks an
  // edit of an existing cart line (tray / review), otherwise the save
  // adds a NEW line. Fetched groups are cached per product for the
  // session so every tap does not re-hit the public endpoint.
  const [modifierPicker, setModifierPicker] = useState<{
    product: any;
    groups: ModifierGroup[];
    initialModifiers?: GroupModifierSelection[];
    editingLineKey?: string;
    skipUpsell?: boolean;
  } | null>(null);
  const modifierGroupsCacheRef = useRef(new Map<number, ModifierGroup[]>());

  // عداد مهلة ماكينة الدفع
  useEffect(() => {
    let timer: any = null;
    if (isTerminalModalOpen && terminalStep === 'waiting_card' && terminalCountdown > 0) {
      timer = setInterval(() => setTerminalCountdown((c) => c - 1), 1000);
    } else if (isTerminalModalOpen && terminalStep === 'waiting_card' && terminalCountdown <= 0) {
      setTerminalStep('declined');
      setTerminalMessage('انتهت مهلة إدخال أو تمرير البطاقة في الجهاز');
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isTerminalModalOpen, terminalStep, terminalCountdown]);

  // عداد مهلة رمز QR للدفع
  useEffect(() => {
    let timer: any = null;
    if (isQrModalOpen && qrCountdown > 0) {
      timer = setInterval(() => setQrCountdown((c) => c - 1), 1000);
    } else if (isQrModalOpen && qrCountdown <= 0) {
      setIsQrModalOpen(false);
      toast.warning('انتهت مهلة سداد رمز QR، يرجى المحاولة مرة أخرى أو اختيار الدفع عند الكاونتر');
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isQrModalOpen, qrCountdown]);

  // الساعة الحية للكشك
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  // Auto-reset timer when order is confirmed
  useEffect(() => {
    let timer: any = null;
    if (orderConfirmedData && resetCountdown > 0) {
      timer = setInterval(() => {
        setResetCountdown((c) => c - 1);
      }, 1000);
    } else if (orderConfirmedData && resetCountdown <= 0) {
      handleFullReset();
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [orderConfirmedData, resetCountdown]);

  // Load catalog & actions via feature hook
  // INV-REST-KIOSK-MENU-SCALE (T10-B): the menu is ONE server page at
  // a time (50 cards max). Category and search travel to the server as
  // categoryId/q — the browser never holds the whole catalog — and the
  // page renders only the current page, with a pager below the grid.
  const {
    catalogData,
    isCatalogLoading,
    catalogPage,
    setCatalogPage,
    catalogTotalCount,
    catalogHasMore,
    checkUpsell,
    getProductModifiers,
    createOrder,
    listTerminals,
    initiateTerminalCharge,
  } = useSelfOrderingKiosk(currentSlug, { categoryId: selectedCategory, search: searchQuery });

  const eightySixedIds = useKiosk86Items(currentSlug);

  const products = useMemo(
    () => filterKioskMenuItems(catalogData?.products || [], eightySixedIds),
    [catalogData, eightySixedIds],
  );
  const categories = useMemo(() => catalogData?.categories || [], [catalogData]);

  // The grid renders this page only: at most KIOSK_CATALOG_PAGE_SIZE
  // cards (the hook already caps the page). The server total — not the
  // rendered list — says how big the menu is.
  const filteredProducts = products;
  const totalPages = kioskMenuTotalPages(catalogTotalCount);

  const checkUpsellForProduct = async (product: any) => {
    try {
      const rules = await checkUpsell(product.id);
      if (rules && rules.length > 0) {
        setUpsellTriggerItem({ id: product.id, name: product.name });
        setUpsellRules(rules);
        setUpsellModalOpen(true);
      }
    } catch {
      // non-blocking
    }
  };

  // INV-REST-KIOSK-MODIFIER-UI (R7-B2): adding a product first asks the
  // public endpoint whether it has modifier groups. With groups, the
  // customer picks in the picker (a mandatory group blocks the add until
  // chosen — the picker enforces it); without groups, the base product
  // joins the cart exactly as before. A failed groups fetch also adds
  // the base product: a kiosk that cannot reach the modifier data must
  // still sell, never block the customer on a read it cannot prove.
  const handleAddToCart = (product: any, skipUpsell = false) => {
    void (async () => {
      const productId = Number(product.id);
      let groups = modifierGroupsCacheRef.current.get(productId);
      if (!groups) {
        groups = await getProductModifiers(productId);
        modifierGroupsCacheRef.current.set(productId, groups);
      }
      if (groups.length > 0) {
        setModifierPicker({ product, groups, skipUpsell });
        return;
      }
      addPlainCartLine(product);
      if (!skipUpsell) {
        void checkUpsellForProduct(product);
      }
    })();
  };

  const addPlainCartLine = (product: any) => {
    const smartImg = getSmartProductImage(product);
    setCart((prev) =>
      addKioskCartLine(prev, {
        productId: product.id,
        name: product.name,
        price: Number(product.price || 0),
        qty: 1,
        imageUrl: smartImg,
        categoryName: product.categoryName,
        lineKey: kioskCartLineKey(product.id, undefined),
      }),
    );
  };

  // INV-REST-KIOSK-MODIFIER-UI (R7-B2): the picker save. A new pick adds
  // a line (merging only with a line of the SAME product + SAME options);
  // an edit rewrites that line's modifiers (merging into a twin line
  // when the new pick collides with one). The upsell check runs after
  // the add, exactly as the plain path does.
  const handleModifierPickerSave = (modifiers: GroupModifierSelection[]) => {
    const picker = modifierPicker;
    if (!picker) return;
    const product = picker.product;
    const smartImg = getSmartProductImage(product);
    if (picker.editingLineKey) {
      setCart((prev) => updateKioskCartLineModifiers(prev, picker.editingLineKey as string, modifiers));
    } else {
      setCart((prev) =>
        addKioskCartLine(prev, {
          productId: product.id,
          name: product.name,
          price: Number(product.price || 0),
          qty: 1,
          imageUrl: smartImg,
          categoryName: product.categoryName,
          modifiers,
          lineKey: kioskCartLineKey(product.id, modifiers),
        }),
      );
    }
    setModifierPicker(null);
    if (!picker.skipUpsell) {
      void checkUpsellForProduct(product);
    }
  };

  // INV-REST-KIOSK-MODIFIER-UI (R7-B2): re-open the picker for one cart
  // line (tray / review "تعديل الإضافات"). The groups come from the
  // session cache when the line was first added, otherwise from the
  // public endpoint; a line whose product has no groups anymore simply
  // keeps its picks (nothing to edit).
  const handleEditCartLineModifiers = (item: KioskCartItem) => {
    void (async () => {
      const productId = Number(item.productId);
      let groups = modifierGroupsCacheRef.current.get(productId);
      if (!groups) {
        groups = await getProductModifiers(productId);
        modifierGroupsCacheRef.current.set(productId, groups);
      }
      if (groups.length === 0) return;
      setModifierPicker({
        product: { id: item.productId, name: item.name, price: item.price },
        groups,
        initialModifiers: item.modifiers ? [...item.modifiers] : [],
        editingLineKey: item.lineKey,
      });
    })();
  };

  // INV-REST-KIOSK-MODIFIER-UI (R7-B2): qty / remove are keyed by the
  // LINE identity (product + options), never by productId alone — two
  // lines of one product with different extras are adjusted separately.
  const handleUpdateQty = (lineKey: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.lineKey === lineKey) {
            const nextQty = item.qty + delta;
            return nextQty > 0 ? { ...item, qty: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean) as KioskCartItem[];
    });
  };

  const handleRemoveFromCart = (lineKey: string) => {
    setCart((prev) => prev.filter((i) => i.lineKey !== lineKey));
  };

  const totalItemsCount = cart.reduce((sum, item) => sum + item.qty, 0);
  // INV-REST-KIOSK-MODIFIER-UI (R7-B2): the shown total includes the
  // picked modifiers (base + extras per line), so the customer confirms
  // against the number they will actually pay — the old base-only sum
  // hid their paid extras until the server total arrived.
  const totalCartAmount = kioskCartTotal(cart);

  // INV-REST-KIOSK-ORDER-TRUTH: the confirm button stays disabled until
  // the required order info is present (table for dine-in, real phone
  // for takeaway) — same pattern as the table guard.
  const isTableMissing = diningMode === 'dine_in' && !tableNumber.trim();
  const isTakeawayPhoneMissing = diningMode === 'takeaway' && !isValidKioskCustomerPhone(guestPhone);

  const handleFullReset = () => {
    setDiningMode(null);
    setCart([]);
    setModifierPicker(null);
    setIsReviewOpen(false);
    setIsTerminalModalOpen(false);
    setIsQrModalOpen(false);
    setTableNumber('');
    setGuestPhone('');
    setGuestNotes('');
    setOrderConfirmedData(null);
    setResetCountdown(15);
    setOrderError(null);
    setLastFinalizeOpts(null);
    attemptIdempotencyKeyRef.current = null;
    setSearchQuery('');
    setSelectedCategory('all');
    setPaymentChoice('card_terminal');
  };

  const handleFinalizeOrder = async (opts: {
    paymentMethod: 'card' | 'qr_mobile' | 'cash';
    paymentStatus: KioskPaymentStatus;
    paymentLabel: string;
    authCode?: string;
    rrn?: string;
  }) => {
    setIsSubmitting(true);
    setOrderError(null);
    setLastFinalizeOpts(opts);
    // INV-REST-KIOSK-ORDER-TRUTH: the attempt's key is generated once and
    // reused by every retry of this attempt, so the server replays the
    // same order instead of creating a second one.
    if (!attemptIdempotencyKeyRef.current) {
      attemptIdempotencyKeyRef.current = newKioskIdempotencyKey();
    }
    const idempotencyKey = attemptIdempotencyKeyRef.current;
    try {
      const orderPayload = {
        orderType: diningMode || 'dine_in',
        tableNumber: diningMode === 'dine_in' ? tableNumber.trim() : undefined,
        customerPhone: guestPhone.trim() || undefined,
        notes: guestNotes.trim() || undefined,
        idempotencyKey,
        items: cart.map((i) => ({
          productId: i.productId,
          qty: i.qty,
          unitPrice: i.price,
          modifiers: i.modifiers,
        })),
        paymentMethod: opts.paymentMethod,
        paymentStatus: opts.paymentStatus,
        authCode: opts.authCode,
        rrn: opts.rrn,
      };

      const res = await createOrder(orderPayload as any);
      const outcome = resolveKioskFinalizeOutcome({
        failed: false,
        serverOrderNumber: (res as any)?.orderNumber,
        // INV-REST-KIOSK-ORDER-TRUTH: the confirmation shows the server's
        // recorded total (totalAmount), never the kiosk's raw sum.
        serverTotal: Number((res as any)?.totalAmount),
        diningModeLabel: diningMode === 'dine_in' ? 'تناول بالصالة' : 'استلام سفري',
        tableNumber: tableNumber.trim() || undefined,
        items: [...cart],
        placedAt: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
        paymentStatus: opts.paymentStatus,
        paymentMethodLabel: opts.paymentLabel,
        authCode: opts.authCode,
        rrn: opts.rrn,
      });
      if (outcome.status === 'failed') {
        // The server answered without a real order number or without a
        // real total: treat it exactly like a failed submit — no
        // confirmation, no ticket, retry allowed.
        setOrderError('تعذّر تأكيد الطلب من النظام (لم يصل رقم طلب حقيقي). حاول مرة أخرى.');
        toast.error('تعذّر تأكيد الطلب من النظام. حاول مرة أخرى.');
        return;
      }

      setOrderConfirmedData(outcome.confirmation);
      attemptIdempotencyKeyRef.current = null;

      setIsReviewOpen(false);
      setIsTerminalModalOpen(false);
      setIsQrModalOpen(false);
      setResetCountdown(opts.paymentStatus === 'paid' ? 15 : 25);
    } catch (err) {
      // INV-REST-KIOSK-ERROR-TRUTH (T1): a failed createOrder shows a
      // visible error and keeps the cart and the open modal, so the
      // customer can retry with the SAME idempotency key. It never
      // invents a ticket and never carries a 'paid' the server never saw.
      // A server business refusal (400/422) is shown verbatim; only a
      // genuine network/timeout/unknown failure keeps the generic error.
      const message = resolveKioskOrderErrorMessage(err);
      setOrderError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckoutSubmit = async () => {
    if (cart.length === 0) {
      toast.warning('السلة فارغة، يرجى اختيار وجباتك أولاً');
      return;
    }

    if (diningMode === 'dine_in' && !tableNumber.trim()) {
      toast.warning('يرجى تحديد رقم الطاولة للمتابعة');
      return;
    }

    // INV-REST-KIOSK-ORDER-TRUTH: takeaway needs a real phone — the
    // kitchen calls it when the order is ready, and the server rejects a
    // takeaway order without one. Dine-in stays optional (the ticket has
    // the table number).
    if (diningMode === 'takeaway' && !isValidKioskCustomerPhone(guestPhone)) {
      toast.warning('يرجى إدخال رقم هاتف صحيح لاستلام طلبك');
      return;
    }

    if (paymentChoice === 'cash_counter') {
      // 1. الدفع عند الكاونتر (كاش أو كارت): إصدار إيصال تذكرة غير مدفوعة فوراً
      await handleFinalizeOrder({
        paymentMethod: 'cash',
        paymentStatus: 'unpaid',
        paymentLabel: 'غير مدفوع - سداد عند الكاونتر',
      });
      return;
    }

    if (paymentChoice === 'qr_mobile') {
      // 2. الدفع بمسح رمز QR بالهاتف: فتح نافذة الرمز والمؤقت
      const ref = `QR-${Date.now().toString().slice(-6)}`;
      setQrRef(ref);
      setQrCountdown(120);
      setIsReviewOpen(false);
      setIsQrModalOpen(true);
      return;
    }

    if (paymentChoice === 'card_terminal') {
      // 3. الدفع بماكينة الدفع بالكشك (ECR Terminal)
      setIsReviewOpen(false);
      setIsTerminalModalOpen(true);
      setTerminalStep('connecting');
      setTerminalMessage('جاري فحص الاتصال بجهاز الدفع بالبطاقات...');
      setTerminalCountdown(60);

      const refId = `ECR-${Date.now().toString().slice(-6)}`;
      setActiveTransactionId(refId);

      try {
        const isBridge = await HardwareBridgeClient.isAvailable().catch(() => false);
        let terminalsList: any[] = [];
        try {
          const tRes: any = await listTerminals();
          terminalsList = Array.isArray(tRes) ? tRes : tRes?.data || [];
        } catch {
          // ignore
        }

        const activeTerminal = terminalsList.find((t: any) => t.status === 'online') || terminalsList[0];

        if (!isBridge && !activeTerminal?.ipAddress) {
          // لا توجد ماكينة دفع متصلة حقيقية
          setTerminalStep('offline_error');
          setTerminalMessage('جهاز الدفع بالبطاقات (PIN Pad) غير متصل حالياً بهذا الكشك، أو لم يتم إعداد عنوان الماكينة في النظام.');
          return;
        }

        setTerminalStep('waiting_card');
        setTerminalMessage('يرجى تمرير أو إدخال البطاقة البنكية في جهاز الدفع بالأسفل...');

        if (isBridge) {
          const bridgeRes = await HardwareBridgeClient.chargeTerminal({
            ip: activeTerminal?.ipAddress || '127.0.0.1',
            port: activeTerminal?.port || 8080,
            amount: totalCartAmount,
            referenceId: refId,
          });

          if (bridgeRes.status === 'approved') {
            setTerminalStep('approved');
            setTerminalMessage(`تمت الموافقة بنجاح - تفويض: ${bridgeRes.authCode || '00'}`);
            setTimeout(() => {
              void handleFinalizeOrder({
                paymentMethod: 'card',
                paymentStatus: 'paid',
                paymentLabel: 'مدفوع بالبطاقة (ماكينة الكشك)',
                authCode: bridgeRes.authCode || 'AUTH-OK',
                rrn: bridgeRes.rrn || refId,
              });
            }, 1200);
            return;
          } else {
            setTerminalStep('declined');
            setTerminalMessage(bridgeRes.message || 'تم رفض العملية من البنك');
            return;
          }
        } else if (activeTerminal?.id) {
          const chargeRes: any = await initiateTerminalCharge({
            terminalId: activeTerminal.id,
            amount: totalCartAmount,
            invoiceReference: refId,
          });
          if (chargeRes?.data?.status === 'approved' || chargeRes?.status === 'approved') {
            const auth = chargeRes?.data?.authCode || chargeRes?.authCode || 'AUTH-OK';
            const rrnVal = chargeRes?.data?.rrn || chargeRes?.rrn || refId;
            setTerminalStep('approved');
            setTerminalMessage(`تمت الموافقة بنجاح - تفويض: ${auth}`);
            setTimeout(() => {
              void handleFinalizeOrder({
                paymentMethod: 'card',
                paymentStatus: 'paid',
                paymentLabel: 'مدفوع بالبطاقة (ماكينة الكشك)',
                authCode: auth,
                rrn: rrnVal,
              });
            }, 1200);
            return;
          } else {
            setTerminalStep('declined');
            setTerminalMessage(chargeRes?.data?.message || 'تم رفض العملية من البنك');
            return;
          }
        }
      } catch (err: any) {
        setTerminalStep('offline_error');
        setTerminalMessage(err?.message || 'تعذر إتمام الاتصال بجهاز الدفع بالبطاقات');
      }
    }
  };

  // ==========================================
  // الشاشة 1: الترحيب واختيار نوع الطلب
  // ==========================================
  if (!diningMode) {
    return (
      <div
        dir="rtl"
        style={{
          minHeight: '100vh',
          backgroundColor: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'inherit',
          userSelect: 'none',
        }}
      >
        <div style={{ maxWidth: '680px', width: '100%', textAlign: 'center' }}>
          {/* Logo / Badge */}
          <div
            style={{
              width: '92px',
              height: '92px',
              margin: '0 auto 24px',
              backgroundColor: '#170e5e',
              borderRadius: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 12px 30px rgba(23, 14, 94, 0.25)',
            }}
          >
            <UtensilsIcon size={46} color="#ffffff" />
          </div>

          {/* تبديل الكتالوج التجريبي */}
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: '#e2e8f0',
              borderRadius: '24px',
              padding: '4px',
              marginBottom: '26px',
            }}
          >
            <button
              type="button"
              onClick={() => setCurrentSlug('almhnds')}
              style={{
                border: 'none',
                backgroundColor: currentSlug === 'almhnds' ? '#170e5e' : 'transparent',
                color: currentSlug === 'almhnds' ? '#ffffff' : '#475569',
                padding: '8px 20px',
                borderRadius: '20px',
                fontSize: '12.5px',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {__t('pos.self_ordering_kiosk_page.s0', __t('pos.self_ordering_kiosk_page.s0', "مطعم المشويات والسندوتشات (75 وجبة)"))}
            </button>
            <button
              type="button"
              onClick={() => setCurrentSlug('zs')}
              style={{
                border: 'none',
                backgroundColor: currentSlug === 'zs' ? '#170e5e' : 'transparent',
                color: currentSlug === 'zs' ? '#ffffff' : '#475569',
                padding: '8px 20px',
                borderRadius: '20px',
                fontSize: '12.5px',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {__t('pos.self_ordering_kiosk_page.s1', __t('pos.self_ordering_kiosk_page.s1', "متجر الأجهزة والهواتف"))}
            </button>
          </div>

          <h1 style={{ fontSize: '32px', fontWeight: 900, color: '#0f172a', margin: '0 0 12px' }}>
            {storeDisplayName}
          </h1>
          <p style={{ fontSize: '16px', color: '#64748b', margin: '0 0 42px', lineHeight: 1.6 }}>
            {__t('pos.self_ordering_kiosk_page.s2', __t('pos.self_ordering_kiosk_page.s2', "شاشة الخدمة الذاتية • تفضل باختيار طريقة استلام وجبتك"))}
          </p>

          {/* بطاقتي الاختيار للمس المريح */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <button
              type="button"
              onClick={() => setDiningMode('dine_in')}
              style={{
                backgroundColor: '#ffffff',
                border: '2.5px solid #e2e8f0',
                borderRadius: '24px',
                padding: '42px 24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '18px',
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
                textAlign: 'center',
                transition: 'all 0.2s ease',
              }}
            >
              <div
                style={{
                  width: '78px',
                  height: '78px',
                  borderRadius: '22px',
                  backgroundColor: '#eef2ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <UtensilsIcon size={40} color="#170e5e" />
              </div>
              <div>
                <div style={{ fontSize: '23px', fontWeight: 900, color: '#0f172a' }}>
                  {__t('pos.self_ordering_kiosk_page.s3', __t('pos.self_ordering_kiosk_page.s3', "تناول بالصالة"))}
                </div>
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>
                  {__t('pos.self_ordering_kiosk_page.s4', __t('pos.self_ordering_kiosk_page.s4', "Dine In • استمتع بوجبتك ساخنة على الطاولة"))}
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setDiningMode('takeaway')}
              style={{
                backgroundColor: '#ffffff',
                border: '2.5px solid #e2e8f0',
                borderRadius: '24px',
                padding: '42px 24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '18px',
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
                textAlign: 'center',
                transition: 'all 0.2s ease',
              }}
            >
              <div
                style={{
                  width: '78px',
                  height: '78px',
                  borderRadius: '22px',
                  backgroundColor: '#f0fdf4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ShoppingBagIcon size={40} color="#16a34a" />
              </div>
              <div>
                <div style={{ fontSize: '23px', fontWeight: 900, color: '#0f172a' }}>
                  {__t('pos.self_ordering_kiosk_page.s5', __t('pos.self_ordering_kiosk_page.s5', "استلام سفري"))}
                </div>
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>
                  {__t('pos.self_ordering_kiosk_page.s6', __t('pos.self_ordering_kiosk_page.s6', "Takeaway • استلم وجبتك مغلفة من الكاونتر"))}
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // الشاشة 4: تأكيد الطلب والطباعة الحرارية
  // ==========================================
  if (orderConfirmedData) {
    // INV-REST-KIOSK-NO-FICTION: the ticket's words come from one helper so
    // a 'pending' QR transfer can never render as PAID — or as "pay at the
    // counter" either.
    const confirmationCopy = kioskConfirmationCopy(
      orderConfirmedData.paymentStatus,
      {
        totalText: formatCurrency(orderConfirmedData.total),
        paymentMethodLabel: orderConfirmedData.paymentMethodLabel,
      },
      (key, fallback) => __t(key, __t(key, fallback)),
    );
    return (
      <div
        dir="rtl"
        style={{
          minHeight: '100vh',
          backgroundColor: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            maxWidth: '540px',
            width: '100%',
            backgroundColor: '#ffffff',
            borderRadius: '28px',
            border: '1px solid #e2e8f0',
            padding: '40px 32px',
            textAlign: 'center',
            boxShadow: '0 16px 40px rgba(0,0,0,0.07)',
          }}
        >
          {confirmationCopy.tone !== 'paid' ? (
            <>
              <div
                style={{
                  width: '84px',
                  height: '84px',
                  borderRadius: '50%',
                  backgroundColor: '#fef3c7',
                  margin: '0 auto 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ClockIcon size={46} color="#d97706" />
              </div>

              <h2 style={{ fontSize: '25px', fontWeight: 900, color: '#0f172a', margin: '0 0 8px' }}>
                {confirmationCopy.heroTitle}
              </h2>
              <div
                style={{
                  backgroundColor: '#fffbeb',
                  border: '1.5px solid #fde68a',
                  borderRadius: '14px',
                  padding: '12px 16px',
                  margin: '0 auto 22px',
                  fontSize: '13.5px',
                  fontWeight: 800,
                  color: '#92400e',
                  lineHeight: 1.5,
                }}
              >
                {confirmationCopy.heroNote}
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  width: '84px',
                  height: '84px',
                  borderRadius: '50%',
                  backgroundColor: '#dcfce7',
                  margin: '0 auto 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CheckCircleIcon size={48} color="#16a34a" />
              </div>

              <h2 style={{ fontSize: '26px', fontWeight: 900, color: '#0f172a', margin: '0 0 8px' }}>
                {confirmationCopy.heroTitle}
              </h2>
              <p style={{ fontSize: '14.5px', color: '#64748b', margin: '0 0 24px' }}>
                {confirmationCopy.heroNote}
              </p>
            </>
          )}

          <div
            style={{
              backgroundColor: '#f1f5f9',
              borderRadius: '22px',
              padding: '24px',
              marginBottom: '24px',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#64748b', marginBottom: '6px' }}>
              {__t('pos.self_ordering_kiosk_page.s12', __t('pos.self_ordering_kiosk_page.s12', "رقم تذكرتك في شاشة المناداة:"))}
            </div>
            <div style={{ fontSize: '48px', fontWeight: 900, color: '#170e5e', letterSpacing: '2px' }}>
              #{orderConfirmedData.orderNumber}
            </div>

            <div style={{ marginTop: '8px' }}>
              <span
                style={{
                  display: 'inline-block',
                  backgroundColor:
                    confirmationCopy.tone === 'unpaid'
                      ? '#fee2e2'
                      : confirmationCopy.tone === 'pending'
                        ? '#fef3c7'
                        : '#dcfce7',
                  color:
                    confirmationCopy.tone === 'unpaid'
                      ? '#b91c1c'
                      : confirmationCopy.tone === 'pending'
                        ? '#92400e'
                        : '#15803d',
                  border:
                    confirmationCopy.tone === 'unpaid'
                      ? '1px solid #fecaca'
                      : confirmationCopy.tone === 'pending'
                        ? '1px solid #fde68a'
                        : 'none',
                  borderRadius: '8px',
                  padding: '4px 12px',
                  fontSize: '12.5px',
                  fontWeight: 900,
                }}
              >
                {confirmationCopy.badgeText}
              </span>
            </div>

            {orderConfirmedData.tableNumber && (
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', marginTop: '10px' }}>
                {__t('pos.self_ordering_kiosk_page.s15', __t('pos.self_ordering_kiosk_page.s15', "طاولة رقم:"))} {orderConfirmedData.tableNumber}
              </div>
            )}
            <div style={{ fontSize: '13.5px', color: '#475569', marginTop: '10px' }}>
              {__t('pos.self_ordering_kiosk_page.s16', __t('pos.self_ordering_kiosk_page.s16', "المبلغ الإجمالي:"))} <strong>{formatCurrency(orderConfirmedData.total)}</strong> ({orderConfirmedData.diningMode})
            </div>
          </div>

          <p style={{ fontSize: '12.5px', color: '#94a3b8', marginBottom: '20px' }}>
            {__t('pos.self_ordering_kiosk_page.s17', __t('pos.self_ordering_kiosk_page.s17', "ستعود الشاشة للرئيسية تلقائياً خلال"))} {resetCountdown} {__t('pos.self_ordering_kiosk_page.s18', __t('pos.self_ordering_kiosk_page.s18', "ثانية..."))}
          </p>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.print()}
              style={{
                width: '100%',
                height: '48px',
                fontSize: '14px',
                fontWeight: 800,
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                backgroundColor: '#f8fafc',
                border: '1.5px solid #cbd5e1',
                color: '#0f172a',
                cursor: 'pointer',
              }}
            >
              <PrinterIcon size={20} color="#170e5e" />
              <span>
                {confirmationCopy.printLabel}
              </span>
            </Button>
          </div>

          <Button
            variant="primary"
            onClick={handleFullReset}
            style={{
              width: '100%',
              height: '48px',
              backgroundColor: '#170e5e',
              fontSize: '14.5px',
              fontWeight: 800,
              borderRadius: '14px',
            }}
          >
            {__t('pos.self_ordering_kiosk_page.s21', __t('pos.self_ordering_kiosk_page.s21', "طلب جديد الآن"))}
          </Button>

          {/* Hidden Thermal Printable Receipt */}
          <div className="kiosk-print-receipt" style={{ display: 'none' }}>
            <style>{`
              @media print {
                body * { visibility: hidden !important; }
                .kiosk-print-receipt, .kiosk-print-receipt * { visibility: visible !important; }
                .kiosk-print-receipt {
                  position: absolute !important;
                  left: 0 !important;
                  top: 0 !important;
                  width: 80mm !important;
                  padding: 8px !important;
                  display: block !important;
                  font-family: monospace, sans-serif !important;
                  direction: rtl !important;
                  color: #000 !important;
                }
              }
            `}</style>
            <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '8px', marginBottom: '8px' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 900 }}>{storeDisplayName}</h3>
              <div style={{ fontSize: '12px' }}>{__t('pos.self_ordering_kiosk_page.s22', __t('pos.self_ordering_kiosk_page.s22', "طلب خدمة ذاتية - كشك ذكي"))}</div>
              <div style={{ fontSize: '11px', marginTop: '2px' }}>{orderConfirmedData.placedAt || ''}</div>
            </div>

            <div style={{ textAlign: 'center', margin: '12px 0', borderBottom: '1px dashed #000', paddingBottom: '10px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700 }}>{__t('pos.self_ordering_kiosk_page.s23', __t('pos.self_ordering_kiosk_page.s23', "رقم التذكرة والاستلام:"))}</div>
              <div style={{ fontSize: '38px', fontWeight: 900, margin: '4px 0' }}>#{orderConfirmedData.orderNumber}</div>
              <div style={{ fontSize: '13px', fontWeight: 800 }}>{orderConfirmedData.diningMode}</div>
              {orderConfirmedData.tableNumber && (
                <div style={{ fontSize: '14px', fontWeight: 900, marginTop: '4px' }}>{__t('pos.self_ordering_kiosk_page.s24', __t('pos.self_ordering_kiosk_page.s24', "طاولة:"))} {orderConfirmedData.tableNumber}</div>
              )}

              {/* تحذير صريح على الورقة المطبوعة: غير مدفوع أو بانتظار تأكيد التحويل — لا تظهر أبداً كمدفوع */}
              {confirmationCopy.tone === 'paid' ? (
                <div style={{ fontSize: '12px', fontWeight: 800, marginTop: '6px' }}>
                  {confirmationCopy.receiptTitle}
                  <div>{confirmationCopy.receiptBody}</div>
                  {orderConfirmedData.authCode && <div>{__t('pos.self_ordering_kiosk_page.s30', __t('pos.self_ordering_kiosk_page.s30', "رقم التفويض:"))} {orderConfirmedData.authCode}</div>}
                  {orderConfirmedData.rrn && <div>{__t('pos.self_ordering_kiosk_page.s31', __t('pos.self_ordering_kiosk_page.s31', "رقم المرجع:"))} {orderConfirmedData.rrn}</div>}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: '13.5px',
                    fontWeight: 900,
                    margin: '8px 0 4px',
                    border: '2px solid #000',
                    padding: '6px',
                    lineHeight: 1.4,
                  }}
                >
                  {confirmationCopy.receiptTitle}
                  <br />
                  {confirmationCopy.receiptBody}
                </div>
              )}
            </div>

            {orderConfirmedData.items && orderConfirmedData.items.length > 0 && (
              <div style={{ borderBottom: '1px dashed #000', paddingBottom: '8px', marginBottom: '8px' }}>
                {orderConfirmedData.items.map((item, idx) => (
                  <div key={idx} style={{ margin: '3px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span>{item.qty}x {item.name}</span>
                      <span>{formatCurrency(calcCartLineTotal(item as any))}</span>
                    </div>
                    {/* INV-REST-KIOSK-MODIFIER-UI (R7-B2): the receipt shows
                        the chosen extras under their line, so the ticket
                        the customer prints matches what the kitchen sees. */}
                    {(item.modifiers || []).map((mod, modIdx) => (
                      <div key={modIdx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', paddingRight: '12px', color: '#334155' }}>
                        <span>+ {mod.name}{Number(mod.qty || 1) > 1 ? ` ×${mod.qty}` : ''}</span>
                        <span>{formatCurrency(Number(mod.price || 0) * Number(mod.qty || 1) * item.qty)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 900, marginBottom: '12px' }}>
              <span>{__t('pos.self_ordering_kiosk_page.s32', __t('pos.self_ordering_kiosk_page.s32', "الإجمالي:"))}</span>
              <span>{formatCurrency(orderConfirmedData.total)}</span>
            </div>
            <div style={{ textAlign: 'center', fontSize: '11px' }}>
              {confirmationCopy.receiptFooter}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // INV-REST-KIOSK-NO-FICTION: no known store slug means this kiosk shows
  // no menu at all — never another tenant's menu and never an empty menu
  // that looks like a store with no food. The operator picks a store with
  // the switcher below, or fixes the kiosk link.
  if (!currentSlug) {
    return (
      <div
        dir="rtl"
        style={{
          minHeight: '100vh',
          backgroundColor: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            maxWidth: '460px',
            width: '100%',
            backgroundColor: '#ffffff',
            borderRadius: '22px',
            border: '1px solid #e2e8f0',
            padding: '36px 28px',
            boxShadow: '0 16px 40px rgba(0,0,0,0.07)',
          }}
        >
          <AlertTriangleIcon size={44} color="#d97706" />
          <h2 style={{ fontSize: '20px', fontWeight: 900, color: '#0f172a', margin: '14px 0 8px' }}>
            {__t('pos.self_ordering_kiosk_page.s135', __t('pos.self_ordering_kiosk_page.s135', "الكشك غير مرتبط بمتجر"))}
          </h2>
          <p style={{ fontSize: '13.5px', color: '#64748b', lineHeight: 1.6, margin: '0 0 20px' }}>
            {__t('pos.self_ordering_kiosk_page.s136', __t('pos.self_ordering_kiosk_page.s136', "لا يوجد متجر معروف لهذا الكشك. اطلب من الموظف ضبط رابط المتجر أو اختيار المتجر من الأزرار بالأسفل."))}
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => setCurrentSlug('almhnds')}
              style={{
                border: 'none',
                backgroundColor: '#170e5e',
                color: '#ffffff',
                padding: '10px 18px',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {__t('pos.self_ordering_kiosk_page.s0', __t('pos.self_ordering_kiosk_page.s0', "مطعم المشويات والسندوتشات (75 وجبة)"))}
            </button>
            <button
              type="button"
              onClick={() => setCurrentSlug('zs')}
              style={{
                border: 'none',
                backgroundColor: '#170e5e',
                color: '#ffffff',
                padding: '10px 18px',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {__t('pos.self_ordering_kiosk_page.s1', __t('pos.self_ordering_kiosk_page.s1', "متجر الأجهزة والهواتف"))}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // الشاشة الرئيسية للطلب:
  // معيار 1280px العالمي:
  // اليمين: الأقسام (185px)
  // الوسط: شبكة الوجبات (صورة الوجبة بطلة 70%)
  // اليسار: صينية الطلب المباشرة (325px)
  // ==========================================
  return (
    <div
      dir="rtl"
      style={{
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: '#f1f5f9',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        fontFamily: 'inherit',
      }}
    >
      {/* الحاوية المركزية لمعيار الـ 1280 بكسل */}
      <div
        style={{
          width: 'min(100%, 1280px)',
          maxWidth: '1280px',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#ffffff',
          boxShadow: '0 0 35px rgba(0,0,0,0.06)',
          borderLeft: '1px solid #e2e8f0',
          borderRight: '1px solid #e2e8f0',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* 1. Header: الهيدر المؤسسي المتناسق (66px) */}
        <header
          style={{
            height: '66px',
            minHeight: '66px',
            backgroundColor: '#ffffff',
            borderBottom: '1.5px solid #e2e8f0',
            padding: '0 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxSizing: 'border-box',
            zIndex: 40,
          }}
        >
          {/* بيانات المطعم والوضع */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                backgroundColor: '#170e5e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <UtensilsIcon size={20} color="#ffffff" />
            </div>

            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 900, color: '#0f172a' }}>
                {storeDisplayName}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: diningMode === 'dine_in' ? '#1e40af' : '#15803d',
                  }}
                >
                  {__t('pos.self_ordering_kiosk_page.s35', __t('pos.self_ordering_kiosk_page.s35', "الوضع:"))} {diningMode === 'dine_in' ? __t('pos.self_ordering_kiosk_page.s36', __t('pos.self_ordering_kiosk_page.s36', "تناول بالصالة")) : __t('pos.self_ordering_kiosk_page.s37', __t('pos.self_ordering_kiosk_page.s37', "استلام سفري"))}
                </span>
                <button
                  type="button"
                  onClick={() => setDiningMode(diningMode === 'dine_in' ? 'takeaway' : 'dine_in')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    fontSize: '11px',
                    fontWeight: 700,
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {__t('pos.self_ordering_kiosk_page.s38', __t('pos.self_ordering_kiosk_page.s38', "(تغيير)"))}
                </button>
              </div>
            </div>
          </div>

          {/* خانة البحث السريع باللمس */}
          <div style={{ flex: 1, maxWidth: '340px', margin: '0 16px', position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                right: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <SearchIcon size={16} />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={__t('pos.self_ordering_kiosk_page.s39', __t('pos.self_ordering_kiosk_page.s39', "ابحث عن وجبة أو مشروب..."))}
              style={{
                width: '100%',
                height: '38px',
                borderRadius: '12px',
                border: '1.5px solid #e2e8f0',
                padding: '0 36px 0 32px',
                fontSize: '12.5px',
                fontWeight: 600,
                backgroundColor: '#f8fafc',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <XIcon size={14} />
              </button>
            )}
          </div>

          {/* الساعة وأزرار التبديل والبدء من جديد */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <DisplayLanguageToggle currentLang={currentLang} onToggle={toggleLanguage} style={{ height: '36px', fontSize: '13px' }} />

            {currentTime && (
              <div
                style={{
                  fontSize: '12.5px',
                  fontWeight: 800,
                  color: '#475569',
                  backgroundColor: '#f1f5f9',
                  padding: '6px 10px',
                  borderRadius: '10px',
                }}
              >
                {currentTime}
              </div>
            )}

            <div
              style={{
                display: 'inline-flex',
                backgroundColor: '#f1f5f9',
                borderRadius: '10px',
                padding: '2px',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setCurrentSlug('almhnds');
                  setSelectedCategory('all');
                }}
                style={{
                  border: 'none',
                  backgroundColor: currentSlug === 'almhnds' ? '#170e5e' : 'transparent',
                  color: currentSlug === 'almhnds' ? '#ffffff' : '#64748b',
                  padding: '5px 12px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {__t('pos.self_ordering_kiosk_page.s40', __t('pos.self_ordering_kiosk_page.s40', "المطعم"))}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCurrentSlug('zs');
                  setSelectedCategory('all');
                }}
                style={{
                  border: 'none',
                  backgroundColor: currentSlug === 'zs' ? '#170e5e' : 'transparent',
                  color: currentSlug === 'zs' ? '#ffffff' : '#64748b',
                  padding: '5px 12px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {__t('pos.self_ordering_kiosk_page.s41', __t('pos.self_ordering_kiosk_page.s41', "الأجهزة"))}
              </button>
            </div>

            <button
              type="button"
              onClick={handleFullReset}
              style={{
                backgroundColor: '#f1f5f9',
                border: 'none',
                borderRadius: '10px',
                padding: '7px 12px',
                fontSize: '12px',
                fontWeight: 800,
                color: '#475569',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <ArrowRightIcon size={14} />
              <span>{__t('pos.self_ordering_kiosk_page.s42', __t('pos.self_ordering_kiosk_page.s42', "البدء من جديد"))}</span>
            </button>
          </div>
        </header>

        {/* 2. Middle Body: التوزيع الثلاثي المتناسق */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            overflow: 'hidden',
            width: '100%',
          }}
        >
          {/* ========================================================= */}
          {/* 1. اليمين: شريط الأقسام الرأسي (185px)                     */}
          {/* ========================================================= */}
          <aside
            style={{
              width: '185px',
              minWidth: '185px',
              backgroundColor: '#ffffff',
              borderLeft: '1.5px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              padding: '14px 8px',
              gap: '6px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8', padding: '0 8px 4px' }}>
              {__t('pos.self_ordering_kiosk_page.s43', __t('pos.self_ordering_kiosk_page.s43', "أقسام القائمة"))}
            </div>

            {/* كافة الأصناف */}
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              style={{
                padding: '11px 12px',
                borderRadius: '12px',
                border: selectedCategory === 'all' ? '2px solid #170e5e' : '1px solid #e2e8f0',
                backgroundColor: selectedCategory === 'all' ? '#170e5e' : '#f8fafc',
                color: selectedCategory === 'all' ? '#ffffff' : '#1e293b',
                fontSize: '12.5px',
                fontWeight: 800,
                cursor: 'pointer',
                textAlign: 'right',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                transition: 'all 0.15s ease',
              }}
            >
              <span>{__t('pos.self_ordering_kiosk_page.s44', __t('pos.self_ordering_kiosk_page.s44', "كافة الأصناف"))}</span>
              <span
                style={{
                  fontSize: '10.5px',
                  color: selectedCategory === 'all' ? '#cbd5e1' : '#64748b',
                  fontWeight: 600,
                }}
              >
                {catalogTotalCount} {__t('pos.self_ordering_kiosk_page.s45', __t('pos.self_ordering_kiosk_page.s45', "وجبة"))}
              </span>
            </button>

            {/* قائمة الأقسام */}
            {categories.map((c: any) => {
              const isCatActive = selectedCategory !== 'all' && Number(selectedCategory) === Number(c.id);

              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCategory(Number(c.id))}
                  style={{
                    padding: '11px 12px',
                    borderRadius: '12px',
                    border: isCatActive ? '2px solid #170e5e' : '1px solid #e2e8f0',
                    backgroundColor: isCatActive ? '#170e5e' : '#f8fafc',
                    color: isCatActive ? '#ffffff' : '#1e293b',
                    fontSize: '12.5px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    textAlign: 'right',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </span>
                </button>
              );
            })}
          </aside>

          {/* ========================================================= */}
          {/* 2. الوسط: شبكة الوجبات (صورة الوجبة بطلة تأخذ 70% من الكارت) */}
          {/* ========================================================= */}
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              boxSizing: 'border-box',
            }}
          >
            {isCatalogLoading ? (
              <div style={{ textAlign: 'center', padding: '80px 20px', color: '#64748b' }}>
                <div style={{ display: 'inline-block', marginBottom: '12px' }}>
                  <RefreshCwIcon size={28} color="#170e5e" />
                </div>
                <div style={{ fontSize: '15px', fontWeight: 800 }}>{__t('pos.self_ordering_kiosk_page.s47', __t('pos.self_ordering_kiosk_page.s47', "جارٍ تحميل قائمة الوجبات..."))}</div>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '60px 20px',
                  backgroundColor: '#f8fafc',
                  borderRadius: '18px',
                  border: '1px solid #e2e8f0',
                  maxWidth: '400px',
                  margin: '40px auto',
                }}
              >
                <UtensilsIcon size={36} color="#cbd5e1" />
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', marginTop: '10px' }}>
                  {__t('pos.self_ordering_kiosk_page.s48', __t('pos.self_ordering_kiosk_page.s48', "لا توجد وجبات في هذا القسم"))}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                  {__t('pos.self_ordering_kiosk_page.s49', __t('pos.self_ordering_kiosk_page.s49', "جرب اختيار قسم آخر أو إلغاء كلمة البحث"))}
                </div>
              </div>
            ) : (
              <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: '14px',
                  paddingBottom: '20px',
                }}
              >
                {filteredProducts.map((p: any) => {
                  // INV-REST-KIOSK-MODIFIER-UI (R7-B2): the badge counts
                  // EVERY line of this product (a product with different
                  // extras has several lines). The inline stepper only
                  // appears for a single PLAIN line — with modifier lines
                  // the tap target stays "إضافة", which opens the picker
                  // for a new choice instead of guessing which line a
                  // +/- belongs to.
                  const productLines = cart.filter((i) => i.productId === p.id);
                  const inCartQty = productLines.reduce((sum, i) => sum + i.qty, 0);
                  const singlePlainLine =
                    productLines.length === 1 && !(productLines[0].modifiers?.length)
                      ? productLines[0]
                      : null;
                  const smartImg = getSmartProductImage(p);

                  return (
                    <div
                      key={p.id}
                      style={{
                        backgroundColor: '#ffffff',
                        borderRadius: '16px',
                        border: inCartQty > 0 ? '2px solid #170e5e' : '1.5px solid #e2e8f0',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: inCartQty > 0 ? '0 6px 18px rgba(23, 14, 94, 0.08)' : '0 2px 6px rgba(0,0,0,0.03)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {/* صورة الوجبة البطلة: تشغل النسبة الأكبر (حوالي 70% من الكارت) */}
                      <div
                        style={{
                          height: '165px',
                          position: 'relative',
                          overflow: 'hidden',
                          backgroundColor: '#f1f5f9',
                        }}
                      >
                        <img
                          src={smartImg}
                          alt={p.name}
                          loading="lazy"
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block',
                          }}
                        />
                        {inCartQty > 0 && (
                          <span
                            style={{
                              position: 'absolute',
                              top: '8px',
                              right: '8px',
                              backgroundColor: '#170e5e',
                              color: '#ffffff',
                              borderRadius: '8px',
                              padding: '2px 8px',
                              fontSize: '11px',
                              fontWeight: 900,
                              boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                            }}
                          >
                            {inCartQty} {__t('pos.self_ordering_kiosk_page.s50', __t('pos.self_ordering_kiosk_page.s50', "بالسلة"))}
                          </span>
                        )}
                      </div>

                      {/* الجزء السفلي المدمج: اسم الوجبة والسعر وزر الإضافة */}
                      <div
                        style={{
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '8px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '14.5px',
                            fontWeight: 800,
                            color: '#0f172a',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {p.name}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ fontSize: '16.5px', fontWeight: 900, color: '#170e5e' }}>
                            {formatCurrency(p.price)}
                          </div>

                          {singlePlainLine ? (
                            /* عداد تفاعلي مباشر داخل الكارت: [+] (الكمية) [-] — خط عادي واحد فقط */
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                backgroundColor: '#f8fafc',
                                border: '1.5px solid #170e5e',
                                borderRadius: '8px',
                                overflow: 'hidden',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => handleUpdateQty(singlePlainLine.lineKey, 1)}
                                style={{
                                  width: '30px',
                                  height: '30px',
                                  border: 'none',
                                  backgroundColor: '#170e5e',
                                  color: '#ffffff',
                                  fontSize: '14px',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                }}
                              >
                                +
                              </button>
                              <span
                                style={{
                                  minWidth: '26px',
                                  textAlign: 'center',
                                  fontWeight: 900,
                                  fontSize: '12.5px',
                                  color: '#0f172a',
                                }}
                              >
                                {inCartQty}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleUpdateQty(singlePlainLine.lineKey, -1)}
                                style={{
                                  width: '30px',
                                  height: '30px',
                                  border: 'none',
                                  backgroundColor: '#e2e8f0',
                                  color: '#0f172a',
                                  fontSize: '14px',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                }}
                              >
                                -
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleAddToCart(p)}
                              style={{
                                height: '34px',
                                padding: '0 14px',
                                borderRadius: '10px',
                                fontSize: '12px',
                                fontWeight: 800,
                                backgroundColor: '#170e5e',
                                color: '#ffffff',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                cursor: 'pointer',
                              }}
                            >
                              <PlusCircleIcon size={14} />
                              <span>{__t('pos.self_ordering_kiosk_page.s51', __t('pos.self_ordering_kiosk_page.s51', "إضافة"))}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* INV-REST-KIOSK-MENU-SCALE (T10-B): the pager — the grid
              above renders one server page only, so the customer pages
              through the menu instead of the tab rendering all of it.
              Hidden when the whole menu fits on one page. */}
              {totalPages > 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px',
                    padding: '12px 0 20px',
                  }}
                >
                  <button
                    type="button"
                    disabled={catalogPage <= 1}
                    onClick={() => setCatalogPage(Math.max(1, catalogPage - 1))}
                    style={{
                      padding: '9px 18px',
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                      backgroundColor: catalogPage <= 1 ? '#f1f5f9' : '#ffffff',
                      color: catalogPage <= 1 ? '#94a3b8' : '#0f172a',
                      fontSize: '13px',
                      fontWeight: 800,
                      cursor: catalogPage <= 1 ? 'default' : 'pointer',
                    }}
                  >
                    {__t('pos.self_ordering_kiosk_page.s142', 'السابق')}
                  </button>
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#475569' }}>
                    {__t('pos.self_ordering_kiosk_page.s143', 'صفحة')} {catalogPage} {__t('pos.self_ordering_kiosk_page.s144', 'من')} {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={!catalogHasMore && catalogPage >= totalPages}
                    onClick={() => setCatalogPage(Math.min(totalPages, catalogPage + 1))}
                    style={{
                      padding: '9px 18px',
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                      backgroundColor: !catalogHasMore && catalogPage >= totalPages ? '#f1f5f9' : '#170e5e',
                      color: !catalogHasMore && catalogPage >= totalPages ? '#94a3b8' : '#ffffff',
                      fontSize: '13px',
                      fontWeight: 800,
                      cursor: !catalogHasMore && catalogPage >= totalPages ? 'default' : 'pointer',
                    }}
                  >
                    {__t('pos.self_ordering_kiosk_page.s145', 'التالي')}
                  </button>
                </div>
              )}
              </>
            )}
          </main>

          {/* ========================================================= */}
          {/* 3. اليسار: صينية الطلب المباشرة (Live Order Tray - 330px) */}
          {/* ========================================================= */}
          <aside
            style={{
              width: '330px',
              minWidth: '330px',
              backgroundColor: '#ffffff',
              borderRight: '1.5px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
            }}
          >
            {/* هيدر الصينية */}
            <div
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '15.5px', fontWeight: 900, color: '#0f172a' }}>
                  {__t('pos.self_ordering_kiosk_page.s52', __t('pos.self_ordering_kiosk_page.s52', "صينية طلبك"))}
                </h3>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                  {diningMode === 'dine_in' ? __t('pos.self_ordering_kiosk_page.s53', __t('pos.self_ordering_kiosk_page.s53', "تناول بالصالة")) : __t('pos.self_ordering_kiosk_page.s54', __t('pos.self_ordering_kiosk_page.s54', "استلام سفري"))} • {totalItemsCount} {__t('pos.self_ordering_kiosk_page.s55', __t('pos.self_ordering_kiosk_page.s55', "وجبة"))}
                </div>
              </div>

              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#dc2626',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {__t('pos.self_ordering_kiosk_page.s56', __t('pos.self_ordering_kiosk_page.s56', "إفراغ الصينية"))}
                </button>
              )}
            </div>

            {/* قائمة الوجبات في الصينية */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {cart.length === 0 ? (
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#94a3b8',
                    textAlign: 'center',
                    padding: '30px 10px',
                  }}
                >
                  <div
                    style={{
                      width: '56px',
                      height: '56px',
                      borderRadius: '16px',
                      backgroundColor: '#f1f5f9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '10px',
                    }}
                  >
                    <ShoppingBagIcon size={26} color="#94a3b8" />
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: '#475569' }}>
                    {__t('pos.self_ordering_kiosk_page.s57', __t('pos.self_ordering_kiosk_page.s57', "صينيتك فارغة حالياً"))}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    {__t('pos.self_ordering_kiosk_page.s58', __t('pos.self_ordering_kiosk_page.s58', "اختر وجباتك المفضلة من القائمة لتظهر هنا فوراً"))}
                  </div>
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.lineKey}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      borderRadius: '12px',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '8px',
                            objectFit: 'cover',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: 800,
                            color: '#0f172a',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item.name}
                        </div>
                        {/* INV-REST-KIOSK-MODIFIER-UI (R7-B2): the chosen
                            extras render under their line, and the line
                            price already includes them. */}
                        {(item.modifiers || []).map((mod, modIdx) => (
                          <div key={modIdx} style={{ fontSize: '10.5px', color: '#475569', marginTop: '1px' }}>
                            + {mod.name}{Number(mod.qty || 1) > 1 ? ` ×${mod.qty}` : ''} ({formatCurrency(Number(mod.price || 0) * Number(mod.qty || 1))})
                          </div>
                        ))}
                        <div style={{ fontSize: '11px', color: '#170e5e', fontWeight: 800, marginTop: '2px' }}>
                          {formatCurrency(calcCartLineTotal(item))}
                        </div>
                        {(item.modifiers?.length || 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => handleEditCartLineModifiers(item)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#170e5e',
                              fontSize: '11px',
                              fontWeight: 800,
                              cursor: 'pointer',
                              padding: '2px 0 0',
                            }}
                          >
                            تعديل الإضافات
                          </button>
                        )}
                      </div>
                    </div>

                    {/* العداد الصارم RTL: [+] (الكمية) [-] وحذف */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          border: '1px solid #cbd5e1',
                          borderRadius: '7px',
                          overflow: 'hidden',
                          backgroundColor: '#ffffff',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(item.lineKey, 1)}
                          style={{
                            width: '24px',
                            height: '24px',
                            border: 'none',
                            backgroundColor: '#170e5e',
                            color: '#ffffff',
                            fontWeight: 900,
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          +
                        </button>
                        <span
                          style={{
                            minWidth: '24px',
                            textAlign: 'center',
                            fontWeight: 900,
                            fontSize: '11.5px',
                          }}
                        >
                          {item.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(item.lineKey, -1)}
                          style={{
                            width: '24px',
                            height: '24px',
                            border: 'none',
                            backgroundColor: '#f1f5f9',
                            color: '#334155',
                            fontWeight: 900,
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          -
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveFromCart(item.lineKey)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          padding: '3px',
                        }}
                      >
                        <Trash2Icon size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* فوتر الصينية وزر الدفع المباشر */}
            <div
              style={{
                padding: '14px 18px',
                borderTop: '1px solid #e2e8f0',
                backgroundColor: '#f8fafc',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '11.5px', color: '#64748b' }}>{__t('pos.self_ordering_kiosk_page.s59', __t('pos.self_ordering_kiosk_page.s59', "عدد الوجبات:"))}</span>
                <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{totalItemsCount} {__t('pos.self_ordering_kiosk_page.s60', __t('pos.self_ordering_kiosk_page.s60', "وجبة"))}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                }}
              >
                <span style={{ fontSize: '13.5px', fontWeight: 900, color: '#0f172a' }}>{__t('pos.self_ordering_kiosk_page.s61', __t('pos.self_ordering_kiosk_page.s61', "المجموع الإجمالي:"))}</span>
                <span style={{ fontSize: '19px', fontWeight: 900, color: '#170e5e' }}>
                  {formatCurrency(totalCartAmount)}
                </span>
              </div>

              <Button
                variant="primary"
                onClick={() => setIsReviewOpen(true)}
                disabled={cart.length === 0}
                style={{
                  width: '100%',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: cart.length > 0 ? '#170e5e' : '#cbd5e1',
                  fontSize: '14px',
                  fontWeight: 900,
                  boxShadow: cart.length > 0 ? '0 4px 14px rgba(23, 14, 94, 0.25)' : 'none',
                }}
              >
                {__t('pos.self_ordering_kiosk_page.s62', __t('pos.self_ordering_kiosk_page.s62', "إتمام الطلب والدفع"))}
              </Button>
            </div>
          </aside>
        </div>
      </div>

      {/* ========================================================= */}
      {/* نافذة المراجعة والدفع المنبثقة (Checkout Dialog)         */}
      {/* ========================================================= */}
      {/* ========================================================= */}
      {/* نافذة المراجعة والدفع المنبثقة السريعة (3-Second Kiosk Checkout) */}
      {/* ========================================================= */}
      <DialogShell
        open={isReviewOpen}
        onClose={() => setIsReviewOpen(false)}
        ariaLabel={__t('pos.self_ordering_kiosk_page.s63', __t('pos.self_ordering_kiosk_page.s63', "تأكيد ودفع الطلب بالكشك"))}
        width="min(520px, 95vw)"
        zIndex={90}
      >
        <div style={{ padding: '22px 24px', direction: 'rtl', fontFamily: 'inherit' }}>
          {/* 1. Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1.5px solid #f1f5f9',
              paddingBottom: '14px',
              marginBottom: '16px',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 900, color: '#0f172a' }}>
                {__t('pos.self_ordering_kiosk_page.s64', __t('pos.self_ordering_kiosk_page.s64', "تأكيد الطلب وطريقة الدفع"))}
              </h3>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
                {storeDisplayName} {__t('pos.self_ordering_kiosk_page.s65', __t('pos.self_ordering_kiosk_page.s65', "• خطوة أخيرة لاستلام إيصالك"))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsReviewOpen(false)}
              style={{
                background: '#f1f5f9',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                padding: '6px',
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {/* 2. ملخص فوري مدمج بدون تكرار قائمة الوجبات (Executive Order Summary) */}
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '14px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '18px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: diningMode === 'dine_in' ? '#eff6ff' : '#f0fdf4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {diningMode === 'dine_in' ? (
                  <UtensilsIcon size={18} color="#2563eb" />
                ) : (
                  <ShoppingBagIcon size={18} color="#16a34a" />
                )}
              </div>
              <div>
                <div style={{ fontSize: '13.5px', fontWeight: 900, color: '#0f172a' }}>
                  {diningMode === 'dine_in' ? __t('pos.self_ordering_kiosk_page.s66', __t('pos.self_ordering_kiosk_page.s66', "تناول بالصالة (Dine In)")) : __t('pos.self_ordering_kiosk_page.s67', __t('pos.self_ordering_kiosk_page.s67', "استلام سفري (Takeaway)"))}
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '1px' }}>
                  {__t('pos.self_ordering_kiosk_page.s68', __t('pos.self_ordering_kiosk_page.s68', "إجمالي"))} {totalItemsCount} {__t('pos.self_ordering_kiosk_page.s69', __t('pos.self_ordering_kiosk_page.s69', "وجبة في الصينية"))}
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>{__t('pos.self_ordering_kiosk_page.s70', __t('pos.self_ordering_kiosk_page.s70', "المبلغ الإجمالي"))}</div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: '#170e5e' }}>
                {formatCurrency(totalCartAmount)}
              </div>
            </div>
          </div>

          {/* INV-REST-KIOSK-MODIFIER-UI (R7-B2): the review lists every
              line with its chosen extras (name + qty + price) and its
              line total including extras — the customer checks exactly
              what the kitchen will see — with edit / remove per line. */}
          <div style={{ marginBottom: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {cart.map((item) => (
              <div
                key={item.lineKey}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 900, color: '#0f172a' }}>
                    {item.qty}× {item.name}
                  </div>
                  {(item.modifiers || []).map((mod, modIdx) => (
                    <div key={modIdx} style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                      + {mod.name}{Number(mod.qty || 1) > 1 ? ` ×${mod.qty}` : ''} ({formatCurrency(Number(mod.price || 0) * Number(mod.qty || 1))})
                    </div>
                  ))}
                  {(item.modifiers?.length || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => handleEditCartLineModifiers(item)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#170e5e',
                        fontSize: '12px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        padding: '4px 0 0',
                      }}
                    >
                      تعديل الإضافات
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 900, color: '#170e5e' }}>
                    {formatCurrency(calcCartLineTotal(item))}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveFromCart(item.lineKey)}
                    aria-label={`حذف ${item.name}`}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '3px' }}
                  >
                    <Trash2Icon size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 3. في حالة الصالة فقط: اختيار رقم الطاولة أو جهاز النداء بلمسة سريعة */}
          {diningMode === 'dine_in' && (
            <div style={{ marginBottom: '18px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <label
                  style={{
                    fontSize: '13px',
                    fontWeight: 900,
                    color: '#0f172a',
                  }}
                >
                  {__t('pos.self_ordering_kiosk_page.s71', __t('pos.self_ordering_kiosk_page.s71', "رقم الطاولة أو جهاز النداء:"))}
                </label>
                {tableNumber && (
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 800,
                      color: '#16a34a',
                      backgroundColor: '#dcfce7',
                      padding: '2px 8px',
                      borderRadius: '6px',
                    }}
                  >
                    {__t('pos.self_ordering_kiosk_page.s72', __t('pos.self_ordering_kiosk_page.s72', "طاولة"))} {tableNumber} {__t('pos.self_ordering_kiosk_page.s73', __t('pos.self_ordering_kiosk_page.s73', "مختارة"))}
                  </span>
                )}
              </div>

              {/* شبكة أزرار طاولات لمسية كبيرة وسريعة (1-10) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '8px',
                  marginBottom: '10px',
                }}
              >
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setTableNumber(num)}
                    style={{
                      height: '42px',
                      borderRadius: '10px',
                      border: tableNumber === num ? '2px solid #170e5e' : '1.5px solid #e2e8f0',
                      backgroundColor: tableNumber === num ? '#170e5e' : '#ffffff',
                      color: tableNumber === num ? '#ffffff' : '#1e293b',
                      fontWeight: 900,
                      fontSize: '15px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: tableNumber === num ? '0 3px 10px rgba(23, 14, 94, 0.2)' : 'none',
                    }}
                  >
                    {num}
                  </button>
                ))}
              </div>

              {/* خانة كتابة رقم طاولة أخرى أو رقم جهاز النداء */}
              <input
                type="text"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                placeholder={__t('pos.self_ordering_kiosk_page.s74', __t('pos.self_ordering_kiosk_page.s74', "أو اكتب رقم طاولة أخرى يدوياً..."))}
                style={{
                  width: '100%',
                  height: '38px',
                  borderRadius: '10px',
                  border: '1.5px solid #cbd5e1',
                  padding: '0 12px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  boxSizing: 'border-box',
                  outline: 'none',
                  backgroundColor: '#ffffff',
                }}
              />
            </div>
          )}

          {/* INV-REST-KIOSK-ORDER-TRUTH: the kiosk collects a real phone.
              Takeaway requires one (the server rejects a takeaway order
              without it); dine-in leaves it optional. There is no
              fallback number anywhere — an empty field sends no phone. */}
          <div style={{ marginBottom: '18px' }}>
            <label
              style={{
                fontSize: '13px',
                fontWeight: 900,
                color: '#0f172a',
                display: 'block',
                marginBottom: '8px',
              }}
            >
              {diningMode === 'takeaway'
                ? __t('pos.self_ordering_kiosk_page.s138', __t('pos.self_ordering_kiosk_page.s138', "رقم الهاتف للاستلام (مطلوب):"))
                : __t('pos.self_ordering_kiosk_page.s139', __t('pos.self_ordering_kiosk_page.s139', "رقم الهاتف (اختياري — للتواصل عند الحاجة):"))}
            </label>
            <input
              type="tel"
              inputMode="tel"
              dir="ltr"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              placeholder={__t('pos.self_ordering_kiosk_page.s140', __t('pos.self_ordering_kiosk_page.s140', "مثال: 01012345678"))}
              style={{
                width: '100%',
                height: '38px',
                borderRadius: '10px',
                border: '1.5px solid #cbd5e1',
                padding: '0 12px',
                fontSize: '12.5px',
                fontWeight: 700,
                boxSizing: 'border-box',
                outline: 'none',
                backgroundColor: '#ffffff',
                textAlign: 'right',
              }}
            />
          </div>

          {/* 4. اختيار وسيلة الدفع: 3 خيارات مؤسسية ملموسة */}
          <div style={{ marginBottom: '22px' }}>
            <label
              style={{
                fontSize: '13px',
                fontWeight: 900,
                color: '#0f172a',
                display: 'block',
                marginBottom: '8px',
              }}
            >
              {__t('pos.self_ordering_kiosk_page.s75', __t('pos.self_ordering_kiosk_page.s75', "اختر طريقة الدفع:"))}
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {/* خيار 1: ماكينة الفيزا بالكشك */}
              <button
                type="button"
                onClick={() => setPaymentChoice('card_terminal')}
                style={{
                  padding: '14px 10px',
                  borderRadius: '14px',
                  border: paymentChoice === 'card_terminal' ? '2.5px solid #170e5e' : '1.5px solid #e2e8f0',
                  backgroundColor: paymentChoice === 'card_terminal' ? '#f5f3ff' : '#ffffff',
                  cursor: 'pointer',
                  textAlign: 'right',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                  boxShadow: paymentChoice === 'card_terminal' ? '0 4px 12px rgba(23, 14, 94, 0.08)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '10px',
                      backgroundColor: paymentChoice === 'card_terminal' ? '#170e5e' : '#f1f5f9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CreditCardIcon size={17} color={paymentChoice === 'card_terminal' ? '#ffffff' : '#64748b'} />
                  </div>
                  {paymentChoice === 'card_terminal' && (
                    <span
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 900,
                        color: '#170e5e',
                        backgroundColor: '#ede9fe',
                        padding: '1px 6px',
                        borderRadius: '5px',
                      }}
                    >
                      {__t('pos.self_ordering_kiosk_page.s76', __t('pos.self_ordering_kiosk_page.s76', "محدد"))}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '12.5px', fontWeight: 900, color: '#0f172a' }}>
                  {__t('pos.self_ordering_kiosk_page.s77', __t('pos.self_ordering_kiosk_page.s77', "ماكينة الكشك"))}
                </div>
                <div style={{ fontSize: '10.5px', color: '#64748b', lineHeight: 1.3 }}>
                  {__t('pos.self_ordering_kiosk_page.s78', __t('pos.self_ordering_kiosk_page.s78', "تمرير البطاقة أو مدى"))}
                </div>
              </button>

              {/* خيار 2: مسح رمز QR بالهاتف */}
              <button
                type="button"
                onClick={() => setPaymentChoice('qr_mobile')}
                style={{
                  padding: '14px 10px',
                  borderRadius: '14px',
                  border: paymentChoice === 'qr_mobile' ? '2.5px solid #170e5e' : '1.5px solid #e2e8f0',
                  backgroundColor: paymentChoice === 'qr_mobile' ? '#f5f3ff' : '#ffffff',
                  cursor: 'pointer',
                  textAlign: 'right',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                  boxShadow: paymentChoice === 'qr_mobile' ? '0 4px 12px rgba(23, 14, 94, 0.08)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '10px',
                      backgroundColor: paymentChoice === 'qr_mobile' ? '#170e5e' : '#f1f5f9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <QrCodeIcon size={17} color={paymentChoice === 'qr_mobile' ? '#ffffff' : '#64748b'} />
                  </div>
                  {paymentChoice === 'qr_mobile' && (
                    <span
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 900,
                        color: '#170e5e',
                        backgroundColor: '#ede9fe',
                        padding: '1px 6px',
                        borderRadius: '5px',
                      }}
                    >
                      {__t('pos.self_ordering_kiosk_page.s79', __t('pos.self_ordering_kiosk_page.s79', "محدد"))}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '12.5px', fontWeight: 900, color: '#0f172a' }}>
                  {__t('pos.self_ordering_kiosk_page.s80', __t('pos.self_ordering_kiosk_page.s80', "رمز QR بالهاتف"))}
                </div>
                <div style={{ fontSize: '10.5px', color: '#64748b', lineHeight: 1.3 }}>
                  {__t('pos.self_ordering_kiosk_page.s81', __t('pos.self_ordering_kiosk_page.s81', "إنستاباي أو المحافظ"))}
                </div>
              </button>

              {/* خيار 3: دفع عند الكاونتر */}
              <button
                type="button"
                onClick={() => setPaymentChoice('cash_counter')}
                style={{
                  padding: '14px 10px',
                  borderRadius: '14px',
                  border: paymentChoice === 'cash_counter' ? '2.5px solid #170e5e' : '1.5px solid #e2e8f0',
                  backgroundColor: paymentChoice === 'cash_counter' ? '#f5f3ff' : '#ffffff',
                  cursor: 'pointer',
                  textAlign: 'right',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                  boxShadow: paymentChoice === 'cash_counter' ? '0 4px 12px rgba(23, 14, 94, 0.08)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '10px',
                      backgroundColor: paymentChoice === 'cash_counter' ? '#170e5e' : '#f1f5f9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ReceiptIcon size={17} color={paymentChoice === 'cash_counter' ? '#ffffff' : '#64748b'} />
                  </div>
                  {paymentChoice === 'cash_counter' && (
                    <span
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 900,
                        color: '#170e5e',
                        backgroundColor: '#ede9fe',
                        padding: '1px 6px',
                        borderRadius: '5px',
                      }}
                    >
                      {__t('pos.self_ordering_kiosk_page.s82', __t('pos.self_ordering_kiosk_page.s82', "محدد"))}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '12.5px', fontWeight: 900, color: '#0f172a' }}>
                  {__t('pos.self_ordering_kiosk_page.s83', __t('pos.self_ordering_kiosk_page.s83', "دفع بالكاونتر"))}
                </div>
                <div style={{ fontSize: '10.5px', color: '#64748b', lineHeight: 1.3 }}>
                  {__t('pos.self_ordering_kiosk_page.s84', __t('pos.self_ordering_kiosk_page.s84', "تذكرة للكاشير (كاش/فيزا)"))}
                </div>
              </button>
            </div>
          </div>

          {/* INV-REST-KIOSK-NO-FICTION: a failed finalize stays visible here; the button below retries it. */}
          {orderError && (
            <div
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                backgroundColor: '#fef2f2',
                border: '1.5px solid #fecaca',
                borderRadius: '12px',
                padding: '12px 14px',
                marginBottom: '14px',
                textAlign: 'right',
              }}
            >
              <AlertCircleIcon size={20} color="#dc2626" />
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#b91c1c', lineHeight: 1.5 }}>{orderError}</div>
            </div>
          )}

          {/* 5. زر التأكيد النهائي وإصدار التذكرة: Full-width tactile button */}
          <Button
            variant="primary"
            onClick={handleCheckoutSubmit}
            disabled={isSubmitting || isTableMissing || isTakeawayPhoneMissing}
            style={{
              width: '100%',
              height: '52px',
              backgroundColor:
                isTableMissing || isTakeawayPhoneMissing
                  ? '#cbd5e1'
                  : '#15803d',
              fontSize: '15px',
              fontWeight: 900,
              borderRadius: '14px',
              cursor: isTableMissing || isTakeawayPhoneMissing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow:
                isTableMissing || isTakeawayPhoneMissing
                  ? 'none'
                  : '0 6px 18px rgba(22, 128, 61, 0.25)',
              border: 'none',
              color: '#ffffff',
            }}
          >
            {isSubmitting ? (
              __t('pos.self_ordering_kiosk_page.s85', __t('pos.self_ordering_kiosk_page.s85', "جارٍ معالجة الطلب..."))
            ) : isTableMissing ? (
              __t('pos.self_ordering_kiosk_page.s86', __t('pos.self_ordering_kiosk_page.s86', "يرجى تحديد رقم طاولتك بالأعلى أولاً"))
            ) : isTakeawayPhoneMissing ? (
              __t('pos.self_ordering_kiosk_page.s141', __t('pos.self_ordering_kiosk_page.s141', "يرجى إدخال رقم هاتف صحيح للاستلام أولاً"))
            ) : paymentChoice === 'card_terminal' ? (
              <span>{__t('pos.self_ordering_kiosk_page.s87', __t('pos.self_ordering_kiosk_page.s87', "المتابعة للدفع بجهاز الكشك •"))} {formatCurrency(totalCartAmount)}</span>
            ) : paymentChoice === 'qr_mobile' ? (
              <span>{__t('pos.self_ordering_kiosk_page.s88', __t('pos.self_ordering_kiosk_page.s88', "عرض رمز QR وسداد الفاتورة •"))} {formatCurrency(totalCartAmount)}</span>
            ) : (
              <span>{__t('pos.self_ordering_kiosk_page.s89', __t('pos.self_ordering_kiosk_page.s89', "طباعة تذكرة وسدادها عند الكاونتر •"))} {formatCurrency(totalCartAmount)}</span>
            )}
          </Button>
        </div>
      </DialogShell>

      {/* ========================================================= */}
      {/* نافذة ماكينة الدفع بالبطاقة بالكشك (Terminal Modal)         */}
      {/* ========================================================= */}
      <DialogShell
        open={isTerminalModalOpen}
        onClose={() => {
          if (terminalStep !== 'approved') setIsTerminalModalOpen(false);
        }}
        ariaLabel={__t('pos.self_ordering_kiosk_page.s90', __t('pos.self_ordering_kiosk_page.s90', "جهاز الدفع بالبطاقة بالكشك"))}
        width="min(460px, 94vw)"
        zIndex={95}
      >
        <div style={{ padding: '28px 24px', textAlign: 'center', direction: 'rtl', fontFamily: 'inherit' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#64748b' }}>
              {__t('pos.self_ordering_kiosk_page.s91', __t('pos.self_ordering_kiosk_page.s91', "معاملة #"))}{activeTransactionId || 'ECR-001'}
            </span>
            <button
              type="button"
              onClick={() => setIsTerminalModalOpen(false)}
              style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '6px', color: '#64748b' }}
            >
              <XIcon size={16} />
            </button>
          </div>

          {/* INV-REST-KIOSK-NO-FICTION: a failed finalize stays visible in every terminal step. */}
          {orderError && (
            <div
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                backgroundColor: '#fef2f2',
                border: '1.5px solid #fecaca',
                borderRadius: '12px',
                padding: '12px 14px',
                marginBottom: '14px',
                textAlign: 'right',
              }}
            >
              <AlertCircleIcon size={20} color="#dc2626" />
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#b91c1c', lineHeight: 1.5 }}>{orderError}</div>
            </div>
          )}

          {/* الخطوة 1: جاري الاتصال بالماكينة */}
          {terminalStep === 'connecting' && (
            <div style={{ padding: '16px 0' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '20px',
                  backgroundColor: '#eef2ff',
                  margin: '0 auto 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RefreshCwIcon size={28} color="#170e5e" className="animate-spin" />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 900, color: '#0f172a', margin: '0 0 8px' }}>
                {__t('pos.self_ordering_kiosk_page.s92', __t('pos.self_ordering_kiosk_page.s92', "جاري الاتصال بماكينة الدفع"))}
              </h3>
              <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                {terminalMessage || __t('pos.self_ordering_kiosk_page.s93', __t('pos.self_ordering_kiosk_page.s93', "جاري إرسال قيمة الفاتورة للماكينة..."))}
              </p>
            </div>
          )}

          {/* الخطوة 2: في انتظار تمرير البطاقة */}
          {terminalStep === 'waiting_card' && (
            <div style={{ padding: '10px 0' }}>
              <div
                style={{
                  width: '74px',
                  height: '74px',
                  borderRadius: '22px',
                  backgroundColor: '#f5f3ff',
                  margin: '0 auto 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid #ddd6fe',
                }}
              >
                <CreditCardIcon size={36} color="#170e5e" />
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: 900, color: '#0f172a', margin: '0 0 6px' }}>
                {__t('pos.self_ordering_kiosk_page.s94', __t('pos.self_ordering_kiosk_page.s94', "مرر أو أدخل البطاقة البنكية"))}
              </h3>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 16px' }}>
                {__t('pos.self_ordering_kiosk_page.s95', __t('pos.self_ordering_kiosk_page.s95', "في جهاز الدفع بالأسفل (يدعم فيزا، ماستركارد، ميزا، ومدى، وApple Pay)"))}
              </p>

              {/* Amount Box */}
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1.5px solid #e2e8f0',
                  borderRadius: '16px',
                  padding: '14px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#64748b' }}>{__t('pos.self_ordering_kiosk_page.s96', __t('pos.self_ordering_kiosk_page.s96', "المبلغ المطلوب سحبه:"))}</div>
                <div style={{ fontSize: '26px', fontWeight: 900, color: '#170e5e', marginTop: '2px' }}>
                  {formatCurrency(totalCartAmount)}
                </div>
              </div>

              {/* Countdown badge */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: '#f1f5f9',
                  padding: '5px 14px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: 800,
                  color: '#475569',
                  marginBottom: '18px',
                }}
              >
                <ClockIcon size={14} color="#64748b" />
                <span>{__t('pos.self_ordering_kiosk_page.s97', __t('pos.self_ordering_kiosk_page.s97', "متبقي"))} {terminalCountdown} {__t('pos.self_ordering_kiosk_page.s98', __t('pos.self_ordering_kiosk_page.s98', "ثانية"))}</span>
              </div>

              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsTerminalModalOpen(false)}
                  style={{
                    width: '100%',
                    height: '42px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontWeight: 800,
                  }}
                >
                  {__t('pos.self_ordering_kiosk_page.s99', __t('pos.self_ordering_kiosk_page.s99', "إلغاء والعودة"))}
                </Button>
              </div>
            </div>
          )}

          {/* الخطوة 3: تمت الموافقة بنجاح */}
          {terminalStep === 'approved' && (
            <div style={{ padding: '16px 0' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  backgroundColor: '#dcfce7',
                  margin: '0 auto 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CheckCircleIcon size={36} color="#16a34a" />
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: 900, color: '#15803d', margin: '0 0 6px' }}>
                {__t('pos.self_ordering_kiosk_page.s100', __t('pos.self_ordering_kiosk_page.s100', "تمت الموافقة وخصم المبلغ بنجاح!"))}
              </h3>
              <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                {terminalMessage || __t('pos.self_ordering_kiosk_page.s101', __t('pos.self_ordering_kiosk_page.s101', "تم تأكيد التفويض البنكي، جاري إصدار تذكرتك..."))}
              </p>
              {/* INV-REST-KIOSK-NO-FICTION: the card is already charged, so
                  the retry re-sends the order only — it never re-charges. */}
              {orderError && lastFinalizeOpts && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '18px' }}>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => {
                      void handleFinalizeOrder(lastFinalizeOpts);
                    }}
                    style={{
                      width: '100%',
                      height: '44px',
                      borderRadius: '10px',
                      backgroundColor: '#170e5e',
                      fontSize: '13.5px',
                      fontWeight: 800,
                    }}
                  >
                    {__t('pos.self_ordering_kiosk_page.s137', __t('pos.self_ordering_kiosk_page.s137', "إعادة إرسال الطلب"))}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* الخطوة 4: تم رفض العملية */}
          {terminalStep === 'declined' && (
            <div style={{ padding: '16px 0' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  backgroundColor: '#fee2e2',
                  margin: '0 auto 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AlertCircleIcon size={36} color="#dc2626" />
              </div>
              <h3 style={{ fontSize: '19px', fontWeight: 900, color: '#b91c1c', margin: '0 0 6px' }}>
                {__t('pos.self_ordering_kiosk_page.s102', __t('pos.self_ordering_kiosk_page.s102', "تعذر إتمام الدفع بالبطاقة"))}
              </h3>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px' }}>
                {terminalMessage || __t('pos.self_ordering_kiosk_page.s103', __t('pos.self_ordering_kiosk_page.s103', "تم رفض العملية من البنك أو تم إلغاؤها."))}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    void handleCheckoutSubmit();
                  }}
                  style={{
                    width: '100%',
                    height: '44px',
                    borderRadius: '10px',
                    backgroundColor: '#170e5e',
                    fontSize: '13.5px',
                    fontWeight: 800,
                  }}
                >
                  {__t('pos.self_ordering_kiosk_page.s104', __t('pos.self_ordering_kiosk_page.s104', "إعادة المحاولة ببطاقة أخرى"))}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setIsTerminalModalOpen(false);
                    setPaymentChoice('cash_counter');
                    void handleFinalizeOrder({
                      paymentMethod: 'cash',
                      paymentStatus: 'unpaid',
                      paymentLabel: __t('pos.self_ordering_kiosk_page.s105', __t('pos.self_ordering_kiosk_page.s105', "غير مدفوع - محاسبة عند الكاونتر")),
                    });
                  }}
                  style={{
                    width: '100%',
                    height: '42px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontWeight: 800,
                  }}
                >
                  {__t('pos.self_ordering_kiosk_page.s106', __t('pos.self_ordering_kiosk_page.s106', "التحويل للدفع نقداً عند الكاشير"))}
                </Button>
              </div>
            </div>
          )}

          {/* الخطوة 5: الجهاز غير متصل (تنبيه حقيقي دون تخطي وهمي) */}
          {terminalStep === 'offline_error' && (
            <div style={{ padding: '16px 0' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '20px',
                  backgroundColor: '#fef3c7',
                  margin: '0 auto 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AlertTriangleIcon size={32} color="#d97706" />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 900, color: '#0f172a', margin: '0 0 6px' }}>
                {__t('pos.self_ordering_kiosk_page.s107', __t('pos.self_ordering_kiosk_page.s107', "ماكينة الدفع غير متصلة بهذا الكشك"))}
              </h3>
              <p style={{ fontSize: '12.5px', color: '#64748b', lineHeight: 1.5, margin: '0 0 20px' }}>
                {terminalMessage}
                <br />
                {__t('pos.self_ordering_kiosk_page.s108', __t('pos.self_ordering_kiosk_page.s108', "يمكنك مسح رمز QR والدفع بهاتفك فوراً، أو طباعة تذكرة والتوجه لكاونتر الكاشير للمحاسبة بالفيزا أو نقداً."))}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    setIsTerminalModalOpen(false);
                    setPaymentChoice('qr_mobile');
                    const ref = `QR-${Date.now().toString().slice(-6)}`;
                    setQrRef(ref);
                    setQrCountdown(120);
                    setIsQrModalOpen(true);
                  }}
                  style={{
                    width: '100%',
                    height: '44px',
                    borderRadius: '10px',
                    backgroundColor: '#170e5e',
                    fontSize: '13.5px',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <QrCodeIcon size={16} color="#ffffff" />
                  <span>{__t('pos.self_ordering_kiosk_page.s109', __t('pos.self_ordering_kiosk_page.s109', "الدفع بمسح رمز QR بالهاتف"))}</span>
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setIsTerminalModalOpen(false);
                    setPaymentChoice('cash_counter');
                    void handleFinalizeOrder({
                      paymentMethod: 'cash',
                      paymentStatus: 'unpaid',
                      paymentLabel: __t('pos.self_ordering_kiosk_page.s110', __t('pos.self_ordering_kiosk_page.s110', "غير مدفوع - محاسبة عند الكاونتر")),
                    });
                  }}
                  style={{
                    width: '100%',
                    height: '42px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontWeight: 800,
                  }}
                >
                  {__t('pos.self_ordering_kiosk_page.s111', __t('pos.self_ordering_kiosk_page.s111', "طباعة تذكرة والسداد لدى الكاشير"))}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogShell>

      {/* ========================================================= */}
      {/* نافذة الدفع السريع برمز QR بالهاتف (Dynamic QR Modal)       */}
      {/* ========================================================= */}
      <DialogShell
        open={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        ariaLabel={__t('pos.self_ordering_kiosk_page.s112', __t('pos.self_ordering_kiosk_page.s112', "الدفع الإلكتروني برمز QR"))}
        width="min(460px, 94vw)"
        zIndex={95}
      >
        <div style={{ padding: '24px 22px', textAlign: 'center', direction: 'rtl', fontFamily: 'inherit' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#64748b' }}>
              {__t('pos.self_ordering_kiosk_page.s113', __t('pos.self_ordering_kiosk_page.s113', "معاملة #"))}{qrRef || 'QR-100'}
            </span>
            <button
              type="button"
              onClick={() => setIsQrModalOpen(false)}
              style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '6px', color: '#64748b' }}
            >
              <XIcon size={16} />
            </button>
          </div>

          <h3 style={{ fontSize: '19px', fontWeight: 900, color: '#0f172a', margin: '0 0 4px' }}>
            {__t('pos.self_ordering_kiosk_page.s114', __t('pos.self_ordering_kiosk_page.s114', "امسح الرمز بهاتفك لإتمام الدفع"))}
          </h3>
          <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 16px' }}>
            {__t('pos.self_ordering_kiosk_page.s115', __t('pos.self_ordering_kiosk_page.s115', "يدعم تطبيق إنستاباي، المحافظ الإلكترونية الذكية (فودافون/أورانج/اتصالات كاش)، أو تطبيق بنكك"))}
          </p>

          {/* Dynamic QR Code Box */}
          <div
            style={{
              width: '210px',
              height: '210px',
              margin: '0 auto 16px',
              padding: '10px',
              backgroundColor: '#ffffff',
              borderRadius: '18px',
              border: '2px solid #e2e8f0',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                `instapay://pay?to=${currentSlug}&amount=${totalCartAmount}&ref=${qrRef}&name=${encodeURIComponent(
                  storeDisplayName
                )}`
              )}`}
              alt={__t('pos.self_ordering_kiosk_page.s116', __t('pos.self_ordering_kiosk_page.s116', "رمز QR للدفع"))}
              style={{ width: '190px', height: '190px', borderRadius: '10px', display: 'block' }}
            />
          </div>

          {/* Amount Box */}
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1.5px solid #e2e8f0',
              borderRadius: '14px',
              padding: '12px',
              marginBottom: '16px',
            }}
          >
            <div style={{ fontSize: '11.5px', color: '#64748b' }}>{__t('pos.self_ordering_kiosk_page.s117', __t('pos.self_ordering_kiosk_page.s117', "إجمالي الفاتورة المطلوب سداده:"))}</div>
            <div style={{ fontSize: '24px', fontWeight: 900, color: '#170e5e', marginTop: '2px' }}>
              {formatCurrency(totalCartAmount)}
            </div>
          </div>

          {/* Timer */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#f1f5f9',
              padding: '4px 14px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 800,
              color: '#475569',
              marginBottom: '18px',
            }}
          >
            <ClockIcon size={14} color="#64748b" />
            <span>
              {__t('pos.self_ordering_kiosk_page.s118', __t('pos.self_ordering_kiosk_page.s118', "متبقي"))} {Math.floor(qrCountdown / 60)}:{(qrCountdown % 60).toString().padStart(2, '0')} {__t('pos.self_ordering_kiosk_page.s119', __t('pos.self_ordering_kiosk_page.s119', "دقيقة"))}
            </span>
          </div>

          {/* INV-REST-KIOSK-NO-FICTION: a failed finalize stays visible here; the green button below retries it. */}
          {orderError && (
            <div
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                backgroundColor: '#fef2f2',
                border: '1.5px solid #fecaca',
                borderRadius: '12px',
                padding: '12px 14px',
                marginBottom: '14px',
                textAlign: 'right',
              }}
            >
              <AlertCircleIcon size={20} color="#dc2626" />
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#b91c1c', lineHeight: 1.5 }}>{orderError}</div>
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                // INV-REST-KIOSK-NO-FICTION: tapping "I sent it" creates
                // the order as PENDING — the server still holds
                // payment_status 'pending' and only the cashier's
                // verification can mark it paid. Never 'paid' on the
                // customer's word.
                void handleFinalizeOrder({
                  paymentMethod: 'qr_mobile',
                  paymentStatus: 'pending',
                  paymentLabel: __t('pos.self_ordering_kiosk_page.s133', __t('pos.self_ordering_kiosk_page.s133', "تحويل QR — بانتظار تأكيد الكاشير")),
                  rrn: qrRef,
                });
              }}
              style={{
                width: '100%',
                height: '48px',
                backgroundColor: '#15803d',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: 900,
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(22, 128, 61, 0.25)',
              }}
            >
              {__t('pos.self_ordering_kiosk_page.s132', __t('pos.self_ordering_kiosk_page.s132', "أرسلت التحويل • استلام التذكرة"))}
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsQrModalOpen(false);
                setPaymentChoice('cash_counter');
                void handleFinalizeOrder({
                  paymentMethod: 'cash',
                  paymentStatus: 'unpaid',
                  paymentLabel: __t('pos.self_ordering_kiosk_page.s122', __t('pos.self_ordering_kiosk_page.s122', "غير مدفوع - محاسبة عند الكاونتر")),
                });
              }}
              style={{
                width: '100%',
                height: '40px',
                borderRadius: '10px',
                fontSize: '12.5px',
                fontWeight: 800,
              }}
            >
              {__t('pos.self_ordering_kiosk_page.s123', __t('pos.self_ordering_kiosk_page.s123', "تعذر التحويل؟ سداد نقداً عند الكاشير"))}
            </Button>
          </div>

          <p style={{ fontSize: '11.5px', color: '#64748b', marginTop: '12px', lineHeight: 1.5 }}>
            {__t('pos.self_ordering_kiosk_page.s134', __t('pos.self_ordering_kiosk_page.s134', "سيتم تأكيد التحويل لدى الكاشير قبل بدء تحضير طلبك — احتفظ بالتذكرة."))}
          </p>
        </div>
      </DialogShell>

      {/* Smart Upsell Modal */}
      <PosSmartUpsellModal
        open={upsellModalOpen}
        onClose={() => setUpsellModalOpen(false)}
        triggerItemName={upsellTriggerItem?.name || ''}
        recommendations={upsellRules}
        allProducts={products as any}
        onAddUpsellItem={(prod, discount) => {
          handleAddToCart(
            {
              id: prod.id,
              name: prod.name,
              price: Math.max(0, Number(prod.retailPrice || 0) - (discount || 0)),
              imageUrl: (prod as any).imageUrl || '',
            },
            true
          );
        }}
      />

      {/* INV-REST-KIOSK-MODIFIER-UI (R7-B2): the customer-facing modifier
          picker. It opens from a product tap (new line) or from a cart
          line's "تعديل الإضافات" (edit that line's picks). */}
      {modifierPicker && (
        <KioskModifierPickerModal
          open
          onClose={() => setModifierPicker(null)}
          productName={modifierPicker.product.name}
          productPrice={Number(modifierPicker.product.price || 0)}
          groups={modifierPicker.groups}
          initialModifiers={modifierPicker.initialModifiers}
          onSave={handleModifierPickerSave}
          saveLabel={modifierPicker.editingLineKey ? 'تأكيد التعديل' : 'أضف إلى السلة'}
        />
      )}
    </div>
  );
}
