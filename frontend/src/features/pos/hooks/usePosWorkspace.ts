import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { posApi } from '@/features/pos/api/pos.api';
import { usePosCatalog } from '@/features/pos/hooks/usePosCatalog';
import { usePosCatalogWarmup } from '@/features/pos/hooks/usePosCatalogWarmup';
import { usePosSaleMutation } from '@/features/pos/hooks/usePosSaleMutation';
import { createPosWorkspaceActions } from '@/features/pos/hooks/usePosWorkspaceActions';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';
import { usePosWorkspaceDerived } from '@/features/pos/hooks/usePosWorkspaceDerived';
import { usePosWorkspaceEffects } from '@/features/pos/hooks/usePosWorkspaceEffects';
import { usePosWorkspaceMutations } from '@/features/pos/hooks/usePosWorkspaceMutations';
import { usePosWorkspaceState } from '@/features/pos/hooks/usePosWorkspaceState';
import { usePosOperationalContext } from '@/features/pos/hooks/usePosOperationalContext';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import { usePosCustomerDisplayBroadcaster } from '@/features/pos/hooks/usePosCustomerDisplayBroadcaster';
import { useAuthStore } from '@/stores/auth-store';
import { loadPosWorkspaceStorage } from '@/features/pos/lib/pos.persistence';
import { RECALLED_BRANCH_EVENT, clearRecalledBranchLocation, readRecalledBranchLocation } from '@/features/pos/lib/pos-held-snapshot';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits } from '@/shared/utils/money';
import { computePaidAmount } from '@/features/pos/lib/pos-paid-amount';

const posReferenceStaleTime = 45_000;

export type PaymentType = 'cash' | 'credit';
export type PaymentChannel = 'cash' | 'card' | 'wallet' | 'instapay' | 'credit' | 'mixed';
export type PosProductFilter = 'all' | 'offers' | 'priced' | 'low' | 'recent' | 'raw_materials' | 'services';

export interface PosDraftSnapshot {
  /* INV-REST-HOLD-RECALL-TRUTH (R5-B): one versioned snapshot shape for
   * the server held draft, the localStorage live draft and the in-memory
   * state. buildHeldSnapshot / buildDraftState / mapHeldSalesRows map the
   * same field list; the spec asserts they stay in sync. */
  snapshotVersion?: number;
  cart: PosItem[];
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  quickCustomerName?: string;
  quickCustomerPhone?: string;
  quickCustomerAddress?: string;
  discount: number;
  deliveryFee: number;
  tipAmount?: number;
  loyaltyPointsRedeemed?: number;
  pagerNumber?: string;
  deliveryFeeMode?: 'freelance_courier' | 'store_fleet' | string;
  paidAmount: number;
  cashAmount: number;
  cardAmount: number;
  transferAmount: number;
  paymentType: PaymentType;
  paymentChannel: PaymentChannel;
  note: string;
  search: string;
  priceType: PosPriceType;
  branchId: string;
  locationId: string;
  tableNumber: string;
  diningCourse?: string;
  guestCount?: number;
  guestCheckPrintedAt?: string | null;
  orderType: string;
  deliveryRepId?: string;
  collectionStatus?: string;
  onlineOrderId?: number;
}

export interface HeldPosDraft extends PosDraftSnapshot {
  id: string;
  savedAt: string;
}

function getSaleKey(sale: { docNo?: string | number; id?: string | number } | null) {
  return String(sale?.docNo || sale?.id || '');
}

/* T14-A (INV-REST-WORKSPACE-EXTRAS-LIVE-RESET, NEW (b)): the
 * delivery-extras switch for an order-type change, as a pure
 * function so the base-actions spec can pin it without rendering
 * the whole workspace hook. Leaving delivery clears the delivery
 * fee, the courier and the collection status REGARDLESS of where
 * the fee came from — the old inline code cleared the fee only
 * when it equalled the settings defaultDeliveryFee, so a zone-set
 * fee (15.00 from "توصيل عادي 15") survived a switch to takeaway
 * and the COD summary box stayed. The collection status resets to
 * '' — the same unstated sentinel resetPosDraftState and
 * usePosWorkspaceState use for a non-delivery workspace (never
 * 'cod': a takeaway has nothing to collect). Entering delivery
 * still applies the settings default fee/mode when none is set. */
