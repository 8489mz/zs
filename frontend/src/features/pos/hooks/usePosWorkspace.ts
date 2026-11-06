import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { posApi } from '@/features/pos/api/pos.api';
import { usePosCatalog } from '@/features/pos/hooks/usePosCatalog';
import { usePosCatalogWarmup } from '@/features/pos/hooks/usePosCatalogWarmup';
import { usePosSaleMutation } from '@/features/pos/hooks/usePosSaleMutation';
import { createPosWorkspaceActions } from '@/features/pos/hooks/usePosWorkspaceActions';
import { usePosWorkspaceDerived } from '@/features/pos/hooks/usePosWorkspaceDerived';
import { usePosWorkspaceEffects } from '@/features/pos/hooks/usePosWorkspaceEffects';
import { usePosWorkspaceMutations } from '@/features/pos/hooks/usePosWorkspaceMutations';
import { usePosWorkspaceState } from '@/features/pos/hooks/usePosWorkspaceState';
import { usePosOperationalContext } from '@/features/pos/hooks/usePosOperationalContext';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import { usePosCustomerDisplayBroadcaster } from '@/features/pos/hooks/usePosCustomerDisplayBroadcaster';
import { useAuthStore } from '@/stores/auth-store';
import { loadPosWorkspaceStorage } from '@/features/pos/lib/pos.persistence';
import { getCurrencyDecimals } from '@/lib/currencies';

const posReferenceStaleTime = 45_000;

export type PaymentType = 'cash' | 'credit';
export type PaymentChannel = 'cash' | 'card' | 'wallet' | 'instapay' | 'credit' | 'mixed';
export type PosProductFilter = 'all' | 'offers' | 'priced' | 'low' | 'recent' | 'raw_materials' | 'services';

export interface PosDraftSnapshot {
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

export function usePosWorkspace() {
  const state = usePosWorkspaceState();
  const customersQuery = useQuery({ queryKey: queryKeys.posCustomers, queryFn: () => posApi.customers({ limit: 50 }), staleTime: posReferenceStaleTime });
  const settingsQuery = useQuery({ queryKey: queryKeys.posSettings, queryFn: posApi.settings, staleTime: posReferenceStaleTime });
  const branchesQuery = useQuery({ queryKey: queryKeys.posBranches, queryFn: posApi.branches, staleTime: posReferenceStaleTime });
  const locationsQuery = useQuery({ queryKey: queryKeys.posLocations, queryFn: posApi.locations, staleTime: posReferenceStaleTime });

  const currencyDecimals = getCurrencyDecimals(settingsQuery.data?.currency);
  const paidAmount = Number((
    state.paymentChannel === 'wallet' || state.paymentChannel === 'instapay'
      ? Number(state.cashAmount || 0) + Number(state.transferAmount || 0)
      : Number(state.cashAmount || 0) + Number(state.cardAmount || 0)
  ).toFixed(currencyDecimals));

  const operationalContext = usePosOperationalContext({
    settings: settingsQuery.data || null,
    branches: branchesQuery.data || [],
    locations: locationsQuery.data || [],
  });

  const catalogWarmup = usePosCatalogWarmup({
    branchId: operationalContext.branchId,
    locationId: operationalContext.locationId,
  });

  const { saleProducts, catalogProducts, productsQuery } = usePosCatalog(state.search, operationalContext.branchId, operationalContext.locationId, state.productFilter);

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
    paymentType: state.paymentType,
    paymentChannel: state.paymentChannel,
    customerId: state.customerId,
    branchId: operationalContext.branchId,
    locationId: operationalContext.locationId,
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
    deliveryRepId: state.deliveryRepId,
    collectionStatus: state.collectionStatus,
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
    lastSale: state.lastSale,
    postSaleSaleKey: state.postSaleSaleKey,
    storeName: authStoreName || (settingsQuery.data as any)?.storeName,
    branchName: derived.currentBranch?.name,
  });

  const handleSetOrderType = useCallback((next: string | ((current: string) => string)) => {
    state.setOrderType((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      const defaultDeliveryFee = Number((settingsQuery.data as any)?.defaultDeliveryFee || 0);
      const defaultMode = (settingsQuery.data as any)?.deliveryFeeMode;
      if (resolved === 'delivery') {
        if (defaultDeliveryFee > 0 && (!state.deliveryFee || state.deliveryFee === 0)) {
          state.setDeliveryFee(defaultDeliveryFee);
        }
        if (defaultMode === 'store_fleet' || defaultMode === 'freelance_courier') {
          state.setDeliveryFeeMode(defaultMode);
        }
      } else if (current === 'delivery' && (resolved === 'takeaway' || resolved === 'dine_in')) {
        if (defaultDeliveryFee > 0 && state.deliveryFee === defaultDeliveryFee) {
          state.setDeliveryFee(0);
        }
      }
      return resolved;
    });
  }, [settingsQuery.data, state.deliveryFee, state.setDeliveryFee, state.setDeliveryFeeMode, state.setOrderType]);

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
    branchId: operationalContext.branchId,
    locationId: operationalContext.locationId,
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
    branchId: operationalContext.branchId,
    locationId: operationalContext.locationId,
    productFilter: state.productFilter,
    setProductFilter: state.setProductFilter,
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
    discountAuthorizationMutation: mutations.discountAuthorizationMutation,
    refetchCatalogs,
    ...derived,
    ...actions,
  };
}
