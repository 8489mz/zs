import { useState, useRef, useCallback } from 'react';
import { loadPosWorkspaceStorage } from '@/features/pos/lib/pos.persistence';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import type { Sale } from '@/types/domain';
import type { PaymentChannel, PaymentType, PosProductFilter } from '@/features/pos/hooks/usePosWorkspace';

export function usePosWorkspaceState() {
  // Reading and parsing the draft is synchronous. Do it once on mount, not on every
  // keystroke or cart update that re-renders the cashier workspace.
  const [persistedState] = useState(() => loadPosWorkspaceStorage());
  const storedDraft = persistedState.draft;

  const [search, setSearch] = useState(storedDraft?.search || '');
  const [customerId, setCustomerId] = useState(storedDraft?.customerId || '');
  const [discount, setDiscount] = useState(Number(storedDraft?.discount || 0));
  const [tipAmount, setTipAmount] = useState<number>(Number((storedDraft as any)?.tipAmount || 0));
  const [loyaltyPointsRedeemed, setLoyaltyPointsRedeemed] = useState<number>(Number((storedDraft as any)?.loyaltyPointsRedeemed || 0));
  const [deliveryFee, setDeliveryFee] = useState(Number((storedDraft as any)?.deliveryFee || 0));
  const [cashAmount, setCashAmount] = useState(Number(storedDraft?.cashAmount ?? (storedDraft?.paymentChannel === 'cash' ? storedDraft?.paidAmount || 0 : 0)));
  const [tenderedAmount, setTenderedAmount] = useState<number>(0);
  const [cardAmount, setCardAmount] = useState(Number(storedDraft?.cardAmount ?? (storedDraft?.paymentChannel === 'card' ? storedDraft?.paidAmount || 0 : 0)));
  const [transferAmount, setTransferAmount] = useState(
    Number(
      storedDraft?.transferAmount
      ?? ((storedDraft?.paymentChannel === 'wallet' || storedDraft?.paymentChannel === 'instapay')
        ? storedDraft?.paidAmount || 0
        : 0),
    ),
  );
  const [paymentType, setPaymentType] = useState<PaymentType>(storedDraft?.paymentType || 'cash');
  const [paymentChannel, setPaymentChannel] = useState<PaymentChannel>(storedDraft?.paymentChannel || 'cash');
  const [note, setNote] = useState(storedDraft?.note || '');
  const [tableNumber, setTableNumber] = useState(storedDraft?.tableNumber || '');
  const [pagerNumber, setPagerNumber] = useState((storedDraft as any)?.pagerNumber || '');
  const [diningCourse, setDiningCourse] = useState<'appetizer' | 'main' | 'dessert' | 'beverage' | string>(
    (storedDraft as any)?.diningCourse || 'main'
  );
  const [guestCount, setGuestCount] = useState<number>(Number((storedDraft as any)?.guestCount || 1));
  const [guestCheckPrintedAt, setGuestCheckPrintedAt] = useState<string | null>(
    (storedDraft as any)?.guestCheckPrintedAt || null
  );
  const [deliveryRepId, setDeliveryRepId] = useState(storedDraft?.deliveryRepId || '');
  // INV-REST-COD-DELIVERY-ONLY (T13-N1): the 'cod' default applies
  // to deliveries only — a takeaway/dine-in workspace must not start
  // life as COD. An unstated status is '' (the same unstated
  // sentinel the submit path already treats as "no status").
  const [collectionStatus, setCollectionStatus] = useState(
    storedDraft?.collectionStatus || (storedDraft?.orderType === 'delivery' ? 'cod' : ''),
  );
  const [deliveryFeeMode, setDeliveryFeeMode] = useState<'freelance_courier' | 'store_fleet'>((storedDraft as any)?.deliveryFeeMode || 'freelance_courier');
  const [orderType, setOrderType] = useState(storedDraft?.orderType || 'takeaway');
  const [cart, setCart] = useState<PosItem[]>(storedDraft?.cart || []);
  const [selectedLineKey, setSelectedLineKey] = useState((storedDraft?.cart || [])[0]?.lineKey || '');
  const [priceType, setPriceType] = useState<PosPriceType>(storedDraft?.priceType || 'retail');
  const [productFilter, setProductFilter] = useState<PosProductFilter>('all');
  const [submitMessage, setSubmitMessage] = useState('');
  const [recentProductIds, setRecentProductIds] = useState<string[]>(persistedState.recentProductIds);
  const [quickCustomerName, setQuickCustomerName] = useState(
    storedDraft?.quickCustomerName || storedDraft?.customerName || ''
  );
  const [quickCustomerPhone, setQuickCustomerPhone] = useState(
    storedDraft?.quickCustomerPhone || storedDraft?.customerPhone || ''
  );
  const [quickCustomerAddress, setQuickCustomerAddress] = useState(
    storedDraft?.quickCustomerAddress || storedDraft?.customerAddress || ''
  );
  const [lastSale, setLastSale] = useState<Sale | null>(persistedState.lastSale);
  const [quickAddCode, setQuickAddCode] = useState('');
  const [scannerMessage, setScannerMessage] = useState('');
  const [lastAddedLineKey, setLastAddedLineKey] = useState('');
  const [postSaleSaleKey, setPostSaleSaleKey] = useState('');
  const [barcodeFocusTick, setBarcodeFocusTick] = useState(0);
  const barcodeFocusListenersRef = useRef<Set<() => void>>(new Set());
  const registerBarcodeFocusListener = useCallback((listener: () => void) => {
    barcodeFocusListenersRef.current.add(listener);
    return () => {
      barcodeFocusListenersRef.current.delete(listener);
    };
  }, []);

  const requestBarcodeFocus = useCallback(() => {
    if (barcodeFocusListenersRef.current.size > 0) {
      for (const listener of barcodeFocusListenersRef.current) {
        listener();
      }
    } else {
      setBarcodeFocusTick((current) => current + 1);
    }
  }, []);
  const [discountApprovalGranted, setDiscountApprovalGranted] = useState(false);
  const [discountApprovalSecret, setDiscountApprovalSecret] = useState('');
  const [wholesaleApprovalGranted, setWholesaleApprovalGranted] = useState(false);
  const [wholesaleApprovalSecret, setWholesaleApprovalSecret] = useState('');
  const [terminalPaymentDetails, setTerminalPaymentDetails] = useState<{
    terminalId?: string;
    authCode?: string;
    // INV-REST-PAID-GATES-2 (R4-D, I40): the amount the terminal
    // approved, recorded at every approval site so the submit gate
    // and the server can pin the card leg to it.
    approvedAmount?: number;
    rrn?: string;
    cardScheme?: string;
    cardLastFour?: string;
    provider?: string;
  } | null>(null);

  return {
    persistedState,
    search,
    setSearch,
    customerId,
    setCustomerId,
    discount,
    setDiscount,
    tipAmount,
    setTipAmount,
    loyaltyPointsRedeemed,
    setLoyaltyPointsRedeemed,
    deliveryFee,
    setDeliveryFee,
    cashAmount,
    setCashAmount,
    tenderedAmount,
    setTenderedAmount,
    cardAmount,
    setCardAmount,
    transferAmount,
    setTransferAmount,
    paymentType,
    setPaymentType,
    paymentChannel,
    setPaymentChannel,
    note,
    setNote,
    tableNumber,
    setTableNumber,
    pagerNumber,
    setPagerNumber,
    diningCourse,
    setDiningCourse,
    guestCount,
    setGuestCount,
    guestCheckPrintedAt,
    setGuestCheckPrintedAt,
    orderType,
    setOrderType,
    deliveryRepId,
    setDeliveryRepId,
    collectionStatus,
    setCollectionStatus,
    deliveryFeeMode,
    setDeliveryFeeMode,
    cart,
    setCart,
    selectedLineKey,
    setSelectedLineKey,
    priceType,
    setPriceType,
    productFilter,
    setProductFilter,
    submitMessage,
    setSubmitMessage,
    recentProductIds,
    setRecentProductIds,
    quickCustomerName,
    setQuickCustomerName,
    quickCustomerPhone,
    setQuickCustomerPhone,
    quickCustomerAddress,
    setQuickCustomerAddress,
    lastSale,
    setLastSale,
    quickAddCode,
    setQuickAddCode,
    scannerMessage,
    setScannerMessage,
    lastAddedLineKey,
    setLastAddedLineKey,
    postSaleSaleKey,
    setPostSaleSaleKey,
    barcodeFocusTick,
    discountApprovalGranted,
    setDiscountApprovalGranted,
    discountApprovalSecret,
    setDiscountApprovalSecret,
    wholesaleApprovalGranted,
    setWholesaleApprovalGranted,
    wholesaleApprovalSecret,
    setWholesaleApprovalSecret,
    terminalPaymentDetails,
    setTerminalPaymentDetails,
    registerBarcodeFocusListener,
    requestBarcodeFocus,
  };
}
