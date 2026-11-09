import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PosWorkspaceHeader } from '@/features/pos/components/pos-workspace/PosWorkspaceHeader';
import { PosWorkspaceConfirmDialogs } from '@/features/pos/components/pos-workspace/PosWorkspaceConfirmDialogs';
import { PosSaleSuccessDialog } from '@/features/pos/components/pos-workspace/PosSaleSuccessDialog';
import { PosWorkspaceDiscountDialog } from '@/features/pos/components/pos-workspace/PosWorkspaceDiscountDialog';
import { PosWorkspaceWholesaleDialog } from '@/features/pos/components/pos-workspace/PosWorkspaceWholesaleDialog';
import { PosWorkspaceMainContent } from '@/features/pos/components/pos-workspace/PosWorkspaceMainContent';
import { PosCheckoutDialog } from '@/features/pos/components/pos-workspace/PosCheckoutDialog';
import { PosHeldDraftsDialog } from '@/features/pos/components/pos-workspace/PosHeldDraftsDialog';
import { PosTablesFloorPlanDialog } from '@/features/pos/components/pos-workspace/PosTablesFloorPlanDialog';
import { PosSplitBillModal } from '@/features/pos/components/pos-workspace/PosSplitBillModal';
import { PosItemModifiersModal } from '@/features/pos/components/pos-cart-panel/PosItemModifiersModal';
import { PosDraftSwitcherOverlay } from '@/features/pos/components/pos-workspace/PosDraftSwitcherOverlay';
import { PosOpenShiftModal } from '@/features/pos/components/pos-workspace/PosOpenShiftModal';
import { SerialLookupModal } from '@/features/products/components/SerialLookupModal';
import { QuickProductModal } from '@/shared/components/QuickProductModal';
import { PosNewProductModal } from '@/features/pos/components/pos-workspace/PosNewProductModal';
import { PosScannedInvoiceModal } from '@/features/pos/components/pos-workspace/PosScannedInvoiceModal';
import { PosRecentSalesReprintModal } from '@/features/pos/components/pos-workspace/PosRecentSalesReprintModal';
import { PosPhoneOrderDialog } from '@/features/pos/components/pos-workspace/PosPhoneOrderDialog';
import { PosCallerIdFloatingAlert } from '@/features/pos/components/pos-workspace/PosCallerIdFloatingAlert';
import { printOrderCupLabels } from '@/lib/pos-printing/cup-label';
import { salesApi } from '@/features/sales/api/sales.api';
import {
  getSelectedCustomerName,
  printCurrentPosDraft,
} from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import { posApi } from '@/features/pos/api/pos.api';
import { isNegativeStockSalesAllowed, repriceCartLine, getProductItemCode, getSaleUnit, summarizeCartQuantities } from '@/features/pos/lib/pos.domain';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { isLikelyBarcodeQuery } from '@/features/pos/lib/pos-product-lookup';
import { normalizePosSaleMode, usePosSaleMode } from '@/features/pos/lib/pos-sale-mode';
import { matchProductByCode } from '@/features/pos/lib/pos-workspace.helpers';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import { parseWeightedBarcode, matchProductByWeightedCode } from '@/features/pos/lib/weighted-barcode';
import { parseQuantityPrefixQuery } from '@/features/pos/lib/pos-quantity-prefix';
import { lookupProductByBarcodeFromStorage } from '@/features/pos/lib/pos-catalog-storage';
import { useAuthStore } from '@/stores/auth-store';
import { usePosWorkspace } from '@/features/pos/hooks/usePosWorkspace';
import { usePosWorkspaceKeyboardShortcuts } from '@/features/pos/hooks/usePosWorkspaceKeyboardShortcuts';
import {
  isInvoiceBarcodeQuery,
  getNormalizedInvoiceSearchTerms,
  matchesSaleDocNo,
  remapArabicKeyboardToEnglish,
  shouldSkipInvoiceSearch,
} from '@/features/pos/lib/pos-barcode-normalizer';
import type { PosPriceType } from '@/features/pos/types/pos.types';
import type { Product, Sale } from '@/types/domain';
import { printGuestCheck } from '@/lib/pos-printing';
import { persistHeldDrafts } from '@/features/pos/lib/pos.persistence';
import { toast } from '@/shared/components/system-alert';

const LazyPosEditProductModal = lazy(() => import('@/features/pos/components/pos-workspace/PosEditProductModal').then((m) => ({ default: m.PosEditProductModal })));

