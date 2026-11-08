import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import type { AppSettings, Branch, Category, Location, Product, Supplier } from '@/types/domain';
import { buildPurchaseDraftItem, upsertPurchaseDraftItem, type PurchaseDraftItem } from '@/features/purchases/contracts';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { useCreatePurchaseMutation } from '@/features/purchases/hooks/useCreatePurchaseMutation';
import { checkDuplicateBill, type DuplicateBillCheckResult, type PurchaseRepricingInsights } from '@/features/purchases/api/purchases.api';
import { purchaseHeaderSchema, purchaseLineSchema, type PurchaseHeaderInput, type PurchaseHeaderOutput } from '@/features/purchases/schemas/purchase.schema';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { sharedProductsApi } from '@/shared/api/products';
import { invalidateCatalogDomain } from '@/app/query-invalidation';
import { queryKeys } from '@/app/query-keys';
import type { PurchaseQuickCreateDraft } from '@/features/purchases/components/purchase-composer/PurchaseQuickCreateDialog';
import { extractCreatedEntityId } from '@/lib/api/extract-created-entity-id';

const DEFAULT_HEADER_VALUES: PurchaseHeaderInput = { supplierId: '', supplierInvoiceNo: '', paymentType: 'cash', discount: 0, freight: 0, branchId: '', locationId: '', note: '' };
const DEFAULT_QUICK_CREATE_DRAFT: PurchaseQuickCreateDraft = {
  name: '',
  barcode: '',
  categoryId: '',
  supplierId: '',
  unitName: 'قطعة',
  costPrice: 0,
  retailPrice: 0,
  wholesalePrice: 0,
  minStock: 0,
  itemType: 'product',
};

function buildDefaultHeaderValues(branches: Branch[], locations: Location[]): PurchaseHeaderInput {
  return {
    ...DEFAULT_HEADER_VALUES,
    branchId: SINGLE_STORE_MODE ? String(branches[0]?.id || '') : '',
    locationId: SINGLE_STORE_MODE ? String(locations[0]?.id || '') : '',
  };
}

function resetLineDraft(
  setLineProductId: (value: string) => void,
  setLineQty: (value: number) => void,
  setLineCost: (value: number) => void,
  setLineError: (value: string) => void,
  setProductSearch: (value: string) => void,
) {
  setLineProductId('');
  setLineQty(1);
  setLineCost(0);
  setLineError('');
  setProductSearch('');
}

function createProductPayload(draft: PurchaseQuickCreateDraft) {
  const categoryId = draft.categoryId ? Number(draft.categoryId) : undefined;
  const supplierId = draft.supplierId ? Number(draft.supplierId) : undefined;
  const unitName = draft.unitName.trim() || 'قطعة';
  return {
    name: draft.name.trim(),
    barcode: draft.barcode.trim(),
    // INV-SERVICE-ITEM-QUICK-CREATE: quick-create used to hardcode a
    // stocked product; the dialog's type choice is honoured here.
    itemType: draft.itemType === 'service' ? 'service' : 'product',
    itemKind: 'standard',
    costPrice: Number(draft.costPrice || 0),
    retailPrice: Number(draft.retailPrice || 0),
    wholesalePrice: Number(draft.wholesalePrice || draft.retailPrice || 0),
    minStock: Number(draft.minStock || 0),
    ...(categoryId ? { categoryId } : {}),
    ...(supplierId ? { supplierId } : {}),
    notes: '',
    units: [{
      name: unitName,
      multiplier: 1,
      barcode: draft.barcode.trim(),
      isBaseUnit: true,
      isSaleUnit: true,
      isPurchaseUnit: true,
    }],
    offers: [],
    customerPrices: [],
    fashionVariants: [],
  };
}

function buildProductSearchLabel(product: Product) {
  return product.barcode ? `${product.name} — ${product.barcode}` : product.name;
}

