import { useMemo } from 'react';
import { formatCurrency } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { paymentLabel } from '@/features/pos/lib/pos-workspace.helpers';
import { getProductPrice, isNegativeStockSalesAllowed } from '@/features/pos/lib/pos.domain';
import type { PaymentChannel, PaymentType, PosProductFilter } from '@/features/pos/hooks/usePosWorkspace';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import type { Product, Sale } from '@/types/domain';
import { SINGLE_STORE_MODE } from '@/config/product-scope';

interface PosWorkspaceDerivedParams {
  saleProducts: Product[];
  products: Product[];
  search: string;
  customers: Array<{ id: string | number; name: string }>;
  branches: Array<{ id: string | number; name: string }>;
  locations: Array<{ id: string | number; name: string }>;
  openShiftRows: Array<{ id: string | number; docNo?: string; openedById?: string | number; openedByName?: string }>;
  authUserId?: string | number | null;
  authPermissions?: string[];
  settings?: { currency?: string; taxRate?: number | string; taxMode?: string; allowNegativeStockSales?: unknown; allowSellingBelowStock?: unknown; posMaxDiscountThresholdEnabled?: boolean; posMaxDiscountThresholdType?: string; posMaxDiscountThresholdValue?: number; posSmallDiscountFlatAllowance?: number; loyaltyPointRedeemValue?: number; loyaltyPointsPer100Egp?: number; loyaltyMinRedeemPoints?: number; loyaltyMaxDiscountPercentage?: number; loyaltyEnabled?: boolean; restaurantServiceChargeEnabled?: boolean; restaurantServiceChargePercent?: number } | null;
  heldDrafts: Array<unknown>;
  recentProductIds: string[];
  productFilter: PosProductFilter;
  cart: PosItem[];
  discount: number;
  loyaltyPointsRedeemed?: number;
  deliveryFee: number;
  tipAmount?: number;
  discountApprovalGranted?: boolean;
  wholesaleApprovalGranted?: boolean;
  paidAmount: number;
  paymentType: PaymentType;
  paymentChannel: PaymentChannel;
  customerId: string;
  branchId: string;
  locationId: string;
  lastSale: Sale | null;
  orderType: string;
  deliveryRepId?: string | number | null;
  collectionStatus?: string;
}

function getCanSubmitHint(params: {
  cartLength: number;
  hasOperationalSetup: boolean;
  hasCatalogReady: boolean;
  requiresCashierShift: boolean;
  ownOpenShift: { id: string | number } | null;
  hasCreditWithoutCustomer: boolean;
  hasDeliveryWithoutRep?: boolean;
  hasZeroPriceLine: boolean;
  hasDiscountPermissionViolation?: boolean;
  hasPricePermissionViolation?: boolean;
  hasUnderpaidSale: boolean;
}) {
  if (!params.cartLength) return 'أضف صنفًا واحدًا على الأقل.';
  if (!params.hasOperationalSetup) return 'أكمل إعداد المتجر ونقطة التشغيل أولًا.';
  if (!params.hasCatalogReady) return 'أضف الأصناف أولًا قبل البيع.';
  if (params.requiresCashierShift && !params.ownOpenShift) return 'افتح وردية كاشير أولًا.';
  if (params.hasCreditWithoutCustomer) return 'البيع الآجل يحتاج اختيار عميل.';
  if (params.hasDeliveryWithoutRep) return 'يرجى اختيار مندوب التوصيل لتسجيل عهدة التحصيل عليه.';
  if (params.hasZeroPriceLine) return 'راجع السلة: يوجد صنف بسعر صفر.';
  if ((params as typeof params & { hasDiscountPermissionViolation?: boolean }).hasDiscountPermissionViolation) return 'الخصم يتطلب اعتماد المدير (PIN).';
  if ((params as typeof params & { hasPricePermissionViolation?: boolean }).hasPricePermissionViolation) return 'لا تملك صلاحية تعديل السعر.';
  if (params.hasUnderpaidSale) return 'أكمل المدفوع أو حوّل العملية إلى آجل.';
  return '';
}

function getCheckoutDisabledReason(params: {
  cartLength: number;
  hasOperationalSetup: boolean;
  hasCatalogReady: boolean;
  requiresCashierShift: boolean;
  ownOpenShift: { id: string | number } | null;
  hasInvalidCartLine: boolean;
}) {
  if (!params.cartLength) return 'لا توجد أصناف في الفاتورة';
  if (!params.hasOperationalSetup || !params.hasCatalogReady) return 'توجد مشكلة في بيانات الفاتورة';
  if (params.requiresCashierShift && !params.ownOpenShift) return 'لا توجد وردية مفتوحة';
  if (params.hasInvalidCartLine) return 'توجد مشكلة في بيانات الفاتورة';
  return '';
}

