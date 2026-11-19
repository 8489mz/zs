import { useTranslation } from 'react-i18next';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { CustomSelect } from '@/shared/ui/custom-select';
import { matchesArabic } from '@/lib/arabic-normalization';
import {
  useDriverLoadRequisition,
  type DriverProductStock,
  type DriverAvailableProduct,
  type DriverWarehouse,
} from '../hooks/useDriverLoadRequisition';
import { deliveryRepsApi, type DeliveryRep } from '@/shared/api/delivery-reps.api';
import { vanSalesApi } from '../api/van-sales.api';
import {
  CheckCircleIcon,
  Trash2Icon,
  PlusIcon,
  MinusIcon,
  ArrowRightIcon,
  SearchIcon,
  XIcon,
  BoxesIcon,
  BuildingIcon,
  ClockIcon,
  RefreshCwIcon,
} from '@/shared/components/icons/AppIcons';
import { VanFloatingActionBar } from './VanFloatingActionBar';
import { toast } from '@/shared/components/system-alert';
import { useFormDraft } from '@/shared/hooks/use-form-draft';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import { LoadRequisitionCatalogTab } from './load-requisition/LoadRequisitionCatalogTab';
import { LoadRequisitionHeader } from './load-requisition/LoadRequisitionHeader';
import { LoadRequisitionProductList } from './load-requisition/LoadRequisitionProductList';
import { AdminSubmitSuccessView, DriverSubmitSuccessView } from './load-requisition/RequisitionSuccessViews';
import { useRequisitionSubmit } from './load-requisition/useRequisitionSubmit';
import { useRequisitionCart } from './load-requisition/useRequisitionCart';

import {
  CompactStepper,
  type DriverNewLoadRequisitionViewProps,
  type RequisitionLineItem,
} from './load-requisition/LoadRequisitionTypes';

export type { RequisitionLineItem } from './load-requisition/LoadRequisitionTypes';