export function PosWorkspace() {
  const navigate = useNavigate();
  const pos = usePosWorkspace();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lastScannerSubmitRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const lastInvoiceScanRef = useRef<{ query: string; at: number }>({ query: '', at: 0 });
  const [discountApprovalDialogOpen, setDiscountApprovalDialogOpen] = useState(false);
  const [wholesaleApprovalDialogOpen, setWholesaleApprovalDialogOpen] = useState(false);
  const [clearCartConfirmOpen, setClearCartConfirmOpen] = useState(false);
  const [lineDeleteConfirmKey, setLineDeleteConfirmKey] = useState('');
  const [heldDeleteConfirmId, setHeldDeleteConfirmId] = useState('');
  const [clearHeldConfirmOpen, setClearHeldConfirmOpen] = useState(false);
  const [saleSuccessDialogOpen, setSaleSuccessDialogOpen] = useState(false);
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [splitBillOpen, setSplitBillOpen] = useState(false);
  const [heldDraftsDialogOpen, setHeldDraftsDialogOpen] = useState(false);
  const [restaurantTablesOpen, setRestaurantTablesOpen] = useState(false);
  const [restaurantInitialTab, setRestaurantInitialTab] = useState<'floor' | 'list'>('floor');
  const [openShiftModalOpen, setOpenShiftModalOpen] = useState(false);
  const [serialLookupOpen, setSerialLookupOpen] = useState(false);
  const [quickServiceOpen, setQuickServiceOpen] = useState(false);
  const [newProductModalOpen, setNewProductModalOpen] = useState(false);
  const [newProductInitialName, setNewProductInitialName] = useState('');
  const [newProductInitialBarcode, setNewProductInitialBarcode] = useState('');
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [modifiersModalLineKey, setModifiersModalLineKey] = useState<string>('');
  const [shortcutRecallDraftId, setShortcutRecallDraftId] = useState('');
  const [scannedSale, setScannedSale] = useState<Sale | null>(null);
  const [scannedSaleModalOpen, setScannedSaleModalOpen] = useState(false);
  const [reprintModalOpen, setReprintModalOpen] = useState(false);
  const [phoneOrderOpen, setPhoneOrderOpen] = useState(false);
  const [phoneOrderInitialPhone, setPhoneOrderInitialPhone] = useState('');
  const [phoneOrderInitialName, setPhoneOrderInitialName] = useState('');
  const defaultPosMode = normalizePosSaleMode(pos.settingsQuery.data?.defaultPosMode);
  const [posMode, setPosMode] = usePosSaleMode(defaultPosMode);

  const handlePrintCupLabels = useCallback(() => {
    if (pos.cart.length === 0) {
      toast.warning('السلة فارغة، أضف أصنافاً لطباعة ملصقات الأكواب والعلب');
      return;
    }
    printOrderCupLabels({
      orderNumber: pos.tableNumber ? `طاولة-${pos.tableNumber}` : 'سفري',
      tableNumber: pos.tableNumber || undefined,
      customerName: pos.quickCustomerName || undefined,
      orderType: pos.orderType,
      branchName: pos.currentBranch?.name,
      items: pos.cart.map((item) => ({
        name: item.name,
        qty: item.qty,
        notes: item.notes,
        modifiers: item.modifiers,
      })),
    }, pos.settingsQuery.data);
    toast.success('تم إرسال ملصقات الأكواب والعلب للطابعة اللاصقة بنجاح');
  }, [pos.cart, pos.tableNumber, pos.quickCustomerName, pos.orderType, pos.currentBranch, pos.settingsQuery.data]);

  const handleOpenPhoneOrder = useCallback((phone?: string, name?: string) => {
    setPhoneOrderInitialPhone(phone || '');
    setPhoneOrderInitialName(name || '');
    setPhoneOrderOpen(true);
  }, []);

  const handlePriceTypeChange = useCallback((nextPriceType: PosPriceType) => {
    if (nextPriceType === 'wholesale' && !pos.canSellWholesale) {
      setWholesaleApprovalDialogOpen(true);
      return;
    }
    pos.setPriceType(nextPriceType);
  }, [pos.canSellWholesale, pos.setPriceType]);

  const handleOpenNewProduct = useCallback((params?: { name?: string; barcode?: string }) => {
    setNewProductInitialName(params?.name || '');
    setNewProductInitialBarcode(params?.barcode || '');
    setNewProductModalOpen(true);
  }, []);
  const allowNegativeStockSales = isNegativeStockSalesAllowed(pos.settingsQuery.data);

  const catalogsLoading = pos.productsQuery.isLoading || pos.customersQuery.isLoading || pos.branchesQuery.isLoading || pos.locationsQuery.isLoading || pos.settingsQuery.isLoading;
  const catalogsError = pos.productsQuery.error || pos.customersQuery.error || pos.branchesQuery.error || pos.locationsQuery.error || pos.settingsQuery.error;

  const selectedCustomer = useMemo(() => {
    return (pos.customersQuery.data || []).find((c) => String(c.id) === pos.customerId) || null;
  }, [pos.customerId, pos.customersQuery.data]);
  const selectedCustomerName = useMemo(() => getSelectedCustomerName(pos), [pos]);
  const lastSaleCustomer = useMemo(() => {
    const customerId = String(pos.lastSale?.customerId || pos.customerId || '');
    if (!customerId) return null;
    return (pos.customersQuery.data || []).find((customer) => String(customer.id) === customerId) || null;
  }, [pos.customerId, pos.customersQuery.data, pos.lastSale?.customerId]);
  const cartQtySummaries = useMemo(() => {
    return summarizeCartQuantities(pos.cart);
  }, [pos.cart]);
  const cartItemsCount = pos.cart.length;
  const lineDeleteConfirmItem = useMemo(
    () => pos.cart.find((item) => item.lineKey === lineDeleteConfirmKey) || null,
    [lineDeleteConfirmKey, pos.cart],
  );
  const heldDeleteConfirmDraft = useMemo(
    () => pos.heldDraftSummaries.find((draft) => draft.id === heldDeleteConfirmId) || null,
    [heldDeleteConfirmId, pos.heldDraftSummaries],
  );

  const editProduct = useMemo(
    () => (pos.productsQuery.data || []).find((p) => String(p.id) === String(editProductId)) || null,
    [editProductId, pos.productsQuery.data],
  );

  const printCurrentDraft = useCallback(() => {
    printCurrentPosDraft(pos, selectedCustomerName, selectedCustomer?.phone, selectedCustomer?.address);
  }, [pos, selectedCustomerName, selectedCustomer]);

  const focusBarcodeEntry = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
      return () => {};
    }
    const handle = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(handle);
  }, []);

  const handleProductUpdatedFromModal = useCallback((updatedProduct: Product) => {
    setEditProductId(null);
    void pos.refetchCatalogs();
    pos.setCart((prevCart) => {
      return prevCart.map((line) => {
        if (String(line.productId) === String(updatedProduct.id)) {
          const unit = (updatedProduct.units || []).find((u) => String(u.id || '') === String(line.unitId || '') || String(u.name || '') === String(line.unitName || '')) || getSaleUnit(updatedProduct);
          const nextLine = {
            ...line,
            name: updatedProduct.name || line.name,
            costPrice: Number(updatedProduct.costPrice || 0),
            currentStock: Number(updatedProduct.stock || 0),
            minStock: Number(updatedProduct.minStock || 0),
            itemCode: getProductItemCode(updatedProduct, unit) || line.itemCode,
          };
          return repriceCartLine(nextLine, updatedProduct, line.qty, currencyMoneyDigits(pos.settingsQuery.data?.currency || getGlobalSystemCurrency()));
        }
        return line;
      });
    });
    pos.setScannerMessage(`تم تحديث بيانات الصنف (${updatedProduct.name}) بنجاح`);
    focusBarcodeEntry();
  }, [pos, focusBarcodeEntry]);

  const requestDiscountAuthorization = useCallback(() => {
    setDiscountApprovalDialogOpen(true);
  }, []);

  const requestClearCart = useCallback(() => {
    if (!pos.cart.length) {
      pos.resetPosDraft();
      return;
    }
    setClearCartConfirmOpen(true);
  }, [pos]);

  const requestLineDelete = useCallback((lineKey: string) => {
    if (!lineKey) return;
    setLineDeleteConfirmKey(lineKey);
  }, []);

  const requestSelectedLineDelete = useCallback(() => {
    if (!pos.selectedLineKey) return;
    setLineDeleteConfirmKey(pos.selectedLineKey);
  }, [pos.selectedLineKey]);

  const requestHeldDelete = useCallback((draftId: string) => {
    setHeldDeleteConfirmId(draftId);
  }, []);

  const requestClearHeldDrafts = useCallback(() => {
    if (!pos.heldDraftSummaries.length) return;
    setClearHeldConfirmOpen(true);
  }, [pos.heldDraftSummaries.length]);

  const requestCheckoutDialog = useCallback(() => {
    if (pos.createSale.isPending) return;
    if (pos.requiresCashierShift && !pos.ownOpenShift) {
      setOpenShiftModalOpen(true);
      return;
    }
    if (!pos.canOpenCheckout) {
      if (pos.checkoutDisabledReason) pos.setSubmitMessage(pos.checkoutDisabledReason);
      return;
    }
    setCheckoutDialogOpen(true);
  }, [pos.canOpenCheckout, pos.checkoutDisabledReason, pos.createSale.isPending, pos.ownOpenShift, pos.requiresCashierShift, pos.setSubmitMessage]);

  const requestRecallHeldDraftByIndex = useCallback(async (index: number) => {
    const draftId = pos.heldDraftSummaries[index]?.id;
    if (draftId) {
      await pos.recallDraft(draftId);
      setHeldDraftsDialogOpen(false);
    }
  }, [pos]);

  const requestItemModifiers = useCallback((lineKey: string) => {
    setModifiersModalLineKey(lineKey);
  }, []);

  const handleQuickAddSubmit = useCallback((rawCode?: string) => {
    const code = String(rawCode ?? pos.quickAddCode).trim();
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (code && lastScannerSubmitRef.current.code === code && (now - lastScannerSubmitRef.current.at) < 90) {
      return false;
    }
    const submitted = pos.handleQuickAddCodeSubmit(rawCode);
    if (submitted) lastScannerSubmitRef.current = { code, at: now };
    return submitted;
  }, [pos]);

  const resolveScannedInvoice = useCallback(async (rawQuery: string): Promise<boolean> => {
    const clean = String(rawQuery || '').trim();
    if (!clean) return false;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (lastInvoiceScanRef.current.query === clean && (now - lastInvoiceScanRef.current.at) < 800) {
      return true;
    }
    lastInvoiceScanRef.current = { query: clean, at: now };

    try {
      const searchTerms = getNormalizedInvoiceSearchTerms(clean);
      if (!searchTerms.length) return false;

      // 1. Fast path: Search the primary normalized term directly
      const primaryTerm = searchTerms[0];
      const salesResult = await salesApi.listPage({ search: primaryTerm, pageSize: 5 });
      const matchingSale = (salesResult.rows || []).find((s) => {
        if (matchesSaleDocNo(s.docNo, primaryTerm)) return true;
        if (matchesSaleDocNo(s.docNo, clean)) return true;
        return false;
      });

      if (matchingSale) {
        setScannedSale(matchingSale);
        setScannedSaleModalOpen(true);
        pos.setSearch('');
        pos.setSubmitMessage('');
        return true;
      }

      // 2. Parallel fallback for remaining search terms if primary didn't catch
      if (searchTerms.length > 1) {
        const remainingTerms = searchTerms.slice(1, 3);
        const results = await Promise.all(
          remainingTerms.map((term) => salesApi.listPage({ search: term, pageSize: 5 }))
        );
        for (const res of results) {
          const found = (res.rows || []).find((s) => matchesSaleDocNo(s.docNo, clean) || matchesSaleDocNo(s.docNo, primaryTerm));
          if (found) {
            setScannedSale(found);
            setScannedSaleModalOpen(true);
            pos.setSearch('');
            pos.setSubmitMessage('');
            return true;
          }
        }
      }
    } catch {
      // Ignore
    }
    return false;
  }, [pos]);

  const resolveRemoteBarcodeMatch = useCallback((rawQuery: string) => {
    void (async () => {
      try {
        const parsed = parseQuantityPrefixQuery(rawQuery);
        const query = parsed.cleanQuery || rawQuery;
        const activeTenantId = String(useAuthStore.getState().user?.tenantId ||
          useAuthStore.getState().tenant?.id || '').trim();

        const weightedBarcode = parseWeightedBarcode(query, pos.settingsQuery.data || null);
        if (weightedBarcode) {
          const weightedLookupProducts = await posApi.lookupProducts({ barcode: weightedBarcode.productCode, branchId: pos.branchId, locationId: pos.locationId, limit: 5 });
          const weightedSubmitted = pos.handleQuickAddCodeSubmit(rawQuery, weightedLookupProducts);
          if (weightedSubmitted) {
            pos.setSearch('');
            return;
          }

          const strippedProductCode = weightedBarcode.productCode.replace(/^0+/, '') || weightedBarcode.productCode;
          if (strippedProductCode !== weightedBarcode.productCode) {
            const strippedSearchProducts = await posApi.lookupProducts({ q: strippedProductCode, branchId: pos.branchId, locationId: pos.locationId, limit: 5 });
            const strippedSearchSubmitted = pos.handleQuickAddCodeSubmit(rawQuery, strippedSearchProducts);
            if (strippedSearchSubmitted) {
              pos.setSearch('');
              return;
            }
          }
          
          pos.setSubmitMessage(`باركود ميزان: لم يتم العثور على كود الصنف ${weightedBarcode.productCode}.`);
          focusBarcodeEntry();
          return;
        }

        // A numeric retail product barcode can resemble YYMMDD+sequence.
        // Always prioritize a known product over the invoice heuristic.
        const localMatch = matchProductByCode(pos.catalogProducts, query);
        if (localMatch.status === 'not-found' && isInvoiceBarcodeQuery(query)) {
          const isInvoice = await resolveScannedInvoice(query);
          if (isInvoice) return;
        }

        // Fast path: check local in-memory catalog before remote lookup.
        if (localMatch.status === 'matched') {
          const submitted = pos.handleQuickAddCodeSubmit(rawQuery, pos.catalogProducts);
          if (submitted) { pos.setSearch(''); return; }
        }

        const remappedQuery = remapArabicKeyboardToEnglish(query);
        let lookupProducts: Product[] = [];
        try {
          lookupProducts = await posApi.lookupProducts({ barcode: query, branchId: pos.branchId, locationId: pos.locationId, limit: 5 });
        } catch {
          const offlineItem = await lookupProductByBarcodeFromStorage(query, activeTenantId);
          if (offlineItem) lookupProducts = [offlineItem];
        }
        const remoteMatch = matchProductByCode(lookupProducts, query);

        if (remoteMatch.status !== 'matched' && remappedQuery !== query) {
          let remappedLookup: Product[] = [];
          try {
            remappedLookup = await posApi.lookupProducts({ barcode: remappedQuery, branchId: pos.branchId, locationId: pos.locationId, limit: 5 });
          } catch {
            const offlineItem = await lookupProductByBarcodeFromStorage(remappedQuery, activeTenantId);
            if (offlineItem) remappedLookup = [offlineItem];
          }
          const remappedMatch = matchProductByCode(remappedLookup, remappedQuery);
          if (remappedMatch.status === 'matched') {
            const submitted = pos.handleQuickAddCodeSubmit(remappedQuery, remappedLookup);
            if (submitted) { pos.setSearch(''); return; }
            focusBarcodeEntry();
            return;
          }
        }

        if (remoteMatch.status === 'matched') {
          const submitted = pos.handleQuickAddCodeSubmit(rawQuery, lookupProducts);
          if (submitted) { pos.setSearch(''); return; }
          // Product found but blocked (e.g. zero stock in this branch) — error already set by handleAddProduct
          focusBarcodeEntry();
          return;
        }

        // Fallback check invoice again, only for invoice-shaped queries:
        // a numeric dashed product barcode already went straight to barcode
        // lookup, and an invoice code was already tried above (the 800ms
        // dedup in resolveScannedInvoice makes a repeat a no-op), so for a
        // non-invoice query this call can only burn sales searches.
        if (isInvoiceBarcodeQuery(rawQuery)) {
          const fallbackInvoice = await resolveScannedInvoice(rawQuery);
          if (fallbackInvoice) return;
        }

        if (remoteMatch.status === 'ambiguous') {
          pos.setSubmitMessage('هذا الباركود غير واضح أو مرتبط بأكثر من نتيجة. راجع الصنف أو الوحدة أولًا.');
        } else {
          pos.setSubmitMessage('لا توجد نتيجة مطابقة الآن لإضافتها.');
        }
      } catch (error) {
        pos.setSubmitMessage(error instanceof Error ? error.message : 'تعذر البحث عن الصنف.');
      }
      focusBarcodeEntry();
    })();
  }, [focusBarcodeEntry, pos, resolveScannedInvoice]);

  const submitFirstSearchResult = useCallback((rawQuery?: string) => {
    const raw = String(rawQuery ?? pos.search).trim();
    if (!raw) {
      pos.setSubmitMessage('اكتب اسم الصنف أو اضرب الباركود أولًا.');
      focusBarcodeEntry();
      return false;
    }

    const parsed = parseQuantityPrefixQuery(raw);
    const query = parsed.cleanQuery || raw;
    const requestedQuantity = parsed.hasPrefix ? parsed.quantity : 1;

    const exactCodeMatch = matchProductByCode(pos.productsQuery.data || [], query);

    // Exact product barcodes (and scale labels) win over the date-shaped invoice heuristic.
    if (exactCodeMatch.status === 'not-found' &&
        !parseWeightedBarcode(query, pos.settingsQuery.data || null) &&
        (isInvoiceBarcodeQuery(query) || isInvoiceBarcodeQuery(raw))) {
      void (async () => {
        const isInvoice = await resolveScannedInvoice(query);
        if (!isInvoice) {
          resolveRemoteBarcodeMatch(raw);
        }
      })();
      return true;
    }

    if (parsed.isSuffixQuantityChange) {
      const targetLineKey = pos.selectedLineKey || pos.lastAddedLineKey || pos.cart[0]?.lineKey;
      if (targetLineKey) {
        pos.setQty(targetLineKey, parsed.quantity);
        pos.setSearch('');
        pos.setSubmitMessage(`تم تعديل الكمية إلى ${parsed.quantity}.`);
        focusBarcodeEntry();
        return true;
      }
    }

    if (parsed.hasPrefix && !parsed.cleanQuery) {
      pos.setSubmitMessage(`الكمية المحددة: ${parsed.quantity} — اضرب الباركود أو اكتب اسم الصنف`);
      focusBarcodeEntry();
      return true;
    }

    if (exactCodeMatch.status === 'matched') {
      const submitted = handleQuickAddSubmit(raw);
      if (submitted) pos.setSearch('');
      return submitted;
    }

    // Also check if typed in Arabic keyboard
    const remappedQuery = remapArabicKeyboardToEnglish(query);
    if (remappedQuery !== query) {
      const remappedLocalMatch = matchProductByCode(pos.productsQuery.data || [], remappedQuery);
      if (remappedLocalMatch.status === 'matched') {
        const submitted = handleQuickAddSubmit(remappedQuery);
        if (submitted) {
          pos.setSearch('');
          return submitted;
        }
      }
    }

    if (exactCodeMatch.status === 'ambiguous') {
      pos.setSubmitMessage('هذا الباركود غير واضح أو مرتبط بأكثر من نتيجة. راجع الصنف أو الوحدة أولًا.');
      focusBarcodeEntry();
      return false;
    }

    if (exactCodeMatch.status === 'not-found') {
      const weightedBarcode = parseWeightedBarcode(query, pos.settingsQuery.data || null);
      if (weightedBarcode) {
        const localWeightedMatch = matchProductByWeightedCode(pos.productsQuery.data || [], weightedBarcode.productCode);
        if (localWeightedMatch.status === 'matched') {
          const submitted = handleQuickAddSubmit(raw);
          if (submitted) {
            pos.setSearch('');
            return true;
          }
        } else {
          resolveRemoteBarcodeMatch(raw);
          return true;
        }
      }
    }

    // If query is a numeric barcode (not a product text search)
    if (isLikelyBarcodeQuery(query) || /^\d+$/.test(query)) {
      // A numeric dashed product barcode (e.g. 622123-456789) goes straight
      // to barcode lookup: it is not an invoice code, so the invoice search
      // must not run before the remote barcode lookup (INV-BARCODE-HIJACK-FIX).
      // Anything else keeps today's invoice-first order (bare digits can be
      // an invoice sequence number; plain barcodes keep prior behavior).
      if (shouldSkipInvoiceSearch(query) || shouldSkipInvoiceSearch(raw)) {
        resolveRemoteBarcodeMatch(raw);
        return true;
      }
      void (async () => {
        const isInvoice = await resolveScannedInvoice(query || raw);
        if (!isInvoice) {
          resolveRemoteBarcodeMatch(raw);
        }
      })();
      return true;
    }

    // Only if it was a TEXT search query (e.g. "شاي ليبتون") and search actually filtered results
    if (pos.search.trim() || query.trim()) {
      const targetQuery = (query || pos.search).toLowerCase().trim();
      const matchedProduct = pos.filteredSaleProducts.find((p) =>
        p.name.toLowerCase().includes(targetQuery) ||
        p.sku?.toLowerCase().includes(targetQuery)
      );
      if (matchedProduct) {
        pos.handleAddProduct(matchedProduct, undefined, { quantity: requestedQuantity });
        pos.setSearch('');
        return true;
      }
    }

    pos.setSubmitMessage('لا توجد نتيجة مطابقة لهذا البحث أو الباركود.');
    focusBarcodeEntry();
    return false;
  }, [focusBarcodeEntry, handleQuickAddSubmit, pos, resolveRemoteBarcodeMatch, resolveScannedInvoice]);

  useEffect(() => {
    if (catalogsLoading) return;
    const activeElement = document.activeElement as HTMLElement | null;
    const isTypingTarget = Boolean(activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT' || activeElement.isContentEditable));
    if (isTypingTarget) return;
    return focusBarcodeEntry();
  }, [catalogsLoading, focusBarcodeEntry]);

  useEffect(() => {
    if (catalogsLoading) return;
    if (pos.registerBarcodeFocusListener) {
      return pos.registerBarcodeFocusListener(focusBarcodeEntry);
    }
    return focusBarcodeEntry();
  }, [catalogsLoading, focusBarcodeEntry, pos.registerBarcodeFocusListener, pos.barcodeFocusTick]);

  useEffect(() => {
    if (pos.canShowLastSaleActions && pos.lastSale) {
      setSaleSuccessDialogOpen(true);
      if (pos.settingsQuery.data?.posKitchenPrinterEnabled && pos.settingsQuery.data?.posKitchenPrinterAuto) {
        try {
          pos.printKitchenNow();
        } catch (e) {
          console.error('Failed to auto-print KOT', e);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.canShowLastSaleActions, pos.lastSale, pos.settingsQuery.data?.posKitchenPrinterEnabled, pos.settingsQuery.data?.posKitchenPrinterAuto]);

  const isServicesActive = pos.settingsQuery.data?.servicesModuleEnabled === true || Boolean(pos.settingsQuery.data?.enableMobileStoreFeatures);

  const isRestaurantActive = Boolean(pos.settingsQuery.data?.restaurantModuleEnabled);
  const isPhoneOrdersActive = pos.settingsQuery.data?.phoneOrdersModuleEnabled === true || (pos.settingsQuery.data?.phoneOrdersModuleEnabled === undefined && (isRestaurantActive || ['restaurant', 'pharmacy', 'supermarket', 'grocery', 'food_beverage'].includes(pos.settingsQuery.data?.businessIndustry || '')));

  const handleOpenHeldOrTables = useCallback((initialTab: 'floor' | 'list' = 'floor') => {
    if (isRestaurantActive) {
      setRestaurantInitialTab(initialTab);
      setRestaurantTablesOpen(true);
    } else {
      setHeldDraftsDialogOpen(true);
    }
  }, [isRestaurantActive]);

  usePosWorkspaceKeyboardShortcuts({
    pos,
    focusBarcodeEntry,
    onOpenNewProduct: () => handleOpenNewProduct(),
    onOpenQuickService: isServicesActive ? () => setQuickServiceOpen(true) : undefined,
    printCurrentDraft,
    onRequestClearCart: requestClearCart,
    onRequestLineDelete: requestLineDelete,
    onRequestCheckout: requestCheckoutDialog,
    onOpenHeldDrafts: () => handleOpenHeldOrTables('floor'),
    onRecallHeldDraftByIndex: requestRecallHeldDraftByIndex,
    onOpenReprintModal: () => setReprintModalOpen(true),
    onOpenPhoneOrder: isPhoneOrdersActive ? () => handleOpenPhoneOrder() : undefined,
  });

  return (
    <div className={`page-stack page-shell pos-workspace pos-premium-shell pos-sale-mode-${posMode}`.trim()}>
      <PosWorkspaceHeader
        pos={pos}
        posMode={posMode}
        onModeChange={setPosMode}
        onFocusSearch={focusBarcodeEntry}
        onOpenNewProduct={() => handleOpenNewProduct()}
        onOpenQuickService={isServicesActive ? () => setQuickServiceOpen(true) : undefined}
        onOpenTables={() => handleOpenHeldOrTables('floor')}
        onOpenHeldDrafts={() => handleOpenHeldOrTables('list')}
        onOpenPhoneOrder={isPhoneOrdersActive ? () => handleOpenPhoneOrder() : undefined}
        onPrintDraft={printCurrentDraft}
        onRequestOpenShift={() => setOpenShiftModalOpen(true)}
        onOpenSerialLookup={() => setSerialLookupOpen(true)}
        onOpenReprintModal={() => setReprintModalOpen(true)}
        onPrintCupLabels={handlePrintCupLabels}
      />

      <PosWorkspaceMainContent
        pos={pos}
        posMode={posMode}
        catalogsLoading={catalogsLoading}
        catalogsError={catalogsError}
        allowNegativeStockSales={allowNegativeStockSales}
        searchInputRef={searchInputRef}
        cartQtySummaries={cartQtySummaries}
        cartItemsCount={cartItemsCount}
        onSubmitFirstSearchResult={submitFirstSearchResult}
        onRequestDiscountAuthorization={requestDiscountAuthorization}
        onRequestLineDelete={requestLineDelete}
        onItemModifiersClick={requestItemModifiers}
        onEditProduct={(id) => setEditProductId(id)}
        onRequestSelectedLineDelete={requestSelectedLineDelete}
        onRequestHeldDelete={requestHeldDelete}
        onRequestClearHeldDrafts={requestClearHeldDrafts}
        onRequestClearCart={requestClearCart}
        onRequestCheckout={requestCheckoutDialog}
        heldDraftsCount={pos.heldDraftSummaries.length}
        onOpenHeldDrafts={() => handleOpenHeldOrTables('floor')}
        onPrintCurrentDraft={printCurrentDraft}
        onFocusBarcodeEntry={focusBarcodeEntry}
        onRequestOpenShift={() => setOpenShiftModalOpen(true)}
        onOpenNewProduct={handleOpenNewProduct}
        onPriceTypeChange={handlePriceTypeChange}
      />

      <PosCheckoutDialog
        open={checkoutDialogOpen}
        pos={pos}
        selectedCustomerName={selectedCustomerName}
        onClose={() => {
          setCheckoutDialogOpen(false);
          focusBarcodeEntry();
        }}
        onOpenSplitBill={isRestaurantActive ? () => setSplitBillOpen(true) : undefined}
        onConfirmSale={(managerPin, tenderedAmount) => {
          void pos.handleSubmit({ managerPin, tenderedAmount }).then(() => {
            setCheckoutDialogOpen(false);
            focusBarcodeEntry();
          });
        }}
      />

      {splitBillOpen && (
        <PosSplitBillModal
          open={splitBillOpen}
          pos={pos}
          onClose={() => {
            setSplitBillOpen(false);
            focusBarcodeEntry();
          }}
          onSplitCompleted={() => {
            setSplitBillOpen(false);
            focusBarcodeEntry();
          }}
        />
      )}

      {discountApprovalDialogOpen && (
        <PosWorkspaceDiscountDialog
          open={discountApprovalDialogOpen}
          pos={pos}
          onClose={() => setDiscountApprovalDialogOpen(false)}
          onFocusBarcodeEntry={focusBarcodeEntry}
        />
      )}

      {wholesaleApprovalDialogOpen && (
        <PosWorkspaceWholesaleDialog
          open={wholesaleApprovalDialogOpen}
          pos={pos}
          onClose={() => setWholesaleApprovalDialogOpen(false)}
          onFocusBarcodeEntry={focusBarcodeEntry}
        />
      )}

      {/* 1. Restaurant Unified Floor & Orders Dialog (Restaurant Mode) */}
      {isRestaurantActive && restaurantTablesOpen && (
        <PosTablesFloorPlanDialog
          open={restaurantTablesOpen}
          onClose={() => {
            setRestaurantTablesOpen(false);
            focusBarcodeEntry();
          }}
          settings={pos.settingsQuery.data}
          currentTableNumber={pos.tableNumber}
          currentCartItemsCount={pos.cart.length}
          currentCartTotal={Number(pos.totals?.total || 0)}
          heldDrafts={pos.heldDraftSummaries || []}
          initialTab={restaurantInitialTab}
          isCurrentCheckPrinted={Boolean(pos.guestCheckPrintedAt)}
          onPrintGuestCheck={async (tableNum, draftId) => {
            if (tableNum === pos.tableNumber && pos.cart.length > 0) {
              pos.printGuestCheckNow();
              toast.success(`تمت طباعة شيك طاولة ${tableNum} بنجاح`);
              return;
            }
            const matchingDraft = pos.heldDrafts.find((d) => String(d.id) === String(draftId) || String(d.tableNumber).trim() === String(tableNum).trim());
            if (matchingDraft) {
              const subtotal = (matchingDraft.cart || []).reduce((sum, item) => {
                return sum + calcCartLineTotal(item);
              }, 0);
              const bookDigits = currencyMoneyDigits(pos.settingsQuery.data?.currency || getGlobalSystemCurrency());
              const discount = roundMoneyValue(Number(matchingDraft.discount || 0), bookDigits);
              const isServiceChargeActive = Boolean(
                (pos.settingsQuery.data as any)?.restaurantServiceChargeEnabled && matchingDraft.orderType === 'dine_in'
              );
              const serviceChargePercent = isServiceChargeActive
                ? Math.max(0, Number((pos.settingsQuery.data as any)?.restaurantServiceChargePercent ?? 0))
                : 0;
              const discounted = Math.max(0, subtotal - discount);
              const serviceCharge = serviceChargePercent > 0
                ? roundMoneyValue((discounted * serviceChargePercent) / 100, bookDigits)
                : 0;
              const taxRate = Number(pos.settingsQuery.data?.taxRate || 0);
              const baseBeforeTax = roundMoneyValue(discounted + serviceCharge, bookDigits);
              let taxAmount = 0;
              let total = 0;
              if (taxRate > 0) {
                if (String(pos.settingsQuery.data?.taxMode || 'exclusive') === 'inclusive') {
                  total = baseBeforeTax;
                  taxAmount = roundMoneyValue(baseBeforeTax - (baseBeforeTax / (1 + taxRate / 100)), bookDigits);
                } else {
                  taxAmount = roundMoneyValue(baseBeforeTax * (taxRate / 100), bookDigits);
                  total = roundMoneyValue(baseBeforeTax + taxAmount, bookDigits);
                }
              } else {
                total = baseBeforeTax;
              }

              printGuestCheck({
                tableNumber: tableNum,
                items: matchingDraft.cart || [],
                subtotal: roundMoneyValue(subtotal, bookDigits),
                discount,
                serviceCharge,
                taxAmount,
                total,
                guestCount: (matchingDraft as any).guestCount || 1,
                customerName: matchingDraft.customerName || matchingDraft.quickCustomerName || undefined,
                branchName: pos.currentBranch?.name,
                locationName: pos.currentLocation?.name,
                settings: pos.settingsQuery.data || null,
              });

              (matchingDraft as any).guestCheckPrintedAt = new Date().toISOString();
              const updatedHeld = pos.heldDrafts.map((d) => d.id === matchingDraft.id ? { ...matchingDraft } : d);
              persistHeldDrafts(updatedHeld);
              void posApi.saveHeldDraft(matchingDraft as any);
              toast.success(`تمت طباعة شيك طاولة ${tableNum} بنجاح`);
            }
          }}
          onSelectTable={async (tableNum) => {
            if (pos.cart.length > 0 && pos.tableNumber && pos.tableNumber !== tableNum) {
              await pos.holdDraft();
            }
            pos.setOrderType('dine_in');
            pos.setTableNumber(tableNum);
            pos.setCustomerId('');
            pos.setQuickCustomerName('');
            pos.setQuickCustomerPhone('');
            pos.setQuickCustomerAddress('');
          }}
          onSeatReservation={async (tableNum, guestCount, guestName) => {
            if (pos.cart.length > 0 && pos.tableNumber && pos.tableNumber !== tableNum) {
              await pos.holdDraft();
            }
            pos.setOrderType('dine_in');
            pos.setTableNumber(tableNum);
            pos.setGuestCount(guestCount || 1);
            if (guestName) {
              pos.setQuickCustomerName(guestName);
            }
            setRestaurantTablesOpen(false);
            toast.success(`تم إجلاس الضيف على طاولة ${tableNum} بعدد ${guestCount} أفراد.`);
          }}
          onRecallDraft={async (draftId) => {
            if (pos.cart.length > 0) {
              await pos.holdDraft();
            }
            await pos.recallDraft(draftId);
          }}
          onDeleteDraft={async (draftId) => {
            await pos.deleteDraft(draftId);
          }}
          onClearAllDrafts={async () => {
            await pos.clearHeldDrafts();
          }}
          onTransferTable={(from, to) => {
            pos.setTableNumber(to);
            pos.setSubmitMessage(`تم نقل الطلب بنجاح من طاولة ${from} إلى طاولة ${to}.`);
          }}
          rawHeldDrafts={pos.heldDrafts}
          currentCartItems={pos.cart}
          onTransferItems={async (sourceTable, targetTable, transferredItems) => {
            // 1. Deduct from source
            if (sourceTable === pos.tableNumber) {
              const updatedCart = [...pos.cart];
              for (const item of transferredItems) {
                const idx = updatedCart.findIndex((c) => String(c.productId) === String(item.productId) && c.price === item.price);
                if (idx !== -1) {
                  if (updatedCart[idx].qty > item.qty) {
                    updatedCart[idx] = { ...updatedCart[idx], qty: updatedCart[idx].qty - item.qty };
                  } else {
                    updatedCart.splice(idx, 1);
                  }
                }
              }
              pos.setCart(updatedCart);
            } else {
              const sourceDraft = pos.heldDrafts.find((d) => String(d.tableNumber).trim() === String(sourceTable).trim());
              if (sourceDraft && sourceDraft.cart) {
                const updatedDraftCart = [...sourceDraft.cart];
                for (const item of transferredItems) {
                  const idx = updatedDraftCart.findIndex((c) => String(c.productId) === String(item.productId) && c.price === item.price);
                  if (idx !== -1) {
                    if (updatedDraftCart[idx].qty > item.qty) {
                      updatedDraftCart[idx] = { ...updatedDraftCart[idx], qty: updatedDraftCart[idx].qty - item.qty };
                    } else {
                      updatedDraftCart.splice(idx, 1);
                    }
                  }
                }
                if (updatedDraftCart.length === 0) {
                  await pos.deleteDraft(sourceDraft.id);
                } else {
                  sourceDraft.cart = updatedDraftCart;
                  await posApi.saveHeldDraft(sourceDraft as any);
                }
              }
            }

            // 2. Add to target
            if (targetTable === pos.tableNumber) {
              const targetCart = [...pos.cart];
              for (const item of transferredItems) {
                const idx = targetCart.findIndex((c) => String(c.productId) === String(item.productId) && c.price === item.price);
                if (idx !== -1) {
                  targetCart[idx] = { ...targetCart[idx], qty: Number(targetCart[idx].qty || 0) + Number(item.qty || 0) };
                } else {
                  targetCart.push(item as any);
                }
              }
              pos.setCart(targetCart);
            } else {
              const targetDraft = pos.heldDrafts.find((d) => String(d.tableNumber).trim() === String(targetTable).trim());
              if (targetDraft && targetDraft.cart) {
                const targetCart = [...targetDraft.cart];
                for (const item of transferredItems) {
                  const idx = targetCart.findIndex((c) => String(c.productId) === String(item.productId) && c.price === item.price);
                  if (idx !== -1) {
                    targetCart[idx] = { ...targetCart[idx], qty: Number(targetCart[idx].qty || 0) + Number(item.qty || 0) };
                  } else {
                    targetCart.push(item as any);
                  }
                }
                targetDraft.cart = targetCart;
                await posApi.saveHeldDraft(targetDraft as any);
              } else {
                const newDraftId = `draft-${Date.now()}`;
                await posApi.saveHeldDraft({
                  id: newDraftId,
                  tableNumber: targetTable,
                  orderType: 'dine_in',
                  cart: transferredItems as any,
                  discount: 0,
                  createdAt: new Date().toISOString(),
                } as any);
              }
            }
            toast.success(`تم نقل ${transferredItems.length} صنف بنجاح من طاولة ${sourceTable} إلى طاولة ${targetTable}`);
          }}
          onMergeTable={async (from, to) => {
            const targetDraft = pos.heldDrafts.find((d) => String(d.tableNumber).trim() === String(to).trim());
            if (targetDraft && targetDraft.cart?.length) {
              const mergedCart = [...pos.cart];
              for (const targetItem of targetDraft.cart) {
                const existingIdx = mergedCart.findIndex(
                  (c) => c.productId === targetItem.productId && c.unitId === targetItem.unitId && c.price === targetItem.price
                );
                if (existingIdx !== -1) {
                  mergedCart[existingIdx] = {
                    ...mergedCart[existingIdx],
                    qty: Number(mergedCart[existingIdx].qty || 0) + Number(targetItem.qty || 0),
                  };
                } else {
                  mergedCart.push(targetItem);
                }
              }
              pos.setCart(mergedCart);
              await pos.deleteDraft(targetDraft.id);
            }
            pos.setTableNumber(to);
            pos.setSubmitMessage(`تم دمج طلب طاولة ${from} مع طاولة ${to} بنجاح.`);
          }}
        />
      )}

      {/* 2. Standard Retail Held Drafts Dialog (Non-Restaurant Mode) */}
      {heldDraftsDialogOpen && !isRestaurantActive && (
        <PosHeldDraftsDialog
          open={heldDraftsDialogOpen && !isRestaurantActive}
          heldDrafts={pos.heldDraftSummaries}
          requestedRecallDraftId={shortcutRecallDraftId}
          onRequestedRecallHandled={() => setShortcutRecallDraftId('')}
          onClose={() => {
            setHeldDraftsDialogOpen(false);
            setShortcutRecallDraftId('');
            focusBarcodeEntry();
          }}
          onRecall={async (draftId) => { 
            if (pos.cart.length > 0) {
              await pos.holdDraft();
            }
            await pos.recallDraft(draftId); 
          }}
          onDelete={async (draftId) => { await pos.deleteDraft(draftId); }}
          onClearAll={async () => { await pos.clearHeldDrafts(); }}
          settings={pos.settingsQuery.data}
        />
      )}

      <PosWorkspaceConfirmDialogs
        clearCartConfirmOpen={clearCartConfirmOpen}
        lineDeleteConfirmItem={lineDeleteConfirmItem}
        heldDeleteConfirmDraft={heldDeleteConfirmDraft}
        clearHeldConfirmOpen={clearHeldConfirmOpen}
        heldDraftsCount={pos.heldDraftSummaries.length}
        onCancelClearCart={() => {
          setClearCartConfirmOpen(false);
          focusBarcodeEntry();
        }}
        onConfirmClearCart={() => {
          pos.resetPosDraft();
          setClearCartConfirmOpen(false);
        }}
        onCancelLineDelete={() => {
          setLineDeleteConfirmKey('');
          focusBarcodeEntry();
        }}
        onConfirmLineDelete={() => {
          if (lineDeleteConfirmKey) pos.removeItem(lineDeleteConfirmKey);
          setLineDeleteConfirmKey('');
          focusBarcodeEntry();
        }}
        onCancelHeldDelete={() => {
          setHeldDeleteConfirmId('');
          focusBarcodeEntry();
        }}
        onConfirmHeldDelete={async () => {
          if (heldDeleteConfirmId) await pos.deleteDraft(heldDeleteConfirmId);
          setHeldDeleteConfirmId('');
          focusBarcodeEntry();
        }}
        onCancelClearHeld={() => {
          setClearHeldConfirmOpen(false);
          focusBarcodeEntry();
        }}
        onConfirmClearHeld={async () => {
          await pos.clearHeldDrafts();
          setClearHeldConfirmOpen(false);
          focusBarcodeEntry();
        }}
      />

      <PosSaleSuccessDialog
        open={saleSuccessDialogOpen && Boolean(pos.lastSale)}
        sale={pos.lastSale}
        customer={lastSaleCustomer}
        settings={pos.settingsQuery.data || null}
        onClose={() => {
          pos.completePostSaleCycle();
          setSaleSuccessDialogOpen(false);
          focusBarcodeEntry();
        }}
        onNewSale={() => {
          pos.completePostSaleCycle();
          setSaleSuccessDialogOpen(false);
          focusBarcodeEntry();
        }}
        onPrintReceipt={pos.printReceiptNow}
        onPrintDualReceipt={pos.printDualReceiptNow}
        onPrintA4={pos.printA4Now}
        onPrintKitchen={pos.printKitchenNow}
        onPrintBoth={pos.printBothNow}
      />

      {reprintModalOpen && (
        <PosRecentSalesReprintModal
          isOpen={reprintModalOpen}
          onClose={() => {
            setReprintModalOpen(false);
            focusBarcodeEntry();
          }}
          lastSale={pos.lastSale}
          settings={pos.settingsQuery.data || null}
          cashierName={(pos.ownOpenShift as any)?.openedByName || '—'}
          onReprintLastSale={() => {
            pos.reprintLastSale();
          }}
        />
      )}

      <PosDraftSwitcherOverlay
        drafts={pos.heldDraftSummaries}
        onRecall={requestRecallHeldDraftByIndex}
      />

      <PosItemModifiersModal
        open={Boolean(modifiersModalLineKey)}
        onClose={() => {
          setModifiersModalLineKey('');
          focusBarcodeEntry();
        }}
        item={pos.cart.find((item) => item.lineKey === modifiersModalLineKey) || null}
        onSave={(modifiers) => {
          if (modifiersModalLineKey) {
            pos.setItemModifiers(modifiersModalLineKey, modifiers);
          }
        }}
      />

      {openShiftModalOpen && (
        <PosOpenShiftModal
          open={openShiftModalOpen}
          onClose={() => {
            setOpenShiftModalOpen(false);
            focusBarcodeEntry();
          }}
          branches={pos.branchesQuery.data || []}
          locations={pos.locationsQuery.data || []}
          defaultBranchId={pos.branchId}
          defaultLocationId={pos.locationId}
          requirePassword={Boolean(pos.settings?.requirePasswordOnShiftOpen)}
          onShiftOpened={() => {
            void pos.refetchCatalogs();
          }}
        />
      )}

      {serialLookupOpen && (
        <SerialLookupModal
          open={serialLookupOpen}
          onClose={() => {
            setSerialLookupOpen(false);
            focusBarcodeEntry();
          }}
        />
      )}

      {quickServiceOpen && (
        <QuickProductModal
          isOpen={quickServiceOpen}
          onClose={() => setQuickServiceOpen(false)}
          itemType="service"
          onSuccess={(newServiceProduct) => {
            pos.handleAddProduct(newServiceProduct);
            focusBarcodeEntry();
          }}
        />
      )}

      {newProductModalOpen && (
        <PosNewProductModal
          isOpen={newProductModalOpen}
          onClose={() => {
            setNewProductModalOpen(false);
            focusBarcodeEntry();
          }}
          initialName={newProductInitialName}
          initialBarcode={newProductInitialBarcode}
          onSuccess={(newProduct) => {
            setNewProductModalOpen(false);
            if (newProduct.itemKind === 'fashion' && newProduct.styleCode) {
              // A grouped creation returns its first variant, not the customer's size.
              const suffix = [newProduct.color, newProduct.size].filter(Boolean).join(' / ');
              const baseName = suffix && newProduct.name.endsWith(` - ${suffix}`)
                ? newProduct.name.slice(0, -(` - ${suffix}`).length) : newProduct.name;
              pos.setSearch(baseName);
              toast.warning('الموديل اتضاف. اختار اللون والمقاس المطلوب من النتائج قبل إضافته للسلة.');
            } else {
              pos.handleAddProduct(newProduct);
              pos.setSearch('');
            }
            focusBarcodeEntry();
          }}
        />
      )}

      {editProductId && (
        <Suspense fallback={null}>
          <LazyPosEditProductModal
            isOpen={Boolean(editProductId)}
            productId={editProductId}
            initialProduct={editProduct}
            onClose={() => {
              setEditProductId(null);
              focusBarcodeEntry();
            }}
            onSuccess={handleProductUpdatedFromModal}
          />
        </Suspense>
      )}

      <PosScannedInvoiceModal
        sale={scannedSale}
        isOpen={scannedSaleModalOpen}
        onClose={() => {
          setScannedSaleModalOpen(false);
          setScannedSale(null);
          focusBarcodeEntry();
        }}
        settings={pos.settingsQuery.data}
        onOpenReturns={(targetSale) => {
          setScannedSaleModalOpen(false);
          setScannedSale(null);
          navigate(`/returns?invoiceId=${targetSale.id}&docNo=${encodeURIComponent(targetSale.docNo || '')}`);
        }}
      />

      {isPhoneOrdersActive && (
        <>
          <PosCallerIdFloatingAlert onOpenPhoneOrder={handleOpenPhoneOrder} />
          <PosPhoneOrderDialog
            open={phoneOrderOpen}
            onClose={() => {
              setPhoneOrderOpen(false);
              focusBarcodeEntry();
            }}
            pos={pos}
            initialPhone={phoneOrderInitialPhone}
            initialName={phoneOrderInitialName}
          />
        </>
      )}
    </div>
  );
}