function getShiftDisplayLabel(shift: { docNo?: string; openedByName?: string } | null | undefined) {
  if (!shift) return 'غير مفتوحة';
  const openedByName = String(shift.openedByName || '').trim();
  const docNo = String(shift.docNo || '').trim();
  if (openedByName && docNo) return `${openedByName} — ${docNo}`;
  return openedByName || docNo || 'مفتوحة';
}

export function usePosWorkspaceDerived(params: PosWorkspaceDerivedParams) {
  // INV-FE1-FRONTEND-BOOK-DIGITS: every money leg below rounds at the
  // tenant's book digits (settings currency, global system currency
  // as fallback) — never at hardcoded 2dp/3dp.
  const bookDigits = currencyMoneyDigits(params.settings?.currency || getGlobalSystemCurrency());
  const productList = useMemo(() => (Array.isArray(params.products) ? params.products : []), [params.products]);
  const saleProductList = useMemo(() => (Array.isArray(params.saleProducts) ? params.saleProducts : []), [params.saleProducts]);
  const branchList = useMemo(() => (Array.isArray(params.branches) ? params.branches : []), [params.branches]);
  const locationList = useMemo(() => (Array.isArray(params.locations) ? params.locations : []), [params.locations]);
  const openShiftList = useMemo(() => (Array.isArray(params.openShiftRows) ? params.openShiftRows : []), [params.openShiftRows]);
  const customerList = useMemo(() => (Array.isArray(params.customers) ? params.customers : []), [params.customers]);
  const authPermissionSet = useMemo(() => new Set(params.authPermissions || []), [params.authPermissions]);
  const recentProductIdSet = useMemo(() => new Set(params.recentProductIds), [params.recentProductIds]);
  const productById = useMemo(() => new Map(productList.map((product) => [String(product.id), product])), [productList]);
  const customerById = useMemo(() => new Map(customerList.map((customer) => [String(customer.id), customer.name])), [customerList]);
  const branchById = useMemo(() => new Map(branchList.map((branch) => [String(branch.id), branch])), [branchList]);
  const locationById = useMemo(() => new Map(locationList.map((location) => [String(location.id), location])), [locationList]);
  const openShiftByUserId = useMemo(
    () => new Map(openShiftList.map((shift) => [String((shift as any).opened_by || shift.openedById || ''), shift])),
    [openShiftList],
  );
  const defaultPriceByProductId = useMemo(
    () => new Map(productList.map((product) => [String(product.id), Number(getProductPrice(product, 'retail', 1, 1, bookDigits) || 0)])),
    [productList, bookDigits],
  );

  const recentProducts = useMemo(() => {
    return params.recentProductIds.map((id) => productById.get(String(id))).filter(Boolean) as Product[];
  }, [params.recentProductIds, productById]);

  const panelSourceProducts = useMemo(
    () => (params.productFilter === 'recent' ? recentProducts : saleProductList),
    [params.productFilter, recentProducts, saleProductList],
  );

  const filteredSaleProducts = useMemo(() => {
    if (params.productFilter === 'all') return panelSourceProducts;
    return panelSourceProducts.filter((product) => {
      if (params.productFilter === 'services' && product.itemType !== 'service') return false;
      if (params.productFilter === 'offers') {
        const hasOffers = (product.offers || []).length > 0;
        const isCombo = Boolean(
          product.hasBom ||
          product.bomId ||
          (product as any).has_bom ||
          (product as any).bom_id ||
          product.comboComponentsSummary ||
          (product.comboOriginalPrice && Number(product.comboOriginalPrice) > 0)
        );
        if (!hasOffers && !isCombo) return false;
      }
      if (params.productFilter === 'priced' && !(product.customerPrices || []).length) return false;
      if (params.productFilter === 'low' && !(Number(product.stock || 0) <= Number(product.minStock || 0))) return false;
      if (params.productFilter === 'recent' && !recentProductIdSet.has(product.id)) return false;
      return true;
    });
  }, [panelSourceProducts, params.productFilter, recentProductIdSet]);

  const totals = useMemo(() => {
    const subTotal = params.cart.reduce((sum, item) => {
      const modifiersTotal = (item.modifiers || []).reduce((modSum: number, mod: any) => modSum + Number(mod.price || 0), 0);
      return sum + (item.qty * (item.price + modifiersTotal));
    }, 0);
    const manualDiscount = Math.max(0, Number(params.discount || 0));
    const pointRedeemValue = Number(params.settings?.loyaltyPointRedeemValue ?? 0.1);
    const loyaltyDiscount = Math.max(0, roundMoneyValue(Number(params.loyaltyPointsRedeemed || 0) * pointRedeemValue, bookDigits));
    const discountValue = manualDiscount + loyaltyDiscount;
    const deliveryFee = Math.max(0, Number(params.deliveryFee || 0));
    const tipAmount = Math.max(0, Number(params.tipAmount || 0));

    // Restaurant Dine-in Service Charge
    const isServiceChargeActive = Boolean(
      params.settings?.restaurantServiceChargeEnabled && params.orderType === 'dine_in'
    );
    const serviceChargePercent = isServiceChargeActive
      ? Math.max(0, Number(params.settings?.restaurantServiceChargePercent ?? 0))
      : 0;
    const discounted = Math.max(0, subTotal - discountValue);
    const serviceCharge = serviceChargePercent > 0
      ? roundMoneyValue((discounted * serviceChargePercent) / 100, bookDigits)
      : 0;

    const baseBeforeTax = roundMoneyValue(discounted + serviceCharge, bookDigits);
    const taxRate = Number(params.settings?.taxRate || 0);
    const pricesIncludeTax = String(params.settings?.taxMode || 'exclusive') === 'inclusive';
    let taxAmount = 0;
    let total = 0;
    if (taxRate > 0) {
      if (pricesIncludeTax) {
        total = roundMoneyValue(baseBeforeTax + deliveryFee + tipAmount, bookDigits);
        taxAmount = roundMoneyValue(baseBeforeTax - (baseBeforeTax / (1 + taxRate / 100)), bookDigits);
      } else {
        taxAmount = roundMoneyValue(baseBeforeTax * (taxRate / 100), bookDigits);
        total = roundMoneyValue(baseBeforeTax + taxAmount + deliveryFee + tipAmount, bookDigits);
      }
    } else {
      total = roundMoneyValue(baseBeforeTax + deliveryFee + tipAmount, bookDigits);
    }
    return {
      subTotal: roundMoneyValue(subTotal, bookDigits),
      discountValue: roundMoneyValue(discountValue, bookDigits),
      manualDiscount: roundMoneyValue(manualDiscount, bookDigits),
      loyaltyDiscount: roundMoneyValue(loyaltyDiscount, bookDigits),
      serviceCharge,
      serviceChargePercent,
      deliveryFee: roundMoneyValue(deliveryFee, bookDigits),
      tipAmount,
      taxRate,
      pricesIncludeTax,
      taxAmount,
      total,
    };
  }, [params.cart, params.discount, params.loyaltyPointsRedeemed, params.deliveryFee, params.tipAmount, params.settings, params.orderType, bookDigits]);

  const changeAmount = useMemo(() => roundMoneyValue(Math.max(0, Number(params.paidAmount || 0) - totals.total), bookDigits), [params.paidAmount, totals.total, bookDigits]);
  const amountDue = useMemo(() => roundMoneyValue(Math.max(0, Number(totals.total || 0) - Number(params.paidAmount || 0)), bookDigits), [params.paidAmount, totals.total, bookDigits]);
  const currentBranch = useMemo(
    () => branchById.get(String(params.branchId)) || branchList[0] || null,
    [branchById, branchList, params.branchId],
  );
  const currentLocation = useMemo(
    () => locationById.get(String(params.locationId)) || locationList[0] || null,
    [locationById, locationList, params.locationId],
  );
  const ownOpenShift = useMemo(() => {
    const currentUserId = String(params.authUserId || '').trim();
    if (!currentUserId) return null;
    const matched = openShiftByUserId.get(currentUserId)
      || openShiftList.find((s) => String((s as any).opened_by || (s as any).openedById || (s as any).opened_by_id || (s as any).openedBy || '').trim() === currentUserId);
    return matched || null;
  }, [openShiftByUserId, openShiftList, params.authUserId]);

  const discountVal = Math.abs(Number(params.discount || 0));
  const subtotalVal = Number(totals.subTotal || 0);
  const isThresholdEnabled = Boolean(params.settings?.posMaxDiscountThresholdEnabled);
  const thresholdType = params.settings?.posMaxDiscountThresholdType || 'percentage';
  const thresholdValue = Number(params.settings?.posMaxDiscountThresholdValue ?? 10);
  // INV-SPIRIT-DISCOUNT-TIERS (frontend mirror of the backend guard): any
  // cashier may discount up to the flat allowance without approval.
  const flatAllowance = Number(params.settings?.posSmallDiscountFlatAllowance ?? 2);
  const withinFlatAllowance = discountVal > 0.0001 && discountVal <= flatAllowance + 0.0001;

  let exceedsDiscountThreshold = false;
  if (isThresholdEnabled && discountVal > 0.0001 && thresholdValue > 0) {
    if (thresholdType === 'percentage') {
      const discountPercentage = subtotalVal > 0 ? (discountVal / subtotalVal) * 100 : 0;
      exceedsDiscountThreshold = discountPercentage > thresholdValue;
    } else {
      exceedsDiscountThreshold = discountVal > thresholdValue;
    }
  }

  const isApprovedByManager = Boolean(params.discountApprovalGranted);
  const isSuperAdmin = authPermissionSet.has('*');
  const hasBaseDiscountPermission = authPermissionSet.has('canDiscount') || isSuperAdmin;

  const hasDiscountPermissionViolation = discountVal > 0.0001 && !withinFlatAllowance && (
    (!hasBaseDiscountPermission && !isApprovedByManager) ||
    (exceedsDiscountThreshold && !isSuperAdmin && !isApprovedByManager)
  );

  const canApplyDiscount = withinFlatAllowance || (hasBaseDiscountPermission && !exceedsDiscountThreshold) || isSuperAdmin || isApprovedByManager;
  const canEditPrice = authPermissionSet.has('canEditPrice') || authPermissionSet.has('*');
  const canSellWholesale = authPermissionSet.has('canSellWholesale') || authPermissionSet.has('*') || Boolean(params.wholesaleApprovalGranted);
  const hasOperationalSetup = Boolean(branchList.length > 0 && locationList.length > 0);
  const hasCatalogReady = Boolean(productList.length > 0);
  const requiresCashierShift = params.paymentType !== 'credit';
  const hasZeroPriceLine = useMemo(() => params.cart.some((item) => Number(item.price || 0) <= 0), [params.cart]);
  const hasInvalidCartLine = useMemo(() => params.cart.some((item) => {
    const qty = Number(item.qty || 0);
    const price = Number(item.price || 0);
    return !Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price < 0;
  }), [params.cart]);
  const hasCreditWithoutCustomer = params.paymentType === 'credit' && !params.customerId;
  const allowNegativeStockSales = isNegativeStockSalesAllowed(params.settings);
  const shouldAssumeFullCashPayment = allowNegativeStockSales && params.paymentType !== 'credit' && Number(params.paidAmount || 0) <= 0.0001;
  const isDeliveryCOD = params.orderType === 'delivery' && params.collectionStatus === 'cod';
  const isPartialCreditWithCustomer = Boolean(params.customerId) && Number(params.paidAmount || 0) < Number(totals.total || 0);
  const hasUnderpaidSale = params.paymentType !== 'credit'
    && Number(params.paidAmount || 0) < Number(totals.total || 0)
    && !shouldAssumeFullCashPayment
    && !isDeliveryCOD
    && !isPartialCreditWithCustomer;
  const hasPricePermissionViolation = useMemo(() => {
    if (canEditPrice) return false;
    return params.cart.some((item) => {
      const baselinePrice = item.priceType === 'retail' && Number(item.qty || 0) === 1
        ? defaultPriceByProductId.get(String(item.productId))
        : undefined;
      if (typeof baselinePrice === 'number') {
        return Math.abs(Number(item.price || 0) - baselinePrice) > 0.0001;
      }
      const product = productById.get(String(item.productId));
      if (!product) return false;
      const unitMultiplier = Number(item.unitMultiplier) > 0 ? Number(item.unitMultiplier) : 1;
      return Math.abs(Number(item.price || 0) - Number(getProductPrice(product, item.priceType, item.qty, unitMultiplier, bookDigits) || 0)) > 0.0001;
    });
  }, [canEditPrice, params.cart, defaultPriceByProductId, productById, bookDigits]);

  const isDelivery = params.orderType === 'delivery';
  const isDeliveryCod = isDelivery && params.collectionStatus === 'cod';
  const hasDeliveryWithoutRep = isDeliveryCod && (!params.deliveryRepId || Number(params.deliveryRepId) <= 0);

  const canSubmitSale = useMemo(() => Boolean(
    params.cart.length
    && hasOperationalSetup
    && hasCatalogReady
    && (!requiresCashierShift || ownOpenShift)
    && !hasZeroPriceLine
    && !hasCreditWithoutCustomer
    && !hasDeliveryWithoutRep
    && !hasUnderpaidSale
    && !hasDiscountPermissionViolation
    && !hasPricePermissionViolation,
  ), [
    params.cart.length,
    hasOperationalSetup,
    hasCatalogReady,
    requiresCashierShift,
    ownOpenShift,
    hasZeroPriceLine,
    hasCreditWithoutCustomer,
    hasDeliveryWithoutRep,
    hasUnderpaidSale,
    hasDiscountPermissionViolation,
    hasPricePermissionViolation,
  ]);

  const canOpenCheckout = useMemo(() => Boolean(
    params.cart.length
    && hasOperationalSetup
    && hasCatalogReady
    && (!requiresCashierShift || ownOpenShift)
    && !hasInvalidCartLine,
  ), [params.cart.length, hasOperationalSetup, hasCatalogReady, requiresCashierShift, ownOpenShift, hasInvalidCartLine]);

  const checkoutDisabledReason = useMemo(() => getCheckoutDisabledReason({
    cartLength: params.cart.length,
    hasOperationalSetup,
    hasCatalogReady,
    requiresCashierShift,
    ownOpenShift,
    hasInvalidCartLine,
  }), [params.cart.length, hasOperationalSetup, hasCatalogReady, requiresCashierShift, ownOpenShift, hasInvalidCartLine]);

  const canSubmitHint = useMemo(() => getCanSubmitHint({
    cartLength: params.cart.length,
    hasOperationalSetup,
    hasCatalogReady,
    requiresCashierShift,
    ownOpenShift,
    hasCreditWithoutCustomer,
    hasDeliveryWithoutRep,
    hasZeroPriceLine,
    hasDiscountPermissionViolation,
    hasPricePermissionViolation,
    hasUnderpaidSale,
  }), [
    params.cart.length,
    hasOperationalSetup,
    hasCatalogReady,
    requiresCashierShift,
    ownOpenShift,
    hasCreditWithoutCustomer,
    hasDeliveryWithoutRep,
    hasZeroPriceLine,
    hasDiscountPermissionViolation,
    hasPricePermissionViolation,
    hasUnderpaidSale,
  ]);

  const openShiftLabel = getShiftDisplayLabel(ownOpenShift);

  const contextBadges = useMemo(() => [
    ...(SINGLE_STORE_MODE ? [] : [{ key: 'branch', label: `الفرع: ${currentBranch?.name || 'الافتراضي'}` }]),
    { key: 'location', label: `${SINGLE_STORE_MODE ? 'نقطة التشغيل' : 'المخزن'}: ${currentLocation?.name || (SINGLE_STORE_MODE ? 'المخزن الأساسي' : 'الافتراضي')}` },
    { key: 'shift', label: `الوردية: ${openShiftLabel}` },
    { key: 'payment', label: `الدفع: ${paymentLabel(params.paymentType, params.paymentChannel)}` },
    { key: 'held', label: `المعلقات: ${params.heldDrafts.length}` },
    { key: 'products', label: `المعروض: ${filteredSaleProducts.length}` },
  ], [currentBranch?.name, currentLocation?.name, filteredSaleProducts.length, openShiftLabel, params.heldDrafts.length, params.paymentChannel, params.paymentType]);

  const shortSummary = useMemo(() => [
    { key: 'total', label: 'المطلوب دفعه', value: formatCurrency(totals.total) },
    { key: 'items', label: 'عدد الأصناف', value: String(params.cart.length) },
    { key: 'shift', label: 'الوردية', value: openShiftLabel },
    { key: 'change', label: params.paymentType === 'credit' ? 'المتبقي على العميل' : 'الباقي للعميل', value: formatCurrency(params.paymentType === 'credit' ? totals.total : changeAmount) },
  ], [changeAmount, openShiftLabel, params.cart.length, params.paymentType, totals.total]);

  const selectedCustomerName = customerById.get(String(params.customerId)) || 'عميل نقدي';
  const hasRecentProducts = recentProducts.length > 0;
  const selectedPriceType = (params.cart[0]?.priceType || null) as PosPriceType | null;

  return {
    recentProducts,
    filteredSaleProducts,
    totals,
    changeAmount,
    amountDue,
    currentBranch,
    currentLocation,
    ownOpenShift,
    hasOperationalSetup,
    hasCatalogReady,
    requiresCashierShift,
    hasZeroPriceLine,
    hasCreditWithoutCustomer,
    hasDiscountPermissionViolation,
    hasPricePermissionViolation,
    hasUnderpaidSale,
    hasInvalidCartLine,
    canApplyDiscount,
    canEditPrice,
    canSellWholesale,
    canOpenCheckout,
    checkoutDisabledReason,
    canSubmitSale,
    canSubmitHint,
    contextBadges,
    shortSummary,
    selectedCustomerName,
    hasRecentProducts,
    selectedPriceType,
  };
}