function isProductMatch(product: Product, normalizedSearch: string) {
  const haystack = [
    product.name,
    product.barcode,
    product.styleCode,
    ...(product.units || []).flatMap((unit) => [unit.name, unit.barcode]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedSearch);
}

function isExactProductMatch(product: Product, normalizedSearch: string) {
  const exactCandidates = [
    product.name,
    product.barcode,
    product.styleCode,
    ...(product.units || []).flatMap((unit) => [unit.name, unit.barcode]),
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());

  return exactCandidates.includes(normalizedSearch);
}

export function usePurchaseComposerController({
  products,
  suppliers,
  categories,
  branches,
  locations,
  settings,
}: {
  products: Product[];
  suppliers: Supplier[];
  categories: Category[];
  branches: Branch[];
  locations: Location[];
  settings?: AppSettings;
}) {
  const queryClient = useQueryClient();
  const headerForm = useForm<PurchaseHeaderInput, undefined, PurchaseHeaderOutput>({
    resolver: zodResolver(purchaseHeaderSchema),
    defaultValues: buildDefaultHeaderValues(branches, locations),
  });
  const [items, setItems] = useState<PurchaseDraftItem[]>([]);
  const [lineProductId, setLineProductId] = useState('');
  const [lineQty, setLineQty] = useState(1);
  const [lineCost, setLineCost] = useState(0);
  const [lineError, setLineError] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [repricingInsights, setRepricingInsights] = useState<PurchaseRepricingInsights | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateDraft, setQuickCreateDraft] = useState<PurchaseQuickCreateDraft>(DEFAULT_QUICK_CREATE_DRAFT);

  const hasDraftChanges = headerForm.formState.isDirty || items.length > 0 || Boolean(lineProductId) || lineQty !== 1 || lineCost !== 0;
  const mutation = useCreatePurchaseMutation((result) => {
    headerForm.reset(buildDefaultHeaderValues(branches, locations));
    setItems([]);
    resetLineDraft(setLineProductId, setLineQty, setLineCost, setLineError, setProductSearch);
    setRepricingInsights(result.repricingInsights || null);
  });
  const canNavigateAway = useUnsavedChangesGuard(hasDraftChanges && !mutation.isPending);

  const quickCreateMutation = useMutation({
    mutationFn: async (draft: PurchaseQuickCreateDraft) => sharedProductsApi.create(createProductPayload(draft)),
    onSuccess: async (created, draft) => {
      await invalidateCatalogDomain(queryClient, { includeProducts: true, includeCategories: true, includeSuppliers: true });
      const refreshedProducts = await queryClient.fetchQuery({ queryKey: queryKeys.products, queryFn: sharedProductsApi.list });
      const createdProductId = extractCreatedEntityId(created);
      const createdProduct = (createdProductId
        ? refreshedProducts.find((product) => String(product.id) === createdProductId)
        : null)
        || refreshedProducts.find((product) => (
          product.name.trim().toLowerCase() === draft.name.trim().toLowerCase()
          && String(product.barcode || '').trim().toLowerCase() === draft.barcode.trim().toLowerCase()
        ))
        || refreshedProducts.find((product) => product.name.trim().toLowerCase() === draft.name.trim().toLowerCase())
        || null;
      if (createdProduct) {
        setLineProductId(String(createdProduct.id));
        setLineCost(Number(createdProduct.costPrice || draft.costPrice || 0));
        setProductSearch(buildProductSearchLabel(createdProduct));
      }
      setQuickCreateOpen(false);
      setQuickCreateDraft({
        ...DEFAULT_QUICK_CREATE_DRAFT,
        supplierId: headerForm.getValues('supplierId') || '',
      });
      setLineError('');
    },
  });

  useEffect(() => {
    if (!SINGLE_STORE_MODE) return;
    if (!headerForm.getValues('branchId') && branches[0]?.id) headerForm.setValue('branchId', String(branches[0].id));
    if (!headerForm.getValues('locationId') && locations[0]?.id) headerForm.setValue('locationId', String(locations[0].id));
  }, [branches, headerForm, locations]);

  // INV-FE2-FRONTEND-BOOK-DIGITS: every computed purchase total rounds
  // at the tenant's book digits (the global system currency is synced
  // from tenant settings at boot in app/providers.tsx). The draft items
  // are priced in the tenant base currency, so the tenant digits apply.
  // NOTE: bookDigits must stay above subTotal — the memos below read it
  // on first render, and a `const` declared later would throw in TDZ.
  const bookDigits = currencyMoneyDigits(getGlobalSystemCurrency());
  const subTotal = useMemo(() => roundMoneyValue(items.reduce((sum, item) => sum + item.total, 0), bookDigits), [items, bookDigits]);
  const discount = Math.max(0, Number(headerForm.watch('discount') || 0));
  // INV-LANDED-COST-ALLOCATION: freight is added to the invoice total
  // after tax (never taxed), matching the backend posting.
  const freight = Math.max(0, Number(headerForm.watch('freight') || 0));
  const taxRate = Number(settings?.taxRate || 0);
  const pricesIncludeTax = String(settings?.taxMode || 'exclusive') === 'inclusive';
  const taxAmount = useMemo(() => {
    const taxable = Math.max(0, subTotal - discount);
    if (!taxRate) return 0;
    if (pricesIncludeTax) return roundMoneyValue(taxable - taxable / (1 + taxRate / 100), bookDigits);
    return roundMoneyValue(taxable * (taxRate / 100), bookDigits);
  }, [bookDigits, discount, pricesIncludeTax, subTotal, taxRate]);
  const total = useMemo(() => {
    const taxable = Math.max(0, subTotal - discount);
    const withoutFreight = pricesIncludeTax ? roundMoneyValue(taxable, bookDigits) : roundMoneyValue(taxable + taxAmount, bookDigits);
    return roundMoneyValue(withoutFreight + freight, bookDigits);
  }, [bookDigits, discount, freight, pricesIncludeTax, subTotal, taxAmount]);

  const [duplicateCheckResult, setDuplicateCheckResult] = useState<DuplicateBillCheckResult | null>(null);
  const [confirmedDuplicateWarning, setConfirmedDuplicateWarning] = useState<boolean>(false);
  const [allowDuplicateOverride, setAllowDuplicateOverride] = useState<boolean>(false);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState<string>('');

  const watchedSupplierId = headerForm.watch('supplierId');
  const watchedInvoiceNo = headerForm.watch('supplierInvoiceNo');

  useEffect(() => {
    if (!watchedSupplierId) {
      setDuplicateCheckResult(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await checkDuplicateBill({
          supplierId: Number(watchedSupplierId),
          supplierInvoiceNo: watchedInvoiceNo || undefined,
          total: total > 0 ? total : undefined,
        });
        setDuplicateCheckResult(res);
      } catch {
        // non-blocking
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [watchedSupplierId, watchedInvoiceNo, total]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = productSearch.trim().toLowerCase();
    if (!normalizedSearch) return products.slice(0, 10);
    return products.filter((product) => isProductMatch(product, normalizedSearch)).slice(0, 10);
  }, [productSearch, products]);

  const selectedProduct = useMemo(
    () => products.find((entry) => String(entry.id) === String(lineProductId)) || null,
    [lineProductId, products],
  );

  const selectProduct = useCallback((product: Product) => {
    setLineProductId(String(product.id));
    setLineCost(Number(product.costPrice || 0));
    setProductSearch(buildProductSearchLabel(product));
    setLineError('');
  }, []);

  const handleProductSearchChange = useCallback((value: string) => {
    setProductSearch(value);
    setLineError('');
    const normalizedSearch = value.trim().toLowerCase();
    if (!normalizedSearch) {
      setLineProductId('');
      return;
    }

    const exactMatches = products.filter((product) => isExactProductMatch(product, normalizedSearch));
    if (exactMatches.length === 1) {
      selectProduct(exactMatches[0]);
      return;
    }

    setLineProductId((current) => {
      const currentProduct = products.find((entry) => String(entry.id) === String(current));
      if (!currentProduct) return '';
      return buildProductSearchLabel(currentProduct).toLowerCase() === normalizedSearch ? current : '';
    });
  }, [products, selectProduct]);

  const handleProductSelect = useCallback((productId: string) => {
    const product = products.find((entry) => String(entry.id) === String(productId));
    if (product) selectProduct(product);
  }, [products, selectProduct]);

  const handleAddItem = useCallback(() => {
    if (!String(lineProductId || '').trim()) {
      setLineError('اختر صنف من القائمة أو أضف صنف جديد');
      return;
    }

    try {
      const parsed = purchaseLineSchema.parse({ productId: lineProductId, qty: lineQty, cost: lineCost });
      const product = products.find((entry) => String(entry.id) === String(parsed.productId));
      if (!product) throw new Error('الصنف المختار غير موجود');
      setItems((current) => upsertPurchaseDraftItem(current, buildPurchaseDraftItem(product, parsed.qty, parsed.cost, bookDigits), bookDigits));
      resetLineDraft(setLineProductId, setLineQty, setLineCost, setLineError, setProductSearch);
      mutation.reset();
    } catch (error) {
      setLineError(error instanceof Error ? error.message : 'تعذر إضافة الصنف إلى الفاتورة');
    }
  }, [lineCost, lineProductId, lineQty, mutation, products]);

  const handleRemoveItem = useCallback((productId: string, unitName: string) => {
    setItems((current) => current.filter((entry) => !(entry.productId === productId && entry.unitName === unitName)));
  }, []);

  const handleReset = useCallback((force = false) => {
    if (!force && hasDraftChanges && !canNavigateAway()) return;
    headerForm.reset(buildDefaultHeaderValues(branches, locations));
    setItems([]);
    resetLineDraft(setLineProductId, setLineQty, setLineCost, setLineError, setProductSearch);
    mutation.reset();
  }, [branches, canNavigateAway, hasDraftChanges, headerForm, locations, mutation]);

  const openQuickCreateDialog = useCallback(() => {
    setQuickCreateDraft((current) => ({
      ...current,
      supplierId: current.supplierId || headerForm.getValues('supplierId') || '',
    }));
    setQuickCreateOpen(true);
  }, [headerForm]);

  const closeQuickCreateDialog = useCallback(() => {
    setQuickCreateOpen(false);
  }, []);

  const handleQuickCreateSubmit = useCallback(async () => {
    await quickCreateMutation.mutateAsync(quickCreateDraft);
  }, [quickCreateDraft, quickCreateMutation]);

  return {
    headerForm,
    items,
    lineDraft: {
      lineProductId,
      lineQty,
      lineCost,
      lineError,
      productSearch,
      filteredProducts,
      selectedProductName: selectedProduct ? buildProductSearchLabel(selectedProduct) : '',
    },
    mutation,
    repricingInsights,
    hasDraftChanges,
    totals: { subTotal, discount, freight, taxRate, pricesIncludeTax, taxAmount, total },
    duplicateCheck: {
      result: duplicateCheckResult,
      confirmedWarning: confirmedDuplicateWarning,
      setConfirmedWarning: setConfirmedDuplicateWarning,
      allowOverride: allowDuplicateOverride,
      setAllowOverride: setAllowDuplicateOverride,
      overrideReason: duplicateOverrideReason,
      setOverrideReason: setDuplicateOverrideReason,
    },
    quickCreate: {
      open: quickCreateOpen,
      draft: quickCreateDraft,
      mutation: quickCreateMutation,
      categories,
      suppliers,
    },
    actions: {
      setLineQty,
      setLineCost,
      handleProductSearchChange,
      handleProductSelect,
      handleAddItem,
      handleRemoveItem,
      handleReset,
      setRepricingInsights,
      openQuickCreateDialog,
      closeQuickCreateDialog,
      setQuickCreateDraft,
      handleQuickCreateSubmit,
    },
  };
}
