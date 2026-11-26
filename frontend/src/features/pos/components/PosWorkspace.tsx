import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PosWorkspaceHeader } from '@/features/pos/components/pos-workspace/PosWorkspaceHeader';
import { PosWorkspaceMainContent } from '@/features/pos/components/pos-workspace/PosWorkspaceMainContent';
import { PosWorkspaceCheckoutDialogs } from '@/features/pos/components/pos-workspace/pos-workspace/PosWorkspaceCheckoutDialogs';
import { PosWorkspaceTablesDialog } from '@/features/pos/components/pos-workspace/pos-workspace/PosWorkspaceTablesDialog';
import { PosWorkspaceHeldDraftsDialog } from '@/features/pos/components/pos-workspace/pos-workspace/PosWorkspaceHeldDraftsDialog';
import { PosWorkspaceConfirmDialogsSection } from '@/features/pos/components/pos-workspace/pos-workspace/PosWorkspaceConfirmDialogsSection';
import { PosWorkspaceAuxDialogs1 } from '@/features/pos/components/pos-workspace/pos-workspace/PosWorkspaceAuxDialogs1';
import { PosWorkspaceAuxDialogs2 } from '@/features/pos/components/pos-workspace/pos-workspace/PosWorkspaceAuxDialogs2';
import { printOrderCupLabels } from '@/lib/pos-printing/cup-label';
import { salesApi } from '@/features/sales';
import { getPostSalePrintMode, getSelectedCustomerName, printCurrentPosDraft } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import { isPosModalOpen } from '@/features/pos/lib/pos-keyboard-safety';
import { posApi } from '@/features/pos/api/pos.api';
import { isNegativeStockSalesAllowed, repriceCartLine, getProductItemCode, getSaleUnit, summarizeCartQuantities } from '@/features/pos/lib/pos.domain';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits } from '@/shared/utils/money';
import { isLikelyBarcodeQuery } from '@/features/pos/lib/pos-product-lookup';
import { normalizePosSaleMode, usePosSaleMode } from '@/features/pos/lib/pos-sale-mode';
import { matchProductByCode } from '@/features/pos/lib/pos-workspace.helpers';
import { parseWeightedBarcode, matchProductByWeightedCode } from '@/features/pos/lib/weighted-barcode';
import { resolveRemoteWeightedBarcode } from '@/features/pos/lib/pos-remote-weighted-barcode';
import { parseQuantityPrefixQuery } from '@/features/pos/lib/pos-quantity-prefix';
import { lookupProductByBarcodeFromStorage } from '@/features/pos/lib/pos-catalog-storage';
import { useAuthStore } from '@/stores/auth-store';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import { usePosWorkspace } from '@/features/pos/hooks/usePosWorkspace';
import { usePosWorkspaceKeyboardShortcuts } from '@/features/pos/hooks/usePosWorkspaceKeyboardShortcuts';
import {
  getBarcodeLookupCandidates,
  isInvoiceBarcodeQuery,
  getNormalizedInvoiceSearchTerms,
  matchesSaleDocNo,
  remapArabicKeyboardToEnglish,
  shouldSkipInvoiceSearch,
} from '@/features/pos/lib/pos-barcode-normalizer';
import type { PosPriceType } from '@/features/pos/types/pos.types';
import type { Product, Sale } from '@/types/domain';
import { toast } from '@/shared/components/system-alert';
import { HardwareBridgeClient } from '@/features/pos/lib/hardware-bridge-client';
import { resolveBridgePrinter } from '@/lib/printer-preferences';
import { warmReceiptLogoDataUri } from '@/lib/pos-printing/logo-cache';


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
  const [splitBillManagerPin, setSplitBillManagerPin] = useState('');
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

  // F12 (trial problem 15): double-clicking a cart line opens the
  // FULL product editor (EditProductForm incl. buy/cost price) with
  // no permission check at all — anyone who can open POS could open
  // it and read cost prices, even without the 'products' permission
  // (the save itself already 403s server-side without it). Only a
  // 'products' holder gets the affordance. Residual, by design: a
  // rep holding the cashier-default 'products' permission can still
  // open it — product edit is governed by 'products', not by
  // deliveryReps, and removing 'products' from the cashier default
  // would break the blessed cashier add-product workflow; that split
  // needs a user decision (see F12 report).
  const canEditProduct = useHasAnyPermission('products');
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

  /* INV-POS-COLD-ENTRY-CACHED-CATALOG-PAINT: productsQuery.isLoading is
   * deliberately NOT in this gate — the products panel mounts while the
   * catalog is still in flight and paints cached rows from IndexedDB
   * (usePosCatalog saleProducts) instead of hiding the whole workspace
   * behind "جارٍ تحميل بيانات الكاشير..." until the slowest of five
   * network queries resolves. */
  const catalogsLoading = pos.customersQuery.isLoading || pos.branchesQuery.isLoading || pos.locationsQuery.isLoading || pos.settingsQuery.isLoading;
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
  }, [
    /* POS render cost: field deps, NOT [pos]. The workspace object is a
     * fresh literal every render, so [pos] re-created this callback on
     * every pass and defeated the header's areEqual (onPrintDraft). These
     * are exactly the pos fields printCurrentPosDraft reads (cart, payment,
     * branch/location, totals, note, table, order type, settings); every
     * one is itself stable (state values, derived useMemos, query data)
     * unless its value really changes. Keep this list in sync with
     * printCurrentPosDraft's reads. */
    pos.cart,
    pos.paymentType,
    pos.paymentChannel,
    pos.currentBranch,
    pos.currentLocation,
    pos.totals,
    pos.note,
    pos.tableNumber,
    pos.orderType,
    pos.settingsQuery.data,
    selectedCustomerName,
    selectedCustomer?.phone,
    selectedCustomer?.address,
  ]);

  const focusBarcodeEntry = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
      return () => {};
    }
    if (isPosModalOpen()) return () => {};
    const handle = window.requestAnimationFrame(() => {
      if (isPosModalOpen()) return;
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
    if (!draftId) return;
    /* INV-REST-HOLD-RECALL-TRUTH (R5-B): the keyboard path had no
     * auto-hold at all — it wiped the live cart. Hold first; a failed
     * hold (or a failed recall) aborts and leaves the dialog open.
     * holdDraft / recallDraft already report the failure in the submit
     * message. */
    try {
      if (pos.cart.length > 0) {
        await pos.holdDraft();
      }
      await pos.recallDraft(draftId);
    } catch {
      return;
    }
    setHeldDraftsDialogOpen(false);
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
          await resolveRemoteWeightedBarcode({
            rawQuery, weightedBarcode, branchId: pos.branchId, locationId: pos.locationId, activeTenantId,
            lookupProducts: (lookupParams) => posApi.lookupProducts(lookupParams),
            lookupOfflineProduct: lookupProductByBarcodeFromStorage,
            submitWeightedProducts: (rawCode, matchedProducts) => pos.handleQuickAddCodeSubmit(rawCode, matchedProducts),
            setSearch: pos.setSearch, setSubmitMessage: pos.setSubmitMessage,
          });
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

        let sawAmbiguous = false;
        for (const candidate of getBarcodeLookupCandidates(query)) {
          let lookupProducts: Product[] = [];
          try {
            lookupProducts = await posApi.lookupProducts({ barcode: candidate, branchId: pos.branchId, locationId: pos.locationId, limit: 5 });
          } catch {
            const offlineItem = await lookupProductByBarcodeFromStorage(candidate, activeTenantId);
            if (offlineItem) lookupProducts = [offlineItem];
          }
          const candidateMatch = matchProductByCode(lookupProducts, candidate);
          if (candidateMatch.status === 'matched') {
            const submitted = pos.handleQuickAddCodeSubmit(candidate === query ? rawQuery : candidate, lookupProducts);
            if (submitted) { pos.setSearch(''); return; }
            // Product found but blocked (e.g. zero stock in this branch) — error already set by handleAddProduct
            focusBarcodeEntry();
            return;
          }
          if (candidateMatch.status === 'ambiguous') sawAmbiguous = true;
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

        if (sawAmbiguous) {
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

    const exactCodeMatch = matchProductByCode(pos.catalogProducts, query);

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
      const remappedLocalMatch = matchProductByCode(pos.catalogProducts, remappedQuery);
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
        const localWeightedMatch = matchProductByWeightedCode(pos.catalogProducts, weightedBarcode.productCode);
        if (localWeightedMatch.status === 'matched') {
          const submitted = handleQuickAddSubmit(raw);
          if (submitted) {
            pos.setSearch('');
            return true;
          }
          focusBarcodeEntry();
          return false;
        } else if (localWeightedMatch.status === 'ambiguous') {
          pos.setSubmitMessage(`كود الميزان ${weightedBarcode.productCode} مرتبط بأكثر من صنف أو وحدة. راجع كود الصنف أولًا.`);
          focusBarcodeEntry();
          return false;
        } else {
          resolveRemoteBarcodeMatch(raw);
          return true;
        }
      }
    }

    // If query is a numeric/remapped barcode (not an Arabic text product search)
    const barcodeCandidates = getBarcodeLookupCandidates(query);
    if (barcodeCandidates.some((c) => isLikelyBarcodeQuery(c) || /^\d+$/.test(c))) {
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

  // Keep the local Hardware Bridge awake (/events SSE) and pre-verify target Windows
  // printer handles + viewport width on POS mount so the very first receipt or barcode
  // label prints with 0ms health-check or setup latency.
  useEffect(() => {
    const settings = pos.settingsQuery.data;
    if (settings?.logoData) {
      warmReceiptLogoDataUri(settings.logoData);
    }
    const cashierPrinter = resolveBridgePrinter('cashier', settings);
    const docPrinter = resolveBridgePrinter('document', settings);
    const barcodePrinter = resolveBridgePrinter('barcode', settings);
    const configuredPrinters = Array.from(
      new Set([cashierPrinter, docPrinter, barcodePrinter].filter((p): p is string => Boolean(p))),
    );
    if (configuredPrinters.length === 0) return;

    const disconnect = HardwareBridgeClient.connectKeepAlive?.();
    if (typeof HardwareBridgeClient.isAvailable === 'function') {
      void HardwareBridgeClient.isAvailable().catch(() => undefined);
    }
    HardwareBridgeClient.warmPrinters?.({
      printers: configuredPrinters,
      pageSize: getPostSalePrintMode(settings || null) === 'a4' ? 'A4' : 'receipt',
      receiptWidthMm: settings?.receiptWidthMm === 58 ? 58 : 80,
    });
    return () => {
      disconnect?.();
    };
  }, [pos.settingsQuery.data]);

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

  /* POS render cost: stable header callbacks. The header is memo + custom
   * areEqual comparing onOpenNewProduct / onOpenQuickService /
   * onOpenHeldDrafts / onPrintDraft (and more) by identity, so the inline
   * arrows previously passed here re-rendered it on every workspace pass.
   * handleOpenNewProduct / handleOpenPhoneOrder are already stable
   * useCallbacks and are passed directly below; these wrappers only
   * pre-bind an argument or a constant setter call, and each dep is
   * itself stable (isRestaurantActive is a boolean derived from settings;
   * the setState setters are stable by React's guarantee). */
  const handleOpenTables = useCallback(() => handleOpenHeldOrTables('floor'), [handleOpenHeldOrTables]);
  const handleOpenHeldDrafts = useCallback(() => handleOpenHeldOrTables('list'), [handleOpenHeldOrTables]);
  const handleOpenQuickService = useCallback(() => setQuickServiceOpen(true), []);
  const handleRequestOpenShift = useCallback(() => setOpenShiftModalOpen(true), []);
  const handleOpenSerialLookup = useCallback(() => setSerialLookupOpen(true), []);
  const handleOpenReprintModal = useCallback(() => setReprintModalOpen(true), []);

  usePosWorkspaceKeyboardShortcuts({
    pos,
    focusBarcodeEntry,
    onOpenNewProduct: handleOpenNewProduct,
    onOpenQuickService: isServicesActive ? handleOpenQuickService : undefined,
    printCurrentDraft,
    onRequestClearCart: requestClearCart,
    onRequestLineDelete: requestLineDelete,
    onRequestCheckout: requestCheckoutDialog,
    onOpenHeldDrafts: handleOpenTables,
    onRecallHeldDraftByIndex: requestRecallHeldDraftByIndex,
    onOpenReprintModal: handleOpenReprintModal,
    onOpenPhoneOrder: isPhoneOrdersActive ? () => handleOpenPhoneOrder() : undefined,
  });

  return (
    <div className={`page-stack page-shell pos-workspace pos-premium-shell pos-sale-mode-${posMode}`.trim()}>
      <PosWorkspaceHeader
        pos={pos}
        posMode={posMode}
        onModeChange={setPosMode}
        onFocusSearch={focusBarcodeEntry}
        onOpenNewProduct={handleOpenNewProduct}
        onOpenQuickService={isServicesActive ? handleOpenQuickService : undefined}
        onOpenTables={handleOpenTables}
        onOpenHeldDrafts={handleOpenHeldDrafts}
        onOpenPhoneOrder={isPhoneOrdersActive ? handleOpenPhoneOrder : undefined}
        onPrintDraft={printCurrentDraft}
        onRequestOpenShift={handleRequestOpenShift}
        onOpenSerialLookup={handleOpenSerialLookup}
        onOpenReprintModal={handleOpenReprintModal}
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
        onEditProduct={canEditProduct ? setEditProductId : undefined}
        onRequestSelectedLineDelete={requestSelectedLineDelete}
        onRequestHeldDelete={requestHeldDelete}
        onRequestClearHeldDrafts={requestClearHeldDrafts}
        onRequestClearCart={requestClearCart}
        onRequestCheckout={requestCheckoutDialog}
        heldDraftsCount={pos.heldDraftSummaries.length}
        onOpenHeldDrafts={handleOpenTables}
        onPrintCurrentDraft={printCurrentDraft}
        onFocusBarcodeEntry={focusBarcodeEntry}
        onRequestOpenShift={handleRequestOpenShift}
        onOpenNewProduct={handleOpenNewProduct}
        onPriceTypeChange={handlePriceTypeChange}
      />

      <PosWorkspaceCheckoutDialogs
        checkoutDialogOpen={checkoutDialogOpen}
        pos={pos}
        selectedCustomerName={selectedCustomerName}
        setCheckoutDialogOpen={setCheckoutDialogOpen}
        focusBarcodeEntry={focusBarcodeEntry}
        isRestaurantActive={isRestaurantActive}
        setSplitBillManagerPin={setSplitBillManagerPin}
        setSplitBillOpen={setSplitBillOpen}
        splitBillOpen={splitBillOpen}
        splitBillManagerPin={splitBillManagerPin}
        discountApprovalDialogOpen={discountApprovalDialogOpen}
        setDiscountApprovalDialogOpen={setDiscountApprovalDialogOpen}
        wholesaleApprovalDialogOpen={wholesaleApprovalDialogOpen}
        setWholesaleApprovalDialogOpen={setWholesaleApprovalDialogOpen}
      />

      <PosWorkspaceTablesDialog
        pos={pos}
        isRestaurantActive={isRestaurantActive}
        restaurantTablesOpen={restaurantTablesOpen}
        setRestaurantTablesOpen={setRestaurantTablesOpen}
        focusBarcodeEntry={focusBarcodeEntry}
        restaurantInitialTab={restaurantInitialTab}
      />

      <PosWorkspaceHeldDraftsDialog
        heldDraftsDialogOpen={heldDraftsDialogOpen}
        isRestaurantActive={isRestaurantActive}
        pos={pos}
        shortcutRecallDraftId={shortcutRecallDraftId}
        setShortcutRecallDraftId={setShortcutRecallDraftId}
        setHeldDraftsDialogOpen={setHeldDraftsDialogOpen}
        focusBarcodeEntry={focusBarcodeEntry}
      />

      <PosWorkspaceConfirmDialogsSection
        clearCartConfirmOpen={clearCartConfirmOpen}
        lineDeleteConfirmItem={lineDeleteConfirmItem}
        heldDeleteConfirmDraft={heldDeleteConfirmDraft}
        clearHeldConfirmOpen={clearHeldConfirmOpen}
        pos={pos}
        setClearCartConfirmOpen={setClearCartConfirmOpen}
        focusBarcodeEntry={focusBarcodeEntry}
        setLineDeleteConfirmKey={setLineDeleteConfirmKey}
        lineDeleteConfirmKey={lineDeleteConfirmKey}
        setHeldDeleteConfirmId={setHeldDeleteConfirmId}
        heldDeleteConfirmId={heldDeleteConfirmId}
        setClearHeldConfirmOpen={setClearHeldConfirmOpen}
        saleSuccessDialogOpen={saleSuccessDialogOpen}
        lastSaleCustomer={lastSaleCustomer}
        setSaleSuccessDialogOpen={setSaleSuccessDialogOpen}
      />

      <PosWorkspaceAuxDialogs1
        reprintModalOpen={reprintModalOpen}
        setReprintModalOpen={setReprintModalOpen}
        focusBarcodeEntry={focusBarcodeEntry}
        pos={pos}
        requestRecallHeldDraftByIndex={requestRecallHeldDraftByIndex}
        modifiersModalLineKey={modifiersModalLineKey}
        setModifiersModalLineKey={setModifiersModalLineKey}
        openShiftModalOpen={openShiftModalOpen}
        setOpenShiftModalOpen={setOpenShiftModalOpen}
        serialLookupOpen={serialLookupOpen}
        setSerialLookupOpen={setSerialLookupOpen}
        quickServiceOpen={quickServiceOpen}
        setQuickServiceOpen={setQuickServiceOpen}
      />

      <PosWorkspaceAuxDialogs2
        newProductModalOpen={newProductModalOpen}
        setNewProductModalOpen={setNewProductModalOpen}
        focusBarcodeEntry={focusBarcodeEntry}
        newProductInitialName={newProductInitialName}
        newProductInitialBarcode={newProductInitialBarcode}
        pos={pos}
        editProductId={editProductId}
        editProduct={editProduct}
        setEditProductId={setEditProductId}
        handleProductUpdatedFromModal={handleProductUpdatedFromModal}
        scannedSale={scannedSale}
        scannedSaleModalOpen={scannedSaleModalOpen}
        setScannedSaleModalOpen={setScannedSaleModalOpen}
        setScannedSale={setScannedSale}
        navigate={navigate}
        isPhoneOrdersActive={isPhoneOrdersActive}
        handleOpenPhoneOrder={handleOpenPhoneOrder}
        phoneOrderOpen={phoneOrderOpen}
        setPhoneOrderOpen={setPhoneOrderOpen}
        phoneOrderInitialPhone={phoneOrderInitialPhone}
        phoneOrderInitialName={phoneOrderInitialName}
      />
    </div>
  );
}