export function DriverNewLoadRequisitionView({
  mode = 'driver',
  onBack,
  onRequisitionSubmitted,
}: DriverNewLoadRequisitionViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isAdmin = mode === 'admin';
  const isMobile = useIsMobile(768);

  // Active Sub-Tab: 'catalog' (Browsing & Adding) | 'selected' (Reviewing chosen items & Notes)
  const [activeViewTab, setActiveViewTab] = useState<'catalog' | 'selected'>('catalog');

  // Search & Company filter state (Unified mix)
  const [catalogSearchQuery, setCatalogSearchQuery] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showOutOfStock, setShowOutOfStock] = useState<boolean>(false);
  const [hideOutOfStockCompanies, setHideOutOfStockCompanies] = useState<boolean>(false);

  // Warehouse filter: 'all' means automatic source warehouse selection; otherwise a specific warehouseId string
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState<string>('all');
  const [notes, setNotes] = useState('');
  const [submittedDocNo, setSubmittedDocNo] = useState<string | null>(null);

  // Admin Mode State:
  const [selectedRepId, setSelectedRepId] = useState<string>('');
  const [adminSubmitResult, setAdminSubmitResult] = useState<{
    docNo: string;
    dispatched: boolean;
    tripId?: number;
    repName: string;
  } | null>(null);

  // Driver Hook (only enabled in driver mode)
  const driverHook = useDriverLoadRequisition(selectedWarehouseFilter, { enabled: !isAdmin });

  // Admin Queries (only enabled in admin mode)
  const adminWarehousesQuery = useQuery<DriverWarehouse[]>({
    queryKey: ['admin-warehouses'],
    queryFn: () => vanSalesApi.getAdminWarehouses(),
    enabled: isAdmin,
    staleTime: 10_000,
  });

  const adminRepsQuery = useQuery<DeliveryRep[]>({
    queryKey: ['delivery-reps'],
    queryFn: deliveryRepsApi.list,
    enabled: isAdmin,
    staleTime: 10_000,
  });

  const adminProductsQuery = useQuery<DriverAvailableProduct[]>({
    queryKey: ['admin-available-products', selectedWarehouseFilter],
    queryFn: () => vanSalesApi.getAdminAvailableProducts(selectedWarehouseFilter),
    enabled: isAdmin,
    staleTime: 30_000,
  });

  const adminReps = useMemo(() => {
    return (adminRepsQuery.data || []).filter((r) => r.is_active !== false);
  }, [adminRepsQuery.data]);

  const repSelectOptions = useMemo(() => {
    return adminReps.map((r) => {
      const plate = r.vehicle_plate ? ` [لوحة: ${r.vehicle_plate}]` : '';
      const phone = r.phone ? ` (${r.phone})` : '';
      const labelName = r.name || r.full_name || 'مندوب';
      return {
        value: String(r.id),
        label: `${labelName}${phone}${plate}`,
      };
    });
  }, [adminReps]);

  useEffect(() => {
    if (isAdmin && !selectedRepId && repSelectOptions.length > 0) {
      setSelectedRepId(repSelectOptions[0].value);
    }
  }, [isAdmin, selectedRepId, repSelectOptions]);

  const selectedRep = useMemo(() => {
    return adminReps.find((r) => String(r.id) === selectedRepId);
  }, [adminReps, selectedRepId]);

  // Unified data sources
  const warehouses = isAdmin ? (adminWarehousesQuery.data || []) : driverHook.warehouses;
  const isLoadingWarehouses = isAdmin ? adminWarehousesQuery.isLoading : driverHook.isLoadingWarehouses;
  const availableProducts = isAdmin ? (adminProductsQuery.data || []) : driverHook.availableProducts;
  const driverName = isAdmin ? (selectedRep?.name || selectedRep?.full_name || 'اختر مندوب التوزيع') : driverHook.driverName;
  const rawVehiclePlate = isAdmin ? (selectedRep?.vehicle_plate || '') : (driverHook.vehiclePlate || '');

  const displayVehiclePlate = useMemo(() => {
    if (!rawVehiclePlate) return '—';
    return rawVehiclePlate
      .replace(/^سيارة\s*(رقم)?\s*\[?/g, '')
      .replace(/\]$/g, '')
      .replace(/سيارة التوزيع الميدانية/g, '')
      .trim() || '—';
  }, [rawVehiclePlate]);

  interface VanRequisitionDraftData {
    lines: RequisitionLineItem[];
    selectedWarehouseFilter: string;
    notes: string;
    selectedRepId?: string;
  }

  // Admin submit mutation
  const adminSubmitMutation = useMutation({
    mutationFn: vanSalesApi.createAdminLoadRequisition,
    onSuccess: (res, vars) => {
      clearDraft();
      setLines([]);
      setNotes('');
      dismissRestoredNotice();
      const rep = adminReps.find((r) => r.id === vars.repId);
      const repName = rep?.name || 'المندوب';
      queryClient.invalidateQueries({ queryKey: ['van-admin-load-requisitions'] });
      queryClient.invalidateQueries({ queryKey: ['van-sales-admin-trips'] });
      setAdminSubmitResult({
        docNo: res.docNo,
        dispatched: res.dispatched,
        tripId: res.tripId,
        repName,
      });
      if (res.dispatched) {
        toast.success(`تم اعتماد وصرف البضاعة وتحميل السيارة وبدء الرحلة #${res.tripId} بنجاح!`);
      } else {
        toast.success(`تم حفظ إذن التحميل #${res.docNo} كمسودة معلقة للمراجعة.`);
      }
      if (onRequisitionSubmitted) {
        onRequisitionSubmitted(res.docNo);
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل تسجيل إذن التحميل الإداري');
    },
  });

  const isSubmitting = isAdmin ? adminSubmitMutation.isPending : driverHook.isSubmitting;
  const pendingRequisition = !isAdmin ? driverHook.pendingRequisition : null;
  const isCancellingRequisition = !isAdmin ? driverHook.isCancellingRequisition : false;

  // Selected Requisition Lines (Orders cart logic) — owned by useRequisitionCart (S1)
  const {
    lines,
    setLines,
    validLines,
    counts: { distinctItemsCount, distinctWarehousesCount },
    totalUnitsCount,
    totalEstimatedValue,
    hasDraftContent,
    handleUpdateProductUnits,
    handleCatalogAdd,
    handleCartonIncrement,
    handleCartonDecrement,
    handlePieceIncrement,
    handlePieceDecrement,
    handleSingleIncrement,
    handleSingleDecrement,
    handleRemoveLine,
    handleChangeLineWarehouse,
  } = useRequisitionCart({
    selectedWarehouseFilter,
    warehouses,
    availableProducts,
    notes,
  });

  // Draft auto-save and restore engine
  const draftKey = `zs_van_load_requisition_draft_${mode}`;

  const {
    clearDraft,
    isDraftRestored,
    dismissRestoredNotice,
    hasSavedDraft,
    flushDraft,
  } = useFormDraft<VanRequisitionDraftData>({
    key: draftKey,
    data: {
      lines,
      selectedWarehouseFilter,
      notes,
      selectedRepId: isAdmin ? selectedRepId : undefined,
    },
    isEmpty: (draft) =>
      (!draft.lines || !draft.lines.some((l) => Boolean(l.productId))) &&
      (!draft.notes || !draft.notes.trim()),
    onRestore: (restored) => {
      if (restored.lines && restored.lines.length > 0) {
        setLines(restored.lines.filter((l) => Boolean(l.productId)));
      }
      if (restored.selectedWarehouseFilter) {
        setSelectedWarehouseFilter(restored.selectedWarehouseFilter);
      }
      if (typeof restored.notes === 'string') {
        setNotes(restored.notes);
      }
      if (isAdmin && restored.selectedRepId) {
        setSelectedRepId(restored.selectedRepId);
      }
    },
    debounceMs: 300,
  });

  // Auto-default to first physical warehouse if opening fresh without draft
  useEffect(() => {
    if (selectedWarehouseFilter === 'all' && warehouses.length > 0 && lines.length === 0) {
      setSelectedWarehouseFilter(String(warehouses[0].id));
    }
  }, [warehouses, selectedWarehouseFilter, lines.length]);

  const warehouseSelectOptions = useMemo(() => [
    ...warehouses.map((w) => ({
      value: String(w.id),
      label: `${w.name} ${w.code ? `(${w.code})` : ''}`,
    })),
    { value: 'all', label: 'كل المخازن (تحديد تلقائي للمستودع الأوفر رصيداً)' },
  ], [warehouses]);

  // Group products by Company (Supplier) with category breakdown
  const companies = useMemo(() => {
    const map = new Map<string, {
      name: string;
      totalProducts: number;
      availableProducts: number;
      categoryMap: Map<string, { id: number | null; name: string; count: number }>;
    }>();

    for (const prod of availableProducts || []) {
      const compName = (prod.supplierName || '').trim() || 'الشركة العامة';
      if (!map.has(compName)) {
        map.set(compName, {
          name: compName,
          totalProducts: 0,
          availableProducts: 0,
          categoryMap: new Map(),
        });
      }
      const c = map.get(compName)!;
      c.totalProducts += 1;
      if (prod.totalStock > 0) {
        c.availableProducts += 1;
      }

      const catName = (prod.categoryName || '').trim() || 'عام';
      const catId = prod.categoryId ?? null;
      if (!c.categoryMap.has(catName)) {
        c.categoryMap.set(catName, { id: catId, name: catName, count: 0 });
      }
      c.categoryMap.get(catName)!.count += 1;
    }

    return Array.from(map.values())
      .map((c) => ({
        name: c.name,
        totalProducts: c.totalProducts,
        availableProducts: c.availableProducts,
        categories: Array.from(c.categoryMap.values()),
      }))
      .sort((a, b) => b.availableProducts - a.availableProducts);
  }, [availableProducts]);

  // Filtered companies based on hideOutOfStockCompanies
  const displayedCompanies = useMemo(() => {
    if (!hideOutOfStockCompanies) return companies;
    return companies.filter((c) => c.availableProducts > 0);
  }, [companies, hideOutOfStockCompanies]);

  // Distinct items from each company in requisition lines
  const linesCompanyCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of lines) {
      if (!line.productId) continue;
      const prod = (availableProducts || []).find((p) => p.id === Number(line.productId));
      const comp = (prod?.supplierName || '').trim() || 'الشركة العامة';
      map.set(comp, (map.get(comp) || 0) + 1);
    }
    return map;
  }, [lines, availableProducts]);

  // Categories for currently selected company
  const companyCategories = useMemo(() => {
    if (!selectedCompany) return [];
    if (selectedCompany === '__ALL__') {
      const catMap = new Map<string, { id: number | null; name: string; count: number }>();
      for (const p of availableProducts || []) {
        const catName = (p.categoryName || '').trim() || 'عام';
        if (!catMap.has(catName)) {
          catMap.set(catName, { id: p.categoryId ?? null, name: catName, count: 0 });
        }
        catMap.get(catName)!.count += 1;
      }
      return Array.from(catMap.values());
    }
    const found = companies.find((c) => c.name === selectedCompany);
    return found ? found.categories : [];
  }, [companies, selectedCompany, availableProducts]);

  const totalAvailableItemsCount = useMemo(() => {
    return (availableProducts || []).filter((p) => p.totalStock > 0).length;
  }, [availableProducts]);

  const outOfStockCount = useMemo(() => {
    let list = availableProducts || [];
    if (catalogSearchQuery.trim()) {
      const q = catalogSearchQuery.trim().toLowerCase();
      list = list.filter((p) => {
        const sup = (p.supplierName || '').toLowerCase();
        const cat = (p.categoryName || '').toLowerCase();
        return (
          (p.name || '').toLowerCase().includes(q) ||
          matchesArabic(p.name, q) ||
          (p.barcode || '').toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          sup.includes(q) ||
          matchesArabic(sup, q) ||
          cat.includes(q) ||
          matchesArabic(cat, q)
        );
      });
    } else if (selectedCompany && selectedCompany !== '__ALL__') {
      list = list.filter((p) => ((p.supplierName || '').trim() || 'الشركة العامة') === selectedCompany);
    }
    if (selectedCategory !== 'all') {
      list = list.filter((p) => ((p.categoryName || '').trim() || 'عام') === selectedCategory);
    }
    return list.filter((p) => p.totalStock <= 0).length;
  }, [availableProducts, catalogSearchQuery, selectedCompany, selectedCategory]);

  // Filter Catalog Products by search, company, category, and out of stock
  const displayedProducts = useMemo(() => {
    return (availableProducts || []).filter((p) => {
      // Out of stock filter
      if (!showOutOfStock && p.totalStock <= 0) return false;

      // 1. Search query filter takes priority across ALL companies
      if (catalogSearchQuery.trim()) {
        const q = catalogSearchQuery.trim().toLowerCase();
        const sup = (p.supplierName || '').toLowerCase();
        const cat = (p.categoryName || '').toLowerCase();
        const matchName = (p.name || '').toLowerCase().includes(q) || matchesArabic(p.name, q);
        const matchBarcode = (p.barcode || '').toLowerCase().includes(q);
        const matchSku = (p.sku || '').toLowerCase().includes(q);
        const matchSupplier = sup.includes(q) || matchesArabic(sup, q);
        const matchCategory = cat.includes(q) || matchesArabic(cat, q);
        return matchName || matchBarcode || matchSku || matchSupplier || matchCategory;
      }

      // 2. Company & category filter
      if (selectedCompany) {
        if (selectedCompany !== '__ALL__') {
          const comp = (p.supplierName || '').trim() || 'الشركة العامة';
          if (comp !== selectedCompany) return false;
        }

        if (selectedCategory !== 'all') {
          const cat = (p.categoryName || '').trim() || 'عام';
          if (cat !== selectedCategory) return false;
        }
        return true;
      }

      return true;
    });
  }, [availableProducts, catalogSearchQuery, selectedCompany, selectedCategory, showOutOfStock]);

  const { handleGoBack, handleClearDraft, handleCancelPendingAndRestore, handleSubmit, handleAdminSubmit } =
    useRequisitionSubmit({
      driverHook,
      adminSubmitMutation,
      availableProducts,
      pendingRequisition,
      validLines,
      distinctItemsCount,
      totalUnitsCount,
      driverName,
      isAdmin,
      notes,
      selectedRepId,
      selectedWarehouseFilter,
      hasDraftContent,
      hasSavedDraft,
      flushDraft,
      clearDraft,
      dismissRestoredNotice,
      onBack,
      onRequisitionSubmitted,
      setLines,
      setNotes,
      setSelectedWarehouseFilter,
      setActiveViewTab,
      setSubmittedDocNo,
    });

  if (adminSubmitResult) {
    return <AdminSubmitSuccessView adminSubmitResult={adminSubmitResult} onBack={handleGoBack} />;
  }

  if (submittedDocNo) {
    return <DriverSubmitSuccessView submittedDocNo={submittedDocNo} onBack={handleGoBack} />;
  }

  return (
    <div dir="rtl" className="driver-requisition-view" style={{ width: '100%', minHeight: '100vh', backgroundColor: '#f8fafc', boxSizing: 'border-box' }}>
      <style>{`
        input.no-spin-arrows::-webkit-outer-spin-button,
        input.no-spin-arrows::-webkit-inner-spin-button {
          -webkit-appearance: none !important;
          margin: 0 !important;
        }
        input.no-spin-arrows {
          -moz-appearance: textfield !important;
          appearance: textfield !important;
        }
      `}</style>
      <div
        style={{
          maxWidth: '1280px',
          width: 'min(100%, 1280px)',
          margin: '0 auto',
          paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))',
          paddingRight: 'max(10px, env(safe-area-inset-right, 0px))',
          paddingBottom: 'calc(85px + env(safe-area-inset-bottom, 0px))',
          paddingLeft: 'max(10px, env(safe-area-inset-left, 0px))',
          boxSizing: 'border-box',
        }}
      >
        <LoadRequisitionHeader
          isAdmin={isAdmin}
          isMobile={isMobile}
          distinctItemsCount={distinctItemsCount}
          validLines={validLines}
          isSubmitting={isSubmitting}
          isCancellingRequisition={isCancellingRequisition}
          pendingRequisition={pendingRequisition}
          isDraftRestored={isDraftRestored}
          selectedWarehouseFilter={selectedWarehouseFilter}
          setSelectedWarehouseFilter={setSelectedWarehouseFilter}
          warehouseSelectOptions={warehouseSelectOptions}
          isLoadingWarehouses={isLoadingWarehouses}
          selectedRepId={selectedRepId}
          setSelectedRepId={setSelectedRepId}
          repSelectOptions={repSelectOptions}
          adminRepsQuery={adminRepsQuery}
          driverName={driverName}
          displayVehiclePlate={displayVehiclePlate}
          dismissRestoredNotice={dismissRestoredNotice}
          handleGoBack={handleGoBack}
          handleClearDraft={handleClearDraft}
          handleCancelPendingAndRestore={handleCancelPendingAndRestore}
          handleSubmit={handleSubmit}
          handleAdminSubmit={handleAdminSubmit}
          adminSubmitMutation={adminSubmitMutation}
        />

        {/* SUB-TABS SELECTOR: Catalog vs Selected Items */}
        <div
          style={{
            display: 'flex',
            backgroundColor: '#f1f5f9',
            padding: '3px',
            borderRadius: '9px',
            gap: '4px',
            marginBottom: '8px',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveViewTab('catalog')}
            style={{
              flex: 1,
              padding: '7px 8px',
              borderRadius: '7px',
              fontSize: '12px',
              fontWeight: 600,
              border: activeViewTab === 'catalog' ? '1px solid #170e5e' : '1px solid transparent',
              background: activeViewTab === 'catalog' ? '#170e5e' : 'transparent',
              color: activeViewTab === 'catalog' ? '#ffffff' : '#475569',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <BoxesIcon size={14} />
            <span>{t('delivery_reps.driver_new_load_requisition_view.s59', "كتالوج أصناف المخزن (")}{displayedProducts.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveViewTab('selected')}
            style={{
              flex: 1,
              padding: '7px 8px',
              borderRadius: '7px',
              fontSize: '12px',
              fontWeight: 600,
              border: activeViewTab === 'selected' ? '1px solid #170e5e' : '1px solid transparent',
              background: activeViewTab === 'selected' ? '#170e5e' : 'transparent',
              color: activeViewTab === 'selected' ? '#ffffff' : '#475569',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <CheckCircleIcon size={14} />
            <span>{t('delivery_reps.driver_new_load_requisition_view.s60', "الأصناف المطلوبة للتحميل (")}{distinctItemsCount})</span>
          </button>
        </div>

        <LoadRequisitionCatalogTab
          activeViewTab={activeViewTab}
          catalogSearchQuery={catalogSearchQuery}
          setCatalogSearchQuery={setCatalogSearchQuery}
          selectedCompany={selectedCompany}
          setSelectedCompany={setSelectedCompany}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          showOutOfStock={showOutOfStock}
          setShowOutOfStock={setShowOutOfStock}
          hideOutOfStockCompanies={hideOutOfStockCompanies}
          setHideOutOfStockCompanies={setHideOutOfStockCompanies}
          companies={companies}
          displayedCompanies={displayedCompanies}
          companyCategories={companyCategories}
          linesCompanyCounts={linesCompanyCounts}
          totalAvailableItemsCount={totalAvailableItemsCount}
          outOfStockCount={outOfStockCount}
          distinctItemsCount={distinctItemsCount}
          availableProducts={availableProducts}
          displayedProducts={displayedProducts}
          lines={lines}
          isMobile={isMobile}
          handleUpdateProductUnits={handleUpdateProductUnits}
          handleCatalogAdd={handleCatalogAdd}
          handleCartonIncrement={handleCartonIncrement}
          handleCartonDecrement={handleCartonDecrement}
          handlePieceIncrement={handlePieceIncrement}
          handlePieceDecrement={handlePieceDecrement}
          handleSingleIncrement={handleSingleIncrement}
          handleSingleDecrement={handleSingleDecrement}
        />

        {/* TAB 2: SELECTED ITEMS REVIEW & NOTES */}
        {activeViewTab === 'selected' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {validLines.length === 0 ? (
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                  padding: '36px 16px',
                  textAlign: 'center',
                  color: '#64748b',
                }}
              >
                <BoxesIcon size={32} style={{ margin: '0 auto 8px', color: '#94a3b8' }} />
                <p style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 700 }}>
                  {t('delivery_reps.driver_new_load_requisition_view.s84', "لم تقم بتحديد أي أصناف للتحميل حتى الآن.")}
                </p>
                <Button
                  variant="primary"
                  onClick={() => setActiveViewTab('catalog')}
                  style={{
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '7px 16px',
                  }}
                >
                  {t('delivery_reps.driver_new_load_requisition_view.s85', "تصفح كتالوج المخزن واختيار الأصناف")}
                </Button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {validLines.map((line, index) => {
                  const mult = line.packagingUnit?.multiplier || 1;
                  const isCartonItem = Boolean(line.packagingUnit && mult > 1);
                  const lineTotal = line.qty * line.unitPrice;

                  // Product object to read stocks
                  const prod = availableProducts.find((p) => p.id === Number(line.productId));

                  return (
                    <div
                      key={line.id}
                      style={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '9px',
                        padding: '8px 10px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      {/* Top Row: Index, Name, Subtotal, Delete */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: '#475569', flexShrink: 0 }}>
                            #{index + 1}
                          </span>
                          <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {line.productName}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e', backgroundColor: '#ede9fe', padding: '1px 6px', borderRadius: '4px' }}>
                            {lineTotal.toFixed(2)} <CurrencySymbol />
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(line.id)}
                            style={{
                              backgroundColor: '#fee2e2',
                              border: '1px solid #fecaca',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '3px 6px',
                              borderRadius: '5px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              height: '24px',
                              width: '24px',
                            }}
                            title={t('delivery_reps.driver_new_load_requisition_view.s86', "حذف هذا السطر")}
                          >
                            <Trash2Icon size={12} />
                          </button>
                        </div>
                      </div>

                      {/* Middle: Warehouse picker (if 'all') & Available stock */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                        {selectedWarehouseFilter === 'all' && (line.warehouseStocks || []).filter((w) => w.qty > 0).length > 1 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ color: '#64748b', fontWeight: 700 }}>{t('delivery_reps.driver_new_load_requisition_view.s87', "المخزن:")}</span>
                            <select
                              value={line.sourceWarehouseId ? String(line.sourceWarehouseId) : ''}
                              onChange={(e) => handleChangeLineWarehouse(line.id, e.target.value)}
                              style={{
                                height: '24px',
                                fontSize: '11px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '5px',
                                padding: '0 4px',
                                backgroundColor: '#f8fafc',
                                color: '#0f172a',
                              }}
                            >
                              {(line.warehouseStocks || [])
                                .filter((w) => w.qty > 0)
                                .map((w) => (
                                  <option key={w.warehouseId} value={w.warehouseId}>
                                    {w.warehouseName} {t('delivery_reps.driver_new_load_requisition_view.s88', "(متاح:")} {w.qty})
                                  </option>
                                ))}
                            </select>
                          </div>
                        ) : (
                          <span style={{ color: '#64748b' }}>
                            {t('delivery_reps.driver_new_load_requisition_view.s89', "مخزن:")} {line.sourceWarehouseName || t('delivery_reps.driver_new_load_requisition_view.s90', "المستودع المختار")}
                          </span>
                        )}

                        <span style={{ color: '#15803d', fontWeight: 700 }}>
                          {t('delivery_reps.driver_new_load_requisition_view.s91', "متاح:")} {line.availableInWarehouse} {line.unit}
                        </span>
                      </div>

                      {/* Bottom: Stepper controls */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e' }}>
                          {t('delivery_reps.driver_new_load_requisition_view.s92', "إجمالي الكمية:")} {line.qty} {line.unit}
                        </span>

                        {isCartonItem && prod ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <CompactStepper
                              value={line.cartons || 0}
                              unitLabel={line.packagingUnit?.name || t('delivery_reps.driver_new_load_requisition_view.s93', "كرتونة")}
                              onIncrement={() => handleCartonIncrement(prod, line.cartons || 0, line.pieces || 0)}
                              onDecrement={() => handleCartonDecrement(prod, line.cartons || 0, line.pieces || 0)}
                              onChange={(val) => handleUpdateProductUnits(prod, val, line.pieces || 0)}
                              disabledDecrement={(line.cartons || 0) <= 0}
                              height="26px"
                              inputWidth="30px"
                            />
                            <span style={{ fontWeight: 800, color: '#94a3b8', fontSize: '11px' }}>+</span>
                            <CompactStepper
                              value={line.pieces || 0}
                              unitLabel={t('delivery_reps.driver_new_load_requisition_view.s94', "قطع")}
                              onIncrement={() => handlePieceIncrement(prod, line.cartons || 0, line.pieces || 0)}
                              onDecrement={() => handlePieceDecrement(prod, line.cartons || 0, line.pieces || 0)}
                              onChange={(val) => handleUpdateProductUnits(prod, line.cartons || 0, val)}
                              disabledDecrement={(line.pieces || 0) <= 0}
                              height="26px"
                              inputWidth="30px"
                            />
                          </div>
                        ) : prod ? (
                          <CompactStepper
                            value={line.qty}
                            unitLabel={line.unit || t('delivery_reps.driver_new_load_requisition_view.s95', "قطعة")}
                            isDecimal={Boolean(line.isWeight)}
                            step={line.isWeight ? 0.5 : 1}
                            min={0}
                            onIncrement={() => handleSingleIncrement(prod, line.qty)}
                            onDecrement={() => handleSingleDecrement(prod, line.qty)}
                            onChange={(val) => handleUpdateProductUnits(prod, 0, val)}
                            height="26px"
                            inputWidth={line.isWeight ? '44px' : '36px'}
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {/* Additional Notes Card */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '9px',
                    border: '1px solid #cbd5e1',
                    padding: '8px 10px',
                  }}
                >
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                    {t('delivery_reps.driver_new_load_requisition_view.s96', "ملاحظات إضافية لمشرف المستودع")}
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={1}
                    placeholder={t('delivery_reps.driver_new_load_requisition_view.s97', "أي ملاحظات إضافية على طلب الشحن...")}
                    style={{
                      width: '100%',
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '7px',
                      padding: '6px 8px',
                      fontSize: '11.5px',
                      color: '#0f172a',
                      boxSizing: 'border-box',
                      resize: 'vertical',
                      minHeight: '34px',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* BOTTOM SUMMARY CARD & ACTIONS */}
        <section
          style={{
            position: 'sticky',
            bottom: '10px',
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #cbd5e1',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            marginTop: '10px',
            zIndex: 30,
          }}
        >
          {distinctWarehousesCount > 1 && selectedWarehouseFilter === 'all' && (
            <div
              style={{
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                padding: '6px 10px',
                fontSize: '11px',
                color: '#1e40af',
                fontWeight: 600,
                lineHeight: 1.45,
                textAlign: 'center',
              }}
            >
              {t('delivery_reps.driver_new_load_requisition_view.s98', "الأصناف المطلوبة تتوزع على (")}{distinctWarehousesCount}{t('delivery_reps.driver_new_load_requisition_view.s99', ") مستودعات مختلفة. سيقوم النظام تلقائياً بإصدار إذن تحميل مستقل لكل مستودع لضمان دقة الصرف المخزني.")}
            </div>
          )}

          {/* Mini-KPI Strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr auto 1.2fr',
              alignItems: 'center',
              width: '100%',
              gap: '4px',
              backgroundColor: '#f8fafc',
              padding: '6px 10px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>{t('delivery_reps.driver_new_load_requisition_view.s100', "الأصناف")}</span>
              <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{distinctItemsCount} {t('delivery_reps.driver_new_load_requisition_view.s101', "صنف")}</strong>
            </div>
            <div style={{ height: '18px', width: '1px', backgroundColor: '#cbd5e1' }} />
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>{t('delivery_reps.driver_new_load_requisition_view.s102', "القطع")}</span>
              <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{totalUnitsCount} {t('delivery_reps.driver_new_load_requisition_view.s103', "قطعة")}</strong>
            </div>
            <div style={{ height: '18px', width: '1px', backgroundColor: '#cbd5e1' }} />
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>{t('delivery_reps.driver_new_load_requisition_view.s104', "القيمة المقدرة")}</span>
              <strong style={{ fontSize: '13px', color: '#170e5e', fontWeight: 900 }}>
                {totalEstimatedValue.toFixed(2)} <CurrencySymbol />
              </strong>
            </div>
          </div>

          {/* Action Buttons Row */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setActiveViewTab(activeViewTab === 'catalog' ? 'selected' : 'catalog')}
              style={{
                flex: '1 1 auto',
                fontSize: '12px',
                fontWeight: 700,
                color: '#170e5e',
                borderColor: '#170e5e',
                padding: '7px 10px',
                height: '34px',
                whiteSpace: 'nowrap',
              }}
            >
              {activeViewTab === 'catalog'
                ? `مراجعة الأصناف (${distinctItemsCount})`
                : t('delivery_reps.driver_new_load_requisition_view.s105', "+ كتالوج الأصناف")}
            </Button>

            {isAdmin ? (
              <>
                <Button
                  variant="primary"
                  type="button"
                  onClick={() => handleAdminSubmit(true)}
                  disabled={isSubmitting || validLines.length === 0}
                  style={{
                    flex: '1.2 1 auto',
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '12px',
                    padding: '7px 12px',
                    borderRadius: '7px',
                    height: '34px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {adminSubmitMutation.isPending ? t('delivery_reps.driver_new_load_requisition_view.s106', "جاري الصرف...") : `صرف وتحميل (${distinctItemsCount})`}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => handleAdminSubmit(false)}
                  disabled={isSubmitting || validLines.length === 0}
                  style={{
                    flex: '0 0 auto',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    color: '#170e5e',
                    borderColor: '#cbd5e1',
                    padding: '7px 10px',
                    height: '34px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('delivery_reps.driver_new_load_requisition_view.s107', "إذن معلق")}
                </Button>
              </>
            ) : pendingRequisition ? (
              <Button
                variant="primary"
                type="button"
                onClick={handleCancelPendingAndRestore}
                disabled={isCancellingRequisition}
                style={{
                  flex: '1.4 1 auto',
                  backgroundColor: '#b45309',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '12px',
                  padding: '7px 12px',
                  borderRadius: '7px',
                  height: '34px',
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
                title={`لديك طلب معلق #${pendingRequisition.docNo} - انقر لإلغائه وتعديل أصنافه`}
              >
                <RefreshCwIcon size={13} />
                {isCancellingRequisition ? t('delivery_reps.driver_new_load_requisition_view.s108', "جاري الإلغاء...") : `إلغاء المعلق (#${pendingRequisition.docNo}) وتعديل الأصناف`}
              </Button>
            ) : (
              <Button
                variant="primary"
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || validLines.length === 0}
                style={{
                  flex: '1.4 1 auto',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '12.5px',
                  padding: '7px 12px',
                  borderRadius: '7px',
                  height: '34px',
                  whiteSpace: 'nowrap',
                }}
              >
                {isSubmitting ? t('delivery_reps.driver_new_load_requisition_view.s109', "جارٍ الإرسال...") : `إرسال للمشرف (${distinctItemsCount})`}
              </Button>
            )}

            {(hasDraftContent || hasSavedDraft) && (
              <Button
                variant="secondary"
                type="button"
                onClick={handleClearDraft}
                style={{
                  fontSize: '11.5px',
                  fontWeight: 700,
                  color: '#dc2626',
                  borderColor: '#fca5a5',
                  backgroundColor: '#fef2f2',
                  padding: '7px 10px',
                  height: '34px',
                  whiteSpace: 'nowrap',
                  flex: '0 0 auto',
                }}
              >
                {t('delivery_reps.driver_new_load_requisition_view.s110', "حذف المسودة")}
              </Button>
            )}
          </div>
        </section>
      </div>

      {/* Floating Action Button (FAB) on the left for load requisition */}
      <VanFloatingActionBar
        visible={activeViewTab === 'catalog' && distinctItemsCount > 0}
        itemCount={distinctItemsCount}
        actionText={t('delivery_reps.driver_new_load_requisition_view.s111', "مراجعة الإذن")}
        onAction={() => {
          setActiveViewTab('selected');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
}

export const UnifiedLoadRequisitionView = DriverNewLoadRequisitionView;
export default DriverNewLoadRequisitionView;
