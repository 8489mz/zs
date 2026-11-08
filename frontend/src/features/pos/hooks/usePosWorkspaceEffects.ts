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
  deliveryRepId?: string;
  collectionStatus?: string;

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
        branchId: '',
        locationId: '',
      }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [cart, customerId, quickCustomerName, quickCustomerPhone, quickCustomerAddress, discount, paidAmount, cashAmount, cardAmount, transferAmount, paymentType, paymentChannel, note, search, priceType, tableNumber, guestCount, guestCheckPrintedAt, orderType]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    persistRecentProductIds(recentProductIds);
  }, [recentProductIds]);

  useEffect(() => {
    if (!cart.length || !products.length) return;
    const result = syncPosCartStock(cart, products, { allowNegativeStockSales: isNegativeStockSalesAllowed(settings), digits: currencyMoneyDigits(settings?.currency || getGlobalSystemCurrency()) });
    if (result.cart === cart) return;
    setCart(result.cart);
    if (result.removedCount || result.clampedCount) {
      const parts = [];
      if (result.removedCount) parts.push(`تم حذف ${result.removedCount} صنف غير متاح في الموقع الحالي`);
      if (result.clampedCount) parts.push(`تم تعديل كمية ${result.clampedCount} صنف حسب المخزون المتاح`);
      setSubmitMessage(`${parts.join('، ')}.`);
    }
  }, [cart, products, settings, setCart, setSubmitMessage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    persistLastSale(lastSale);
  }, [lastSale]);

  // INV-INVOICE-DETAIL-AMOUNTS: the cash field follows the grand total when
  // the discount changes — but ONLY when the cash field was simply tracking
  // the total (single cash payment, exactly filled to the previous total via
  // the preset / 'كامل' fill). A manually tendered amount (cash != old total)
  // or a split payment (card / transfer present) is real money the cashier
  // already holds, so it is left untouched; a credit sale never has cash.
  // Total changes from anything else (items added/removed, delivery fee)
  // deliberately do NOT move the cash field.
  const prevDiscountRef = useRef(discount);
  const prevTotalRef = useRef(total ?? 0);
  useEffect(() => {
    const prevDiscount = prevDiscountRef.current;
    const prevTotal = prevTotalRef.current;
    prevDiscountRef.current = discount;
    prevTotalRef.current = total ?? 0;
    if (total === undefined) return;
    if (discount === prevDiscount) return;
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

  useEffect(() => {
    if (!cart.length) {
      if (selectedLineKey) setSelectedLineKey('');
      if (discountApprovalSecret) setDiscountApprovalSecret('');
      return;
    }
    if (selectedLineKey && cart.some((item) => item.lineKey === selectedLineKey)) return;
    const preferredLineKey = cart.some((item) => item.lineKey === lastAddedLineKey) ? lastAddedLineKey : cart[0]?.lineKey || '';
    if (preferredLineKey && preferredLineKey !== selectedLineKey) {
      setSelectedLineKey(preferredLineKey);
    }
  }, [cart, discountApprovalSecret, lastAddedLineKey, selectedLineKey, setDiscountApprovalSecret, setSelectedLineKey]);

  useEffect(() => {
    if (!lastAddedLineKey || typeof window === 'undefined') return;
    const timer = window.setTimeout(() => setLastAddedLineKey(''), 1400);
    return () => window.clearTimeout(timer);
  }, [lastAddedLineKey, setLastAddedLineKey]);
}