export function applyPosOrderTypeChange(
  current: string,
  resolved: string,
  settings: { defaultDeliveryFee?: number | string; deliveryFeeMode?: string } | null | undefined,
  deliveryFee: number,
  setters: {
    setDeliveryFee: (fee: number) => void;
    setDeliveryFeeMode: (mode: 'freelance_courier' | 'store_fleet') => void;
    setDeliveryRepId: (id: string) => void;
    setCollectionStatus: (status: string) => void;
  },
): void {
  const defaultDeliveryFee = Number((settings as any)?.defaultDeliveryFee || 0);
  const defaultMode = (settings as any)?.deliveryFeeMode;
  if (resolved === 'delivery') {
    if (defaultDeliveryFee > 0 && (!deliveryFee || deliveryFee === 0)) {
      setters.setDeliveryFee(defaultDeliveryFee);
    }
    if (defaultMode === 'store_fleet' || defaultMode === 'freelance_courier') {
      setters.setDeliveryFeeMode(defaultMode);
    }
  } else if (current === 'delivery' && (resolved === 'takeaway' || resolved === 'dine_in')) {
    setters.setDeliveryFee(0);
    setters.setDeliveryRepId('');
    setters.setCollectionStatus('');
  }
}

export function usePosWorkspace() {
  const state = usePosWorkspaceState();
  const customersQuery = useQuery({ queryKey: queryKeys.posCustomers, queryFn: () => posApi.customers({ limit: 50 }), staleTime: posReferenceStaleTime });
  const settingsQuery = useQuery({ queryKey: queryKeys.posSettings, queryFn: posApi.settings, staleTime: posReferenceStaleTime });
  const branchesQuery = useQuery({ queryKey: queryKeys.posBranches, queryFn: posApi.branches, staleTime: posReferenceStaleTime });
  const locationsQuery = useQuery({ queryKey: queryKeys.posLocations, queryFn: posApi.locations, staleTime: posReferenceStaleTime });

  // INV-FE1-FRONTEND-BOOK-DIGITS: paidAmount rounds at the tenant's
  // book digits (settings currency, global system currency fallback).
  // INV-REST-PAID-DEFINITION: paid is the all-legs sum (cash + card +
  // transfer) from computePaidAmount — never channel-dependent — so the
  // display, the submit gate and the posted payload all agree.
  const currencyDecimals = currencyMoneyDigits(settingsQuery.data?.currency || getGlobalSystemCurrency());
  const paidAmount = computePaidAmount(
    { cashAmount: state.cashAmount, cardAmount: state.cardAmount, transferAmount: state.transferAmount },
    currencyDecimals,
  );

  const operationalContext = usePosOperationalContext({
    settings: settingsQuery.data || null,
    branches: branchesQuery.data || [],
    locations: locationsQuery.data || [],
  });

  // INV-REST-FNB-TRUTH-2 (R-I11): the 86 list for this branch, on the
  // SAME query key the POS header fetches (['pos-86-items-header',
  // branchId]) so the workspace shares the header's cached rows
  // instead of fetching twice. handleAddProduct refuses an 86'd add
  // with a named message; the server still rejects the line at
  // submit, so a stale list can never sell an 86'd item.
  const isRestaurantActive = (settingsQuery.data as any)?.restaurantModuleEnabled === true;
  const { data: items86 = [] } = useQuery({
    queryKey: ['pos-86-items-header', operationalContext.branchId],
    queryFn: () => restaurantAdvancedFnbApi.get86Items(operationalContext.branchId ? Number(operationalContext.branchId) : undefined),
    enabled: isRestaurantActive,
    staleTime: 60_000,
    refetchInterval: 15_000,
  });

  /* M32 (R5-B): branch/location are derived from settings and have no
   * setter, so a recalled draft's branch/location rides as an override
   * here. recallDraft writes it (storage + event); it clears when the
   * cart empties (hold / submit / manual clear). On mount it is seeded
   * from the stored live draft when that draft still has a cart, so a
   * refresh mid-recall keeps the branch. */
  const [recalledBranchId, setRecalledBranchId] = useState<string>(() => {
    try {
      const stored = loadPosWorkspaceStorage().draft;
      const recalled = readRecalledBranchLocation();
      if (recalled.branchId) return recalled.branchId;
      return stored && (stored.cart || []).length > 0 ? String(stored.branchId || '') : '';
    } catch {
      return '';
    }
  });
  const [recalledLocationId, setRecalledLocationId] = useState<string>(() => {
    try {
      const stored = loadPosWorkspaceStorage().draft;
      const recalled = readRecalledBranchLocation();
      if (recalled.locationId) return recalled.locationId;
      return stored && (stored.cart || []).length > 0 ? String(stored.locationId || '') : '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    const handleRecalledBranch = (event: Event) => {
      const detail = (event as CustomEvent<{ branchId: string; locationId: string }>).detail || { branchId: '', locationId: '' };
      setRecalledBranchId(String(detail.branchId || ''));
      setRecalledLocationId(String(detail.locationId || ''));
    };
    window.addEventListener(RECALLED_BRANCH_EVENT, handleRecalledBranch);
    return () => window.removeEventListener(RECALLED_BRANCH_EVENT, handleRecalledBranch);
  }, []);
  useEffect(() => {
    if (state.cart.length === 0 && (recalledBranchId || recalledLocationId)) {
      clearRecalledBranchLocation();
      setRecalledBranchId('');
      setRecalledLocationId('');
    }
  }, [state.cart.length, recalledBranchId, recalledLocationId]);
  const effectiveBranchId = recalledBranchId || operationalContext.branchId;
  const effectiveLocationId = recalledLocationId || operationalContext.locationId;

  const catalogWarmup = usePosCatalogWarmup({
    branchId: effectiveBranchId,
    locationId: effectiveLocationId,
  });

  // INV-POS-CATEGORY-TILE-FILTER: the selected category is workspace state,
  // not panel-local state — it drives the server-side catalog lookup, so a
  // tile returns the category's products instead of filtering the bounded
  // browse window (first 300 by name) client-side.
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const { saleProducts, catalogProducts, productsQuery } = usePosCatalog(state.search, effectiveBranchId, effectiveLocationId, state.productFilter, selectedCategoryId);

  const createSale = usePosSaleMutation();
  const queryClient = useQueryClient();
  const authUser = useAuthStore((entry) => entry.user);
  const mutations = usePosWorkspaceMutations({ queryClient, storedHeld: state.persistedState.heldDrafts });

  const heldDrafts = mutations.heldDraftsQuery.data || [];
  const openShiftRows = mutations.openShiftsQuery.data?.rows || [];

  const derived = usePosWorkspaceDerived({
    saleProducts,
    products: catalogProducts,
    customers: customersQuery.data || [],
    branches: branchesQuery.data || [],
    locations: locationsQuery.data || [],
    openShiftRows,
    authUserId: authUser?.id,
    authPermissions: authUser?.permissions || [],
    settings: settingsQuery.data || null,
    heldDrafts,
    recentProductIds: state.recentProductIds,
    productFilter: state.productFilter,
    cart: state.cart,
    discount: state.discount,
    loyaltyPointsRedeemed: state.loyaltyPointsRedeemed,
    deliveryFee: state.deliveryFee,
    tipAmount: state.tipAmount,
    discountApprovalGranted: state.discountApprovalGranted,
    wholesaleApprovalGranted: state.wholesaleApprovalGranted,
    paidAmount,
    cashAmount: state.cashAmount,
    cardAmount: state.cardAmount,
    transferAmount: state.transferAmount,
    paymentType: state.paymentType,
    paymentChannel: state.paymentChannel,
    customerId: state.customerId,
    branchId: effectiveBranchId,
    locationId: effectiveLocationId,
    tableNumber: state.tableNumber,
    search: state.search,
    lastSale: state.lastSale,
    orderType: state.orderType,
    deliveryRepId: state.deliveryRepId,
    collectionStatus: state.collectionStatus,
  });

  usePosWorkspaceEffects({
    cart: state.cart,
    customerId: state.customerId,
    discount: state.discount,
    paidAmount,
    total: derived.totals.total,
    cashAmount: state.cashAmount,
    setCashAmount: state.setCashAmount,
    cardAmount: state.cardAmount,
    setCardAmount: state.setCardAmount,
    transferAmount: state.transferAmount,
    setTransferAmount: state.setTransferAmount,
    paymentType: state.paymentType,
    paymentChannel: state.paymentChannel,
    setPaymentChannel: state.setPaymentChannel,
    note: state.note,
    search: state.search,
    priceType: state.priceType,
    tableNumber: state.tableNumber,
    guestCount: state.guestCount,
    guestCheckPrintedAt: state.guestCheckPrintedAt,
    orderType: state.orderType,
    deliveryFee: state.deliveryFee,
    deliveryRepId: state.deliveryRepId,
    collectionStatus: state.collectionStatus,
    tipAmount: state.tipAmount,
    loyaltyPointsRedeemed: state.loyaltyPointsRedeemed,
    pagerNumber: state.pagerNumber,
    diningCourse: state.diningCourse,
    deliveryFeeMode: state.deliveryFeeMode,
    branchId: effectiveBranchId,
    locationId: effectiveLocationId,
    quickCustomerName: state.quickCustomerName,
    quickCustomerPhone: state.quickCustomerPhone,
    quickCustomerAddress: state.quickCustomerAddress,
    products: catalogProducts,
    setCart: state.setCart,
    submitMessage: state.submitMessage,
    setSubmitMessage: state.setSubmitMessage,
    scannerMessage: state.scannerMessage,
    setScannerMessage: state.setScannerMessage,
    ownOpenShift: derived.ownOpenShift,
    recentProductIds: state.recentProductIds,
    lastSale: state.lastSale,
    lastAddedLineKey: state.lastAddedLineKey,
    setLastAddedLineKey: state.setLastAddedLineKey,
    selectedLineKey: state.selectedLineKey,
    setSelectedLineKey: state.setSelectedLineKey,
    discountApprovalSecret: state.discountApprovalSecret,
    setDiscountApprovalSecret: state.setDiscountApprovalSecret,
    settings: settingsQuery.data || null,
  });

  const authStoreName = useAuthStore((entry) => entry.storeName);

  const activeCustomer = (customersQuery.data || []).find((c) => String(c.id) === String(state.customerId));
  const activeCustomerInfo = activeCustomer ? {
    name: activeCustomer.name,
    phone: (activeCustomer as any).phone,
    loyaltyPoints: (activeCustomer as any).loyaltyPoints,
  } : (state.quickCustomerName ? {
    name: state.quickCustomerName,
    phone: state.quickCustomerPhone,
    loyaltyPoints: 0,
  } : null);

  usePosCustomerDisplayBroadcaster({
    cart: state.cart,
    totals: derived.totals,
    customer: activeCustomerInfo,
    paymentType: state.paymentType,
    paymentChannel: state.paymentChannel,
    paidAmount,
    changeAmount: derived.changeAmount,
    digits: currencyDecimals,
    lastSale: state.lastSale,
    postSaleSaleKey: state.postSaleSaleKey,
    storeName: authStoreName || (settingsQuery.data as any)?.storeName,
    branchName: derived.currentBranch?.name,
  });

  const handleSetOrderType = useCallback((next: string | ((current: string) => string)) => {
    state.setOrderType((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      applyPosOrderTypeChange(current, resolved, settingsQuery.data as any, state.deliveryFee, {
        setDeliveryFee: state.setDeliveryFee,
        setDeliveryFeeMode: state.setDeliveryFeeMode,
        setDeliveryRepId: state.setDeliveryRepId,
        setCollectionStatus: state.setCollectionStatus,
      });
      return resolved;
    });
  }, [settingsQuery.data, state.deliveryFee, state.setDeliveryFee, state.setDeliveryFeeMode, state.setDeliveryRepId, state.setCollectionStatus, state.setOrderType]);

  useEffect(() => {
    const defaultMode = (settingsQuery.data as any)?.deliveryFeeMode;
    if (defaultMode === 'store_fleet' || defaultMode === 'freelance_courier') {
      state.setDeliveryFeeMode(defaultMode);
    }
  }, [settingsQuery.data?.deliveryFeeMode, state.setDeliveryFeeMode]);

  useEffect(() => {
    const defaultDeliveryFee = Number((settingsQuery.data as any)?.defaultDeliveryFee || 0);
    if (state.orderType === 'delivery' && defaultDeliveryFee > 0 && (!state.deliveryFee || state.deliveryFee === 0)) {
      state.setDeliveryFee(defaultDeliveryFee);
    }
  }, [settingsQuery.data?.defaultDeliveryFee, state.orderType, state.deliveryFee, state.setDeliveryFee]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleReloadDraft = () => {
      const storage = loadPosWorkspaceStorage();
      const nextDraft = storage.draft;
      if (!nextDraft) return;
      state.setCart(nextDraft.cart || []);
      state.setCustomerId(nextDraft.customerId || '');
      state.setQuickCustomerName(nextDraft.quickCustomerName || nextDraft.customerName || '');
      state.setQuickCustomerPhone(nextDraft.quickCustomerPhone || nextDraft.customerPhone || '');
      state.setQuickCustomerAddress(nextDraft.quickCustomerAddress || nextDraft.customerAddress || '');
      state.setDiscount(Number(nextDraft.discount || 0));
      state.setDeliveryFee(Number(nextDraft.deliveryFee || 0));
      state.setTableNumber(nextDraft.tableNumber || '');
      state.setPagerNumber((nextDraft as any).pagerNumber || '');
      state.setOrderType(nextDraft.orderType || 'takeaway');
      state.setNote(nextDraft.note || '');
      /* INV-REST-HOLD-RECALL-TRUTH (R5-B): the handler existed but
       * restored 0 / '' for these — the autosave never persisted them.
       * Now that buildDraftState maps them, restore them too. */
      state.setTipAmount(Number((nextDraft as any).tipAmount || 0));
      state.setLoyaltyPointsRedeemed(Number((nextDraft as any).loyaltyPointsRedeemed || 0));
      state.setDeliveryRepId(nextDraft.deliveryRepId || '');
      state.setCollectionStatus(nextDraft.collectionStatus || 'cod');
      state.setDiningCourse((nextDraft as any).diningCourse || 'main');
      state.setGuestCount(Number((nextDraft as any).guestCount || 1));
      state.setGuestCheckPrintedAt((nextDraft as any).guestCheckPrintedAt || null);
      if ((nextDraft as any).deliveryFeeMode) {
        state.setDeliveryFeeMode((nextDraft as any).deliveryFeeMode);
      }
      state.setSubmitMessage('تم استلام ودمج طلب المتجر في سلة الكاشير بنجاح');
    };
    window.addEventListener('zs_pos_reload_draft', handleReloadDraft);
    return () => window.removeEventListener('zs_pos_reload_draft', handleReloadDraft);
  }, [state]);

  const actions = createPosWorkspaceActions({
    cart: state.cart,
    setCart: state.setCart,
    selectedLineKey: state.selectedLineKey,
    setSelectedLineKey: state.setSelectedLineKey,
    customerId: state.customerId,
    setCustomerId: state.setCustomerId,
    discount: state.discount,
    setDiscount: state.setDiscount,
    tipAmount: state.tipAmount,
    setTipAmount: state.setTipAmount,
    loyaltyPointsRedeemed: state.loyaltyPointsRedeemed,
    setLoyaltyPointsRedeemed: state.setLoyaltyPointsRedeemed,
    deliveryFee: state.deliveryFee,
    setDeliveryFee: state.setDeliveryFee,
    discountApprovalGranted: state.discountApprovalGranted,
    setDiscountApprovalGranted: state.setDiscountApprovalGranted,
    discountApprovalSecret: state.discountApprovalSecret,
    setDiscountApprovalSecret: state.setDiscountApprovalSecret,
    wholesaleApprovalGranted: state.wholesaleApprovalGranted,
    setWholesaleApprovalGranted: state.setWholesaleApprovalGranted,
    wholesaleApprovalSecret: state.wholesaleApprovalSecret,
    setWholesaleApprovalSecret: state.setWholesaleApprovalSecret,
    terminalPaymentDetails: state.terminalPaymentDetails,
    setTerminalPaymentDetails: state.setTerminalPaymentDetails,
    cashAmount: state.cashAmount,
    setCashAmount: state.setCashAmount,
    tenderedAmount: state.tenderedAmount,
    setTenderedAmount: state.setTenderedAmount,
    cardAmount: state.cardAmount,
    setCardAmount: state.setCardAmount,
    transferAmount: state.transferAmount,
    setTransferAmount: state.setTransferAmount,
    paymentType: state.paymentType,
    setPaymentType: state.setPaymentType,
    paymentChannel: state.paymentChannel,
    setPaymentChannel: state.setPaymentChannel,
    note: state.note,
    setNote: state.setNote,
    search: state.search,
    setSearch: state.setSearch,
    priceType: state.priceType,
    setPriceType: state.setPriceType,
    branchId: effectiveBranchId,
    locationId: effectiveLocationId,
    tableNumber: state.tableNumber,
    setTableNumber: state.setTableNumber,
    pagerNumber: state.pagerNumber,
    setPagerNumber: state.setPagerNumber,
    diningCourse: state.diningCourse,
    setDiningCourse: state.setDiningCourse,
    guestCount: state.guestCount,
    setGuestCount: state.setGuestCount,
    guestCheckPrintedAt: state.guestCheckPrintedAt,
    setGuestCheckPrintedAt: state.setGuestCheckPrintedAt,
    orderType: state.orderType,
    setOrderType: handleSetOrderType,
    deliveryFeeMode: state.deliveryFeeMode,
    setDeliveryFeeMode: state.setDeliveryFeeMode,
    deliveryRepId: state.deliveryRepId,
    setDeliveryRepId: state.setDeliveryRepId,
    collectionStatus: state.collectionStatus,
    setCollectionStatus: state.setCollectionStatus,
    quickAddCode: state.quickAddCode,
    setQuickAddCode: state.setQuickAddCode,
    quickCustomerName: state.quickCustomerName,
    setQuickCustomerName: state.setQuickCustomerName,
    quickCustomerPhone: state.quickCustomerPhone,
    setQuickCustomerPhone: state.setQuickCustomerPhone,
    quickCustomerAddress: state.quickCustomerAddress,
    setQuickCustomerAddress: state.setQuickCustomerAddress,
    scannerMessage: state.scannerMessage,
    setScannerMessage: state.setScannerMessage,
    setSubmitMessage: state.setSubmitMessage,
    lastAddedLineKey: state.lastAddedLineKey,
    setLastAddedLineKey: state.setLastAddedLineKey,
    setRecentProductIds: state.setRecentProductIds,
    setLastSale: state.setLastSale,
    postSaleSaleKey: state.postSaleSaleKey,
    setPostSaleSaleKey: state.setPostSaleSaleKey,
    requestBarcodeFocus: state.requestBarcodeFocus,
    lastSale: state.lastSale,
    products: catalogProducts,
    branches: branchesQuery.data || [],
    locations: locationsQuery.data || [],
    currentBranch: derived.currentBranch,
    currentLocation: derived.currentLocation,
    settings: settingsQuery.data || null,
    totals: derived.totals,
    paidAmount,
    hasOperationalSetup: derived.hasOperationalSetup,
    hasCatalogReady: derived.hasCatalogReady,
    requiresCashierShift: derived.requiresCashierShift,
    ownOpenShift: derived.ownOpenShift,
    hasCreditWithoutCustomer: derived.hasCreditWithoutCustomer,
    hasZeroPriceLine: derived.hasZeroPriceLine,
    hasUnderpaidSale: derived.hasUnderpaidSale,
    canSubmitSale: derived.canSubmitSale,
    canSubmitHint: derived.canSubmitHint,
    heldDrafts,
    quickCustomerMutation: mutations.quickCustomerMutation,
    createSale,
    saveHeldDraftMutation: mutations.saveHeldDraftMutation,
    deleteHeldDraftMutation: mutations.deleteHeldDraftMutation,
    clearHeldDraftsMutation: mutations.clearHeldDraftsMutation,
    discountAuthorizationMutation: mutations.discountAuthorizationMutation,
  });

  async function refetchCatalogs() {
    await Promise.all([
      productsQuery.refetch(),
      customersQuery.refetch(),
      branchesQuery.refetch(),
      locationsQuery.refetch(),
      settingsQuery.refetch(),
      mutations.openShiftsQuery.refetch(),
    ]);
  }

  const isLoading =
    customersQuery.isLoading ||
    settingsQuery.isLoading ||
    branchesQuery.isLoading ||
    locationsQuery.isLoading ||
    productsQuery.isLoading ||
    productsQuery.isFetching ||
    mutations.openShiftsQuery.isLoading ||
    mutations.openShiftsQuery.isFetching;

  return {
    isLoading,
    search: state.search,
    setSearch: state.setSearch,
    customerId: state.customerId,
    setCustomerId: state.setCustomerId,
    discount: state.discount,
    setDiscount: state.setDiscount,
    tipAmount: state.tipAmount,
    setTipAmount: state.setTipAmount,
    loyaltyPointsRedeemed: state.loyaltyPointsRedeemed,
    setLoyaltyPointsRedeemed: state.setLoyaltyPointsRedeemed,
    deliveryFee: state.deliveryFee,
    setDeliveryFee: state.setDeliveryFee,
    discountApprovalGranted: state.discountApprovalGranted,
    setDiscountApprovalGranted: state.setDiscountApprovalGranted,
    discountApprovalSecret: state.discountApprovalSecret,
    setDiscountApprovalSecret: state.setDiscountApprovalSecret,
    wholesaleApprovalGranted: state.wholesaleApprovalGranted,
    setWholesaleApprovalGranted: state.setWholesaleApprovalGranted,
    wholesaleApprovalSecret: state.wholesaleApprovalSecret,
    setWholesaleApprovalSecret: state.setWholesaleApprovalSecret,
    terminalPaymentDetails: state.terminalPaymentDetails,
    setTerminalPaymentDetails: state.setTerminalPaymentDetails,
    paidAmount,
    cashAmount: state.cashAmount,
    setCashAmount: state.setCashAmount,
    tenderedAmount: state.tenderedAmount,
    setTenderedAmount: state.setTenderedAmount,
    cardAmount: state.cardAmount,
    setCardAmount: state.setCardAmount,
    transferAmount: state.transferAmount,
    setTransferAmount: state.setTransferAmount,
    paymentType: state.paymentType,
    setPaymentType: state.setPaymentType,
    paymentChannel: state.paymentChannel,
    setPaymentChannel: state.setPaymentChannel,
    note: state.note,
    setNote: state.setNote,
    tableNumber: state.tableNumber,
    setTableNumber: state.setTableNumber,
    pagerNumber: state.pagerNumber,
    setPagerNumber: state.setPagerNumber,
    diningCourse: state.diningCourse,
    setDiningCourse: state.setDiningCourse,
    guestCount: state.guestCount,
    setGuestCount: state.setGuestCount,
    guestCheckPrintedAt: state.guestCheckPrintedAt,
    setGuestCheckPrintedAt: state.setGuestCheckPrintedAt,
    orderType: state.orderType,
    setOrderType: handleSetOrderType,
    deliveryFeeMode: state.deliveryFeeMode,
    setDeliveryFeeMode: state.setDeliveryFeeMode,
    deliveryRepId: state.deliveryRepId,
    setDeliveryRepId: state.setDeliveryRepId,
    collectionStatus: state.collectionStatus,
    setCollectionStatus: state.setCollectionStatus,
    cart: state.cart,
    setCart: state.setCart,
    selectedLineKey: state.selectedLineKey,
    setSelectedLineKey: state.setSelectedLineKey,
    priceType: state.priceType,
    branchId: effectiveBranchId,
    locationId: effectiveLocationId,
    eightySixedProductIds: items86.map((item) => item.product_id),
    productFilter: state.productFilter,
    setProductFilter: state.setProductFilter,
    selectedCategoryId,
    setSelectedCategoryId,
    submitMessage: state.submitMessage,
    canShowLastSaleActions: Boolean(
      state.cart.length === 0
      && state.postSaleSaleKey
      && state.lastSale
      && getSaleKey(state.lastSale) === state.postSaleSaleKey
      && state.submitMessage
      && !createSale.isError
    ),
    setSubmitMessage: state.setSubmitMessage,
    heldDrafts,
    recentProductIds: state.recentProductIds,
    quickCustomerName: state.quickCustomerName,
    setQuickCustomerName: state.setQuickCustomerName,
    quickCustomerPhone: state.quickCustomerPhone,
    setQuickCustomerPhone: state.setQuickCustomerPhone,
    quickCustomerAddress: state.quickCustomerAddress,
    setQuickCustomerAddress: state.setQuickCustomerAddress,
    lastSale: state.lastSale,
    quickAddCode: state.quickAddCode,
    setQuickAddCode: state.setQuickAddCode,
    scannerMessage: state.scannerMessage,
    setScannerMessage: state.setScannerMessage,
    lastAddedLineKey: state.lastAddedLineKey,
    setLastAddedLineKey: state.setLastAddedLineKey,
    barcodeFocusTick: state.barcodeFocusTick,
    registerBarcodeFocusListener: state.registerBarcodeFocusListener,
    customersQuery,
    settingsQuery,
    settings: settingsQuery.data || null,
    branchesQuery,
    locationsQuery,
    productsQuery,
    saleProducts,
    catalogProducts,
    createSale,
    catalogWarmup,
    quickCustomerMutation: mutations.quickCustomerMutation,
    // INV-REST-SPLIT-REAL-TOTALS (R3-A repair): the split modal calls the
    // held-draft mutation directly per bill, so the hook must expose it.
    // It was only passed into the action creators (for holdDraft) and never
    // returned, so the modal's pos.saveHeldDraftMutation was undefined at
    // runtime as well as a type error.
    saveHeldDraftMutation: mutations.saveHeldDraftMutation,
    discountAuthorizationMutation: mutations.discountAuthorizationMutation,
    refetchCatalogs,
    ...derived,
    ...actions,
  };
}
