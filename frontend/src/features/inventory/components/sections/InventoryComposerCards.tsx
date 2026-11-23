import { useTranslation } from 'react-i18next';
import { buildCountLocationStockMap, filterCountableProductsAtLocation } from '@/features/inventory/lib/count-location-scoping';
import { classifyStockCountBarcodeScan } from '@/features/inventory/lib/count-barcode-identity';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FormSection } from '@/shared/components/form-section';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { useClientPagination } from '@/shared/hooks/use-client-pagination';
import { exportStockCountSheetExcel, printStockCountSheet, type StockCountSheetRow } from '@/features/inventory/lib/inventory-documents';
import { useCategoriesQuery, useSuppliersQuery } from '@/shared/hooks/use-catalog-queries';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import type { Branch, Location, Product, StockCountItem } from '@/types/domain';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { CheckCircleIcon } from '@/shared/components/icons/AppIcons';
import type { StockCountType } from './inventory-composer-cards/inventory-composer-cards-shared';
export { StockTransferComposerCard } from './inventory-composer-cards/stock-transfer-composer-card';
import { StockCountComposerSetup } from './inventory-composer-cards/stock-count-composer-setup';
import { StockCountComposerSessionBar } from './inventory-composer-cards/stock-count-composer-session-bar';
import { StockCountComposerToolbar } from './inventory-composer-cards/stock-count-composer-toolbar';
import { StockCountComposerQuickEntry } from './inventory-composer-cards/stock-count-composer-quick-entry';
import { StockCountComposerFilterBar } from './inventory-composer-cards/stock-count-composer-filter-bar';
import { StockCountComposerTable } from './inventory-composer-cards/stock-count-composer-table';

interface StockCountComposerCardProps {
  products: Product[];
  branches: Branch[];
  warehouses?: Location[];
  locations?: Location[];
  locationStocks?: Array<{ productId: number | string; locationId: number | string; qty: number }>;
  isLoadingCatalog?: boolean;
  form: { branchId: string; locationId: string; note: string; managerPin: string; productId: string; countedQty: string; reason: string; itemNote: string };
  items: StockCountItem[];
  canReviewStock: boolean;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error?: unknown;
  onFormChange: (patch: Partial<{ branchId: string; locationId: string; note: string; managerPin: string; productId: string; countedQty: string; reason: string; itemNote: string }>) => void;
  onItemsChange: (updater: (current: StockCountItem[]) => StockCountItem[]) => void;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  onSubmit: (options?: { noteOverride?: string }) => void;
}


