import { useEffect, useRef } from 'react';
import { normalizePaymentChannel } from '@/features/pos/lib/pos-workspace.helpers';
import { toMoney } from '@/features/pos/hooks/pos-workspace-actions/createPosWorkspaceBaseActions.helpers';
import { buildDraftState, persistDraftSnapshot, persistLastSale, persistRecentProductIds } from '@/features/pos/lib/pos.persistence';
import { isNegativeStockSalesAllowed, syncPosCartStock } from '@/features/pos/lib/pos.domain';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits } from '@/shared/utils/money';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import type { Product, Sale } from '@/types/domain';
import type { PaymentChannel, PaymentType } from '@/features/pos/hooks/usePosWorkspace';

export function usePosWorkspaceEffects({
  cart,
  customerId,
  discount,
  paidAmount,
  total,
  cashAmount,
  setCashAmount,
  cardAmount,
  setCardAmount,
  transferAmount,
  setTransferAmount,
  paymentType,
  paymentChannel,
  setPaymentChannel,
  note,
  search,
  priceType,
  tableNumber,
  guestCount,
  guestCheckPrintedAt,
  orderType,
  deliveryFee,
  setDeliveryFee,
  deliveryRepId,
  collectionStatus,
  tipAmount,
  setTipAmount,
  loyaltyPointsRedeemed,
  setLoyaltyPointsRedeemed,
  pagerNumber,
  diningCourse,
  deliveryFeeMode,
  branchId,
  locationId,
  createSale,

  products,
  setCart,
  submitMessage,
  setSubmitMessage,
  scannerMessage,
  setScannerMessage,
  ownOpenShift,
  recentProductIds,
  lastSale,
  lastAddedLineKey,
  setLastAddedLineKey,
  quickCustomerName,
  quickCustomerPhone,
  quickCustomerAddress,

  selectedLineKey,
  setSelectedLineKey,
  discountApprovalSecret,
  setDiscountApprovalSecret,
  settings,
}: {
  cart: PosItem[];
  customerId: string;
  quickCustomerName?: string;
  quickCustomerPhone?: string;
  quickCustomerAddress?: string;
  discount: number;
  paidAmount: number;
  total?: number;
  cashAmount: number;
  setCashAmount: (value: number) => void;
  cardAmount: number;
  setCardAmount: (value: number) => void;
  transferAmount: number;
  setTransferAmount: (value: number) => void;
  paymentType: PaymentType;
  paymentChannel: PaymentChannel;
  setPaymentChannel: (value: PaymentChannel) => void;
  note: string;
  search: string;
  priceType: PosPriceType;
  tableNumber: string;
  guestCount?: number;
  guestCheckPrintedAt?: string | null;
  orderType: string;
  deliveryFee?: number;
  setDeliveryFee?: (value: number) => void;
  deliveryRepId?: string;
  collectionStatus?: string;
  tipAmount?: number;
  setTipAmount?: (value: number) => void;
  loyaltyPointsRedeemed?: number;
  setLoyaltyPointsRedeemed?: (value: number) => void;
  createSale?: { reset?: () => void; isSuccess?: boolean; isError?: boolean } | null;
  pagerNumber?: string;
  diningCourse?: string;
  deliveryFeeMode?: 'freelance_courier' | 'store_fleet' | string;
  branchId?: string;
  locationId?: string;

  products: Product[];
  setCart: (value: PosItem[] | ((current: PosItem[]) => PosItem[])) => void;
  submitMessage?: string;
  setSubmitMessage: (value: string) => void;
  scannerMessage?: string;
  setScannerMessage?: (value: string) => void;
  ownOpenShift?: unknown;
  recentProductIds: string[];
  lastSale: Sale | null;
  lastAddedLineKey: string;
  setLastAddedLineKey: (value: string) => void;
  selectedLineKey: string;
  setSelectedLineKey: (value: string) => void;
  discountApprovalSecret: string;
  setDiscountApprovalSecret: (value: string) => void;
  settings?: { currency?: string; allowNegativeStockSales?: unknown; allowSellingBelowStock?: unknown } | null;
}) {
  useEffect(() => {
    if (ownOpenShift) {
      if (submitMessage && submitMessage.includes('وردية')) {
        setSubmitMessage('');
      }
      if (scannerMessage && scannerMessage.includes('وردية') && setScannerMessage) {
        setScannerMessage('');
      }
    }
  }, [ownOpenShift, submitMessage, scannerMessage, setSubmitMessage, setScannerMessage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Debounce persistence to avoid synchronous localStorage writes on every keystroke
    // (especially during barcode scanner rapid input).
    const timer = window.setTimeout(() => {
      persistDraftSnapshot(buildDraftState({
        cart,
        customerId,
        quickCustomerName,
        quickCustomerPhone,
        quickCustomerAddress,
        discount,
        deliveryFee,
        deliveryRepId,
        collectionStatus,
        tipAmount,
        loyaltyPointsRedeemed,
        pagerNumber,
        diningCourse,
        deliveryFeeMode,
        paidAmount,
        cashAmount,
        cardAmount,
        transferAmount,
        paymentType,
        paymentChannel,
        note,
        search,
        priceType,
        tableNumber,
        guestCount,
        guestCheckPrintedAt,
        orderType,
        branchId: branchId || '',
        locationId: locationId || '',
      }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [cart, customerId, quickCustomerName, quickCustomerPhone, quickCustomerAddress, discount, deliveryFee, deliveryRepId, collectionStatus, tipAmount, loyaltyPointsRedeemed, pagerNumber, diningCourse, deliveryFeeMode, paidAmount, cashAmount, cardAmount, transferAmount, paymentType, paymentChannel, note, search, priceType, tableNumber, guestCount, guestCheckPrintedAt, orderType, branchId, locationId]);

  /* INV-REST-HOLD-RECALL-TRUTH (R5-B): the 300 ms debounce has no flush
   * on unmount — navigating away within 300 ms of the last edit lost
   * that edit. The latest snapshot is persisted synchronously when the
   * workspace unmounts, but only while a cart exists (an empty cart
   * means the draft was held / submitted / cleared already). */
  const latestDraftRef = useRef({ cart, customerId, quickCustomerName, quickCustomerPhone, quickCustomerAddress, discount, deliveryFee, deliveryRepId, collectionStatus, tipAmount, loyaltyPointsRedeemed, pagerNumber, diningCourse, deliveryFeeMode, paidAmount, cashAmount, cardAmount, transferAmount, paymentType, paymentChannel, note, search, priceType, tableNumber, guestCount, guestCheckPrintedAt, orderType, branchId, locationId });
  latestDraftRef.current = { cart, customerId, quickCustomerName, quickCustomerPhone, quickCustomerAddress, discount, deliveryFee, deliveryRepId, collectionStatus, tipAmount, loyaltyPointsRedeemed, pagerNumber, diningCourse, deliveryFeeMode, paidAmount, cashAmount, cardAmount, transferAmount, paymentType, paymentChannel, note, search, priceType, tableNumber, guestCount, guestCheckPrintedAt, orderType, branchId, locationId };
  useEffect(() => {
    if (typeof window === 'undefined') return;
    return () => {
      const latest = latestDraftRef.current;
      if (latest.cart.length) persistDraftSnapshot(buildDraftState(latest));
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    persistRecentProductIds(recentProductIds);
  }, [recentProductIds]);

  useEffect(() => {
    if (!cart.length || !products.length) return;
    const result = syncPosCartStock(cart, products, { allowNegativeStockSales: isNegativeStockSalesAllowed(settings), digits: currencyMoneyDigits(settings?.currency || getGlobalSystemCurrency()) });
    if (result.cart === cart) return;
    setCart(result.cart);
    if (result.removedCount || result.clampedCount || result.heldUnavailableCount) {
      const parts = [];
      if (result.removedCount) parts.push(`تم حذف ${result.removedCount} صنف غير متاح في الموقع الحالي`);
      if (result.clampedCount) parts.push(`تم تعديل كمية ${result.clampedCount} صنف حسب المخزون المتاح`);
      /* INV-REST-HOLD-RECALL-TRUTH (R5-B): a stock-out held line is kept
       * and flagged, never silently deleted — the cashier decides. */
      if (result.heldUnavailableCount) parts.push(`${result.heldUnavailableCount} صنف معلّق غير متاح حالياً — أزله أو بدّله`);
      setSubmitMessage(`${parts.join('، ')}.`);
    }
  }, [cart, products, settings, setCart, setSubmitMessage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    persistLastSale(lastSale);
  }, [lastSale]);

  // INV-INVOICE-DETAIL-AMOUNTS: the cash field follows the grand total
  // whenever the total changes — but ONLY when the cash field was simply
  // tracking the total (single cash payment, exactly filled to the previous
  // total via the preset / 'كامل' fill). A manually tendered amount
  // (cash != old total) or a split payment (card / transfer present) is real
  // money the cashier already holds, so it is left untouched; a credit sale
  // never has cash. Trial 8 proved the old discount-only trigger wrong:
  // tip + redemption dropped the total 85.00 to 65.00 and the 15.00 delivery
  // fee raised it to 80.00, yet cash stayed stale at 85.00 because the
  // discount never changed. Any total change (discount, tip, redemption,
  // delivery fee, items added/removed) now re-syncs tracking cash.
  const prevTotalRef = useRef(total ?? 0);
  useEffect(() => {
    const prevTotal = prevTotalRef.current;
    prevTotalRef.current = total ?? 0;
    if (total === undefined) return;
    if (Number(total) === Number(prevTotal)) return;
    if (paymentType === 'credit') return;
    if (Number(cardAmount || 0) !== 0 || Number(transferAmount || 0) !== 0) return;
    if (Number(cashAmount || 0) !== toMoney(Number(prevTotal || 0))) return;
    setCashAmount(toMoney(Number(total)));
  }, [discount, total, paymentType, cardAmount, transferAmount, cashAmount, setCashAmount]);



  useEffect(() => {
    const nextChannel = normalizePaymentChannel(paymentType, cashAmount, cardAmount, transferAmount, paymentChannel);
    if (paymentChannel !== nextChannel) setPaymentChannel(nextChannel);
    if (paymentType === 'credit') {
      if (cashAmount !== 0) setCashAmount(0);
      if (cardAmount !== 0) setCardAmount(0);
      if (transferAmount !== 0) setTransferAmount(0);
    }
  }, [cashAmount, cardAmount, transferAmount, paymentChannel, paymentType, setCashAmount, setCardAmount, setTransferAmount, setPaymentChannel]);

  /* T15-A (INV-REST-TRASH-DELETE-EXTRAS-TRUTH, K1): the empty-cart
   * reaction lives here, in the effect — NOT in removeItem. T14-A
   * zeroed the extras from inside removeItem by reading a flag
   * assigned inside the setCart updater, but React runs a functional
   * updater at re-render, never inside the setState call, so the
   * flag was still false at the check and the branch never fired
   * live (Trial 8: trash-delete left an empty cart at 25.00).
   * Effects run after render against the installed cart, so this
   * covers every empty-cart path (trash, stepper-to-zero, clear)
   * in the one canonical place. The customer stays attached (no
   * setCustomerId): emptying the cart is not starting a new sale.
   * Firing on mount is harmless — the extras are 0 then. */
  useEffect(() => {
    if (!cart.length) {
      if (selectedLineKey) setSelectedLineKey('');
      if (discountApprovalSecret) setDiscountApprovalSecret('');
      if (tipAmount) setTipAmount?.(0);
      if (loyaltyPointsRedeemed) setLoyaltyPointsRedeemed?.(0);
      if (deliveryFee) setDeliveryFee?.(0);
      if (submitMessage) setSubmitMessage('');
      /* INV-POS-EMPTY-CART-MUTATION-RESET-GATE: reset ONLY when the
       * mutation is in a terminal state. An unconditional reset here
       * self-sustained a render loop: useMutation returns a fresh object
       * every render (so the createSale dep "changed" after every render),
       * and reset() notifies listeners unconditionally, which re-rendered
       * the workspace and re-ran this effect — hundreds of renders until
       * the POS route unmounted (~5.4 s live). An idle mutation has no
       * stale status to clear, so skipping the reset loses nothing; a
       * finished sale is cleared exactly once, and the flip to idle closes
       * the gate on the next effect run. */
      if (createSale?.isSuccess || createSale?.isError) createSale.reset?.();
      return;
    }
    if (selectedLineKey && cart.some((item) => item.lineKey === selectedLineKey)) return;
    const preferredLineKey = cart.some((item) => item.lineKey === lastAddedLineKey) ? lastAddedLineKey : cart[0]?.lineKey || '';
    if (preferredLineKey && preferredLineKey !== selectedLineKey) {
      setSelectedLineKey(preferredLineKey);
    }
  }, [cart, discountApprovalSecret, lastAddedLineKey, selectedLineKey, setDiscountApprovalSecret, setSelectedLineKey, tipAmount, loyaltyPointsRedeemed, deliveryFee, submitMessage, setTipAmount, setLoyaltyPointsRedeemed, setDeliveryFee, setSubmitMessage, createSale]);

  useEffect(() => {
    if (!lastAddedLineKey || typeof window === 'undefined') return;
    const timer = window.setTimeout(() => setLastAddedLineKey(''), 1400);
    return () => window.clearTimeout(timer);
  }, [lastAddedLineKey, setLastAddedLineKey]);
}