export function StockCountComposerCard({
  products,
  branches,
  warehouses,
  locations,
  locationStocks,
  isLoadingCatalog,
  form,
  items,
  canReviewStock,
  isPending,
  isError,
  isSuccess,
  error,
  onFormChange,
  onItemsChange,
  onAddItem,
  onRemoveItem: _onRemoveItem,
  onSubmit
}: StockCountComposerCardProps) {
  const { t } = useTranslation();
  const warehouseList = warehouses || locations || [];
  const selectedLocation = warehouseList.find((location) => String(location.id) === String(form.locationId));
  const categoriesQuery = useCategoriesQuery();
  const categories = Array.isArray(categoriesQuery.data) ? categoriesQuery.data : [];
  const suppliersQuery = useSuppliersQuery();
  const suppliers = Array.isArray(suppliersQuery.data) ? suppliersQuery.data : [];

  const getCategoryName = (id?: string) => {
    if (!id) return '';
    const trimmed = String(id).trim();
    const found = categories.find((c) => String(c.id) === trimmed || String(c.name).trim() === trimmed);
    return found?.name || (trimmed ? `قسم ${trimmed}` : '');
  };

  const categoryOptions = useMemo(() => {
    const unique = new Map<string, { id: string; label: string; count: number }>();
    products.forEach((product) => {
      const id = String(product.categoryId || '').trim();
      if (!id) return;
      const current = unique.get(id);
      unique.set(id, {
        id,
        label: getCategoryName(id),
        count: (current?.count || 0) + 1,
      });
    });
    return Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [products, categories]);

  const supplierOptions = useMemo(() => {
    const unique = new Map<string, { id: string; label: string; count: number }>();
    products.forEach((product) => {
      const id = String(product.supplierId || '').trim();
      if (!id) return;
      const supplierObj = suppliers.find((s) => String(s.id) === id);
      const label = supplierObj?.name || `مورد ${id}`;
      const current = unique.get(id);
      unique.set(id, {
        id,
        label,
        count: (current?.count || 0) + 1,
      });
    });
    return Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [products, suppliers]);

  const branchOptions = useMemo(
    () => [
      { value: '', label: 'بدون فرع' },
      ...branches.map((branch) => ({ value: String(branch.id), label: branch.name })),
    ],
    [branches],
  );

  const stockCountWarehouseOptions = useMemo(
    () => [
      { value: '', label: 'اختر المخزن' },
      ...warehouseList.map((location) => ({ value: String(location.id), label: location.name })),
    ],
    [warehouseList],
  );

  const categorySelectOptions = useMemo(
    () => [
      { value: '', label: 'اختر القسم' },
      ...categoryOptions.map((category) => ({ value: String(category.id), label: `${category.label} (${category.count})` })),
    ],
    [categoryOptions],
  );

  const supplierSelectOptions = useMemo(
    () => [
      { value: '', label: 'اختر المورد' },
      ...supplierOptions.map((supplier) => ({ value: String(supplier.id), label: `${supplier.label} (${supplier.count} صنف)` })),
    ],
    [supplierOptions],
  );

  const countTypeOptions: Array<{ key: StockCountType; label: string; description: string }> = useMemo(() => ([
    { key: 'quick', label: 'جرد سريع', description: 'عد صنف أو مجموعة بسيطة بسرعة بدون تجهيز قائمة كاملة.' },
    { key: 'selected_items', label: 'أصناف محددة', description: 'اختر الأصناف التي تريد عدها يدويًا قبل إنشاء الجلسة.' },
    { key: 'category', label: 'جرد قسم / تصنيف', description: 'اختر القسم لفتح شيت عد أصناف هذا القسم فقط.' },
    { key: 'supplier', label: 'جرد مورد / شركة', description: 'اختر المورد لفتح شيت عد أصناف هذا المورد قبل طلبية الشراء.' },
    { key: 'full', label: 'جرد شامل للمخزن', description: 'جهّز شيت عد لكل الأصناف ثم أدخل الفروقات بعد العد الفعلي.' },
  ]), []);

  const [countType, setCountType] = useState<StockCountType>('quick');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [isCountStarted, setIsCountStarted] = useState(false);
  const [startCountMessage, setStartCountMessage] = useState('');
  const [showExpectedInElectronicCount, setShowExpectedInElectronicCount] = useState(false);
  const [barcodeScanInput, setBarcodeScanInput] = useState('');
  const [lastScannedItem, setLastScannedItem] = useState<{ name: string; qty: number } | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const selectedProduct = products.find((product) => String(product.id) === String(form.productId));
  const countedItemsList = useMemo(() => items.filter((item) => item.isCounted !== false && item.countedQty !== '' && item.countedQty != null), [items]);
  const totalCounted = countedItemsList.reduce((sum, item) => sum + Number(item.countedQty || 0), 0);
  const totalVariance = Number(countedItemsList.reduce((sum, item) => sum + Number(item.varianceQty || 0), 0).toFixed(3));
  const varianceItems = countedItemsList.filter((item) => Number(item.varianceQty || 0) !== 0).length;
  const countedCount = countedItemsList.length;
  const uncountedCount = items.length - countedCount;
  const selectedCountType = countTypeOptions.find((entry) => entry.key === countType) || countTypeOptions[0];
  const canShowExpectedCount = canReviewStock && showExpectedInElectronicCount;

  const financialSummary = useMemo(() => {
    let deficitCost = 0;
    let surplusCost = 0;
    countedItemsList.forEach((item) => {
      const prod = products.find((p) => String(p.id) === String(item.productId));
      const cost = Number(prod?.costPrice || 0);
      const variance = Number(item.varianceQty || 0);
      if (variance < 0) deficitCost += Math.abs(variance) * cost;
      if (variance > 0) surplusCost += variance * cost;
    });
    return {
      deficitCost,
      surplusCost,
      netCost: surplusCost - deficitCost,
    };
  }, [countedItemsList, products]);

  useEffect(() => {
    if (!form.locationId) {
      setIsCountStarted(false);
      setStartCountMessage('');
    }
  }, [form.locationId]);

  useEffect(() => {
    if (countType !== 'category') setSelectedCategoryId('');
    if (countType !== 'supplier') setSelectedSupplierId('');
    onItemsChange(() => []);
    setIsCountStarted(false);
    setStartCountMessage('');
  }, [countType, onItemsChange]);

  useEffect(() => {
    if (isSuccess) {
      setIsCountStarted(false);
      setCountType('quick');
      setSelectedCategoryId('');
      setSelectedSupplierId('');
      setShowExpectedInElectronicCount(false);
      setStartCountMessage('');
      setLastScannedItem(null);
    }
  }, [isSuccess]);

  const scopedStocks = useMemo(() => buildCountLocationStockMap(form.locationId, locationStocks),
    [form.locationId, locationStocks]);
  const indexedProducts = useMemo(() => new Map(products.map((product) => [String(product.id), product])), [products]);
  const getProductLocationStock = (productId: string | number) =>
    scopedStocks === null ? null : scopedStocks.get(String(productId)) ?? 0;

  const scopeProducts = useMemo(() => {
    // Empty or unavailable warehouse stock never means the entire company.
    const baseProducts = form.locationId ? filterCountableProductsAtLocation(products, scopedStocks) : products;
    if (countType === 'full') return baseProducts;
    if (countType === 'category') {
      const categoryId = selectedCategoryId || selectedProduct?.categoryId || '';
      if (!categoryId) return [];
      return baseProducts.filter((product) => String(product.categoryId || '') === String(categoryId));
    }
    if (countType === 'supplier') {
      const supplierId = selectedSupplierId || selectedProduct?.supplierId || '';
      if (!supplierId) return [];
      return baseProducts.filter((product) => String(product.supplierId || '') === String(supplierId));
    }
    if (selectedProduct) return [selectedProduct];
    return [];
  }, [countType, products, selectedCategoryId, selectedSupplierId, selectedProduct, form.locationId, scopedStocks]);

  const sheetRows: StockCountSheetRow[] = useMemo(() => {
    const resolveExpected = (pId: string | number, fallback: number) => {
      const locQty = getProductLocationStock(pId);
      return locQty !== null ? locQty : fallback;
    };

    if (countType === 'full' || countType === 'category' || countType === 'supplier') {
      return scopeProducts.map((product) => ({
        code: product.styleCode || product.id,
        barcode: product.barcode || product.units?.find((unit) => unit.barcode)?.barcode || '',
        name: product.name,
        category: getCategoryName(product.categoryId),
        expectedQty: resolveExpected(product.id, product.stock ?? 0),
        countedQty: '',
        note: '',
      }));
    }
    if (items.length) {
      return items.map((item) => {
        const product = indexedProducts.get(String(item.productId));
        return {
          code: product?.styleCode || String(item.productId),
          barcode: product?.barcode || product?.units?.find((unit) => unit.barcode)?.barcode || '',
          name: item.productName,
          category: getCategoryName(product?.categoryId),
          expectedQty: item.expectedQty,
          countedQty: item.countedQty,
          note: item.note || item.reason || '',
        };
      });
    }
    return scopeProducts.map((product) => ({
      code: product.styleCode || product.id,
      barcode: product.barcode || product.units?.find((unit) => unit.barcode)?.barcode || '',
      name: product.name,
      category: getCategoryName(product.categoryId),
      expectedQty: resolveExpected(product.id, product.stock ?? 0),
      countedQty: '',
      note: '',
    }));
  }, [countType, items, indexedProducts, scopeProducts, categories, form.locationId, scopedStocks]);

  function handlePopulateScopeItems() {
    if (!scopeProducts.length) return;
    onItemsChange(() => scopeProducts.map((p) => {
      const locQty = getProductLocationStock(p.id);
      const expectedQty = locQty !== null ? locQty : Number(p.stock || 0);
      return {
        id: `${p.id}-${Date.now()}`,
        productId: p.id,
        productName: p.name,
        expectedQty,
        countedQty: '',
        varianceQty: 0,
        isCounted: false,
        reason: '',
        note: '',
      };
    }));
  }

  async function handleResetAllToExpected() {
    if (!items.length) return;
    if (countedCount > 0) {
      const confirmed = await systemConfirm({
        title: 'ملء برصيد النظام',
        message: 'سيتم تعيين كافة الكميات المعدودة لتطابق رصيد النظام المسجل بالدفاتر (تصفير الفروقات). هل تريد المتابعة؟',
        badge: 'مطابقة الدفاتر',
        confirmText: 'ملء برصيد النظام',
        cancelText: 'إلغاء',
        confirmVariant: 'info',
      });
      if (!confirmed) return;
    }
    onItemsChange((current) => current.map((item) => {
      const expectedQty = Number(item.expectedQty || 0);
      return {
        ...item,
        countedQty: expectedQty,
        varianceQty: 0,
        isCounted: true,
      };
    }));
    toast.success('تمت مطابقة كافة الأصناف مع رصيد النظام بنجاح.');
  }

  async function handleZeroUncounted() {
    if (!items.length) return;
    if (!uncountedCount) {
      toast.info('جميع الأصناف في الجلسة تم عدها وإدخال كمياتها بالفعل.');
      return;
    }
    const confirmed = await systemConfirm({
      title: 'تصفير ما لم يُعد (ملء المتبقي بصفر)',
      message: `سيتم تعيين الكمية المعدودة (0) لعدد ${uncountedCount} صنف متبقٍ لم يتم عده بعد، مع الإبقاء التام على ما قمت بعده (${countedCount} صنف). هل تريد المتابعة؟`,
      badge: 'تصفير المتبقي',
      confirmText: `تصفير المتبقي (${uncountedCount})`,
      cancelText: 'إلغاء',
      confirmVariant: 'primary',
    });
    if (!confirmed) return;

    onItemsChange((current) => current.map((item) => {
      const isUncounted = item.isCounted === false || item.countedQty === '' || item.countedQty == null;
      if (!isUncounted) return item;
      const expectedQty = Number(item.expectedQty || 0);
      return {
        ...item,
        countedQty: 0,
        varianceQty: Number((0 - expectedQty).toFixed(3)),
        isCounted: true,
      };
    }));
    toast.success(`تم تصفير ${uncountedCount} صنف متبقٍ برصيد (0) بنجاح.`);
  }

  async function handleZeroAllCounts() {
    if (!items.length) return;
    const isOverwriting = countedCount > 0;
    const confirmed = await systemConfirm({
      title: 'تصفير كافة أصناف الجلسة (جرد صفري شامل)',
      message: isOverwriting
        ? `تنبيه: قمت بعد ${countedCount} صنف سابقاً. سيتم وضع رصيد (0) لكافة الأصناف (${items.length} صنف) واستبدال ما أدخلته. متابعة التصفير الشامل؟`
        : `سيتم تعيين الكمية المعدودة (0) لكافة الأصناف (${items.length} صنف) في جلسة الجرد واعتبار رصيد المخزن صفرياً بالكامل. هل تريد المتابعة؟`,
      badge: 'جرد صفري شامل',
      confirmText: 'تصفير الكل (0)',
      cancelText: 'إلغاء',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    onItemsChange((current) => current.map((item) => {
      const expectedQty = Number(item.expectedQty || 0);
      return {
        ...item,
        countedQty: 0,
        varianceQty: Number((0 - expectedQty).toFixed(3)),
        isCounted: true,
      };
    }));
    toast.success(`تم تعيين رصيد (0) لكافة الأصناف (${items.length} صنف) بنجاح.`);
  }

  async function handleClearAllCounts() {
    if (!items.length) return;
    if (countedCount > 0) {
      const confirmed = await systemConfirm({
        title: 'إفراغ كافة الخانات (العد الأعمى)',
        message: 'سيتم تفريغ كافة خانات العد للعودة لحالة العد الأعمى (الأصناف الفارغة لا تُدرج في الجلسة). هل تريد المتابعة؟',
        badge: 'مسح المدخلات',
        confirmText: 'إفراغ الخانات',
        cancelText: 'إلغاء',
        confirmVariant: 'danger',
      });
      if (!confirmed) return;
    }
    onItemsChange((current) => current.map((item) => ({
      ...item,
      countedQty: '',
      varianceQty: 0,
      isCounted: false,
    })));
    toast.info('تم إفراغ خانات الجرد والعودة للعد الأعمى.');
  }

  function handlePrintSheet() {
    printStockCountSheet(sheetRows, {
      title: `شيت عد - ${selectedLocation ? selectedLocation.name : selectedCountType.label}`,
      locationName: selectedLocation?.name,
      includeExpectedQty: showExpectedInElectronicCount,
    });
  }

  function handleExportExcel() {
    exportStockCountSheetExcel(sheetRows, {
      includeExpectedQty: showExpectedInElectronicCount,
      locationName: selectedLocation?.name,
    });
  }

  function handleStartCount() {
    if (isLoadingCatalog || locationStocks === undefined) {
      setStartCountMessage('أرصدة المخزن لم تُحمّل بنجاح. تحقق من الاتصال ولا تبدأ جرداً برصيد عام.');
      return;
    }
    if (!form.locationId) {
      setStartCountMessage('اختر المخزن أولًا قبل بدء الجرد.');
      return;
    }
    if (countType === 'category' && !selectedCategoryId) {
      setStartCountMessage('اختر القسم المطلوب قبل بدء جرد القسم.');
      return;
    }
    if (countType === 'supplier' && !selectedSupplierId) {
      setStartCountMessage('اختر المورد المطلوب قبل بدء جرد المورد.');
      return;
    }
    setStartCountMessage('');
    setIsCountStarted(true);
    if (countType === 'full' || countType === 'category' || countType === 'supplier') {
      handlePopulateScopeItems();
    }
  }

  useEffect(() => {
    if (
      isCountStarted &&
      (countType === 'full' || countType === 'category' || countType === 'supplier') &&
      items.length === 0 &&
      scopeProducts.length > 0
    ) {
      handlePopulateScopeItems();
    }
  }, [isCountStarted, countType, items.length, scopeProducts.length]);

  function handleBackToSetup() {
    setIsCountStarted(false);
    setStartCountMessage('');
    setLastScannedItem(null);
  }

  function buildSessionNoteWithType(baseNote: string) {
    const categoryLabel = categoryOptions.find((category) => category.id === selectedCategoryId)?.label;
    const supplierLabel = supplierOptions.find((supplier) => supplier.id === selectedSupplierId)?.label;
    const scopeLabel = categoryLabel ? ` - قسم: ${categoryLabel}` : supplierLabel ? ` - مورد: ${supplierLabel}` : '';
    const line = `نوع الجرد: ${selectedCountType.label}${scopeLabel}`;
    const visibilityLine = `عرض كمية النظام أثناء العد الإلكتروني: ${showExpectedInElectronicCount ? 'نعم' : 'لا'}`;
    const trimmedBase = String(baseNote || '').trim();
    const metadata = `${line}\n${visibilityLine}`;
    if (!trimmedBase) return metadata;
    if (trimmedBase.includes(line)) return trimmedBase;
    return `${trimmedBase}\n${metadata}`;
  }

  const [tableSearchQuery, setTableSearchQuery] = useState('');
  const [tableFilterTab, setTableFilterTab] = useState<'all' | 'counted' | 'variance' | 'uncounted'>('all');

  const filteredItems = useMemo(() => {
    let result = items;
    const query = tableSearchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((item) => {
        const prod = indexedProducts.get(String(item.productId));
        const name = String(item.productName || '').toLowerCase();
        const barcode = String(prod?.barcode || '').toLowerCase();
        const styleCode = String(prod?.styleCode || '').toLowerCase();
        return name.includes(query) || barcode.includes(query) || styleCode.includes(query);
      });
    }

    if (tableFilterTab === 'counted') {
      result = result.filter((item) => item.isCounted !== false && item.countedQty !== '' && item.countedQty != null);
    } else if (tableFilterTab === 'variance') {
      result = result.filter((item) => item.isCounted !== false && item.countedQty !== '' && item.countedQty != null && Number(item.varianceQty || 0) !== 0);
    } else if (tableFilterTab === 'uncounted') {
      result = result.filter((item) => item.isCounted === false || item.countedQty === '' || item.countedQty == null);
    }

    return result;
  }, [items, indexedProducts, tableSearchQuery, tableFilterTab]);

  const pagination = useClientPagination(filteredItems, {
    initialPageSize: 50,
    pageSizeOptions: [25, 50, 100, 200],
  });

  function updateCountItemById(id: string, patch: Partial<StockCountItem>) {
    onItemsChange((current) => current.map((item) => {
      if (item.id !== id) return item;
      const rawCount = patch.countedQty !== undefined ? patch.countedQty : item.countedQty;
      const isEmpty = rawCount === '' || rawCount === null || rawCount === undefined;
      const isCounted = patch.isCounted !== undefined ? patch.isCounted : !isEmpty;
      const countedQty = isEmpty ? '' : Number(rawCount);
      const expectedQty = Number(item.expectedQty || 0);
      const varianceQty = isEmpty ? 0 : Number((Number(countedQty) - expectedQty).toFixed(3));
      return {
        ...item,
        ...patch,
        countedQty,
        isCounted,
        varianceQty,
      };
    }));
  }

  function removeCountItemById(id: string) {
    onItemsChange((current) => current.filter((item) => item.id !== id));
  }

  function handleBarcodeScan(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    if (!form.locationId || scopedStocks === null) {
      setStartCountMessage('أرصدة المخزن غير متاحة. لن نعد قطعة في مخزن غير مؤكد');
      return;
    }
    const scan = classifyStockCountBarcodeScan(trimmed, products);
    if (scan.status !== 'matched') {
      setStartCountMessage(scan.status === 'ambiguous'
        ? 'هذا الكود مشترك بين عدة مقاسات أو أصناف؛ امسح باركود المقاس المحدد'
        : scan.status === 'style_code'
          ? 'كود الموديل ليس باركود مقاس. اختر المقاس المحدد قبل الجرد'
          : `لم يتم العثور على صنف بباركود محفوظ: ${trimmed}`);
      return;
    }
    const matchedProduct = scan.product;
    const countedBaseQty = scan.baseQty;
    setStartCountMessage('');
    const existingItem = items.find((item) => String(item.productId) === String(matchedProduct.id));
    if (existingItem) {
      const currentQty = existingItem.countedQty === '' || existingItem.countedQty == null ? 0 : Number(existingItem.countedQty);
      const nextQty = Number((currentQty + countedBaseQty).toFixed(3));
      updateCountItemById(existingItem.id, { countedQty: nextQty, isCounted: true });
      setLastScannedItem({ name: existingItem.productName, qty: nextQty });
    } else {
      const expectedQty = scopedStocks.get(String(matchedProduct.id)) ?? 0;
      const newItem: StockCountItem = {
        id: `${matchedProduct.id}-${Date.now()}`,
        productId: matchedProduct.id,
        productName: matchedProduct.name,
        expectedQty,
        countedQty: countedBaseQty,
        varianceQty: Number((countedBaseQty - expectedQty).toFixed(3)),
        reason: '',
        note: '',
      };
      onItemsChange((current) => [newItem, ...current]);
      setLastScannedItem({ name: matchedProduct.name, qty: countedBaseQty });
    }
    setBarcodeScanInput('');
  }

  function handleBarcodeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBarcodeScan(barcodeScanInput);
    }
  }

  return (
    <FormSection
      title={t('inventory.sections.inventory_composer_cards.s22', "جلسة جرد مخزون")}
      description={isCountStarted ? t('inventory.sections.inventory_composer_cards.s23', "راجع الأصناف، أدخل الكميات الفعلية، ثم أنشئ جلسة الجرد بعد المراجعة.") : t('inventory.sections.inventory_composer_cards.s24', "ابدأ بخطوات قليلة: اختر طريقة الجرد، النطاق، وطريقة العد.")}
      actions={<span className="nav-pill">{isCountStarted ? t('inventory.sections.inventory_composer_cards.s25', "مرحلة العد والمراجعة") : t('inventory.sections.inventory_composer_cards.s26', "إنشاء الجلسة")}</span>}
    >
      {!isCountStarted ? (
        <StockCountComposerSetup
          t={t}
          countTypeOptions={countTypeOptions}
          form={form}
          scopeProducts={scopeProducts}
          countType={countType}
          setCountType={setCountType}
          SINGLE_STORE_MODE={SINGLE_STORE_MODE}
          onFormChange={onFormChange}
          branchOptions={branchOptions}
          stockCountWarehouseOptions={stockCountWarehouseOptions}
          selectedCategoryId={selectedCategoryId}
          setSelectedCategoryId={setSelectedCategoryId}
          onItemsChange={onItemsChange}
          categorySelectOptions={categorySelectOptions}
          selectedSupplierId={selectedSupplierId}
          setSelectedSupplierId={setSelectedSupplierId}
          supplierSelectOptions={supplierSelectOptions}
          showExpectedInElectronicCount={showExpectedInElectronicCount}
          setShowExpectedInElectronicCount={setShowExpectedInElectronicCount}
          canReviewStock={canReviewStock}
          handleStartCount={handleStartCount}
          isLoadingCatalog={isLoadingCatalog}
          startCountMessage={startCountMessage}
        />
      ) : (
        <div className="stock-count-review-stack">
          {/* Header Bar with inline stats & save actions */}
          <StockCountComposerSessionBar
            selectedCountType={selectedCountType}
            selectedLocation={selectedLocation}
            t={t}
            selectedCategoryId={selectedCategoryId}
            categoryOptions={categoryOptions}
            selectedSupplierId={selectedSupplierId}
            supplierOptions={supplierOptions}
            items={items}
            countedCount={countedCount}
            totalCounted={totalCounted}
            totalVariance={totalVariance}
            canShowExpectedCount={canShowExpectedCount}
            financialSummary={financialSummary}
            handleBackToSetup={handleBackToSetup}
            isPending={isPending}
            onSubmit={onSubmit}
            buildSessionNoteWithType={buildSessionNoteWithType}
            form={form}
          />

          {/* Unified Scanner & Action Toolbar */}
          <StockCountComposerToolbar
            t={t}
            barcodeInputRef={barcodeInputRef}
            barcodeScanInput={barcodeScanInput}
            setBarcodeScanInput={setBarcodeScanInput}
            handleBarcodeKeyDown={handleBarcodeKeyDown}
            handleBarcodeScan={handleBarcodeScan}
            canReviewStock={canReviewStock}
            showExpectedInElectronicCount={showExpectedInElectronicCount}
            setShowExpectedInElectronicCount={setShowExpectedInElectronicCount}
            countType={countType}
            items={items}
            handlePopulateScopeItems={handlePopulateScopeItems}
            scopeProducts={scopeProducts}
            handleZeroUncounted={handleZeroUncounted}
            uncountedCount={uncountedCount}
            handleZeroAllCounts={handleZeroAllCounts}
            handleResetAllToExpected={handleResetAllToExpected}
            handleClearAllCounts={handleClearAllCounts}
            handlePrintSheet={handlePrintSheet}
            sheetRows={sheetRows}
            handleExportExcel={handleExportExcel}
          />

          {lastScannedItem ? (
            <div className="stock-count-scan-alert">
              <CheckCircleIcon size={16} color="#059669" />
              <span>{t('inventory.sections.inventory_composer_cards.s62', "تم مسح وعد:")} <strong>{lastScannedItem.name}</strong> {t('inventory.sections.inventory_composer_cards.s63', "(الكمية المعدودة:")} {lastScannedItem.qty})</span>
            </div>
          ) : null}

          {/* Quick Manual Add Row */}
          <StockCountComposerQuickEntry
            t={t}
            scopeProducts={scopeProducts}
            products={products}
            form={form}
            onFormChange={onFormChange}
            onAddItem={onAddItem}
          />

          {startCountMessage ? <div className="warning-box">{startCountMessage}</div> : null}
          <MutationFeedback isError={isError} isSuccess={isSuccess} error={error} errorFallback={t('inventory.sections.inventory_composer_cards.s68', "تعذر إنشاء جلسة الجرد")} successText={t('inventory.sections.inventory_composer_cards.s69', "تم إنشاء جلسة الجرد بنجاح.")} />

          {/* Table Search & Filter Bar */}
          <StockCountComposerFilterBar
            items={items}
            t={t}
            tableSearchQuery={tableSearchQuery}
            setTableSearchQuery={setTableSearchQuery}
            tableFilterTab={tableFilterTab}
            setTableFilterTab={setTableFilterTab}
            countedCount={countedCount}
            varianceItems={varianceItems}
            uncountedCount={uncountedCount}
            pagination={pagination}
          />

          {/* High Density Items Table */}
          <StockCountComposerTable
            filteredItems={filteredItems}
            t={t}
            canShowExpectedCount={canShowExpectedCount}
            pagination={pagination}
            products={products}
            updateCountItemById={updateCountItemById}
            removeCountItemById={removeCountItemById}
            items={items}
            countType={countType}
          />
        </div>
      )}
    </FormSection>
  );
}
